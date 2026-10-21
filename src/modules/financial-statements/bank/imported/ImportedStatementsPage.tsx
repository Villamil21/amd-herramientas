import { FileSearch, FilterX, History, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { navigate } from "../../../../app/router";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Loader, Modal, PageHeader, Select, useToast } from "../../../../components/ui";
import { useDebounced } from "../../../../hooks/useDebounced";
import { fsService } from "../../../../services/fsService";
import { errorMessage } from "../../../../services/tauri";
import type { BankConceptMapping, BatchSummary, GmfRule, InterestRule, Movement, MovementEdit, Period } from "../../../../types/fs";
import { formatDateForDisplay, formatDateTimeForDisplay } from "../../../../utils/dates";
import { formatInteger } from "../../../../utils/format";
import { ExogenaContextBar } from "../../../exogena/components/ExogenaContextBar";
import { useCompanies } from "../../../exogena/hooks";
import { useExogenaSelection } from "../../../exogena/state";
import { maskAccount } from "../../generator/checks";
import { PucField } from "../../shared/components/PucField";
import { formatExactCents, periodLabel } from "../../shared/money";
import { useFsData } from "../../shared/useFsData";
import { leafConcept } from "../../puc-codes/services/pucCatalog";
import { reopenReadyBankFormats, useBankExo } from "../exogena/load";
import { BANKS_PATH } from "../exogena/paths";
import {
  buildImportedStatements,
  EMPTY_IMPORTED_FILTERS,
  filterStatements,
  previewReclassification,
  reclassInput,
  STATUS_FILTER_LABEL,
  type ImportedFilters,
  type ImportedStatement,
  type StatementStatusFilter,
  type TxLine,
} from "./model";

const GENERATOR_PATH = "/herramientas/estados-financieros/generador";
const DEST_TEXT = { eeff: "Enviada a EEFF", gmf: "GMF (50 % del neto)", "not-sent": "No enviada" } as const;
const PERIOD_STATUS: Record<Period["status"], string> = { preparing: "En preparación", ready: "Cuadrado", pdf_generated: "PDF generado", needs_review: "Requiere nueva revisión", closed: "Cerrado" };

interface Stored {
  batches: BatchSummary[];
  movements: Movement[];
  edits: MovementEdit[];
  mappings: BankConceptMapping[];
  gmfRules: GmfRule[];
  interestRules: InterestRule[];
  periods: Period[];
}

/**
 * Estados Financieros → Extractos bancarios → Extractos importados: consulta de todo lo ya subido, con su detalle persistido y
 * reclasificación de transacciones ya enviadas a EEFF, sin reimportar el PDF, sin crear otro lote y con auditoría.
 */
export default function ImportedStatementsPage() {
  const toast = useToast();
  const [selection] = useExogenaSelection();
  const { companies } = useCompanies();
  const data = useFsData();
  const companyId = selection.companyId;
  const year = selection.year;
  const bank = useBankExo(companyId, year);
  const [stored, setStored] = useState<Stored | null>(null);
  const [filters, setFilters] = useState<ImportedFilters>(EMPTY_IMPORTED_FILTERS);
  const text = useDebounced(filters.text, 150);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (companyId === null) return setStored(null);
    try {
      const [batches, movements, edits, mappings, gmfRules, interestRules, periods] = await Promise.all([
        fsService.batches(companyId),
        fsService.movements(companyId),
        fsService.movementEdits(companyId),
        fsService.bankConceptMappings(),
        fsService.gmfRules(),
        fsService.interestRules(),
        fsService.periods(companyId),
      ]);
      setStored({ batches, movements, edits, mappings, gmfRules, interestRules, periods });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [companyId, toast]);
  useEffect(() => {
    setStored(null);
    void load();
  }, [load]);

  const statements = useMemo(() => {
    if (!stored || companyId === null) return null;
    const alerts = bank.contribution?.result.alerts ?? [];
    return buildImportedStatements({ companyId, ...stored, alerts }).filter((s) => s.periodEnd.slice(0, 4) === String(year));
  }, [stored, bank.contribution, companyId, year]);

  const banks = useMemo(() => [...new Set((statements ?? []).map((s) => s.bank))].sort((a, b) => a.localeCompare(b, "es")), [statements]);
  const accounts = useMemo(() => [...new Set((statements ?? []).filter((s) => !filters.bank || s.bank === filters.bank).map((s) => s.account))].sort(), [statements, filters.bank]);
  const shown = useMemo(() => filterStatements(statements ?? [], { ...filters, text }), [statements, filters, text]);
  const open = statements?.find((s) => s.batchId === openId) ?? null;
  const set = (k: keyof ImportedFilters) => (e: { target: { value: string } }) => setFilters((f) => ({ ...f, [k]: e.target.value, ...(k === "bank" ? { account: "" } : {}) }));
  const active = Object.entries(filters).some(([, v]) => v !== "");

  /** Tras reclasificar: se vuelve a leer todo (cobertura, saldos, alertas) y un formato de Exógena «Listo» que quede desactualizado se reabre. */
  const changed = useCallback(async () => {
    await Promise.all([load(), bank.reload()]);
    if (companyId !== null) void reopenReadyBankFormats(companyId, [year]).catch(() => undefined);
  }, [load, bank, companyId, year]);

  return (
    <>
      <PageHeader
        eyebrow="Estados Financieros · Extractos bancarios"
        title="Extractos importados"
        description="Consulta lo que ya se subió, abre su detalle guardado y reclasifica transacciones ya enviadas a Estados Financieros sin volver a cargar el PDF."
        actions={<Button onClick={() => navigate(BANKS_PATH)}>Importar un extracto</Button>}
      />
      <ExogenaContextBar companies={companies} />
      {companyId === null ? (
        <Card>
          <EmptyState icon={<FileSearch size={20} />} title="Selecciona una empresa" description="Elige la empresa y el año para ver los extractos que ya importaste." />
        </Card>
      ) : !statements ? (
        <Loader />
      ) : (
        <>
          <Card title="Filtros" description={`Año ${year} (el de la barra superior). ${formatInteger(shown.length)} de ${formatInteger(statements.length)} extractos.`}>
            <div className="form-grid">
              <Field label="Banco">
                {(id) => (
                  <Select id={id} value={filters.bank} onChange={set("bank")}>
                    <option value="">Todos</option>
                    {banks.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Cuenta">
                {(id) => (
                  <Select id={id} value={filters.account} onChange={set("account")}>
                    <option value="">Todas</option>
                    {accounts.map((a) => (
                      <option key={a} value={a}>
                        {maskAccount(a)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Mes">
                {(id) => (
                  <Select id={id} value={filters.month} onChange={set("month")}>
                    <option value="">Todo el año</option>
                    {Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).map((m) => (
                      <option key={m} value={m}>
                        {periodLabel(m)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Estado">
                {(id) => (
                  <Select id={id} value={filters.status} onChange={set("status")}>
                    <option value="">Todos</option>
                    {(Object.keys(STATUS_FILTER_LABEL) as Exclude<StatementStatusFilter, "">[]).map((k) => (
                      <option key={k} value={k}>
                        {STATUS_FILTER_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Texto, movimiento o concepto">{(id) => <Input id={id} value={filters.text} onChange={set("text")} placeholder="Ej. intereses, GMF, nombre del archivo" />}</Field>
            </div>
            {active && (
              <Button size="sm" variant="ghost" icon={<FilterX size={13} />} onClick={() => setFilters(EMPTY_IMPORTED_FILTERS)}>
                Quitar filtros
              </Button>
            )}
          </Card>
          <Card flush title={`${formatInteger(shown.length)} extractos`}>
            {shown.length === 0 ? (
              <EmptyState icon={<FileSearch size={20} />} title="Sin extractos" description={statements.length === 0 ? `Esta empresa no tiene extractos con periodo en ${year}.` : "Ningún extracto cumple estos filtros."} />
            ) : (
              <div className="table-wrap table-wrap--scroll" style={{ maxHeight: "62vh" }}>
                <table className="table table--dense">
                  <thead>
                    <tr>
                      <th>Banco · cuenta</th>
                      <th>Periodo</th>
                      <th>Archivo · importado</th>
                      <th className="num">Saldo final</th>
                      <th className="num">Intereses</th>
                      <th className="num">GMF 50 %</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((s) => (
                      <tr key={s.batchId} className="is-clickable" onClick={() => setOpenId(s.batchId)}>
                        <td>
                          <strong>{s.bank}</strong> {maskAccount(s.account)}
                        </td>
                        <td>
                          {formatDateForDisplay(s.periodStart)} a {formatDateForDisplay(s.periodEnd)}
                        </td>
                        <td>
                          {s.fileName || "—"}
                          <div className="muted">{formatDateTimeForDisplay(s.importedAt)}</div>
                        </td>
                        <td className="num">{s.closingBalanceCents === null ? "—" : formatExactCents(s.closingBalanceCents)}</td>
                        <td className="num">{formatExactCents(s.interestCents)}</td>
                        <td className="num">{formatExactCents(s.gmfReportedCents)}</td>
                        <td>
                          <StatusBadges s={s} />
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
      {open && stored && (
        <StatementDetail
          statement={open}
          periods={stored.periods}
          data={data}
          onClose={() => setOpenId(null)}
          onChanged={changed}
        />
      )}
    </>
  );
}

function StatusBadges({ s }: { s: ImportedStatement }) {
  return (
    <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
      <Badge tone={s.status === "active" ? "success" : s.status === "replaced" ? "neutral" : "danger"}>{s.status === "active" ? "Vigente" : s.status === "replaced" ? "Reemplazado" : "Anulado"}</Badge>
      {s.status === "active" && <Badge tone={s.sentToEeff ? "info" : "warning"}>{s.sentToEeff ? "Enviado a EEFF" : "Pendiente"}</Badge>}
      {s.legacy && s.status === "active" && <Badge tone="warning">Reimportar para Exógena</Badge>}
      {s.alerts.length > 0 && <Badge tone="danger">{`${s.alerts.length} alerta${s.alerts.length === 1 ? "" : "s"}`}</Badge>}
    </span>
  );
}

function StatementDetail({ statement: s, periods, data, onClose, onChanged }: { statement: ImportedStatement; periods: Period[]; data: ReturnType<typeof useFsData>; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [tab, setTab] = useState<"movs" | "history">("movs");
  const [needle, setNeedle] = useState("");
  const [onlySent, setOnlySent] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [toPuc, setToPuc] = useState<string | undefined>();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [ack, setAck] = useState(false);
  const [saving, setSaving] = useState(false);

  // Tras guardar, el extracto se recalcula con lo nuevo: la selección anterior ya no vale.
  useEffect(() => setPicked(new Set()), [s.sentMovements]);

  const lines = useMemo(() => {
    const n = needle.trim().toLowerCase();
    return s.lines.filter((l) => (!onlySent || l.sent) && (!n || [l.description, l.concept, l.pucCode ?? "", l.pucConcept, l.date].some((v) => v.toLowerCase().includes(n))));
  }, [s.lines, needle, onlySent]);
  const toConcept = (toPuc && leafConcept(data.index, toPuc)) || "";
  const preview = useMemo(() => previewReclassification(s, picked, toPuc, toConcept, periods), [s, picked, toPuc, toConcept, periods]);
  const editable = s.status === "active";
  const selectable = lines.filter((l) => l.sent);
  const toggle = (k: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  async function apply() {
    if (!toPuc) return;
    setSaving(true);
    try {
      const out = await fsService.reclassifyBankTransactions(reclassInput(s, preview, toPuc, reason, ack));
      toast(`${formatInteger(out.transactions)} transacciones (${formatExactCents(out.movedCents)}) reclasificadas a ${toPuc}.${out.invalidatedPeriods > 0 ? " El periodo de EEFF quedó en «Requiere nueva revisión»." : ""}`);
      setConfirming(false);
      setAck(false);
      setReason("");
      setToPuc(undefined);
      await onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }
  const canReview = editable && picked.size > 0 && Boolean(toPuc) && reason.trim() !== "" && preview.errors.length === 0 && preview.groups.length > 0;

  return (
    <Modal open title={`${s.bank} ${maskAccount(s.account)} · ${formatDateForDisplay(s.periodStart)} a ${formatDateForDisplay(s.periodEnd)}`} description={s.fileName || undefined} size="xl" onClose={onClose} locked={saving}>
      <div className="stack">
        <dl className="kv-grid">
          <Fact label="Importado" value={formatDateTimeForDisplay(s.importedAt)} />
          <Fact label="Estado" value={<StatusBadges s={s} />} />
          <Fact label="Saldo inicial" value={s.openingBalanceCents === null ? "—" : formatExactCents(s.openingBalanceCents)} />
          <Fact label="Saldo final" value={s.closingBalanceCents === null ? "—" : formatExactCents(s.closingBalanceCents)} />
          <Fact label="Movimientos leídos" value={formatInteger(s.movementCount)} />
          <Fact label="Enviado a EEFF" value={s.sentToEeff ? formatExactCents(s.sentCents) : "No"} />
          <Fact label="Intereses (1007)" value={formatExactCents(s.interestCents)} />
          <Fact label="GMF del extracto → 50 % (1011)" value={`${formatExactCents(s.gmfGrossCents)} → ${formatExactCents(s.gmfReportedCents)}`} />
        </dl>
        {s.legacy && s.status === "active" && (
          <Alert tone="warning" title="Extracto enviado antes de guardar el detalle para Exógena">
            Sus intereses y GMF no se pueden calcular desde lo guardado: reimpórtalo con «Reemplazar». La reclasificación de lo ya enviado a EEFF sí funciona.
          </Alert>
        )}
        {s.alerts.map((a) => (
          <Alert key={a.id} tone={a.severity === "block" ? "danger" : "warning"} title={a.title}>
            {a.why}
          </Alert>
        ))}
        <div className="row">
          <Button size="sm" variant={tab === "movs" ? "primary" : "ghost"} onClick={() => setTab("movs")}>
            Movimientos
          </Button>
          <Button size="sm" variant={tab === "history" ? "primary" : "ghost"} icon={<History size={13} />} onClick={() => setTab("history")}>
            Historial ({s.history.length})
          </Button>
        </div>
        {tab === "history" ? (
          <ul className="plain-list">
            {s.history.map((h, i) => (
              <li key={i}>
                <strong>{formatDateTimeForDisplay(h.at)}</strong> · {h.text}
              </li>
            ))}
          </ul>
        ) : (
          <>
            <div className="row">
              <Input value={needle} onChange={(e) => setNeedle(e.target.value)} placeholder="Buscar movimiento, concepto o PUC" aria-label="Buscar en los movimientos" />
              <label className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={onlySent} onChange={(e) => setOnlySent(e.target.checked)} /> Solo enviados a EEFF
              </label>
            </div>
            {!editable && <Alert tone="info">Este extracto no está vigente: se puede consultar, no reclasificar.</Alert>}
            {editable && picked.size > 0 && (
              <Alert tone="info" title={`Reclasificar ${formatInteger(picked.size)} transacciones (${formatExactCents(preview.cents)})`}>
                Solo cambia el PUC de lo seleccionado en este mismo extracto: no crea otro lote ni toca otros movimientos ni otras cuentas.
                <div className="row" style={{ marginTop: 8 }}>
                  <PucField index={data.index} value={toPuc} onChange={setToPuc} placeholder="Elegir PUC nuevo" mappings={data.mappingMap} onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])} />
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (obligatorio)" aria-label="Motivo de la reclasificación" />
                  <Button variant="primary" icon={<RefreshCcw size={14} />} disabled={!canReview} onClick={() => setConfirming(true)}>
                    Revisar cambio
                  </Button>
                  <Button variant="ghost" onClick={() => setPicked(new Set())}>
                    Quitar selección
                  </Button>
                </div>
                {preview.errors.map((m) => (
                  <div key={m} className="amount--negative">
                    {m}
                  </div>
                ))}
              </Alert>
            )}
            <div className="table-wrap table-wrap--scroll" style={{ maxHeight: "42vh" }}>
              <table className="table table--dense">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>
                      {editable && (
                        <input type="checkbox" aria-label="Seleccionar todos" checked={selectable.length > 0 && selectable.every((l) => picked.has(l.key))} onChange={(e) => setPicked(e.target.checked ? new Set(selectable.map((l) => l.key)) : new Set())} />
                      )}
                    </th>
                    <th>Fecha</th>
                    <th>Movimiento · concepto</th>
                    <th className="num">Valor</th>
                    <th>PUC · destino</th>
                    <th>Regla aplicada</th>
                    <th>Exógena</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <LineRow key={l.key} l={l} editable={editable} checked={picked.has(l.key)} onToggle={() => toggle(l.key)} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <Modal
        open={confirming}
        size="lg"
        title="Confirmar reclasificación"
        description="Revisa el cambio antes de guardarlo. Se aplica una sola vez sobre el extracto ya guardado."
        locked={saving}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="ghost" disabled={saving} onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button variant="primary" loading={saving} disabled={preview.closed.length > 0 || (preview.approved.length > 0 && !ack)} onClick={() => void apply()}>
              Confirmar y reclasificar
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
                  <th>Clasificación anterior</th>
                  <th>Nueva clasificación</th>
                  <th className="num">Transacciones</th>
                  <th className="num">Valor</th>
                  <th>Fecha contable</th>
                </tr>
              </thead>
              <tbody>
                {preview.groups.map((g) => (
                  <tr key={g.movementId}>
                    <td>{g.concept}</td>
                    <td>
                      {g.fromPuc} — {g.fromConcept}
                    </td>
                    <td>
                      {g.toPuc} — {g.toConcept}
                    </td>
                    <td className="num">
                      {g.txCount} de {g.txTotal}
                    </td>
                    <td className="num">
                      {formatExactCents(g.cents)}
                      {g.restCents > 0 && <div className="muted">Resto {formatExactCents(g.restCents)} sigue en {g.fromPuc}</div>}
                    </td>
                    <td>{formatDateForDisplay(g.accountingDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Total afectado: <strong>{formatExactCents(preview.cents)}</strong> en {formatInteger(preview.txCount)} transacciones y {formatInteger(preview.groups.length)} movimientos de EEFF. Motivo: {reason.trim()}
          </p>
          {preview.periods.length === 0 ? (
            <Alert tone="info">Ningún periodo de Estados Financieros de esta empresa contiene esta fecha todavía.</Alert>
          ) : (
            <Alert tone={preview.closed.length > 0 ? "danger" : preview.approved.length > 0 ? "warning" : "info"} title="Periodo de EEFF afectado">
              {preview.periods.map((p) => (
                <div key={p.id}>
                  {formatDateForDisplay(p.startDate)} a {formatDateForDisplay(p.endDate)} · {p.presentation === "bank" ? "Bancos" : "OTC"} · <strong>{PERIOD_STATUS[p.status]}</strong>
                </div>
              ))}
              {preview.closed.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  El periodo está cerrado: no se cambian cifras en silencio. Desbloquéalo desde el Generador (la versión cerrada se conserva) y vuelve aquí.
                  <div style={{ marginTop: 6 }}>
                    <Button size="sm" onClick={() => navigate(GENERATOR_PATH)}>
                      Ir al Generador para desbloquear
                    </Button>
                  </div>
                </div>
              )}
              {preview.closed.length === 0 && preview.approved.length > 0 && (
                <label className="row" style={{ gap: 6, marginTop: 8 }}>
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  Entiendo que el periodo pasará a «Requiere nueva revisión» y que los PDF ya generados se conservan como versiones anteriores.
                </label>
              )}
            </Alert>
          )}
          <p className="muted">Se guarda con auditoría: fecha, valor anterior, valor nuevo, motivo y este extracto como origen. Intereses (1007), GMF (1011) y saldo (1012) se recalculan desde el extracto guardado.</p>
        </div>
      </Modal>
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

function LineRow({ l, editable, checked, onToggle }: { l: TxLine; editable: boolean; checked: boolean; onToggle: () => void }) {
  return (
    <tr>
      <td>{editable && l.sent && <input type="checkbox" aria-label={`Seleccionar ${l.description}`} checked={checked} onChange={onToggle} />}</td>
      <td>{formatDateForDisplay(l.date)}</td>
      <td>
        {l.description}
        {l.concept !== l.description && <div className="muted">{l.concept}</div>}
      </td>
      <td className="num">
        {l.dc === "D" ? "−" : ""}
        {formatExactCents(l.cents)}
      </td>
      <td>
        {l.pucCode ? (
          <>
            <strong>{l.pucCode}</strong> {l.pucConcept}
            <div className="muted">{DEST_TEXT[l.destination]}</div>
          </>
        ) : (
          <Badge tone="warning">{DEST_TEXT[l.destination]}</Badge>
        )}
      </td>
      <td>
        {l.reclassifiedFrom && <Badge tone="info">{`Reclasificada desde ${l.reclassifiedFrom}`}</Badge>}
        {l.rule.kind === "follows" && "Regla banco + concepto"}
        {l.rule.kind === "differs" && <span title={`La regla guardada para este concepto es ${l.rule.pucCode}`}>Distinta de la regla ({l.rule.pucCode})</span>}
        {l.rule.kind === "none" && !l.reclassifiedFrom && <span className="muted">Sin regla guardada</span>}
      </td>
      <td>
        {l.interest === "confirmed" && <Badge tone="success">Interés</Badge>}
        {l.interest === "suggested" && <Badge tone="warning">Posible interés</Badge>}
        {l.gmf === "confirmed" && <Badge tone="success">GMF</Badge>}
        {l.gmf === "suggested" && <Badge tone="warning">Posible GMF</Badge>}
      </td>
    </tr>
  );
}
