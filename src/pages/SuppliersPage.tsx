import { useEffect, useState } from "react";
import { HandCoins, IdCard, Pencil, Plus, Search, Store, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Input, Loader, PageHeader, useToast } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { useDebounced } from "../hooks/useDebounced";
import { supplierService } from "../services/supplierService";
import { withholdingService } from "../services/withholdingService";
import { RETENTION_TYPE_LABEL, VAT_TYPE_LABEL, type Supplier } from "../types/models";
import { regimeCodes } from "./suppliers/FiscalRegimeField";
import { SupplierFormModal } from "./suppliers/SupplierFormModal";
import { SupplierWithholdingModal } from "./suppliers/SupplierWithholdingModal";

/** Un proveedor persona natural cuya factura no reveló el tipo de documento: el usuario debe elegirlo (no se supone el 13). */
export const needsDocumentType = (s: Supplier) => (s.personType ?? null) === "PN" && !s.docTypeCode;

export function SuppliersPage({ initialNit = "" }: { /** NIT que se quiere crear o buscar (viene de un pendiente de Exógena). */ initialNit?: string }) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const query = useDebounced(search);
  const list = useAsync(() => supplierService.list(query), [query]);
  const rates = useAsync(() => withholdingService.listRates(), []);
  const [editing, setEditing] = useState<Supplier | null | undefined>(undefined);
  const [withholding, setWithholding] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState<Supplier | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ nit: string; businessName: string } | undefined>();

  // Enlace desde un pendiente («Falta el proveedor DIAN»): abre la búsqueda y, si no existe, el formulario con el NIT puesto.
  useEffect(() => {
    if (!initialNit || !list.data) return;
    const found = list.data.find((s) => s.nit === initialNit);
    if (found) setEditing(found);
    else {
      setDraft({ nit: initialNit, businessName: "" });
      setEditing(null);
    }
    // Solo al llegar con un NIT: después manda lo que haga el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNit, list.data !== null]);

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
  const pendingDocumentType = suppliers.filter(needsDocumentType);

  return (
    <>
      <PageHeader
        eyebrow="Datos"
        title="Proveedores"
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing(null)}>
            Nuevo proveedor
          </Button>
        }
      />
      {pendingDocumentType.length > 0 && (
        <Alert tone="warning" title="Tipo de documento pendiente">
          <div className="stack stack--sm">
            <span>Estas personas naturales no revelaron su tipo de documento en la factura. Elígelo en su ficha (no se supone): sin él no se pueden cerrar los formatos de Información Exógena.</span>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {pendingDocumentType.map((s) => (
                <Button key={s.id} size="sm" icon={<IdCard size={14} />} onClick={() => setEditing(s)}>
                  {s.businessName} · {s.nit}
                </Button>
              ))}
            </div>
          </div>
        </Alert>
      )}
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
                  <th>PJ / PN</th>
                  <th>Exógena</th>
                  <th>Régimen</th>
                  <th>Retención</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className="is-clickable" onClick={() => setEditing(s)}>
                    <td className="selectable">{s.nit}</td>
                    <td className="table__primary">{s.businessName}</td>
                    <td>
                      {s.vatType ? <Badge tone={s.vatType === "service" ? "gold" : "dark"}>{VAT_TYPE_LABEL[s.vatType] ?? s.vatType}</Badge> : <span className="muted">Sin configurar</span>}
                    </td>
                    <td>{s.personType ?? <span className="muted">—</span>}</td>
                    <td>
                      {s.dataStatus === "completo" ? <Badge tone="success">Completo</Badge> : needsDocumentType(s) ? <Badge tone="warning">Tipo de documento pendiente</Badge> : <Badge tone="warning">Requiere datos</Badge>}
                    </td>
                    <td className="selectable">
                      {s.fiscalRegime ? (
                        <span className="regime-codes">
                          {regimeCodes(s.fiscalRegime).map((c) => (
                            <span key={c} className="regime-code">
                              {c}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={{ minWidth: 200 }}>
                      {(s.withholdingRules ?? []).length === 0 ? (
                        <span className="muted">Sin configurar</span>
                      ) : (
                        (s.withholdingRules ?? []).map((r) => {
                          const rate = rates.data?.find((x) => x.id === r.rateId);
                          return (
                            <div key={r.id} style={{ fontSize: "var(--text-sm)" }}>
                              {rate ? `${RETENTION_TYPE_LABEL[rate.retentionType]} — ${rate.name}` : "Subtipo eliminado"}
                              {r.isDefault && (s.withholdingRules ?? []).length > 1 && <span className="muted"> (predeterminada)</span>}
                            </div>
                          );
                        })
                      )}
                    </td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" iconOnly icon={<HandCoins size={14} />} aria-label="Retención en la fuente" title="Retención en la fuente" onClick={() => setWithholding(s)} />
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
        draft={editing === null ? draft : undefined}
        rates={rates.data ?? []}
        onClose={() => {
          setEditing(undefined);
          setDraft(undefined);
        }}
        onSaved={() => {
          setEditing(undefined);
          setDraft(undefined);
          void list.reload();
        }}
      />
      <SupplierWithholdingModal
        open={withholding !== null}
        supplier={withholding}
        rates={rates.data ?? []}
        onClose={() => setWithholding(null)}
        onSaved={() => {
          setWithholding(null);
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
