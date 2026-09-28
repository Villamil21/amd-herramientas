import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { Card, Input } from "../../../../components/ui";
import { formatInteger, formatMoneyCents } from "../../../../utils/format";
import { sortGroups, type GroupSortKey, type SortDirection } from "../groupingService";
import type { MovementGroup, Sign } from "../types";
import { GroupDetailModal } from "./GroupDetailModal";
import { SignLabel } from "./SignLabel";

type Filter = "all" | Sign;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "positive", label: "Positivos" },
  { id: "negative", label: "Negativos" },
  { id: "zero", label: "Cero" },
];

export function GroupsTable({ groups }: { groups: MovementGroup[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: GroupSortKey; direction: SortDirection }>({ key: "description", direction: "asc" });
  const [selected, setSelected] = useState<MovementGroup | null>(null);

  const hasZero = groups.some((g) => g.sign === "zero");
  const visible = useMemo(() => {
    // Solo filtra la vista: los grupos originales no se modifican.
    const q = query.trim().toLocaleUpperCase("es");
    const filtered = groups.filter((g) => (filter === "all" || g.sign === filter) && (!q || g.description.toLocaleUpperCase("es").includes(q)));
    return sortGroups(filtered, sort.key, sort.direction);
  }, [groups, query, filter, sort]);

  const toggleSort = (key: GroupSortKey) =>
    setSort((s) => (s.key === key ? { key, direction: s.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "description" ? "asc" : "desc" }));

  const header = (key: GroupSortKey, label: string, numeric = false) => {
    const active = sort.key === key;
    const Arrow = sort.direction === "asc" ? ArrowUp : ArrowDown;
    return (
      <th className={numeric ? "num" : undefined} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
        <button className={`th-sort ${active ? "is-active" : ""}`} onClick={() => toggleSort(key)}>
          {label}
          {active && <Arrow size={12} />}
        </button>
      </th>
    );
  };

  return (
    <Card
      flush
      title="Movimientos agrupados"
      description="Agrupados por descripción exacta y signo del valor. Haz clic en un grupo para ver sus movimientos."
      actions={
        <>
          <div className="search">
            <Search size={14} />
            <Input placeholder="Buscar descripción..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="segmented" role="group" aria-label="Filtrar por tipo">
            {FILTERS.filter((f) => f.id !== "zero" || hasZero).map((f) => (
              <button key={f.id} className={filter === f.id ? "is-active" : undefined} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </>
      }
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {header("description", "Descripción")}
              <th>Tipo</th>
              {header("count", "Cantidad", true)}
              {header("total", "Total", true)}
            </tr>
          </thead>
          <tbody>
            {visible.map((g) => (
              <tr key={g.key} className="is-clickable" onClick={() => setSelected(g)}>
                <td className="table__primary">{g.description}</td>
                <td>
                  <SignLabel sign={g.sign} />
                </td>
                <td className="num">{formatInteger(g.count)}</td>
                <td className={`num amount--${g.sign}`}>{formatMoneyCents(g.totalCents)}</td>
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
      <GroupDetailModal group={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}
