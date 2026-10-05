import { useMemo, useState } from "react";
import { Eye, XCircle } from "lucide-react";
import { Badge, Button, Card, Select } from "../../../../components/ui";
import { VAT_TYPE_LABEL, type VatType } from "../../../../types/models";
import { normalizeKey } from "../../../../utils/text";
import { SearchBox, SegmentedFilter } from "../../../bank-analysis/shared/components/tableControls";
import { formatCop as formatMoneyCents } from "../parser/amounts";
import type { PendingAction } from "../services/pending";
import { DOC_CATEGORY_LABEL, type InvoiceRow } from "../types";
import { StatusBadge } from "./StatusBadge";

export type InvoiceFilter = "all" | "pending" | "validated" | "credit_note" | "invoice";

const FILTERS: { id: InvoiceFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "pending", label: "Pendientes" },
  { id: "validated", label: "Validados" },
  { id: "credit_note", label: "Notas crédito" },
  { id: "invoice", label: "Facturas" },
];

function matches(r: InvoiceRow, filter: InvoiceFilter, attention: Map<string, PendingAction>): boolean {
  switch (filter) {
    case "pending":
      return attention.has(r.fileName);
    case "validated":
      return r.status === "processed";
    case "invoice":
    case "credit_note":
      return r.category === filter;
    default:
      return true;
  }
}

const money = (cents: number, show: boolean) => (show ? formatMoneyCents(cents) : "—");

/** Ancla para llevar la vista a la tabla (contadores y «Ver pendientes»). */
export const INVOICES_ANCHOR = "vat-invoices";

interface Props {
  rows: InvoiceRow[];
  /** Pendiente de cada archivo (services/pending). */
  attention: Map<string, PendingAction>;
  filter: InvoiceFilter;
  onFilterChange: (f: InvoiceFilter) => void;
  onOpen: (r: InvoiceRow, products?: boolean) => void;
  onAction: (a: PendingAction) => void;
}

export function InvoicesTable({ rows, attention, filter, onFilterChange, onOpen, onAction }: Props) {
  // El buscador y el Tipo IVA viven aquí: abrir y cerrar el detalle de un documento no los cambia.
  const [query, setQuery] = useState("");
  const [vatType, setVatType] = useState<VatType | "">("");
  const pendingCount = rows.filter((r) => attention.has(r.fileName)).length;
  const options = FILTERS.map((f) => (f.id === "pending" && pendingCount ? { ...f, label: `Pendientes (${pendingCount})` } : f));

  const visible = useMemo(() => {
    const q = normalizeKey(query);
    return rows.filter(
      (r) => matches(r, filter, attention) && (!vatType || r.vatType === vatType) && (!q || normalizeKey([r.fileName, r.invoiceNumber, r.supplierNit, r.supplierName].filter(Boolean).join(" ")).includes(q)),
    );
  }, [rows, query, filter, vatType, attention]);

  return (
    <Card id={INVOICES_ANCHOR} flush title="Documentos" description="Haz clic en un documento para ver sus validaciones, resolver lo pendiente y revisar el detalle de productos.">
      <div className="toolbar row--between">
        <div className="row">
          <SegmentedFilter label="Filtrar documentos" options={options} value={filter} onChange={onFilterChange} />
          <Select aria-label="Tipo IVA del proveedor" value={vatType} onChange={(e) => setVatType(e.target.value as VatType | "")} style={{ width: "auto" }}>
            <option value="">Compras y Servicios</option>
            {Object.entries(VAT_TYPE_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <SearchBox placeholder="Archivo, número, NIT o razón social" value={query} onChange={setQuery} />
      </div>
      <div className="table-wrap table-wrap--scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Archivo</th>
              <th>Estado</th>
              <th>Categoría</th>
              <th>Número</th>
              <th>NIT</th>
              <th>Razón social</th>
              <th>Tipo IVA</th>
              <th className="num">Base 5%</th>
              <th className="num">IVA 5%</th>
              <th className="num">Base 19%</th>
              <th className="num">IVA 19%</th>
              <th className="num">Base 0%</th>
              <th>Productos</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={13} className="muted" style={{ textAlign: "center", padding: "var(--space-6)" }}>
                  {filter === "pending" && !query && !vatType ? "No hay documentos pendientes." : "Ningún documento coincide con el filtro."}
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const parsed = Boolean(r.supplierNit);
              const a = attention.get(r.fileName);
              return (
                <tr key={r.fileName} className={["is-clickable", a && "row-attention row-attention--blocking"].filter(Boolean).join(" ")} onClick={() => onOpen(r)}>
                  <td className="table__primary" style={{ minWidth: 220, maxWidth: 300, overflowWrap: "break-word" }}>
                    {a && <XCircle size={14} className="row-attention__icon" aria-label="Pendiente: bloquea la declaración" />}
                    {r.fileName}
                  </td>
                  <td>
                    <span className="row" style={{ flexWrap: "nowrap" }}>
                      <StatusBadge status={r.status} />
                      {r.duplicateOf && <Badge tone="danger">Posible duplicado</Badge>}
                      {a && (
                        <Button
                          size="sm"
                          variant="primary"
                          title={a.actionLabel}
                          onClick={(e) => {
                            e.stopPropagation();
                            onAction(a);
                          }}
                        >
                          Revisar
                        </Button>
                      )}
                    </span>
                  </td>
                  <td style={{ minWidth: 150 }} title={r.documentType}>
                    {r.category ? <Badge tone={r.category === "credit_note" ? "gold" : "dark"}>{DOC_CATEGORY_LABEL[r.category]}</Badge> : parsed ? <span className="muted">Sin clasificar: {r.documentType}</span> : "—"}
                  </td>
                  <td className="selectable" style={{ whiteSpace: "nowrap" }}>{r.invoiceNumber ?? "—"}</td>
                  <td className="selectable" style={{ whiteSpace: "nowrap" }}>{r.supplierNit ?? "—"}</td>
                  <td style={{ minWidth: 160 }}>{r.supplierName || "—"}</td>
                  <td>{r.vatType ? <Badge tone={r.vatType === "service" ? "gold" : "dark"}>{VAT_TYPE_LABEL[r.vatType]}</Badge> : "—"}</td>
                  <td className="num">{money(r.base5, parsed)}</td>
                  <td className="num">{money(r.vat5, parsed)}</td>
                  <td className="num">{money(r.base19, parsed)}</td>
                  <td className="num">{money(r.vat19, parsed)}</td>
                  <td className="num">{money(r.base0, parsed)}</td>
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
