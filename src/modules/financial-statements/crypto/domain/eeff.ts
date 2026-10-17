import { lastDayOfMonth } from "../../shared/money";
import type { UploadCoverage } from "./coverage";
import { monthOf, yearMonths } from "./coverage";
import type { Operation } from "./operations";
import type { CryptoPresentation } from "./types";

/**
 * Estados Financieros desde Transacciones Cripto. Solo cuentan operaciones aceptadas y aplicables al corte. Los importes son
 * centavos enteros exactos y todo se recalcula desde el origen: nada de lo calculado se guarda como fuente de verdad.
 */

/** Ajuste de $50.000.000 COP cuando el tramo ganador termina antes del mes de corte. */
export const REFERENCE_ADJUSTMENT_CENTS = 50_000_000 * 100;

export type ComponentKey = "sales" | "third_income" | "cost_of_sales" | "third_cost";

/** Claves de la configuración PUC global (fs_puc_settings) de este módulo. */
export const PUC_KEYS: Record<ComponentKey, string> = {
  sales: "crypto.sales",
  third_income: "crypto.third_income",
  cost_of_sales: "crypto.cost_of_sales",
  third_cost: "crypto.third_cost",
};

export const COMPONENT_LABEL: Record<ComponentKey, string> = { sales: "Ventas", third_income: "Ingresos para terceros", cost_of_sales: "Costo de ventas", third_cost: "Costos para terceros" };

// ---------------------------------------------------------------------------
// Aplicabilidad de Ventas al corte
// ---------------------------------------------------------------------------

export type SalesScope =
  | { status: "included" }
  | { status: "excluded"; reason: string }
  | { status: "blocked"; reason: string };

export interface UploadSales {
  uploadId: number;
  fileName: string;
  coverage: UploadCoverage;
  /** Suma de Ventas aceptadas de la carga. */
  salesCents: number;
  scope: SalesScope;
}

const monthName = (m: string) => m;

/**
 * Ventas no trae fecha: sus ingresos pertenecen al período que cubren las compras de la misma carga. Si el corte cae DENTRO
 * de ese período no se puede separar el valor hasta ese día y no se inventa una distribución: queda bloqueado.
 */
export function salesScope(coverage: UploadCoverage, cutoff: string): SalesScope {
  if (!coverage.first || !coverage.last) return { status: "blocked", reason: "La carga no tiene meses de cobertura (sus compras no traen fecha válida): ajusta su período." };
  if (lastDayOfMonth(coverage.last) <= cutoff) return { status: "included" };
  if (`${coverage.first}-01` > cutoff) return { status: "excluded", reason: `La carga cubre ${monthName(coverage.first)}–${monthName(coverage.last)}, posterior al corte.` };
  return { status: "blocked", reason: `El corte ${cutoff} cae dentro del período de la carga (${coverage.first} a ${coverage.last}) y sus ventas no traen fecha: ajusta el período de cobertura (pestaña Operaciones → Cobertura) o usa un corte compatible.` };
}

export function uploadsSales(operations: readonly Operation[], coverages: readonly UploadCoverage[], cutoff: string): UploadSales[] {
  const out: UploadSales[] = [];
  for (const coverage of coverages) {
    const sales = operations.filter((o) => o.uploadId === coverage.uploadId && o.kind === "sale" && o.status === "accepted");
    if (sales.length === 0) continue;
    out.push({ uploadId: coverage.uploadId, fileName: coverage.fileName, coverage, salesCents: sales.reduce((s, o) => s + (o.amountCents ?? 0), 0), scope: salesScope(coverage, cutoff) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Valor de referencia para terceros
// ---------------------------------------------------------------------------

export interface ReferenceMonth {
  month: string;
  purchasesCents: number;
  /** Compras acumuladas de enero a este mes. */
  cumulativeCents: number;
  /** Promedio acumulado = acumulado / meses transcurridos (redondeado al centavo). */
  averageCents: number;
}

export interface ReferenceValue {
  months: ReferenceMonth[];
  /** Índice del tramo ganador (el primer promedio acumulado más alto); -1 si no hay compras aplicables. */
  winnerIndex: number;
  winnerMonth: string | null;
  winnerAverageCents: number;
  /** $50.000.000 si el tramo ganador termina antes del mes de corte; 0 si termina en él (o no hay compras). */
  adjustmentCents: number;
  /** Valor de referencia para terceros. */
  referenceCents: number;
  cutoffMonth: string;
  note?: string;
}

export function referenceValue(year: number, cutoff: string, purchases: readonly Operation[]): ReferenceValue {
  const cutoffMonth = monthOf(cutoff);
  const months = yearMonths(year).filter((m) => m <= cutoffMonth);
  const perMonth = new Map<string, number>();
  for (const p of purchases) if (p.status === "accepted" && p.date && p.date <= cutoff && p.amountCents !== null) perMonth.set(monthOf(p.date), (perMonth.get(monthOf(p.date)) ?? 0) + p.amountCents);
  let cumulative = 0;
  const series: ReferenceMonth[] = months.map((month, i) => {
    const purchasesCents = perMonth.get(month) ?? 0;
    cumulative += purchasesCents;
    return { month, purchasesCents, cumulativeCents: cumulative, averageCents: Math.round(cumulative / (i + 1)) };
  });
  const total = series[series.length - 1]?.cumulativeCents ?? 0;
  if (series.length === 0 || total === 0) {
    return { months: series, winnerIndex: -1, winnerMonth: null, winnerAverageCents: 0, adjustmentCents: 0, referenceCents: 0, cutoffMonth, note: "Sin compras aplicables al corte: no hay valor de referencia ni ajuste." };
  }
  // El primer promedio más alto; la comparación es exacta (acumulado_i / i), sin errores de redondeo.
  let winner = 0;
  for (let i = 1; i < series.length; i++) if (BigInt(series[i].cumulativeCents) * BigInt(winner + 1) > BigInt(series[winner].cumulativeCents) * BigInt(i + 1)) winner = i;
  const adjustmentCents = series[winner].month < cutoffMonth ? REFERENCE_ADJUSTMENT_CENTS : 0;
  return { months: series, winnerIndex: winner, winnerMonth: series[winner].month, winnerAverageCents: series[winner].averageCents, adjustmentCents, referenceCents: series[winner].averageCents + adjustmentCents, cutoffMonth };
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

export interface CryptoEeff {
  cutoff: string;
  /** Fecha contable de los movimientos: el menor entre el corte y el último día del último mes con compras aceptadas que cubren el cálculo. */
  effectiveDate: string;
  /** El corte elegido es posterior a la última cobertura aceptada, así que la fecha se adelantó a esa cobertura. */
  effectiveFromCoverage: boolean;
  purchasesCents: number;
  salesCents: number | null;
  uploadSales: UploadSales[];
  /** Ingreso propio = ventas aplicables − compras aplicables; null mientras alguna carga con ventas no se pueda ubicar frente al corte. */
  ownIncomeCents: number | null;
  blockedSales: string[];
  reference: ReferenceValue;
}

/**
 * Fecha efectiva del efecto contable: nunca adelanta ingresos a un período sin información. Con compras aceptadas de enero a
 * mayo y corte 31/12, se fecha el 31/05: entra en EEFF enero–mayo y también en enero–diciembre.
 */
export function effectiveDateOf(cutoff: string, coverages: readonly UploadCoverage[]): { date: string; fromCoverage: boolean } {
  const cutoffMonth = cutoff.slice(0, 7);
  const last = coverages.flatMap((c) => c.months).filter((m) => m <= cutoffMonth).sort().pop();
  if (!last) return { date: cutoff, fromCoverage: false };
  const end = lastDayOfMonth(last);
  return end < cutoff ? { date: end, fromCoverage: true } : { date: cutoff, fromCoverage: false };
}

export function computeEeff(args: { year: number; cutoff: string; operations: readonly Operation[]; coverages: readonly UploadCoverage[] }): CryptoEeff {
  const { year, cutoff, operations, coverages } = args;
  const purchases = operations.filter((o) => o.kind === "purchase");
  const purchasesCents = purchases.filter((o) => o.status === "accepted" && o.date && o.date <= cutoff).reduce((s, o) => s + (o.amountCents ?? 0), 0);
  const uploadSales = uploadsSales(operations, coverages, cutoff);
  const blockedSales = uploadSales.filter((u) => u.scope.status === "blocked").map((u) => `${u.fileName}: ${(u.scope as { reason: string }).reason}`);
  const salesCents = blockedSales.length ? null : uploadSales.filter((u) => u.scope.status === "included").reduce((s, u) => s + u.salesCents, 0);
  const effective = effectiveDateOf(cutoff, coverages);
  return { cutoff, effectiveDate: effective.date, effectiveFromCoverage: effective.fromCoverage, purchasesCents, salesCents, uploadSales, ownIncomeCents: salesCents === null ? null : salesCents - purchasesCents, blockedSales, reference: referenceValue(year, cutoff, purchases) };
}

export interface EeffComponent {
  key: ComponentKey;
  label: string;
  pucKey: string;
  /** Valor a enviar; null si depende de un valor que aún no se puede calcular. */
  cents: number | null;
  formula: string;
  blocked?: string;
}

/** Componentes que cada tipo de presentación envía a Estados Financieros. */
export function eeffComponents(presentation: CryptoPresentation, eeff: CryptoEeff): EeffComponent[] {
  const own = eeff.ownIncomeCents;
  const ref = eeff.reference.referenceCents;
  const ownBlocked = own === null ? eeff.blockedSales.join(" ") : undefined;
  const make = (key: ComponentKey, cents: number | null, formula: string, blocked?: string): EeffComponent => ({ key, label: COMPONENT_LABEL[key], pucKey: PUC_KEYS[key], cents, formula, ...(blocked && cents === null ? { blocked } : {}) });
  if (presentation === "otc")
    return [
      make("sales", own === null ? null : own + ref, "Ingreso propio + valor de referencia", ownBlocked),
      make("cost_of_sales", ref, "Valor de referencia"),
    ];
  if (presentation === "banks")
    return [
      make("sales", own, "Ingreso propio", ownBlocked),
      make("third_income", ref, "Valor de referencia"),
      make("third_cost", ref, "Valor de referencia"),
    ];
  return [make("sales", own, "Ingreso propio", ownBlocked)];
}

/** Utilidad bruta resultante (igual al ingreso propio en las tres presentaciones). */
export const grossProfitCents = (eeff: CryptoEeff): number | null => eeff.ownIncomeCents;

export interface PucCheck {
  code: string | undefined;
  /** Existe como cuenta asignable. */
  valid: boolean;
  /** Tiene ubicación en Estados Financieros (por familia de cuatro dígitos o por el código completo). */
  located: boolean;
  location?: string;
}

export interface ComponentReadiness extends EeffComponent {
  puc: PucCheck;
  /** Por qué no puede enviarse (null = listo). */
  issue: string | null;
}

export function componentReadiness(components: readonly EeffComponent[], puc: (key: string) => PucCheck): ComponentReadiness[] {
  return components.map((c) => {
    const check = puc(c.pucKey);
    // Un componente en cero no llega a Estados Financieros: no exige cuenta PUC.
    const issue = c.cents === 0 ? null : c.cents === null ? (c.blocked ?? "Depende de un valor aún no calculable.") : !check.code ? `Falta la cuenta PUC de ${c.label}.` : !check.valid ? `La cuenta PUC ${check.code} no existe o no se puede asignar.` : !check.located ? `La cuenta ${check.code} no tiene ubicación en Estados Financieros (familia ${check.code.slice(0, 4)}).` : null;
    return { ...c, puc: check, issue };
  });
}
