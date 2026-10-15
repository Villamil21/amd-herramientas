import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Field, Modal, Select, useToast } from "../../../../components/ui";
import { fsService } from "../../../../services/fsService";
import { errorMessage } from "../../../../services/tauri";
import { EERR_SECTIONS, ESF_SECTIONS, SECTION_LABEL, type FsCatalog, type FsLine, type FsPucMapping } from "../../../../types/fs";

/** «ESF › ACTIVO CORRIENTE › Disponible». */
export function lineLabel(line: FsLine): string {
  return `${ESF_SECTIONS.includes(line.section) ? "ESF" : "EERR"} › ${SECTION_LABEL[line.section]} › ${line.name}`;
}

/** Mapeo vigente más cercano de un padre (110505 para 11050501). Solo sugerencia. */
export function parentMapping(code: string, mappings: Map<string, FsPucMapping>): { parent: string; mapping: FsPucMapping } | undefined {
  for (let n = code.length - 1; n >= 1; n--) {
    const m = mappings.get(code.slice(0, n));
    if (m) return { parent: code.slice(0, n), mapping: m };
  }
  return undefined;
}

interface Props {
  open: boolean;
  pucCode: string;
  concept: string;
  catalog: FsCatalog | null;
  mappings: Map<string, FsPucMapping>;
  onClose: () => void;
  onSaved: () => void | Promise<unknown>;
}

/**
 * «Este código PUC todavía no está clasificado.» Asignar a una línea del ESF /
 * EERR o marcar «No afecta Estados Financieros». La clasificación de un padre
 * se muestra como sugerencia, nunca se aplica sola.
 */
export function ClassifyPucModal({ open, pucCode, concept, catalog, mappings, onClose, onSaved }: Props) {
  const toast = useToast();
  const current = mappings.get(pucCode);
  const [choice, setChoice] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggestion = useMemo(() => parentMapping(pucCode, mappings), [pucCode, mappings]);

  useEffect(() => {
    if (!open) return;
    setChoice(current ? (current.excluded ? "excluded" : String(current.lineId)) : "");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pucCode]);

  const active = (catalog?.lines ?? []).filter((l) => l.isActive);
  const lineById = new Map((catalog?.lines ?? []).map((l) => [l.id, l]));
  const suggestedLabel = suggestion ? (suggestion.mapping.excluded ? "No afecta Estados Financieros" : lineById.get(suggestion.mapping.lineId!)?.name) : undefined;

  async function save() {
    if (!choice) return;
    setSaving(true);
    setError(null);
    try {
      await fsService.setMapping(pucCode, choice === "excluded" ? null : Number(choice), choice === "excluded");
      toast(`${pucCode} clasificado.`);
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
      title={`${pucCode} — ${concept}`}
      description={current ? "Cambiar la clasificación recalcula los periodos abiertos; los cerrados conservan lo aprobado." : "Este código PUC todavía no está clasificado."}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!choice}>
            Guardar clasificación
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        {suggestion && !current && (
          <Alert tone="info" title="Sugerencia">
            Usar la misma clasificación de {suggestion.parent}: <strong>{suggestedLabel}</strong>.{" "}
            <Button size="sm" variant="ghost" onClick={() => setChoice(suggestion.mapping.excluded ? "excluded" : String(suggestion.mapping.lineId))}>
              Usar esta clasificación
            </Button>
          </Alert>
        )}
        <Field label="Destino en los Estados Financieros" required>
          {(id) => (
            <Select id={id} value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">Seleccionar…</option>
              {[ESF_SECTIONS, EERR_SECTIONS].map((sections, i) => (
                <optgroup key={i} label={i === 0 ? "Estado de Situación Financiera" : "Estado de Resultados"}>
                  {sections.flatMap((s) =>
                    active
                      .filter((l) => l.section === s)
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {SECTION_LABEL[s]} › {l.name}
                        </option>
                      )),
                  )}
                </optgroup>
              ))}
              <optgroup label="Otro">
                <option value="excluded">No afecta Estados Financieros</option>
              </optgroup>
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}
