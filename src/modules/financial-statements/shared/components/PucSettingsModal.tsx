import { useEffect, useState } from "react";
import { Alert, Button, Modal, useToast } from "../../../../components/ui";
import { fsService } from "../../../../services/fsService";
import { errorMessage } from "../../../../services/tauri";
import type { FsPucMapping } from "../../../../types/fs";
import type { PucIndex } from "../../puc-codes/services/pucCatalog";
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
  /** Claves que se necesitan ahora (se resaltan si faltan). */
  required?: string[];
  onClose: () => void;
  onSaved: () => void | Promise<unknown>;
  onCodesChanged?: () => Promise<unknown> | void;
}

/** Cuentas PUC globales de un submódulo (no son por empresa). Si la cuenta no existe se puede crear. */
export function PucSettingsModal({ open, title, description, items, index, settings, mappings, required = [], onClose, onSaved, onCodesChanged }: Props) {
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
