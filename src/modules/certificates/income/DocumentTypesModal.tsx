import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, ConfirmDialog, Field, Input, Modal, useToast } from "../../../components/ui";
import { identityDocumentService } from "../../../services/identityDocumentService";
import { errorMessage } from "../../../services/tauri";
import type { IdentityDocumentType, IdentityDocumentTypeInput } from "../../../types/models";

const empty: IdentityDocumentTypeInput = { name: "", isNumeric: false };

interface Props {
  open: boolean;
  /** Abre directamente el formulario de un tipo nuevo. */
  startCreating?: boolean;
  types: IdentityDocumentType[];
  onClose: () => void;
  /** Tras crear / editar / eliminar. `created` = tipo recién creado (para seleccionarlo). */
  onChanged: (change: { created?: IdentityDocumentType; deletedId?: number }) => void;
}

/** Tipos de documento de identidad guardados en SQLite (incluidos en el backup). */
export function DocumentTypesModal({ open, startCreating, types, onClose, onChanged }: Props) {
  const toast = useToast();
  /** undefined = sin formulario; null = nuevo; tipo = editando. */
  const [editing, setEditing] = useState<IdentityDocumentType | null | undefined>();
  const [values, setValues] = useState<IdentityDocumentTypeInput>(empty);
  const [removing, setRemoving] = useState<IdentityDocumentType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setEditing(startCreating ? null : undefined);
    setValues(empty);
  }, [open, startCreating]);

  function edit(type: IdentityDocumentType | null) {
    setEditing(type);
    setValues(type ? { name: type.name, isNumeric: type.isNumeric } : empty);
    setError(null);
  }

  async function save() {
    if (!values.name.trim()) {
      setError("Escribe el nombre del tipo de documento.");
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await identityDocumentService.update(editing.id, values);
        toast("Tipo de documento actualizado.");
        onChanged({});
      } else {
        const created = await identityDocumentService.create(values);
        toast("Tipo de documento creado.");
        onChanged({ created });
      }
      setEditing(undefined);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await identityDocumentService.remove(removing.id);
      toast("Tipo de documento eliminado.");
      onChanged({ deletedId: removing.id });
      if (editing?.id === removing.id) setEditing(undefined);
      setRemoving(null);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal open={open && !removing} title="Tipos de documento" description="Los tipos personalizados quedan guardados para las próximas veces." onClose={onClose} locked={busy} size="lg" footer={<Button variant="ghost" onClick={onClose}>Cerrar</Button>}>
        <div className="stack">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Número</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {types.map((type) => (
                  <tr key={type.id}>
                    <td>
                      <span className="table__primary">{type.name}</span>
                      {type.isSystem && (
                        <>
                          {" "}
                          <Badge>Inicial</Badge>
                        </>
                      )}
                    </td>
                    <td>{type.isNumeric ? "Numérico (1.006.011.707)" : "Alfanumérico (tal cual)"}</td>
                    <td className="actions">
                      <Button variant="ghost" size="sm" iconOnly icon={<Pencil size={14} />} aria-label="Editar" onClick={() => edit(type)} />
                      {!type.isSystem && <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} aria-label="Eliminar" onClick={() => setRemoving(type)} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editing === undefined ? (
            <div className="row">
              <Button icon={<Plus size={14} />} onClick={() => edit(null)}>
                Nuevo tipo de documento
              </Button>
            </div>
          ) : (
            <div className="stack stack--sm" style={{ padding: 14, border: "1px solid var(--color-border)", borderRadius: 10 }}>
              <strong>{editing ? `Editar «${editing.name}»` : "Nuevo tipo de documento"}</strong>
              {error && <Alert tone="danger">{error}</Alert>}
              <Field label="Nombre del tipo" required hint="Ej. Pasaporte, Permiso por Protección Temporal, NIT.">
                {(id) => <Input id={id} autoFocus maxLength={80} value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && void save()} />}
              </Field>
              <label className="checkbox">
                <input type="checkbox" checked={values.isNumeric} onChange={(e) => setValues((v) => ({ ...v, isNumeric: e.target.checked }))} />
                <span>Número solo con dígitos: mostrar con separador de miles (1.006.011.707)</span>
              </label>
              <div className="row">
                <Button variant="primary" loading={busy} onClick={() => void save()}>
                  Guardar
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setEditing(undefined)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={!!removing}
        danger
        title="Eliminar tipo de documento"
        message={removing && `«${removing.name}» dejará de estar disponible.`}
        confirmLabel="Eliminar"
        loading={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void remove()}
      />
    </>
  );
}
