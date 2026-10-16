import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarX2, Contact, Pencil, Settings2 } from "lucide-react";
import { navigate, paths } from "../../../app/router";
import { Alert, Badge, Button, Card, ContextBar, MetricBar, Modal, PageHeader, useToast } from "../../../components/ui";
import { saveExcelSheets } from "../../bank-analysis/shared/excelExportService";
import { StatementFileActions, StatementFileCard } from "../../bank-analysis/shared/components/StatementFileCard";
import { SearchBox, SegmentedFilter } from "../../bank-analysis/shared/components/tableControls";
import { EmptyPeriodModal } from "../shared/components/EmptyPeriodModal";
import { normalizeKey } from "../../../utils/text";
import { useStatementImport } from "../../bank-analysis/shared/useStatementImport";
import { fsService } from "../../../services/fsService";
import { minimumWageService } from "../../../services/minimumWageService";
import { errorMessage } from "../../../services/tauri";
import { AREA_LABEL, type BatchInput, type Employee, type MovementInput, type PayrollRow } from "../../../types/fs";
import type { MinimumWage } from "../../../types/models";
import { formatInteger } from "../../../utils/format";
import { findCompanyByNit, namesMatch } from "../shared/companyMatch";
import { CompanySelect } from "../shared/components/CompanySelect";
import { PucSettingsModal, type PucSettingItem } from "../shared/components/PucSettingsModal";
import { SourceCoverage } from "../shared/components/SourceCoverage";
import { SendToFs } from "../shared/components/SendToFs";
import { formatExactCents, lastDayOfMonth, periodLabel } from "../shared/money";
import { useFsData } from "../shared/useFsData";
import {
  allPayrollKeys,
  areaFor,
  computeMonth,
  employeeKey,
  employeeKeysSentInPeriod,
  employeeMovements,
  findOperatorOverlaps,
  findAbsences,
  KIND_LABEL,
  MORA_KEY,
  openEmployment,
  parseIdentification,
  previousPeriod,
  requiredKeys,
  suggestedHireDate,
  wagesFor,
  type EmployeeMonth,
} from "./calc";
import { AreaChangeModal, EmployeeEditModal, EmployeeFormModal, JustifyAbsenceModal, LiquidationModal, RehireModal } from "./PayrollModals";
import { formatDateForDisplay } from "../../../utils/dates";
import type { PayrollOperator } from "./operators";

const PAYROLL_ITEMS: PucSettingItem[] = allPayrollKeys().map((k) => ({
  key: k.key,
  label: k.kind === "mora" ? KIND_LABEL.mora : `${KIND_LABEL[k.kind]} · ${k.side === "expense" ? "Gasto" : "Cuenta por pagar"}`,
  group: k.area ? AREA_LABEL[k.area] : "Global",
}));

/**
 * Estados Financieros → Nómina. Flujo común de todos los operadores de planillas (Aportes en Línea, MiPlanilla…):
 * lee la planilla con el lector del operador y causa por empleado salario, auxilio, seguridad social y
 * prestaciones, con sus cuentas por pagar. Cada operador solo aporta su lector del PDF y sus textos.
 */
export function PayrollFlow<A>({ operator }: { operator: PayrollOperator<A> }) {
  const toast = useToast();
  const data = useFsData();
  const [exportingSheets, setExportingSheets] = useState(false);
  const { state, picking, busy, exportedPath, pick } = useStatementImport<A>({
    analyze: operator.analyze,
    exportExcel: async () => null,
    fallbackError: operator.fallbackError,
    logTag: operator.logTag,
    pickTitle: operator.pickTitle,
    keepRotatedText: operator.keepRotatedText,
  });
  const summary = useMemo(() => (state.status === "done" ? operator.view(state.analysis) : null), [state, operator]);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [wages, setWages] = useState<MinimumWage[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creating, setCreating] = useState<{ docType: string; docNumber: string; name: string; suggestedHireDate?: string } | null>(null);
  const [rehire, setRehire] = useState<Employee | null>(null);
  const [liquidate, setLiquidate] = useState<{ employee: Employee; lastPeriod: string } | null>(null);
  const [justify, setJustify] = useState<Employee | null>(null);
  const [areaChange, setAreaChange] = useState<Employee | null>(null);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [areaFilter, setAreaFilter] = useState<"all" | "admin" | "sales">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "ready">("all");
  const [query, setQuery] = useState("");
  /** Empleado abierto en el detalle (tipo + número de documento). */
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [sentKey, setSentKey] = useState(0);

  useEffect(() => {
    minimumWageService.list().then(setWages, (e) => toast(errorMessage(e), "error"));
  }, [toast]);

  // Empresa por el NIT del aportante (si está registrada).
  useEffect(() => {
    if (!summary || !data.companies) return;
    const found = findCompanyByNit(data.companies, summary?.employerNit);
    setCompanyId(found?.id ?? null);
  }, [summary, data.companies]);

  const reloadPayroll = useCallback(async () => {
    if (companyId === null) return;
    try {
      const [e, r] = await Promise.all([fsService.employees(companyId), fsService.payrollRows(companyId)]);
      setEmployees(e);
      setRows(r);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }, [companyId, toast]);

  useEffect(() => {
    setEmployees([]);
    setRows([]);
    void reloadPayroll();
  }, [reloadPayroll]);

  const period = summary?.period ?? "";
  const paymentDate = summary?.paymentDate ?? undefined;
  const yearWages = period ? wagesFor(period, wages) : undefined;
  const company = data.companies?.find((c) => c.id === companyId);

  const months: EmployeeMonth[] = useMemo(() => {
    if (!summary) return [];
    return summary.employees.map((e) => {
      const { docType, docNumber } = parseIdentification(e.identification);
      const employee = employees.find((x) => x.docType === docType && x.docNumber === docNumber);
      const employment = employee ? openEmployment(employee) : undefined;
      return {
        source: e,
        docType,
        docNumber,
        employee,
        employmentId: employment?.id,
        area: employee ? areaFor(employee, summary.period) : undefined,
        calc: computeMonth(e.pensionIbc, e.pensionDays, yearWages?.smmlv ?? 0, yearWages?.transport ?? 0),
        social: { pension: e.pensionContribution * 100, health: e.healthContribution * 100, arl: e.riskContribution * 100, ccf: e.ccfContribution * 100 },
        parafiscalesCents: (e.otherContribution ?? 0) * 100,
      };
    });
  }, [summary, employees, yearWages]);

  const lateInterestCents = Math.max(0, (summary?.lateInterest ?? 0) * 100);
  // Quien ya fue enviado en este periodo (por esta u otra planilla/operador) no es una ausencia de esta planilla.
  const present = useMemo(() => {
    const keys = new Set(months.map((m) => employeeKey(m.docType, m.docNumber)));
    for (const k of employeeKeysSentInPeriod(period, rows, employees)) keys.add(k);
    return keys;
  }, [months, rows, employees, period]);
  /** Empleados de esta planilla que ya fueron enviados para el periodo desde OTRO operador: no se contabilizan dos veces. */
  const operatorOverlaps = useMemo(
    () => findOperatorOverlaps(months.flatMap((m) => (m.employee ? [m.employee] : [])), rows, period, operator.provider),
    [months, rows, period, operator.provider],
  );
  const absences = useMemo(() => (period ? findAbsences(period, present, employees, rows) : []), [period, present, employees, rows]);
  const keys = useMemo(() => requiredKeys(months, lateInterestCents), [months, lateInterestCents]);
  const missingKeys = keys.filter((k) => !data.settingsMap.get(k));
  const parafiscales = months.filter((m) => m.parafiscalesCents > 0);
  const newEmployees = months.filter((m) => !m.employee);
  const rehires = months.filter((m) => m.employee && !m.employmentId);
  const noArea = months.filter((m) => m.employee && m.employmentId && !m.area);
  const renamed = months.filter((m) => m.employee && !namesMatch(m.employee.name, m.source.name));
  /** Lo que le falta a cada empleado antes de enviar (vacío = listo). */
  const rowIssue = (m: EmployeeMonth) => {
    if (!m.employee) return "Sin ficha";
    if (!m.employmentId) return "Reingreso sin registrar";
    if (!m.area) return "Sin área contable";
    const sent = operatorOverlaps.find((o) => o.employeeId === m.employee!.id);
    return sent ? `Ya enviado por ${sent.provider || "otro operador"}` : null;
  };
  const socialOf = (m: EmployeeMonth) => m.social.pension + m.social.health + m.social.arl + m.social.ccf;
  const benefitsOf = (m: EmployeeMonth) => m.calc.primaCents + m.calc.cesantiasCents + m.calc.interesesCents + m.calc.vacacionesCents;
  const totals = useMemo(
    () => ({
      days: months.reduce((n, m) => n + m.calc.days, 0),
      salaries: months.reduce((n, m) => n + m.calc.salaryCents, 0),
      transport: months.reduce((n, m) => n + m.calc.transportCents, 0),
      social: months.reduce((n, m) => n + m.social.pension + m.social.health + m.social.arl + m.social.ccf, 0),
      benefits: months.reduce((n, m) => n + m.calc.primaCents + m.calc.cesantiasCents + m.calc.interesesCents + m.calc.vacacionesCents, 0),
    }),
    [months],
  );
  const visibleMonths = months.filter(
    (m) =>
      (areaFilter === "all" || m.area === areaFilter) &&
      (statusFilter === "all" || (statusFilter === "pending") === Boolean(rowIssue(m))) &&
      (!query || normalizeKey(`${m.employee?.name ?? m.source.name} ${m.docNumber}`).includes(normalizeKey(query))),
  );
  /** Fecha de ingreso sugerida para quien aún no tiene ficha y no estaba en la nómina del periodo anterior. */
  const suggestHire = (m: EmployeeMonth) => {
    const previous = previousPeriod(period);
    const known = employees.find((e) => e.docType === m.docType && e.docNumber === m.docNumber);
    const inPrevious = known ? rows.some((r) => r.period === previous && r.employeeId === known.id) : false;
    return known ? undefined : suggestedHireDate(period, m.calc.days, inPrevious);
  };
  const detail = months.find((m) => `${m.docType}${m.docNumber}` === detailKey) ?? null;

  const blocking = [
    companyId === null && "Selecciona la empresa",
    summary && summary.issues.length > 0 && operator.issuesBlocking,
    !paymentDate && "No se identificó la fecha de pago",
    parafiscales.length > 0 && "Se detectaron aportes parafiscales",
    operatorOverlaps.length > 0 && `${operatorOverlaps.length} ${operatorOverlaps.length === 1 ? "empleado ya enviado" : "empleados ya enviados"} desde otro operador`,
    !yearWages && `Falta el SMMLV o el auxilio de transporte de ${period.slice(0, 4)}`,
    newEmployees.length > 0 && `${newEmployees.length} empleados sin ficha`,
    rehires.length > 0 && `${rehires.length} reingresos sin registrar`,
    noArea.length > 0 && `${noArea.length} empleados sin área contable`,
    absences.length > 0 && `${absences.length} posibles retiros sin liquidación`,
    missingKeys.length > 0 && "Faltan cuentas PUC de nómina",
  ].filter(Boolean) as string[];
  // Solo faltan cuentas PUC: es una clasificación pendiente; lo demás requiere revisión.
  const blockedStatus = blocking.length === 1 && missingKeys.length > 0 ? "Pendiente de clasificación" : "Requiere revisión";

  function buildBatch(): BatchInput | null {
    if (!summary || companyId === null || !paymentDate) return null;
    const movements: MovementInput[] = months.flatMap((m) => employeeMovements(m, period, paymentDate, data.settingsMap));
    if (lateInterestCents) {
      movements.push({ accountingDate: paymentDate, conceptKey: "payroll.mora.expense", documentId: operator.moraDocumentId(summary), pucCode: data.settingsMap.get(MORA_KEY) ?? "", amountCents: lateInterestCents, description: `Intereses de mora planilla ${periodLabel(period)}` });
    }
    return {
      companyId,
      source: "payroll",
      fileName: state.status === "done" ? state.fileName : "",
      periodLabel: `Nómina ${periodLabel(period)}`,
      periodStart: `${period}-01`,
      periodEnd: lastDayOfMonth(period),
      dedupeKey: operator.dedupeKey(summary),
      metadata: { provider: operator.provider, period, paymentDate, employees: months.length, ...(summary.planillaId ? { planillaId: summary.planillaId } : {}) },
      movements,
      payrollRows: months.map((m) => ({
        employeeId: m.employee!.id,
        employmentId: m.employmentId!,
        period,
        paymentDate,
        detail: { name: m.source.name, days: m.calc.days, ibcCents: m.calc.salaryCents, baseSalaryCents: Math.round(m.calc.baseSalaryCents), transportCents: m.calc.transportCents, area: m.area },
      })),
    };
  }

  async function exportExcel() {
    if (!summary) return null;
    setExportingSheets(true);
    try {
      const pesos = (c: number) => c / 100;
      const path = await saveExcelSheets(
        [
          {
            name: "Nómina",
            columns: ["Tipo doc.", "Documento", "Nombre", "Área", "Días", "Sueldo base", "Sueldo del mes", "Auxilio transporte", "Pensión", "EPS", "ARL", "CCF", ...(operator.cotizacionColumn ? ["Cotización"] : []), "Prima", "Cesantías", "Intereses cesantías", "Vacaciones"].map((header, i) => ({ header, kind: i < 4 ? ("text" as const) : i === 4 ? ("integer" as const) : ("money" as const) })),
            rows: months.map((m) => [m.docType, m.docNumber, m.employee?.name ?? m.source.name, m.area ? AREA_LABEL[m.area] : "", m.calc.days, pesos(m.calc.baseSalaryCents), pesos(m.calc.salaryCents), pesos(m.calc.transportCents), pesos(m.social.pension), pesos(m.social.health), pesos(m.social.arl), pesos(m.social.ccf), ...(operator.cotizacionColumn ? [pesos(socialOf(m))] : []), pesos(m.calc.primaCents), pesos(m.calc.cesantiasCents), pesos(m.calc.interesesCents), pesos(m.calc.vacacionesCents)]),
          },
        ],
        `${operator.exportPrefix}_${period}`,
      );
      if (path) toast("Excel exportado.");
      return path;
    } catch (e) {
      toast(errorMessage(e), "error");
      return null;
    } finally {
      setExportingSheets(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Estados Financieros · Nómina"
        title={operator.title}
        description={operator.description}
        actions={
          <>
            <Button icon={<CalendarX2 size={15} />} onClick={() => setEmptyOpen(true)}>
              Registrar periodo sin nómina
            </Button>
            <Button icon={<Contact size={15} />} onClick={() => navigate(paths.submodule("estados-financieros", "empleados"))}>
              Empleados
            </Button>
            <Button icon={<Settings2 size={15} />} onClick={() => setSettingsOpen(true)}>
              Cuentas PUC de nómina
            </Button>
          </>
        }
      />
      <StatementFileCard hideWhenDone state={state} details={summary && <span>· Periodo {summary.period} · Pago {formatDateForDisplay(summary.paymentDate)}</span>} picking={picking} busy={busy} exportedPath={exportedPath} onPick={() => void pick()} labels={operator.labels} />

      {summary && (
        <>
          {/* Cabecera compacta: empresa, periodo, fecha de pago, archivo, SMMLV, auxilio y tope. */}
          <ContextBar
            items={[
              { label: "Periodo", value: period ? periodLabel(period) : "—" },
              { label: "Fecha de pago", value: formatDateForDisplay(summary.paymentDate) },
              { label: "Archivo", value: state.status === "done" ? state.fileName : "—", selectable: true },
              { label: `SMMLV ${period.slice(0, 4)}`, value: yearWages ? formatExactCents(yearWages.smmlv * 100) : "—" },
              { label: "Auxilio", value: yearWages ? formatExactCents(yearWages.transport * 100) : "—" },
              { label: "Tope auxilio", value: yearWages ? formatExactCents(yearWages.smmlv * 200) : "—" },
            ]}
            actions={<StatementFileActions picking={picking} busy={busy} exportedPath={exportedPath} onPick={() => void pick()} label={operator.labels.pickAnother} />}
          >
            <div className="bank-head__fields">
              <CompanySelect companies={data.companies} value={companyId} onChange={setCompanyId} hint={summary?.employerNit ? `NIT del aportante en la planilla: ${summary.employerNit}` : undefined} />
              {company && summary?.employerNit && findCompanyByNit([company], summary.employerNit) === undefined && <Badge tone="warning">El NIT de la planilla no es el de esta empresa</Badge>}
            </div>
          </ContextBar>
          <SendToFs
            blocked={blocking[0] ?? null}
            blockedStatus={blockedStatus}
            reasons={blocking}
            build={buildBatch}
            onExport={exportExcel}
            exporting={exportingSheets}
            duplicateTitle="Esta planilla ya fue enviada."
            onSent={() => {
              void reloadPayroll();
              setSentKey((k) => k + 1);
            }}
          />
          <SourceCoverage companyId={companyId} source="payroll" year={Number(period.slice(0, 4))} refreshKey={sentKey} />
          <MetricBar
            label="Resumen de la planilla"
            metrics={[
              { key: "employees", label: months.length === 1 ? "empleado" : "empleados", value: formatInteger(months.length) },
              { key: "days", label: "días", value: formatInteger(totals.days) },
              { key: "salaries", label: "sueldos", value: formatExactCents(totals.salaries) },
              { key: "transport", label: "auxilio", value: formatExactCents(totals.transport) },
              { key: "social", label: operator.socialLabel.toLowerCase(), value: formatExactCents(totals.social) },
              { key: "benefits", label: "prestaciones", value: formatExactCents(totals.benefits) },
            ]}
          />

          {parafiscales.length > 0 && (
            <Alert tone="danger" title="Se detectaron aportes parafiscales.">
              Esta versión todavía no tiene definido su tratamiento contable. (
              {parafiscales
                .map((m) => {
                  const detail = Object.entries(m.source.parafiscales ?? {}).filter(([, v]) => v > 0).map(([k, v]) => `${k.toUpperCase()} ${formatInteger(v)}`).join(", ");
                  return `${m.source.name}${detail ? ` (${detail})` : ""}`;
                })
                .join("; ")}
              )
            </Alert>
          )}
          {!yearWages && (
            <Alert tone="danger" title={`Falta el SMMLV o el auxilio de transporte de ${period.slice(0, 4)}`}>
              <Button size="sm" onClick={() => navigate(paths.minimumWages)}>
                Ir a SMMLV por año
              </Button>
            </Alert>
          )}
          {summary.issues.length > 0 && (
            <Alert tone="danger" title={operator.issuesBlocking} items={summary.issues.map((i) => `${i.text}: ${i.reason}`)}>
              {operator.issuesHint}
            </Alert>
          )}
          {summary.warnings.length > 0 && <Alert tone="warning" title="Hay datos de la planilla que no se pudieron verificar" items={summary.warnings} />}
          {operatorOverlaps.map((o) => (
            <Alert key={o.employeeId} tone="danger" title="Empleado ya enviado desde otro operador">
              {o.name} ya fue enviado para {periodLabel(period)} desde {o.provider || "otro operador"} (lote #{o.batchId}, «{o.fileName}»). Una persona no se contabiliza dos veces en el mismo periodo: quítala de esta planilla o anula ese lote primero.
            </Alert>
          ))}
          {absences.map((a) => (
            <Alert key={a.employee.id} tone="danger" title="Posible retiro de empleado">
              {a.employee.name} ({a.employee.docType} {a.employee.docNumber}) estaba en la planilla de {periodLabel(a.lastSeen)} y no aparece en {periodLabel(period)}. No hay liquidación registrada.
              <div className="row" style={{ marginTop: 8 }}>
                <Button size="sm" variant="primary" onClick={() => setLiquidate({ employee: a.employee, lastPeriod: a.lastSeen })}>
                  Registrar liquidación
                </Button>
                <Button size="sm" onClick={() => setJustify(a.employee)}>
                  No se retiró / justificar ausencia
                </Button>
                <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEditing(a.employee)}>
                  Editar empleado
                </Button>
              </div>
            </Alert>
          ))}
          {missingKeys.length > 0 && (
            <Alert tone="warning" title="Faltan cuentas PUC de nómina">
              {missingKeys.length} cuentas requeridas para esta planilla no están configuradas.{" "}
              <Button size="sm" onClick={() => setSettingsOpen(true)}>
                Configurar
              </Button>
            </Alert>
          )}
          {renamed.length > 0 && <Alert tone="warning" title="Nombre distinto al de la ficha">{renamed.map((m) => `${m.docType} ${m.docNumber}: «${m.source.name}» (ficha: «${m.employee!.name}»)`).join(" · ")}</Alert>}

          <Card flush title={`Empleados · ${periodLabel(period)}`} description="Abre un empleado para ver su detalle (sueldo base, aportes y prestaciones por concepto). Sueldo base = IBC pensión × 30 / días.">
            <div className="toolbar row--between">
              <div className="row">
                <SegmentedFilter
                  label="Área"
                  options={[
                    { id: "all", label: "Todas" },
                    { id: "admin", label: "Administración" },
                    { id: "sales", label: "Ventas" },
                  ]}
                  value={areaFilter}
                  onChange={setAreaFilter}
                />
                <SegmentedFilter
                  label="Estado"
                  options={[
                    { id: "all", label: "Todos" },
                    { id: "pending", label: "Con pendientes" },
                    { id: "ready", label: "Listos" },
                  ]}
                  value={statusFilter}
                  onChange={setStatusFilter}
                />
              </div>
              <SearchBox placeholder="Empleado o documento" value={query} onChange={setQuery} />
            </div>
            <div className="table-wrap table-wrap--scroll" style={{ maxHeight: "60vh" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Área</th>
                    <th className="num">Días</th>
                    <th className="num">Sueldo del mes</th>
                    <th className="num">Auxilio</th>
                    <th className="num">{operator.socialLabel}</th>
                    <th className="num">Prestaciones</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMonths.length === 0 && (
                    <tr>
                      <td colSpan={8} className="muted" style={{ textAlign: "center", padding: "var(--space-5)" }}>
                        Ningún empleado coincide con el filtro.
                      </td>
                    </tr>
                  )}
                  {visibleMonths.map((m) => {
                    const issue = rowIssue(m);
                    return (
                      <tr key={`${m.docType}${m.docNumber}`} className={["is-clickable", issue && "row-attention--blocking"].filter(Boolean).join(" ")} onClick={() => setDetailKey(`${m.docType}${m.docNumber}`)}>
                        <td>
                          <span className="table__primary">{m.employee?.name ?? m.source.name}</span>
                          <div className="table__secondary">
                            {m.docType} {m.docNumber}
                            {m.employee && m.employmentId && m.employee.employments.length > 1 && ` · Vinculación #${m.employee.employments.find((j) => j.id === m.employmentId)?.number}`}
                          </div>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {m.area ? (
                            <button type="button" className="btn btn--ghost btn--sm" title="Cambiar área desde este periodo" onClick={() => setAreaChange(m.employee!)}>
                              {AREA_LABEL[m.area]}
                            </button>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="num">{formatInteger(m.calc.days)}</td>
                        <td className="num">{formatExactCents(m.calc.salaryCents)}</td>
                        <td className="num">{m.calc.transportApplies ? formatExactCents(m.calc.transportCents) : "No aplica"}</td>
                        <td className="num">{formatExactCents(socialOf(m))}</td>
                        <td className="num">{formatExactCents(benefitsOf(m))}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {!m.employee ? (
                            <Button size="sm" variant="primary" onClick={() => setCreating({ docType: m.docType, docNumber: m.docNumber, name: m.source.name, suggestedHireDate: suggestHire(m) })}>
                              Crear ficha
                            </Button>
                          ) : !m.employmentId ? (
                            <Button size="sm" variant="primary" onClick={() => setRehire(m.employee!)}>
                              Registrar reingreso
                            </Button>
                          ) : issue ? (
                            <Badge tone="warning">{issue}</Badge>
                          ) : (
                            <Badge tone="success">Listo</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          {lateInterestCents > 0 && <Alert tone="info">Intereses de mora de la planilla: {formatExactCents(lateInterestCents)} (cuenta global, sin área).</Alert>}
        </>
      )}

      {creating && companyId !== null && (
        <EmployeeFormModal
          open
          companyId={companyId}
          {...creating}
          period={period}
          onClose={() => setCreating(null)}
          onSaved={async () => {
            setCreating(null);
            await reloadPayroll();
          }}
        />
      )}
      <RehireModal
        employee={rehire}
        onClose={() => setRehire(null)}
        onSaved={async () => {
          setRehire(null);
          await reloadPayroll();
        }}
      />
      <LiquidationModal
        employee={liquidate?.employee ?? null}
        lastPeriod={liquidate?.lastPeriod ?? period}
        onClose={() => setLiquidate(null)}
        onSaved={async () => {
          setLiquidate(null);
          await reloadPayroll();
        }}
      />
      <JustifyAbsenceModal
        employee={justify}
        period={period}
        onClose={() => setJustify(null)}
        onSaved={async () => {
          setJustify(null);
          await reloadPayroll();
        }}
      />
      <EmployeeEditModal
        employee={editing}
        period={period}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await reloadPayroll();
        }}
      />
      <AreaChangeModal
        employee={areaChange}
        period={period}
        onClose={() => setAreaChange(null)}
        onSaved={async () => {
          setAreaChange(null);
          await reloadPayroll();
        }}
      />
      <Modal
        open={detail !== null}
        size="lg"
        title={detail ? (detail.employee?.name ?? detail.source.name) : ""}
        description={detail ? `${detail.docType} ${detail.docNumber} · ${detail.area ? AREA_LABEL[detail.area] : "Sin área"} · ${periodLabel(period)}` : undefined}
        onClose={() => setDetailKey(null)}
        footer={
          <>
            {detail?.employee && (
              <Button icon={<Pencil size={14} />} onClick={() => (setEditing(detail.employee!), setDetailKey(null))} style={{ marginRight: "auto" }}>
                Editar empleado
              </Button>
            )}
            <Button variant="primary" onClick={() => setDetailKey(null)}>
              Cerrar
            </Button>
          </>
        }
      >
        {detail && (
          <div className="stack">
            {(
              [
                { title: "Resumen del período", rows: [["Días", formatInteger(detail.calc.days)], ["Sueldo base", formatExactCents(detail.calc.baseSalaryCents)], ["Sueldo del mes", formatExactCents(detail.calc.salaryCents)]] },
                { title: "Devengados", rows: [["Auxilio de transporte", detail.calc.transportApplies ? formatExactCents(detail.calc.transportCents) : "No aplica"]] },
                { title: operator.socialLabel, total: socialOf(detail), rows: [["Pensión", formatExactCents(detail.social.pension)], ["EPS", formatExactCents(detail.social.health)], ["ARL", formatExactCents(detail.social.arl)], ["CCF", formatExactCents(detail.social.ccf)]] },
                { title: "Prestaciones sociales", total: benefitsOf(detail), rows: [["Prima", formatExactCents(detail.calc.primaCents)], ["Cesantías", formatExactCents(detail.calc.cesantiasCents)], ["Intereses de cesantías", formatExactCents(detail.calc.interesesCents)], ["Vacaciones", formatExactCents(detail.calc.vacacionesCents)]] },
              ] as { title: string; total?: number; rows: (readonly [string, string])[] }[]
            ).map((section) => (
              <section key={section.title} aria-label={section.title}>
                <h4 className="eyebrow" style={{ margin: "0 0 var(--space-2)" }}>
                  {section.title}
                </h4>
                <div className="table-wrap">
                  <table className="table table--dense">
                    <tbody>
                      {section.rows.map(([label, value]) => (
                        <tr key={label}>
                          <td>{label}</td>
                          <td className="num">{value}</td>
                        </tr>
                      ))}
                      {section.total !== undefined && (
                        <tr>
                          <td>
                            <strong>Subtotal</strong>
                          </td>
                          <td className="num">
                            <strong>{formatExactCents(section.total)}</strong>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}
      </Modal>
      <EmptyPeriodModal open={emptyOpen} source="payroll" companies={data.companies} companyId={companyId} defaultMonth={period || null} onClose={() => setEmptyOpen(false)} />
      <PucSettingsModal
        open={settingsOpen}
        title="Cuentas PUC de nómina"
        description="Globales para todas las empresas: gasto y cuenta por pagar por concepto y área. Los intereses de mora usan una sola cuenta."
        items={PAYROLL_ITEMS}
        index={data.index}
        settings={data.settingsMap}
        mappings={data.mappingMap}
        required={keys}
        onClose={() => setSettingsOpen(false)}
        onSaved={data.reloadSettings}
        onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])}
      />
    </>
  );
}
