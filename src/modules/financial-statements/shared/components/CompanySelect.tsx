import { navigate, paths } from "../../../../app/router";
import { Button, Field, Select } from "../../../../components/ui";
import type { Company } from "../../../../types/models";

interface Props {
  companies: Company[] | null;
  value: number | null;
  onChange: (id: number | null) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
}

/** Empresa a la que pertenece la información (la entidad que separa toda la información financiera). */
export function CompanySelect({ companies, value, onChange, label = "Empresa", hint, disabled }: Props) {
  if (companies && companies.length === 0) {
    return (
      <Field label={label}>
        {() => (
          <div className="row">
            <span className="muted">No hay empresas registradas.</span>
            <Button size="sm" onClick={() => navigate(paths.companies)}>
              Ir a Empresas
            </Button>
          </div>
        )}
      </Field>
    );
  }
  return (
    <Field label={label} required hint={hint}>
      {(id) => (
        <Select id={id} value={value ?? ""} disabled={disabled || !companies} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} style={{ minWidth: 260 }}>
          <option value="">Seleccionar empresa…</option>
          {(companies ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.razonSocial} — NIT {c.nit}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
