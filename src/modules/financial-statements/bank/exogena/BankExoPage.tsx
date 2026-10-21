import { Check, ChevronDown, ChevronRight, Landmark, Minus, Pencil } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { navigate, useRoute } from "../../../../app/router";
import { bankAnalysisModule } from "../../../bank-analysis";
import { Badge, Button, Card, EmptyState, Loader, Modal, PageHeader, useToast } from "../../../../components/ui";
import { fsService } from "../../../../services/fsService";
import { errorMessage } from "../../../../services/tauri";
import type { BankAccountLifecycle } from "../../../../types/fs";
import { formatDateTimeForDisplay } from "../../../../utils/dates";
import { formatInteger } from "../../../../utils/format";
import { ExogenaContextBar } from "../../../exogena/components/ExogenaContextBar";
import { useCompanies } from "../../../exogena/hooks";
import { useExogenaSelection } from "../../../exogena/state";
import { maskAccount } from "../../generator/checks";
import { formatExactCents, formatIsoDate, periodLabel } from "../../shared/money";
import { BankLifecycleModal, lifecycleText } from "../BankLifecycleModal";
import { GMF_PERCENT, gmfRuleKey, gmfState, interestRuleKey, interestState } from "../bankAccounting";
import { reopenReadyBankFormats, useBankExo } from "./load";
import { BANK_EXO_FORMATS, bankKeyOf, type AccountModel, type BankModel, type MonthCell } from "./model";
import { bankImportPath, BANK_EXO_PATH, parseBankExoFocus, type BankExoFocus } from "./paths";
import { BankExoAlertRow, BankExoStatusCard } from "./ui/BankExoAlerts";
import { BankProfileModal } from "./ui/BankProfileModal";
import { COVERAGE_TEXT } from "./ui/coverageText";

const STATUS_TEXT: Record<MonthCell["state"], string> = {
  loaded: "Cargado y vigente",
  replaced: "Reemplazado",
  voided: "Anulado",
  pending: "Pendiente de importar",
  na: "No aplica (cuenta no abierta o ya cerrada)",
};

const shortMonth = (m: string) => periodLabel(m).split(" ")[0].slice(0, 3);

/** Estado de un extracto en el historial del mes. */
const BATCH_STATUS = { active: "Vigente", replaced: "Reemplazado", voided: "Anulado" } as const;

/**
 * Estados Financieros → Extractos bancarios → Cobertura y Exógena: lo importado por Empresa → Banco → Cuenta → mes del año,
 * las fichas de los bancos (NIT y razón social como informado) y lo que los extractos aportan a los formatos 1012, 1007 y 1011
 * con sus pendientes. Todo sale de los extractos persistidos, así un reinicio o un respaldo restaurado dan lo mismo.
 */
export default function BankExoPage() {
  const toast = useToast();
  const [selection, updateSelection] = useExogenaSelection();
  const { companies } = useCompanies();
  const route = useRoute();
  const bank = useBankExo(selection.companyId, selection.year);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [month, setMonth] = useState<{ account: AccountModel; month: string } | null>(null);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [lifecycleFor, setLifecycleFor] = useState<AccountModel | null>(null);
  const [focus, setFocus] = useState<BankExoFocus | null>(null);

  // Un enlace desde un pendiente (ficha, banco o mes exacto) fija empresa y año y abre lo que corresponde cuando hay datos.
  const segment = route[4];
  useEffect(() => {
    const f = parseBankExoFocus(segment);
    if (!f) return;
    if (f.kind !== "profile") updateSelection({ companyId: f.companyId, year: f.year });
    setFocus(f);
    navigate(BANK_EXO_PATH);
  }, [segment, updateSelection]);

  const result = bank.contribution?.result ?? null;
  useEffect(() => {
    if (!focus) return;
    if (focus.kind === "profile") {
      setProfileFor(focus.bank);
      return setFocus(null);
    }
    if (!result || selection.companyId !== focus.companyId || selection.year !== focus.year) return;
    const key = bankKeyOf(focus.bank);
    setOpen((prev) => new Set(prev).add(key));
    if (focus.kind === "month") {
      const account = result.banks.find((b) => b.bankKey === key)?.accounts.find((a) => a.accountNumber === focus.account);
      if (account) {
        setOpen((prev) => new Set(prev).add(`${key}|${account.accountNumber}`));
        setMonth({ account, month: focus.month });
      }
    }
    setFocus(null);
  }, [focus, result, selection.companyId, selection.year]);

  /** Tras cualquier cambio: se vuelve a leer y un formato «Listo» que quede bloqueado o desactualizado se reabre. */
  const changed = useCallback(async () => {
    await bank.reload();
    if (selection.companyId !== null) void reopenReadyBankFormats(selection.companyId, [selection.year]).catch(() => undefined);
  }, [bank, selection.companyId, selection.year]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const profiles = bank.data?.profiles ?? [];
  const known = useMemo(() => {
    const names = new Map<string, string>();
    for (const s of bankAnalysisModule.submodules) names.set(bankKeyOf(s.name), s.name);
    for (const b of result?.banks ?? []) names.set(b.bankKey, b.bank);
    for (const p of profiles) names.set(p.bankKey, p.bank);
    return [...names.entries()].sort(([, a], [, b]) => a.localeCompare(b, "es", { sensitivity: "base" }));
  }, [result, profiles]);

  const companyId = selection.companyId;
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => `${selection.year}-${String(i + 1).padStart(2, "0")}`), [selection.year]);

  return (
    <>
      <PageHeader
        eyebrow="Estados Financieros · Extractos bancarios"
        title="Cobertura y Exógena"
        description="Qué extractos se han importado por empresa, banco, cuenta y mes, las fichas de los bancos y lo que aportan a los formatos 1012 (saldo al 31-12), 1007 (intereses) y 1011 (GMF)."
        actions={
          <Button icon={<Landmark size={15} />} onClick={() => navigate("/herramientas/estados-financieros/extractos-bancarios")}>
            Importar un extracto
          </Button>
        }
      />
      <ExogenaContextBar companies={companies} />
      {companyId === null ? (
        <Card>
          <EmptyState icon={<Landmark size={20} />} title="Selecciona una empresa" description="Elige la empresa y el año para ver qué extractos se han importado y qué pendientes tienen 1012, 1007 y 1011." />
        </Card>
      ) : !result || !bank.data ? (
        <Loader />
      ) : (
        <>
          <BankExoStatusCard result={result} companyId={companyId} onChanged={changed} />
          <Card
            flush
            title={`Cobertura de extractos ${selection.year}`}
            description="Empresa → banco → cuenta → meses del año. Abre un mes para ver el extracto que lo originó, su estado y sus saldos, intereses y GMF."
          >
            {result.banks.length === 0 ? (
              <EmptyState icon={<Landmark size={20} />} title="Sin extractos importados" description={`Esta empresa no tiene extractos bancarios con periodo en ${selection.year}. Importa los extractos de cada banco para alimentar 1012, 1007 y 1011.`} />
            ) : (
              <div className="table-wrap">
                <table className="table fs-coverage">
                  <thead>
                    <tr>
                      <th>Banco / cuenta</th>
                      {months.map((m) => (
                        <th key={m} style={{ textAlign: "center" }}>
                          {shortMonth(m)}
                        </th>
                      ))}
                      <th>Resumen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.banks.flatMap((b) => {
                      const isOpen = open.has(b.bankKey);
                      const rows = [
                        <tr key={b.bankKey} className="fs-coverage__group">
                          <td>
                            <button type="button" className="fs-coverage__toggle" onClick={() => toggle(b.bankKey)} aria-expanded={isOpen}>
                              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              {b.bank}
                            </button>
                            <div className="table__secondary">
                              {b.profile ? `NIT ${b.profile.nit}-${b.profile.dv} · ${b.profile.businessName}` : <span className="fs-coverage__pending">Sin ficha para Exógena</span>}
                            </div>
                          </td>
                          {months.map((m) => (
                            <td key={m} style={{ textAlign: "center" }}>
                              <BankMonth bank={b} month={m} />
                            </td>
                          ))}
                          <td>
                            <BankSummary bank={b} onProfile={() => setProfileFor(b.bank)} />
                          </td>
                        </tr>,
                      ];
                      if (isOpen) {
                        for (const a of b.accounts)
                          rows.push(
                            <tr key={a.key} className="fs-coverage__account">
                              <td>
                                <span className="mono">{maskAccount(a.accountNumber)}</span>
                                {lifecycleText(a.lifecycle) && <div className="fs-coverage__lifecycle">{lifecycleText(a.lifecycle)}</div>}
                                <div className="fs-coverage__lifecycle row" style={{ gap: 6 }}>
                                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLifecycleFor(a)} title="Registrar o corregir la apertura y el cierre de esta cuenta">
                                    <Pencil size={12} /> Apertura / cierre
                                  </button>
                                </div>
                              </td>
                              {a.cells.map((c) => (
                                <td key={c.month} style={{ textAlign: "center" }}>
                                  <AccountCell cell={c} label={`${b.bank} ${maskAccount(a.accountNumber)}`} onOpen={() => setMonth({ account: a, month: c.month })} />
                                </td>
                              ))}
                              <td>
                                <AccountSummary account={a} year={selection.year} />
                              </td>
                            </tr>,
                          );
                      }
                      return rows;
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Legend />
          </Card>

          <Card flush title="Fichas de bancos para Exógena" description="Cada banco se informa como tercero (NIT sin DV, razón social, tipo NIT y país 169). Se crea una sola vez y se usa en todas las empresas, años y extractos.">
            <div className="table-wrap">
              <table className="table table--dense">
                <thead>
                  <tr>
                    <th>Banco</th>
                    <th>NIT</th>
                    <th>DV</th>
                    <th>Razón social</th>
                    <th>Documento / país</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {known.map(([key, name]) => {
                    const p = profiles.find((x) => x.bankKey === key);
                    return (
                      <tr key={key}>
                        <td className="table__primary">{name}</td>
                        <td>{p?.nit ?? <Badge tone="danger">Sin ficha</Badge>}</td>
                        <td>{p?.dv ?? <span className="muted">—</span>}</td>
                        <td>{p?.businessName ?? <span className="muted">—</span>}</td>
                        <td>{p ? `${p.docTypeCode} · NIT / ${p.countryCode}` : <span className="muted">—</span>}</td>
                        <td className="actions">
                          <Button size="sm" variant={p ? "ghost" : "primary"} onClick={() => setProfileFor(name)}>
                            {p ? "Editar ficha" : "Crear ficha"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="stack">
            <Card title="Qué aporta cada formato" description={`Año ${selection.year}.`}>
              <div className="stack stack--sm">
                {BANK_EXO_FORMATS.map((f) => (
                  <div key={f} className="row row--between" style={{ gap: 12, flexWrap: "wrap" }}>
                    <span>
                      <strong>{f}</strong>{" "}
                      <span className="muted">
                        {f === "1012" && `saldo del extracto de diciembre por banco · ${result.records["1012"].length} ${result.records["1012"].length === 1 ? "registro" : "registros"}`}
                        {f === "1007" && `intereses de todos los meses importados por banco (4003) · ${result.records["1007"].length} ${result.records["1007"].length === 1 ? "registro" : "registros"}`}
                        {f === "1011" && `${GMF_PERCENT} % del GMF anual, una sola fila (8211) · ${result.records["1011"].length} ${result.records["1011"].length === 1 ? "registro" : "registros"}`}
                      </span>
                    </span>
                    <Button size="sm" onClick={() => navigate(`/herramientas/informacion-exogena/${f}`)}>
                      Abrir {f}
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {profileFor && (
            <BankProfileModal
              open
              bank={profileFor}
              profile={profiles.find((p) => p.bankKey === bankKeyOf(profileFor)) ?? null}
              onClose={() => setProfileFor(null)}
              onSaved={changed}
            />
          )}
          {lifecycleFor && (
            <BankLifecycleModal
              open
              companyId={companyId}
              bank={lifecycleFor.bank}
              accountNumber={lifecycleFor.accountNumber}
              title={lifecycleFor.label}
              lifecycle={lifecycleFor.lifecycle as BankAccountLifecycle | null}
              onClose={() => setLifecycleFor(null)}
              onSaved={changed}
            />
          )}
          {month && (
            <MonthModal
              account={result.banks.flatMap((b) => b.accounts).find((a) => a.key === month.account.key) ?? month.account}
              month={month.month}
              companyId={companyId}
              year={selection.year}
              data={bank.data}
              result={result}
              onClose={() => setMonth(null)}
              onChanged={changed}
              onProfile={(name) => setProfileFor(name)}
              toastError={(e) => toast(errorMessage(e), "error")}
            />
          )}
        </>
      )}
    </>
  );
}

function Legend() {
  return (
    <div className="row" style={{ gap: 16, flexWrap: "wrap", padding: "var(--space-3) var(--space-5)", fontSize: 12.5 }}>
      <span className="row" style={{ gap: 4 }}>
        <span className="fs-coverage__cell is-loaded">
          <Check size={14} />
        </span>
        Cargado y vigente
      </span>
      <span className="row" style={{ gap: 4 }}>
        <span className="fs-coverage__cell has-replaced">
          <Minus size={14} />
        </span>
        Solo reemplazado o anulado
      </span>
      <span className="row" style={{ gap: 4 }}>
        <span className="fs-coverage__cell">
          <Minus size={14} />
        </span>
        Pendiente de importar
      </span>
      <span className="row" style={{ gap: 4 }}>
        <span className="fs-coverage__cell is-na">N/A</span>
        Cuenta no abierta o ya cerrada
      </span>
      <span className="row" style={{ gap: 4 }}>
        <span className="fs-coverage__cell is-balance-pending">
          <Minus size={14} />
        </span>
        Con pendiente que bloquea 1012, 1007 o 1011
      </span>
    </div>
  );
}

function AccountCell({ cell, label, onOpen }: { cell: MonthCell; label: string; onOpen: () => void }) {
  const state = cell.state === "loaded" ? "is-loaded" : cell.state === "na" ? "is-na" : "";
  const blocked = cell.blocks.length > 0;
  return (
    <button
      type="button"
      className={`fs-coverage__cell ${state}${cell.history.length > 0 && cell.state !== "na" ? " has-replaced" : ""}${blocked ? " is-balance-pending" : ""}`}
      onClick={onOpen}
      title={`${STATUS_TEXT[cell.state]}${blocked ? ` · bloquea ${cell.blocks.join(", ")}` : ""}`}
      aria-label={`${label} ${periodLabel(cell.month)}: ${STATUS_TEXT[cell.state].toLowerCase()}${blocked ? `; bloquea ${cell.blocks.join(", ")}` : ""}`}
    >
      {cell.state === "loaded" ? <Check size={14} /> : cell.state === "na" ? "N/A" : <Minus size={14} />}
    </button>
  );
}

/** Mes del banco: cuántas de sus cuentas lo tienen vigente. */
function BankMonth({ bank, month }: { bank: BankModel; month: string }) {
  const cells = bank.accounts.map((a) => a.cells.find((c) => c.month === month)!);
  const applicable = cells.filter((c) => c.applicable);
  const loaded = applicable.filter((c) => c.state === "loaded").length;
  const blocked = cells.some((c) => c.blocks.length > 0);
  if (applicable.length === 0) return <span className="fs-coverage__cell is-na">N/A</span>;
  const cls = loaded === applicable.length ? "is-loaded" : loaded > 0 ? "is-partial" : "";
  return (
    <span className={`fs-coverage__cell ${cls}${blocked ? " is-balance-pending" : ""}`} title={`${loaded} de ${applicable.length} cuentas con extracto vigente en ${periodLabel(month).toLowerCase()}`}>
      {loaded === applicable.length ? <Check size={14} /> : loaded > 0 ? <span className="fs-coverage__count">{loaded}/{applicable.length}</span> : <Minus size={14} />}
    </span>
  );
}

function BankSummary({ bank, onProfile }: { bank: BankModel; onProfile: () => void }) {
  const c = COVERAGE_TEXT[bank.coverage];
  return (
    <div className="stack stack--sm" style={{ alignItems: "flex-start" }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <Badge tone={c.tone}>{c.text}</Badge>
        <span className="muted">
          {bank.loadedMonths}/{bank.expectedMonths} meses
        </span>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {BANK_EXO_FORMATS.map((f) => (
          <Badge key={f} tone={bank.blocks.includes(f) ? "danger" : "success"}>
            {f} {bank.blocks.includes(f) ? "bloqueado" : "ok"}
          </Badge>
        ))}
        {!bank.profile && (
          <Button size="sm" variant="primary" onClick={onProfile}>
            Crear ficha
          </Button>
        )}
      </div>
    </div>
  );
}

function AccountSummary({ account, year }: { account: AccountModel; year: number }) {
  const dec = account.december;
  const text =
    dec.state === "value"
      ? `Dic ${year}: ${formatExactCents(dec.balanceCents!)}`
      : dec.state === "closed"
        ? `Cerrada: no genera saldo al 31-12`
        : dec.state === "not-open"
          ? "Aún no abierta al 31-12"
          : dec.state === "missing"
            ? `Falta diciembre ${year}`
            : dec.state === "review"
              ? "Saldo de diciembre por revisar"
              : dec.state === "excluded"
                ? "Saldo de diciembre excluido"
                : "Diciembre sin saldo final";
  const bad = ["missing", "review", "no-balance"].includes(dec.state);
  return <span className={bad ? "fs-coverage__pending" : "muted"}>{text}</span>;
}

interface MonthProps {
  account: AccountModel;
  month: string;
  companyId: number;
  year: number;
  data: NonNullable<ReturnType<typeof useBankExo>["data"]>;
  result: NonNullable<ReturnType<typeof useBankExo>["contribution"]>["result"];
  onClose: () => void;
  onChanged: () => void | Promise<unknown>;
  onProfile: (bank: string) => void;
  toastError: (e: unknown) => void;
}

/**
 * Un mes de una cuenta: el extracto que lo originó, su estado y sus valores relevantes (saldo final, intereses y GMF), el
 * historial de reemplazos, los conceptos con su clasificación de interés y GMF y los pendientes de ese mes.
 */
function MonthModal({ account, month, companyId, year, data, result, onClose, onChanged, onProfile, toastError }: MonthProps) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const cell = account.cells.find((c) => c.month === month)!;
  const gmfRules = useMemo(() => new Map(data.gmfRules.map((r) => [gmfRuleKey(r.bank, r.concept), r])), [data.gmfRules]);
  const interestRules = useMemo(() => new Map(data.interestRules.map((r) => [interestRuleKey(r.bank, r.concept), r])), [data.interestRules]);
  const profile = data.profiles.find((p) => p.bankKey === account.bankKey);
  const alerts = result.alerts.filter((a) => a.ref?.bank === account.bank && (a.ref.account === undefined || (a.ref.account === account.accountNumber && a.ref.month === month)));
  const statements = [...cell.active, ...cell.history].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  async function saveRule(kind: "gmf" | "interest", description: string, value: boolean, current: string) {
    setBusy(`${kind}:${description}`);
    try {
      const origin = value && current === "suggested" ? "auto" : "manual";
      if (kind === "gmf") await fsService.saveGmfRule(account.bank, description, value, origin);
      else await fsService.saveInterestRule(account.bank, description, value, origin);
      toast(kind === "gmf" ? (value ? `«${description}» se tratará como GMF.` : `«${description}» no se tratará como GMF.`) : value ? `«${description}» se tratará como interés generado.` : `«${description}» no se tratará como interés.`);
      await onChanged();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      size="xl"
      title={`${account.bank} ${maskAccount(account.accountNumber)} · ${periodLabel(month)}`}
      description={`${STATUS_TEXT[cell.state]}${cell.blocks.length ? ` · bloquea ${cell.blocks.join(", ")}` : ""}`}
      onClose={onClose}
      footer={
        <>
          {!profile && (
            <Button variant="primary" onClick={() => onProfile(account.bank)}>
              Crear ficha de {account.bank}
            </Button>
          )}
          <Button onClick={() => navigate(bankImportPath(account.bank))}>Importar extracto de {account.bank}</Button>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </>
      }
    >
      <div className="stack">
        {alerts.length > 0 && (
          <div className="stack stack--sm">
            {alerts.map((a) => (
              <BankExoAlertRow key={a.id} alert={a} companyId={companyId} year={year} onChanged={onChanged} />
            ))}
          </div>
        )}
        {statements.length === 0 ? (
          <EmptyState icon={<Landmark size={20} />} title={cell.state === "na" ? "La cuenta no se espera este mes" : "Sin extracto importado"} description={cell.state === "na" ? "La cuenta aún no estaba abierta o ya estaba cerrada según lo registrado." : "Importa el extracto de este mes desde el lector del banco."} />
        ) : (
          <div className="table-wrap">
            <table className="table table--dense">
              <thead>
                <tr>
                  <th>Extracto</th>
                  <th>Estado</th>
                  <th>Periodo</th>
                  <th>Importado</th>
                  <th className="num">Saldo final</th>
                  <th className="num">Intereses</th>
                  <th className="num">GMF neto</th>
                  <th>Reemplazó / reemplazado por</th>
                </tr>
              </thead>
              <tbody>
                {statements.map((s) => {
                  const current = s.status === "active";
                  const interest = current ? cell.interestCents : null;
                  const gmf = current ? cell.gmfCents : null;
                  return (
                    <tr key={s.batchId} className={current ? undefined : "muted"}>
                      <td>
                        {s.fileName || "—"} <span className="muted">· lote #{s.batchId}</span>
                      </td>
                      <td>
                        <Badge tone={current ? "success" : s.status === "replaced" ? "warning" : "neutral"}>{BATCH_STATUS[s.status]}</Badge>
                      </td>
                      <td>
                        {formatIsoDate(s.periodStart)} a {formatIsoDate(s.periodEnd)}
                      </td>
                      <td>{formatDateTimeForDisplay(s.createdAt)}</td>
                      <td className="num">{s.closingBalanceCents === null ? "—" : formatExactCents(s.closingBalanceCents)}</td>
                      <td className="num">{s.payload === null ? <span className="muted">sin datos</span> : interest === null ? "—" : formatExactCents(interest)}</td>
                      <td className="num">{s.payload === null ? <span className="muted">sin datos</span> : gmf === null ? "—" : formatExactCents(gmf)}</td>
                      <td>
                        {s.replacedBy ? `Reemplazado por #${s.replacedBy}` : ""}
                        {statements.filter((x) => x.replacedBy === s.batchId).map((x) => `Reemplazó #${x.batchId}`).join(", ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {cell.active.map((s) =>
          s.payload === null ? null : (
            <Card key={s.batchId} flush title={`Conceptos del extracto #${s.batchId}`} description="Un abono solo es interés y un cargo solo es GMF cuando lo confirmas por banco y concepto exacto; la decisión queda guardada.">
              <div className="table-wrap">
                <table className="table table--dense">
                  <thead>
                    <tr>
                      <th>Concepto</th>
                      <th>Tipo</th>
                      <th className="num">Cantidad</th>
                      <th className="num">Total</th>
                      <th>Interés generado (1007)</th>
                      <th>GMF / 4x1000 (1011)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.payload.concepts.map((c, i) => {
                      const gmf = gmfState(s.bank, c.description, gmfRules);
                      const interest = interestState(s.bank, c.description, c.dc, interestRules);
                      return (
                        <tr key={`${c.description}-${c.dc}-${i}`}>
                          <td className="selectable">{c.description}</td>
                          <td>{c.dc === "D" ? "Salida" : "Ingreso"}</td>
                          <td className="num">{formatInteger(c.count)}</td>
                          <td className="num">{formatExactCents(c.totalCents)}</td>
                          <td>
                            <RuleCell
                              state={interest}
                              confirmedText="Es interés"
                              suggestedText="Parece interés"
                              yes="Es interés"
                              no="No es interés"
                              disabled={busy !== null}
                              loading={busy === `interest:${c.description}`}
                              impossible={c.dc === "D" && interest === "none"}
                              onSet={(v) => void saveRule("interest", c.description, v, interest)}
                            />
                          </td>
                          <td>
                            <RuleCell
                              state={gmf}
                              confirmedText={`GMF · ${GMF_PERCENT} %`}
                              suggestedText="Parece GMF"
                              yes="Confirmar GMF"
                              no="Quitar GMF"
                              disabled={busy !== null}
                              loading={busy === `gmf:${c.description}`}
                              onSet={(v) => void saveRule("gmf", c.description, v, gmf)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ),
        )}
        <div className="muted">
          {profile ? `Informado en Exógena como ${profile.businessName} (NIT ${profile.nit}-${profile.dv}).` : "Este banco aún no tiene ficha para Exógena."} {lifecycleText(account.lifecycle)}
        </div>
      </div>
    </Modal>
  );
}

function RuleCell({
  state,
  confirmedText,
  suggestedText,
  yes,
  no,
  disabled,
  loading,
  impossible,
  onSet,
}: {
  state: "confirmed" | "rejected" | "suggested" | "none";
  confirmedText: string;
  suggestedText: string;
  yes: string;
  no: string;
  disabled: boolean;
  loading: boolean;
  /** Un concepto que no puede serlo (p. ej. una salida nunca es interés generado). */
  impossible?: boolean;
  onSet: (value: boolean) => void;
}) {
  if (impossible) return <span className="muted">—</span>;
  if (state === "confirmed")
    return (
      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
        <Badge tone="success">{confirmedText}</Badge>
        <Button size="sm" variant="ghost" loading={loading} disabled={disabled} onClick={() => onSet(false)}>
          Quitar
        </Button>
      </div>
    );
  if (state === "suggested")
    return (
      <div className="stack stack--sm" style={{ alignItems: "flex-start" }}>
        <Badge tone="warning">{suggestedText}</Badge>
        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          <Button size="sm" variant="primary" loading={loading} disabled={disabled} onClick={() => onSet(true)}>
            {yes}
          </Button>
          <Button size="sm" disabled={disabled} onClick={() => onSet(false)}>
            {no}
          </Button>
        </div>
      </div>
    );
  return (
    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
      {state === "rejected" && <span className="muted">No lo es</span>}
      <Button size="sm" variant="ghost" loading={loading} disabled={disabled} onClick={() => onSet(true)}>
        {yes}
      </Button>
    </div>
  );
}
