import { useState } from "react";
import { Lock, Trash2 } from "lucide-react";
import { Button, ConfirmDialog, EmptyState, Modal, Select, useToast } from "../../../../components/ui";
import { dropiService } from "../../../../services/dropiService";
import { errorMessage } from "../../../../services/tauri";
import type { DropiStatusMapping } from "../../../../types/models";
import { CONFIGURABLE_CATEGORIES, CONFIGURABLE_LABEL, FIXED_RULES } from "../services/statuses";
import type { ConfigurableCategory } from "../types";
import { CategoryBadge } from "./CategoryBadge";

interface Props {
  open: boolean;
  mappings: DropiStatusMapping[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}

/**
 * Configuración del módulo: estados clasificados por el usuario (se pueden
 * reasignar o eliminar) y reglas fijas (solo lectura). Las reglas son
 * globales: aplican a los archivos de todas las empresas.
 */
export function StatusRulesModal({ open, mappings, onClose, onChanged }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<DropiStatusMapping | null>(null);

  async function reassign(m: DropiStatusMapping, category: ConfigurableCategory) {
    setBusy(m.id);
    try {
      await dropiService.updateStatusMapping(m.id, category);
      await onChanged();
      toast(`«${m.displayStatus}» ahora se clasifica como ${CONFIGURABLE_LABEL[category]}.`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setBusy(toDelete.id);
    try {
      await dropiService.removeStatusMapping(toDelete.id);
      await onChanged();
      toast("Regla eliminada.");
      setToDelete(null);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Modal
        open={open && !toDelete}
        size="lg"
        title="Clasificación de estados de Dropi"
        description="Las clasificaciones aplican a los archivos de todas las empresas. Al cambiar una, los totales del archivo abierto se recalculan."
        onClose={onClose}
        footer={
          <Button variant="primary" onClick={onClose}>
            Listo
          </Button>
        }
      >
        <div className="stack">
          <strong>Estados clasificados</strong>
          {mappings.length === 0 ? (
            <EmptyState title="Aún no hay estados clasificados" description="Se agregan al clasificar los estados nuevos de un archivo importado." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Estado</th>
                    <th>Clasificación</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m) => (
                    <tr key={m.id}>
                      <td className="table__primary selectable">{m.displayStatus}</td>
                      <td style={{ width: 200 }}>
                        <Select
                          aria-label={`Clasificación de ${m.displayStatus}`}
                          value={m.category}
                          disabled={busy !== null}
                          onChange={(e) => void reassign(m, e.target.value as ConfigurableCategory)}
                        >
                          {CONFIGURABLE_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {CONFIGURABLE_LABEL[c]}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          iconOnly
                          icon={<Trash2 size={14} />}
                          aria-label={`Eliminar la regla de ${m.displayStatus}`}
                          title="Eliminar regla"
                          disabled={busy !== null}
                          onClick={() => setToDelete(m)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <strong className="row">
            <Lock size={14} className="muted" aria-hidden /> Reglas fijas
          </strong>
          <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
            Estos estados tienen una clasificación definida por el cierre y no se pueden cambiar desde aquí.
          </p>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {FIXED_RULES.map((r) => (
                  <tr key={r.statuses}>
                    <td className="table__primary">{r.statuses}</td>
                    <td style={{ width: 260 }}>
                      <CategoryBadge category={r.category} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        danger
        title="Eliminar regla"
        confirmLabel="Eliminar"
        loading={busy !== null}
        message={toDelete && <>La próxima vez que un archivo traiga «{toDelete.displayStatus}», la aplicación volverá a preguntar dónde clasificarlo.</>}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void remove()}
      />
    </>
  );
}
