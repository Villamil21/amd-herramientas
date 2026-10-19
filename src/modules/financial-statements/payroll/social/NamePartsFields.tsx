import { Field, Input } from "../../../../components/ui";
import type { EmployeeNamePartsInput } from "../../../../types/fs";
import { proposeNameSplit } from "./names";

/**
 * Apellidos y nombres del empleado tal como los pide el 2276. La planilla trae un único texto: aquí se PROPONE la separación
 * (dos primeros términos = apellidos) y solo vale cuando el usuario la confirma. Si no se puede separar con seguridad, se
 * deja vacía para que la escriba.
 */
export type NamePartsDraft = EmployeeNamePartsInput;

export const emptyParts = (): NamePartsDraft => ({ firstSurname: "", secondSurname: "", firstName: "", otherNames: "", confirm: false });

/** Propuesta inicial a partir del nombre completo (nunca confirmada). */
export function proposedParts(fullName: string): NamePartsDraft {
  const p = proposeNameSplit(fullName);
  return p ? { ...p, confirm: false } : emptyParts();
}

interface Props {
  fullName: string;
  value: NamePartsDraft;
  onChange: (next: NamePartsDraft) => void;
  /** Estado guardado en la ficha. */
  savedConfirmed: boolean;
}

export function NamePartsFields({ fullName, value, onChange, savedConfirmed }: Props) {
  const set = (key: keyof Omit<NamePartsDraft, "confirm">) => (e: { target: { value: string } }) => onChange({ ...value, [key]: e.target.value.toUpperCase(), confirm: false });
  const canConfirm = value.firstSurname.trim() !== "" && value.firstName.trim() !== "";
  const suggestion = proposeNameSplit(fullName);
  return (
    <div className="stack stack--sm">
      <strong>Apellidos y nombres (formato 2276)</strong>
      <span className="field__hint">
        {savedConfirmed ? "Separación confirmada." : suggestion ? "Es una propuesta a partir del nombre de la planilla: revísala y confírmala." : "El nombre no se puede separar con seguridad (menos de tres términos o apellidos compuestos): escríbela tú."}
      </span>
      <div className="form-grid form-grid--compact">
        <Field label="Primer apellido" required>
          {(id) => <Input id={id} value={value.firstSurname} onChange={set("firstSurname")} />}
        </Field>
        <Field label="Segundo apellido">{(id) => <Input id={id} value={value.secondSurname} onChange={set("secondSurname")} />}</Field>
        <Field label="Primer nombre" required>
          {(id) => <Input id={id} value={value.firstName} onChange={set("firstName")} />}
        </Field>
        <Field label="Otros nombres">{(id) => <Input id={id} value={value.otherNames} onChange={set("otherNames")} />}</Field>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={value.confirm} disabled={!canConfirm} onChange={(e) => onChange({ ...value, confirm: e.target.checked })} />
        <span>Confirmo esta separación de apellidos y nombres</span>
      </label>
    </div>
  );
}
