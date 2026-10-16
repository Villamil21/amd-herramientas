import { Download, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { navigate, paths } from "../../../app/router";
import { Alert, Badge, Button, Card, EmptyState, Loader, PageHeader, useToast } from "../../../components/ui";
import { exogenaService } from "../../../services/exogenaService";
import { errorMessage } from "../../../services/tauri";
import type { FormatStatusRow } from "../../../types/exogena";
import { formatDateTimeForDisplay } from "../../../utils/dates";
import { formatMoneyCents } from "../../../utils/format";
import { ExogenaContextBar } from "../components/ExogenaContextBar";
import { StatusBadge } from "../components/StatusPanel";
import { buildExportWorkbook, exportBlockers, suggestedExportName } from "../domain/exportWorkbook";
import { IMPLEMENTED_FORMATS } from "../domain/formats";
import { blocking } from "../domain/problems";
import { useExogenaSelection } from "../state";
import { use1008 } from "../use1008";
import { use1009 } from "../use1009";
import { use1010 } from "../use1010";

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
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const company = b.company ?? a.company;
  const ready = !!company && !!a.model && !!b.model && !!c8.model;

  const statuses = useMemo<Record<string, FormatStatusRow>>(() => ({ "1010": a.format.status, "1009": b.format.status, "1008": c8.format.status }), [a.format.status, b.format.status, c8.format.status]);
  const blockers = useMemo(
    () =>
      ready
        ? exportBlockers({ statuses, problems: { "1010": a.model!.problems, "1009": b.model!.problems, "1008": c8.model!.problems }, reconciliation1009: b.model!.reconciliation })
        : [],
    [ready, statuses, a.model, b.model, c8.model],
  );

  async function exportAll() {
    if (!company || !a.format.records || !b.format.records || !c8.format.records) return;
    setExporting(true);
    try {
      const workbook = buildExportWorkbook({ company, year: selection.year, statuses, records: { "1010": a.format.records, "1009": b.format.records, "1008": c8.format.records } });
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
      return rec!.differenceCents === 0 ? <Badge tone="success">Conciliado</Badge> : <Badge tone="danger">Diferencia {formatMoneyCents(rec!.differenceCents)}</Badge>;
    if (code === "1008") {
      const r8 = c8.model!.reconciliation;
      return r8.difference === 0 && (c8.model!.deudores?.differenceCents ?? 0) === 0 && blocking(c8.model!.problems).length === 0 ? <Badge tone="success">Conciliado</Badge> : <Badge tone="danger">{r8.difference !== 0 ? `Diferencia ${formatMoneyCents(r8.difference * 100)}` : (c8.model!.deudores?.differenceCents ?? 0) !== 0 ? `Diferencia con Deudores ${formatMoneyCents(c8.model!.deudores!.differenceCents)}` : `${blocking(c8.model!.problems).length} pendientes`}</Badge>;
    }
    const stoppers = blocking(a.model!.problems);
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
          {c8.model && (
            <Card title="Conciliación del 1008" description={`CxC a socios (capital suscrito − pagado) frente al total del formato al 31/12/${selection.year}.`}>
              <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
                <span>
                  CxC a socios en Empresas: <strong>{c8.model.reconciliation.companyReceivable === null ? "—" : formatMoneyCents(c8.model.reconciliation.companyReceivable * 100)}</strong>
                </span>
                <span>
                  Total 1008: <strong>{formatMoneyCents(c8.model.reconciliation.total * 100)}</strong>
                </span>
                <span>
                  Diferencia: <strong>{formatMoneyCents(c8.model.reconciliation.difference * 100)}</strong>
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
                        <td className="num">{formatMoneyCents(row.eeffCents)}</td>
                        <td className="num">{formatMoneyCents(row.exogenaCents)}</td>
                        <td className="num">{row.differenceCents === 0 ? <span className="muted">—</span> : <span className="amount--negative">{formatMoneyCents(row.differenceCents)}</span>}</td>
                      </tr>
                    ))}
                    <tr className="fs-row--subtotal">
                      <td>
                        <strong>Total Deudores</strong>
                      </td>
                      <td className="num">{formatMoneyCents(c8.model.deudores.eeffCents)}</td>
                      <td className="num">{formatMoneyCents(c8.model.deudores.exogenaCents)}</td>
                      <td className="num">{c8.model.deudores.differenceCents === 0 ? <Badge tone="success">Conciliado</Badge> : <Badge tone="danger">{formatMoneyCents(c8.model.deudores.differenceCents)}</Badge>}</td>
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
                  Suma de registros 1009: <strong>{formatMoneyCents(rec!.recordsCents)}</strong>
                </span>
                <span>
                  Total pasivos ESF: <strong>{formatMoneyCents(rec!.liabilitiesCents)}</strong>
                </span>
                <span>
                  Diferencia: <strong>{formatMoneyCents(rec!.differenceCents)}</strong>
                </span>
              </div>
              {rec!.items.length > 0 && (
                <ul>
                  {rec!.items.map((i, k) => (
                    <li key={k}>
                      {i.label}: {formatMoneyCents(i.cents)}
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
