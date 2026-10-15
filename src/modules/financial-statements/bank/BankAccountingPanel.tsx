import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, Badge, Button, Card, Field, Select, useToast } from "../../../components/ui";
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

interface Props {
  statement: AccountingStatement;
  fileName: string;
  onExport: () => Promise<string | null | void>;
  exporting?: boolean;
  /** Análisis propio del banco (validación, resumen, grupos): va entre las acciones y la clasificación contable. */
  children?: ReactNode;
}

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
export function BankAccountingPanel({ statement, fileName, onExport, exporting, children }: Props) {
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

  return (
    <>
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

      {statement.movementCount === 0 && (
        <Alert tone="info" title="Este extracto no contiene movimientos en el periodo.">
          Puedes registrarlo igualmente para completar la cobertura bancaria: se guarda el extracto con su saldo final, sin crear movimientos contables.
        </Alert>
      )}

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

      {children}

      <Card title="Clasificación contable" description="Decide el destino de cada concepto. «Seleccionar» no es válido para enviar; «No enviar» aplica solo a este extracto.">
        <div className="stack">
          <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
            <CompanySelect companies={data.companies} value={companyId} onChange={setCompanyId} />
            <Field
              label="Cuenta PUC del saldo bancario"
              hint={`${statement.bank} · Cuenta ${statement.accountNumber ?? "—"} · Saldo final ${statement.closingBalanceCents === undefined ? "no disponible" : formatExactCents(statement.closingBalanceCents)}${statement.periodTo ? ` al ${formatIsoDate(statement.periodTo)}` : ""}`}
            >
              {() => (
                <PucField
                  index={data.index}
                  value={balancePuc}
                  onChange={setBalancePuc}
                  title="Cuenta PUC del saldo bancario"
                  disabled={companyId === null}
                  mappings={data.mappingMap}
                  onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])}
                />
              )}
            </Field>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th>Tipo</th>
                  <th style={{ textAlign: "right" }}>Cantidad</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th>Destino</th>
                  <th>Cuenta PUC</th>
                  <th>GMF / 4x1000</th>
                </tr>
              </thead>
              <tbody>
                {statement.concepts.map((c) => {
                  const d = decisions[c.key];
                  const destination = d?.destination ?? "select";
                  const suggestion = suggested.get(conceptMappingKey(statement.bank, c.description));
                  const gmf = gmfOf(c.description);
                  const busy = answering === `gmf:${c.description}`;
                  return (
                    <tr key={c.key} className={destination === "select" || (gmf === "suggested" && destination !== "skip") ? "row-attention--warning" : undefined}>
                      <td className="selectable">{c.description}</td>
                      <td>{c.dc === "D" ? "Salida" : "Entrada"}</td>
                      <td style={{ textAlign: "right" }}>{formatInteger(c.count)}</td>
                      <td className="nowrap" style={{ textAlign: "right" }}>
                        {formatExactCents(c.totalCents)}
                      </td>
                      <td>
                        <Select aria-label={`Destino de ${c.description}`} value={destination} onChange={(e) => decide(c.key, c.description, e.target.value as Destination)} style={{ width: "auto" }}>
                          <option value="select">Seleccionar</option>
                          <option value="send">Enviar a Estados Financieros</option>
                          <option value="skip">No enviar</option>
                        </Select>
                      </td>
                      <td>
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
                      <td>
                        <GmfCell state={gmf} busy={busy} disabled={answering !== null} onSet={(isGmf) => void setGmf(c.description, isGmf, gmf)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pending > 0 && <Alert tone="warning">{pending === 1 ? "Hay 1 concepto pendiente de clasificación." : `Hay ${formatInteger(pending)} conceptos pendientes de clasificación.`}</Alert>}
          {gmfSummary.length > 0 && (
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
          )}
        </div>
      </Card>
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
interface Common {
  fileName: string;
  onExport: () => Promise<string | null | void>;
  exporting?: boolean;
  children?: ReactNode;
}

/** Bancos con grupos por signo (Bancolombia, Davivienda, Iris Bank). */
export function SignedBankAccounting({ statement, groups, ...rest }: Common & { statement: SignedArgs[0]; groups: SignedArgs[1] }) {
  const accounting = useMemo(() => fromSignedGroups(statement, groups), [statement, groups]);
  return <BankAccountingPanel statement={accounting} {...rest} />;
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
  return <BankAccountingPanel statement={accounting} {...rest} />;
}
