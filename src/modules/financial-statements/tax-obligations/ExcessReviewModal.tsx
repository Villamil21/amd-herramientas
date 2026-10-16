import { useState } from "react";
import { Check, X } from "lucide-react";
import { Alert, Badge, Button, Modal, useToast } from "../../../components/ui";
import { errorMessage } from "../../../services/tauri";
import { formatExactCents, formatIsoDate } from "../shared/money";
import type { ExcessReviewItem } from "./services/effects";
import { taxService } from "./services/taxService";
import { SHORT_TAX_LABEL } from "./types";

interface Props {
  open: boolean;
  items: ExcessReviewItem[];
  onClose: () => void;
  /** Recarga declaraciones / EEFF / Exógena tras decidir. */
  onChanged: () => void | Promise<unknown>;
  /** Abre la configuración de la cuenta PUC del excedente. */
  onConfigurePuc?: () => void;
}

/**
 * «Excedentes a favor de DIAN por revisar»: cada excedente vigente decide, a la vez, si entra a Estados Financieros (deudor) y al
 * 1008 (DIAN-1317) o a ninguno. La decisión se guarda con la huella del pago, la clasificación, el PUC y el valor: solo cambia si
 * cambia alguno de ellos. «No aplica» nunca elimina el pago original.
 */
export function ExcessReviewModal({ open, items, onClose, onChanged, onConfigurePuc }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);

  async function decide(item: ExcessReviewItem, decision: "applies" | "not_applies") {
    setBusy(item.paymentId);
    try {
      await taxService.setExcessReview(item.paymentId, decision, item.fingerprint);
      toast(decision === "applies" ? "El excedente aplica a Estados Financieros y 1008." : "El excedente no aplica: se excluye de Estados Financieros y 1008.");
      await onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const pending = items.filter((i) => i.needsReview).length;
  return (
    <Modal
      open={open}
      size="xl"
      title="Excedentes a favor de DIAN por revisar"
      description="Un excedente que aplica entra como deudor en Estados Financieros y como fuente del registro DIAN-1317 del 1008; uno que no aplica sale de los dos. El pago original se conserva siempre."
      onClose={onClose}
      locked={busy !== null}
      footer={<Button onClick={onClose}>Cerrar</Button>}
    >
      <div className="stack">
        {pending > 0 ? <Alert tone="warning">{pending === 1 ? "Falta decidir 1 excedente" : `Faltan por decidir ${pending} excedentes`}: bloquean el estado «Listo» de los Estados Financieros y del 1008.</Alert> : <Alert tone="success">Todos los excedentes tienen decisión vigente.</Alert>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Impuesto</th>
                <th>Período</th>
                <th>Fecha de pago</th>
                <th style={{ textAlign: "right" }}>Excedente</th>
                <th>PUC</th>
                <th>¿Aplica a EEFF y 1008?</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.paymentId} className={i.needsReview ? "row-attention--blocking" : undefined}>
                  <td>{SHORT_TAX_LABEL[i.taxType]}</td>
                  <td>{i.periodLabel}</td>
                  <td className="nowrap">{formatIsoDate(i.paymentDate)}</td>
                  <td className="nowrap" style={{ textAlign: "right" }}>
                    {formatExactCents(i.cents)}
                  </td>
                  <td className="mono">
                    {i.pucCode ?? (
                      <>
                        <Badge tone="danger">Sin configurar</Badge>{" "}
                        {onConfigurePuc && (
                          <button type="button" className="link-button" onClick={onConfigurePuc}>
                            Configurar PUC
                          </button>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                      <Button size="sm" variant={i.decision === "applies" && !i.stale ? "primary" : undefined} icon={<Check size={13} />} loading={busy === i.paymentId} disabled={busy !== null || !i.pucCode} title={i.pucCode ? undefined : "Configura el PUC del excedente para aprobarlo."} onClick={() => void decide(i, "applies")}>
                        Aplica
                      </Button>
                      <Button size="sm" variant={i.decision === "not_applies" && !i.stale ? "primary" : undefined} icon={<X size={13} />} disabled={busy !== null} onClick={() => void decide(i, "not_applies")}>
                        No aplica
                      </Button>
                    </div>
                    {i.stale && <div className="table__secondary">Cambió el pago, el PUC o el valor desde la última decisión: decide de nuevo.</div>}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No hay excedentes a favor de la DIAN a esta fecha.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
