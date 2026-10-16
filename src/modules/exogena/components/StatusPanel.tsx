import { CheckCircle2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Field, Modal, Textarea } from "../../../components/ui";
import { FORMAT_STATUS_LABEL, type FormatStatus, type FormatStatusRow } from "../../../types/exogena";
import { formatDateTimeForDisplay } from "../../../utils/dates";
import { blocking, type Problem } from "../domain/problems";

export const STATUS_TONE: Record<FormatStatus, "gold" | "success" | "warning" | "dark"> = { en_preparacion: "gold", listo: "success", requiere_actualizacion: "warning", no_aplica: "dark" };

export function StatusBadge({ status }: { status: FormatStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{FORMAT_STATUS_LABEL[status]}</Badge>;
}

interface Props {
  row: FormatStatusRow;
  problems: Problem[];
  /** Hay datos para marcar (un formato sin registros solo puede quedar «No aplica»). */
  onSetStatus: (status: FormatStatus, reason?: string) => Promise<void>;
  /** Texto adicional bajo el estado (por ejemplo la conciliación). */
  children?: React.ReactNode;
}

/**
 * Estado persistente del formato por empresa y año: en preparación, listo, requiere actualización o no aplica (con
 * justificación). «Listo» solo se puede marcar cuando no queda ningún pendiente bloqueante.
 */
export function StatusPanel({ row, problems, onSetStatus, children }: Props) {
  const [naOpen, setNaOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const stoppers = blocking(problems);

  async function run(status: FormatStatus, why?: string) {
    setBusy(true);
    try {
      await onSetStatus(status, why);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="row row--between" style={{ alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div className="stack stack--sm">
          <div className="row" style={{ gap: 8 }}>
            <strong>Estado del formato</strong>
            <StatusBadge status={row.status} />
            <span className="muted">
              {row.recordCount} {row.recordCount === 1 ? "registro" : "registros"}
            </span>
          </div>
          <span className="muted">{row.lastSyncedAt ? `Última sincronización: ${formatDateTimeForDisplay(row.lastSyncedAt)}` : "Aún no se ha sincronizado."}</span>
          {row.status === "no_aplica" && <span>Justificación: {row.notApplicableReason}</span>}
          {row.status === "requiere_actualizacion" && <span>Cambió la información de origen o los registros: revisa los pendientes y vuelve a marcarlo como listo.</span>}
          {children}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {row.status === "no_aplica" || row.status === "listo" ? (
            <Button icon={<RotateCcw size={14} />} loading={busy} onClick={() => void run("en_preparacion")}>
              Reabrir
            </Button>
          ) : (
            <>
              <Button variant="primary" icon={<CheckCircle2 size={15} />} loading={busy} disabled={stoppers.length > 0} title={stoppers.length ? `${stoppers.length} pendientes impiden marcarlo como listo.` : undefined} onClick={() => void run("listo")}>
                Marcar como listo
              </Button>
              <Button onClick={() => setNaOpen(true)}>No aplica…</Button>
            </>
          )}
        </div>
      </div>
      <Modal
        open={naOpen}
        title="Marcar como «No aplica»"
        description="Un formato que no aplica cuenta como cerrado en Control. Explica brevemente por qué."
        size="sm"
        onClose={() => setNaOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNaOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              disabled={reason.trim().length < 5}
              loading={busy}
              onClick={() =>
                void run("no_aplica", reason.trim()).then(() => {
                  setNaOpen(false);
                  setReason("");
                })
              }
            >
              Marcar «No aplica»
            </Button>
          </>
        }
      >
        <Field label="Justificación" required hint="Mínimo 5 caracteres.">
          {(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
        </Field>
      </Modal>
    </Card>
  );
}
