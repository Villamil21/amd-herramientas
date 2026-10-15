import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, ConfirmDialog, DateInput, Field, Input, Modal, useToast } from "../../../components/ui";
import { errorMessage } from "../../../services/tauri";
import { formatExactCents, formatIsoDate, isIsoDate } from "../shared/money";
import { formatDateTimeForDisplay, parseTaxPaymentDate } from "../../../utils/dates";
import { TAX_FORM_LABEL } from "./parser/taxReturnParser";
import { parseNumericText } from "../../../utils/numbers";
import { anomalies, effectiveValues, paidCents, pendingCents, periodName, STATUS_LABEL, taxStatus, type TaxStatus } from "./services/effects";
import { draftBlockers, draftInput, withExisting, type ImportDraft } from "./services/importDraft";
import { taxService } from "./services/taxService";
import { PERIODICITY_LABEL, TAX_LABEL, type TaxPayment, type TaxReturn, type VatPeriodicity } from "./types";

const STATUS_TONE: Record<TaxStatus, "success" | "warning" | "danger" | "gold" | undefined> = {
  pending: "warning",
  partial: "warning",
  paid: "success",
  favor: "gold",
  none: undefined,
  review: "danger",
  superseded: undefined,
};

export function StatusBadge({ status }: { status: TaxStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

const item = (label: string, value: React.ReactNode) =>
  value === null || value === undefined || value === "" ? null : (
    <div className="summary-item">
      <span className="summary-item__label">{label}</span>
      <span className="summary-item__value selectable">{value}</span>
    </div>
  );

// ---------------------------------------------------------------------------
// Importar
// ---------------------------------------------------------------------------

export function ImportModal({
  draft,
  vatPeriodicity,
  returns,
  onChange,
  onClose,
  onSaved,
}: {
  draft: ImportDraft | null;
  vatPeriodicity: VatPeriodicity | null;
  returns: TaxReturn[];
  onChange: (d: ImportDraft) => void;
  onClose: () => void;
  onSaved: (companyId: number) => Promise<void>;
}) {
  const toast = useToast();
  const [confirmName, setConfirmName] = useState(false);
  const [confirmCorrection, setConfirmCorrection] = useState(false);
  const [yearText, setYearText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConfirmName(false);
    setConfirmCorrection(Boolean(draft?.correctsExisting));
    setYearText(draft?.year ? String(draft.year) : "");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.parsed, draft?.fileName]);

  if (!draft) return <Modal open={false} title="" onClose={onClose} />;
  const p = draft.parsed;
  const yearEditable = p.yearSource !== "form";
  const blockers = draftBlockers(draft, confirmName, confirmCorrection);
  const v = (k: keyof typeof p.values) => (p.values[k] ? formatExactCents(p.values[k]!.cents) : "—");
  const willSetPeriodicity = p.taxType === "vat" && !vatPeriodicity && draft.periodicity;

  function changeYear(text: string) {
    setYearText(text);
    const year = /^\d{4}$/.test(text) ? Number(text) : null;
    onChange(withExisting({ ...draft!, year }, returns));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (willSetPeriodicity) await taxService.saveSettings({ companyId: draft!.company!.id, vatPeriodicity: draft!.periodicity as VatPeriodicity });
      const source = p.yearSource === "form" ? "form" : String(draft!.year) === String(p.year) ? p.yearSource : "manual";
      await taxService.save(draftInput(draft!, source));
      toast("Declaración guardada.");
      await onSaved(draft!.company!.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={`Importar ${TAX_FORM_LABEL[p.taxType]}`}
      description={draft.fileName}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={blockers.length > 0} title={blockers[0]}>
            Guardar declaración
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="summary-grid">
          {item("Empresa", draft.company ? `${draft.company.razonSocial} (NIT ${draft.company.nit})` : <Badge tone="danger">Sin empresa con ese NIT</Badge>)}
          {item("NIT y razón social del formulario", `${p.nit}${p.dv ? `-${p.dv}` : ""} · ${p.companyName || "—"}`)}
          {item("Número de formulario", p.formNumber || "—")}
          {item("Formulario anterior (corrección)", p.previousFormNumber)}
          {!yearEditable && item("Año", draft.year)}
          {p.taxType !== "income" && item("Periodo", draft.year && p.period ? periodName({ taxType: p.taxType, year: draft.year, period: p.period, periodicity: draft.periodicity ?? "monthly" }) : p.period ?? "—")}
          {p.taxType === "vat" && item("Periodicidad", draft.periodicity ? PERIODICITY_LABEL[draft.periodicity] + (p.periodicity ? " (según el formulario)" : " (configuración de la empresa)") : "—")}
          {item("Fecha de presentación", p.presentedOn ? `${formatIsoDate(p.presentedOn)} (no es la fecha de pago)` : null)}
        </div>
        {yearEditable && (
          <Field label="Año gravable" required hint={p.yearSource === "presentation" ? "El formulario no trae el año como texto: se propone el año anterior a la presentación. Confírmalo." : "No se pudo leer el año."}>
            {(id) => <Input id={id} inputMode="numeric" value={yearText} onChange={(e) => changeYear(e.target.value.replace(/\D/g, "").slice(0, 4))} style={{ maxWidth: 120 }} />}
          </Field>
        )}

        <div className="summary-grid">
          {p.taxType === "withholding" && item("Total retenciones más sanciones", v("withholdingTotal"))}
          {p.taxType === "vat" && (
            <>
              {item("Total saldo a pagar", v("vatPayable"))}
              {item("Total saldo a favor", v("vatFavor"))}
            </>
          )}
          {p.taxType === "income" && (
            <>
              {item("Renta líquida ordinaria del ejercicio", v("incomeOrdinary"))}
              {item("Pérdida líquida del ejercicio", v("incomeLoss"))}
              {item("Total saldo a pagar", v("incomePayable"))}
              {item("Total saldo a favor", v("incomeFavor"))}
              {item(`Anticipo renta año siguiente (${draft.year ? draft.year + 1 : "—"})`, v("incomeAdvanceNext"))}
              {item("Saldo a pagar por impuesto (informativo)", v("incomeTaxBalance"))}
            </>
          )}
        </div>

        {p.warnings.length > 0 && <Alert tone="warning" title="Revisa la lectura" items={p.warnings} />}
        {draft.duplicate && <Alert tone="danger">El formulario {p.formNumber} ya fue importado ({periodName(draft.duplicate)}). No se duplica.</Alert>}
        {draft.periodicityMismatch && (
          <Alert tone="warning" title="La periodicidad no coincide">
            El formulario es {PERIODICITY_LABEL[p.periodicity!].toLowerCase()} y la empresa está configurada como {PERIODICITY_LABEL[vatPeriodicity!].toLowerCase()}. Se guarda con la del formulario y queda «Requiere revisión» hasta corregir la configuración de la empresa.
          </Alert>
        )}
        {willSetPeriodicity && <Alert tone="info">La empresa no tenía periodicidad de IVA: se guardará {PERIODICITY_LABEL[draft.periodicity!].toLowerCase()} (la del formulario).</Alert>}
        {draft.nameMismatch && (
          <label className="checkbox">
            <input type="checkbox" checked={confirmName} onChange={(e) => setConfirmName(e.target.checked)} />
            <span>
              El NIT coincide con {draft.company!.razonSocial}, pero el formulario dice «{p.companyName}». Confirmo que la declaración es de esta empresa.
            </span>
          </label>
        )}
        {draft.existing && (
          <label className="checkbox">
            <input type="checkbox" checked={confirmCorrection} onChange={(e) => setConfirmCorrection(e.target.checked)} />
            <span>
              Ya existe la declaración de este periodo (formulario {draft.existing.formNumber || "sin número"}).{" "}
              {draft.correctsExisting ? "El formulario indica que la corrige." : "Confirmo que la nueva es una corrección:"} la anterior queda «Reemplazada» y conserva su historial.
            </span>
          </label>
        )}
        {blockers.length > 0 && !draft.duplicate && <span className="field__hint">Para guardar: {blockers.join(" · ")}</span>}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Pagos (totales o parciales)
// ---------------------------------------------------------------------------

const PAYMENT_EXCEEDS = "El pago supera el saldo pendiente de la obligación.";

/**
 * Total a pagar, pagado y pendiente de una declaración con su historial de
 * pagos. Se registran, editan y eliminan aquí; Rust bloquea los cambios que
 * afectan un periodo de Estados Financieros cerrado.
 */
export function PaymentsPanel({ item: r, onChanged }: { item: TaxReturn; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [form, setForm] = useState<{ editing: TaxPayment | null } | null>(null);
  const [removing, setRemoving] = useState<TaxPayment | null>(null);
  const [busy, setBusy] = useState(false);
  const payable = effectiveValues(r).payable;
  const paid = paidCents(r);
  const pending = pendingCents(r);
  const editable = r.supersededBy === null;

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await taxService.deletePayment(removing.id);
      toast("Pago eliminado.");
      setRemoving(null);
      await onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack stack--sm">
      <div className="summary-grid">
        {item("Total saldo a pagar", formatExactCents(payable))}
        {item("Total pagado", formatExactCents(paid))}
        {item("Saldo pendiente", <span className={pending > 0 ? "amount--negative" : undefined}>{formatExactCents(pending)}</span>)}
        {item("Pagos registrados", String(r.payments.length))}
      </div>
      <div className="row row--between" style={{ flexWrap: "wrap" }}>
        <strong>Pagos</strong>
        {editable && (
          <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setForm({ editing: null })} disabled={pending === 0} title={pending === 0 ? "La obligación ya está pagada." : undefined}>
            Registrar pago
          </Button>
        )}
      </div>
      {r.payments.length === 0 ? (
        <p className="muted">Sin pagos registrados: el saldo completo sigue por pagar.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha de pago</th>
                <th style={{ textAlign: "right" }}>Valor pagado</th>
                <th>Referencia / observación</th>
                {editable && <th />}
              </tr>
            </thead>
            <tbody>
              {r.payments.map((p) => (
                <tr key={p.id}>
                  <td className="nowrap">{formatIsoDate(p.paymentDate)}</td>
                  <td className="nowrap" style={{ textAlign: "right" }}>
                    {formatExactCents(p.amountCents)}
                  </td>
                  <td className="selectable">{[p.reference, p.note].filter(Boolean).join(" · ") || <span className="muted">—</span>}</td>
                  {editable && (
                    <td className="actions nowrap">
                      <Button size="sm" variant="ghost" iconOnly icon={<Pencil size={13} />} aria-label="Editar pago" title="Editar pago" onClick={() => setForm({ editing: p })} />
                      <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={13} />} aria-label="Eliminar pago" title="Eliminar pago" onClick={() => setRemoving(p)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PaymentFormModal item={form ? r : null} editing={form?.editing ?? null} onClose={() => setForm(null)} onSaved={onChanged} />
      <ConfirmDialog
        open={removing !== null}
        title="Eliminar pago"
        message={removing ? `Se eliminará el pago del ${formatIsoDate(removing.paymentDate)} por ${formatExactCents(removing.amountCents)}. El saldo pendiente se recalcula y los Estados Financieros preparados que cambien quedan para revisión.` : ""}
        confirmLabel="Eliminar pago"
        danger
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

/** Pagos de una declaración desde la tabla de declaraciones. */
export function PaymentsModal({ item: r, onClose, onChanged }: { item: TaxReturn | null; onClose: () => void; onChanged: () => Promise<void> }) {
  return (
    <Modal open={r !== null} size="lg" title={r ? `Pagos · ${TAX_LABEL[r.taxType]} ${periodName(r)}` : ""} description="Una declaración puede pagarse por partes: a cada fecha de corte solo cuenta el saldo pendiente a esa fecha." onClose={onClose}>
      {r && <PaymentsPanel item={r} onChanged={onChanged} />}
    </Modal>
  );
}

const centsText = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

function PaymentFormModal({ item: r, editing, onClose, onSaved }: { item: TaxReturn | null; editing: TaxPayment | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDate(editing?.paymentDate ?? "");
    setAmount(editing ? centsText(editing.amountCents) : r ? centsText(pendingCents(r)) : "");
    setReference(editing?.reference ?? "");
    setNote(editing?.note ?? "");
    setError(null);
  }, [r, editing]);

  if (!r) return <Modal open={false} title="" onClose={onClose} />;
  // Lo que se puede pagar con este pago: el pendiente (más el valor actual si se edita).
  const available = pendingCents(r) + (editing?.amountCents ?? 0);
  const value = parseNumericText(amount);
  const cents = value === null ? null : Math.round(value * 100);
  const amountError = amount.trim() === "" ? null : cents === null ? "Valor no válido." : cents <= 0 ? "El valor del pago debe ser mayor que cero." : cents > available ? PAYMENT_EXCEEDS : null;
  const unchanged = editing !== null && editing.paymentDate === date && editing.amountCents === cents && editing.reference === reference.trim() && editing.note === note.trim();

  async function save() {
    if (cents === null) return;
    setSaving(true);
    setError(null);
    try {
      const input = { paymentDate: date, amountCents: cents, reference: reference.trim(), note: note.trim() };
      if (editing) await taxService.updatePayment(editing.id, input);
      else await taxService.addPayment(r!.id, input);
      toast(editing ? "Pago actualizado." : "Pago registrado.");
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={editing ? "Editar pago" : "Registrar pago"}
      description="Desde la fecha de pago ese valor deja de ser cuenta por pagar en los Estados Financieros. La fecha de presentación o de firma no es la fecha de pago."
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!isIsoDate(date) || cents === null || amountError !== null || unchanged}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="stack">
        <span>
          Saldo pendiente: <strong>{formatExactCents(pendingCents(r))}</strong>
          {editing && <span className="muted"> (sin contar este pago: {formatExactCents(available)})</span>}
        </span>
        <div className="form-grid">
          <Field label="Fecha de pago" required>
            {(id) => <DateInput id={id} value={date} onChange={setDate} parse={parseTaxPaymentDate} placeholder="DD/MM/AAAA o AAAAMMDD" errorText="Fecha inválida. Usa DD/MM/AAAA o AAAAMMDD (ej. 20260429)." />}
          </Field>
          <Field label="Valor pagado" required error={amountError ?? undefined}>
            {(id) => <Input id={id} className="input--right" inputMode="decimal" value={amount} invalid={amountError !== null} placeholder="5.000.000" onChange={(e) => setAmount(e.target.value)} />}
          </Field>
          <Field label="Referencia / comprobante">{(id) => <Input id={id} value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} />}</Field>
          <Field label="Observación">{(id) => <Input id={id} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------

const EVENT_LABEL: Record<string, string> = { imported: "Importada", correction: "Corrección", superseded: "Reemplazada", payment: "Pago", resolution: "Revisión" };

export function ReturnDetailModal({
  item: r,
  vatPeriodicity,
  onClose,
  onChanged,
  onPeriodicity,
}: {
  item: TaxReturn | null;
  vatPeriodicity: VatPeriodicity | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onPeriodicity: (p: VatPeriodicity) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!r) return <Modal open={false} title="" onClose={onClose} />;
  const d = r.detail ?? {};
  const why = r.supersededBy === null ? anomalies(r, vatPeriodicity) : [];
  const both = r.payableCents > 0 && r.favorCents > 0;
  const values = Object.values(d.values ?? {});
  const eff = effectiveValues(r);

  async function resolve(resolution: "" | "payable" | "favor") {
    setBusy(true);
    try {
      await taxService.setResolution(r!.id, resolution);
      toast("Revisión guardada.");
      await onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open size="xl" title={`${TAX_LABEL[r.taxType]} · ${periodName(r)}`} description={`Formulario ${r.formNumber || "sin número"} · ${r.fileName}`} onClose={onClose} locked={busy}>
      <div className="stack">
        {r.supersededBy !== null && <Alert tone="info">Reemplazada por una corrección: ya no cuenta en los Estados Financieros. Se conserva para la trazabilidad.</Alert>}
        {why.length > 0 && (
          <Alert tone="danger" title="Requiere revisión: no se envía a los Estados Financieros" items={why}>
            <div className="row" style={{ flexWrap: "wrap", marginTop: 8 }}>
              {both && !r.resolution && (
                <>
                  <Button size="sm" onClick={() => void resolve("payable")} disabled={busy}>
                    Vale el saldo a pagar ({formatExactCents(r.payableCents)})
                  </Button>
                  <Button size="sm" onClick={() => void resolve("favor")} disabled={busy}>
                    Vale el saldo a favor ({formatExactCents(r.favorCents)})
                  </Button>
                </>
              )}
              {r.taxType === "vat" && r.periodicity !== "monthly" && r.periodicity !== "annual" && r.periodicity !== vatPeriodicity && (
                <Button size="sm" onClick={() => onPeriodicity(r.periodicity as VatPeriodicity)}>
                  Configurar la empresa como {PERIODICITY_LABEL[r.periodicity].toLowerCase()}
                </Button>
              )}
            </div>
          </Alert>
        )}
        {both && r.resolution && (
          <Alert tone="info">
            Revisada: vale el saldo {r.resolution === "payable" ? "a pagar" : "a favor"}.{" "}
            <Button size="sm" variant="ghost" onClick={() => void resolve("")} disabled={busy}>
              Reabrir revisión
            </Button>
          </Alert>
        )}

        <div className="summary-grid">
          {item("Empresa (según el formulario)", `${r.companyName || "—"} · NIT ${r.nit || "—"}`)}
          {item("Periodo fiscal", `${formatIsoDate(r.periodStart)} a ${formatIsoDate(r.periodEnd)}`)}
          {r.taxType === "vat" && item("Periodicidad", PERIODICITY_LABEL[r.periodicity])}
          {item("Formulario anterior", r.previousFormNumber)}
          {item("Fecha de presentación", d.presentedOn ? formatIsoDate(d.presentedOn) : null)}
          {item("Estado", <StatusBadge status={taxStatus(r, vatPeriodicity)} />)}
          {item("Año", `${r.year}${d.yearSource === "presentation" ? " (deducido de la presentación)" : d.yearSource === "manual" ? " (escrito por el usuario)" : ""}`)}
        </div>

        {r.taxType === "income" ? (
          <div className="fs-grid">
            <div className="stack stack--sm">
              <strong>Resultado fiscal</strong>
              <ValueTable
                rows={[
                  ["Renta líquida ordinaria del ejercicio", r.incomeOrdinaryCents ?? 0],
                  ["Pérdida líquida del ejercicio", r.incomeLossCents ?? 0],
                  ["Resultado histórico (renta − pérdida)", (r.incomeOrdinaryCents ?? 0) - (r.incomeLossCents ?? 0), true],
                ]}
              />
              <strong>Liquidación</strong>
              <ValueTable
                rows={[
                  ["Total saldo a pagar", r.payableCents],
                  ["Total saldo a favor", r.favorCents],
                  [`Anticipo renta para el año gravable siguiente (${r.advanceTargetYear})`, r.advanceNextCents ?? 0],
                ]}
              />
            </div>
            <div className="stack stack--sm">
              <strong>Patrimonio declarado</strong>
              <span className="field__hint">Solo informativo: no se envía al Estado de Situación Financiera ni reemplaza sus valores.</span>
              <table className="table">
                <tbody>
                  {(d.equity ?? []).map((e) => (
                    <tr key={e.key} className={e.key === "grossEquity" || e.key === "netEquity" ? "fs-row--subtotal" : undefined}>
                      <td>{e.label}</td>
                      <td className="mono muted">{e.casilla ?? ""}</td>
                      <td className="nowrap" style={{ textAlign: "right" }}>
                        {e.cents === null ? "—" : formatExactCents(e.cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="summary-grid">
            {item("Saldo a pagar", formatExactCents(r.payableCents))}
            {r.taxType === "vat" && item("Saldo a favor", formatExactCents(r.favorCents))}
            {both && item("Valor que cuenta", `A pagar ${formatExactCents(eff.payable)} · A favor ${formatExactCents(eff.favor)}`)}
          </div>
        )}

        {eff.payable > 0 && <PaymentsPanel item={r} onChanged={onChanged} />}

        {values.length > 0 && (
          <details>
            <summary className="muted">Conceptos leídos del formulario (casillas)</summary>
            <table className="table">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th>Casilla leída</th>
                  <th>Casilla esperada</th>
                  <th style={{ textAlign: "right" }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {values.map((x) => (
                  <tr key={x.label}>
                    <td>
                      {x.label}
                      {x.foundBy === "position" && <div className="table__secondary">Sin etiqueta en el texto: fila siguiente a la renta líquida ordinaria.</div>}
                    </td>
                    <td className="mono">{x.casilla ?? "—"}</td>
                    <td className="mono">{x.expectedCasilla ?? "—"}</td>
                    <td className="nowrap" style={{ textAlign: "right" }}>
                      {formatExactCents(x.cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
        {(d.warnings ?? []).length > 0 && <Alert tone="warning" title="Avisos de la lectura" items={d.warnings} />}

        <div className="stack stack--sm">
          <strong>Historial</strong>
          {r.events.map((e) => (
            <span key={e.id} className="muted">
              {formatDateTimeForDisplay(e.createdAt)} · {EVENT_LABEL[e.action] ?? e.action}
              {e.note ? ` · ${e.note}` : ""}
            </span>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function ValueTable({ rows }: { rows: [string, number, boolean?][] }) {
  return (
    <table className="table">
      <tbody>
        {rows.map(([label, cents, total]) => (
          <tr key={label} className={total ? "fs-row--subtotal" : undefined}>
            <td>{label}</td>
            <td style={{ textAlign: "right" }} className={`nowrap${cents < 0 ? " amount--negative" : ""}`}>
              {formatExactCents(cents)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
