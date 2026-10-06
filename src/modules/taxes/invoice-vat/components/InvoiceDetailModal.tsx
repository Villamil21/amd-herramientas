import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Eye, EyeOff, XCircle } from "lucide-react";
import { Alert, Badge, Button, Modal } from "../../../../components/ui";
import { VAT_TYPE_LABEL, type Supplier } from "../../../../types/models";
import { ProductsTable } from "../../withholding/components/DocumentDetailModal";
import { formatCop as formatMoneyCents, formatRateBp } from "../parser/amounts";
import { CONFIRMABLE } from "../services/analysis";
import { DOC_CATEGORY_LABEL, type DocDecision, type InvoiceRow, type LineChoice, type ProblemCode, type ProductLine, type UnknownTitle } from "../types";
import { TitleClassifyButtons } from "./PendingPanel";
import { StatusBadge } from "./StatusBadge";
import { SupplierVatControl } from "./SupplierVatControl";

const PRODUCT_COLUMNS = ["Descripción", "IVA", "% IVA", "Precio unitario de venta"];

const rate = (bp: number) => formatRateBp(bp).replace(" %", "%");

/**
 * Líneas del análisis con las columnas del módulo IVA de compras. Son los
 * mismos valores que suman las bases y el IVA: una fila interpretada como 0 %
 * muestra $0 y 0%; solo queda vacío («—») el dato que no se pudo leer.
 */
function productTable(lines: ProductLine[]) {
  return {
    columns: PRODUCT_COLUMNS,
    rows: lines.map((l) => ({
      page: l.page,
      cells: [l.description, l.vatCents === undefined ? "" : formatMoneyCents(l.vatCents), l.rateBp === undefined ? "" : rate(l.rateBp), l.baseCents === undefined ? "" : formatMoneyCents(l.baseCents)],
    })),
  };
}

const PROBLEM_TITLE: Record<ProblemCode, string> = {
  "title-missing": "Documento sin título",
  "supplier-name": "Emisor sin razón social",
  lines: "Producto sin tarifa de IVA",
  "no-products": "Documento sin productos",
  "other-rate": "Tarifa de IVA no configurada",
  "services-5": "Servicios al 5 %",
  duplicate: "Posible documento duplicado",
  "base-mismatch": "Las bases no concilian con el subtotal",
  "vat-mismatch": "El IVA no concilia con el total del documento",
};

const LINE_CHOICES: { choice: LineChoice; label: string }[] = [
  { choice: 1900, label: "19%" },
  { choice: 500, label: "5%" },
  { choice: 0, label: "0%" },
  { choice: "ignore", label: "Ignorar fila" },
];

interface Props {
  row: InvoiceRow | null;
  /** Abierto desde «Ver productos» o «Revisar producto»: la tabla queda a la vista. */
  openProducts: boolean;
  decision?: DocDecision;
  /** Proveedor registrado del documento, si existe. */
  supplier?: Supplier;
  /** Título del documento que aún no está clasificado. */
  unknownTitle?: UnknownTitle;
  onDecision: (fileName: string, decision: DocDecision) => void;
  /** Se guardó un proveedor o un tipo de documento. */
  onChanged: () => Promise<void> | void;
  onClose: () => void;
  /** Pendientes que quedan además de este documento. */
  remainingPending: number;
  onNextPending: () => void;
}

/**
 * Detalle de un documento: qué pasó, si bloquea la declaración y la acción
 * para resolverlo; datos y validaciones; y todas las líneas de producto. Las
 * decisiones son del análisis: el PDF no se modifica.
 */
export function InvoiceDetailModal({ row, openProducts, decision = {}, supplier, unknownTitle, onDecision, onChanged, onClose, remainingPending, onNextPending }: Props) {
  const [showProducts, setShowProducts] = useState(false);
  const productsRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const fileName = row?.fileName;

  useEffect(() => {
    setShowProducts(openProducts);
  }, [fileName, openProducts]);

  // Abierto desde «Ver productos»: la tabla queda a la vista aunque el detalle sea largo.
  useEffect(() => {
    if (fileName && openProducts) productsRef.current?.scrollIntoView({ block: "nearest" });
  }, [fileName, openProducts, showProducts]);

  if (!row) return null;
  const decide = (patch: DocDecision) => onDecision(row.fileName, { ...decision, ...patch });
  const setLine = (index: number, choice: LineChoice | undefined) => {
    const lines = { ...decision.lines };
    if (choice === undefined) delete lines[index];
    else lines[index] = choice;
    decide({ lines });
  };

  const parsed = Boolean(row.supplierNit);
  const failed = !parsed;
  const excluded = row.status === "excluded";
  const pending = row.status !== "processed" && !excluded;
  // Filas que el lector no interpretó y siguen pendientes o ya tienen una decisión del usuario.
  const lineItems = row.products.map((p, index) => ({ p, index })).filter(({ p }) => p.issue && p.origin !== "auto-zero");

  function problemActions(code: ProblemCode): ReactNode {
    if (code === "lines") {
      return (
        <Button size="sm" variant="primary" onClick={() => linesRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}>
          Revisar producto
        </Button>
      );
    }
    if (code === "duplicate") {
      return (
        <>
          <Button size="sm" variant="primary" onClick={() => decide({ excluded: true })}>
            Excluir duplicado
          </Button>
          <Button size="sm" onClick={() => decide({ includeDuplicate: true })}>
            Incluir en el resumen
          </Button>
        </>
      );
    }
    if (code === "services-5" && supplier) return <SupplierVatControl nit={supplier.nit} name={supplier.businessName} supplier={supplier} onSaved={onChanged} />;
    if (CONFIRMABLE.has(code)) {
      return (
        <Button size="sm" variant="primary" onClick={() => decide({ confirmed: true })} title="Acepta los valores leídos del documento y lo incluye en el resumen.">
          Confirmar interpretación
        </Button>
      );
    }
    return (
      <Button size="sm" onClick={() => decide({ excluded: true })}>
        Excluir documento
      </Button>
    );
  }

  const item = (key: string, title: string, detail: ReactNode, actions: ReactNode) => (
    <li key={key} className="pending-item pending-item--blocking">
      <XCircle size={15} className="pending-item__icon" aria-label="Bloquea la declaración" />
      <div className="pending-item__text">
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <div className="pending-item__actions">{actions}</div>
    </li>
  );

  const footer = (
    <>
      <Button
        variant="ghost"
        onClick={() => decide({ excluded: !excluded })}
        title={excluded ? "Vuelve a tener en cuenta el documento." : "El documento no se suma y deja de bloquear la declaración."}
        style={{ marginRight: "auto" }}
      >
        {excluded ? "Volver a incluir" : "Excluir del resumen"}
      </Button>
      {remainingPending > 0 && (
        <Button icon={<ArrowRight size={14} />} onClick={onNextPending}>
          Siguiente pendiente ({remainingPending})
        </Button>
      )}
      <Button variant="primary" onClick={onClose}>
        Cerrar
      </Button>
    </>
  );

  return (
    <Modal open size="lg" title={row.fileName} onClose={onClose} footer={footer}>
      <div className="stack">
        <div className="row">
          <StatusBadge status={row.status} />
          {row.category && <Badge tone={row.category === "credit_note" ? "gold" : "dark"}>{DOC_CATEGORY_LABEL[row.category]}</Badge>}
          {row.duplicateOf && <Badge tone="danger">Posible duplicado</Badge>}
          {pending && <span className="muted">Bloquea la declaración hasta resolverlo.</span>}
        </div>

        {excluded && <Alert tone="info">Documento excluido por decisión tuya: no suma en el resumen ni bloquea la declaración.</Alert>}
        {failed && (
          <Alert tone="danger" title="No fue posible procesar el archivo">
            {row.issues[0]}
            {!excluded && " Si no es una factura de este periodo, exclúyelo para que no bloquee la declaración."}
          </Alert>
        )}

        {parsed && pending && (
          <ul className="pending-list attention-block attention-block--danger">
            {!row.vatType && item("supplier", "Proveedor sin Tipo IVA", `${row.supplierName || `NIT ${row.supplierNit}`}: indica si es Compras o Servicios.`, <SupplierVatControl nit={row.supplierNit!} name={row.supplierName ?? ""} supplier={supplier} onSaved={onChanged} />)}
            {unknownTitle &&
              item("title", "Nuevo tipo de documento", <>Se encontró «{unknownTitle.displayTitle}». ¿Dónde deseas clasificarlo?</>, <TitleClassifyButtons title={unknownTitle} onSaved={onChanged} />)}
            {row.problems.map((p, i) => item(`${p.code}-${i}`, PROBLEM_TITLE[p.code], p.text, problemActions(p.code)))}
          </ul>
        )}

        {parsed && (
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
            {row.otherRates.length > 0 && (
              <Alert tone="warning" title="Tarifas no configuradas (fuera de 0%, 5% y 19%)" items={row.otherRates.map((o) => `${formatRateBp(o.rateBp)}: base ${formatMoneyCents(o.baseCents)} · IVA ${formatMoneyCents(o.vatCents)}`)} />
            )}

            {lineItems.length > 0 && (
              <div className="stack stack--sm" ref={linesRef}>
                <strong>Filas por definir</strong>
                <span className="muted">El lector no pudo identificar la tarifa de estas filas. Elige la tarifa o ignora la fila; con 0% el «Precio unitario de venta» suma como excluido, exento o no gravado.</span>
                <ul className="pending-list">
                  {lineItems.map(({ p, index }) => {
                    const chosen = decision.lines?.[index];
                    return (
                      <li key={index} className={`pending-item ${chosen === undefined ? "pending-item--blocking" : "pending-item--info"}`}>
                        <div className="pending-item__text">
                          <strong className="selectable">{p.description || "(sin descripción)"}</strong>
                          <span>
                            Página {p.page} · Precio unitario de venta {p.baseCents === undefined ? "no identificado" : formatMoneyCents(p.baseCents)} · {p.issue}
                          </span>
                        </div>
                        <div className="pending-item__actions">
                          <div className="segmented" role="group" aria-label={`Tarifa de ${p.description || `la fila ${index + 1}`}`}>
                            {LINE_CHOICES.map(({ choice, label }) => (
                              <button
                                key={label}
                                className={chosen === choice ? "is-active" : undefined}
                                aria-pressed={chosen === choice}
                                // Sin «Precio unitario de venta» no hay base que sumar: la fila solo se puede ignorar.
                                disabled={choice !== "ignore" && p.baseCents === undefined}
                                onClick={() => setLine(index, chosen === choice ? undefined : choice)}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
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
            {row.status === "processed" && row.notes.length === 0 && <Alert tone="success">Bases y IVA conciliados con los totales del documento.</Alert>}
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
