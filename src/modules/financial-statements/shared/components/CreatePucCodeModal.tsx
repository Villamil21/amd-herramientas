import { useEffect, useState } from "react";
import { Alert, Button, Field, Input, Modal, useToast } from "../../../../components/ui";
import { fsService } from "../../../../services/fsService";
import { pucService } from "../../../../services/pucService";
import { errorMessage } from "../../../../services/tauri";
import type { FsPucMapping } from "../../../../types/fs";
import type { PucCode } from "../../../../types/models";
import { suggestParent, type PucIndex } from "../../puc-codes/services/pucCatalog";

interface Props {
  open: boolean;
  initialCode?: string;
  index: PucIndex;
  /** Para sugerir la clasificación del padre (si ya está clasificado). */
  mappings?: Map<string, FsPucMapping>;
  onClose: () => void;
  onCreated: (code: PucCode) => void | Promise<void>;
}

/**
 * Crear nueva cuenta PUC (código personalizado, global para todas las
 * empresas). El concepto lo escribe el usuario; el padre se sugiere y el
 * usuario lo confirma. La clasificación del padre también es solo una sugerencia.
 */
export function CreatePucCodeModal({ open, initialCode = "", index, mappings, onClose, onCreated }: Props) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [concept, setConcept] = useState("");
  const [parent, setParent] = useState("");
  const [parentConfirmed, setParentConfirmed] = useState(false);
  const [useParentMapping, setUseParentMapping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCode(initialCode);
    setConcept("");
    setParent(suggestParent(index, initialCode) ?? "");
    setParentConfirmed(false);
    setUseParentMapping(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const exists = index.concepts.has(code);
  const parentConcept = index.concepts.get(parent);
  const parentMapping = parent ? mappings?.get(parent) : undefined;
  const validCode = /^\d{4,12}$/.test(code);
  const validParent = Boolean(parentConcept) && code.startsWith(parent) && parent.length < code.length;
  const ready = validCode && !exists && concept.trim().length > 0 && validParent && parentConfirmed;

  async function save() {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      const created = await pucService.createCustomCode(code, concept, parent);
      if (useParentMapping && parentMapping) await fsService.setMapping(created.code, parentMapping.lineId, parentMapping.excluded);
      toast(`Cuenta ${created.code} — ${created.concept} creada.`);
      await onCreated(created);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Crear nueva cuenta PUC"
      description="Código personalizado: queda disponible para todas las empresas."
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!ready}>
            Crear cuenta
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="form-grid">
          <Field label="Código" required error={code && !validCode ? "Entre 4 y 12 dígitos, solo números." : exists ? "Ese código ya existe en la tabla." : null}>
            {(id) => (
              <Input
                id={id}
                value={code}
                inputMode="numeric"
                autoFocus={!initialCode}
                placeholder="11050501"
                onChange={(e) => {
                  const next = e.target.value.replace(/\D/g, "").slice(0, 12);
                  setCode(next);
                  setParent(suggestParent(index, next) ?? "");
                  setParentConfirmed(false);
                }}
              />
            )}
          </Field>
          <Field label="Concepto" required hint="Escríbelo tal como debe aparecer.">
            {(id) => <Input id={id} value={concept} autoFocus={Boolean(initialCode)} onChange={(e) => setConcept(e.target.value)} placeholder="Caja dueño" />}
          </Field>
          <Field label="Código padre" required className="span-2" error={parent && !validParent ? "Debe existir y ser el inicio del código nuevo." : null} hint={parentConcept ? `${parent} — ${parentConcept}` : "Sugerido según el código; puedes cambiarlo."}>
            {(id) => (
              <Input
                id={id}
                value={parent}
                inputMode="numeric"
                onChange={(e) => {
                  setParent(e.target.value.replace(/\D/g, "").slice(0, 11));
                  setParentConfirmed(false);
                }}
              />
            )}
          </Field>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={parentConfirmed} disabled={!validParent} onChange={(e) => setParentConfirmed(e.target.checked)} />
          <span>
            Confirmo que el padre es {parent || "…"}
            {parentConcept ? ` — ${parentConcept}` : ""}.
          </span>
        </label>
        {parentMapping && (
          <label className="checkbox">
            <input type="checkbox" checked={useParentMapping} onChange={(e) => setUseParentMapping(e.target.checked)} />
            <span>Sugerencia: usar la misma clasificación de {parent} en Estados Financieros{parentMapping.excluded ? " (No afecta Estados Financieros)" : ""}.</span>
          </label>
        )}
      </div>
    </Modal>
  );
}
