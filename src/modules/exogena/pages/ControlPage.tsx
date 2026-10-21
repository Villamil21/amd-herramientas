import { Download, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { navigate, paths } from "../../../app/router";
import { Alert, Badge, Button, Card, EmptyState, Loader, PageHeader, useToast } from "../../../components/ui";
import { exogenaService } from "../../../services/exogenaService";
import { errorMessage } from "../../../services/tauri";
import type { FormatStatusRow } from "../../../types/exogena";
import { formatDateTimeForDisplay } from "../../../utils/dates";
import { formatExoCents } from "../domain/numbers";
import { ExogenaContextBar } from "../components/ExogenaContextBar";
import { StatusBadge } from "../components/StatusPanel";
import { Einvoice1007Bases, EinvoiceSalesReconciliation } from "../components/EinvoiceSalesCards";
import { buildExportWorkbook, exportBlockers, suggestedExportName } from "../domain/exportWorkbook";
import { IMPLEMENTED_FORMATS } from "../domain/formats";
import { blocking } from "../domain/problems";
import { useExogenaSelection } from "../state";
import { use1008 } from "../use1008";
import { use1009 } from "../use1009";
import { use1010 } from "../use1010";
import { useCryptoFormat } from "../useCryptoFormat";
import { usePurchasesExo } from "../usePurchasesFormat";
import { useBankFormat } from "../useBankFormat";
import { navigate as go } from "../../../app/router";
import { reopenReadyBankFormats } from "../../financial-statements/bank/exogena/load";
import { bankExoPath } from "../../financial-statements/bank/exogena/paths";
import { BankExoStatusCard } from "../../financial-statements/bank/exogena/ui/BankExoAlerts";
import { BANK_EXO_FORMATS } from "../../financial-statements/bank/exogena/model";
import { COVERAGE_TEXT } from "../../financial-statements/bank/exogena/ui/coverageText";
import { payrollFormatState } from "../domain/payrollFormat";
import { useFormatRecords } from "../hooks";

const MODULE_ID = "informacion-exogena";

/**
 * Control y exportación: auditoría compacta de los formatos de la fase (estado, registros, última sincronización,
 * diferencias y justificación de «No aplica») y exportación de todo en un único Excel.
 */
export default function ControlPage() {
  const toast = useToast();
  const [selection] = useExogenaSelection();
  const a = use1010(selection.companyId, selection.year);
  const b = use1009(selection.companyId, selection.year);
  const c8 = use1008(selection.companyId, selection.year);
  const c7 = useCryptoFormat(selection.companyId, selection.year, "1007");
  const c47 = useCryptoFormat(selection.companyId, selection.year, "1647");
  // Extractos bancarios: 1012 propio y aportes al 1007 (intereses) y al 1011 (GMF).
  const bk = useBankFormat(selection.companyId, selection.year, "1012");
  const px = usePurchasesExo(selection.companyId, selection.year);
  // 1011 y 2276 salen de Nómina y seguridad social: el cálculo viene de la misma lectura que usa el 1001.
  const r1011 = useFormatRecords(selection.companyId, selection.year, "1011");
  const r2276 = useFormatRecords(selection.companyId, selection.year, "2276");
  const s1011 = useMemo(() => (px.payroll && r1011.records ? payrollFormatState("1011", px.payroll.f1011.proposals, px.payroll.alerts, r1011.records, bk.bank.contribution) : null), [px.payroll, r1011.records, bk.bank.contribution]);
  const s2276 = useMemo(() => (px.payroll && r2276.records ? payrollFormatState("2276", px.payroll.f2276.proposals, px.payroll.alerts, r2276.records) : null), [px.payroll, r2276.records]);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const company = b.company ?? a.company;
  const ready = !!company && !!a.model && !!b.model && !!c8.model && c7.ready && c47.ready && px.ready && !!s1011 && !!s2276 && bk.ready;

  const statuses = useMemo<Record<string, FormatStatusRow>>(() => ({ "1010": a.format.status, "1009": b.format.status, "1008": c8.format.status, "1007": c7.format.status, "1647": c47.format.status, "1001": px.formats["1001"].status, "1005": px.formats["1005"].status, "1006": px.formats["1006"].status, "1011": r1011.status, "1012": bk.format.status, "2276": r2276.status }), [a.format.status, b.format.status, c8.format.status, c7.format.status, c47.format.status, px.formats, r1011.status, r2276.status, bk.format.status]);
  const blockers = useMemo(
    () =>
      ready
        ? exportBlockers({ statuses, problems: { "1010": a.model!.problems, "1009": b.model!.problems, "1008": c8.model!.problems, "1007": c7.computed!.problems, "1647": c47.computed!.problems, "1001": px.computed!["1001"].problems, "1005": px.computed!["1005"].problems, "1006": px.computed!["1006"].problems, "1011": s1011!.problems, "1012": bk.state!.problems, "2276": s2276!.problems }, reconciliation1009: b.model!.reconciliation })
        : [],
    [ready, statuses, a.model, b.model, c8.model, c7.computed, c47.computed, px.computed, s1011, s2276, bk.state],
  );

  async function exportAll() {
    if (!company || !a.format.records || !b.format.records || !c8.format.records || !c7.format.records || !c47.format.records || !px.formats["1001"].records || !px.formats["1005"].records || !px.formats["1006"].records || !r1011.records || !r2276.records || !bk.format.records) return;
    setExporting(true);
    try {
      const workbook = buildExportWorkbook({ company, year: selection.year, statuses, records: { "1010": a.format.records, "1009": b.format.records, "1008": c8.format.records, "1007": c7.format.records, "1647": c47.format.records, "1001": px.formats["1001"].records, "1005": px.formats["1005"].records, "1006": px.formats["1006"].records, "1011": r1011.records, "1012": bk.format.records, "2276": r2276.records } });
      const path = await exogenaService.saveWorkbook(company.id, workbook, suggestedExportName(company, selection.year));
      if (path) {
        setExported(path);
        toast("Excel de Información Exógena exportado.");
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setExporting(false);
    }
  }

  const rec = b.model?.reconciliation;
  const differences = (code: string): React.ReactNode => {
    if (!ready) return "—";
    if (code === "1009")
      return rec!.differenceCents === 0 ? <Badge tone="success">Conciliado</Badge> : <Badge tone="danger">Diferencia {formatExoCents(rec!.differenceCents)}</Badge>;
    if (code === "1008") {
      const r8 = c8.model!.reconciliation;
      return r8.difference === 0 && (c8.model!.deudores?.differenceCents ?? 0) === 0 && blocking(c8.model!.problems).length === 0 ? <Badge tone="success">Conciliado</Badge> : <Badge tone="danger">{r8.difference !== 0 ? `Diferencia ${formatExoCents(r8.difference * 100)}` : (c8.model!.deudores?.differenceCents ?? 0) !== 0 ? `Diferencia con Deudores ${formatExoCents(c8.model!.deudores!.differenceCents)}` : `${blocking(c8.model!.problems).length} pendientes`}</Badge>;
    }
    if (code === "1001" || code === "1005" || code === "1006") {
      const st = px.computed![code];
      if (st.notApplicableReason) return <Badge>No aplica</Badge>;
      const n = blocking(st.problems).length;
      const iva = px.model!.reconciliation;
      if (n === 0 && iva.applicable && iva.differenceCents !== 0) return <Badge tone="danger">IVA compras: diferencia {formatExoCents(iva.differenceCents)}</Badge>;
      const sr = px.sales.contribution?.reconciliation;
      if (n === 0 && sr && code !== "1001") {
        const d = code === "1006" ? sr.invoiceIvaCents - sr.generatedCents : sr.creditNoteIvaCents - sr.salesReturnsCents;
        if (d !== 0) return <Badge tone="danger">IVA ventas: diferencia {formatExoCents(d)}</Badge>;
      }
      return n === 0 ? <Badge tone="success">Sin pendientes</Badge> : <Badge tone="danger">{n} pendientes</Badge>;
    }
    if (code === "1011" || code === "2276" || code === "1012") {
      const n = blocking((code === "1011" ? s1011 : code === "1012" ? bk.state : s2276)!.problems).length;
      return n === 0 ? <Badge tone="success">Sin pendientes</Badge> : <Badge tone="danger">{n} pendientes</Badge>;
    }
    const own = code === "1007" ? c7.computed!.problems : code === "1647" ? c47.computed!.problems : a.model!.problems;
    const stoppers = blocking(own);
    return stoppers.length === 0 ? <Badge tone="success">Sin pendientes</Badge> : <Badge tone="danger">{stoppers.length} pendientes</Badge>;
  };

  return (
    <>
      <PageHeader
        eyebrow={`Información Exógena · ${selection.year}`}
        title="Control y exportación"
        description="Estado de los formatos de esta fase para la empresa y el año seleccionados. Se exporta un único Excel con los formatos listos."
        actions={
          <Button variant="primary" icon={<Download size={15} />} loading={exporting} disabled={!ready || blockers.length > 0} onClick={() => void exportAll()}>
            Exportar Excel
          </Button>
        }
      />
      <ExogenaContextBar companies={b.companies} />
      {!selection.companyId || (b.companies && !company) ? (
        <Card>
          <EmptyState icon={<ShieldCheck size={20} />} title="Selecciona una empresa" description="Elige la empresa y el año para auditar sus formatos." />
        </Card>
      ) : !ready ? (
        <Loader />
      ) : (
        <>
          {blockers.length > 0 ? (
            <Alert tone="danger" title="No se puede exportar todavía" items={blockers.map((x) => x.message)}>
              Resuelve estos puntos en cada formato; «Exportar Excel» se habilita cuando todos estén listos o marcados «No aplica».
            </Alert>
          ) : (
            <Alert tone="success" title="Todo listo para exportar">
              Los formatos aplicables están listos y conciliados.
            </Alert>
          )}
          {exported && (
            <Alert tone="info" title="Archivo guardado">
              {exported}
            </Alert>
          )}
          <Card flush title="Auditoría de formatos">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Formato</th>
                    <th>Estado</th>
                    <th className="num">Registros</th>
                    <th>Última sincronización</th>
                    <th>Diferencias</th>
                    <th>Justificación «No aplica»</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {IMPLEMENTED_FORMATS.map((f) => {
                    const row = statuses[f.code];
                    return (
                      <tr key={f.code}>
                        <td className="table__primary">
                          {f.code}
                          <div className="muted">{f.name}</div>
                        </td>
                        <td>
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="num">{row.recordCount}</td>
                        <td>{row.lastSyncedAt ? formatDateTimeForDisplay(row.lastSyncedAt) : <span className="muted">Sin sincronizar</span>}</td>
                        <td>{differences(f.code)}</td>
                        <td>{row.status === "no_aplica" ? row.notApplicableReason : <span className="muted">—</span>}</td>
                        <td className="actions">
                          <Button size="sm" onClick={() => navigate(paths.submodule(MODULE_ID, f.code))}>
                            Abrir
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          {bk.bank.contribution && company && (
            <>
              <BankExoStatusCard
                result={bk.bank.contribution.result}
                companyId={company.id}
                title="Extractos bancarios: pendientes de 1012, 1007 y 1011"
                onChanged={async () => {
                  await bk.bank.reload();
                  void reopenReadyBankFormats(company.id, [selection.year]).catch(() => undefined);
                }}
              />
              <Card flush title="Cobertura de extractos por banco" description={`Año ${selection.year}. Cada banco con su ficha para Exógena y los formatos que algún pendiente suyo bloquea.`}>
                <div className="table-wrap">
                  <table className="table table--dense">
                    <thead>
                      <tr>
                        <th>Banco</th>
                        <th>Ficha</th>
                        <th>Cobertura</th>
                        <th>Formatos bloqueados</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {bk.bank.contribution.result.banks.length === 0 && (
                        <tr>
                          <td colSpan={5} className="muted" style={{ textAlign: "center" }}>
                            Sin extractos bancarios con periodo en {selection.year}.
                          </td>
                        </tr>
                      )}
                      {bk.bank.contribution.result.banks.map((b) => (
                        <tr key={b.bankKey}>
                          <td className="table__primary">{b.bank}</td>
                          <td>{b.profile ? `NIT ${b.profile.nit}-${b.profile.dv}` : <Badge tone="danger">Sin ficha</Badge>}</td>
                          <td>
                            <Badge tone={COVERAGE_TEXT[b.coverage].tone}>{COVERAGE_TEXT[b.coverage].text}</Badge> <span className="muted">{b.loadedMonths}/{b.expectedMonths} meses</span>
                          </td>
                          <td>{b.blocks.length === 0 ? <Badge tone="success">Ninguno</Badge> : BANK_EXO_FORMATS.filter((f) => b.blocks.includes(f)).map((f) => <Badge key={f} tone="danger">{f}</Badge>)}</td>
                          <td className="actions">
                            <Button size="sm" onClick={() => go(bankExoPath({ kind: "bank", companyId: company.id, year: selection.year, bank: b.bank }))}>
                              Abrir banco
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
          {c7.sales.contribution && <Einvoice1007Bases sales={c7.sales.contribution} />}
          {px.sales.contribution && <EinvoiceSalesReconciliation sales={px.sales.contribution} />}
          {c8.model && (
            <Card title="Conciliación del 1008" description={`CxC a socios (capital suscrito − pagado) frente al total del formato al 31/12/${selection.year}.`}>
              <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
                <span>
                  CxC a socios en Empresas: <strong>{c8.model.reconciliation.companyReceivable === null ? "—" : formatExoCents(c8.model.reconciliation.companyReceivable * 100)}</strong>
                </span>
                <span>
                  Total 1008: <strong>{formatExoCents(c8.model.reconciliation.total * 100)}</strong>
                </span>
                <span>
                  Diferencia: <strong>{formatExoCents(c8.model.reconciliation.difference * 100)}</strong>
                </span>
              </div>
            </Card>
          )}
          {c8.model?.deudores && (
            <Card flush title="Conciliación de Deudores (ESF) con el 1008" description={`Deudores corrientes + no corrientes del Estado de Situación Financiera frente al total del formato al 31/12/${selection.year}.`}>
              <div className="table-wrap">
                <table className="table table--dense">
                  <thead>
                    <tr>
                      <th>Fuente</th>
                      <th className="num">ESF</th>
                      <th className="num">1008</th>
                      <th className="num">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c8.model.deudores.rows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td className="num">{formatExoCents(row.eeffCents)}</td>
                        <td className="num">{formatExoCents(row.exogenaCents)}</td>
                        <td className="num">{row.differenceCents === 0 ? <span className="muted">—</span> : <span className="amount--negative">{formatExoCents(row.differenceCents)}</span>}</td>
                      </tr>
                    ))}
                    <tr className="fs-row--subtotal">
                      <td>
                        <strong>Total Deudores</strong>
                      </td>
                      <td className="num">{formatExoCents(c8.model.deudores.eeffCents)}</td>
                      <td className="num">{formatExoCents(c8.model.deudores.exogenaCents)}</td>
                      <td className="num">{c8.model.deudores.differenceCents === 0 ? <Badge tone="success">Conciliado</Badge> : <Badge tone="danger">{formatExoCents(c8.model.deudores.differenceCents)}</Badge>}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {b.model && (
            <Card title="Conciliación del 1009" description={`Pasivos del Estado de Situación Financiera al 31/12/${selection.year}.`}>
              <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
                <span>
                  Suma de registros 1009: <strong>{formatExoCents(rec!.recordsCents)}</strong>
                </span>
                <span>
                  Total pasivos ESF: <strong>{formatExoCents(rec!.liabilitiesCents)}</strong>
                </span>
                <span>
                  Diferencia: <strong>{formatExoCents(rec!.differenceCents)}</strong>
                </span>
              </div>
              {rec!.items.length > 0 && (
                <ul>
                  {rec!.items.map((i, k) => (
                    <li key={k}>
                      {i.label}: {formatExoCents(i.cents)}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </>
      )}
    </>
  );
}
