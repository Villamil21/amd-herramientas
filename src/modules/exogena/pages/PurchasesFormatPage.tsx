import { AlertTriangle, CheckCircle2, CircleDot, FileDown, MinusCircle, Receipt, RefreshCcw, ShoppingBag, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { navigate } from "../../../app/router";
import { Alert, Badge, Button, Card, EmptyState, Loader, PageHeader, useToast } from "../../../components/ui";
import { exogenaService } from "../../../services/exogenaService";
import { fileService } from "../../../services/fileService";
import { errorMessage } from "../../../services/tauri";
import { FORMAT_STATUS_LABEL } from "../../../types/exogena";
import { formatExoCents } from "../domain/numbers";
import { DEST_LABEL, STATUS_LABEL, STATUS_TONE, type Dest, type DestStatus } from "../../financial-statements/purchases/domain/status";
import { EinvoiceAuditPanel } from "../components/EinvoiceAuditPanel";
import { EinvoiceCustomersPanel } from "../components/EinvoiceCustomersPanel";
import { EinvoiceSalesReconciliation } from "../components/EinvoiceSalesCards";
import { ExogenaContextBar } from "../components/ExogenaContextBar";
import { ProblemsPanel } from "../components/ProblemsPanel";
import { StatusPanel } from "../components/StatusPanel";
import { auditFileName, buildPurchasesAudit } from "../domain/purchasesAudit";
import { renderPurchasesAuditPdf } from "../domain/purchasesAuditPdf";
import { PURCHASES_EXO_SOURCE, PURCHASES_PATH, shouldReopenPurchases, type PurchasesExoFormat } from "../domain/purchasesFormat";
import { findFormat } from "../domain/formats";
import { EINVOICE_PATH } from "../domain/einvoiceSales";
import { useCatalogs } from "../hooks";
import { useExogenaSelection } from "../state";
import { usePurchasesFormat } from "../usePurchasesFormat";

const DESCRIPTION: Record<PurchasesExoFormat, string> = {
  "1001": "Pagos o abonos en cuenta por tercero y concepto, con IVA como mayor valor del costo o gasto y retenciones practicadas o asumidas, desde Compras, costos y exógena, más los aportes a entidades de seguridad social de Nómina (por entidad y concepto).",
  "1005": "IVA descontable por tercero de las compras (Compras, costos y exógena) e IVA resultante por devoluciones en ventas (notas crédito de Facturación electrónica). Solo aplica si la empresa era responsable de IVA (responsabilidad 48).",
  "1006": "IVA recuperado en devoluciones de compras (Compras, costos y exógena) e IVA generado por facturas de venta (Facturación electrónica), por tercero. Solo aplica si la empresa era responsable de IVA (responsabilidad 48).",
};

const STATUS_ICON: Record<DestStatus, typeof XCircle> = { block: XCircle, pending: CircleDot, review: AlertTriangle, ready: CheckCircle2, na: MinusCircle };

/**
 * Pantalla de 1001 / 1005 / 1006. Los registros salen de Estados Financieros → Compras, costos y exógena (solo lectura); los
 * pendientes se resuelven allá y aquí se actualiza el formato. Nunca queda «listo» con pendientes o desactualizado.
 */
export default function PurchasesFormatPage({ code }: { code: PurchasesExoFormat }) {
  const toast = useToast();
  const [selection] = useExogenaSelection();
  const m = usePurchasesFormat(selection.companyId, selection.year, code);
  const def = findFormat(code)!;
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { format, state, model } = m;
  const { catalogs } = useCatalogs();
  const sales = code === "1005" || code === "1006" ? m.sales.contribution : null;

  // Un formato «listo» deja de estarlo si cambió su origen: se reabre, nunca se reescribe en silencio.
  useEffect(() => {
    if (state && shouldReopenPurchases(format.status.status, state.problems)) void format.setStatus("requiere_actualizacion");
  }, [format, state]);

  async function sync(overwrite: string[] = []) {
    if (!m.company || !state || !model) return;
    setSyncing(true);
    try {
      const outcome = await exogenaService.applySync({
        companyId: m.company.id,
        year: selection.year,
        formatCode: code,
        source: PURCHASES_EXO_SOURCE,
        proposals: state.proposals,
        removeMissing: true,
        overwriteManual: overwrite,
        summary: { sources: code === "1001" ? ["Compras, costos y exógena", "Nómina y seguridad social"] : ["Compras, costos y exógena", "Facturación electrónica"], documents: model.totals.documents, lines: model.totals.lines },
      });
      await Promise.all([format.reload(), m.sales.reload()]);
      toast(`${outcome.created} nuevos · ${outcome.updated} actualizados · ${outcome.unchanged} sin cambios · ${outcome.removed} retirados.`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSyncing(false);
    }
  }

  async function exportAudit() {
    if (!m.company || !state || !model || !format.records) return;
    setExporting(true);
    try {
      const audit = buildPurchasesAudit({ model, format: code, state, records: format.records, company: m.company, year: selection.year, statusLabel: FORMAT_STATUS_LABEL[format.status.status], sales: m.sales.contribution });
      const { bytes } = await renderPurchasesAuditPdf(audit);
      const path = await fileService.savePdf(bytes, auditFileName(m.company.razonSocial, code, selection.year));
      if (path) toast("Auditoría PDF guardada.");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setExporting(false);
    }
  }

  const records = format.records;
  const dest = code as Dest;
  const status = model?.status[dest];
  const counts = model?.counts[dest];
  const Icon = status ? STATUS_ICON[status] : CircleDot;
  const rec = model?.reconciliation;

  return (
    <>
      <PageHeader
        eyebrow={`Información Exógena · ${selection.year}`}
        title={`${code} · ${def.name}`}
        description={DESCRIPTION[code]}
        actions={
          <>
            <Button icon={<ShoppingBag size={15} />} onClick={() => navigate(PURCHASES_PATH)}>
              Abrir Compras, costos y exógena
            </Button>
            {code !== "1001" && (
              <Button icon={<Receipt size={15} />} onClick={() => navigate(EINVOICE_PATH)}>
                Abrir Facturación electrónica
              </Button>
            )}
            <Button icon={<FileDown size={15} />} loading={exporting} disabled={!m.ready} onClick={() => void exportAudit()}>
              Auditoría PDF
            </Button>
            <Button variant="primary" icon={<RefreshCcw size={15} />} loading={syncing} disabled={!m.ready || !!state?.notApplicableReason} onClick={() => void sync()}>
              {code === "1001" ? "Actualizar desde Compras y Nómina" : "Actualizar desde Compras y Ventas"}
            </Button>
          </>
        }
      />
      <ExogenaContextBar companies={m.companies} />
      {!selection.companyId || (m.companies && !m.company) ? (
        <Card>
          <EmptyState icon={<ShoppingBag size={20} />} title="Selecciona una empresa" description={`Elige la empresa y el año a informar para preparar el formato ${code}.`} />
        </Card>
      ) : !m.ready || !state || !records || !model ? (
        <Loader />
      ) : (
        <>
          {status && counts && (
            <Card>
              <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Icon size={18} aria-hidden />
                <strong>{DEST_LABEL[dest]}</strong>
                <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                <span className="muted">
                  {status === "na" ? "Sin pendientes: no aplica" : `${counts.block} bloquean · ${counts.pending} por confirmar · ${counts.review} por revisar`}
                </span>
              </div>
            </Card>
          )}
          {state.notApplicableReason && (
            <Alert tone="info" title={`${code} no aplica`}>
              {state.notApplicableReason} Márcalo «No aplica» con esa justificación.
            </Alert>
          )}
          <StatusPanel row={format.status} problems={state.problems} onSetStatus={format.setStatus} />
          {state.changes.length > 0 && (
            <Alert tone="warning" title="Hay cambios sin sincronizar">
              {code === "1001" ? "Compras cambió desde la última sincronización. Usa «Actualizar desde Compras»." : "Compras o Facturación electrónica cambió desde la última sincronización. Usa «Actualizar»."}
            </Alert>
          )}
          {rec?.applicable && (
            <Card title="Conciliación del IVA de compras" description="IVA descontable de compras 1005 − IVA recuperado por devoluciones de compras 1006 = IVA mayor valor deducible 1001. No incluye ventas.">
              <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
                <span>
                  1005: <strong>{formatExoCents(rec.discountableCents)}</strong>
                </span>
                <span>
                  1006: <strong>{formatExoCents(rec.recoveredCents)}</strong>
                </span>
                <span>
                  1001: <strong>{formatExoCents(rec.vat1001Cents)}</strong>
                </span>
                {rec.differenceCents === 0 ? <Badge tone="success">Conciliado</Badge> : <Badge tone="danger">Diferencia {formatExoCents(rec.differenceCents)}</Badge>}
              </div>
            </Card>
          )}
          {sales && !state.notApplicableReason && <EinvoiceSalesReconciliation sales={sales} />}
          <ProblemsPanel problems={state.problems} okText={`Sin pendientes: el ${code} se puede marcar como listo.`} />
          {sales && m.company && !state.notApplicableReason && <EinvoiceCustomersPanel companyId={m.company.id} year={selection.year} pending={sales.pendingCustomers.filter((c) => c.formats.includes(code as "1005" | "1006"))} catalogs={catalogs} onChanged={m.sales.reload} />}
          <Card flush title={`Registros (${records.length})`}>
            {records.length === 0 ? (
              <EmptyState icon={<ShoppingBag size={20} />} title="Aún no hay registros" description="Actualiza desde Compras, o marca el formato «No aplica» con su justificación." />
            ) : (
              <div className="table-wrap">
                <table className="table table--dense">
                  <thead>
                    <tr>
                      {def.columns!.map((c) => (
                        <th key={c.key} className={c.kind === "integer" ? "num" : undefined}>
                          {c.header}
                        </th>
                      ))}
                      <th>Origen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id}>
                        {def.columns!.map((c) => (
                          <td key={c.key} className={c.kind === "integer" ? "num" : undefined}>
                            {String(r.data[c.key] ?? "")}
                          </td>
                        ))}
                        <td className="muted">
                          {r.originRef}
                          {r.manualFields.length > 0 && <Badge tone="warning">Corregido</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {sales && !state.notApplicableReason && <EinvoiceAuditPanel format={code as "1005" | "1006"} sales={sales} />}
        </>
      )}
    </>
  );
}
