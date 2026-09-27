import { useEffect, useState } from "react";
import { Alert, Button, Field, Input, Modal, Select, useToast } from "../../components/ui";
import { conceptService } from "../../services/conceptService";
import { formatRate } from "../../utils/format";
import { parseRate } from "../../utils/numbers";
import {
  TIPO_RETENCION_LABEL, UNIDAD_TARIFA_LABEL, UNIDAD_TARIFA_SYMBOL,
  type Concept, type TipoRetencion, type UnidadTarifa,
} from "../../types/models";

/** Unidad sugerida por tipo (el usuario puede cambiarla). */
const DEFAULT_UNIT: Record<TipoRetencion, UnidadTarifa> = { ICA: "POR_MIL", RETEFUENTE: "PORCENTAJE" };

interface Props {
  open: boolean;
  concept: Concept | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ConceptFormModal({ open, concept, onClose, onSaved }: Props) {
  const toast = useToast();
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<TipoRetencion>("RETEFUENTE");
  const [unidad, setUnidad] = useState<UnidadTarifa>("PORCENTAJE");
  const [unitTouched, setUnitTouched] = useState(false);
  const [tarifa, setTarifa] = useState("");
  const [errors, setErrors] = useState<{ nombre?: string; tarifa?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNombre(concept?.nombre ?? "");
    setTipo(concept?.tipoRetencion ?? "RETEFUENTE");
    setUnidad(concept?.unidadTarifa ?? "PORCENTAJE");
    setUnitTouched(!!concept);
    setTarifa(concept?.tarifaPredeterminada != null ? formatRate(concept.tarifaPredeterminada) : "");
    setErrors({});
    setError(null);
  }, [open, concept]);

  async function save() {
    const errs: typeof errors = {};
    if (!nombre.trim()) errs.nombre = "El nombre es obligatorio.";
    const rate = tarifa.trim() ? parseRate(tarifa) : null;
    if (tarifa.trim() && (rate === null || rate <= 0)) errs.tarifa = "Escribe un número mayor que cero (hasta 4 decimales).";
    else if (rate !== null && unidad === "PORCENTAJE" && rate > 100) errs.tarifa = "No puede superar el 100 %.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    setError(null);
    const input = { nombre: nombre.trim(), tipoRetencion: tipo, unidadTarifa: unidad, tarifaPredeterminada: rate };
    try {
      if (concept) await conceptService.update(concept.id, input);
      else await conceptService.create(input);
      toast(concept ? "Concepto actualizado." : "Concepto creado.");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={concept ? "Editar concepto" : "Nuevo concepto"}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            {concept ? "Guardar cambios" : "Crear concepto"}
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Nombre del concepto" required error={errors.nombre}>
          {(id) => (
            <Input
              id={id}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              invalid={!!errors.nombre}
              placeholder="ICA APLICADO A SERVICIOS DECLARANTES"
              autoFocus
            />
          )}
        </Field>
        <div className="form-grid">
          <Field label="Tipo de retención" required hint="Define el título del certificado.">
            {(id) => (
              <Select
                id={id}
                value={tipo}
                onChange={(e) => {
                  const t = e.target.value as TipoRetencion;
                  setTipo(t);
                  if (!unitTouched) setUnidad(DEFAULT_UNIT[t]);
                }}
              >
                {Object.entries(TIPO_RETENCION_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Unidad de tarifa" required>
            {(id) => (
              <Select
                id={id}
                value={unidad}
                onChange={(e) => {
                  setUnidad(e.target.value as UnidadTarifa);
                  setUnitTouched(true);
                }}
              >
                {Object.entries(UNIDAD_TARIFA_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Tarifa predeterminada" hint="Opcional. Se puede modificar en cada certificado." error={errors.tarifa}>
            {(id) => (
              <div className="input-affix">
                <Input id={id} className="input--right" value={tarifa} onChange={(e) => setTarifa(e.target.value)} invalid={!!errors.tarifa} placeholder="9,66" inputMode="decimal" />
                <span className="input-affix__suffix">{UNIDAD_TARIFA_SYMBOL[unidad]}</span>
              </div>
            )}
          </Field>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
