import { useMemo, useState } from "react";
import { Badge, Modal } from "../../../../components/ui";
import { formatDateTimeForDisplay } from "../../../../utils/dates";
import { formatInteger } from "../../../../utils/format";
import { formatExactCents } from "../../shared/money";
import type { CryptoModel } from "../domain/model";
import type { Operation } from "../domain/operations";
import type { CryptoState, CryptoUpload } from "../domain/types";

const STATUS_LABEL = { accepted: "Aceptada", pending: "Pendiente", excluded: "Excluida" } as const;
const STATUS_TONE = { accepted: "success", pending: "warning", excluded: "dark" } as const;

export const operationName = (o: Operation) => o.names.businessName || [o.names.firstSurname, o.names.secondSurname, o.names.firstName, o.names.otherNames].filter(Boolean).join(" ") || "—";

interface Props {
  upload: CryptoUpload | null;
  model: CryptoModel;
  state: CryptoState;
  onClose: () => void;
}

/** Detalle de una carga: versiones, cobertura y cada fila con su estado y el motivo (trazabilidad hasta la fila de Excel). */
export function UploadDetailModal({ upload, model, state, onClose }: Props) {
  const [kind, setKind] = useState<"purchase" | "sale">("purchase");
  const ops = useMemo(() => (upload ? model.operations.filter((o) => o.uploadId === upload.id && o.kind === kind) : []), [upload, model.operations, kind]);
  const versions = state.versions.filter((v) => v.uploadId === upload?.id);
  const coverage = model.coverages.find((c) => c.uploadId === upload?.id);
  return (
    <Modal open={upload !== null} size="xl" title={upload ? `${upload.fileName} · versión ${upload.version}` : ""} description={upload ? `Importado ${formatDateTimeForDisplay(upload.importedAt)} · hojas: ${upload.sheets.join(", ")}` : undefined} onClose={onClose}>
      {upload && (
        <div className="stack stack--sm">
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Badge tone={upload.status === "active" ? "success" : "dark"}>{upload.status === "active" ? "Vigente" : "Retirada"}</Badge>
            <span className="muted">Cobertura: {coverage?.months.length ? `${coverage.months.join(", ")}${coverage.overridden ? " (ajustada por el usuario)" : ""}` : "sin meses"}{coverage?.pendingMonths.length ? ` · con pendientes por resolver (no cubiertos): ${coverage.pendingMonths.map((p) => `${p.month} (${p.count})`).join(", ")}` : ""}</span>
          </div>
          {versions.length > 1 && (
            <div className="table-wrap">
              <table className="table table--dense">
                <thead>
                  <tr>
                    <th>Versión</th>
                    <th>Fecha</th>
                    <th className="num">Filas</th>
                    <th>Cambios frente a la anterior</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.version}>
                      <td>{v.version}</td>
                      <td>{formatDateTimeForDisplay(v.importedAt)}</td>
                      <td className="num">{formatInteger(v.rowsTotal)}</td>
                      <td>{v.summary.added !== undefined ? `${v.summary.added} agregadas · ${v.summary.modified} modificadas · ${v.summary.unchanged} sin cambios · ${v.summary.removed} eliminadas` : "Carga inicial"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            {(["purchase", "sale"] as const).map((k) => (
              <button key={k} type="button" className={`btn btn--sm ${kind === k ? "btn--primary" : ""}`} onClick={() => setKind(k)}>
                {k === "purchase" ? "Compras" : "Ventas"}
              </button>
            ))}
          </div>
          <div className="table-wrap" style={{ maxHeight: 380, overflow: "auto" }}>
            <table className="table table--dense">
              <thead>
                <tr>
                  <th>Fila</th>
                  {kind === "purchase" && <th>Fecha</th>}
                  <th>Tercero</th>
                  <th>Documento</th>
                  {kind === "purchase" && <th>Ciudad</th>}
                  <th className="num">Valor</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {ops.slice(0, 500).map((o) => (
                  <tr key={o.id}>
                    <td>{o.rowNumber}</td>
                    {kind === "purchase" && <td className="nowrap">{o.dateRaw || "—"}</td>}
                    <td>{operationName(o)}</td>
                    <td className="nowrap">
                      {o.docTypeRaw || "—"} {o.docNumber}
                    </td>
                    {kind === "purchase" && <td>{o.cityRaw || "—"}</td>}
                    <td className="num nowrap">{o.amountCents === null ? "—" : formatExactCents(o.amountCents)}</td>
                    <td>
                      <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
                      {o.issues.map((i) => (
                        <div key={i.code + i.message} className="muted">
                          {i.message}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ops.length > 500 && <p className="muted">Se muestran las primeras 500 de {formatInteger(ops.length)} filas.</p>}
        </div>
      )}
    </Modal>
  );
}
