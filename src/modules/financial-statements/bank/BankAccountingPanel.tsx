import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Send, XCircle } from "lucide-react";
import { Alert, Badge, Button, Card, ContextBar, MetricBar, Select, useToast } from "../../../components/ui";
import { normalizeKey } from "../../../utils/text";
import { SearchBox, SegmentedFilter } from "../../bank-analysis/shared/components/tableControls";
import { lifecycleText } from "./BankLifecycleModal";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import type { BankAccount, BankAccountLifecycle, BankConceptMapping, BatchSummary, GmfRule } from "../../../types/fs";
import { formatInteger } from "../../../utils/format";
import { maskAccount } from "../generator/checks";
import { CompanySelect } from "../shared/components/CompanySelect";
import { PucField } from "../shared/components/PucField";
import { SendToFs } from "../shared/components/SendToFs";
import { formatExactCents, formatIsoDate, periodLabel } from "../shared/money";
import { useFsData } from "../shared/useFsData";
import {
  buildBankBatch,
  conceptMappingKey,
  fromSignedGroups,
  fromTypedGroups,
  GMF_PERCENT,
  gmfAccountingCents,
  gmfRuleKey,
  gmfState,
  hasEarlierStatement,
  lifecycleQuestions,
  pendingConcepts,
  type AccountingStatement,
  type ConceptDecision,
  type Destination,
  type GmfState,
  type LifecycleQuestion,
} from "./bankAccounting";

/** Etiquetas originales del banco para cada naturaleza (Positivo / Negativo, Crédito / Débito, Abono / Cargo). */
export interface BankTypeLabels {
  C: string;
  D: string;
}

interface Props {
  statement: AccountingStatement;
  fileName: string;
  onExport: () => Promise<string | null | void>;
  exporting?: boolean;
  /** Dato original de cada banco para la columna Tipo. */
  typeLabels: BankTypeLabels;
  /** Resultado de la validación del extracto y su detalle propio del banco (se muestra compacto). */
  validated: boolean;
  validation: ReactNode;
  /** Acciones del archivo (Seleccionar otro PDF, Ver Excel en Finder) para la cabecera. */
  fileActions?: ReactNode;
  /** Datos adicionales del extracto (p. ej. titular en BBVA). */
  fileDetail?: ReactNode;
  /** Detalle individual del banco (sus movimientos con sus columnas originales) al abrir una fila. */
  renderDetail?: (key: string, onClose: () => void) => ReactNode;
}

type ConceptFilter = "all" | "pending" | "classified" | "C" | "D" | "gmf";

const QUESTION: Record<LifecycleQuestion["kind"], { title: string; yes: string; no: string; text: (month: string) => string }> = {
  closed: {
    title: "¿Esta cuenta bancaria fue cerrada en este periodo?",
    yes: "Sí, la cuenta fue cerrada",
    no: "No, sigue activa",
    text: (m) => `El extracto termina con saldo final $0 en ${m}. Si la cuenta se cerró, los meses siguientes quedan «No aplica» en la cobertura; si sigue activa, se siguen exigiendo.`,
  },
  opened: {
    title: "¿Esta cuenta bancaria fue abierta en este periodo?",
    yes: "Sí, es una cuenta nueva",
    no: "No, la cuenta ya existía",
    text: (m) => `El extracto empieza con saldo $0 y no hay extractos anteriores de esta cuenta. Si es nueva, los meses anteriores a ${m} quedan «No aplica» en la cobertura.`,
  },
};

/**
 * Acciones (arriba), análisis del banco y clasificación contable de cada
 * concepto: destino (Seleccionar / Enviar a Estados Financieros / No enviar),
 * cuenta PUC, GMF (4x1000) y cuenta PUC del saldo bancario. La asociación
 * banco + concepto → PUC es global y solo se sugiere; «No enviar» aplica solo a
 * este extracto. Un saldo en 0 nunca abre ni cierra la cuenta sin confirmación.
 */
export function BankAccountingPanel({ statement, fileName, onExport, exporting, typeLabels, validated, validation, fileActions, fileDetail, renderDetail }: Props) {
  const toast = useToast();
  const data = useFsData();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [conceptMappings, setConceptMappings] = useState<BankConceptMapping[]>([]);
  const [gmfRules, setGmfRules] = useState<GmfRule[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [lifecycles, setLifecycles] = useState<BankAccountLifecycle[] | null>(null);
  const [batches, setBatches] = useState<BatchSummary[] | null>(null);
  const [balancePuc, setBalancePuc] = useState<string | undefined>();
  const [decisions, setDecisions] = useState<Record<string, ConceptDecision>>({});
  const [answering, setAnswering] = useState<string | null>(null);
  const [filter, setFilter] = useState<ConceptFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPuc, setBulkPuc] = useState<string | undefined>();
  const [detail, setDetail] = useState<string | null>(null);
  const [validationOpen, setValidationOpen] = useState(false);

  useEffect(() => {
    void fsService.bankAccounts().then(setAccounts);
    void fsService.bankConceptMappings().then(setConceptMappings);
    void fsService.gmfRules().then(setGmfRules);
  }, []);

  // Empresa y PUC de saldo ya configurados para este banco + cuenta.
  useEffect(() => {
    const known = accounts.find((a) => a.bank === statement.bank && a.accountNumber === statement.accountNumber);
    if (known && companyId === null) {
      setCompanyId(known.companyId);
      setBalancePuc(known.pucCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, statement]);

  useEffect(() => {
    if (companyId === null) return;
    const known = accounts.find((a) => a.companyId === companyId && a.bank === statement.bank && a.accountNumber === statement.accountNumber);
    setBalancePuc(known?.pucCode);
  }, [companyId, accounts, statement]);

  // Apertura / cierre e historial de extractos de la empresa (para las preguntas de saldo 0).
  const reloadAccountHistory = useCallback(async () => {
    if (companyId === null) return;
    try {
      const [l, b] = await Promise.all([fsService.bankLifecycles(companyId), fsService.batches(companyId)]);
      setLifecycles(l);
      setBatches(b);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [companyId, toast]);

  useEffect(() => {
    setLifecycles(null);
    setBatches(null);
    void reloadAccountHistory();
  }, [reloadAccountHistory]);

  const lifecycle = lifecycles?.find((l) => l.bank === statement.bank.trim() && l.accountNumber === (statement.accountNumber ?? "").trim()) ?? null;
  const questions = useMemo(
    () => (companyId !== null && statement.accountNumber && lifecycles && batches ? lifecycleQuestions(statement, lifecycle, hasEarlierStatement(statement, batches)) : []),
    [companyId, statement, lifecycles, batches, lifecycle],
  );

  const suggested = useMemo(() => new Map(conceptMappings.map((m) => [conceptMappingKey(m.bank, m.concept), m.pucCode])), [conceptMappings]);
  const rules = useMemo(() => new Map(gmfRules.map((r) => [gmfRuleKey(r.bank, r.concept), r])), [gmfRules]);
  const gmfOf = (description: string): GmfState => gmfState(statement.bank, description, rules);
  const confirmedGmf = useMemo(
    () =>
      new Map(
        statement.concepts.filter((c) => gmfState(statement.bank, c.description, rules) === "confirmed").map((c) => [c.description, rules.get(gmfRuleKey(statement.bank, c.description))!.origin]),
      ),
    [statement, rules],
  );
  // Una sugerencia GMF sin confirmar bloquea mientras el concepto pueda enviarse (con «No enviar» no importa).
  const gmfToReview = [...new Set(statement.concepts.filter((c) => decisions[c.key]?.destination !== "skip" && gmfOf(c.description) === "suggested").map((c) => c.description))];

  const pending = pendingConcepts(statement, decisions);
  const blocking: { text: string; status: string }[] = [
    companyId === null && { text: "Selecciona la empresa", status: "Requiere revisión" },
    !statement.accountNumber && { text: "El extracto no trae número de cuenta", status: "Requiere revisión" },
    (!statement.periodFrom || !statement.periodTo) && { text: "El extracto no trae el periodo", status: "Requiere revisión" },
    ...questions.map((q) => ({ text: q.kind === "closed" ? "Confirma si la cuenta fue cerrada" : "Confirma si la cuenta es nueva", status: "Requiere revisión" })),
    pending > 0 && { text: pending === 1 ? "Hay 1 concepto pendiente de clasificación" : `Hay ${formatInteger(pending)} conceptos pendientes de clasificación`, status: "Pendiente de clasificación" },
    gmfToReview.length > 0 && {
      text: gmfToReview.length === 1 ? "1 concepto detectado como GMF por confirmar" : `${formatInteger(gmfToReview.length)} conceptos detectados como GMF por confirmar`,
      status: "Requiere revisión",
    },
    statement.closingBalanceCents !== undefined && !balancePuc && { text: "Falta la cuenta PUC del saldo bancario", status: "Pendiente de clasificación" },
  ].filter(Boolean) as { text: string; status: string }[];

  // GMF que se enviará: neto (salidas − entradas) y 50 %, por concepto y cuenta PUC.
  const gmfSummary = useMemo(() => {
    const groups = new Map<string, { description: string; outflow: number; inflow: number }>();
    for (const c of statement.concepts) {
      const d = decisions[c.key];
      if (!confirmedGmf.has(c.description) || d?.destination !== "send" || !d.pucCode) continue;
      const k = `${c.description}|${d.pucCode}`;
      const g = groups.get(k) ?? { description: c.description, outflow: 0, inflow: 0 };
      if (c.dc === "D") g.outflow += c.totalCents;
      else g.inflow += c.totalCents;
      groups.set(k, g);
    }
    return [...groups.values()];
  }, [statement, decisions, confirmedGmf]);

  function decide(key: string, description: string, destination: Destination) {
    setDecisions((prev) => ({ ...prev, [key]: { destination, pucCode: destination === "send" ? (prev[key]?.pucCode ?? suggested.get(conceptMappingKey(statement.bank, description))) : undefined } }));
  }

  async function setGmf(description: string, isGmf: boolean, state: GmfState) {
    setAnswering(`gmf:${description}`);
    try {
      // «Automática»: el usuario confirmó la detección por palabra clave; cualquier otra decisión es manual.
      await fsService.saveGmfRule(statement.bank, description, isGmf, isGmf && state === "suggested" ? "auto" : "manual");
      setGmfRules(await fsService.gmfRules());
      toast(isGmf ? `«${description}» se tratará como GMF (${GMF_PERCENT} % a Estados Financieros).` : `«${description}» no se tratará como GMF.`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setAnswering(null);
    }
  }

  async function answer(q: LifecycleQuestion, yes: boolean) {
    if (companyId === null || !statement.accountNumber) return;
    setAnswering(`${q.kind}:${yes}`);
    try {
      const action = q.kind === "closed" ? (yes ? "closed" : "kept_active") : yes ? "opened" : "existed_before";
      await fsService.saveBankLifecycle({ companyId, bank: statement.bank.trim(), accountNumber: statement.accountNumber.trim(), action, period: q.period });
      toast(
        yes
          ? q.kind === "closed"
            ? `Cierre registrado en ${periodLabel(q.period).toLowerCase()}.`
            : `Apertura registrada en ${periodLabel(q.period).toLowerCase()}.`
          : "Respuesta guardada: la cobertura no cambia.",
      );
      await reloadAccountHistory();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setAnswering(null);
    }
  }

  const plural = (label: string) => `${label}s`.replace(/ss$/, "s");
  const totals = useMemo(() => {
    const inflow = statement.concepts.filter((c) => c.dc === "C").reduce((n, c) => n + c.totalCents, 0);
    const outflow = statement.concepts.filter((c) => c.dc === "D").reduce((n, c) => n + c.totalCents, 0);
    return { inflow, outflow, net: inflow - outflow };
  }, [statement]);

  const isClassified = (key: string) => {
    const d = decisions[key];
    return d?.destination === "skip" || (d?.destination === "send" && Boolean(d.pucCode));
  };
  const visible = useMemo(() => {
    const q = normalizeKey(query);
    return statement.concepts.filter((c) => {
      if (filter === "pending" && isClassified(c.key)) return false;
      if (filter === "classified" && !isClassified(c.key)) return false;
      if ((filter === "C" || filter === "D") && c.dc !== filter) return false;
      if (filter === "gmf" && gmfOf(c.description) !== "suggested" && gmfOf(c.description) !== "confirmed") return false;
      return !q || normalizeKey(c.description).includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statement, filter, query, decisions, rules]);
  const FILTERS: { id: ConceptFilter; label: string }[] = [
    { id: "all", label: "Todos" },
    { id: "pending", label: `Pendientes (${pending})` },
    { id: "classified", label: "Clasificados" },
    { id: "C", label: `Entradas · ${plural(typeLabels.C)}` },
    { id: "D", label: `Salidas · ${plural(typeLabels.D)}` },
    { id: "gmf", label: "GMF" },
  ];
  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.key));

  /** Acción masiva sobre los conceptos seleccionados: Asignar PUC (envía), Enviar a EEFF o No enviar. */
  function bulk(action: "puc" | "send" | "skip") {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const key of selected) {
        const c = statement.concepts.find((x) => x.key === key);
        if (!c) continue;
        if (action === "skip") next[key] = { destination: "skip" };
        else if (action === "puc") next[key] = { destination: "send", pucCode: bulkPuc };
        else next[key] = { destination: "send", pucCode: prev[key]?.pucCode ?? suggested.get(conceptMappingKey(statement.bank, c.description)) };
      }
      return next;
    });
    toast(`${selected.size === 1 ? "1 concepto actualizado" : `${formatInteger(selected.size)} conceptos actualizados`}.`);
    setSelected(new Set());
    setBulkPuc(undefined);
  }

  const accountState = statement.movementCount === 0 && !lifecycle ? "Sin movimientos" : lifecycle ? (lifecycle.status === "closed" ? lifecycleText(lifecycle) || "Cerrada" : lifecycleText(lifecycle) || "Activa") : companyId === null ? "—" : "Activa (sin novedades)";

  return (
    <>
      {/* 1. Cabecera compacta: empresa, periodo, banco, cuenta, archivo, PUC del saldo y estado de la cuenta. */}
      <ContextBar
        items={[
          { label: "Banco", value: statement.bank },
          { label: "Cuenta", value: statement.accountNumber ?? "—", selectable: true },
          { label: "Periodo", value: statement.periodFrom && statement.periodTo ? `${formatIsoDate(statement.periodFrom)} a ${formatIsoDate(statement.periodTo)}` : "—" },
          { label: "Archivo", value: fileName, selectable: true, hint: fileDetail },
          { label: "Estado de cuenta", value: accountState },
        ]}
        actions={fileActions}
      >
        <div className="bank-head__fields">
          <CompanySelect companies={data.companies} value={companyId} onChange={setCompanyId} />
          <div className="field">
            <span className="field__label">PUC del saldo bancario</span>
            <PucField
              index={data.index}
              value={balancePuc}
              onChange={setBalancePuc}
              title="Cuenta PUC del saldo bancario"
              disabled={companyId === null}
              mappings={data.mappingMap}
              onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])}
            />
            <span className="field__hint">Saldo final {statement.closingBalanceCents === undefined ? "no disponible" : formatExactCents(statement.closingBalanceCents)}{statement.periodTo ? ` al ${formatIsoDate(statement.periodTo)}` : ""}</span>
          </div>
        </div>
      </ContextBar>

      {/* 2. Estado y acciones de Estados Financieros. */}
      <SendToFs
        blocked={blocking[0]?.text ?? null}
        blockedStatus={blocking[0]?.status}
        reasons={blocking.map((b) => b.text)}
        readyStatus={statement.movementCount === 0 ? "Procesado sin movimientos · listo para Estados Financieros" : undefined}
        build={() => (companyId === null ? null : buildBankBatch(companyId, statement, fileName, decisions, balancePuc ?? "", confirmedGmf))}
        onExport={onExport}
        exporting={exporting}
        duplicateTitle="Este extracto ya fue enviado."
        replaceLabel="Reemplazar envío anterior"
        onSent={() => {
          void fsService.bankConceptMappings().then(setConceptMappings);
          void reloadAccountHistory();
        }}
      />

      {questions.map((q) => (
        <Alert key={q.kind} tone="warning" title={QUESTION[q.kind].title}>
          {statement.bank} {maskAccount(statement.accountNumber ?? "")} · {QUESTION[q.kind].text(periodLabel(q.period).toLowerCase())}
          <div className="row" style={{ marginTop: 8 }}>
            <Button size="sm" variant="primary" loading={answering === `${q.kind}:true`} disabled={answering !== null} onClick={() => void answer(q, true)}>
              {QUESTION[q.kind].yes}
            </Button>
            <Button size="sm" loading={answering === `${q.kind}:false`} disabled={answering !== null} onClick={() => void answer(q, false)}>
              {QUESTION[q.kind].no}
            </Button>
          </div>
        </Alert>
      ))}

      {/* 3. Validación compacta: validado = una línea con su detalle a pedido; con diferencias, el aviso completo. */}
      {validated ? (
        <div className="card bank-validation">
          <span className="bank-validation__ok">
            <CheckCircle2 size={15} aria-hidden /> Extracto validado
          </span>
          <Button size="sm" variant="ghost" icon={validationOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} aria-expanded={validationOpen} onClick={() => setValidationOpen((v) => !v)}>
            {validationOpen ? "Ocultar detalle" : "Ver detalle"}
          </Button>
          {validationOpen && <div className="bank-validation__detail">{validation}</div>}
        </div>
      ) : (
        validation
      )}

      {/* 4. Métricas resumidas. */}
      <MetricBar
        label="Resumen del extracto"
        metrics={[
          { key: "movements", label: statement.movementCount === 1 ? "movimiento" : "movimientos", value: formatInteger(statement.movementCount) },
          { key: "concepts", label: statement.concepts.length === 1 ? "concepto" : "conceptos", value: formatInteger(statement.concepts.length) },
          { key: "in", label: `entradas (${plural(typeLabels.C).toLowerCase()})`, value: formatExactCents(totals.inflow), tone: "positive", onClick: () => setFilter("C"), active: filter === "C" },
          { key: "out", label: `salidas (${plural(typeLabels.D).toLowerCase()})`, value: formatExactCents(totals.outflow), tone: "negative", onClick: () => setFilter("D"), active: filter === "D" },
          { key: "net", label: "neto", value: formatExactCents(totals.net) },
          { key: "balance", label: "saldo final", value: statement.closingBalanceCents === undefined ? "—" : formatExactCents(statement.closingBalanceCents) },
          ...(pending > 0 ? [{ key: "pending", label: pending === 1 ? "pendiente" : "pendientes", value: formatInteger(pending), tone: "attention" as const, onClick: () => setFilter("pending"), active: filter === "pending" }] : []),
        ]}
      />

      {statement.movementCount === 0 && (
        <Alert tone="info" title="Este extracto no contiene movimientos en el periodo.">
          Puedes registrarlo igualmente para completar la cobertura bancaria: se guarda el extracto con su saldo final, sin crear movimientos contables.
        </Alert>
      )}

      {/* 5–8. Una sola tabla de clasificación con filtros, selección múltiple y detalle por fila. */}
      {statement.concepts.length > 0 && (
        <Card flush title="Clasificación de conceptos" description="Destino, cuenta PUC y GMF de cada concepto. «No enviar» aplica solo a este extracto. Abre una fila para ver sus movimientos.">
          <div className="toolbar row--between">
            <SegmentedFilter label="Filtrar conceptos" options={FILTERS} value={filter} onChange={setFilter} />
            <SearchBox placeholder="Buscar concepto" value={query} onChange={setQuery} />
          </div>
          {selected.size > 0 && (
            <div className="bulk-bar" role="region" aria-label="Acciones sobre la selección">
              <span>
                <strong>{selected.size === 1 ? "1 concepto seleccionado" : `${formatInteger(selected.size)} conceptos seleccionados`}</strong>
              </span>
              <PucField index={data.index} value={bulkPuc} onChange={setBulkPuc} placeholder="Elegir PUC" compact mappings={data.mappingMap} onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])} />
              <Button size="sm" variant="primary" disabled={!bulkPuc} onClick={() => bulk("puc")}>
                Asignar PUC
              </Button>
              <Button size="sm" icon={<Send size={13} />} onClick={() => bulk("send")}>
                Enviar a EEFF
              </Button>
              <Button size="sm" icon={<XCircle size={13} />} onClick={() => bulk("skip")}>
                No enviar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Quitar selección
              </Button>
            </div>
          )}
          <div className="table-wrap table-wrap--scroll">
            <table className="table bank-classify">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input type="checkbox" aria-label="Seleccionar los conceptos visibles" checked={allVisibleSelected} onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((c) => c.key)) : new Set())} />
                  </th>
                  <th>Concepto</th>
                  <th>Tipo</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Total</th>
                  <th>Destino</th>
                  <th>Cuenta PUC</th>
                  <th>GMF / 4x1000</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted" style={{ textAlign: "center", padding: "var(--space-5)" }}>
                      Ningún concepto coincide con el filtro.
                    </td>
                  </tr>
                )}
                {visible.map((c) => {
                  const d = decisions[c.key];
                  const destination = d?.destination ?? "select";
                  const suggestion = suggested.get(conceptMappingKey(statement.bank, c.description));
                  const gmf = gmfOf(c.description);
                  const busy = answering === `gmf:${c.description}`;
                  return (
                    <tr
                      key={c.key}
                      className={["is-clickable", (destination === "select" || (gmf === "suggested" && destination !== "skip")) && "row-attention--warning", selected.has(c.key) && "is-selected"].filter(Boolean).join(" ")}
                      onClick={() => setDetail(c.key)}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${c.description}`}
                          checked={selected.has(c.key)}
                          onChange={(e) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(c.key);
                              else next.delete(c.key);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="selectable">{c.description}</td>
                      <td className="nowrap">
                        <span className={c.dc === "C" ? "amount--positive" : "amount--negative"}>{c.dc === "D" ? "Salida" : "Ingreso"}</span>
                        <div className="table__secondary">{typeLabels[c.dc]}</div>
                      </td>
                      <td className="num">{formatInteger(c.count)}</td>
                      <td className="num">{formatExactCents(c.totalCents)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Select aria-label={`Destino de ${c.description}`} value={destination} onChange={(e) => decide(c.key, c.description, e.target.value as Destination)} style={{ width: "auto" }}>
                          <option value="select">Seleccionar</option>
                          <option value="send">Enviar a Estados Financieros</option>
                          <option value="skip">No enviar</option>
                        </Select>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {destination === "send" ? (
                          <PucField
                            index={data.index}
                            value={d?.pucCode}
                            onChange={(code) => setDecisions((prev) => ({ ...prev, [c.key]: { destination: "send", pucCode: code } }))}
                            suggestions={suggestion ? [{ code: suggestion, concept: data.index.concepts.get(suggestion) ?? "" }] : undefined}
                            title={c.description}
                            mappings={data.mappingMap}
                            onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])}
                          />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <GmfCell state={gmf} busy={busy} disabled={answering !== null} onSet={(isGmf) => void setGmf(c.description, isGmf, gmf)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {gmfSummary.length > 0 && (
            <div style={{ padding: "var(--space-3) var(--space-5)" }}>
              <Alert
                tone="info"
                title={`GMF: a Estados Financieros va el ${GMF_PERCENT} % del valor neto`}
                items={gmfSummary.map((g) => {
                  const net = g.outflow - g.inflow;
                  return `${g.description}: salidas ${formatExactCents(g.outflow)} − entradas ${formatExactCents(g.inflow)} = neto ${formatExactCents(net)} → ${GMF_PERCENT} % ${formatExactCents(gmfAccountingCents(net))}`;
                })}
              >
                Los movimientos del extracto se conservan completos en el detalle; la otra mitad no se envía a ninguna cuenta.
              </Alert>
            </div>
          )}
        </Card>
      )}
      {detail !== null && renderDetail?.(detail, () => setDetail(null))}
    </>
  );
}

/** Detección GMF de un concepto con su corrección: Confirmar / Quitar (se recuerda por banco + concepto exacto). */
function GmfCell({ state, busy, disabled, onSet }: { state: GmfState; busy: boolean; disabled: boolean; onSet: (isGmf: boolean) => void }) {
  if (state === "suggested")
    return (
      <div className="stack stack--sm" style={{ alignItems: "flex-start" }}>
        <Badge tone="warning">Detectado como GMF / 4x1000</Badge>
        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          <Button size="sm" variant="primary" loading={busy} disabled={disabled} onClick={() => onSet(true)}>
            Confirmar GMF
          </Button>
          <Button size="sm" disabled={disabled} onClick={() => onSet(false)}>
            Quitar GMF
          </Button>
        </div>
      </div>
    );
  if (state === "confirmed")
    return (
      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
        <Badge tone="success">GMF · {GMF_PERCENT} %</Badge>
        <Button size="sm" variant="ghost" loading={busy} disabled={disabled} onClick={() => onSet(false)}>
          Quitar GMF
        </Button>
      </div>
    );
  return (
    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
      {state === "rejected" && <span className="muted">No es GMF</span>}
      <Button size="sm" variant="ghost" loading={busy} disabled={disabled} onClick={() => onSet(true)}>
        Marcar GMF
      </Button>
    </div>
  );
}

type SignedArgs = Parameters<typeof fromSignedGroups>;
type TypedArgs = Parameters<typeof fromTypedGroups>;
type Common = Omit<Props, "statement" | "typeLabels"> & { typeLabels?: BankTypeLabels };

export const SIGNED_TYPE_LABELS: BankTypeLabels = { C: "Positivo", D: "Negativo" };
export const TYPED_TYPE_LABELS: BankTypeLabels = { C: "Crédito", D: "Débito" };

/** Bancos con grupos por signo (Bancolombia, Davivienda, Iris Bank). */
export function SignedBankAccounting({ statement, groups, ...rest }: Common & { statement: SignedArgs[0]; groups: SignedArgs[1] }) {
  const accounting = useMemo(() => fromSignedGroups(statement, groups), [statement, groups]);
  return <BankAccountingPanel statement={accounting} typeLabels={SIGNED_TYPE_LABELS} {...rest} />;
}

/** Bancos con grupos por crédito / débito (Bancoomeva, Coopcentral, BBVA). */
export function TypedBankAccounting({
  statement,
  closingBalanceCents,
  openingBalanceCents,
  groups,
  ...rest
}: Common & { statement: TypedArgs[0]; closingBalanceCents: TypedArgs[1]; openingBalanceCents: TypedArgs[2]; groups: TypedArgs[3] }) {
  const accounting = useMemo(() => fromTypedGroups(statement, closingBalanceCents, openingBalanceCents, groups), [statement, closingBalanceCents, openingBalanceCents, groups]);
  return <BankAccountingPanel statement={accounting} typeLabels={TYPED_TYPE_LABELS} {...rest} />;
}
