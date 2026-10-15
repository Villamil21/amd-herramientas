import { useEffect, useState } from "react";
import { Alert, Button, Field, Input, Modal, Textarea, useToast } from "../../../components/ui";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import type { BankAccountLifecycle, BankLifecycleAction } from "../../../types/fs";
import { periodLabel } from "../shared/money";

const ACTION_LABEL: Record<BankLifecycleAction, string> = {
  opened: "Apertura confirmada",
  closed: "Cierre confirmado",
  kept_active: "Saldo final 0: sigue activa",
  existed_before: "Saldo inicial 0: la cuenta ya existía",
  edited: "Apertura / cierre editados",
};

const monthOrDash = (p: string | null | undefined) => (p ? periodLabel(p) : "—");

/** «Abierta desde abril 2026 · Cerrada en junio 2026»; vacío si no hay apertura ni cierre confirmados. */
export function lifecycleText(l: Pick<BankAccountLifecycle, "openedPeriod" | "closedPeriod"> | null | undefined): string {
  if (!l) return "";
  return [l.openedPeriod && `Abierta desde ${periodLabel(l.openedPeriod).toLowerCase()}`, l.closedPeriod && `Cerrada en ${periodLabel(l.closedPeriod).toLowerCase()}`].filter(Boolean).join(" · ");
}

interface Props {
  open: boolean;
  companyId: number;
  bank: string;
  accountNumber: string;
  /** Título visible de la cuenta («BBVA ••••7491»). */
  title: string;
  lifecycle: BankAccountLifecycle | null;
  onClose: () => void;
  onSaved: () => void | Promise<unknown>;
}

/**
 * Apertura y cierre de una cuenta: persistentes, editables y auditables. Corregir
 * una decisión deja lo anterior en el historial; quitar el cierre vuelve a exigir
 * los meses siguientes en la cobertura.
 */
export function BankLifecycleModal({ open, companyId, bank, accountNumber, title, lifecycle, onClose, onSaved }: Props) {
  const toast = useToast();
  const [opened, setOpened] = useState("");
  const [closed, setClosed] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setOpened(lifecycle?.openedPeriod ?? "");
    setClosed(lifecycle?.closedPeriod ?? "");
    setNote("");
    setError(null);
  }, [open, lifecycle]);

  const invalid = opened && closed && opened > closed ? "El cierre no puede ser anterior a la apertura." : null;
  const unchanged = opened === (lifecycle?.openedPeriod ?? "") && closed === (lifecycle?.closedPeriod ?? "");

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await fsService.saveBankLifecycle({ companyId, bank, accountNumber, action: "edited", openedPeriod: opened || null, closedPeriod: closed || null, note });
      toast("Apertura / cierre de la cuenta actualizados.");
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`Apertura y cierre · ${title}`}
      description="Antes de la apertura y después del cierre los meses quedan «No aplica» en la cobertura. Vacío = sin dato (se usa la regla general)."
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={Boolean(invalid) || unchanged}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="form-grid">
          <Field label="Mes de apertura" hint="Primer mes con la cuenta abierta.">
            {(id) => <Input id={id} type="month" value={opened} onChange={(e) => setOpened(e.target.value)} />}
          </Field>
          <Field label="Mes de cierre" hint="Último mes con extracto (saldo final 0)." error={invalid}>
            {(id) => <Input id={id} type="month" value={closed} onChange={(e) => setClosed(e.target.value)} />}
          </Field>
          <Field label="Motivo de la corrección" className="span-2">
            {(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />}
          </Field>
        </div>
        {lifecycle && lifecycle.events.length > 0 && (
          <div className="stack stack--sm">
            <div className="field__label">Historial</div>
            <ul className="fs-history">
              {[...lifecycle.events].reverse().map((e, i) => (
                <li key={i}>
                  <span>
                    {ACTION_LABEL[e.action] ?? e.action}
                    {e.period ? ` · ${monthOrDash(e.period)}` : ""}
                    {e.action === "edited" && e.previous ? ` · antes: apertura ${monthOrDash(e.previous.openedPeriod)}, cierre ${monthOrDash(e.previous.closedPeriod)}` : ""}
                    {e.note ? ` · «${e.note}»` : ""}
                  </span>
                  <span className="muted">{e.createdAt.replace("T", " ").slice(0, 16)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
