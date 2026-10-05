import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Alert, Badge, Button, Card, Modal, Select } from "../../../../components/ui";
import { VAT_TYPE_LABEL } from "../../../../types/models";
import { normalizeKey } from "../../../../utils/text";
import { SearchBox, SegmentedFilter } from "../../../bank-analysis/shared/components/tableControls";
import { formatCop as formatMoneyCents, formatRateBp } from "../parser/amounts";
import { ProductsTable } from "../../withholding/components/DocumentDetailModal";
import type { InvoiceRow, ProductLine } from "../types";
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

const PRODUCT_COLUMNS = ["Descripción", "IVA", "% IVA", "Precio unitario de venta"];

/**
 * Líneas del análisis con las columnas del módulo IVA. Son los mismos valores
 * que suman las bases y el IVA; un dato que no se pudo leer queda vacío («—»).
 */
function productTable(lines: ProductLine[]) {
  return {
    columns: PRODUCT_COLUMNS,
    rows: lines.map((l) => ({
      page: l.page,
      cells: [
        l.description,
        l.vatCents === undefined ? "" : formatMoneyCents(l.vatCents),
        l.rateBp === undefined ? "" : formatRateBp(l.rateBp).replace(" %", "%"),
        l.baseCents === undefined ? "" : formatMoneyCents(l.baseCents),
      ],
    })),
  };
}

export function InvoicesTable({ rows }: { rows: InvoiceRow[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [docType, setDocType] = useState("");
  const [selected, setSelected] = useState<{ row: InvoiceRow; products: boolean } | null>(null);

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
    <Card flush title="Facturas" description="Haz clic en una fila para ver sus validaciones y el detalle de productos.">
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
              <th>Productos</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={13} className="muted" style={{ textAlign: "center", padding: "var(--space-6)" }}>
                  Ninguna factura coincide con el filtro.
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const parsed = Boolean(r.supplierNit);
              return (
                <tr key={r.fileName} className="is-clickable" onClick={() => setSelected({ row: r, products: false })}>
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
                  <td>
                    {parsed && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Eye size={14} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected({ row: r, products: true });
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
      <InvoiceDetailModal row={selected?.row ?? null} openProducts={selected?.products ?? false} onClose={() => setSelected(null)} />
    </Card>
  );
}

function InvoiceDetailModal({ row, openProducts, onClose }: { row: InvoiceRow | null; openProducts: boolean; onClose: () => void }) {
  const [showProducts, setShowProducts] = useState(false);
  const productsRef = useRef<HTMLDivElement>(null);
  const fileName = row?.fileName;

  useEffect(() => {
    setShowProducts(openProducts);
  }, [fileName, openProducts]);

  // Abierto desde «Ver productos»: la tabla queda a la vista aunque el detalle sea largo.
  useEffect(() => {
    if (fileName && openProducts) productsRef.current?.scrollIntoView({ block: "nearest" });
  }, [fileName, openProducts, showProducts]);

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
            <div className="stack stack--sm" ref={productsRef}>
              <div className="row row--between">
                <strong>Detalle de productos</strong>
                <Button size="sm" variant="ghost" icon={showProducts ? <EyeOff size={14} /> : <Eye size={14} />} onClick={() => setShowProducts((v) => !v)}>
                  {showProducts ? "Ocultar productos" : "Ver productos"}
                </Button>
              </div>
              {showProducts && <ProductsTable products={productTable(row.products)} columns={[0, 1, 2, 3]} numericColumns={[1, 2, 3]} />}
            </div>
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
