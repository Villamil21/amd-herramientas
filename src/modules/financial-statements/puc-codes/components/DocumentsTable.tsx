import { useMemo, useState } from "react";
import { XCircle } from "lucide-react";
import { Badge, Button, Card } from "../../../../components/ui";
import { normalizeKey } from "../../../../utils/text";
import { SearchBox, SegmentedFilter } from "../../../bank-analysis/shared/components/tableControls";
import { formatCop, formatIssueDate, rowCodes } from "../services/labels";
import type { PendingAction } from "../services/pending";
import { DOC_CATEGORY_LABEL, type DocRow } from "../types";
import { ClassificationBadge } from "./StatusBadge";

export type DocumentFilter = "all" | "pending" | "partial" | "classified" | "invoice" | "credit_note";

const FILTERS: { id: DocumentFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "pending", label: "Pendientes" },
  { id: "partial", label: "Parciales" },
  { id: "classified", label: "Clasificados" },
  { id: "invoice", label: "Facturas" },
  { id: "credit_note", label: "Notas crédito" },
];

function matches(r: DocRow, filter: DocumentFilter): boolean {
  switch (filter) {
    case "pending":
    case "partial":
    case "classified":
      return !r.excluded && r.classification === filter;
    case "invoice":
    case "credit_note":
      return r.category === filter;
    default:
      return true;
  }
}

/** Ancla para llevar la vista a la tabla (contadores). */
export const DOCUMENTS_ANCHOR = "puc-documents";

interface Props {
  rows: DocRow[];
  /** Pendiente de cada archivo (services/pending). */
  attention: Map<string, PendingAction>;
  filter: DocumentFilter;
  onFilterChange: (f: DocumentFilter) => void;
  onOpen: (r: DocRow, products?: boolean) => void;
  onAction: (a: PendingAction) => void;
}

export function DocumentsTable({ rows, attention, filter, onFilterChange, onOpen, onAction }: Props) {
  // El buscador vive aquí: abrir y cerrar el detalle de un documento no lo cambia.
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = normalizeKey(query);
    return rows.filter((r) => matches(r, filter) && (!q || normalizeKey([r.fileName, r.number, r.issuerNit, r.issuerName, ...rowCodes(r)].filter(Boolean).join(" ")).includes(q)));
  }, [rows, query, filter]);

  return (
    <Card id={DOCUMENTS_ANCHOR} flush title="Documentos" description="Centro de trabajo: filtra, busca y abre cada documento para clasificarlo (toda la factura o por producto).">
      <div className="toolbar row--between">
        <SegmentedFilter label="Filtrar documentos" options={FILTERS} value={filter} onChange={onFilterChange} />
        <SearchBox placeholder="Proveedor, número, archivo o código PUC" value={query} onChange={setQuery} />
      </div>
      <div className="table-wrap table-wrap--scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Documento</th>
              <th>Estado</th>
              <th>Fecha</th>
              <th>Proveedor</th>
              <th>Código PUC</th>
              <th className="num">Valor asignado</th>
              <th className="actions">Acción</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ textAlign: "center", padding: "var(--space-6)" }}>
                  Ningún documento coincide con el filtro.
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const parsed = !r.failure;
              const a = attention.get(r.fileName);
              const codes = rowCodes(r);
              const label = rowActionLabel(r, a);
              // Un pendiente que no se resuelve en el detalle (p. ej. título sin clasificar) va a su panel.
              const act = () => (a && a.target.kind !== "document" ? onAction(a) : onOpen(r));
              return (
                <tr key={r.fileName} className={["is-clickable", a && "row-attention row-attention--blocking"].filter(Boolean).join(" ")} onClick={() => onOpen(r)}>
                  <td style={{ minWidth: 180, maxWidth: 280, overflowWrap: "break-word" }}>
                    <div className="table__primary selectable">
                      {a && <XCircle size={14} className="row-attention__icon" aria-label="Pendiente: bloquea el envío" />}
                      {r.number ?? r.fileName}
                    </div>
                    <div className="table__secondary">
                      {[r.number && r.fileName, r.category ? DOC_CATEGORY_LABEL[r.category] : parsed ? "Tipo sin clasificar" : null].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td style={{ maxWidth: 170 }}>
                    <span className="row" style={{ flexWrap: "nowrap" }}>
                      <ClassificationBadge row={r} />
                      {r.duplicateOf && <Badge tone="danger">Duplicado</Badge>}
                    </span>
                    {a && <div className="table__secondary">{a.what}</div>}
                  </td>
                  <td className="nowrap">{formatIssueDate(r.issueDate)}</td>
                  <td style={{ minWidth: 200 }}>
                    {r.issuerName || "—"}
                    {r.issuerNit && <div className="table__secondary selectable">NIT {r.issuerNit}</div>}
                  </td>
                  <td className="nowrap" title={r.mode === "document" ? r.documentConcept : undefined}>
                    {codes.length === 0 ? r.excluded || !parsed ? "—" : <span className="muted">Pendiente</span> : codes.length === 1 ? codes[0] : `${codes.length} códigos`}
                    {r.mode && <div className="table__secondary">{r.mode === "document" ? "Toda la factura" : `Por producto · ${r.classifiedLines} de ${r.lines.length}`}</div>}
                  </td>
                  <td className="num">{r.allocations.length ? formatCop(r.assignedCents) : "—"}</td>
                  <td className="actions" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant={label === "Ver clasificación" || label === "Ver" ? "ghost" : "primary"} onClick={act} title={a ? `${a.what}: ${a.detail}` : undefined}>
                      {label}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Acción directa de cada fila: Clasificar, Revisar o Ver clasificación. */
export function rowActionLabel(r: DocRow, a: PendingAction | undefined): "Clasificar" | "Revisar" | "Ver clasificación" | "Ver" {
  if (r.excluded) return "Ver";
  if (r.failure || r.duplicateOf || r.classification === "partial") return "Revisar";
  if (r.classification === "classified") return a ? "Revisar" : "Ver clasificación";
  return a && a.target.kind !== "document" ? "Revisar" : "Clasificar";
}
