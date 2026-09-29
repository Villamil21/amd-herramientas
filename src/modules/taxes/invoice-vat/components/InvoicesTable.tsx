import { useMemo, useState } from "react";
import { Alert, Badge, Card, Modal, Select } from "../../../../components/ui";
import { VAT_TYPE_LABEL } from "../../../../types/models";
import { normalizeKey } from "../../../../utils/text";
import { SearchBox, SegmentedFilter } from "../../../bank-analysis/shared/components/tableControls";
import { formatCop as formatMoneyCents, formatRateBp } from "../parser/amounts";
import type { InvoiceRow } from "../types";
import { StatusBadge } from "./StatusBadge";

type Filter = "all" | "purchase" | "service" | "pending" | "review";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "purchase", label: "Compras" },
  { id: "service", label: "Servicios" },
  { id: "pending", label: "Proveedor pendiente" },
  { id: "review", label: "Requiere revisión" },
];

function matches(r: InvoiceRow, filter: Filter): boolean {
  switch (filter) {
    case "purchase":
    case "service":
      return r.vatType === filter;
    case "pending":
      return Boolean(r.supplierNit) && !r.vatType;
    case "review":
      return r.status !== "processed" && r.status !== "pending-supplier";
    default:
      return true;
  }
}

const money = (cents: number, show: boolean) => (show ? formatMoneyCents(cents) : "—");

export function InvoicesTable({ rows }: { rows: InvoiceRow[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [docType, setDocType] = useState("");
  const [selected, setSelected] = useState<InvoiceRow | null>(null);

  const docTypes = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) if (r.documentTypeKey && !map.has(r.documentTypeKey)) map.set(r.documentTypeKey, r.documentType!);
    return [...map.entries()];
  }, [rows]);

  const visible = useMemo(() => {
    const q = normalizeKey(query);
    return rows.filter(
      (r) =>
        matches(r, filter) &&
        (!docType || r.documentTypeKey === docType) &&
        (!q || normalizeKey([r.fileName, r.invoiceNumber, r.supplierNit, r.supplierName].filter(Boolean).join(" ")).includes(q)),
    );
  }, [rows, query, filter, docType]);

  return (
    <Card flush title="Facturas" description="Haz clic en una fila para ver sus validaciones.">
      <div className="toolbar row--between">
        <div className="row">
          <SegmentedFilter label="Filtrar facturas" options={FILTERS} value={filter} onChange={setFilter} />
          {docTypes.length > 1 && (
            <Select aria-label="Tipo de documento" value={docType} onChange={(e) => setDocType(e.target.value)} style={{ width: "auto" }}>
              <option value="">Todos los tipos de documento</option>
              {docTypes.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </div>
        <SearchBox placeholder="Archivo, número, NIT o razón social" value={query} onChange={setQuery} />
      </div>
      <div className="table-wrap table-wrap--scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Archivo</th>
              <th>Tipo de documento</th>
              <th>Número</th>
              <th>NIT</th>
              <th>Razón social</th>
              <th>Tipo IVA</th>
              <th className="num">Base 5%</th>
              <th className="num">IVA 5%</th>
              <th className="num">Base 19%</th>
              <th className="num">IVA 19%</th>
              <th className="num">Base 0%</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={12} className="muted" style={{ textAlign: "center", padding: "var(--space-6)" }}>
                  Ninguna factura coincide con el filtro.
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const parsed = Boolean(r.supplierNit);
              return (
                <tr key={r.fileName} className="is-clickable" onClick={() => setSelected(r)}>
                  <td className="table__primary" style={{ minWidth: 220, maxWidth: 300, overflowWrap: "break-word" }}>
                    {r.fileName}
                  </td>
                  <td style={{ minWidth: 160 }}>{r.documentType ?? "—"}</td>
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
                    <span className="row" style={{ flexWrap: "nowrap" }}>
                      <StatusBadge status={r.status} />
                      {r.duplicateOf && <Badge tone="danger">Posible duplicado</Badge>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <InvoiceDetailModal row={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}

function InvoiceDetailModal({ row, onClose }: { row: InvoiceRow | null; onClose: () => void }) {
  if (!row) return <Modal open={false} title="" onClose={onClose} />;
  const parsed = Boolean(row.supplierNit);
  const failed = row.status === "incompatible" || row.status === "error";
  return (
    <Modal open size="lg" title={row.fileName} onClose={onClose}>
      <div className="stack">
        <div className="row">
          <StatusBadge status={row.status} />
          {row.duplicateOf && <Badge tone="danger">Posible duplicado</Badge>}
        </div>
        {failed ? (
          <Alert tone="danger">{row.issues[0]}</Alert>
        ) : (
          <>
            <div className="summary-grid">
              <Item label="Tipo de documento" value={row.documentType} />
              <Item label="Número" value={row.invoiceNumber ?? "—"} />
              <Item label="NIT" value={row.supplierNit} />
              <Item label="Tipo IVA" value={row.vatType ? VAT_TYPE_LABEL[row.vatType] : "Pendiente"} />
              <Item label="Razón social" value={row.supplierName || "—"} wide />
              <Item label="Líneas de producto" value={String(row.lineCount)} />
              <Item label="Páginas" value={String(row.pageCount ?? "—")} />
              <Item label="IVA según detalle" value={formatMoneyCents(row.detailVatCents)} />
              <Item label="IVA según total factura" value={row.invoiceVatCents !== undefined ? formatMoneyCents(row.invoiceVatCents) : "—"} />
              <Item label="Suma de bases" value={formatMoneyCents(row.base0 + row.base5 + row.base19 + row.otherRates.reduce((s, o) => s + o.baseCents, 0))} />
              <Item label="Subtotal del documento" value={row.subtotalCents !== undefined ? formatMoneyCents(row.subtotalCents) : "—"} />
            </div>
            {parsed && row.otherRates.length > 0 && (
              <Alert tone="warning" title="Tarifas no configuradas (fuera de 0%, 5% y 19%)" items={row.otherRates.map((o) => `${formatRateBp(o.rateBp)}: base ${formatMoneyCents(o.baseCents)} · IVA ${formatMoneyCents(o.vatCents)}`)} />
            )}
            {row.issues.length > 0 && <Alert tone="warning" title="Requiere revisión" items={row.issues} />}
            {row.lineIssues.length > 0 && (
              <Alert tone="warning" title="Filas no interpretables" items={row.lineIssues.map((l) => `Página ${l.page}: ${l.text} — ${l.reason}`)} />
            )}
            {row.notes.length > 0 && <Alert tone="info" title="Validaciones" items={row.notes} />}
            {row.issues.length === 0 && row.notes.length === 0 && <Alert tone="success">Bases y IVA conciliados con los totales del documento.</Alert>}
          </>
        )}
      </div>
    </Modal>
  );
}

function Item({ label, value, wide }: { label: string; value?: string; wide?: boolean }) {
  return (
    <div className="summary-item" style={wide ? { gridColumn: "span 2" } : undefined}>
      <span className="summary-item__label">{label}</span>
      <span className="summary-item__value selectable">{value ?? "—"}</span>
    </div>
  );
}
