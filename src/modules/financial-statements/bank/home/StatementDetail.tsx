import { History, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { navigate } from "../../../../app/router";
import { Alert, Badge, Button, Field, Input, Modal, Select, useToast } from "../../../../components/ui";
import { fsService } from "../../../../services/fsService";
import { errorMessage } from "../../../../services/tauri";
import type { BankEditLogEntry, BankPendingEdit, Period } from "../../../../types/fs";
import { formatDateForDisplay, formatDateTimeForDisplay } from "../../../../utils/dates";
import { formatInteger } from "../../../../utils/format";
import { maskAccount } from "../../generator/checks";
import { PucField } from "../../shared/components/PucField";
import { formatExactCents } from "../../shared/money";
import type { FsData } from "../../shared/useFsData";
import { leafConcept } from "../../puc-codes/services/pucCatalog";
import type { BankExoInput } from "../exogena/model";
import type { ImportedStatement } from "../imported/model";
import { buildApplySummary, buildConceptRows, CONCEPT_STATE_TEXT, CONCEPT_STATE_TONE, projectedCents, type ConceptRow } from "./model";

const GENERATOR_PATH = "/herramientas/estados-financieros/generador";
const PERIOD_STATUS: Record<Period["status"], string> = { preparing: "En preparación", ready: "Cuadrado", pdf_generated: "PDF generado", needs_review: "Requiere nueva revisión", closed: "Cerrado" };
const destinationText = (d: "send" | "skip") => (d === "send" ? "EEFF" : "No se envía");

interface Props {
  statement: ImportedStatement;
  pending: BankPendingEdit[];
  log: BankEditLogEntry[];
  periods: Period[];
  exoInput: BankExoInput | null;
  data: FsData;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

/**
 * Detalle PERSISTIDO de un extracto ya importado: saldos, estado de envío, intereses (1007), GMF (1011), historial y los
 * conceptos con su clasificación actual. Cada concepto se edita en su fila; el cambio queda como «Actualización pendiente» y solo
 * se aplica a Estados Financieros con «Actualizar Estados Financieros» (sobre este mismo extracto, sin reimportar ni duplicar).
 */
export function StatementDetail({ statement: s, pending, log, periods, exoInput, data, onClose, onChanged }: Props) {
  const toast = useToast();
  const rows = useMemo(() => buildConceptRows(s, pending, log), [s, pending, log]);
  const [tab, setTab] = useState<"concepts" | "history">("concepts");
  const [drafts, setDrafts] = useState<Record<string, true>>({});
  const [txFor, setTxFor] = useState<ConceptRow | null>(null);
  const [confirming, setConfirming] = useState(false);
  const editable = s.status === "active";
  const pendingCount = rows.filter((r) => r.pending).length;

  async function save(row: ConceptRow, next: { destination: "send" | "skip"; pucCode: string; isGmf: boolean }) {
    if (next.destination === "send" && !next.pucCode) {
      setDrafts((d) => ({ ...d, [row.description]: true }));
      return;
    }
    try {
      await fsService.saveBankPendingEdit({ batchId: s.batchId, concept: row.description, destination: next.destination, pucCode: next.pucCode, isGmf: next.isGmf });
      setDrafts((d) => {
        const { [row.description]: _drop, ...rest } = d;
        return rest;
      });
      await onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function discard(row: ConceptRow) {
    try {
      await fsService.discardBankPendingEdits(s.batchId, row.description);
      setDrafts((d) => {
        const { [row.description]: _drop, ...rest } = d;
        return rest;
      });
      await onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <Modal
      open
      size="xl"
      title={`${s.bank} ${maskAccount(s.account)} · ${formatDateForDisplay(s.periodStart)} a ${formatDateForDisplay(s.periodEnd)}`}
      description={s.fileName || undefined}
      onClose={onClose}
      footer={
        <>
          {pendingCount > 0 && <span className="muted">{`${pendingCount} concepto${pendingCount === 1 ? "" : "s"} con cambios sin aplicar`}</span>}
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <Button variant="primary" icon={<RotateCcw size={14} />} disabled={!editable || pendingCount === 0} onClick={() => setConfirming(true)}>
            Actualizar Estados Financieros
          </Button>
        </>
      }
    >
      <div className="stack">
        <dl className="detail-facts">
          <Fact label="Archivo" value={s.fileName || "—"} />
          <Fact label="Importado" value={formatDateTimeForDisplay(s.importedAt)} />
          <Fact label="Periodo" value={`${formatDateForDisplay(s.periodStart)} a ${formatDateForDisplay(s.periodEnd)}`} />
          <Fact label="Estado de envío a EEFF" value={<Badge tone={s.status !== "active" ? "neutral" : s.sentToEeff ? "success" : "warning"}>{s.status === "replaced" ? "Reemplazado" : s.status === "voided" ? "Anulado" : s.sentToEeff ? `Enviado · ${formatExactCents(s.sentCents)}` : "Sin enviar"}</Badge>} />
          <Fact label="Saldo inicial" value={s.openingBalanceCents === null ? "—" : formatExactCents(s.openingBalanceCents)} />
          <Fact label="Saldo final" value={s.closingBalanceCents === null ? "—" : formatExactCents(s.closingBalanceCents)} />
          <Fact label="Intereses identificados (1007)" value={formatExactCents(s.interestCents)} />
          <Fact label="GMF identificado (1011)" value={`${formatExactCents(s.gmfGrossCents)} → ${formatExactCents(Math.round(s.gmfGrossCents / 2))} (50 %)`} />
        </dl>
        {s.legacy && s.status === "active" && (
          <Alert tone="warning" title="Extracto enviado antes de guardar el detalle para Exógena">
            Sus intereses y GMF no se pueden reconstruir desde lo guardado: reimpórtalo con «Reemplazar» solo para eso. Cambiar la cuenta PUC de sus conceptos sí funciona sin reimportar.
          </Alert>
        )}
        {!editable && <Alert tone="info">Este extracto no está vigente: se puede consultar, no editar.</Alert>}
        {s.alerts.map((a) => (
          <Alert key={a.id} tone={a.severity === "block" ? "danger" : "warning"} title={a.title}>
            {a.why}
          </Alert>
        ))}
        <div className="row">
          <Button size="sm" variant={tab === "concepts" ? "primary" : "ghost"} onClick={() => setTab("concepts")}>
            Conceptos
          </Button>
          <Button size="sm" variant={tab === "history" ? "primary" : "ghost"} icon={<History size={13} />} onClick={() => setTab("history")}>
            Historial ({s.history.length + log.filter((e) => e.batchId === s.batchId).length})
          </Button>
        </div>
        {tab === "history" ? (
          <HistoryList statement={s} log={log} />
        ) : (
          <div className="table-wrap table-wrap--scroll" style={{ maxHeight: "46vh" }}>
            <table className="table table--dense concept-table">
              <thead>
                <tr>
                  <th>Concepto · regla u origen</th>
                  <th>Tipo · cant.</th>
                  <th className="num">Total</th>
                  <th>Estado</th>
                  <th>Destino</th>
                  <th>Cuenta PUC</th>
                  <th>GMF / 4x1000</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <ConceptRowView key={r.description} row={r} editable={editable} draft={Boolean(drafts[r.description])} data={data} onSave={(next) => void save(r, next)} onDiscard={() => void discard(r)} onOpen={() => setTxFor(r)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {txFor && (
        <Modal open size="lg" title={txFor.description} description={`${formatInteger(txFor.transactions.length)} movimientos incluidos`} onClose={() => setTxFor(null)}>
          <div className="table-wrap table-wrap--scroll" style={{ maxHeight: "55vh" }}>
            <table className="table table--dense">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Movimiento</th>
                  <th className="num">Valor</th>
                  <th>Exógena</th>
                </tr>
              </thead>
              <tbody>
                {txFor.transactions.map((l) => (
                  <tr key={l.key}>
                    <td>{formatDateForDisplay(l.date)}</td>
                    <td>{l.description}</td>
                    <td className="num">
                      {l.dc === "D" ? "−" : ""}
                      {formatExactCents(l.cents)}
                    </td>
                    <td>
                      {l.interest === "confirmed" && <Badge tone="success">Interés</Badge>}
                      {l.interest === "suggested" && <Badge tone="warning">Posible interés</Badge>}
                      {l.gmf === "confirmed" && <Badge tone="success">GMF</Badge>}
                      {l.gmf === "suggested" && <Badge tone="warning">Posible GMF</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {confirming && <ApplyConfirm statement={s} rows={rows} periods={periods} exoInput={exoInput} onClose={() => setConfirming(false)} onApplied={onChanged} />}
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function HistoryList({ statement: s, log }: { statement: ImportedStatement; log: BankEditLogEntry[] }) {
  const entries = [
    ...s.history.map((h) => ({ at: h.at, text: h.text })),
    ...log
      .filter((e) => e.batchId === s.batchId)
      .map((e) => ({ at: e.createdAt, text: `«${e.concept}»: ${destinationText(e.previous.destination ?? "send")} ${e.previous.pucCode ?? ""}${e.previous.isGmf ? " (GMF)" : ""} → ${destinationText(e.next.destination ?? "send")} ${e.next.pucCode ?? ""}${e.next.isGmf ? " (GMF)" : ""}. Valor ${formatExactCents(e.previous.amountCents ?? 0)} → ${formatExactCents(e.next.amountCents ?? 0)}. Motivo: ${e.reason}` })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <ul className="plain-list">
      {entries.map((h, i) => (
        <li key={i}>
          <strong>{formatDateTimeForDisplay(h.at)}</strong> · {h.text}
        </li>
      ))}
    </ul>
  );
}

interface RowProps {
  row: ConceptRow;
  editable: boolean;
  draft: boolean;
  data: FsData;
  onSave: (next: { destination: "send" | "skip"; pucCode: string; isGmf: boolean }) => void;
  onDiscard: () => void;
  onOpen: () => void;
}

const LEGACY_TEXT = "Este extracto se envió antes de guardar su detalle: reimpórtalo con «Reemplazar» para cambiar su destino o el GMF.";

function ConceptRowView({ row: r, editable, draft, data, onSave, onDiscard, onOpen }: RowProps) {
  const toast = useToast();
  const eff = r.effective;
  const destination = draft ? "send" : eff.destination;
  const needsDetail = (to: "send" | "skip", gmf: boolean) => !r.hasDetail && ((r.current.destination === "skip" && to === "send") || (to === "send" && r.current.destination === "send" && gmf !== r.current.isGmf));
  const total = r.inflowCents > 0 && r.outflowCents > 0 ? `${formatExactCents(r.outflowCents)} / ${formatExactCents(r.inflowCents)}` : formatExactCents(r.outflowCents + r.inflowCents);
  return (
    <tr className={r.pending ? "concept-row--pending" : undefined}>
      <td>
        <strong>{r.description}</strong>
        <div className="muted">{r.ruleText}</div>
        <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          <Button size="sm" variant="ghost" onClick={onOpen}>
            Ver movimientos
          </Button>
          {(r.pending || draft) && editable && (
            <Button size="sm" variant="ghost" onClick={onDiscard}>
              Descartar cambio
            </Button>
          )}
        </span>
      </td>
      <td>
        {r.type}
        <div className="muted">{`${formatInteger(r.count)} mov.`}</div>
      </td>
      <td className="num">{total}</td>
      <td>
        <Badge tone={CONCEPT_STATE_TONE[r.state]}>{CONCEPT_STATE_TEXT[r.state]}</Badge>
        {r.pending && (
          <div className="concept-change">
            {`Antes: ${destinationText(r.pending.previous.destination ?? r.current.destination)} ${r.pending.previous.pucCode ?? ""}${r.pending.previous.isGmf ? " · GMF" : ""} (${formatExactCents(r.pending.previous.amountCents ?? 0)})`}
            <br />
            {`Nuevo: ${destinationText(r.pending.destination)} ${r.pending.pucCode}${r.pending.isGmf ? " · GMF" : ""} (${formatExactCents(projectedCents(r, r.effective))})`}
          </div>
        )}
      </td>
      <td>
        {editable ? (
          <Select
            className="concept-select"
            aria-label={`Destino de ${r.description}`}
            value={destination}
            onChange={(e) => {
              const to = e.target.value as "send" | "skip";
              if (needsDetail(to, eff.isGmf)) return toast(LEGACY_TEXT, "error");
              onSave({ destination: to, pucCode: eff.pucCode, isGmf: to === "send" && eff.isGmf });
            }}
          >
            <option value="send">Enviar a EEFF</option>
            <option value="skip">No enviar</option>
          </Select>
        ) : (
          destinationText(eff.destination)
        )}
      </td>
      <td>
        {destination === "send" ? (
          <PucField
            index={data.index}
            value={eff.pucCode || undefined}
            onChange={(code) => code && onSave({ destination: "send", pucCode: code, isGmf: eff.isGmf })}
            placeholder="Elegir PUC"
            compact
            disabled={!editable}
            mappings={data.mappingMap}
            onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])}
          />
        ) : (
          <span className="muted">—</span>
        )}
        {r.mixedPuc && <div className="muted">Varias cuentas PUC vigentes</div>}
        {eff.pucCode && <div className="muted">{leafConcept(data.index, eff.pucCode) ?? ""}</div>}
      </td>
      <td>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={eff.isGmf && destination === "send"}
            disabled={!editable || destination !== "send" || !eff.pucCode}
            onChange={(e) => {
              if (needsDetail("send", e.target.checked)) return toast(LEGACY_TEXT, "error");
              onSave({ destination: "send", pucCode: eff.pucCode, isGmf: e.target.checked });
            }}
          />
          <span>{eff.isGmf && destination === "send" ? "GMF · 50 % del neto" : r.current.isGmf ? "Sin GMF (pendiente)" : r.gmfLabel}</span>
        </label>
      </td>
    </tr>
  );
}

function ApplyConfirm({ statement: s, rows, periods, exoInput, onClose, onApplied }: { statement: ImportedStatement; rows: ConceptRow[]; periods: Period[]; exoInput: BankExoInput | null; onClose: () => void; onApplied: () => Promise<void> }) {
  const toast = useToast();
  const summary = useMemo(() => buildApplySummary(s, rows, periods, exoInput), [s, rows, periods, exoInput]);
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const blocked = summary.closed.length > 0 || (summary.approved.length > 0 && !ack) || reason.trim() === "";

  async function apply() {
    setSaving(true);
    try {
      const out = await fsService.applyBankPendingEdits({ batchId: s.batchId, reason: reason.trim(), acknowledgeApproved: ack });
      toast(`${formatInteger(out.concepts)} concepto${out.concepts === 1 ? "" : "s"} actualizados en Estados Financieros.${out.invalidatedPeriods > 0 ? " El periodo quedó en «Requiere nueva revisión»." : ""}`);
      onClose();
      await onApplied();
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
      title="Actualizar Estados Financieros"
      description="Se aplica una sola vez sobre este extracto ya guardado: no se crea otro lote ni se duplican valores."
      locked={saving}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} disabled={blocked} onClick={() => void apply()}>
            Confirmar y actualizar
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="table-wrap">
          <table className="table table--dense">
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Destino y PUC anterior</th>
                <th>Destino y PUC nuevo</th>
                <th className="num">Valor anterior</th>
                <th className="num">Valor nuevo</th>
              </tr>
            </thead>
            <tbody>
              {summary.changes.map((c) => (
                <tr key={c.concept}>
                  <td>{c.concept}</td>
                  <td>
                    {destinationText(c.before.destination)} {c.before.pucCode}
                    {c.before.isGmf ? " · GMF" : ""}
                  </td>
                  <td>
                    {destinationText(c.after.destination)} {c.after.pucCode}
                    {c.after.isGmf ? " · GMF" : ""}
                  </td>
                  <td className="num">{formatExactCents(c.before.cents)}</td>
                  <td className="num">{formatExactCents(c.after.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Afecta {formatInteger(summary.changes.length)} concepto{summary.changes.length === 1 ? "" : "s"}: {formatExactCents(summary.beforeCents)} → {formatExactCents(summary.afterCents)}.
        </p>
        {summary.gmfRuleChanges.length > 0 && (
          <Alert tone="info" title="Regla del GMF">
            Marcar o quitar el GMF actualiza la regla de {s.bank} para {summary.gmfRuleChanges.map((g) => `«${g.concept}»`).join(", ")}: vale para todos los extractos de este banco con ese concepto (el 1011 los recalcula desde lo guardado).
          </Alert>
        )}
        <div>
          <strong>Impacto en Exógena</strong>
          <ul className="plain-list">
            {summary.impact.length === 0 && <li className="muted">Sin datos para calcular el impacto.</li>}
            {summary.impact.map((i) => (
              <li key={i.format}>{i.changed ? `Formato ${i.format}: ${i.before} → ${i.after}` : `Formato ${i.format}: sin cambios`}</li>
            ))}
          </ul>
        </div>
        {summary.periods.length === 0 ? (
          <Alert tone="info">Ningún periodo de Estados Financieros de esta empresa contiene aún la fecha de este extracto ({formatDateForDisplay(s.periodEnd)}).</Alert>
        ) : (
          <Alert tone={summary.closed.length > 0 ? "danger" : summary.approved.length > 0 ? "warning" : "info"} title="Periodo de EEFF afectado">
            {summary.periods.map((p) => (
              <div key={p.id}>
                {formatDateForDisplay(p.startDate)} a {formatDateForDisplay(p.endDate)} · {p.presentation === "bank" ? "Bancos" : "OTC"} · <strong>{PERIOD_STATUS[p.status]}</strong>
              </div>
            ))}
            {summary.closed.length > 0 && (
              <div style={{ marginTop: 8 }}>
                El periodo está cerrado: no se cambian cifras en silencio. Desbloquéalo desde el Generador (la versión cerrada se conserva) y vuelve aquí.
                <div style={{ marginTop: 6 }}>
                  <Button size="sm" onClick={() => navigate(GENERATOR_PATH)}>
                    Ir al Generador para desbloquear
                  </Button>
                </div>
              </div>
            )}
            {summary.closed.length === 0 && summary.approved.length > 0 && (
              <label className="row" style={{ gap: 6, marginTop: 8 }}>
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                Entiendo que el periodo está cuadrado o con PDF generado: pasará a «Requiere nueva revisión» y los valores y PDF anteriores se conservan como referencia.
              </label>
            )}
          </Alert>
        )}
        <Field label="Motivo del cambio" required>
          {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Por qué se corrige la clasificación" />}
        </Field>
        <p className="muted">Se guarda con auditoría: fecha, clasificación y valor anterior y nuevo, motivo y este extracto como origen. Cobertura, saldos, alertas y los formatos 1012, 1007 y 1011 se recalculan desde lo guardado.</p>
      </div>
    </Modal>
  );
}
