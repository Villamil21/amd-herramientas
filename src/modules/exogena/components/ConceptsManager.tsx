import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Alert, Badge, Button, Input, Modal, useToast } from "../../../components/ui";
import { exogenaService } from "../../../services/exogenaService";
import { errorMessage } from "../../../services/tauri";
import type { FormatConcept } from "../../../types/exogena";

interface Props {
  open: boolean;
  formatCode: string;
  concepts: FormatConcept[];
  onClose: () => void;
  onChanged: () => void;
}

/**
 * «Administrar conceptos del formato»: crear, editar o desactivar los conceptos de ESTE formato (los de otro nunca aparecen
 * aquí). Los registros ya creados conservan su código y descripción aunque el concepto se desactive o se elimine.
 */
export function ConceptsManager({ open, formatCode, concepts, onClose, onChanged }: Props) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>, ok: string) {
    setBusy(true);
    try {
      await action();
      toast(ok);
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const add = () =>
    run(async () => {
      await exogenaService.saveFormatConcept({ formatCode, code: code.trim(), description: description.trim(), isActive: true });
      setCode("");
      setDescription("");
    }, "Concepto creado.");

  return (
    <Modal open={open} size="lg" title={`Conceptos del formato ${formatCode}`} description="Exclusivos de este formato. Desactivar un concepto no cambia los registros que ya lo usan." onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Cerrar</Button>}>
      <div className="stack">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {concepts.map((c) => {
                const text = edits[c.code] ?? c.description;
                const changed = text.trim() !== c.description;
                return (
                  <tr key={c.code}>
                    <td className="table__primary">
                      {c.code} {c.isSystem && <Badge>Oficial</Badge>}
                    </td>
                    <td>
                      {c.isSystem ? (
                        c.description
                      ) : (
                        <div className="row" style={{ gap: 6 }}>
                          <Input aria-label={`Descripción de ${c.code}`} value={text} onChange={(e) => setEdits((m) => ({ ...m, [c.code]: e.target.value }))} />
                          {changed && (
                            <Button size="sm" disabled={busy || !text.trim()} onClick={() => void run(() => exogenaService.saveFormatConcept({ formatCode, code: c.code, description: text.trim(), isActive: c.isActive }), "Concepto actualizado.")}>
                              Guardar
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                    <td>{c.isActive ? <Badge tone="success">Activo</Badge> : <Badge>Inactivo</Badge>}</td>
                    <td className="actions">
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => exogenaService.saveFormatConcept({ formatCode, code: c.code, description: c.description, isActive: !c.isActive }), c.isActive ? "Concepto desactivado." : "Concepto activado.")}>
                        {c.isActive ? "Desactivar" : "Activar"}
                      </Button>
                      {!c.isSystem && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} aria-label={`Eliminar ${c.code}`} disabled={busy} onClick={() => void run(() => exogenaService.deleteFormatConcept(formatCode, c.code), "Concepto eliminado.")} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Alert tone="info" title="Nuevo concepto">
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Input aria-label="Código del concepto" placeholder="Código" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} style={{ width: 110 }} inputMode="numeric" />
            <Input aria-label="Descripción del nuevo concepto" placeholder="Descripción" value={description} onChange={(e) => setDescription(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
            <Button icon={<Plus size={14} />} disabled={busy || code.length < 2 || !description.trim()} onClick={() => void add()}>
              Crear
            </Button>
          </div>
        </Alert>
      </div>
    </Modal>
  );
}
