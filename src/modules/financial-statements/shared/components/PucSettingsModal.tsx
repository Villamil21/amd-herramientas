import { useEffect, useState } from "react";
import { Alert, Button, Modal, useToast } from "../../../../components/ui";
import { fsService } from "../../../../services/fsService";
import { errorMessage } from "../../../../services/tauri";
import type { FsCatalog, FsPucMapping } from "../../../../types/fs";
import type { PucIndex } from "../../puc-codes/services/pucCatalog";
import { presentationOf } from "../presentation";
import { PucField } from "./PucField";

export interface PucSettingItem {
  key: string;
  label: string;
  group?: string;
}

interface Props {
  open: boolean;
  title: string;
  description?: string;
  items: PucSettingItem[];
  index: PucIndex;
  settings: Map<string, string>;
  mappings?: Map<string, FsPucMapping>;
  /** Con el catálogo se muestra la ubicación en EEFF de cada cuenta (por familia de cuatro dígitos). */
  catalog?: FsCatalog | null;
  /** Clasificar la familia de una cuenta sin ubicación (abre el clasificador). */
  onClassify?: (familyCode: string, concept: string) => void;
  /** Claves que se necesitan ahora (se resaltan si faltan). */
  required?: string[];
  onClose: () => void;
  onSaved: () => void | Promise<unknown>;
  onCodesChanged?: () => Promise<unknown> | void;
}

/** Cuentas PUC globales de un submódulo (no son por empresa). Si la cuenta no existe se puede crear. */
export function PucSettingsModal({ open, title, description, items, index, settings, mappings, catalog, onClassify, required = [], onClose, onSaved, onCodesChanged }: Props) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues(Object.fromEntries(items.map((i) => [i.key, settings.get(i.key) ?? ""])));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const changed = items.filter((i) => values[i.key] && values[i.key] !== settings.get(i.key));
  const groups = [...new Set(items.map((i) => i.group ?? ""))];

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await fsService.savePucSettings(changed.map((i) => ({ key: i.key, pucCode: values[i.key] })));
      toast("Cuentas PUC guardadas.");
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
      size="lg"
      title={title}
      description={description ?? "Configuración global: aplica a todas las empresas."}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={changed.length === 0}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        {groups.map((g) => (
          <div key={g} className="stack stack--sm">
            {g && <div className="field__label">{g}</div>}
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {items
                    .filter((i) => (i.group ?? "") === g)
                    .map((i) => (
                      <tr key={i.key}>
                        <td style={{ width: "42%" }}>
                          {i.label}
                          {required.includes(i.key) && !values[i.key] && <span className="amount--negative"> · requerida</span>}
                        </td>
                        <td>
                          <PucField index={index} value={values[i.key] || undefined} onChange={(code) => setValues((v) => ({ ...v, [i.key]: code }))} title={i.label} mappings={mappings} onCodesChanged={onCodesChanged} />
                          {values[i.key] && catalog && mappings && (
                            <PresentationNote code={values[i.key]} index={index} catalog={catalog} mappings={mappings} onClassify={onClassify} />
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function PresentationNote({ code, index, catalog, mappings, onClassify }: { code: string; index: PucIndex; catalog: FsCatalog; mappings: Map<string, FsPucMapping>; onClassify?: (family: string, concept: string) => void }) {
  const p = presentationOf(code, catalog, mappings);
  return (
    <div className="field__hint">
      Presentación en EEFF (familia {p.family}): {p.state === "none" ? <span className="amount--negative">{p.text}</span> : p.text}
      {p.state === "none" && onClassify && (
        <>
          {" "}
          <button type="button" className="link-button" onClick={() => onClassify(p.family, index.concepts.get(p.family) ?? "")}>
            Clasificar {p.family}
          </button>
        </>
      )}
    </div>
  );
}
