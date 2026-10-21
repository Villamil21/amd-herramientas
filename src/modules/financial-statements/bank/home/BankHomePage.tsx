import { Landmark, Pencil, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { navigate, paths } from "../../../../app/router";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Loader, Modal, PageHeader, useToast } from "../../../../components/ui";
import { fsService } from "../../../../services/fsService";
import { errorMessage } from "../../../../services/tauri";
import type { BankAccountLifecycle } from "../../../../types/fs";
import { formatDateTimeForDisplay } from "../../../../utils/dates";
import { ExogenaContextBar } from "../../../exogena/components/ExogenaContextBar";
import { useCompanies } from "../../../exogena/hooks";
import { useExogenaSelection } from "../../../exogena/state";
import { periodLabel, formatExactCents } from "../../shared/money";
import { useFsData } from "../../shared/useFsData";
import { BankLifecycleModal } from "../BankLifecycleModal";
import { gmfAccountingCents } from "../bankAccounting";
import { BANK_EXO_PATH, BANKS_PATH, type BankExoFocus } from "../exogena/paths";
import { bankKeyOf, type AccountModel } from "../exogena/model";
import { BankProfileModal } from "../exogena/ui/BankProfileModal";
import { formatNitDv } from "./format";
import { MONTH_STATUS_TEXT, MONTH_STATUS_TONE, monthTitle, type AccountMonth, type BankMonth } from "./model";
import { StatementDetail } from "./StatementDetail";
import { useBankHome } from "./useBankHome";

interface Props {
  bankId: string;
  bankName: string;
  focus?: BankExoFocus | null;
}

/**
 * Pantalla de un banco: ficha para Exógena, importación de un nuevo PDF y «Extractos por período» (cobertura de los 12 meses por
 * cuenta). Un mes con extracto abre su detalle persistido; no se pide reimportar ni reemplazar nada para revisar o editar.
 */
export default function BankHomePage({ bankId, bankName, focus }: Props) {
  const [selection, updateSelection] = useExogenaSelection();
  const { companies } = useCompanies();
  const data = useFsData();
  const companyId = selection.companyId;
  const year = selection.year;
  const h = useBankHome(bankName, companyId, year);
  const [monthOpen, setMonthOpen] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState<{ month: string; account: string } | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [lifecycleFor, setLifecycleFor] = useState<AccountModel | null>(null);
  const [expanded, setExpanded] = useState<"1007" | "1011" | null>(null);

  const importPath = `${BANKS_PATH}/${bankId}/importar`;
  const key = bankKeyOf(bankName);
  const profile = h.exo.data?.profiles.find((p) => p.bankKey === key) ?? null;

  // Un enlace desde un pendiente fija empresa y año y abre el mes exacto.
  useEffect(() => {
    if (focus && focus.kind !== "profile") updateSelection({ companyId: focus.companyId, year: focus.year });
  }, [focus, updateSelection]);
  useEffect(() => {
    if (!focus || !h.home) return;
    // El foco se consume una sola vez: la ruta vuelve a la del banco para que cerrar el mes no lo reabra.
    if (focus.kind === "profile") {
      setProfileOpen(true);
      return navigate(`${BANKS_PATH}/${bankId}`);
    }
    if (selection.companyId !== focus.companyId || selection.year !== focus.year) return;
    if (focus.kind === "month") setMonthOpen(focus.month);
    navigate(`${BANKS_PATH}/${bankId}`);
  }, [focus, h.home, selection.companyId, selection.year, bankId]);

  const month = h.home?.months.find((m) => m.month === monthOpen) ?? null;
  const openAccount = (m: BankMonth, a: AccountMonth) => (a.statement ? setAccountOpen({ month: m.month, account: a.account }) : undefined);
  const opened = useMemo(() => {
    if (!accountOpen || !h.home) return null;
    const m = h.home.months.find((x) => x.month === accountOpen.month);
    const a = m?.accounts.find((x) => x.account === accountOpen.account);
    return m && a?.statement ? { month: m, account: a, statement: a.statement } : null;
  }, [accountOpen, h.home]);

  function clickMonth(m: BankMonth) {
    if (m.accounts.length === 1 && m.accounts[0].statement) return setAccountOpen({ month: m.month, account: m.accounts[0].account });
    setMonthOpen(m.month);
  }

  return (
    <>
      <PageHeader
        eyebrow="Estados Financieros · Extractos bancarios"
        title={bankName}
        description="Extractos ya importados por período, su detalle guardado y lo que este banco aporta a Estados Financieros y a Exógena."
        actions={
          <Button variant="primary" icon={<Upload size={15} />} onClick={() => navigate(importPath)}>
            Importar nuevo PDF
          </Button>
        }
      />
      <ExogenaContextBar companies={companies} />
      {companyId === null ? (
        <Card>
          <EmptyState icon={<Landmark size={20} />} title="Selecciona una empresa" description={`Elige la empresa y el año para ver los extractos de ${bankName}.`} />
        </Card>
      ) : !h.ready || !h.home ? (
        <Loader />
      ) : (
        <>
          <Card title="Ficha del banco para Exógena" description="NIT y razón social del banco como informado en 1012 y 1007. Se configura una sola vez.">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                {profile ? (
                  <>
                    <strong>{profile.businessName}</strong> · NIT {formatNitDv(profile.nit, profile.dv)} <Badge tone="success">Completa</Badge>
                  </>
                ) : (
                  <>
                    <Badge tone="danger">Falta la ficha</Badge> <span className="muted">Sin ficha no se pueden enviar extractos de {bankName} a Estados Financieros ni informarlo en Exógena.</span>
                  </>
                )}
              </div>
              <Button icon={<Pencil size={14} />} onClick={() => setProfileOpen(true)}>
                {profile ? "Editar ficha" : "Crear ficha"}
              </Button>
            </div>
          </Card>

          <Card title="Extractos por período" description={`Año ${year}. Abre un mes para ver el extracto guardado, editar sus conceptos o importar el que falta.`}>
            <div className="bank-months">
              {h.home.months.map((m) => (
                <button key={m.month} type="button" className={`bank-month bank-month--${m.status}`} aria-label={m.text} title={m.text} onClick={() => clickMonth(m)}>
                  <span className="bank-month__title">{monthTitle(m.month)}</span>
                  <span className="bank-month__meta">{m.accounts.length === 1 && !h.home?.accounts.length ? "sin cuentas" : `${m.accounts.filter((a) => a.statement || a.status !== "na").length} ${m.accounts.filter((a) => a.statement || a.status !== "na").length === 1 ? "cuenta" : "cuentas"}`}</span>
                  <Badge tone={MONTH_STATUS_TONE[m.status]}>{MONTH_STATUS_TEXT[m.status]}</Badge>
                </button>
              ))}
            </div>
          </Card>

          <ExoSummary bankName={bankName} year={year} home={h.home} result={h.exo.contribution!.result} expanded={expanded} onExpand={setExpanded} onOpenMonth={(m) => setMonthOpen(m)} />

          <div className="row">
            <Button variant="ghost" onClick={() => navigate(BANK_EXO_PATH)}>
              Ver la cobertura de todos los bancos
            </Button>
          </div>

          {month && !opened && (
            <MonthModal
              month={month}
              companyId={companyId}
              bankName={bankName}
              importPath={importPath}
              accounts={h.home.accounts}
              onOpenAccount={(a) => openAccount(month, a)}
              onLifecycle={setLifecycleFor}
              onClose={() => setMonthOpen(null)}
              onChanged={h.refresh}
            />
          )}
          {opened && h.stored && (
            <StatementDetail
              statement={opened.statement}
              pending={h.stored.pending}
              log={h.stored.log}
              periods={h.stored.periods}
              exoInput={h.exoInput}
              data={data}
              onClose={() => setAccountOpen(null)}
              onChanged={h.refresh}
            />
          )}
          {profileOpen && <BankProfileModal open bank={bankName} profile={profile} onClose={() => setProfileOpen(false)} onSaved={h.refresh} />}
          {lifecycleFor && (
            <BankLifecycleModal
              open
              companyId={companyId}
              bank={lifecycleFor.bank}
              accountNumber={lifecycleFor.accountNumber}
              title={lifecycleFor.label}
              lifecycle={lifecycleFor.lifecycle as BankAccountLifecycle | null}
              onClose={() => setLifecycleFor(null)}
              onSaved={h.refresh}
            />
          )}
        </>
      )}
    </>
  );
}

function MonthModal({
  month: m,
  companyId,
  bankName,
  importPath,
  accounts,
  onOpenAccount,
  onLifecycle,
  onClose,
  onChanged,
}: {
  month: BankMonth;
  companyId: number;
  bankName: string;
  importPath: string;
  accounts: AccountModel[];
  onOpenAccount: (a: AccountMonth) => void;
  onLifecycle: (a: AccountModel) => void;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      setReasonFor(null);
      setReason("");
      await onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open size="lg" title={`${periodLabel(m.month)} · ${bankName}`} description={m.accounts.length > 1 ? "Elige la cuenta de este período." : undefined} onClose={onClose}>
      <div className="stack">
        {m.accounts.map((a) => {
          const model = accounts.find((x) => x.accountNumber === a.account);
          return (
            <div key={a.account} className="card" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{a.label}</strong>
                <Badge tone={MONTH_STATUS_TONE[a.status]}>{MONTH_STATUS_TEXT[a.status]}</Badge>
              </div>
              {a.statement && (
                <p className="muted">
                  {a.statement.fileName || "Extracto"} · importado {formatDateTimeForDisplay(a.statement.importedAt)} · saldo final {a.statement.closingBalanceCents === null ? "—" : formatExactCents(a.statement.closingBalanceCents)}
                </p>
              )}
              {a.reasons.map((r) => (
                <div key={r} className="muted">
                  {r}
                </div>
              ))}
              {a.status === "not-ended" && <p className="muted">Este mes aún no termina: todavía no se espera su extracto.</p>}
              {a.status === "missing" && !a.statement && <Alert tone="warning">El mes ya terminó, la cuenta está activa y no hay extracto vigente ni registro de «No aplica».</Alert>}
              <div className="row" style={{ marginTop: 8 }}>
                {a.statement && (
                  <Button variant="primary" onClick={() => onOpenAccount(a)}>
                    Abrir extracto
                  </Button>
                )}
                {(a.status === "missing" || (a.statement && a.status === "review")) && (
                  <Button icon={<Upload size={14} />} onClick={() => navigate(importPath)}>
                    Importar PDF
                  </Button>
                )}
                {a.status === "missing" && reasonFor !== a.account && <Button onClick={() => setReasonFor(a.account)}>Registrar «No aplica»</Button>}
                {a.na && (
                  <Button disabled={busy} onClick={() => void run(() => fsService.deleteBankMonthNa(companyId, bankName, a.account, m.month), "Se quitó el «No aplica» de este mes.")}>
                    Quitar «No aplica»
                  </Button>
                )}
                {model && (
                  <Button variant="ghost" onClick={() => onLifecycle(model)}>
                    Apertura / cierre de la cuenta
                  </Button>
                )}
              </div>
              {reasonFor === a.account && (
                <div className="row" style={{ marginTop: 8 }}>
                  <Field label="Por qué no aplica" required>
                    {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cuenta cerrada, período sin extracto…" />}
                  </Field>
                  <Button variant="primary" loading={busy} disabled={reason.trim() === ""} onClick={() => void run(() => fsService.saveBankMonthNa({ companyId, bank: bankName, accountNumber: a.account, month: m.month, reason }), "Mes registrado como «No aplica».")}>
                    Guardar
                  </Button>
                  <Button variant="ghost" onClick={() => setReasonFor(null)}>
                    Cancelar
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function ExoSummary({ bankName, year, home, result, expanded, onExpand, onOpenMonth }: { bankName: string; year: number; home: NonNullable<ReturnType<typeof useBankHome>["home"]>; result: NonNullable<ReturnType<typeof useBankHome>["exo"]["contribution"]>["result"]; expanded: "1007" | "1011" | null; onExpand: (v: "1007" | "1011" | null) => void; onOpenMonth: (m: string) => void }) {
  const key = bankKeyOf(bankName);
  const bank = home.bank;
  const interest = result.audit.f1007.find((r) => bankKeyOf(r.bank) === key);
  const gmf = result.audit.f1011.banks.find((b) => bankKeyOf(b.bank) === key);
  const dec = bank?.accounts.map((a) => a.december) ?? [];
  const december = bank?.decemberCents ?? null;
  const toFormat = (code: string) => navigate(paths.submodule("informacion-exogena", code));
  return (
    <Card title="Lo que este banco aporta a Exógena" description={`Año ${year}. Se calcula desde los extractos guardados.`}>
      <div className="bank-months">
        <div className="bank-month bank-month--sent" style={{ cursor: "default" }}>
          <span className="bank-month__title">1012 · Saldo al 31 de diciembre</span>
          <strong>{december === null ? (dec.some((d) => d.state === "missing") ? "Falta el extracto de diciembre" : "—") : formatExactCents(december)}</strong>
          <span className="row" style={{ gap: 4 }}>
            <Button size="sm" variant="ghost" onClick={() => onOpenMonth(`${year}-12`)}>
              Ver diciembre
            </Button>
            <Button size="sm" variant="ghost" onClick={() => toFormat("1012")}>
              Auditoría 1012
            </Button>
          </span>
        </div>
        <div className="bank-month bank-month--sent" style={{ cursor: "default" }}>
          <span className="bank-month__title">1007 · Intereses acumulados</span>
          <strong>{formatExactCents(bank?.interestCents ?? 0)}</strong>
          <span className="row" style={{ gap: 4 }}>
            <Button size="sm" variant="ghost" onClick={() => onExpand(expanded === "1007" ? null : "1007")}>
              {expanded === "1007" ? "Ocultar meses" : "Ver meses"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => toFormat("1007")}>
              Auditoría 1007
            </Button>
          </span>
        </div>
        <div className="bank-month bank-month--sent" style={{ cursor: "default" }}>
          <span className="bank-month__title">1011 · GMF acumulado</span>
          <strong>
            {formatExactCents(bank?.gmfCents ?? 0)} → {formatExactCents(gmfAccountingCents(bank?.gmfCents ?? 0))} (50 %)
          </strong>
          <span className="row" style={{ gap: 4 }}>
            <Button size="sm" variant="ghost" onClick={() => onExpand(expanded === "1011" ? null : "1011")}>
              {expanded === "1011" ? "Ocultar meses" : "Ver meses"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => toFormat("1011")}>
              Auditoría 1011
            </Button>
          </span>
        </div>
      </div>
      {expanded && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table table--dense">
            <thead>
              <tr>
                <th>Mes</th>
                <th className="num">{expanded === "1007" ? "Intereses" : "GMF del extracto"}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(expanded === "1007" ? (interest?.months ?? []).map((m) => ({ month: m.month, cents: m.cents })) : (gmf?.months ?? []).map((m) => ({ month: m.month, cents: m.grossCents }))).map((m) => (
                <tr key={m.month}>
                  <td>{periodLabel(m.month)}</td>
                  <td className="num">{formatExactCents(m.cents)}</td>
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => onOpenMonth(m.month)}>
                      Abrir mes
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ marginTop: 8 }}>
        El 1011 aplica el 50 % una sola vez sobre el GMF de todos los bancos y redondea una vez: el 50 % de aquí es solo la parte de este banco.
      </p>
    </Card>
  );
}
