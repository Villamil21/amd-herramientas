import { useState } from "react";
import { Building2, Plus } from "lucide-react";
import { Button, Card, EmptyState, Field, Select } from "../../../../components/ui";
import { LogoThumb } from "../../../../components/LogoThumb";
import { CompanyFormModal } from "../../../../pages/companies/CompanyFormModal";
import type { Company } from "../../../../types/models";

interface Props {
  companies: Company[];
  company: Company | null;
  onSelect: (id: number | null) => void;
  onCreated: (company: Company) => void;
  onNext: () => void;
}

export function CompanyStep({ companies, company, onSelect, onCreated, onNext }: Props) {
  const [creating, setCreating] = useState(false);

  return (
    <Card
      title="Empresa emisora"
      description="Empresa que genera el certificado. Sus datos y logo se toman automáticamente."
      footer={
        <Button variant="primary" onClick={onNext} disabled={!company}>
          Continuar
        </Button>
      }
    >
      {companies.length === 0 ? (
        <EmptyState
          icon={<Building2 size={20} />}
          title="Aún no hay empresas registradas"
          description="Crea la empresa emisora una sola vez; quedará guardada para los próximos certificados."
          action={
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
              Nueva empresa
            </Button>
          }
        />
      ) : (
        <div className="stack">
          <div className="row" style={{ alignItems: "flex-end", flexWrap: "nowrap" }}>
            <Field label="Empresa emisora" required className="span-2" >
              {(id) => (
                <Select id={id} value={company?.id ?? ""} onChange={(e) => onSelect(e.target.value ? Number(e.target.value) : null)} style={{ minWidth: 320 }}>
                  <option value="">Selecciona una empresa…</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.razonSocial}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button variant="ghost" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
              Nueva empresa
            </Button>
          </div>

          {company && (
            <div className="company-preview">
              <LogoThumb logoFile={company.logoFile} size="lg" />
              <dl>
                <dt>Razón social</dt>
                <dd>{company.razonSocial}</dd>
                <dt>NIT</dt>
                <dd>{company.nit}</dd>
                <dt>Dirección</dt>
                <dd>{company.direccion || "—"}</dd>
                <dt>Teléfono</dt>
                <dd>{company.telefono || "—"}</dd>
                <dt>Ciudad</dt>
                <dd>{company.ciudad || "—"}</dd>
              </dl>
            </div>
          )}
        </div>
      )}

      <CompanyFormModal
        open={creating}
        company={null}
        onClose={() => setCreating(false)}
        onSaved={(c) => {
          setCreating(false);
          onCreated(c);
        }}
      />
    </Card>
  );
}
