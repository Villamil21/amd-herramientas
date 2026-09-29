import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Card } from "../../../../components/ui";
import { formatInteger } from "../../../../utils/format";
import { normalizeKey } from "../../../../utils/text";
import { SearchBox, SegmentedFilter } from "../../../bank-analysis/shared/components/tableControls";
import { classifyStatus } from "../services/statuses";
import { formatCop } from "../services/format";
import type { DropiOrderRow, StatusCategory, StatusRules } from "../types";
import { CategoryBadge } from "./CategoryBadge";

const PAGE_SIZE = 100;

type Filter = "all" | StatusCategory;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "delivered", label: "Entregados" },
  { id: "returned", label: "Devoluciones" },
  { id: "cancelled_group", label: "Cancelados/Rechazados" },
  { id: "in_process", label: "En proceso" },
  { id: "claim", label: "Siniestro" },
  { id: "indemnity", label: "Indemnización" },
  { id: "unclassified", label: "Sin clasificar" },
];

/** Texto de búsqueda por fila (ID, estado, guía, factura y cliente), calculado una vez. */
const searchIndex = new WeakMap<DropiOrderRow, string>();
const searchable = (r: DropiOrderRow) => {
  let s = searchIndex.get(r);
  if (s === undefined) searchIndex.set(r, (s = normalizeKey([r.id, r.status, r.guide, r.invoice, r.customer].filter(Boolean).join(" "))));
  return s;
};

/** Órdenes del archivo, con buscador y filtros. Solo cambian la vista; el cierre usa todas las filas. */
export function OrdersTable({ rows, rules }: { rows: DropiOrderRow[]; rules: StatusRules }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);

  const categorized = useMemo(() => rows.map((r) => ({ row: r, category: classifyStatus(r.statusKey, rules) })), [rows, rules]);
  const visible = useMemo(() => {
    const q = normalizeKey(query);
    return categorized.filter((c) => (filter === "all" || c.category === filter) && (!q || searchable(c.row).includes(q)));
  }, [categorized, query, filter]);

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = visible.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const from = visible.length === 0 ? 0 : current * PAGE_SIZE + 1;
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };

  return (
    <Card flush title="Órdenes" description="Busca por ID, estado, número de guía, número de factura o cliente. Los filtros solo cambian la vista.">
      <div className="toolbar row--between">
        <SegmentedFilter label="Filtrar órdenes" options={FILTERS} value={filter} onChange={reset(setFilter)} />
        <SearchBox placeholder="ID, estado, guía, factura o cliente" value={query} onChange={reset(setQuery)} />
      </div>
      <div className="table-wrap table-wrap--scroll">
        <table className="table">
          <thead>
            <tr>
              <th className="num">Fila</th>
              <th>ID</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Número guía</th>
              <th>Número factura</th>
              <th>Estado</th>
              <th>Clasificación</th>
              <th className="num">Valor compra productos</th>
              <th className="num">Total precios proveedor</th>
              <th className="num">Precio flete</th>
              <th className="num">Costo devolución flete</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={12} className="muted" style={{ textAlign: "center", padding: "var(--space-6)" }}>
                  Ninguna orden coincide con la búsqueda o el filtro.
                </td>
              </tr>
            )}
            {shown.map(({ row: r, category }) => (
              <tr key={r.rowNumber}>
                <td className="num muted">{r.rowNumber}</td>
                <td className="table__primary selectable" style={{ whiteSpace: "nowrap" }}>
                  {r.id || "—"}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{r.date ?? "—"}</td>
                <td style={{ minWidth: 180 }}>{r.customer ?? "—"}</td>
                <td className="selectable" style={{ whiteSpace: "nowrap" }}>
                  {r.guide ?? "—"}
                </td>
                <td className="selectable" style={{ whiteSpace: "nowrap" }}>
                  {r.invoice ?? "—"}
                </td>
                <td style={{ minWidth: 160 }}>{r.status || "—"}</td>
                <td>
                  <CategoryBadge category={category} />
                </td>
                <td className="num">{formatCop(r.purchaseCents)}</td>
                <td className="num">{formatCop(r.supplierCents)}</td>
                <td className="num">{formatCop(r.freightCents)}</td>
                <td className="num">{formatCop(r.returnFreightCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length > PAGE_SIZE && (
        <div className="uiaf-pager row row--between">
          <span className="muted">
            {formatInteger(from)}–{formatInteger(from + shown.length - 1)} de {formatInteger(visible.length)}
          </span>
          <div className="row">
            <Button size="sm" icon={<ChevronLeft size={14} />} disabled={current === 0} onClick={() => setPage(current - 1)}>
              Anterior
            </Button>
            <span className="muted">
              Página {formatInteger(current + 1)} de {formatInteger(pages)}
            </span>
            <Button size="sm" icon={<ChevronRight size={14} />} disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
