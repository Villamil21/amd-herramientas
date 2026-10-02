import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge, Button, Card } from "../../../../components/ui";
import { SALES_CATEGORY_LABEL } from "../../../../types/models";
import { formatInteger } from "../../../../utils/format";
import { normalizeKey } from "../../../../utils/text";
import { SearchBox, SegmentedFilter } from "../../../bank-analysis/shared/components/tableControls";
import { ROW_STATUS_LABEL } from "../services/excelExport";
import { TAX_COLUMNS, type AnalyzedRow } from "../types";
import { formatMicro } from "./format";

export type SalesFilter = "all" | "invoice" | "credit_note" | "review";

const matches = (r: AnalyzedRow, f: SalesFilter) => (f === "all" ? true : f === "review" ? r.status !== "ok" : r.status === "ok" && r.category === f);

const STATUS_TONE: Record<AnalyzedRow["status"], "success" | "warning" | "danger"> = {
  ok: "success",
  duplicate: "warning",
  invalid: "danger",
  no_type: "danger",
  unclassified: "danger",
};

/** Ancla para llevar la vista a la tabla desde los pendientes. */
export const SALES_DOCUMENTS_ANCHOR = "sales-documents";

/** Monto de una celda, o su texto original si no es numérico. */
function amount(r: AnalyzedRow, column: string, value: bigint | null) {
  if (value !== null) return formatMicro(value);
  return <span className="amount--negative">«{r.invalid.find((i) => i.column === column)?.text}»</span>;
}

/** Detalle de documentos con «Ver detalle de cálculo»: Total − IVA … − ICUI = Base. */
export function SalesDocumentsTable({ rows, filter, onFilterChange }: { rows: AnalyzedRow[]; filter: SalesFilter; onFilterChange: (f: SalesFilter) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());

  const count = (f: SalesFilter) => rows.filter((r) => matches(r, f)).length;
  const options: { id: SalesFilter; label: string }[] = [
    { id: "all", label: `Todos (${formatInteger(rows.length)})` },
    { id: "invoice", label: `Facturas (${formatInteger(count("invoice"))})` },
    { id: "credit_note", label: `Notas Crédito (${formatInteger(count("credit_note"))})` },
    { id: "review", label: `Requieren revisión (${formatInteger(count("review"))})` },
  ];

  const visible = useMemo(() => {
    const q = normalizeKey(query);
    return rows.filter((r) => matches(r, filter) && (!q || normalizeKey([r.prefix, r.folio, `${r.prefix}${r.folio}`, r.documentType, r.cufe, r.issueDate].join(" ")).includes(q)));
  }, [rows, query, filter]);

  const toggle = (rowNumber: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });

  return (
    <Card id={SALES_DOCUMENTS_ANCHOR} flush title="Detalle de documentos" description="Base = Total − (IVA + ICA + IC + INC + Timbre + INC Bolsas + IN Carbono + IN Combustibles + IC Datos + ICL + INPP + IBUA + ICUI).">
      <div className="toolbar row--between">
        <SegmentedFilter label="Filtrar documentos" options={options} value={filter} onChange={onFilterChange} />
        <SearchBox placeholder="Prefijo, folio, tipo o CUFE" value={query} onChange={setQuery} />
      </div>
      <div className="table-wrap table-wrap--scroll">
        <table className="table">
          <thead>
            <tr>
              <th aria-label="Detalle de cálculo" />
              <th>Tipo</th>
              <th>Folio</th>
              <th>Prefijo</th>
              <th>Fecha Emisión</th>
              <th>NIT Emisor</th>
              <th>Nombre Emisor</th>
              <th className="num">Total</th>
              <th className="num">Impuestos restados</th>
              <th className="num">Base calculada</th>
              <th>Categoría final</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={12} className="muted" style={{ textAlign: "center", padding: "var(--space-6)" }}>
                  {filter === "review" ? "No hay documentos por revisar." : "Ningún documento coincide con el filtro."}
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const expanded = open.has(r.rowNumber);
              return (
                <Fragment key={r.rowNumber}>
                  <tr className={r.status !== "ok" ? `row-attention row-attention--${r.status === "duplicate" ? "warning" : "blocking"}` : undefined}>
                    <td className="actions" style={{ width: 36 }}>
                      <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        icon={expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        aria-label={expanded ? "Ocultar detalle de cálculo" : "Ver detalle de cálculo"}
                        title="Ver detalle de cálculo"
                        aria-expanded={expanded}
                        onClick={() => toggle(r.rowNumber)}
                      />
                    </td>
                    <td style={{ minWidth: 160 }}>{r.documentType || <span className="muted">—</span>}</td>
                    <td className="selectable">{r.folio || "—"}</td>
                    <td className="selectable">{r.prefix || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{r.issueDate || "—"}</td>
                    <td className="selectable">{r.nitText || "—"}</td>
                    <td style={{ minWidth: 140 }}>{r.issuerName || "—"}</td>
                    <td className="num">{amount(r, "Total", r.total)}</td>
                    <td className="num">{r.taxesSum === null ? "—" : formatMicro(r.taxesSum)}</td>
                    <td className="num table__primary">{r.base === null ? "—" : formatMicro(r.base)}</td>
                    <td>{r.category ? <Badge tone={r.category === "credit_note" ? "gold" : "dark"}>{SALES_CATEGORY_LABEL[r.category]}</Badge> : "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Badge tone={STATUS_TONE[r.status]}>{ROW_STATUS_LABEL[r.status]}</Badge>
                      {r.duplicateOf !== undefined && <div className="table__secondary">Igual a la fila {r.duplicateOf}</div>}
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td />
                      <td colSpan={11}>
                        <div className="sales-calc">
                          <div className="sales-calc__item">
                            <span>Total</span>
                            <strong>{amount(r, "Total", r.total)}</strong>
                          </div>
                          {TAX_COLUMNS.map((t) => (
                            <div key={t} className="sales-calc__item">
                              <span>− {t}</span>
                              <strong>{amount(r, t, r.taxes[t])}</strong>
                            </div>
                          ))}
                          <div className="sales-calc__item sales-calc__item--total">
                            <span>= Base</span>
                            <strong>{r.base === null ? "Requiere revisión" : formatMicro(r.base)}</strong>
                          </div>
                        </div>
                        <div className="table__secondary selectable" style={{ marginTop: "var(--space-2)" }}>
                          Fila {r.rowNumber} del Excel{r.cufe ? ` · CUFE/CUDE ${r.cufe}` : ""}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
