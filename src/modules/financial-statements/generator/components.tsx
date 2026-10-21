import { Fragment, useEffect, useRef, useState } from "react";
import { CalendarRange, Check, ChevronDown, ChevronRight, Minus } from "lucide-react";
import { Alert, Badge, Button, DateInput, Field, Input, Loader, Modal, Select, Textarea, useToast } from "../../../components/ui";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import { EMPTY_PERIOD_LABEL, isEmptyPeriodBatch, type Adjustment, type AdjustmentType, type BatchSummary, type EmptyPeriodSource, type FsPucMapping } from "../../../types/fs";
import { formatInteger } from "../../../utils/format";
import { parseNumericText } from "../../../utils/numbers";
import type { PucIndex } from "../puc-codes/services/pucCatalog";
import { PucField } from "../shared/components/PucField";
import { formatExactCents, formatIsoDate, formatStatementPesos, periodLabel } from "../shared/money";
import { navigate, paths } from "../../../app/router";
import { StatusBadge as TaxStatusBadge } from "../tax-obligations/components";
import { paidCents, pendingCents, periodName, taxStatus } from "../tax-obligations/services/effects";
import { PERIODICITY_LABEL, type TaxReturn, type VatPeriodicity } from "../tax-obligations/types";
import { maskAccount, monthText, type BankAccountCoverage, type BankCell, type BankCoverage, type CoverageRow, type TaxCoverage } from "./checks";
import type { LineValue, StatementRow } from "./engine";
import { BankLifecycleModal, lifecycleText } from "../bank/BankLifecycleModal";
import { formatDateForDisplay } from "../../../utils/dates";
import type { CryptoMonthCell } from "../crypto/coverageSource";
import { openCryptoMonth } from "../crypto/selection";

/** Estado en la app: valores al millar (como en el PDF) y, al abrir una línea, el exacto y su origen por PUC. */
export function StatementView({ title, rows, lines }: { title: string; rows: StatementRow[]; lines: Map<number, LineValue> }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="fs-statement">
      <div className="fs-statement__title">{title}</div>
      <table className="table fs-statement__table">
        <thead>
          <tr>
            <th />
            <th style={{ width: 56, textAlign: "center" }}>NOTA</th>
            <th style={{ width: 130, textAlign: "right" }}>Valor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            if (r.kind === "gap") return <tr key={i} className="fs-row--gap"><td colSpan={3} /></tr>;
            // Títulos y encabezados usan todo el ancho; totales y resultados, el ancho de Concepto + NOTA. Solo las cuentas llevan NOTA.
            // El encabezado de un grupo con nota lleva el número en la columna NOTA (una sola vez por grupo).
            if (r.kind === "header" && r.note !== undefined)
              return (
                <tr key={i} className="fs-row--header">
                  <td>{r.label}</td>
                  <td style={{ textAlign: "center" }}>{r.note}</td>
                  <td />
                </tr>
              );
            if (r.kind === "title" || r.kind === "header")
              return (
                <tr key={i} className={`fs-row--${r.kind}`}>
                  <td colSpan={3}>{r.label}</td>
                </tr>
              );
            const detail = r.lineId !== undefined ? lines.get(r.lineId) : undefined;
            const negative = r.pesos !== undefined && r.pesos < 0;
            return (
              <Fragment key={i}>
                <tr
                  className={`fs-row--${r.kind}${r.kind === "result" && negative ? " is-negative" : ""}${detail ? " is-clickable" : ""}`}
                  onClick={detail ? () => setOpen(open === r.lineId ? null : r.lineId!) : undefined}
                  title={r.cents !== undefined ? `Exacto: ${formatExactCents(r.cents)}` : undefined}
                >
                  {r.kind === "line" ? (
                    <>
                      <td>{r.label}</td>
                      <td style={{ textAlign: "center" }}>{r.note ?? ""}</td>
                    </>
                  ) : (
                    <td colSpan={2}>{r.label}</td>
                  )}
                  <td style={{ textAlign: "right" }} className={negative ? "amount--negative" : undefined}>
                    {r.pesos !== undefined ? formatStatementPesos(r.pesos) : ""}
                  </td>
                </tr>
                {detail && open === r.lineId && (
                  <tr className="fs-row--detail">
                    <td colSpan={3}>
                      <div className="stack stack--sm">
                        <span className="muted">Exacto: {formatExactCents(detail.cents)}{detail.automatic ? ` · Automático: ${detail.automatic}` : ""}</span>
                        {detail.contributions.map((c, n) => (
                          <span key={`${c.pucCode}-${n}`} className="muted">
                            <span className="mono">{c.pucCode}</span> {c.concept} · {formatInteger(c.count)} mov. · {formatExactCents(c.cents)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const monthName = (m: string) => periodLabel(m).split(" ")[0];
const shortMonth = (m: string) => `${periodLabel(m).slice(0, 3)} ${m.slice(2, 4)}`;
const plural = (n: number, one: string, many: string) => `${formatInteger(n)} ${n === 1 ? one : many}`;

/** Contexto del detalle de un mes: qué fila se abrió (fuente, extractos, banco o cuenta). */
type CoverageSelection =
  | { kind: "source"; row: CoverageRow; month: string }
  | { kind: "bank"; title: string; cell: BankCell; month: string }
  | { kind: "tax"; title: string; returns: TaxReturn[]; taxPath: string };

/**
 * Fuentes del periodo y cobertura mensual: ✓ cargado / — falta. Clic en un mes: sus importaciones.
 * Los extractos se despliegan por banco y, si un banco tiene varias cuentas, por cuenta.
 */
export function CoverageTable({
  months,
  rows,
  companyName,
  tax,
  cut,
  companyId,
  onLifecycleChanged,
  cryptoOps,
}: {
  months: string[];
  rows: CoverageRow[];
  companyName: string;
  tax?: TaxCoverage;
  /** Fecha de corte del periodo: estado y pagos de las declaraciones a esa fecha. */
  cut?: string;
  companyId?: number | null;
  onLifecycleChanged?: () => void | Promise<unknown>;
  /** Reporte de operaciones (Transacciones Cripto) por mes; clic en un mes abre ese módulo con empresa, año y mes. */
  cryptoOps?: Record<string, CryptoMonthCell>;
}) {
  const [selected, setSelected] = useState<CoverageSelection | null>(null);
  const [editing, setEditing] = useState<BankAccountCoverage | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const sourceCells = (r: CoverageRow) =>
    months.map((m) => {
      const c = r.cells[m];
      // Fuente no mensual: un mes sin datos no falta (se muestra neutro).
      const neutral = !c.loaded && !!r.notMonthly;
      return (
        <td key={m} style={{ textAlign: "center" }}>
          <button
            type="button"
            className={`fs-coverage__cell ${c.loaded ? "is-loaded" : neutral ? "is-na" : ""}${c.emptyDeclared ? " fs-coverage__cell--wide is-empty-period" : ""}`}
            onClick={() => setSelected({ kind: "source", row: r, month: m })}
            title={neutral ? (r.source === "opening" ? "Saldo inicial: foto de apertura, no se espera cada mes" : "Los ajustes son puntuales: no se esperan cada mes") : undefined}
            aria-label={`${r.label} ${periodLabel(m)}: ${c.emptyDeclared ? EMPTY_PERIOD_LABEL[r.source as EmptyPeriodSource].toLowerCase() : c.loaded ? "cargado" : neutral ? "no se espera mensualmente" : "falta"}`}
          >
            {c.loaded ? <Check size={14} /> : <Minus size={14} />}
            {c.emptyDeclared && <span className="fs-coverage__empty">{EMPTY_PERIOD_LABEL[r.source as EmptyPeriodSource]}</span>}
          </button>
        </td>
      );
    });

  const cryptoOpsRow = () => {
    const cells = cryptoOps ?? {};
    const missing = months.filter((m) => !cells[m]?.loaded);
    return (
      <tr key="crypto-ops">
        <td>
          Reporte de operaciones
          {missing.length > 0 && missing.length < months.length && <div className="table__secondary">Faltan: {missing.map(monthName).join(", ")}</div>}
        </td>
        {months.map((m) => {
          const c = cells[m];
          const loaded = !!c?.loaded;
          return (
            <td key={m} style={{ textAlign: "center" }}>
              <button
                type="button"
                className={`fs-coverage__cell ${loaded ? "is-loaded" : ""}`}
                disabled={companyId == null}
                onClick={() => companyId != null && openCryptoMonth(companyId, m)}
                title={c?.pending ? `${plural(c.pending, "fila pendiente", "filas pendientes")} de resolver` : undefined}
                aria-label={`Reporte de operaciones ${periodLabel(m)}: ${loaded ? "cargado" : "falta"}. Abrir Reporte de operaciones de ${monthText(m)}`}
              >
                {loaded ? <Check size={14} /> : <Minus size={14} />}
              </button>
            </td>
          );
        })}
      </tr>
    );
  };

  const finalMonth = months[months.length - 1];
  /** `balancePending`: la cuenta no tiene saldo del mes final (el ESF queda pendiente). */
  const bankCells = (title: string, cells: Record<string, BankCell>, balancePending = false) =>
    months.map((m) => {
      const c = cells[m];
      const pendingHere = balancePending && m === finalMonth;
      const state = c.total > 0 && c.loaded === c.total ? "is-loaded" : c.loaded > 0 ? "is-partial" : c.total === 0 && c.notApplicable > 0 ? "is-na" : "";
      const label = state === "is-loaded" ? "cargado" : state === "is-partial" ? `${c.loaded} de ${c.total} cuentas` : state === "is-na" ? "no aplica" : "falta";
      return (
        <td key={m} style={{ textAlign: "center" }}>
          <button
            type="button"
            className={`fs-coverage__cell ${state}${c.hasReplaced ? " has-replaced" : ""}${pendingHere ? " is-balance-pending" : ""}`}
            onClick={() => setSelected({ kind: "bank", title, cell: c, month: m })}
            title={
              pendingHere
                ? `Saldo del ESF de ${monthText(m)} pendiente`
                : state === "is-na"
                  ? "No aplica: la cuenta aún no estaba abierta o ya estaba cerrada"
                  : c.hasReplaced
                    ? "Incluye un extracto reemplazado"
                    : undefined
            }
            aria-label={`${title} ${periodLabel(m)}: ${label}${c.hasReplaced ? ", con reemplazo" : ""}${pendingHere ? ", saldo final pendiente" : ""}`}
          >
            {state === "is-loaded" ? (
              <Check size={14} />
            ) : state === "is-partial" ? (
              <span className="fs-coverage__count">
                {c.loaded}/{c.total}
              </span>
            ) : state === "is-na" ? (
              "N/A"
            ) : (
              <Minus size={14} />
            )}
          </button>
        </td>
      );
    });

  const accountStatus = (a: BankAccountCoverage) => (
    <>
      <div className="table__secondary">
        {a.missing.length ? `Faltan: ${a.missing.map(monthName).join(", ")}` : "Cobertura completa"}
        {a.lastMonth ? ` · Último: ${shortMonth(a.lastMonth)}` : ""}
      </div>
      {a.finalBalanceMissing && finalMonth && <div className="fs-coverage__pending">Saldo del ESF de {monthText(finalMonth)} pendiente</div>}
      {(lifecycleText(a.lifecycle) || (companyId != null && onLifecycleChanged)) && (
        <div className="fs-coverage__lifecycle row" style={{ gap: 6 }}>
          {lifecycleText(a.lifecycle) && <span>{lifecycleText(a.lifecycle)}</span>}
          {companyId != null && onLifecycleChanged && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(a)} title="Registrar o corregir la apertura y el cierre de esta cuenta">
              <CalendarRange size={13} /> Apertura / cierre
            </button>
          )}
        </div>
      )}
    </>
  );

  const chevron = (isOpen: boolean) => (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />);

  const bankRows = (r: CoverageRow, bank: BankCoverage) => {
    const isOpen = open.has("bank");
    const out = [
      <tr key={r.source} className="fs-coverage__group">
        <td>
          {bank.banks.length ? (
            <button type="button" className="fs-coverage__toggle" onClick={() => toggle("bank")} aria-expanded={isOpen}>
              {chevron(isOpen)}
              {r.label}
            </button>
          ) : (
            r.label
          )}
          {bank.banks.length > 0 && (
            <div className="table__secondary">
              {bank.missingCount === 0
                ? `${bank.finalBalanceMissing ? "Extractos" : "Completo"} · ${plural(bank.banks.reduce((n, b) => n + b.accounts.length, 0), "cuenta", "cuentas")}`
                : `${plural(bank.missingCount, "mes pendiente", "meses pendientes")} en ${plural(bank.accountsWithMissing, "cuenta", "cuentas")}`}
            </div>
          )}
          {bank.finalBalanceMissing > 0 && finalMonth && (
            <div className="fs-coverage__pending">
              Saldo de {monthText(finalMonth)} pendiente en {plural(bank.finalBalanceMissing, "cuenta", "cuentas")}
            </div>
          )}
        </td>
        {bank.banks.length ? bankCells(r.label, bank.cells, bank.finalBalanceMissing > 0) : sourceCells(r)}
      </tr>,
    ];
    if (!isOpen) return out;
    for (const b of bank.banks) {
      if (b.accounts.length === 1) {
        const a = b.accounts[0];
        const title = `${b.bank} ${maskAccount(a.accountNumber)}`;
        out.push(
          <tr key={a.key} className="fs-coverage__bank">
            <td>
              {b.bank} <span className="mono muted">{maskAccount(a.accountNumber)}</span>
              {accountStatus(a)}
            </td>
            {bankCells(title, a.cells, a.finalBalanceMissing)}
          </tr>,
        );
        continue;
      }
      const bankOpen = open.has(`bank:${b.bank}`);
      out.push(
        <tr key={b.bank} className="fs-coverage__bank">
          <td>
            <button type="button" className="fs-coverage__toggle" onClick={() => toggle(`bank:${b.bank}`)} aria-expanded={bankOpen}>
              {chevron(bankOpen)}
              {b.bank}
            </button>
            <div className="table__secondary">
              {plural(b.accounts.length, "cuenta", "cuentas")} · {b.missingCount ? plural(b.missingCount, "mes pendiente", "meses pendientes") : "Cobertura completa"}
            </div>
          </td>
          {bankCells(b.bank, b.cells, b.accounts.some((a) => a.finalBalanceMissing))}
        </tr>,
      );
      if (bankOpen)
        for (const a of b.accounts)
          out.push(
            <tr key={a.key} className="fs-coverage__account">
              <td>
                <span className="mono">{maskAccount(a.accountNumber)}</span>
                {accountStatus(a)}
              </td>
              {bankCells(`${b.bank} ${maskAccount(a.accountNumber)}`, a.cells, a.finalBalanceMissing)}
            </tr>,
          );
    }
    return out;
  };

  const title = !selected ? "" : selected.kind === "source" ? `${selected.row.label} · ${periodLabel(selected.month)}` : selected.kind === "tax" ? `${companyName} · ${selected.title}` : `${companyName} · ${selected.title} · ${periodLabel(selected.month)}`;

  /** Obligaciones tributarias: cada impuesto con su periodicidad (mes, periodo de IVA, año). */
  const taxRows = (t: TaxCoverage) => {
    const isOpen = open.has("tax");
    const total = t.counts.withholding + t.counts.vat + t.counts.income;
    const pick = (title: string, returns: TaxReturn[], provider: string) => setSelected({ kind: "tax", title, returns, taxPath: paths.provider("estados-financieros", "obligaciones-tributarias", provider) });
    const mark = (ok: boolean, label: string, onClick: () => void, extra = "") => (
      <button type="button" className={`fs-coverage__cell fs-coverage__cell--wide ${ok ? "is-loaded" : ""}`} onClick={onClick} aria-label={`${label}: ${ok ? "declarada" : "sin declaración"}`}>
        {extra}
        {ok ? <Check size={14} /> : <Minus size={14} />}
      </button>
    );
    const out = [
      <tr key="tax" className="fs-coverage__group">
        <td>
          <button type="button" className="fs-coverage__toggle" onClick={() => toggle("tax")} aria-expanded={isOpen}>
            {chevron(isOpen)}
            Obligaciones tributarias
          </button>
          <div className="table__secondary">{total ? `Retefuente ${t.counts.withholding} · IVA ${t.counts.vat} · Renta ${t.counts.income}` : "Sin declaraciones registradas"}</div>
        </td>
        <td colSpan={months.length} className="muted" style={{ textAlign: "center" }}>
          {isOpen ? "" : "Retefuente por mes · IVA por periodo · Renta por año"}
        </td>
      </tr>,
    ];
    if (!isOpen) return out;
    out.push(
      <tr key="tax-withholding" className="fs-coverage__bank">
        <td>Retención en la fuente</td>
        {months.map((m) => (
          <td key={m} style={{ textAlign: "center" }}>
            {mark(t.withholding[m].length > 0 || t.empty.has(`withholding:${m}`), `Retefuente ${periodLabel(m)}`, () => pick(`Retención en la fuente · ${periodLabel(m)}`, t.withholding[m], "retencion-en-la-fuente"))}
          </td>
        ))}
      </tr>,
      <tr key="tax-vat" className="fs-coverage__bank">
        <td>
          IVA
          <div className="table__secondary">{t.vat.periodicity ? PERIODICITY_LABEL[t.vat.periodicity] : "Periodicidad sin configurar"}</div>
        </td>
        {t.vat.periods.length === 0 ? (
          <td colSpan={months.length} className="muted" style={{ textAlign: "center" }}>
            Configura la periodicidad de IVA de la empresa en Obligaciones tributarias → IVA.
          </td>
        ) : (
          t.vat.periods.map((p) => {
            const name = periodName({ taxType: "vat", year: p.year, period: p.period, periodicity: t.vat.periodicity! });
            return (
              <td key={p.key} colSpan={p.months.length} style={{ textAlign: "center" }}>
                {mark(p.returns.length > 0 || t.empty.has(`vat:${t.vat.periodicity}:${p.key}`), `IVA ${name}`, () => pick(`IVA · ${name}`, p.returns, "iva"), `P${p.period} `)}
              </td>
            );
          })
        )}
      </tr>,
      <tr key="tax-income" className="fs-coverage__bank">
        <td>Renta</td>
        <td colSpan={months.length}>
          {t.income.length === 0 ? (
            <span className="muted">Sin declaraciones de renta.</span>
          ) : (
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              {t.income.map((y) => (
                <span key={y.year}>{mark(y.returns.length > 0 || t.empty.has(`income:${y.year}`), `Renta ${y.year}`, () => pick(`Renta · año gravable ${y.year}`, y.returns, "renta"), `${y.year} `)}</span>
              ))}
            </div>
          )}
        </td>
      </tr>,
    );
    return out;
  };
  return (
    <>
      <div className="table-wrap">
        <table className="table fs-coverage">
          <thead>
            <tr>
              <th>Fuente</th>
              {months.map((m) => (
                <th key={m} style={{ textAlign: "center" }}>
                  {shortMonth(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
              r.bank ? (
                <Fragment key={r.source}>
                  {bankRows(r, r.bank)}
                  {cryptoOpsRow()}
                </Fragment>
              ) : (
                <tr key={r.source}>
                  <td>
                    {r.label}
                    {!r.empty && r.missing.length > 0 && <div className="table__secondary">Faltan: {r.missing.map(monthName).join(", ")}</div>}
                    {r.notMonthly && r.source === "opening" && (
                      <div className="table__secondary">{r.notMonthly.snapshotDates.length ? `Apertura: ${r.notMonthly.snapshotDates.map((d) => formatDateForDisplay(d)).join(", ")}` : "Sin saldo inicial"}</div>
                    )}
                  </td>
                  {sourceCells(r)}
                </tr>
              ),
            )}
            {!rows.some((r) => r.bank) && cryptoOpsRow()}
            {tax && taxRows(tax)}
          </tbody>
        </table>
      </div>
      <Modal open={selected !== null} title={title} onClose={() => setSelected(null)} size={selected?.kind === "bank" ? "xl" : "lg"}>
        {selected?.kind === "source" &&
          (selected.row.cells[selected.month].batches.length === 0 ? <p className="muted">No hay información de este mes.</p> : <BatchTable batches={selected.row.cells[selected.month].batches} />)}
        {selected?.kind === "bank" && <BankStatementTable cell={selected.cell} />}
        {selected?.kind === "tax" && <TaxReturnsTable returns={selected.returns} vatPeriodicity={tax?.vatPeriodicity ?? null} path={selected.taxPath} cut={cut} />}
      </Modal>
      {companyId != null && onLifecycleChanged && (
        <BankLifecycleModal
          open={editing !== null}
          companyId={companyId}
          bank={editing?.bank ?? ""}
          accountNumber={editing?.accountNumber ?? ""}
          title={editing ? `${editing.bank} ${maskAccount(editing.accountNumber)}` : ""}
          lifecycle={editing?.lifecycle ?? null}
          onClose={() => setEditing(null)}
          onSaved={onLifecycleChanged}
        />
      )}
    </>
  );
}

/** Declaraciones de una celda de la cobertura tributaria, con acceso al submódulo. */
function TaxReturnsTable({ returns, vatPeriodicity, path, cut }: { returns: TaxReturn[]; vatPeriodicity: VatPeriodicity | null; path: string; cut?: string }) {
  return (
    <div className="stack stack--sm">
      {returns.length === 0 ? (
        <p className="muted">No hay declaración registrada.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Formulario</th>
                <th style={{ textAlign: "right" }}>Saldo a pagar</th>
                <th style={{ textAlign: "right" }}>Saldo a favor</th>
                <th style={{ textAlign: "right" }}>{cut ? "Pagado al corte" : "Pagado"}</th>
                <th style={{ textAlign: "right" }}>{cut ? "Pendiente al corte" : "Pendiente"}</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{periodName(r)}</td>
                  <td className="mono">{r.formNumber || "—"}</td>
                  <td className="nowrap" style={{ textAlign: "right" }}>{formatExactCents(r.payableCents)}</td>
                  <td className="nowrap" style={{ textAlign: "right" }}>{formatExactCents(r.favorCents)}</td>
                  <td className="nowrap" style={{ textAlign: "right" }}>{formatExactCents(paidCents(r, cut))}</td>
                  <td className="nowrap" style={{ textAlign: "right" }}>{formatExactCents(pendingCents(r, cut))}</td>
                  <td>
                    <TaxStatusBadge status={taxStatus(r, vatPeriodicity, cut)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <Button size="sm" onClick={() => navigate(path)}>
          Abrir Obligaciones tributarias
        </Button>
      </div>
    </div>
  );
}

/** Extractos de un mes (activos y reemplazados): la cobertura solo cuenta el activo, el historial queda aquí. */
function BankStatementTable({ cell }: { cell: BankCell }) {
  if (cell.statements.length === 0) return <p className="muted">No hay extractos de este mes.</p>;
  const sorted = [...cell.statements].sort((a, b) => a.bank.localeCompare(b.bank) || a.accountNumber.localeCompare(b.accountNumber) || b.batch.id - a.batch.id);
  return (
    <div className="stack stack--sm">
      {cell.total > 1 && (
        <span className="muted">
          {cell.loaded} de {cell.total} cuentas con extracto activo este mes.
        </span>
      )}
      <div className="table-wrap">
        <table className="table fs-coverage-detail">
          <thead>
            <tr>
              <th>Banco</th>
              <th>Cuenta</th>
              <th>Periodo</th>
              <th>Archivo / lote</th>
              <th>Importado</th>
              <th style={{ textAlign: "right" }}>Movimientos</th>
              <th>Estado</th>
              <th style={{ textAlign: "right" }}>Saldo final</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.batch.id}>
                <td>{s.bank}</td>
                <td className="mono">{s.accountNumber || "—"}</td>
                <td className="nowrap">{s.batch.periodStart && s.batch.periodEnd ? `${formatIsoDate(s.batch.periodStart)} a ${formatIsoDate(s.batch.periodEnd)}` : "—"}</td>
                <td>
                  #{s.batch.id} · {s.batch.fileName || "—"}
                  {s.replaced.length > 0 && <div className="table__secondary">Reemplazó {s.replaced.map((b) => `#${b.id}`).join(", ")}</div>}
                </td>
                <td className="nowrap">{formatDateForDisplay(s.batch.createdAt)}</td>
                <td style={{ textAlign: "right" }}>{s.movementCount === 0 ? "0 · sin movimientos" : formatInteger(s.movementCount)}</td>
                <td>{s.batch.status === "active" ? <Badge tone="success">Activo</Badge> : s.batch.status === "replaced" ? <Badge tone="warning">Reemplazado{s.batch.replacedBy ? ` por #${s.batch.replacedBy}` : ""}</Badge> : <Badge>Anulado</Badge>}</td>
                <td className="nowrap" style={{ textAlign: "right" }}>{s.closingBalanceCents === null ? "—" : formatExactCents(s.closingBalanceCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function BatchTable({ batches }: { batches: BatchSummary[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Importación</th>
            <th>Archivo / lote</th>
            <th>Fecha de importación</th>
            <th style={{ textAlign: "right" }}>Registros</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id}>
              <td>#{b.id}</td>
              <td>
                {isEmptyPeriodBatch(b) ? (
                  <>
                    {EMPTY_PERIOD_LABEL[b.source as EmptyPeriodSource] ?? "Sin actividad"} · {periodLabel(b.periodStart?.slice(0, 7) ?? b.periodLabel)}
                    <div className="table__secondary">Confirmado el {formatDateForDisplay(String(b.metadata?.confirmedAt ?? b.createdAt))}: «{String(b.metadata?.confirmation ?? "")}»</div>
                  </>
                ) : (
                  [b.fileName, b.periodLabel].filter(Boolean).join(" · ") || "—"
                )}
              </td>
              <td>{formatDateForDisplay(b.createdAt)}</td>
              <td style={{ textAlign: "right" }}>{formatInteger(b.recordCount)}</td>
              <td>{b.status === "active" ? <Badge tone="success">Activo</Badge> : b.status === "replaced" ? <Badge tone="warning">Reemplazado{b.replacedBy ? ` por #${b.replacedBy}` : ""}</Badge> : <Badge>Anulado</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Dibuja todas las páginas del PDF real con pdf.js (lo que se ve es exactamente lo que se exporta). */
export function PdfPages({ bytes, width = 560, pageLabel }: { bytes: Uint8Array | null; width?: number; pageLabel?: (page: number) => string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState(0);
  useEffect(() => {
    if (!bytes || !holder.current) return;
    let current = true;
    const target = holder.current;
    target.innerHTML = "";
    (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      }
      const task = pdfjs.getDocument({ data: bytes.slice(), useWasm: false, useWorkerFetch: false, verbosity: 0 });
      try {
        const pdf = await task.promise;
        if (current) setPages(pdf.numPages);
        for (let n = 1; n <= pdf.numPages && current; n++) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const ratio = window.devicePixelRatio || 1;
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          canvas.className = "fs-preview__page";
          canvas.style.width = `${width}px`;
          canvas.setAttribute("aria-label", pageLabel ? pageLabel(n) : n === 1 ? "Página 1: Estado de Situación Financiera" : "Página 2: Estado de Resultados");
          await page.render({ canvas, viewport }).promise;
          if (current) target.appendChild(canvas);
        }
      } finally {
        await task.destroy();
      }
    })().catch((e) => current && setError((e as Error).message || "No se pudo mostrar la vista previa."));
    return () => {
      current = false;
    };
  }, [bytes, width]);
  return (
    <div className="stack stack--sm" style={{ alignItems: "center" }}>
      {error && <Alert tone="danger">{error}</Alert>}
      {!bytes && <Loader />}
      {pages > 2 && <Alert tone="danger">El PDF tiene {pages} páginas: no se puede generar.</Alert>}
      <div ref={holder} className="fs-preview" />
    </div>
  );
}

interface AdjustmentProps {
  open: boolean;
  companyId: number;
  editing: Adjustment | null;
  defaultDate: string;
  index: PucIndex;
  mappings: Map<string, FsPucMapping>;
  /** Valor exacto actual de un PUC (para «Valor anterior»). */
  balanceOf: (pucCode: string) => number;
  onClose: () => void;
  onSaved: () => void | Promise<unknown>;
  onCodesChanged: () => Promise<unknown>;
}

/** Ajuste manual con trazabilidad: nunca se edita un total directamente. */
export function AdjustmentModal({ open, companyId, editing, defaultDate, index, mappings, balanceOf, onClose, onSaved, onCodesChanged }: AdjustmentProps) {
  const toast = useToast();
  const [puc, setPuc] = useState<string | undefined>();
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [type, setType] = useState<AdjustmentType>("replace");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPuc(editing?.pucCode);
    setDate(editing?.accountingDate ?? defaultDate);
    setReason(editing?.reason ?? "");
    setType(editing?.adjustmentType ?? "replace");
    setValue(editing ? (editing.inputCents / 100).toFixed(2).replace(".", ",") : "");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  // Valor anterior: el saldo actual sin el efecto de este mismo ajuste.
  const previous = puc ? balanceOf(puc) - (editing && editing.pucCode === puc ? editing.finalCents - editing.previousCents : 0) : 0;
  const input = parseNumericText(value);
  const inputCents = input === null ? null : Math.round(input * 100);
  const finalCents = inputCents === null ? null : type === "replace" ? inputCents : previous + inputCents;
  const ready = puc && /^\d{4}-\d{2}-\d{2}$/.test(date) && reason.trim() && inputCents !== null;

  async function save() {
    if (!ready || !puc || inputCents === null) return;
    setSaving(true);
    setError(null);
    try {
      const payload = { companyId, accountingDate: date, pucCode: puc, reason, previousCents: previous, adjustmentType: type, inputCents };
      if (editing) await fsService.updateAdjustment(editing.id, payload);
      else await fsService.createAdjustment(payload);
      toast(editing ? "Ajuste actualizado (se guardó el valor anterior en su historial)." : "Ajuste creado.");
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
      open={open}
      title={editing ? "Editar ajuste" : "Nuevo ajuste"}
      description="El ajuste queda registrado con su motivo, el valor anterior y el valor final."
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!ready}>
            {editing ? "Guardar cambios" : "Crear ajuste"}
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="form-grid">
          <Field label="Código PUC" required className="span-2">
            {() => <PucField index={index} value={puc} onChange={setPuc} mappings={mappings} onCodesChanged={onCodesChanged} />}
          </Field>
          <Field label="Fecha contable" required>{(id) => <DateInput id={id} value={date} onChange={setDate} />}</Field>
          <Field label="Tipo de ajuste" required>
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as AdjustmentType)}>
                <option value="replace">Reemplazar valor</option>
                <option value="delta">Sumar / restar diferencia</option>
              </Select>
            )}
          </Field>
          <Field label="Valor anterior" hint="Saldo exacto actual de la cuenta en el periodo.">{(id) => <Input id={id} value={formatExactCents(previous)} disabled />}</Field>
          <Field label={type === "replace" ? "Debe quedar en" : "Diferencia (+ / −)"} required>
            {(id) => <Input id={id} className="input--right" value={value} onChange={(e) => setValue(e.target.value)} invalid={value.trim() !== "" && inputCents === null} placeholder={type === "replace" ? "10.000.000" : "+6.000.000"} />}
          </Field>
          <Field label="Valor final">{(id) => <Input id={id} value={finalCents === null ? "—" : formatExactCents(finalCents)} disabled />}</Field>
          <Field label="Motivo" required className="span-2">{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        </div>
        {editing && editing.history.length > 0 && (
          <div className="field__hint">
            Historial: {editing.history.map((h) => `${formatDateForDisplay(h.editedAt)}: final ${formatExactCents(Number(h.previous.finalCents ?? 0))}`).join(" · ")}
          </div>
        )}
      </div>
    </Modal>
  );
}
