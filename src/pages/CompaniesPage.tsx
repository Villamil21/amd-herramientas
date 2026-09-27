import { useState } from "react";
import { Building2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Alert, Button, Card, ConfirmDialog, EmptyState, Input, Loader, PageHeader, useToast } from "../components/ui";
import { LogoThumb } from "../components/LogoThumb";
import { useAsync } from "../hooks/useAsync";
import { useDebounced } from "../hooks/useDebounced";
import { companyService } from "../services/companyService";
import type { Company } from "../types/models";
import { CompanyFormModal } from "./companies/CompanyFormModal";

export function CompaniesPage() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const query = useDebounced(search);
  const list = useAsync(() => companyService.list(query), [query]);
  const [editing, setEditing] = useState<Company | null | undefined>(undefined); // undefined = cerrado
  const [deleting, setDeleting] = useState<Company | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await companyService.remove(deleting.id);
      toast("Empresa eliminada.");
      setDeleting(null);
      void list.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const companies = list.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Datos"
        title="Empresas"
        description="Empresas que emiten documentos y certificados. Sus datos y logo se reutilizan en todos los módulos."
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing(null)}>
            Nueva empresa
          </Button>
        }
      />
      <Card
        flush
        title="Empresas registradas"
        actions={
          <div className="search">
            <Search size={14} />
            <Input placeholder="Buscar por nombre, NIT o ciudad" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        }
      >
        {list.error && (
          <div className="card__body">
            <Alert tone="danger">{list.error}</Alert>
          </div>
        )}
        {list.loading && !list.data ? (
          <Loader />
        ) : companies.length === 0 ? (
          <EmptyState
            icon={<Building2 size={20} />}
            title={query ? "Sin resultados" : "Aún no hay empresas"}
            description={query ? "Ninguna empresa coincide con la búsqueda." : "Crea la primera empresa emisora para usarla en los certificados."}
            action={!query && <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing(null)}>Nueva empresa</Button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Ciudad</th>
                  <th>Teléfono</th>
                  <th>Correo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="is-clickable" onClick={() => setEditing(c)}>
                    <td>
                      <div className="company-cell">
                        <LogoThumb logoFile={c.logoFile} />
                        <div>
                          <div className="table__primary">{c.razonSocial}</div>
                          <div className="table__secondary">NIT {c.nit}</div>
                        </div>
                      </div>
                    </td>
                    <td>{c.ciudad || <span className="muted">—</span>}</td>
                    <td>{c.telefono || <span className="muted">—</span>}</td>
                    <td>{c.correo || <span className="muted">—</span>}</td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" iconOnly icon={<Pencil size={14} />} aria-label="Editar" onClick={() => setEditing(c)} />
                      <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} aria-label="Eliminar" onClick={() => setDeleting(c)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CompanyFormModal
        open={editing !== undefined}
        company={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSaved={() => {
          setEditing(undefined);
          void list.reload();
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        danger
        title="Eliminar empresa"
        confirmLabel="Eliminar"
        loading={busy}
        message={
          <>
            Se eliminará <strong>{deleting?.razonSocial}</strong> y su logo. Esta acción no se puede deshacer.
          </>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
