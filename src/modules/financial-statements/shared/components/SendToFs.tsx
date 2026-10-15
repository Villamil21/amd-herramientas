import { useState } from "react";
import { CheckCircle2, FileSpreadsheet, Send } from "lucide-react";
import { Button, Modal, useToast } from "../../../../components/ui";
import { fsService } from "../../../../services/fsService";
import { errorMessage } from "../../../../services/tauri";
import type { BatchInput, BatchSummary } from "../../../../types/fs";
import { formatInteger } from "../../../../utils/format";
import { formatExactCents } from "../money";

interface Props {
  /** Arma el envío; null si no hay nada que enviar. */
  build: () => BatchInput | null;
  /** Motivo que bloquea el envío (pendientes). null = listo. */
  blocked: string | null;
  /** Descarga del Excel del submódulo (para «Enviar y descargar»). */
  onExport?: () => Promise<string | null | void>;
  onSent?: (batchId: number) => void;
  /** Título del aviso de duplicado («Este extracto ya fue enviado.»). */
  duplicateTitle?: string;
  replaceLabel?: string;
  exporting?: boolean;
  /** Motivo que bloquea «Exportar Excel» (si el submódulo tiene su propia validación). */
  exportBlocked?: string | null;
  /** Estado mientras hay bloqueos («Pendiente de clasificación», «Cobertura incompleta»…). Por defecto «Requiere revisión». */
  blockedStatus?: string;
  /** Todos los pendientes (el primero suele ser `blocked`); se listan bajo el estado. */
  reasons?: string[];
  /** Estado cuando no hay bloqueos (por defecto «Listo para Estados Financieros»), p. ej. «Procesado sin movimientos». */
  readyStatus?: string;
}

/**
 * Zona única de acciones de Estados Financieros, siempre al inicio de los
 * resultados de cada submódulo y con el mismo diseño:
 * [Estado] · [Exportar Excel] [Enviar a Estados Financieros] [Enviar y descargar].
 * Sin exportación propia del submódulo, solo los botones de envío. Con
 * pendientes, el estado lo dice y los envíos quedan deshabilitados.
 * Enviar y descargar: envía, comprueba el éxito y solo entonces descarga. Si
 * el envío ya existe, se detiene y el usuario elige Reemplazar o Cancelar.
 */
export function SendToFs({
  build,
  blocked,
  onExport,
  onSent,
  duplicateTitle = "Este lote ya existe.",
  replaceLabel = "Reemplazar",
  exporting,
  exportBlocked = null,
  blockedStatus = "Requiere revisión",
  reasons,
  readyStatus = "Listo para Estados Financieros",
}: Props) {
  const toast = useToast();
  const [sending, setSending] = useState<"send" | "download" | null>(null);
  const [duplicate, setDuplicate] = useState<{ input: BatchInput; batches: BatchSummary[]; repeated: number; download: boolean } | null>(null);
  const [sentBatch, setSentBatch] = useState<number | null>(null);

  async function send(input: BatchInput, download: boolean) {
    setSending(download ? "download" : "send");
    try {
      const outcome = await fsService.send(input);
      if (outcome.kind === "duplicate") {
        setDuplicate({ input, batches: outcome.batches, repeated: outcome.repeatedDocuments, download });
        return;
      }
      setDuplicate(null);
      setSentBatch(outcome.batchId);
      toast(`Enviado a Estados Financieros (importación #${outcome.batchId}).${outcome.invalidatedPeriods ? " Hay periodos que requieren nueva revisión." : ""}`);
      onSent?.(outcome.batchId);
      // Solo después de comprobar el envío.
      if (download && onExport) await onExport();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSending(null);
    }
  }

  function start(download: boolean) {
    if (blocked) return;
    const input = build();
    if (!input) return toast("No hay movimientos para enviar.", "error");
    void send(input, download);
  }

  const pending = blocked ? (reasons?.length ? reasons : [blocked]) : [];
  return (
    <>
      <div className="card fs-action-bar">
        <div className="fs-action-bar__status">
          <div className={`lot-status ${blocked ? "lot-status--attention" : "lot-status--ready"}`} role="status">
            <span className="lot-status__dot" aria-hidden />
            {blocked ? blockedStatus : sentBatch ? `Enviado · importación #${sentBatch}` : readyStatus}
          </div>
          {pending.length > 0 && <div className="fs-action-bar__detail">{pending.join(" · ")}.</div>}
        </div>
        <div className="fs-action-bar__actions">
          {onExport && (
            <Button icon={<FileSpreadsheet size={15} />} onClick={() => void onExport()} loading={exporting} disabled={exportBlocked !== null} title={exportBlocked ?? undefined}>
              Exportar Excel
            </Button>
          )}
          <Button variant="primary" icon={<Send size={15} />} disabled={Boolean(blocked) || sending !== null} loading={sending === "send"} onClick={() => start(false)} title={blocked ?? undefined}>
            Enviar a Estados Financieros
          </Button>
          {onExport && (
            <Button icon={<CheckCircle2 size={15} />} disabled={Boolean(blocked) || sending !== null} loading={sending === "download"} onClick={() => start(true)} title={blocked ?? undefined}>
              Enviar y descargar
            </Button>
          )}
        </div>
      </div>
      <Modal
        open={duplicate !== null}
        title={duplicateTitle}
        description="Nunca se suma un duplicado: elige si el nuevo envío reemplaza al anterior."
        onClose={() => setDuplicate(null)}
        locked={sending !== null}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDuplicate(null)} disabled={sending !== null}>
              Cancelar
            </Button>
            <Button variant="primary" loading={sending !== null} onClick={() => duplicate && void send({ ...duplicate.input, replace: true }, duplicate.download)}>
              {replaceLabel}
            </Button>
          </>
        }
      >
        {duplicate && (
          <div className="stack stack--sm">
            {duplicate.repeated > 0 && <p className="muted">{duplicate.repeated === 1 ? "1 documento ya fue enviado." : `${formatInteger(duplicate.repeated)} documentos ya fueron enviados.`}</p>}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Importación</th>
                    <th>Archivo / periodo</th>
                    <th>Registros</th>
                    <th style={{ textAlign: "right" }}>Total</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {duplicate.batches.map((b) => (
                    <tr key={b.id}>
                      <td>#{b.id}</td>
                      <td>{[b.fileName, b.periodLabel].filter(Boolean).join(" · ") || "—"}</td>
                      <td>{formatInteger(b.recordCount)}</td>
                      <td style={{ textAlign: "right" }}>{formatExactCents(b.totalCents)}</td>
                      <td>{b.createdAt.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="field__hint">Al reemplazar, lo anterior queda como «Reemplazado» (no se borra) y lo nuevo como «Activo».</p>
          </div>
        )}
      </Modal>
    </>
  );
}
