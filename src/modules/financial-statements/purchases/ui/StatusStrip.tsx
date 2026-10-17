import { AlertTriangle, CheckCircle2, CircleDot, MinusCircle, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { DESTS, DEST_LABEL, STATUS_LABEL, type Dest, type DestCounts, type DestStatus } from "../domain/status";

const ICON: Record<DestStatus, typeof XCircle> = { block: XCircle, pending: CircleDot, review: AlertTriangle, ready: CheckCircle2, na: MinusCircle };

/** Cantidad que acompaña al estado (bloqueos, por confirmar o por revisar); «Listo» y «No aplica» no llevan cantidad. */
export const statusCount = (status: DestStatus, c: DestCounts) => (status === "block" ? c.block : status === "pending" ? c.pending : status === "review" ? c.review : 0);

/** Icono + texto + cantidad + destino: el color nunca va solo. */
export function StatusChip({ status, count, dest, label }: { status: DestStatus; count?: number; dest?: Dest | string; label?: string }) {
  const Icon = ICON[status];
  const text = `${STATUS_LABEL[status]}${count ? ` · ${count}` : ""}`;
  return (
    <span className={`state-chip state-chip--${status}`} title={dest ? `${typeof dest === "string" && dest in DEST_LABEL ? DEST_LABEL[dest as Dest] : dest}: ${STATUS_LABEL[status]}` : undefined}>
      <Icon size={13} aria-hidden="true" />
      {label ?? text}
    </span>
  );
}

interface Props {
  counts: Record<Dest, DestCounts>;
  status: Record<Dest, DestStatus>;
  notApplicable?: Partial<Record<Dest, string>>;
  /** Destinos que se muestran (por defecto los cuatro). */
  dests?: Dest[];
  /** Texto breve bajo cada destino. */
  detail?: (d: Dest) => ReactNode;
  onSelect?: (d: Dest) => void;
}

/** Franja de conteos por destino (Estados Financieros, 1001, 1005 y 1006) para Compras, el Generador y Exógena. */
export function StatusStrip({ counts, status, notApplicable = {}, dests = DESTS, detail, onSelect }: Props) {
  return (
    <div className="state-strip" role="group" aria-label="Estado de Compras por destino">
      {dests.map((d) => {
        const body = (
          <>
            <span className="state-strip__dest">{DEST_LABEL[d]}</span>
            <StatusChip status={status[d]} count={statusCount(status[d], counts[d])} dest={d} />
            <span className="state-strip__detail">
              {notApplicable[d] ??
                detail?.(d) ??
                (status[d] === "ready" ? "Sin pendientes." : `${counts[d].block} bloquean · ${counts[d].pending} por confirmar · ${counts[d].review} por revisar`)}
            </span>
            {onSelect && <span className="state-strip__cta">{status[d] === "na" ? "Ver justificación" : status[d] === "ready" ? "Ver estado" : "Resolver pendientes"} →</span>}
          </>
        );
        // Toda la tarjeta es el botón: clic en cualquier parte, Enter o Espacio abren los pendientes de ese destino.
        return onSelect ? (
          <button
            key={d}
            type="button"
            className="state-strip__item state-strip__item--action"
            aria-haspopup="dialog"
            aria-label={cardLabel(d, status[d], counts[d])}
            onClick={() => onSelect(d)}
          >
            {body}
          </button>
        ) : (
          <div key={d} className="state-strip__item">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Nombre accesible de la tarjeta: destino, estado y cantidades. */
export const cardLabel = (d: Dest, status: DestStatus, c: DestCounts) =>
  `${DEST_LABEL[d]}: ${STATUS_LABEL[status]}${status === "ready" || status === "na" ? "" : ` (${c.block} bloquean, ${c.pending} por confirmar, ${c.review} por revisar)`}. Abrir pendientes`;
