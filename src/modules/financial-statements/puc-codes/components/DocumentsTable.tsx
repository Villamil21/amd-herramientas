import { useMemo, useState } from "react";
import { Eye, XCircle } from "lucide-react";
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
    <Card id={DOCUMENTS_ANCHOR} flush title="Facturas" description="Haz clic en una factura para elegir cómo asignar el código PUC, ver sus productos y resolver lo pendiente.">
      <div className="toolbar row--between">
        <SegmentedFilter label="Filtrar facturas" options={FILTERS} value={filter} onChange={onFilterChange} />
        <SearchBox placeholder="Proveedor, número, archivo o código PUC" value={query} onChange={setQuery} />
      </div>
      <div className="table-wrap table-wrap--scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Archivo</th>
              <th>Estado de clasificación</th>
              <th>Título del documento</th>
              <th>Número</th>
              <th>Fecha de emisión</th>
              <th>NIT emisor</th>
              <th>Razón social</th>
              <th className="num">Líneas</th>
              <th>Código PUC</th>
              <th className="num">Valor asignado</th>
              <th>Productos</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={11} className="muted" style={{ textAlign: "center", padding: "var(--space-6)" }}>
                  Ninguna factura coincide con el filtro.
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const parsed = !r.failure;
              const a = attention.get(r.fileName);
              const codes = rowCodes(r);
              return (
                <tr key={r.fileName} className={["is-clickable", a && "row-attention row-attention--blocking"].filter(Boolean).join(" ")} onClick={() => onOpen(r)}>
                  <td className="table__primary" style={{ minWidth: 220, maxWidth: 300, overflowWrap: "break-word" }}>
                    {a && <XCircle size={14} className="row-attention__icon" aria-label="Pendiente: bloquea la exportación" />}
                    {r.fileName}
                  </td>
                  <td>
                    <span className="row" style={{ flexWrap: "nowrap" }}>
                      <ClassificationBadge row={r} />
                      {r.duplicateOf && <Badge tone="danger">Duplicado</Badge>}
                      {a && (
                        <Button
                          size="sm"
                          variant="primary"
                          title={`${a.what}: ${a.detail}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onAction(a);
                          }}
                        >
                          {a.actionLabel}
                        </Button>
                      )}
                    </span>
                    {a && <div className="table__secondary">{a.what}</div>}
                  </td>
                  <td style={{ minWidth: 190 }}>
                    {parsed ? (
                      <>
                        <div>{r.title}</div>
                        {r.category ? <Badge tone={r.category === "credit_note" ? "gold" : "dark"}>{DOC_CATEGORY_LABEL[r.category]}</Badge> : <span className="table__secondary">Sin clasificar</span>}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="selectable" style={{ whiteSpace: "nowrap" }}>{r.number ?? "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatIssueDate(r.issueDate)}</td>
                  <td className="selectable" style={{ whiteSpace: "nowrap" }}>{r.issuerNit ?? "—"}</td>
                  <td style={{ minWidth: 160 }}>{r.issuerName || "—"}</td>
                  <td className="num">{parsed ? r.lines.length : "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }} title={r.mode === "document" ? r.documentConcept : undefined}>
                    {codes.length === 0 ? r.excluded || !parsed ? "—" : <span className="muted">Pendiente</span> : codes.length === 1 ? codes[0] : `${codes.length} códigos`}
                    {r.mode && <div className="table__secondary">{r.mode === "document" ? "Toda la factura" : `Por producto · ${r.classifiedLines} de ${r.lines.length}`}</div>}
                  </td>
                  <td className="num">{r.allocations.length ? formatCop(r.assignedCents) : "—"}</td>
                  <td>
                    {parsed && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Eye size={14} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(r, true);
                        }}
                      >
                        Ver productos
                      </Button>
                    )}
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
