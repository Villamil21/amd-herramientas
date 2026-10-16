import { effectiveValues, obligationYear, pendingCents, periodName, paidCents } from "./effects";
import { TAX_PUC, type TaxReturn } from "../types";
import { WH_SELF_KEY, whBreakdownOf, whPucKey } from "../withholding/detail";

/**
 * Composición de la «Renta por pagar»: qué la forma, de qué declaración sale cada parte y con qué PUC se contabiliza.
 *
 * - Liquidación declarada: impuesto a cargo, anticipo liquidado del año anterior, autorretenciones y sanciones del formulario 110.
 * - Año fiscal del corte: el anticipo aplicable es SOLO el generado por la declaración del año anterior (el de declaraciones más viejas
 *   pertenecía a EEFF anteriores) y las autorretenciones son las practicadas dentro del año del corte (Retefuente de ese año).
 * - El patrimonio declarado es solo informativo y no entra aquí.
 */

export interface CompositionLine {
  key: string;
  label: string;
  /** Con signo: los descuentos son negativos. */
  cents: number;
  source: string;
  pucKey?: string;
  pucCode?: string | null;
}

export interface DeclaredLiquidation {
  returnId: number;
  title: string;
  lines: CompositionLine[];
  payableCents: number;
  paidCents: number;
  pendingCents: number;
  noncurrent: boolean;
}

export interface IncomeComposition {
  cutYear: number;
  declarations: DeclaredLiquidation[];
  advance: CompositionLine | null;
  selfWithholding: { total: CompositionLine; periods: { returnId: number; label: string; cents: number }[] };
  /** Anticipo + autorretenciones del año del corte: descuentos explicables de la renta del mismo año fiscal. */
  discountsCents: number;
}

export function incomeComposition(returns: TaxReturn[], cut: string, puc: Map<string, string>): IncomeComposition {
  const cutYear = Number(cut.slice(0, 4));
  const live = returns.filter((r) => r.supersededBy === null);
  const code = (key: string) => puc.get(key) || null;
  const declarations: DeclaredLiquidation[] = [];
  for (const r of live.filter((x) => x.taxType === "income" && x.periodEnd <= cut).sort((a, b) => a.year - b.year)) {
    const v = r.detail?.values ?? {};
    const get = (k: string) => v[k]?.cents ?? 0;
    const eff = effectiveValues(r);
    if (eff.payable <= 0) continue;
    const lines: CompositionLine[] = [
      { key: "tax", label: "Impuesto liquidado (total impuesto a cargo)", cents: get("incomeTaxDue"), source: `Formulario 110 ${r.formNumber || "sin número"}`, pucKey: TAX_PUC.incomePayable, pucCode: code(TAX_PUC.incomePayable) },
      { key: "advance", label: "(−) Anticipo renta liquidado año anterior", cents: -get("incomeAdvancePrior"), source: `Declaración ${r.year - 1}`, pucKey: TAX_PUC.incomeAdvance, pucCode: code(TAX_PUC.incomeAdvance) },
      { key: "self", label: "(−) Autorretenciones", cents: -get("incomeSelfWithholding"), source: "Formulario 110", pucKey: whPucKey(WH_SELF_KEY), pucCode: code(whPucKey(WH_SELF_KEY)) },
      { key: "sanctions", label: "(+) Sanciones", cents: get("sanctions"), source: "Formulario 110" },
    ].filter((l) => l.cents !== 0);
    declarations.push({ returnId: r.id, title: `Renta ${periodName(r)}`, lines, payableCents: eff.payable, paidCents: paidCents(r, cut), pendingCents: pendingCents(r, cut), noncurrent: obligationYear(r) < cutYear });
  }
  // Anticipo del año del corte: solo el de la declaración del año anterior, y antes del 31/12 (ese día se consume).
  const source = live.find((r) => r.taxType === "income" && r.advanceTargetYear === cutYear && (r.advanceNextCents ?? 0) > 0 && r.periodEnd <= cut);
  const advance: CompositionLine | null = source && cut < `${cutYear}-12-31` ? { key: "advance", label: `Anticipo de Renta ${cutYear}`, cents: source.advanceNextCents!, source: `Declaración de renta ${source.year}`, pucKey: TAX_PUC.incomeAdvance, pucCode: code(TAX_PUC.incomeAdvance) } : null;
  // Autorretenciones del año: concepto «Autorretenciones» de las Retefuente cuyo periodo está dentro del año del corte.
  const periods = live
    .filter((r) => r.taxType === "withholding" && r.year === cutYear && r.periodEnd <= cut)
    .map((r) => ({ returnId: r.id, label: periodName(r), cents: whBreakdownOf(r)?.rows.find((row) => row.key === WH_SELF_KEY)?.netCents ?? 0 }))
    .filter((p) => p.cents !== 0)
    .sort((a, b) => a.returnId - b.returnId);
  const selfTotal = periods.reduce((n, p) => n + p.cents, 0);
  return {
    cutYear,
    declarations,
    advance,
    selfWithholding: { total: { key: "self", label: `Autorretenciones practicadas en ${cutYear}`, cents: selfTotal, source: `${periods.length} ${periods.length === 1 ? "declaración" : "declaraciones"} de Retefuente ${cutYear}`, pucKey: whPucKey(WH_SELF_KEY), pucCode: code(whPucKey(WH_SELF_KEY)) }, periods },
    discountsCents: (advance?.cents ?? 0) + selfTotal,
  };
}
