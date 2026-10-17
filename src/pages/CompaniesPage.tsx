import { useEffect, useRef, useState } from "react";
import { Building2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Alert, Button, Card, ConfirmDialog, EmptyState, Input, Loader, Menu, PageHeader, useToast } from "../components/ui";
import { LogoThumb } from "../components/LogoThumb";
import { useAsync } from "../hooks/useAsync";
import { useDebounced } from "../hooks/useDebounced";
import { companyService } from "../services/companyService";
import type { Company } from "../types/models";
import { findCompanyByNit } from "../modules/financial-statements/shared/companyMatch";
import { getPendingReturn, patchPendingReturn } from "../modules/financial-statements/purchases/pendingReturn";
import { CompanyFormModal } from "./companies/CompanyFormModal";
import type { CompanyTab } from "./companies/companyTabs";
import { COMPANY_STATE_LABEL, companyStatus } from "./companies/companyStatus";

export function CompaniesPage() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const query = useDebounced(search);
  const list = useAsync(() => companyService.list(query), [query]);
  const [editing, setEditing] = useState<Company | null | undefined>(undefined); // undefined = cerrado
  const [deleting, setDeleting] = useState<Company | null>(null);
  const [busy, setBusy] = useState(false);
  const [startTab, setStartTab] = useState<CompanyTab | undefined>(undefined);
  const opened = useRef(false);

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

  // Llegada desde el panel de pendientes de Compras: abre la ficha exacta (pestaña fiscal) y deja la ruta de regreso.
  useEffect(() => {
    const ctx = getPendingReturn();
    if (opened.current || !ctx?.openCompanyNit || !list.data || query) return;
    opened.current = true;
    const target = findCompanyByNit(list.data, ctx.openCompanyNit);
    patchPendingReturn({ openCompanyNit: undefined });
    if (!target) return;
    setStartTab(ctx.companyTab);
    setEditing(target);
  }, [list.data, query]);

  return (
    <>
      <PageHeader
        eyebrow="Datos"
        title="Empresas"
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
                  <th>Estado</th>
                  <th className="actions">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => {
                  const status = companyStatus(c);
                  return (
                    <tr
                      key={c.id}
                      className="is-clickable company-row"
                      tabIndex={0}
                      onClick={() => setEditing(c)}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setEditing(c);
                        }
                      }}
                    >
                      <td>
                        <div className="company-cell">
                          <LogoThumb logoFile={c.logoFile} />
                          <div>
                            <div className="table__primary">{c.razonSocial}</div>
                            <div className="table__secondary nowrap selectable">
                              NIT {c.nit}
                              {c.dv ? `-${c.dv}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>{c.ciudad || <span className="muted">—</span>}</td>
                      <td>
                        <span className={`state-pill state-pill--${status.state}`} title={status.detail}>
                          {COMPANY_STATE_LABEL[status.state]}
                        </span>
                      </td>
                      <td className="actions" onClick={(e) => e.stopPropagation()}>
                        <Menu
                          label={`Acciones de ${c.razonSocial}`}
                          items={[
                            { label: "Abrir ficha", icon: <Pencil size={14} />, onSelect: () => setEditing(c) },
                            { label: "Eliminar", icon: <Trash2 size={14} />, danger: true, onSelect: () => setDeleting(c) },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CompanyFormModal
        open={editing !== undefined}
        company={editing ?? null}
        keepOpenOnCreate
        initialTab={startTab}
        onClose={() => {
          setEditing(undefined);
          setStartTab(undefined);
        }}
        onSaved={() => void list.reload()}
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
