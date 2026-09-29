import { useState } from "react";
import { Pencil, Plus, Search, Store, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Input, Loader, PageHeader, useToast } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { useDebounced } from "../hooks/useDebounced";
import { supplierService } from "../services/supplierService";
import { VAT_TYPE_LABEL, type Supplier } from "../types/models";
import { SupplierFormModal } from "./suppliers/SupplierFormModal";

export function SuppliersPage() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const query = useDebounced(search);
  const list = useAsync(() => supplierService.list(query), [query]);
  const [editing, setEditing] = useState<Supplier | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Supplier | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await supplierService.remove(deleting.id);
      toast("Proveedor eliminado.");
      setDeleting(null);
      void list.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const suppliers = list.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Datos"
        title="Proveedores"
        description="Clasificación de IVA de cada proveedor. El análisis de facturas la aplica automáticamente según el NIT."
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing(null)}>
            Nuevo proveedor
          </Button>
        }
      />
      <Card
        flush
        title="Proveedores registrados"
        actions={
          <div className="search">
            <Search size={14} />
            <Input placeholder="Buscar por NIT o razón social" value={search} onChange={(e) => setSearch(e.target.value)} />
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
        ) : suppliers.length === 0 ? (
          <EmptyState
            icon={<Store size={20} />}
            title={query ? "Sin resultados" : "Aún no hay proveedores"}
            description={query ? "Ningún proveedor coincide con la búsqueda." : "Créalos aquí o directamente desde el análisis de IVA de facturas, con los datos extraídos del PDF."}
            action={!query && <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing(null)}>Nuevo proveedor</Button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>NIT</th>
                  <th>Razón social</th>
                  <th>Tipo IVA</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className="is-clickable" onClick={() => setEditing(s)}>
                    <td className="selectable">{s.nit}</td>
                    <td className="table__primary">{s.businessName}</td>
                    <td>
                      <Badge tone={s.vatType === "service" ? "gold" : "dark"}>{VAT_TYPE_LABEL[s.vatType] ?? s.vatType}</Badge>
                    </td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" iconOnly icon={<Pencil size={14} />} aria-label="Editar" onClick={() => setEditing(s)} />
                      <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} aria-label="Eliminar" onClick={() => setDeleting(s)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <SupplierFormModal
        open={editing !== undefined}
        supplier={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSaved={() => {
          setEditing(undefined);
          void list.reload();
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        danger
        title="Eliminar proveedor"
        confirmLabel="Eliminar"
        loading={busy}
        message={
          <>
            Se eliminará <strong>{deleting?.businessName}</strong> (NIT {deleting?.nit}). Sus facturas volverán a pedir clasificación en el próximo análisis.
          </>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
