import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Card } from "../../../../../components/ui";
import { formatInteger } from "../../../../../utils/format";
import { SearchBox, SegmentedFilter } from "../../../../bank-analysis/shared/components/tableControls";
import { UIAF_COLUMNS, type UiafRecord, type UiafTypeGroup } from "../types";

const PAGE_SIZE = 100;

/** Texto de búsqueda por registro, calculado una vez por archivo. */
const searchIndex = new WeakMap<UiafRecord, string>();
const searchable = (r: UiafRecord) => {
  let s = searchIndex.get(r);
  if (s === undefined) searchIndex.set(r, (s = r.values.join("\u0001").toLocaleUpperCase("es")));
  return s;
};

/**
 * Vista previa por Código Tipo con las 26 columnas, en el orden del TXT.
 * Buscar y paginar solo cambian la vista; la exportación usa todos los registros.
 */
export function UiafRecordsTable({ groups }: { groups: UiafTypeGroup[] }) {
  const tabs = groups.filter((g) => g.known || g.records.length > 0);
  const [active, setActive] = useState(tabs[0]?.codeType ?? "");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const group = tabs.find((g) => g.codeType === active) ?? tabs[0];

  const visible = useMemo(() => {
    const q = query.trim().toLocaleUpperCase("es");
    const records = group?.records ?? [];
    return q ? records.filter((r) => searchable(r).includes(q)) : records;
  }, [group, query]);

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const rows = visible.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const from = visible.length === 0 ? 0 : current * PAGE_SIZE + 1;

  if (!group) return null;
  return (
    <Card
      flush
      title="Vista previa"
      description="Registros en el mismo orden del TXT. La búsqueda solo afecta la vista previa; el Excel incluye todos los registros."
      actions={
        <SearchBox
          placeholder="Buscar registro, identificación, nombre, wallet, NIT…"
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(0);
          }}
        />
      }
    >
      <div className="toolbar row--between">
        <SegmentedFilter
          label="Código Tipo"
          options={tabs.map((g) => ({ id: g.codeType, label: `${g.label} (${formatInteger(g.records.length)})` }))}
          value={group.codeType}
          onChange={(id) => {
            setActive(id);
            setPage(0);
          }}
        />
        <span className="muted">
          Hoja «{group.sheetName}» en el Excel
          {query.trim() && ` · ${formatInteger(visible.length)} ${visible.length === 1 ? "coincidencia" : "coincidencias"}`}
        </span>
      </div>
      <div className="table-wrap table-wrap--scroll">
        <table className="table uiaf-table">
          <thead>
            <tr>
              {UIAF_COLUMNS.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.line}>
                {r.values.map((v, i) => (
                  <td key={i} className={i === 0 ? "table__primary selectable" : "selectable"}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={UIAF_COLUMNS.length} className="muted uiaf-table__empty">
                  {query.trim() ? "Ningún registro coincide con la búsqueda." : "No hay registros con este Código Tipo."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {visible.length > PAGE_SIZE && (
        <div className="uiaf-pager row row--between">
          <span className="muted">
            {formatInteger(from)}–{formatInteger(from + rows.length - 1)} de {formatInteger(visible.length)}
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
