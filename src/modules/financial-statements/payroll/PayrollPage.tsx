import { useCallback, useEffect, useMemo, useState } from "react";
import { Settings2 } from "lucide-react";
import { navigate, paths } from "../../../app/router";
import { Alert, Badge, Button, Card, PageHeader, useToast } from "../../../components/ui";
import { saveExcelSheets } from "../../bank-analysis/shared/excelExportService";
import { StatementFileCard } from "../../bank-analysis/shared/components/StatementFileCard";
import type { PdfDocumentText } from "../../bank-analysis/shared/pdf/pdfTypes";
import { useStatementImport } from "../../bank-analysis/shared/useStatementImport";
import { analyzeAportesEnLinea } from "../../social-security/payroll-summary/aportes-en-linea/services/analysis";
import type { PayrollAnalysis } from "../../social-security/payroll-summary/shared/types";
import { fsService } from "../../../services/fsService";
import { minimumWageService } from "../../../services/minimumWageService";
import { errorMessage } from "../../../services/tauri";
import { AREA_LABEL, type BatchInput, type Employee, type MovementInput, type PayrollRow } from "../../../types/fs";
import type { MinimumWage } from "../../../types/models";
import { formatInteger } from "../../../utils/format";
import { findCompanyByNit, namesMatch } from "../shared/companyMatch";
import { CompanySelect } from "../shared/components/CompanySelect";
import { PucSettingsModal, type PucSettingItem } from "../shared/components/PucSettingsModal";
import { SendToFs } from "../shared/components/SendToFs";
import { formatExactCents, lastDayOfMonth, periodLabel, slashToIso } from "../shared/money";
import { useFsData } from "../shared/useFsData";
import { allPayrollKeys, areaFor, computeMonth, employeeKey, employeeMovements, findAbsences, KIND_LABEL, MORA_KEY, openEmployment, parseIdentification, requiredKeys, wagesFor, type EmployeeMonth } from "./calc";
import { AreaChangeModal, EmployeeFormModal, JustifyAbsenceModal, LiquidationModal, RehireModal } from "./PayrollModals";

const LABELS = { pick: "Seleccionar planilla PDF", pickAnother: "Seleccionar otra planilla", analyzing: "Analizando planilla…" };

interface Analysis extends PayrollAnalysis {
  /** NIT del aportante (DATOS GENERALES DEL APORTANTE), para identificar la empresa. */
  employerNit?: string;
}

function analyze(text: PdfDocumentText): Analysis {
  const nit = text.pages[0]?.items.map((i) => /^NIT\s+(\d{5,})/.exec(i.text.trim())).find(Boolean);
  return { ...analyzeAportesEnLinea(text), employerNit: nit?.[1] };
}

const PAYROLL_ITEMS: PucSettingItem[] = allPayrollKeys().map((k) => ({
  key: k.key,
  label: k.kind === "mora" ? KIND_LABEL.mora : `${KIND_LABEL[k.kind]} · ${k.side === "expense" ? "Gasto" : "Cuenta por pagar"}`,
  group: k.area ? AREA_LABEL[k.area] : "Global",
}));

/**
 * Estados Financieros → Nómina → Aportes en Línea. Usa el lector existente de
 * la planilla (sin modificar «Resumen de planilla») y causa por empleado:
 * salario, auxilio, seguridad social y prestaciones, con sus cuentas por pagar.
 */
export default function PayrollPage() {
  const toast = useToast();
  const data = useFsData();
  const [exportingSheets, setExportingSheets] = useState(false);
  const { state, picking, busy, exportedPath, pick } = useStatementImport<Analysis>({
    analyze,
    exportExcel: async () => null,
    fallbackError: "No fue posible analizar la planilla. Verifica que sea una planilla de Aportes en Línea en PDF.",
    logTag: "fs-nomina",
    pickTitle: "Seleccionar planilla PDF",
  });
  const summary = state.status === "done" ? state.analysis.summary : null;
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [wages, setWages] = useState<MinimumWage[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creating, setCreating] = useState<{ docType: string; docNumber: string; name: string } | null>(null);
  const [rehire, setRehire] = useState<Employee | null>(null);
  const [liquidate, setLiquidate] = useState<{ employee: Employee; lastPeriod: string } | null>(null);
  const [justify, setJustify] = useState<Employee | null>(null);
  const [areaChange, setAreaChange] = useState<Employee | null>(null);

  useEffect(() => {
    minimumWageService.list().then(setWages, (e) => toast(errorMessage(e), "error"));
  }, [toast]);

  // Empresa por el NIT del aportante (si está registrada).
  useEffect(() => {
    if (state.status !== "done" || !data.companies) return;
    const found = findCompanyByNit(data.companies, state.analysis.employerNit);
    setCompanyId(found?.id ?? null);
  }, [state, data.companies]);

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
  const paymentDate = summary ? slashToIso(summary.paymentDate) : undefined;
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
  const present = useMemo(() => new Set(months.map((m) => employeeKey(m.docType, m.docNumber))), [months]);
  const absences = useMemo(() => (period ? findAbsences(period, present, employees, rows) : []), [period, present, employees, rows]);
  const keys = useMemo(() => requiredKeys(months, lateInterestCents), [months, lateInterestCents]);
  const missingKeys = keys.filter((k) => !data.settingsMap.get(k));
  const parafiscales = months.filter((m) => m.parafiscalesCents > 0);
  const newEmployees = months.filter((m) => !m.employee);
  const rehires = months.filter((m) => m.employee && !m.employmentId);
  const noArea = months.filter((m) => m.employee && m.employmentId && !m.area);
  const renamed = months.filter((m) => m.employee && !namesMatch(m.employee.name, m.source.name));

  const blocking = [
    companyId === null && "Selecciona la empresa",
    summary && summary.issues.length > 0 && "Hay filas de la planilla sin interpretar",
    !paymentDate && "No se identificó la fecha de pago",
    parafiscales.length > 0 && "Se detectaron aportes parafiscales",
    !yearWages && `Falta el SMMLV o el auxilio de transporte de ${period.slice(0, 4)}`,
    newEmployees.length > 0 && `${newEmployees.length} empleados sin ficha`,
    rehires.length > 0 && `${rehires.length} reingresos sin registrar`,
    noArea.length > 0 && `${noArea.length} empleados sin área contable`,
    absences.length > 0 && `${absences.length} posibles retiros sin liquidación`,
    missingKeys.length > 0 && "Faltan cuentas PUC de nómina",
  ].filter(Boolean) as string[];

  function buildBatch(): BatchInput | null {
    if (!summary || companyId === null || !paymentDate) return null;
    const movements: MovementInput[] = months.flatMap((m) => employeeMovements(m, period, paymentDate, data.settingsMap));
    if (lateInterestCents) {
      movements.push({ accountingDate: paymentDate, conceptKey: "payroll.mora.expense", documentId: `planilla|${period}`, pucCode: data.settingsMap.get(MORA_KEY) ?? "", amountCents: lateInterestCents, description: `Intereses de mora planilla ${periodLabel(period)}` });
    }
    return {
      companyId,
      source: "payroll",
      fileName: state.status === "done" ? state.fileName : "",
      periodLabel: `Nómina ${periodLabel(period)}`,
      periodStart: `${period}-01`,
      periodEnd: lastDayOfMonth(period),
      dedupeKey: `payroll:${period}`,
      metadata: { provider: "Aportes en Línea", period, paymentDate, employees: months.length },
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
            columns: ["Tipo doc.", "Documento", "Nombre", "Área", "Días", "Sueldo base", "Sueldo del mes", "Auxilio transporte", "Pensión", "EPS", "ARL", "CCF", "Prima", "Cesantías", "Intereses cesantías", "Vacaciones"].map((header, i) => ({ header, kind: i < 4 ? ("text" as const) : i === 4 ? ("integer" as const) : ("money" as const) })),
            rows: months.map((m) => [m.docType, m.docNumber, m.employee?.name ?? m.source.name, m.area ? AREA_LABEL[m.area] : "", m.calc.days, pesos(m.calc.baseSalaryCents), pesos(m.calc.salaryCents), pesos(m.calc.transportCents), pesos(m.social.pension), pesos(m.social.health), pesos(m.social.arl), pesos(m.social.ccf), pesos(m.calc.primaCents), pesos(m.calc.cesantiasCents), pesos(m.calc.interesesCents), pesos(m.calc.vacacionesCents)]),
          },
        ],
        `Nomina_EEFF_${period}`,
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
        title="Aportes en Línea"
        description="Importa la planilla de seguridad social para causar salarios, auxilio, aportes y prestaciones por empleado y enviarlos a Estados Financieros."
        actions={
          <Button icon={<Settings2 size={15} />} onClick={() => setSettingsOpen(true)}>
            Cuentas PUC de nómina
          </Button>
        }
      />
      <StatementFileCard state={state} details={summary && <span>· Periodo {summary.period} · Pago {summary.paymentDate}</span>} picking={picking} busy={busy} exportedPath={exportedPath} onPick={() => void pick()} labels={LABELS} />

      {summary && (
        <>
          <Card>
            <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
              <CompanySelect companies={data.companies} value={companyId} onChange={setCompanyId} hint={state.status === "done" && state.analysis.employerNit ? `NIT del aportante en la planilla: ${state.analysis.employerNit}` : undefined} />
              {company && state.status === "done" && state.analysis.employerNit && findCompanyByNit([company], state.analysis.employerNit) === undefined && <Badge tone="warning">El NIT de la planilla no es el de esta empresa</Badge>}
              {yearWages && (
                <span className="muted">
                  SMMLV {period.slice(0, 4)}: {formatExactCents(yearWages.smmlv * 100)} · Auxilio de transporte: {formatExactCents(yearWages.transport * 100)} · Tope auxilio: {formatExactCents(yearWages.smmlv * 200)}
                </span>
              )}
            </div>
          </Card>

          {parafiscales.length > 0 && (
            <Alert tone="danger" title="Se detectaron aportes parafiscales.">
              Esta versión todavía no tiene definido su tratamiento contable. ({parafiscales.map((m) => m.source.name).join(", ")})
            </Alert>
          )}
          {!yearWages && (
            <Alert tone="danger" title={`Falta el SMMLV o el auxilio de transporte de ${period.slice(0, 4)}`}>
              <Button size="sm" onClick={() => navigate(paths.minimumWages)}>
                Ir a SMMLV por año
              </Button>
            </Alert>
          )}
          {summary.issues.length > 0 && <Alert tone="danger" title="Hay filas de la planilla sin interpretar">Revisa la planilla en Seguridad social → Resumen de planilla.</Alert>}
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

          <Card flush title={`Empleados · ${periodLabel(period)}`} description="Sueldo base = IBC pensión × 30 / días. Salario y auxilio se consideran pagados en el mes; seguridad social se paga en la fecha de pago de la planilla.">
            <div className="table-wrap table-wrap--scroll" style={{ maxHeight: "60vh" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Área</th>
                    <th style={{ textAlign: "right" }}>Días</th>
                    <th style={{ textAlign: "right" }}>Sueldo base</th>
                    <th style={{ textAlign: "right" }}>Sueldo del mes</th>
                    <th style={{ textAlign: "right" }}>Auxilio</th>
                    <th style={{ textAlign: "right" }}>Pensión</th>
                    <th style={{ textAlign: "right" }}>EPS</th>
                    <th style={{ textAlign: "right" }}>ARL</th>
                    <th style={{ textAlign: "right" }}>CCF</th>
                    <th style={{ textAlign: "right" }}>Prima</th>
                    <th style={{ textAlign: "right" }}>Cesantías</th>
                    <th style={{ textAlign: "right" }}>Intereses</th>
                    <th style={{ textAlign: "right" }}>Vacaciones</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={`${m.docType}${m.docNumber}`} className={!m.employee || !m.employmentId ? "row-attention--blocking" : undefined}>
                      <td>
                        <span className="table__primary">{m.employee?.name ?? m.source.name}</span>
                        <div className="table__secondary">
                          {m.docType} {m.docNumber}
                          {m.employee && m.employmentId && m.employee.employments.length > 1 && ` · Vinculación #${m.employee.employments.find((j) => j.id === m.employmentId)?.number}`}
                        </div>
                        {!m.employee && (
                          <Button size="sm" variant="primary" onClick={() => setCreating({ docType: m.docType, docNumber: m.docNumber, name: m.source.name })}>
                            Crear ficha
                          </Button>
                        )}
                        {m.employee && !m.employmentId && (
                          <Button size="sm" variant="primary" onClick={() => setRehire(m.employee!)}>
                            Registrar reingreso
                          </Button>
                        )}
                      </td>
                      <td>
                        {m.area ? (
                          <button type="button" className="btn btn--ghost btn--sm" title="Cambiar área desde este periodo" onClick={() => setAreaChange(m.employee!)}>
                            {AREA_LABEL[m.area]}
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>{formatInteger(m.calc.days)}</td>
                      <td style={{ textAlign: "right" }}>{formatExactCents(m.calc.baseSalaryCents)}</td>
                      <td style={{ textAlign: "right" }}>{formatExactCents(m.calc.salaryCents)}</td>
                      <td style={{ textAlign: "right" }}>{m.calc.transportApplies ? formatExactCents(m.calc.transportCents) : "No aplica"}</td>
                      {[m.social.pension, m.social.health, m.social.arl, m.social.ccf, m.calc.primaCents, m.calc.cesantiasCents, m.calc.interesesCents, m.calc.vacacionesCents].map((v, i) => (
                        <td key={i} style={{ textAlign: "right" }}>
                          {formatExactCents(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {lateInterestCents > 0 && <Alert tone="info">Intereses de mora de la planilla: {formatExactCents(lateInterestCents)} (cuenta global, sin área).</Alert>}

          <Card title="Estados Financieros">
            <SendToFs blocked={blocking[0] ?? null} build={buildBatch} onExport={exportExcel} exporting={exportingSheets} duplicateTitle="Esta planilla ya fue enviada." onSent={() => void reloadPayroll()} />
            {blocking.length > 1 && <div className="field__hint" style={{ marginTop: 8 }}>Pendientes: {blocking.join(" · ")}.</div>}
          </Card>
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
      <RehireModal employee={rehire} onClose={() => setRehire(null)} onSaved={async () => { setRehire(null); await reloadPayroll(); }} />
      <LiquidationModal employee={liquidate?.employee ?? null} lastPeriod={liquidate?.lastPeriod ?? period} onClose={() => setLiquidate(null)} onSaved={async () => { setLiquidate(null); await reloadPayroll(); }} />
      <JustifyAbsenceModal employee={justify} period={period} onClose={() => setJustify(null)} onSaved={async () => { setJustify(null); await reloadPayroll(); }} />
      <AreaChangeModal employee={areaChange} period={period} onClose={() => setAreaChange(null)} onSaved={async () => { setAreaChange(null); await reloadPayroll(); }} />
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
