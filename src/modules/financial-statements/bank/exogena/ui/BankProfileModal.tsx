import { useEffect, useState } from "react";
import { Button, Field, Input, Modal, useToast } from "../../../../../components/ui";
import { fsService } from "../../../../../services/fsService";
import { errorMessage } from "../../../../../services/tauri";
import type { BankProfile } from "../../../../../types/fs";
import { computeNitDv } from "../../../../exogena/domain/thirdParty";
import { COLOMBIA_CODE, NIT_DOC_TYPE } from "../model";

interface Props {
  open: boolean;
  /** Banco tal como lo trae el extracto («Bancolombia», «BBVA»…). */
  bank: string;
  profile: BankProfile | null;
  onClose: () => void;
  onSaved: (profile: BankProfile) => void | Promise<unknown>;
}

/**
 * Ficha del banco como informado en Exógena (1012 y 1007): NIT sin DV y razón social, una sola vez. El DV se calcula solo, el
 * tipo de documento es NIT y el país Colombia (169). Nunca se precarga un NIT ni una razón social inventados.
 */
export function BankProfileModal({ open, bank, profile, onClose, onSaved }: Props) {
  const toast = useToast();
  const [nit, setNit] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNit(profile?.nit ?? "");
    setName(profile?.businessName ?? "");
  }, [open, profile]);

  const digits = nit.replace(/\D/g, "");
  const dv = computeNitDv(digits);
  const invalid = !digits || !name.trim();
  const unchanged = Boolean(profile) && digits === profile!.nit && name.trim().toUpperCase() === profile!.businessName;

  async function save() {
    setSaving(true);
    try {
      const saved = await fsService.saveBankProfile({ bank, nit: digits, businessName: name.trim() });
      toast(`Ficha de ${bank} guardada: se usará en todos los extractos y empresas.`);
      await onSaved(saved);
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`Ficha de ${bank} para Exógena`}
      description="El banco se informa como tercero en el 1012 y el 1007. Se configura una sola vez y se reutiliza en cada extracto, empresa y año."
      size="sm"
      locked={saving}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} disabled={invalid || unchanged} onClick={() => void save()}>
            Guardar ficha
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="NIT (sin DV)" required hint="Solo dígitos, tal como figura en el RUT del banco.">
          {(id) => <Input id={id} inputMode="numeric" value={nit} onChange={(e) => setNit(e.target.value)} autoFocus placeholder="Ej. 890903938" />}
        </Field>
        <div className="form-grid form-grid--compact">
          <Field label="DV" hint="Se calcula automáticamente.">
            {(id) => <Input id={id} value={dv} readOnly aria-readonly />}
          </Field>
          <Field label="Tipo de documento">{(id) => <Input id={id} value={`${NIT_DOC_TYPE} · NIT`} readOnly aria-readonly />}</Field>
          <Field label="País">{(id) => <Input id={id} value={`${COLOMBIA_CODE} · Colombia`} readOnly aria-readonly />}</Field>
        </div>
        <Field label="Razón social" required hint="Como figura en el RUT; se guarda en mayúsculas.">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. BANCOLOMBIA S.A." />}
        </Field>
      </div>
    </Modal>
  );
}
