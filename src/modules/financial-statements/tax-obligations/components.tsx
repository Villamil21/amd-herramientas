import { useEffect, useState } from "react";
import { Alert, Badge, Button, Field, Input, Modal, useToast } from "../../../components/ui";
import { errorMessage } from "../../../services/tauri";
import { formatExactCents, formatIsoDate, isIsoDate } from "../shared/money";
import { TAX_FORM_LABEL } from "./parser/taxReturnParser";
import { anomalies, effectiveValues, periodName, STATUS_LABEL, type TaxStatus } from "./services/effects";
import { draftBlockers, draftInput, withExisting, type ImportDraft } from "./services/importDraft";
import { taxService } from "./services/taxService";
import { PERIODICITY_LABEL, TAX_LABEL, type TaxReturn, type VatPeriodicity } from "./types";

const STATUS_TONE: Record<TaxStatus, "success" | "warning" | "danger" | "gold" | undefined> = {
  pending: "warning",
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
// Fecha de pago
// ---------------------------------------------------------------------------

export function PaymentModal({ item: r, onClose, onSaved }: { item: TaxReturn | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDate(r?.paymentDate ?? "");
    setError(null);
  }, [r]);

  async function save(value: string | null) {
    if (!r) return;
    setSaving(true);
    setError(null);
    try {
      await taxService.setPayment(r.id, value);
      toast(value ? "Fecha de pago registrada." : "Fecha de pago quitada.");
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
      open={r !== null}
      title={r ? `Fecha de pago · ${TAX_LABEL[r.taxType]} ${periodName(r)}` : ""}
      description="Desde esta fecha la obligación deja de ser cuenta por pagar en los Estados Financieros. La fecha de presentación o de firma no es la fecha de pago."
      onClose={onClose}
      locked={saving}
      footer={
        <>
          {r?.paymentDate && (
            <Button variant="ghost" onClick={() => void save(null)} disabled={saving}>
              Quitar fecha de pago
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save(date)} loading={saving} disabled={!isIsoDate(date) || date === r?.paymentDate}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="stack">
        {r && <span>Saldo a pagar: {formatExactCents(r.payableCents)}</span>}
        <Field label="Fecha de pago" required>
          {(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
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
          {item("Fecha de pago", r.paymentDate ? formatIsoDate(r.paymentDate) : r.payableCents > 0 ? "Sin registrar (sigue por pagar)" : null)}
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
                      <td style={{ textAlign: "right" }}>{e.cents === null ? "—" : formatExactCents(e.cents)}</td>
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
                    <td style={{ textAlign: "right" }}>{formatExactCents(x.cents)}</td>
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
              {e.createdAt.replace("T", " ").slice(0, 16)} · {EVENT_LABEL[e.action] ?? e.action}
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
