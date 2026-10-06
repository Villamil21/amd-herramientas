import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, Eye, EyeOff, UserPlus, X, XCircle } from "lucide-react";
import { Alert, Badge, Button, ConfirmDialog, Modal } from "../../../../components/ui";
import { SupplierFormModal } from "../../../../pages/suppliers/SupplierFormModal";
import type { PucCode, Supplier } from "../../../../types/models";
import { assignedLineCount, withDocumentCode, withLineCodes, withMode } from "../services/analysis";
import { formatCop, formatIssueDate } from "../services/labels";
import { PROBLEM_TITLE } from "../services/pending";
import type { PucIndex } from "../services/pucCatalog";
import { DOC_CATEGORY_LABEL, type AssignmentMode, type DocAssignment, type DocLine, type DocRow, type ProblemCode, type UnknownTitle } from "../types";
import { TitleClassifyButtons } from "./PendingPanel";
import { PucCodePicker } from "./PucCodePicker";
import { ClassificationBadge } from "./StatusBadge";

interface Props {
  row: DocRow | null;
  index: PucIndex;
  assignment?: DocAssignment;
  /** Abierto desde «Ver productos»: la tabla queda a la vista. */
  openProducts: boolean;
  /** Título del documento que aún no está clasificado. */
  unknownTitle?: UnknownTitle;
  /**
   * Proveedor de la factura en Datos → Proveedores (por NIT del emisor). null:
   * no está registrado y hay que crearlo antes de asignar códigos. Sin definir:
   * aún no se sabe (la lista de proveedores no ha cargado o la factura no trae NIT).
   */
  supplier?: Supplier | null;
  /** Se creó el proveedor de esta factura: hay que volver a leer Proveedores. */
  onSupplierCreated: () => Promise<void> | void;
  /** Códigos ya usados con el proveedor de esta factura (accesos rápidos del buscador). Sin definir mientras no se conozcan. */
  suggestions?: PucCode[];
  /** `confirmedCode`: el código que el usuario acaba de confirmar en el buscador (queda asociado al proveedor). */
  onAssign: (fileName: string, assignment: DocAssignment, confirmedCode?: string) => void;
  /** Se guardó la clasificación de un título. */
  onChanged: () => Promise<void> | void;
  onClose: () => void;
  /** Pendientes que quedan además de este documento. */
  remainingPending: number;
  onNextPending: () => void;
}

const assignable = (l: DocLine) => !l.issue;

/**
 * Detalle de una factura: qué falta, sus datos, la modalidad de asignación
 * («un solo código» o «por producto») y sus productos con Código y Concepto
 * PUC. Las asignaciones son del análisis: el PDF no se modifica.
 */
export function DocumentDetailModal({ row, index, assignment = {}, openProducts, unknownTitle, supplier, onSupplierCreated, suggestions, onAssign, onChanged, onClose, remainingPending, onNextPending }: Props) {
  const [showProducts, setShowProducts] = useState(false);
  const [editingCode, setEditingCode] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [pickerKey, setPickerKey] = useState(0);
  const [confirmSingle, setConfirmSingle] = useState(false);
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const assignRef = useRef<HTMLDivElement>(null);
  const productsRef = useRef<HTMLDivElement>(null);
  const fileName = row?.fileName;
  const mode = row?.mode;

  useEffect(() => {
    setShowProducts(openProducts);
    setEditingCode(false);
    setConfirmSingle(false);
    setCreatingSupplier(false);
  }, [fileName, openProducts]);

  // Al entrar a «por producto» queda apuntado el primer producto sin código.
  useEffect(() => {
    const first = mode === "product" ? row?.lines.find((l) => assignable(l) && !l.code) : undefined;
    setSelected(first ? [first.index] : []);
    setPickerKey((k) => k + 1);
    // Solo al cambiar de documento o de modalidad: después manda la selección del usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName, mode]);

  useEffect(() => {
    if (fileName && openProducts) productsRef.current?.scrollIntoView({ block: "nearest" });
  }, [fileName, openProducts, showProducts]);

  if (!row) return null;
  const assign = (next: DocAssignment, confirmedCode?: string) => onAssign(row.fileName, next, confirmedCode);
  const failed = Boolean(row.failure);
  const excluded = row.excluded;
  const gross = row.grossTotalCents;
  const lines = row.lines;
  const missing = lines.filter((l) => assignable(l) && !l.concept);
  const unread = lines.filter((l) => l.issue);
  const toAssignment = () => assignRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });

  function chooseMode(next: AssignmentMode) {
    if (next === row!.mode) return;
    // Pasar a un solo código descarta los códigos por producto: se confirma antes.
    if (next === "document" && assignedLineCount(assignment) > 0) return setConfirmSingle(true);
    assign(withMode(assignment, next, lines.length));
  }

  function applyToSelected(code: string) {
    assign(withLineCodes(assignment, selected, code), code);
    // Siguiente producto sin código: primero hacia abajo, luego desde el principio.
    const rest = missing.filter((l) => !selected.includes(l.index));
    const next = rest.find((l) => l.index > Math.max(...selected)) ?? rest[0];
    setSelected(next ? [next.index] : []);
    setPickerKey((k) => k + 1);
  }

  function toggle(index: number) {
    setSelected((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index].sort((a, b) => a - b)));
  }

  function target(index: number) {
    setSelected([index]);
    setPickerKey((k) => k + 1);
    toAssignment();
  }

  function problemActions(code: ProblemCode): ReactNode {
    const exclude = (
      <Button size="sm" onClick={() => assign({ ...assignment, excluded: true })} title="El documento no se suma y deja de bloquear la exportación.">
        Excluir documento
      </Button>
    );
    switch (code) {
      case "duplicate":
        return (
          <>
            <Button size="sm" variant="primary" onClick={() => assign({ ...assignment, excluded: true })}>
              Excluir duplicado
            </Button>
            {row!.duplicateBy === "number" && (
              <Button size="sm" onClick={() => assign({ ...assignment, includeDuplicate: true })} title="Es otro documento con el mismo número: se tiene en cuenta.">
                No es duplicado: incluir
              </Button>
            )}
          </>
        );
      case "gross-missing":
        return (
          <>
            <Button size="sm" variant="primary" onClick={() => chooseMode("product")}>
              Elegir código por producto
            </Button>
            {exclude}
          </>
        );
      case "lines-unread":
      case "no-products":
        return (
          <>
            <Button size="sm" variant="primary" onClick={() => chooseMode("document")}>
              Usar un solo código
            </Button>
            {exclude}
          </>
        );
      case "title-missing":
        return exclude;
      default:
        return (
          <Button size="sm" variant="primary" onClick={toAssignment}>
            {code === "no-mode" ? "Elegir modalidad" : "Asignar código"}
          </Button>
        );
    }
  }

  const item = (key: string, title: string, detail: ReactNode, actions: ReactNode) => (
    <li key={key} className="pending-item pending-item--blocking">
      <XCircle size={15} className="pending-item__icon" aria-label="Bloquea la exportación" />
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
        onClick={() => assign({ ...assignment, excluded: !excluded })}
        title={excluded ? "Vuelve a tener en cuenta el documento." : "El documento no se suma y deja de bloquear la exportación."}
        style={{ marginRight: "auto" }}
      >
        {excluded ? "Volver a incluir" : "Excluir del análisis"}
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

  const selectedLines = lines.filter((l) => selected.includes(l.index));
  const allSelected = lines.some(assignable) && lines.filter(assignable).every((l) => selected.includes(l.index));

  return (
    <Modal open size="xl" title={row.fileName} onClose={onClose} footer={footer} locked={confirmSingle || creatingSupplier}>
      <div className="stack">
        <div className="row">
          <ClassificationBadge row={row} />
          {row.category && <Badge tone={row.category === "credit_note" ? "gold" : "dark"}>{DOC_CATEGORY_LABEL[row.category]}</Badge>}
          {row.duplicateOf && <Badge tone="danger">Duplicado</Badge>}
          {row.category === "credit_note" && !excluded && <span className="muted">Nota crédito: sus valores restan en el resumen.</span>}
        </div>

        {excluded && <Alert tone="info">Documento excluido por decisión tuya: no suma en el resumen ni bloquea la exportación.</Alert>}
        {row.failure && (
          <Alert tone="danger" title="No fue posible procesar el archivo">
            {row.failure.message}
            {!excluded && " Si no es una factura de este análisis, exclúyelo para que no bloquee la exportación."}
          </Alert>
        )}

        {!failed && !excluded && (unknownTitle || row.problems.length > 0) && (
          <ul className="pending-list attention-block attention-block--danger">
            {unknownTitle &&
              item("title", "Título de documento sin clasificar", <>Título detectado: «{unknownTitle.displayTitle}». ¿Dónde deseas clasificarlo?</>, <TitleClassifyButtons title={unknownTitle} onSaved={onChanged} />)}
            {row.problems.map((p, i) => item(`${p.code}-${i}`, PROBLEM_TITLE[p.code], p.text, problemActions(p.code)))}
          </ul>
        )}

        {!failed && (
          <>
            <div className="summary-grid">
              <Item label="Título del documento" value={row.title} wide />
              <Item label="Número de factura" value={row.number ?? "—"} />
              <Item label="Fecha de emisión" value={formatIssueDate(row.issueDate)} />
              <Item label="NIT del emisor" value={row.issuerNit} />
              <Item label="Razón social del emisor" value={row.issuerName || "—"} wide />
              <Item label="Líneas de producto" value={String(lines.length)} />
              <Item label="Total Bruto Factura" value={gross !== undefined ? formatCop(gross) : "No identificado"} wide />
              <Item label="Valor asignado" value={row.allocations.length ? formatCop(row.assignedCents) : "—"} wide />
            </div>

            {!excluded && supplier === null && (
              <div className="puc-assign puc-supplier-missing" ref={assignRef}>
                <strong>Proveedor no registrado</strong>
                <dl className="puc-confirm__data">
                  <div>
                    <dt>NIT</dt>
                    <dd className="selectable">{row.issuerNit}</dd>
                  </div>
                  <div>
                    <dt>Razón social</dt>
                    <dd className="selectable">{row.issuerName || "No identificada en la factura"}</dd>
                  </div>
                </dl>
                <span className="field__hint">Créalo para asignar el código PUC: los códigos que confirmes quedan guardados con este proveedor para sus próximas facturas.</span>
                <div className="row">
                  <Button variant="primary" size="sm" icon={<UserPlus size={14} />} onClick={() => setCreatingSupplier(true)}>
                    Crear proveedor
                  </Button>
                </div>
              </div>
            )}

            {!excluded && supplier !== null && (
              <div className="stack stack--sm" ref={assignRef}>
                <strong>¿Cómo deseas asignar el código PUC?</strong>
                <div className="mode-choice" role="radiogroup" aria-label="¿Cómo deseas asignar el código PUC?">
                  <button type="button" role="radio" aria-checked={mode === "document"} className={`mode-choice__option ${mode === "document" ? "is-active" : ""}`} onClick={() => chooseMode("document")}>
                    <strong>Un solo código para toda la factura</strong>
                    <span>
                      El valor asignado es el Total Bruto Factura{gross !== undefined ? ` (${formatCop(gross)})` : ""}, no la suma del «Precio unitario de venta».
                    </span>
                  </button>
                  <button type="button" role="radio" aria-checked={mode === "product"} className={`mode-choice__option ${mode === "product" ? "is-active" : ""}`} onClick={() => chooseMode("product")}>
                    <strong>Elegir código por producto</strong>
                    <span>Cada producto lleva su propio código; el valor es su «Precio unitario de venta».</span>
                  </button>
                </div>

                {mode === "document" &&
                  (row.documentCode && row.documentConcept && !editingCode ? (
                    <div className="puc-assigned">
                      <CheckCircle2 size={18} aria-hidden />
                      <div className="puc-assigned__text">
                        <strong className="selectable">
                          {row.documentCode} — {row.documentConcept}
                        </strong>
                        <span>
                          Toda la factura queda en este código. Valor asignado = Total Bruto Factura{gross !== undefined ? `: ${formatCop(gross)}` : " (no identificado)"}
                          {row.category === "credit_note" ? " (se resta por ser Nota crédito)" : ""}.
                        </span>
                      </div>
                      <Button size="sm" onClick={() => setEditingCode(true)}>
                        Cambiar código
                      </Button>
                    </div>
                  ) : (
                    <div className="puc-assign">
                      <strong>Código PUC de la factura</strong>
                      <PucCodePicker
                        key={`doc-${row.fileName}-${editingCode}`}
                        index={index}
                        suggestions={suggestions}
                        autoFocus
                        onCancel={editingCode ? () => setEditingCode(false) : undefined}
                        onConfirm={(code) => {
                          assign(withDocumentCode(assignment, code), code);
                          setEditingCode(false);
                        }}
                      />
                    </div>
                  ))}

                {mode === "product" && lines.length > 0 && (
                  <div className="puc-assign">
                    <div className="row row--between">
                      <strong>
                        {selectedLines.length === 0
                          ? "Selecciona uno o varios productos para asignarles un código"
                          : selectedLines.length === 1
                            ? `Código PUC para: ${selectedLines[0].description || `producto ${selectedLines[0].row}`}`
                            : `Código PUC para ${selectedLines.length} productos seleccionados`}
                      </strong>
                      <Button size="sm" variant="ghost" disabled={missing.length === 0} onClick={() => setSelected(missing.map((l) => l.index))}>
                        Seleccionar los que faltan ({missing.length})
                      </Button>
                    </div>
                    {selectedLines.length > 0 && (
                      <PucCodePicker
                        key={`line-${row.fileName}-${pickerKey}`}
                        index={index}
                        suggestions={suggestions}
                        confirmLabel={selectedLines.length > 1 ? `Confirmar para ${selectedLines.length} productos` : "Confirmar código"}
                        onConfirm={applyToSelected}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {unread.length > 0 && (
              <Alert tone={mode === "product" ? "danger" : "warning"} title="Filas que requieren revisión">
                No se inventan valores: estas filas de «Detalles de Productos» no se pudieron interpretar{mode === "product" ? " y no admiten código por producto" : ""}.
                <div className="table-wrap" style={{ marginTop: "var(--space-2)" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Página</th>
                        <th>Fila</th>
                        <th>Texto detectado</th>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unread.map((l) => (
                        <tr key={l.index}>
                          <td>{l.page}</td>
                          <td>{l.row}</td>
                          <td className="selectable">{l.detectedText || "—"}</td>
                          <td>{l.issue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Alert>
            )}

            <div className="stack stack--sm" ref={productsRef}>
              <div className="row row--between">
                <strong>Detalle de productos</strong>
                {mode !== "product" && (
                  <Button size="sm" variant="ghost" icon={showProducts ? <EyeOff size={14} /> : <Eye size={14} />} onClick={() => setShowProducts((v) => !v)}>
                    {showProducts ? "Ocultar productos" : "Ver productos"}
                  </Button>
                )}
              </div>
              {(mode === "product" || showProducts) &&
                (lines.length === 0 ? (
                  <Alert tone="info">No se encontraron productos en «Detalles de Productos».</Alert>
                ) : (
                  <div className="table-wrap table-wrap--scroll" style={{ maxHeight: 360 }}>
                    <table className="table">
                      <thead>
                        <tr>
                          {mode === "product" && !excluded && (
                            <th style={{ width: 1 }}>
                              <input
                                type="checkbox"
                                aria-label="Seleccionar todos los productos"
                                checked={allSelected}
                                onChange={() => setSelected(allSelected ? [] : lines.filter(assignable).map((l) => l.index))}
                              />
                            </th>
                          )}
                          <th>Descripción</th>
                          <th className="num">Precio unitario de venta</th>
                          <th>Código PUC</th>
                          <th>Concepto PUC</th>
                          {mode === "product" && !excluded && <th />}
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l) => {
                          const editable = mode === "product" && !excluded;
                          const isSelected = editable && selected.includes(l.index);
                          return (
                            <tr key={l.index} className={[editable && assignable(l) && "is-clickable", isSelected && "is-selected"].filter(Boolean).join(" ") || undefined} onClick={editable && assignable(l) ? () => target(l.index) : undefined}>
                              {editable && (
                                <td onClick={(e) => e.stopPropagation()}>
                                  <input type="checkbox" aria-label={`Seleccionar ${l.description || `producto ${l.row}`}`} checked={isSelected} disabled={!assignable(l)} onChange={() => toggle(l.index)} />
                                </td>
                              )}
                              <td className="selectable" style={{ minWidth: 220 }}>
                                {l.description || <span className="muted">(sin descripción)</span>}
                                {l.issue && <div className="table__secondary puc-line-issue">Requiere revisión: {l.issue}</div>}
                              </td>
                              <td className="num selectable">{l.priceCents === undefined ? "—" : formatCop(l.priceCents)}</td>
                              <td className="selectable" style={{ whiteSpace: "nowrap" }}>
                                {l.code ?? <span className="muted">Pendiente</span>}
                              </td>
                              <td className="selectable">{l.concept ?? (l.code ? <span className="puc-line-issue">Código inválido</span> : <span className="muted">Pendiente</span>)}</td>
                              {editable && (
                                <td className="actions" onClick={(e) => e.stopPropagation()}>
                                  {assignable(l) && (
                                    <>
                                      <Button size="sm" variant={l.concept ? "ghost" : "secondary"} onClick={() => target(l.index)}>
                                        {l.code ? "Cambiar" : "Asignar"}
                                      </Button>
                                      {l.code && <Button size="sm" variant="ghost" iconOnly icon={<X size={14} />} aria-label={`Quitar el código de ${l.description || `producto ${l.row}`}`} title="Quitar código" onClick={() => assign(withLineCodes(assignment, [l.index], undefined))} />}
                                    </>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
            </div>
          </>
        )}
      </div>

      <SupplierFormModal
        open={creatingSupplier}
        supplier={null}
        draft={{ nit: row.issuerNit ?? "", businessName: row.issuerName ?? "" }}
        onClose={() => setCreatingSupplier(false)}
        onSaved={() => {
          setCreatingSupplier(false);
          void onSupplierCreated();
        }}
      />
      <ConfirmDialog
        open={confirmSingle}
        title="Aplicar un solo código a toda la factura"
        confirmLabel="Usar un solo código"
        message={
          <>
            Esta factura ya tiene código en {assignedLineCount(assignment) === 1 ? "1 producto" : `${assignedLineCount(assignment)} productos`}. Al continuar se reemplazan por un único código para toda la factura y el
            valor asignado pasa a ser el Total Bruto Factura.
          </>
        }
        onCancel={() => setConfirmSingle(false)}
        onConfirm={() => {
          setConfirmSingle(false);
          assign(withMode(assignment, "document", lines.length));
        }}
      />
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
