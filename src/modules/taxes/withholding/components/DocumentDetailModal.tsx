import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Eye, EyeOff, Pencil } from "lucide-react";
import { Alert, Badge, Button, Field, Input, Modal, Select } from "../../../../components/ui";
import { BASE_MODE_LABEL, PERSON_TYPE_LABEL, RETENTION_TYPE_LABEL, TITLE_CATEGORY_LABEL } from "../../../../types/models";
import { normalizeKey } from "../../../../utils/text";
import { formatCop } from "../../invoice-vat/parser/amounts";
import { PENDING_STATUSES, STATUS_LABEL } from "../services/labels";
import { formatDate, formatRateBp, formatUvt, parseHundredths, parsePesosInput, retentionCents, sameRetention } from "../services/money";
import type { DocDecision, DocRow, ProductTable } from "../types";
import { StatusBadge } from "./StatusBadge";

interface Props {
  row: DocRow | null;
  decision: DocDecision | undefined;
  onDecision: (fileName: string, decision: DocDecision) => void;
  onEditSupplier: (row: DocRow) => void;
  onClose: () => void;
  /** Otros pendientes del lote: muestra «Siguiente pendiente». */
  remainingPending?: number;
  onNextPending?: () => void;
}

const money = (cents?: number) => (cents === undefined ? "—" : formatCop(cents));

function Item({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className="summary-item" style={wide ? { gridColumn: "span 2" } : undefined}>
      <span className="summary-item__label">{label}</span>
      <span className="summary-item__value selectable">{value ?? "—"}</span>
    </div>
  );
}

function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="stack stack--sm">
      <div className="row row--between">
        <strong>{title}</strong>
        {actions}
      </div>
      {children}
    </div>
  );
}

/** Columnas que no se muestran en la vista (los datos leídos no cambian). */
const HIDDEN_PRODUCT_COLUMNS = new Set(["iva", "iva %", "inc", "inc %", "descuento detalle", "recargo detalle"]);

function visibleProductColumns(columns: string[]): number[] {
  const hidden = new Set<number>();
  columns.forEach((c, i) => {
    const key = normalizeKey(c);
    if (!HIDDEN_PRODUCT_COLUMNS.has(key)) return;
    hidden.add(i);
    // «IVA» / «INC» con su porcentaje en una columna aparte.
    if ((key === "iva" || key === "inc") && columns[i + 1]?.trim() === "%") hidden.add(i + 1);
  });
  return columns.map((_, i) => i).filter((i) => !hidden.has(i));
}

export function ProductsTable({ products }: { products: ProductTable }) {
  if (products.rows.length === 0) return <Alert tone="info">No se encontraron productos en «Detalles de Productos».</Alert>;
  const keep = visibleProductColumns(products.columns);
  return (
    <div className="table-wrap table-wrap--scroll" style={{ maxHeight: 320 }}>
      <table className="table">
        <thead>
          <tr>
            {keep.map((i) => (
              <th key={i}>{products.columns[i]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.rows.map((r, i) => (
            <tr key={i}>
              {keep.map((k) => {
                const c = r.cells[k] ?? "";
                return (
                  <td key={k} className="selectable" style={/,\d{2}$/.test(c) ? { textAlign: "right", whiteSpace: "nowrap" } : { minWidth: normalizeKey(products.columns[k]).startsWith("descripcion") ? 220 : undefined }}>
                    {c || "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const COMPARISON: Record<NonNullable<DocRow["comparison"]>, { label: string; tone: "success" | "danger" | "dark" }> = {
  match: { label: "Coincide", tone: "success" },
  difference: { label: "Diferencia", tone: "danger" },
  none: { label: "Sin Rete fuente en el PDF", tone: "dark" },
};

export function DocumentDetailModal({ row, decision, onDecision, onEditSupplier, onClose, remainingPending = 0, onNextPending }: Props) {
  const [showProducts, setShowProducts] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [baseText, setBaseText] = useState("");
  const [rateText, setRateText] = useState("");
  const [manualText, setManualText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileName = row?.fileName;

  useEffect(() => {
    setShowProducts(false);
    setReviewing(false);
    setError(null);
    setBaseText("");
    setRateText("");
    setManualText("");
  }, [fileName]);

  if (!row) return <Modal open={false} title="" onClose={onClose} />;
  const d = decision ?? {};
  const failed = row.status === "incompatible" || row.status === "error";
  const informed = row.informedCents ?? 0;
  const set = (patch: Partial<DocDecision>) => onDecision(row.fileName, { ...d, ...patch });

  const correctedBase = parsePesosInput(baseText);
  const correctedRate = parseHundredths(rateText);
  const preview = correctedBase !== null && correctedRate !== null ? retentionCents(correctedBase, correctedRate) : null;
  const previewMatches = preview !== null && sameRetention(preview, informed);

  function applyCorrection() {
    if (correctedBase === null || correctedRate === null || correctedRate > 10_000) return setError("Escribe una base en pesos y una tarifa en porcentaje (ej. 1.000.000 y 4).");
    if (!previewMatches) return setError("La base y tarifa ingresadas no coinciden con la Rete fuente informada.");
    setError(null);
    setReviewing(false);
    set({ review: { kind: "corrected", baseCents: correctedBase, rateBp: correctedRate } });
  }

  function applyManualBase() {
    const cents = parsePesosInput(manualText);
    if (cents === null) return setError("Escribe la base en pesos (ej. 400.000).");
    setError(null);
    set({ manualBaseCents: cents });
  }

  const askInformed = informed > 0 && (row.status === "difference" || d.review) && row.rule;
  const needsManual = row.rule?.baseMode === "manual" && !d.review;
  // Pendiente: el problema y su acción van arriba, no al final del detalle.
  const pending = PENDING_STATUSES.includes(row.status);
  const ruleOnTop = pending && !row.rule && row.ruleOptions.length > 1;
  // Pendiente base: se resuelve en «Base de retención», después de los totales.
  const basePending = row.status === "pending-base";
  const informedOnTop = pending && row.status === "difference" && askInformed;

  const ruleSelect = (
    <Field label="Cambiar para esta factura" hint="Solo afecta este documento en este análisis.">
      {(id) => (
        <Select id={id} value={d.rateId ?? row.rule?.rateId ?? ""} onChange={(e) => set({ rateId: Number(e.target.value), manualBaseCents: undefined, review: undefined })} style={{ maxWidth: 520 }}>
          <option value="" disabled>
            Elige la regla que aplica…
          </option>
          {row.ruleOptions.map((o) => (
            <option key={o.rateId} value={o.rateId}>
              {RETENTION_TYPE_LABEL[o.retentionType]} — {o.subtypeName} ({BASE_MODE_LABEL[o.baseMode]})
            </option>
          ))}
        </Select>
      )}
    </Field>
  );

  const manualBase = (
    <div className="row" style={{ alignItems: "flex-end" }}>
      <Field label="Base de retención" hint={d.manualBaseCents !== undefined ? `Base aplicada: ${formatCop(d.manualBaseCents)}` : "Revisa los productos y escribe la base que aplica."}>
        {(id) => <Input id={id} value={manualText} onChange={(e) => setManualText(e.target.value)} placeholder="400.000" inputMode="decimal" />}
      </Field>
      <Button variant="primary" onClick={applyManualBase}>
        Aplicar base
      </Button>
    </div>
  );

  const informedReview = askInformed && (
    <Alert tone={d.review ? "success" : "warning"} title={d.review ? "Rete fuente revisada" : "¿La base y tarifa detectadas son correctas?"}>
      <div className="stack stack--sm" style={{ marginTop: 4 }}>
        <span>
          Retención informada: <strong>{formatCop(informed)}</strong> · Base inicial: <strong>{money(row.subtotalCents)}</strong> · Tarifa implícita:{" "}
          <strong>{row.impliedRateBp !== undefined ? formatRateBp(row.impliedRateBp, true) : "—"}</strong>
        </span>
        {d.review ? (
          <div className="row">
            <span>{d.review.kind === "accept-informed" ? "Confirmaste la base y tarifa detectadas." : `Base ${formatCop(d.review.baseCents)} · Tarifa ${formatRateBp(d.review.rateBp)}.`}</span>
            <Button size="sm" variant="ghost" onClick={() => set({ review: undefined })}>
              Deshacer
            </Button>
          </div>
        ) : (
          <div className="row">
            <Button size="sm" variant="primary" onClick={() => set({ review: { kind: "accept-informed" } })} disabled={!row.subtotalCents}>
              Sí, son correctas
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setReviewing(true);
                setShowProducts(true);
              }}
            >
              No, revisar
            </Button>
          </div>
        )}
        {reviewing && !d.review && (
          <div className="row" style={{ alignItems: "flex-end" }}>
            <Field label="Base correcta">{(id) => <Input id={id} value={baseText} onChange={(e) => setBaseText(e.target.value)} placeholder="1.000.000" inputMode="decimal" />}</Field>
            <Field label="Tarifa correcta (%)">{(id) => <Input id={id} value={rateText} onChange={(e) => setRateText(e.target.value)} placeholder="4" inputMode="decimal" style={{ width: 110 }} />}</Field>
            <span className="muted" style={{ paddingBottom: 10 }}>
              = {preview !== null ? formatCop(preview) : "—"} {preview !== null && (previewMatches ? "✓ coincide" : "✗ no coincide")}
            </span>
            <Button variant="primary" onClick={applyCorrection}>
              Validar
            </Button>
          </div>
        )}
      </div>
    </Alert>
  );

  const footer =
    onNextPending && (remainingPending > 0 || pending) ? (
      <>
        <span className="muted" style={{ marginRight: "auto", alignSelf: "center" }}>
          {pending ? "Este documento sigue pendiente." : "Documento resuelto."} {remainingPending > 0 && `Quedan ${remainingPending === 1 ? "1 pendiente" : `${remainingPending} pendientes`} en el lote.`}
        </span>
        {remainingPending > 0 && (
          <Button variant={pending ? "secondary" : "primary"} icon={<ArrowRight size={15} />} onClick={onNextPending}>
            Siguiente pendiente
          </Button>
        )}
      </>
    ) : undefined;

  return (
    <Modal open size="xl" title={row.fileName} onClose={onClose} footer={footer}>
      <div className="stack">
        <div className="row">
          <StatusBadge status={row.status} />
          {row.category && <Badge tone={row.category === "credit_note" ? "gold" : "dark"}>{TITLE_CATEGORY_LABEL[row.category]}</Badge>}
          {row.counts ? <Badge tone="success">Va a la declaración</Badge> : <Badge>No suma en la declaración</Badge>}
        </div>
        {failed ? (
          <Alert tone="danger">{row.issues[0]}</Alert>
        ) : (
          <>
            {pending && !basePending && (
              <div className={`attention-block attention-block--${row.status === "difference" ? "danger" : "warning"}`}>
                <Alert tone={row.status === "difference" ? "danger" : "warning"} title={`Por resolver: ${STATUS_LABEL[row.status]}`} items={row.issues}>
                  {row.status === "pending-supplier" && (
                    <div className="row" style={{ marginTop: 4 }}>
                      <Button size="sm" variant="primary" icon={<Pencil size={13} />} onClick={() => onEditSupplier(row)}>
                        Configurar proveedor
                      </Button>
                    </div>
                  )}
                </Alert>
                {ruleOnTop && ruleSelect}
                {informedOnTop && informedReview}
                {error && !needsManual && <Alert tone="danger">{error}</Alert>}
              </div>
            )}
            <Section title="Datos del documento">
              <div className="summary-grid">
                <Item label="Título" value={row.title} wide />
                <Item label="Número" value={row.number ?? "—"} />
                <Item label="Fecha de emisión" value={formatDate(row.issueDate)} />
                <Item label="Páginas" value={String(row.pageCount ?? "—")} />
              </div>
            </Section>

            <Section
              title="Proveedor"
              actions={
                <Button size="sm" icon={<Pencil size={13} />} onClick={() => onEditSupplier(row)}>
                  {row.supplierId ? "Editar proveedor" : "Crear proveedor"}
                </Button>
              }
            >
              <div className="summary-grid">
                <Item label="NIT" value={row.nit} />
                <Item label="Razón social" value={row.supplierName || "—"} wide />
                <Item label="Tipo contribuyente (PDF)" value={row.taxpayerType ?? "—"} />
                <Item label="PJ / PN" value={row.personType ? `${row.personType} — ${PERSON_TYPE_LABEL[row.personType]}` : "Pendiente"} />
                <Item label="Régimen / responsabilidad del emisor" value={row.fiscalText ?? (row.fiscalCodes.join(";") || "—")} wide />
              </div>
            </Section>

            {(row.rule || row.ruleOptions.length > 0) && (
              <Section title="Configuración de retención">
                <div className="summary-grid">
                  <Item label="Tipo" value={row.rule ? RETENTION_TYPE_LABEL[row.rule.retentionType] : "Pendiente"} />
                  <Item label="Subtipo" value={row.rule?.subtypeName ?? "Pendiente"} wide />
                  <Item label="Modo de base" value={row.rule ? BASE_MODE_LABEL[row.rule.baseMode] : "—"} />
                  <Item label={`Valor UVT ${row.uvtYear ?? ""}`} value={row.uvtPesos ? formatCop(row.uvtPesos * 100) : "—"} />
                  <Item label="Base UVT" value={row.baseUvtCenti !== undefined ? formatUvt(row.baseUvtCenti) : "—"} />
                  <Item label="Base mínima" value={money(row.minBaseCents)} />
                  <Item label="Tarifa" value={row.rateBp !== undefined ? formatRateBp(row.rateBp) : "—"} />
                </div>
                {row.ruleOptions.length > 1 && !ruleOnTop && ruleSelect}
              </Section>
            )}

            <Section title="Datos totales">
              <div className="summary-grid">
                <Item label="Subtotal" value={money(row.subtotalCents)} />
                <Item label="Base de retención" value={money(row.baseCents)} />
                <Item label="Retención calculada" value={money(row.calculatedCents)} />
                <Item label="Rete fuente del PDF" value={money(row.informedCents)} />
                <Item label="Tarifa implícita" value={row.impliedRateBp !== undefined ? formatRateBp(row.impliedRateBp, true) : "—"} />
                <Item label="Comparación" value={row.comparison ? <Badge tone={COMPARISON[row.comparison].tone}>{COMPARISON[row.comparison].label}</Badge> : "Pendiente de revisión"} />
              </div>
            </Section>

            {needsManual && (
              <Section title="Base de retención" actions={basePending && <Badge tone="gold">Pendiente</Badge>}>
                {basePending && row.issues.map((issue) => (
                  <span key={issue} className="muted">
                    {issue}
                  </span>
                ))}
                {manualBase}
                {error && <Alert tone="danger">{error}</Alert>}
              </Section>
            )}

            {!informedOnTop && informedReview}
            {error && !pending && !needsManual && <Alert tone="danger">{error}</Alert>}

            <Section
              title="Detalle de productos"
              actions={
                <Button size="sm" variant="ghost" icon={showProducts ? <EyeOff size={14} /> : <Eye size={14} />} onClick={() => setShowProducts((v) => !v)}>
                  {showProducts ? "Ocultar productos" : "Ver detalles de productos"}
                </Button>
              }
            >
              {showProducts && row.products && <ProductsTable products={row.products} />}
            </Section>

            {(!pending || row.notes.length > 0) && (
              <Section title="Validaciones">
                {row.issues.length > 0 && !pending && <Alert tone="warning" items={row.issues} />}
                {row.notes.length > 0 && <Alert tone="info" items={row.notes} />}
                {row.issues.length === 0 && row.status === "validated" && <Alert tone="success">Documento validado.</Alert>}
              </Section>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
