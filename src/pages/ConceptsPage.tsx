import { useState } from "react";
import { Pencil, Percent, Plus, Search, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Input, Loader, PageHeader, useToast } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { useDebounced } from "../hooks/useDebounced";
import { conceptService } from "../services/conceptService";
import { formatRate } from "../utils/format";
import { TIPO_RETENCION_LABEL, UNIDAD_TARIFA_SYMBOL, type Concept } from "../types/models";
import { ConceptFormModal } from "./concepts/ConceptFormModal";

export function ConceptsPage() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const query = useDebounced(search);
  const list = useAsync(() => conceptService.list(query), [query]);
  const [editing, setEditing] = useState<Concept | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Concept | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await conceptService.remove(deleting.id);
      toast("Concepto eliminado.");
      setDeleting(null);
      void list.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const concepts = list.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Datos"
        title="Conceptos de retención"
        description="Conceptos reutilizables en los certificados. La tarifa predeterminada se puede ajustar en cada certificado."
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing(null)}>
            Nuevo concepto
          </Button>
        }
      />
      <Card
        flush
        title="Conceptos registrados"
        actions={
          <div className="search">
            <Search size={14} />
            <Input placeholder="Buscar concepto" value={search} onChange={(e) => setSearch(e.target.value)} />
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
        ) : concepts.length === 0 ? (
          <EmptyState
            icon={<Percent size={20} />}
            title={query ? "Sin resultados" : "Aún no hay conceptos"}
            description={query ? "Ningún concepto coincide con la búsqueda." : "Crea conceptos como «ICA APLICADO A SERVICIOS DECLARANTES» para seleccionarlos en los certificados."}
            action={!query && <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing(null)}>Nuevo concepto</Button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th>Tipo</th>
                  <th className="num">Tarifa predeterminada</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {concepts.map((c) => (
                  <tr key={c.id} className="is-clickable" onClick={() => setEditing(c)}>
                    <td className="table__primary">{c.nombre}</td>
                    <td>
                      <Badge tone={c.tipoRetencion === "ICA" ? "gold" : "dark"}>{TIPO_RETENCION_LABEL[c.tipoRetencion] ?? c.tipoRetencion}</Badge>
                    </td>
                    <td className="num">
                      {c.tarifaPredeterminada != null ? `${formatRate(c.tarifaPredeterminada)} ${UNIDAD_TARIFA_SYMBOL[c.unidadTarifa]}` : <span className="muted">— {UNIDAD_TARIFA_SYMBOL[c.unidadTarifa]}</span>}
                    </td>
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

      <ConceptFormModal
        open={editing !== undefined}
        concept={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSaved={() => {
          setEditing(undefined);
          void list.reload();
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        danger
        title="Eliminar concepto"
        confirmLabel="Eliminar"
        loading={busy}
        message={
          <>
            Se eliminará <strong>{deleting?.nombre}</strong>. Los certificados ya generados no se modifican.
          </>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
