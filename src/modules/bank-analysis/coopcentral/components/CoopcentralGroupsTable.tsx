import { useMemo, useState } from "react";
import { Card } from "../../../../components/ui";
import { formatInteger, formatMoneyCents } from "../../../../utils/format";
import { SearchBox, SegmentedFilter, SortableTh, type SortDirection } from "../../shared/components/tableControls";
import { sortCoopcentralGroups, type CoopcentralSortKey } from "../services/grouping";
import type { CoopcentralGroup, TransactionType } from "../types";
import { CoopcentralGroupDetailModal } from "./CoopcentralGroupDetailModal";
import { amountClass, TypeLabel } from "./TypeLabel";

type Filter = "all" | TransactionType;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "credit", label: "Créditos" },
  { id: "debit", label: "Débitos" },
];

export function CoopcentralGroupsTable({ groups }: { groups: CoopcentralGroup[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: CoopcentralSortKey; direction: SortDirection }>({ key: "concept", direction: "asc" });
  const [selected, setSelected] = useState<CoopcentralGroup | null>(null);

  const visible = useMemo(() => {
    // Solo filtra la vista: los grupos originales no se modifican.
    const q = query.trim().toLocaleUpperCase("es");
    const filtered = groups.filter((g) => (filter === "all" || g.transactionType === filter) && (!q || g.concept.toLocaleUpperCase("es").includes(q)));
    return sortCoopcentralGroups(filtered, sort.key, sort.direction);
  }, [groups, query, filter, sort]);

  const toggleSort = (key: CoopcentralSortKey) =>
    setSort((s) => (s.key === key ? { key, direction: s.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "concept" || key === "type" ? "asc" : "desc" }));

  const header = (key: CoopcentralSortKey, label: string, numeric = false) => (
    <SortableTh label={label} active={sort.key === key} direction={sort.direction} numeric={numeric} onToggle={() => toggleSort(key)} />
  );

  return (
    <Card
      flush
      title="Movimientos agrupados"
      description="Agrupados por concepto exacto y tipo (crédito o débito). Haz clic en un grupo para ver sus movimientos."
      actions={
        <>
          <SearchBox placeholder="Buscar concepto..." value={query} onChange={setQuery} />
          <SegmentedFilter label="Filtrar por tipo" options={FILTERS} value={filter} onChange={setFilter} />
        </>
      }
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {header("concept", "Concepto")}
              {header("type", "Tipo")}
              {header("count", "Cantidad", true)}
              {header("total", "Total", true)}
            </tr>
          </thead>
          <tbody>
            {visible.map((g) => (
              <tr key={g.key} className="is-clickable" onClick={() => setSelected(g)}>
                <td className="table__primary">{g.concept}</td>
                <td>
                  <TypeLabel type={g.transactionType} />
                </td>
                <td className="num">{formatInteger(g.count)}</td>
                <td className={`num ${amountClass(g.transactionType)}`}>{formatMoneyCents(g.totalCents)}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="muted" style={{ textAlign: "center", padding: "var(--space-6)" }}>
                  Ningún grupo coincide con la búsqueda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <CoopcentralGroupDetailModal group={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}
