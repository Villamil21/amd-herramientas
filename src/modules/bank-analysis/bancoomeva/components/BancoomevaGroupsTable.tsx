import { useMemo, useState } from "react";
import { Card } from "../../../../components/ui";
import { formatInteger, formatMoneyCents } from "../../../../utils/format";
import { SearchBox, SegmentedFilter, SortableTh, type SortDirection } from "../../shared/components/tableControls";
import { amountClass, TypeLabel } from "../../shared/components/TypeLabel";
import type { TransactionType } from "../../shared/types";
import { sortBancoomevaGroups, type BancoomevaSortKey } from "../services/grouping";
import type { BancoomevaGroup } from "../types";
import { BancoomevaGroupDetailModal } from "./BancoomevaGroupDetailModal";

type Filter = "all" | TransactionType;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "credit", label: "Créditos" },
  { id: "debit", label: "Débitos" },
];

export function BancoomevaGroupsTable({ groups }: { groups: BancoomevaGroup[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: BancoomevaSortKey; direction: SortDirection }>({ key: "description", direction: "asc" });
  const [selected, setSelected] = useState<BancoomevaGroup | null>(null);

  const visible = useMemo(() => {
    // Solo filtra la vista: los grupos originales no se modifican.
    const q = query.trim().toLocaleUpperCase("es");
    const filtered = groups.filter((g) => (filter === "all" || g.transactionType === filter) && (!q || g.description.toLocaleUpperCase("es").includes(q)));
    return sortBancoomevaGroups(filtered, sort.key, sort.direction);
  }, [groups, query, filter, sort]);

  const toggleSort = (key: BancoomevaSortKey) =>
    setSort((s) => (s.key === key ? { key, direction: s.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "description" || key === "type" ? "asc" : "desc" }));

  const header = (key: BancoomevaSortKey, label: string, numeric = false) => (
    <SortableTh label={label} active={sort.key === key} direction={sort.direction} numeric={numeric} onToggle={() => toggleSort(key)} />
  );

  return (
    <Card
      flush
      title="Movimientos agrupados"
      description="Agrupados por descripción exacta y tipo (crédito o débito). Haz clic en un grupo para ver sus movimientos."
      actions={
        <>
          <SearchBox placeholder="Buscar descripción..." value={query} onChange={setQuery} />
          <SegmentedFilter label="Filtrar por tipo" options={FILTERS} value={filter} onChange={setFilter} />
        </>
      }
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {header("description", "Descripción")}
              {header("type", "Tipo")}
              {header("count", "Cantidad", true)}
              {header("total", "Total", true)}
            </tr>
          </thead>
          <tbody>
            {visible.map((g) => (
              <tr key={g.key} className="is-clickable" onClick={() => setSelected(g)}>
                <td className="table__primary">{g.description}</td>
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
      <BancoomevaGroupDetailModal group={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}
