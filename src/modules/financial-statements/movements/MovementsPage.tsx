import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, History, Pencil, RefreshCcw } from "lucide-react";
import { navigate, paths } from "../../../app/router";
import { Alert, Badge, Button, Card, DateInput, EmptyState, Field, Input, Modal, PageHeader, Select, useToast } from "../../../components/ui";
import { useDebounced } from "../../../hooks/useDebounced";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import { MOVEMENT_STATUS_LABEL, SOURCE_LABEL, type BatchSummary, type FsSource, type Movement, type MovementEdit, type MovementEditInput, type MovementEditSnapshot, type MovementStatus } from "../../../types/fs";
import { formatInteger } from "../../../utils/format";
import { normalizeKey } from "../../../utils/text";
import { CompanySelect } from "../shared/components/CompanySelect";
import { PucField } from "../shared/components/PucField";
import { formatExactCents, formatIsoDate } from "../shared/money";
import { useFsData } from "../shared/useFsData";
import { bankAccountingCents, isDebitPuc } from "../generator/engine";
import { formatDateForDisplay, formatDateTimeForDisplay } from "../../../utils/dates";
import { parseNumericText } from "../../../utils/numbers";

/** Submódulo donde nace cada origen (para «Abrir origen»). */
export const SOURCE_PATH: Record<FsSource, string> = {
  purchases: paths.submodule("estados-financieros", "codigos-puc-por-factura"),
  bank: paths.submodule("estados-financieros", "extractos-bancarios"),
  payroll: paths.submodule("estados-financieros", "nomina"),
  sales_einvoice: paths.provider("estados-financieros", "ventas", "facturacion-electronica"),
  sales_tpsv: paths.provider("estados-financieros", "ventas", "reporte-de-operaciones"),
  opening: paths.submodule("estados-financieros", "saldos-iniciales"),
  adjustment: paths.submodule("estados-financieros", "generador"),
};

const MAX_ROWS = 500;

const STATUS_TONE: Record<MovementStatus, "success" | "warning" | "danger" | "gold" | undefined> = { active: "success", replaced: "warning", adjusted: "gold", ignored: undefined, voided: "danger" };

/**
 * Centro de revisión y trazabilidad de todo lo enviado a Estados Financieros.
 * Cada movimiento se puede editar (fecha, PUC, concepto, valor, descripción o
 * estado) con motivo obligatorio: el original nunca se sobrescribe (queda
 * «Ajustado» y la corrección es una versión nueva). También «Reclasificar
 * movimientos anteriores» en bloque.
 */
export default function MovementsPage() {
  const toast = useToast();
  const data = useFsData();
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [filters, setFilters] = useState({ from: "", to: "", source: "", puc: "", party: "", bank: "", document: "", period: "", status: "active" });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<Movement | null>(null);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<MovementEdit[]>([]);
  const [reclassifyTo, setReclassifyTo] = useState<string | undefined>();
  const [reclassifying, setReclassifying] = useState(false);
  const text = useDebounced(filters, 150);

  const load = useCallback(async () => {
    if (companyId === null) return;
    try {
      const [m, b, e] = await Promise.all([fsService.movements(companyId), fsService.batches(companyId), fsService.movementEdits(companyId)]);
      setMovements(m);
      setBatches(b);
      setEdits(e);
      setSelected(new Set());
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [companyId, toast]);

  useEffect(() => {
    setMovements([]);
    void load();
  }, [load]);

  const batchById = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);
  const filtered = useMemo(() => {
    const has = (value: string, q: string) => !q || normalizeKey(value).includes(normalizeKey(q));
    return movements.filter(
      (m) =>
        (!text.from || m.accountingDate >= text.from) &&
        (!text.to || m.accountingDate <= text.to) &&
        (!text.source || m.source === text.source) &&
        (!text.status || m.status === text.status) &&
        (!text.period || m.accountingDate.startsWith(text.period)) &&
        (!text.puc || m.pucCode.startsWith(text.puc.trim())) &&
        has(`${m.supplierNit} ${m.supplierName} ${m.description}`, text.party) &&
        has(`${m.bank} ${m.accountNumber}`, text.bank) &&
        has(`${m.documentNumber} ${m.documentId}`, text.document),
    );
  }, [movements, text]);
  const shown = filtered.slice(0, MAX_ROWS);
  const total = filtered.reduce((s, m) => s + m.amountCents, 0);
  const set = (key: keyof typeof filters) => (e: { target: { value: string } }) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const selectable = shown.filter((m) => m.status === "active" && m.source !== "adjustment");

  async function reclassify() {
    if (!reclassifyTo || selected.size === 0) return;
    setReclassifying(true);
    try {
      const n = await fsService.reclassify(companyId, [...selected], reclassifyTo);
      toast(`${formatInteger(n)} movimientos reclasificados a ${reclassifyTo}.`);
      setReclassifyTo(undefined);
      await load();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setReclassifying(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Estados Financieros"
        title="Movimientos contables"
        description="Revisión y trazabilidad de todo lo enviado a Estados Financieros. Abre un movimiento para ver su origen o editarlo: cada cambio guarda motivo, valor anterior y valor nuevo."
      />
      <Card>
        <div className="stack">
          {companyId === null && <CompanySelect companies={data.companies} value={companyId} onChange={setCompanyId} />}
          {companyId !== null && (
            <div className="filter-grid">
              <div className="filter-grid__wide">
                <CompanySelect companies={data.companies} value={companyId} onChange={setCompanyId} />
              </div>
              <Field label="Desde">{(id) => <DateInput id={id} value={filters.from} onChange={(v) => set("from")({ target: { value: v } })} />}</Field>
              <Field label="Hasta">{(id) => <DateInput id={id} value={filters.to} onChange={(v) => set("to")({ target: { value: v } })} />}</Field>
              <Field label="Periodo">{(id) => <Input id={id} type="month" value={filters.period} onChange={set("period")} />}</Field>
              <Field label="Origen">
                {(id) => (
                  <Select id={id} value={filters.source} onChange={set("source")}>
                    <option value="">Todos</option>
                    {Object.entries(SOURCE_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Estado">
                {(id) => (
                  <Select id={id} value={filters.status} onChange={set("status")}>
                    <option value="">Todos</option>
                    {Object.entries(MOVEMENT_STATUS_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Código PUC">{(id) => <Input id={id} value={filters.puc} onChange={set("puc")} placeholder="5135" inputMode="numeric" />}</Field>
              <Field label="Proveedor / empleado">{(id) => <Input id={id} value={filters.party} onChange={set("party")} placeholder="Nombre o NIT" />}</Field>
              <Field label="Banco">{(id) => <Input id={id} value={filters.bank} onChange={set("bank")} placeholder="BBVA" />}</Field>
              <Field label="Documento">{(id) => <Input id={id} value={filters.document} onChange={set("document")} placeholder="Número o CUFE" />}</Field>
            </div>
          )}
        </div>
      </Card>

      {companyId !== null && (
        <>
          {selected.size > 0 && (
            <Alert tone="info" title={`Reclasificar movimientos anteriores (${formatInteger(selected.size)} seleccionados)`}>
              Cambia el código PUC de los movimientos seleccionados. No cambia asociaciones futuras ni periodos cerrados.
              <div className="row" style={{ marginTop: 8 }}>
                <PucField index={data.index} value={reclassifyTo} onChange={setReclassifyTo} placeholder="Elegir PUC nuevo" mappings={data.mappingMap} onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])} />
                <Button variant="primary" icon={<RefreshCcw size={14} />} disabled={!reclassifyTo} loading={reclassifying} onClick={() => void reclassify()}>
                  Reclasificar
                </Button>
                <Button variant="ghost" onClick={() => setSelected(new Set())}>
                  Quitar selección
                </Button>
              </div>
            </Alert>
          )}
          <Card flush title={`${formatInteger(filtered.length)} movimientos`} description={`Suma de los filtrados: ${formatExactCents(total)}${filtered.length > MAX_ROWS ? ` · Se muestran los primeros ${MAX_ROWS}` : ""}`}>
            {filtered.length === 0 ? (
              <EmptyState title="Sin movimientos" description="No hay movimientos con estos filtros." />
            ) : (
              <div className="table-wrap table-wrap--scroll" style={{ maxHeight: "62vh" }}>
                <table className="table table--dense movements-table">
                  <colgroup>
                    <col style={{ width: 32 }} />
                    <col style={{ width: 86 }} />
                    <col style={{ width: 112 }} />
                    <col />
                    <col style={{ width: "22%" }} />
                    <col style={{ width: 124 }} />
                    <col style={{ width: 88 }} />
                    <col style={{ width: 40 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Seleccionar todos"
                          checked={selectable.length > 0 && selectable.every((m) => selected.has(m.id))}
                          onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((m) => m.id)) : new Set())}
                        />
                      </th>
                      <th>Fecha</th>
                      <th>Origen</th>
                      <th>Tercero · documento</th>
                      <th>PUC · concepto</th>
                      <th className="num">Valor</th>
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((m) => (
                      <tr key={m.id} className="is-clickable" onClick={() => setOpen(m)}>
                        <td onClick={(e) => e.stopPropagation()}>
                          {m.status === "active" && m.source !== "adjustment" && (
                            <input
                              type="checkbox"
                              aria-label="Seleccionar movimiento"
                              checked={selected.has(m.id)}
                              onChange={(e) =>
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(m.id);
                                  else next.delete(m.id);
                                  return next;
                                })
                              }
                            />
                          )}
                        </td>
                        <td className="nowrap">{formatIsoDate(m.accountingDate)}</td>
                        <td>
                          <span className={`source-tag source-tag--${m.source}`} title={SOURCE_LABEL[m.source]}>
                            {SOURCE_LABEL[m.source]}
                          </span>
                          <div className="table__secondary nowrap">Importación #{m.batchId}</div>
                        </td>
                        <td title={[m.supplierName, m.documentNumber && `Doc. ${m.documentNumber}`, m.description].filter(Boolean).join(" · ")}>
                          <div className="cell-ellipsis table__primary">{m.supplierName || (m.bank ? `${m.bank} ${m.accountNumber}` : m.description || "—")}</div>
                          <div className="cell-ellipsis table__secondary">{[m.documentNumber && `Doc. ${m.documentNumber}`, (m.supplierName || m.bank) && m.description].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td title={`${m.pucCode} — ${m.pucConcept}`}>
                          <div className="cell-ellipsis">
                            <span className="mono puc-code-inline">{m.pucCode}</span> {m.pucConcept}
                          </div>
                        </td>
                        <td className={`num nowrap ${m.amountCents < 0 ? "amount--negative" : ""}`}>
                          {formatExactCents(m.amountCents)}
                          {m.dc && <div className="table__secondary">{m.dc === "D" ? "Salida" : "Entrada"}</div>}
                        </td>
                        <td>
                          <Badge tone={STATUS_TONE[m.status]}>{MOVEMENT_STATUS_LABEL[m.status]}</Badge>
                        </td>
                        <td className="actions" onClick={(e) => e.stopPropagation()}>
                          {m.status === "active" && m.source !== "adjustment" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              iconOnly
                              icon={<Pencil size={14} />}
                              aria-label={`Editar movimiento ${m.id}`}
                              title="Editar movimiento"
                              onClick={() => {
                                setOpen(m);
                                setEditing(true);
                              }}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <Modal
        open={open !== null && !editing}
        size="lg"
        title={open ? `${SOURCE_LABEL[open.source]} · ${open.description || open.pucConcept}` : ""}
        onClose={() => setOpen(null)}
        footer={
          open && (
            <>
              {open.status === "active" && open.source !== "adjustment" && (
                <Button variant="primary" icon={<Pencil size={14} />} onClick={() => setEditing(true)}>
                  Editar movimiento
                </Button>
              )}
              <Button icon={<ExternalLink size={14} />} onClick={() => navigate(SOURCE_PATH[open.source])}>
                Abrir origen
              </Button>
            </>
          )
        }
      >
        {open && <MovementDetail movement={open} batch={batchById.get(open.batchId)} edits={edits.filter((e) => e.originalMovementId === open.id || e.newMovementId === open.id)} />}
        {open?.source === "adjustment" && open.status === "active" && <Alert tone="info">Los ajustes manuales se editan desde Generador de Estados Financieros → Ajustes, con su propio historial.</Alert>}
      </Modal>

      {open && editing && (
        <MovementEditModal
          movement={open}
          data={data}
          onClose={() => setEditing(false)}
          onSaved={async (edit) => {
            setEditing(false);
            toast(edit.newMovementId ? "Movimiento corregido. El original queda como «Ajustado» en el historial." : `Movimiento marcado como «${MOVEMENT_STATUS_LABEL[edit.next.status]}».`);
            await load();
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

const snapshotText = (s: MovementEditSnapshot) => `${formatIsoDate(s.accountingDate)} · PUC ${s.pucCode} ${s.pucConcept} · ${formatExactCents(s.amountCents)}${s.description ? ` · «${s.description}»` : ""} · ${MOVEMENT_STATUS_LABEL[s.status]}`;

/** Historial de ediciones de un movimiento: identificador, fecha, motivo, antes y después. */
function EditHistory({ edits, movementId }: { edits: MovementEdit[]; movementId: number }) {
  if (edits.length === 0) return null;
  return (
    <div className="stack stack--sm">
      <div className="field__label row" style={{ gap: 6 }}>
        <History size={14} /> Historial de cambios
      </div>
      {edits.map((e) => (
        <Alert key={e.id} tone={e.originalMovementId === movementId ? "warning" : "info"} title={`Edición #${e.id} · ${formatDateTimeForDisplay(e.createdAt)} · Movimientos contables`}>
          <div>
            <strong>Motivo:</strong> {e.reason}
          </div>
          <div>
            <strong>Antes:</strong> {snapshotText(e.previous)}
          </div>
          <div>
            <strong>Después:</strong> {snapshotText(e.next)}
          </div>
          <div className="muted">{e.newMovementId ? `Movimiento #${e.originalMovementId} → versión corregida #${e.newMovementId}` : `Movimiento #${e.originalMovementId}: solo cambió el estado`}</div>
        </Alert>
      ))}
    </div>
  );
}

const EDIT_STATUS: { value: MovementEditInput["status"]; label: string }[] = [
  { value: "active", label: "Activo (corregir valores)" },
  { value: "ignored", label: "Ignorado (no afecta los Estados Financieros)" },
  { value: "voided", label: "Anulado" },
];

/** Edición individual: el original no se sobrescribe; motivo obligatorio. */
function MovementEditModal({ movement: m, data, onClose, onSaved }: { movement: Movement; data: ReturnType<typeof useFsData>; onClose: () => void; onSaved: (edit: MovementEdit) => Promise<void> }) {
  const toast = useToast();
  const [date, setDate] = useState(m.accountingDate);
  const [puc, setPuc] = useState<string | undefined>(m.pucCode);
  const [concept, setConcept] = useState(m.pucConcept);
  const [description, setDescription] = useState(m.description);
  const [value, setValue] = useState((m.amountCents / 100).toFixed(2).replace(".", ","));
  const [status, setStatus] = useState<MovementEditInput["status"]>("active");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const parsed = parseNumericText(value);
  const cents = parsed === null ? null : Math.round(parsed * 100);
  const changed = status !== "active" || date !== m.accountingDate || puc !== m.pucCode || concept.trim() !== m.pucConcept || description.trim() !== m.description || cents !== m.amountCents;
  const ready = !!reason.trim() && changed && (status !== "active" || (!!puc && /^\d{4}-\d{2}-\d{2}$/.test(date) && cents !== null && (!m.dc || cents >= 0)));

  async function save() {
    if (!ready || !puc || cents === null) return;
    setSaving(true);
    try {
      const edit = await fsService.editMovement({ movementId: m.id, accountingDate: date, pucCode: puc, pucConcept: puc === m.pucCode ? concept.trim() : "", description: description.trim(), amountCents: cents, status, reason: reason.trim() });
      await onSaved(edit);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={`Editar movimiento #${m.id}`}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} disabled={!ready} onClick={() => void save()}>
            Guardar cambio
          </Button>
        </>
      }
    >
      <div className="stack">
        <Alert tone="info">El movimiento original no se sobrescribe: queda como «Ajustado» en el historial y la corrección es una versión nueva. Si afecta un periodo cerrado, el cambio se bloquea.</Alert>
        <div className="form-grid">
          <Field label="Estado">
            {(id) => (
              <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as MovementEditInput["status"])}>
                {EDIT_STATUS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Fecha contable">{(id) => <DateInput id={id} value={date} onChange={setDate} disabled={status !== "active"} />}</Field>
          <Field label="Código PUC">
            {() => (
              <PucField
                index={data.index}
                value={puc}
                onChange={(code) => {
                  setPuc(code);
                  if (code !== m.pucCode) setConcept(code ? (data.index.concepts.get(code) ?? "") : "");
                  else setConcept(m.pucConcept);
                }}
                mappings={data.mappingMap}
                disabled={status !== "active"}
                onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])}
              />
            )}
          </Field>
          <Field label="Concepto" hint={puc !== m.pucCode ? "Con un PUC nuevo se usa el concepto del catálogo." : undefined}>
            {(id) => <Input id={id} value={concept} onChange={(e) => setConcept(e.target.value)} disabled={status !== "active" || puc !== m.pucCode} />}
          </Field>
          <Field label="Valor" hint={m.dc ? `Valor absoluto; la dirección (${m.dc === "D" ? "salida" : "entrada"} del banco) se conserva.` : "Con signo: negativo resta en su línea."}>
            {(id) => <Input id={id} className="input--right" value={value} onChange={(e) => setValue(e.target.value)} invalid={value.trim() !== "" && (cents === null || (!!m.dc && cents < 0))} disabled={status !== "active"} />}
          </Field>
          <Field label="Descripción">{(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} disabled={status !== "active"} />}</Field>
        </div>
        <Field label="Motivo del cambio" required>
          {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. Valor mal digitado en la factura" />}
        </Field>
        <div className="muted" style={{ fontSize: "var(--text-sm)" }}>
          Antes: {formatIsoDate(m.accountingDate)} · PUC {m.pucCode} · {formatExactCents(m.amountCents)}
          {cents !== null && status === "active" && (
            <>
              {" "}
              → Después: {formatIsoDate(date)} · PUC {puc ?? "—"} · {formatExactCents(cents)}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function MovementDetail({ movement: m, batch, edits }: { movement: Movement; batch?: BatchSummary; edits: MovementEdit[] }) {
  const item = (label: string, value: string | number | null | undefined) =>
    value === null || value === undefined || value === "" ? null : (
      <div className="summary-item">
        <span className="summary-item__label">{label}</span>
        <span className="summary-item__value selectable">{value}</span>
      </div>
    );
  const detail = (m.detail ?? {}) as Record<string, unknown>;
  const original = Array.isArray(detail.movements) ? (detail.movements as { date: string; description: string; amountCents: number }[]) : [];
  const gmf = detail.gmf as { origin?: string; percent: number; outflowCents: number; inflowCents: number; originalNetCents: number; accountingCents: number } | undefined;
  return (
    <div className="stack">
      <div className="summary-grid">
        {item("Fecha contable", formatIsoDate(m.accountingDate))}
        {item("Valor exacto", formatExactCents(m.amountCents))}
        {item("Dirección bancaria", m.dc && (m.dc === "D" ? "Salida (disminuye el banco)" : "Entrada (aumenta el banco)"))}
        {item("Valor contable", m.dc && `${formatExactCents(bankAccountingCents(m.dc, m.amountCents, isDebitPuc(m.pucCode)))} (naturaleza ${isDebitPuc(m.pucCode) ? "débito" : "crédito"} del PUC)`)}
        {item("Código PUC", `${m.pucCode} — ${m.pucConcept}`)}
        {item("Estado", MOVEMENT_STATUS_LABEL[m.status as MovementStatus])}
        {item("Documento", m.documentNumber)}
        {item("Tipo de documento", m.documentType)}
        {item("ID del documento", m.documentId)}
        {item("Proveedor", m.supplierName && `${m.supplierName} (NIT ${m.supplierNit})`)}
        {item("Banco / cuenta", m.bank && `${m.bank} ${m.accountNumber}`)}
        {item("Paga la cuenta por pagar el", m.settlesOn && formatIsoDate(m.settlesOn))}
        {item("Concepto interno", m.conceptKey)}
        {item("Registrado", formatDateTimeForDisplay(m.createdAt, { seconds: true }))}
      </div>
      {batch && (
        <Alert tone="info" title={`Importación #${batch.id} · ${SOURCE_LABEL[batch.source]}`}>
          {[batch.fileName, batch.periodLabel].filter(Boolean).join(" · ")} · {formatInteger(batch.recordCount)} registros · {formatDateForDisplay(batch.createdAt)} · {batch.status === "active" ? "Activa" : batch.status === "replaced" ? `Reemplazada${batch.replacedBy ? ` por la importación #${batch.replacedBy}` : ""}` : "Anulada"}
        </Alert>
      )}
      {original.length > 0 && (
        <div className="table-wrap" style={{ maxHeight: 260 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Movimiento original del extracto</th>
                <th style={{ textAlign: "right" }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {original.map((o, i) => (
                <tr key={i}>
                  <td>{formatDateForDisplay(o.date)}</td>
                  <td>{o.description}</td>
                  <td className="nowrap" style={{ textAlign: "right" }}>{formatExactCents(o.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {gmf && (
        <Alert
          tone="info"
          title={`Clasificación especial: GMF / 4x1000 · ${gmf.percent} % a Estados Financieros`}
          items={[
            `Salidas del extracto: ${formatExactCents(gmf.outflowCents)} · Entradas / devoluciones: ${formatExactCents(gmf.inflowCents)}`,
            `Valor original neto: ${formatExactCents(gmf.originalNetCents)} → valor contable enviado (${gmf.percent} %): ${formatExactCents(gmf.accountingCents)}`,
            `GMF confirmado: Sí · Origen: ${gmf.origin === "manual" ? "Manual" : "Automática (palabra clave)"}`,
          ]}
        >
          El extracto se conserva al 100 %; la otra mitad no se envía a ninguna cuenta.
        </Alert>
      )}
      {Array.isArray(detail.reclassified) && <Alert tone="warning" title="Reclasificado" items={(detail.reclassified as { from: string; to: string; at: string }[]).map((r) => `${r.from} → ${r.to} (${formatDateForDisplay(r.at)})`)} />}
      <EditHistory edits={edits} movementId={m.id} />
    </div>
  );
}
