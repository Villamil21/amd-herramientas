import { useState } from "react";
import { Alert, Button, Field, Input, Modal, useToast } from "../../../../components/ui";
import { pucService } from "../../../../services/pucService";
import { errorMessage } from "../../../../services/tauri";
import type { PucCode } from "../../../../types/models";
import { suggestParent, type PucIndex } from "../../puc-codes/services/pucCatalog";

interface Props {
  /** Fila a editar; null = cerrado. */
  code: PucCode | null;
  /** Tiene movimientos o referencias: su número no se puede cambiar. */
  inUse: boolean;
  index: PucIndex;
  onClose: () => void;
  onSaved: (code: PucCode) => void | Promise<unknown>;
}

/**
 * Editar una cuenta de la Tabla de Códigos PUC. El concepto nunca cambia los
 * movimientos ya enviados (guardan el suyo) ni la clasificación en EEFF.
 * Oficial: solo el concepto (el número es del catálogo). Personalizado: también
 * el padre y, si no tiene ningún uso, el número.
 */
export function EditPucCodeModal({ code, inUse, index, onClose, onSaved }: Props) {
  const toast = useToast();
  const [current, setCurrent] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");
  const [concept, setConcept] = useState("");
  const [parent, setParent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (code && current !== code.code) {
    setCurrent(code.code);
    setNewCode(code.code);
    setConcept(code.concept);
    setParent(code.parentCode ?? "");
    setError(null);
  }

  const custom = Boolean(code?.custom);
  const official = code?.officialConcept ?? code?.concept ?? "";
  const changedCode = custom && newCode !== code?.code;
  const validCode = /^\d{4,12}$/.test(newCode);
  const taken = changedCode && index.concepts.has(newCode);
  const parentConcept = index.concepts.get(parent);
  const validParent = !custom || (Boolean(parentConcept) && newCode.startsWith(parent) && parent.length < newCode.length);
  const ready = Boolean(code) && (custom ? concept.trim().length > 0 && validCode && !taken && validParent && !(changedCode && inUse) : true);

  function close() {
    setCurrent(null);
    onClose();
  }

  async function save() {
    if (!code || !ready) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await pucService.updateCode({ code: code.code, newCode: custom ? newCode : undefined, concept, parentCode: custom ? parent : undefined });
      toast(saved.code !== code.code ? `Código ${code.code} cambiado a ${saved.code}.` : `Cuenta ${saved.code} actualizada.`);
      await onSaved(saved);
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={code !== null}
      title={`Editar cuenta PUC ${code?.code ?? ""}`}
      description={custom ? "Código personalizado (global para todas las empresas)." : "Cuenta oficial del PUC: su número no cambia."}
      onClose={close}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!ready}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="form-grid">
          <Field
            label="Código"
            required={custom}
            error={custom && newCode && !validCode ? "Entre 4 y 12 dígitos, solo números." : taken ? "Ese código ya existe en la tabla." : null}
            hint={!custom ? "Las cuentas oficiales conservan su número." : inUse ? "Tiene movimientos o referencias: el número no se puede cambiar." : "Sin movimientos ni referencias: puedes cambiarlo."}
          >
            {(id) => (
              <Input
                id={id}
                value={newCode}
                inputMode="numeric"
                disabled={!custom || inUse}
                onChange={(e) => {
                  const next = e.target.value.replace(/\D/g, "").slice(0, 12);
                  setNewCode(next);
                  // El padre debe seguir siendo el inicio del código.
                  if (!next.startsWith(parent) || parent.length >= next.length) setParent(suggestParent(index, next) ?? "");
                }}
              />
            )}
          </Field>
          <Field label="Concepto" required={custom} hint={!custom && code?.officialConcept ? `Denominación oficial: ${code.officialConcept}` : !custom ? "Vacío = la denominación oficial." : "Los movimientos ya enviados conservan el concepto con el que se enviaron."}>
            {(id) => <Input id={id} value={concept} autoFocus onChange={(e) => setConcept(e.target.value)} placeholder={official} />}
          </Field>
          {custom && (
            <Field label="Código padre" required className="span-2" error={parent && !validParent ? "Debe existir y ser el inicio del código." : null} hint={parentConcept ? `${parent} — ${parentConcept}` : undefined}>
              {(id) => <Input id={id} value={parent} inputMode="numeric" onChange={(e) => setParent(e.target.value.replace(/\D/g, "").slice(0, 11))} />}
            </Field>
          )}
        </div>
        {!custom && code?.officialConcept && concept !== code.officialConcept && (
          <div>
            <Button size="sm" variant="ghost" onClick={() => setConcept(code.officialConcept!)}>
              Usar la denominación oficial
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
