import type { Company } from "../../../types/models";
import { EERR_SECTIONS, ESF_SECTIONS, SECTION_LABEL, type BankBalance, type FsCatalog, type FsLine, type FsPucMapping, type FsSectionKey, type Movement, type Presentation } from "../../../types/fs";
import { estimatedIncomeTax, monthsBetween, roundThousands } from "../shared/money";

/**
 * Motor de los Estados Financieros: consolida los movimientos de UNA empresa
 * por código PUC y por el Catálogo de cuentas, y arma el Estado de Situación
 * Financiera (saldos a la fecha final) y el Estado de Resultados (movimientos
 * del rango). Función pura: no lee ni escribe nada.
 *
 * - La ubicación de cada PUC sale solo del catálogo (nunca del signo, prefijo
 *   o descripción). Un PUC con movimientos y sin destino bloquea.
 * - Valores exactos en centavos; el redondeo al millar es de presentación.
 * - Saldo bancario: la foto más reciente ≤ fecha final de cada cuenta (no se suman meses).
 * - Cuenta por pagar: cuenta mientras no se haya pagado a la fecha final (settlesOn).
 * - Capital social: el capital suscrito de la empresa; la diferencia con el
 *   pagado va a 132505 (A socios).
 * - Reporte de operaciones (cripto): resultado propio = ventas − compras. Banco:
 *   ingresos y costo de terceros = promedio mensual de ventas. OTC: se condensa
 *   en Ventas y Costo de Ventas. El resultado nunca cambia por la presentación.
 */

export const CAPITAL_RECEIVABLE_PUC = "132505";

/** Secciones de naturaleza débito: una salida del banco (D) las aumenta. */
const DEBIT_SECTIONS = new Set<FsSectionKey>(["asset_current", "asset_noncurrent", "costs", "admin_expenses", "sales_expenses", "other_expenses"]);

export interface EngineInput {
  company: Pick<Company, "subscribedTotalShares" | "subscribedNominalValue" | "paidTotalShares" | "paidNominalValue">;
  catalog: FsCatalog;
  mappings: FsPucMapping[];
  movements: Movement[];
  bankBalances: BankBalance[];
  /** Concepto de cada código PUC (para mostrar los pendientes). */
  pucConcepts?: Map<string, string>;
  start: string;
  end: string;
  presentation: Presentation;
}

export interface Contribution {
  pucCode: string;
  concept: string;
  cents: number;
  count: number;
}

export interface LineValue {
  line: FsLine;
  cents: number;
  /** De dónde sale el valor (por PUC), para revisar. */
  contributions: Contribution[];
  /** Valor automático (capital, resultado del ejercicio, presentación Banco / OTC). */
  automatic?: string;
}

export interface SectionValue {
  key: FsSectionKey;
  lines: LineValue[];
  totalCents: number;
  representativeLineId: number | null;
}

export interface UnclassifiedPuc {
  pucCode: string;
  concept: string;
  count: number;
  cents: number;
  /** El PUC apunta a una línea desactivada. */
  inactiveLine?: string;
}

export interface CryptoSummary {
  buysCents: number;
  sellsCents: number;
  ownResultCents: number;
  months: { period: string; sellsCents: number }[];
  /** Promedio mensual de ventas (un mes sin ventas cuenta como 0). */
  monthlyAverageCents: number;
}

export interface Statements {
  sections: Record<FsSectionKey, SectionValue>;
  esf: { currentAssets: number; nonCurrentAssets: number; assets: number; currentLiabilities: number; nonCurrentLiabilities: number; liabilities: number; equity: number; liabilitiesAndEquity: number; differenceCents: number };
  eerr: { income: number; costs: number; gross: number; admin: number; sales: number; operatingExpenses: number; operating: number; otherIncome: number; otherExpenses: number; beforeTax: number };
  incomeTaxPesos: number;
  unclassified: UnclassifiedPuc[];
  crypto: CryptoSummary;
  /** Saldo exacto de cada PUC (ESF a la fecha final; EERR en el rango): base de «Valor anterior» de un ajuste. */
  pucBalances: Map<string, number>;
  presentation: Presentation;
}

interface Bucket {
  cents: number;
  byPuc: Map<string, Contribution>;
  automatic: string[];
}

const isEsf = (s: FsSectionKey) => ESF_SECTIONS.includes(s);

export function buildStatements(input: EngineInput): Statements {
  const { catalog, start, end, presentation } = input;
  const lines = new Map(catalog.lines.map((l) => [l.id, l]));
  const byRole = new Map(catalog.lines.filter((l) => l.role).map((l) => [l.role!, l]));
  const mapping = new Map(input.mappings.map((m) => [m.pucCode, m]));
  const concept = (code: string) => input.pucConcepts?.get(code) ?? "";
  const buckets = new Map<number, Bucket>();
  const bucket = (id: number) => {
    let b = buckets.get(id);
    if (!b) buckets.set(id, (b = { cents: 0, byPuc: new Map(), automatic: [] }));
    return b;
  };
  const unclassified = new Map<string, UnclassifiedPuc>();
  const pucBalances = new Map<string, number>();

  /** Suma un valor de un PUC según su destino en el catálogo. */
  function post(pucCode: string, pucConcept: string, cents: number, date: string | null, opts: { dc?: "D" | "C" | null; settlesOn?: string | null } = {}) {
    if (date !== null && date > end) return;
    const m = mapping.get(pucCode);
    if (m?.excluded) return;
    const line = m?.lineId ? lines.get(m.lineId) : undefined;
    if (!line || !line.isActive) {
      const u = unclassified.get(pucCode) ?? { pucCode, concept: pucConcept || concept(pucCode), count: 0, cents: 0, inactiveLine: line ? line.name : undefined };
      u.count++;
      u.cents += opts.dc === "D" ? -cents : cents;
      unclassified.set(pucCode, u);
      return;
    }
    const esf = isEsf(line.section);
    if (esf && opts.settlesOn && opts.settlesOn <= end) return; // cuenta por pagar ya pagada a la fecha final
    if (!esf && date !== null && date < start) return; // EERR: solo el rango
    let value = cents;
    if (opts.dc) value = (opts.dc === "D") === DEBIT_SECTIONS.has(line.section) ? cents : -cents;
    const b = bucket(line.id);
    b.cents += value;
    const c = b.byPuc.get(pucCode) ?? { pucCode, concept: pucConcept || concept(pucCode), cents: 0, count: 0 };
    c.cents += value;
    c.count++;
    b.byPuc.set(pucCode, c);
    pucBalances.set(pucCode, (pucBalances.get(pucCode) ?? 0) + value);
  }

  // 1. Movimientos activos (el reporte de operaciones va aparte: solo alimenta la presentación).
  const crypto = { buys: 0, sells: 0, byMonth: new Map<string, number>() };
  for (const mv of input.movements) {
    if (mv.status !== "active") continue;
    if (mv.source === "sales_tpsv") {
      if (mv.accountingDate < start || mv.accountingDate > end) continue;
      if (mv.conceptKey === "tpsv.sell") {
        crypto.sells += mv.amountCents;
        const p = mv.accountingDate.slice(0, 7);
        crypto.byMonth.set(p, (crypto.byMonth.get(p) ?? 0) + mv.amountCents);
      } else if (mv.conceptKey === "tpsv.buy") crypto.buys += mv.amountCents;
      continue;
    }
    post(mv.pucCode, mv.pucConcept, mv.amountCents, mv.accountingDate, { dc: mv.dc, settlesOn: mv.settlesOn });
  }

  // 2. Saldo bancario: la foto más reciente ≤ fecha final de cada cuenta.
  const latest = new Map<string, BankBalance>();
  for (const b of input.bankBalances) {
    if (!b.active || b.balanceDate > end) continue;
    const key = `${b.bank}|${b.accountNumber}`;
    const prev = latest.get(key);
    if (!prev || b.balanceDate > prev.balanceDate || (b.balanceDate === prev.balanceDate && b.id > prev.id)) latest.set(key, b);
  }
  for (const b of latest.values()) post(b.pucCode, "", b.balanceCents, null);

  // 3. Capital: suscrito en Capital social; la diferencia con el pagado en 132505.
  const { subscribedTotalShares, subscribedNominalValue, paidTotalShares, paidNominalValue } = input.company;
  const subscribed = (subscribedTotalShares ?? 0) * (subscribedNominalValue ?? 0) * 100;
  const paid = (paidTotalShares ?? 0) * (paidNominalValue ?? 0) * 100;
  const capitalLine = byRole.get("share_capital");
  if (capitalLine && subscribed) {
    const b = bucket(capitalLine.id);
    b.cents += subscribed;
    b.automatic.push("Capital suscrito (Empresas)");
  }
  if (subscribed && subscribed !== paid) post(CAPITAL_RECEIVABLE_PUC, "A SOCIOS", subscribed - paid, null);

  // 4. Reporte de operaciones según la presentación (el resultado es el mismo en ambas).
  const months = monthsBetween(start, end).map((period) => ({ period, sellsCents: crypto.byMonth.get(period) ?? 0 }));
  const monthlyAverageCents = months.length ? crypto.sells / months.length : 0;
  const ownResult = crypto.sells - crypto.buys;
  const addRole = (role: Parameters<typeof byRole.get>[0], cents: number, label: string) => {
    const line = byRole.get(role);
    if (!line || cents === 0) return;
    const b = bucket(line.id);
    b.cents += cents;
    b.automatic.push(label);
  };
  if (presentation === "bank") {
    addRole("sales", ownResult, "Resultado propio de operaciones cripto");
    addRole("third_party_income", monthlyAverageCents, "Promedio mensual de ventas cripto");
    addRole("third_party_cost", monthlyAverageCents, "Promedio mensual de ventas cripto");
  } else {
    addRole("sales", ownResult + monthlyAverageCents, "Resultado propio + valor de terceros (cripto)");
    addRole("cost_of_sales", monthlyAverageCents, "Valor de terceros (cripto)");
    // OTC condensa: lo que haya en las líneas de terceros se presenta en Ventas / Costo de Ventas.
    for (const [from, to] of [["third_party_income", "sales"], ["third_party_cost", "cost_of_sales"]] as const) {
      const source = byRole.get(from);
      const target = byRole.get(to);
      const b = source ? buckets.get(source.id) : undefined;
      if (!b || !target || b.cents === 0) continue;
      const t = bucket(target.id);
      t.cents += b.cents;
      for (const c of b.byPuc.values()) t.byPuc.set(c.pucCode, { ...c, cents: (t.byPuc.get(c.pucCode)?.cents ?? 0) + c.cents });
      buckets.delete(source!.id);
    }
  }

  // 5. Secciones.
  const representative = new Map(catalog.sections.map((s) => [s.section, s.representativeLineId]));
  const sections = {} as Record<FsSectionKey, SectionValue>;
  for (const key of [...ESF_SECTIONS, ...EERR_SECTIONS]) {
    const sectionLines = catalog.lines
      .filter((l) => l.section === key && (l.isActive || buckets.has(l.id)))
      .filter((l) => !(presentation === "otc" && (l.role === "third_party_income" || l.role === "third_party_cost")))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    const values: LineValue[] = sectionLines.map((line) => {
      const b = buckets.get(line.id);
      return {
        line,
        cents: b?.cents ?? 0,
        contributions: b ? [...b.byPuc.values()].sort((x, y) => (x.pucCode < y.pucCode ? -1 : 1)) : [],
        automatic: b?.automatic.length ? b.automatic.join(" · ") : undefined,
      };
    });
    sections[key] = { key, lines: values, totalCents: values.reduce((s, v) => s + v.cents, 0), representativeLineId: representative.get(key) ?? null };
  }

  const total = (k: FsSectionKey) => sections[k].totalCents;
  const income = total("income");
  const costs = total("costs");
  const gross = income - costs;
  const admin = total("admin_expenses");
  const salesExp = total("sales_expenses");
  const operating = gross - admin - salesExp;
  const beforeTax = operating + total("other_income") - total("other_expenses");

  // 6. Resultado del ejercicio en el patrimonio (negativo si hay pérdida).
  const resultLine = byRole.get("period_result");
  const equity = sections.equity;
  const resultValue = resultLine ? equity.lines.find((v) => v.line.id === resultLine.id) : undefined;
  if (resultValue) {
    resultValue.cents += beforeTax;
    resultValue.automatic = [resultValue.automatic, "RESULTADO ANTES DE IMPUESTOS del Estado de Resultados"].filter(Boolean).join(" · ");
    equity.totalCents += beforeTax;
  }

  const currentAssets = total("asset_current");
  const nonCurrentAssets = total("asset_noncurrent");
  const currentLiabilities = total("liability_current");
  const nonCurrentLiabilities = total("liability_noncurrent");
  const assets = currentAssets + nonCurrentAssets;
  const liabilities = currentLiabilities + nonCurrentLiabilities;
  const liabilitiesAndEquity = liabilities + equity.totalCents;

  return {
    sections,
    esf: { currentAssets, nonCurrentAssets, assets, currentLiabilities, nonCurrentLiabilities, liabilities, equity: equity.totalCents, liabilitiesAndEquity, differenceCents: assets - liabilitiesAndEquity },
    eerr: { income, costs, gross, admin, sales: salesExp, operatingExpenses: admin + salesExp, operating, otherIncome: total("other_income"), otherExpenses: total("other_expenses"), beforeTax },
    incomeTaxPesos: estimatedIncomeTax(beforeTax),
    unclassified: [...unclassified.values()].sort((a, b) => (a.pucCode < b.pucCode ? -1 : 1)),
    crypto: { buysCents: crypto.buys, sellsCents: crypto.sells, ownResultCents: ownResult, months, monthlyAverageCents },
    pucBalances,
    presentation,
  };
}

// ---------------------------------------------------------------------------
// Filas para mostrar (app, previsualizador y PDF usan las mismas)
// ---------------------------------------------------------------------------

export type RowKind = "title" | "header" | "line" | "subtotal" | "total" | "result" | "gap";

export interface StatementRow {
  kind: RowKind;
  label: string;
  /** Valor exacto (centavos); sin definir en títulos y espacios. */
  cents?: number;
  /** Pesos redondeados al millar (calculado desde el exacto). */
  pesos?: number;
  lineId?: number;
}

const valueRow = (kind: RowKind, label: string, cents: number, lineId?: number): StatementRow => ({ kind, label, cents, pesos: roundThousands(cents), lineId });

/**
 * Líneas de una sección: se ocultan las que quedan en cero (al millar); si
 * todas quedan en cero se muestra la cuenta representativa en 0.
 */
function sectionRows(section: SectionValue): StatementRow[] {
  const visible = section.lines.filter((v) => roundThousands(v.cents) !== 0);
  if (visible.length) return visible.map((v) => valueRow("line", v.line.name, v.cents, v.line.id));
  const rep = section.lines.find((v) => v.line.id === section.representativeLineId) ?? section.lines[0];
  return rep ? [valueRow("line", rep.line.name, rep.cents, rep.line.id)] : [];
}

export function esfRows(s: Statements): StatementRow[] {
  const S = s.sections;
  return [
    { kind: "title", label: "ACTIVO" },
    { kind: "header", label: SECTION_LABEL.asset_current },
    ...sectionRows(S.asset_current),
    valueRow("subtotal", "TOTAL ACTIVO CORRIENTE", s.esf.currentAssets),
    { kind: "header", label: SECTION_LABEL.asset_noncurrent },
    ...sectionRows(S.asset_noncurrent),
    valueRow("subtotal", "TOTAL ACTIVO NO CORRIENTE", s.esf.nonCurrentAssets),
    valueRow("total", "TOTAL ACTIVO", s.esf.assets),
    { kind: "gap", label: "" },
    { kind: "title", label: "PASIVO Y PATRIMONIO" },
    { kind: "header", label: SECTION_LABEL.liability_current },
    ...sectionRows(S.liability_current),
    valueRow("subtotal", "TOTAL PASIVO CORRIENTE", s.esf.currentLiabilities),
    { kind: "header", label: SECTION_LABEL.liability_noncurrent },
    ...sectionRows(S.liability_noncurrent),
    valueRow("subtotal", "TOTAL PASIVO NO CORRIENTE", s.esf.nonCurrentLiabilities),
    valueRow("total", "TOTAL PASIVOS", s.esf.liabilities),
    { kind: "header", label: SECTION_LABEL.equity },
    ...sectionRows(S.equity),
    valueRow("total", "TOTAL PATRIMONIO", s.esf.equity),
    valueRow("total", "TOTAL PASIVOS Y PATRIMONIO", s.esf.liabilitiesAndEquity),
  ];
}

export function eerrRows(s: Statements): StatementRow[] {
  const S = s.sections;
  const e = s.eerr;
  return [
    { kind: "header", label: SECTION_LABEL.income },
    ...sectionRows(S.income),
    valueRow("subtotal", "TOTAL INGRESOS OPERACIONALES", e.income),
    { kind: "header", label: SECTION_LABEL.costs },
    ...sectionRows(S.costs),
    valueRow("subtotal", "TOTAL COSTOS OPERACIONALES", e.costs),
    valueRow("result", "RESULTADO BRUTO", e.gross),
    { kind: "header", label: SECTION_LABEL.admin_expenses },
    ...sectionRows(S.admin_expenses),
    valueRow("subtotal", "TOTAL GASTOS OPERACIONALES ADMINISTRACIÓN", e.admin),
    { kind: "header", label: SECTION_LABEL.sales_expenses },
    ...sectionRows(S.sales_expenses),
    valueRow("subtotal", "TOTAL GASTOS OPERACIONALES VENTAS", e.sales),
    valueRow("total", "GASTOS OPERACIONALES", e.operatingExpenses),
    valueRow("result", "RESULTADO OPERACIONAL", e.operating),
    ...sectionRows(S.other_income),
    ...sectionRows(S.other_expenses),
    valueRow("result", "RESULTADO ANTES DE IMPUESTOS", e.beforeTax),
  ];
}

/** El ESF cuadra exactamente: Activo = Pasivo + Patrimonio. */
export const isBalanced = (s: Statements) => s.esf.differenceCents === 0;
