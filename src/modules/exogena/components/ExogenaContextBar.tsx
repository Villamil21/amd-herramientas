import { Field, Select } from "../../../components/ui";
import type { Company } from "../../../types/models";
import { selectableYears } from "../domain/formats";
import { useExogenaSelection } from "../state";

interface Props {
  companies: Company[] | null;
}

/** Empresa y año a informar. El corte es siempre del 01/01 al 31/12 del año elegido. */
export function ExogenaContextBar({ companies }: Props) {
  const [selection, update] = useExogenaSelection();
  const years = selectableYears();
  if (!years.includes(selection.year)) years.push(selection.year);
  years.sort((a, b) => b - a);
  return (
    <div className="card context-bar">
      <div className="context-bar__main">
        <div className="form-grid form-grid--compact" style={{ alignItems: "end" }}>
          <Field label="Empresa" required>
            {(id) => (
              <Select id={id} value={selection.companyId ?? ""} disabled={!companies} onChange={(e) => update({ companyId: e.target.value ? Number(e.target.value) : null })} style={{ minWidth: 280 }}>
                <option value="">Seleccionar empresa…</option>
                {(companies ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.razonSocial} — NIT {c.nit}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Año a informar" required hint={`Del 01/01/${selection.year} al 31/12/${selection.year}`}>
            {(id) => (
              <Select id={id} value={selection.year} onChange={(e) => update({ year: Number(e.target.value) })}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
    </div>
  );
}
