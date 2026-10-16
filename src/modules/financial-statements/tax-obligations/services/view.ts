import { effectiveValues, fiscalResult, paidCents, pendingCents, taxStatus, type TaxEffect, type TaxStatus } from "./effects";
import { TAX_PUC, type TaxPucKey, type TaxReturn, type VatPeriodicity } from "../types";

/** Cómo se muestra una declaración a una fecha de corte (tabla, resumen y detalle usan lo mismo). */
export interface ReturnView {
  r: TaxReturn;
  status: TaxStatus;
  /** El periodo ya terminó al corte (si no, la obligación aún no existe en los Estados Financieros). */
  due: boolean;
  /** Valor declarado que cuenta: saldo a pagar o saldo a favor. */
  payableCents: number;
  favorCents: number;
  /** Pagos con fecha ≤ corte. */
  paidCents: number;
  /** Por pagar: saldo pendiente al corte. A favor: el saldo si es el vigente (foto) al corte. */
  balanceCents: number;
  balanceKind: "payable" | "favor" | "none";
}

export function returnView(r: TaxReturn, cut: string, vatPeriodicity: VatPeriodicity | null, effects: Pick<TaxEffect, "kind" | "returnIds">[]): ReturnView {
  const v = effectiveValues(r);
  const due = r.periodEnd <= cut;
  const vigentFavor = effects.some((e) => (e.kind === "vat_favor" || e.kind === "income_favor") && e.returnIds.includes(r.id));
  const payable = v.payable > 0;
  return {
    r,
    status: taxStatus(r, vatPeriodicity, cut),
    due,
    payableCents: v.payable,
    favorCents: v.favor,
    paidCents: payable ? paidCents(r, cut) : 0,
    balanceCents: payable ? (due ? pendingCents(r, cut) : 0) : vigentFavor ? v.favor : 0,
    balanceKind: payable ? "payable" : vigentFavor ? "favor" : "none",
  };
}

/** Versiones del mismo periodo / año (la vigente y las reemplazadas por correcciones), de la más antigua a la más reciente. */
export function versionsOf(r: TaxReturn, all: TaxReturn[]): TaxReturn[] {
  return all.filter((x) => x.companyId === r.companyId && x.taxType === r.taxType && x.year === r.year && (x.period ?? null) === (r.period ?? null) && x.periodicity === r.periodicity).sort((a, b) => a.id - b.id);
}

/** Cuántas declaraciones vigentes quedan sin efecto en los Estados Financieros por no tener la cuenta PUC configurada. */
export function periodsAffectedByPuc(returns: TaxReturn[], key: TaxPucKey): number {
  const live = returns.filter((r) => r.supersededBy === null);
  const has = (r: TaxReturn) => {
    const v = effectiveValues(r);
    switch (key) {
      case TAX_PUC.withholdingPayable:
        return r.taxType === "withholding" && v.payable > 0;
      case TAX_PUC.vatPayable:
        return r.taxType === "vat" && v.payable > 0;
      case TAX_PUC.vatFavor:
        return r.taxType === "vat" && v.favor > 0;
      case TAX_PUC.incomePayable:
        return r.taxType === "income" && v.payable > 0;
      case TAX_PUC.incomeFavor:
        return r.taxType === "income" && v.favor > 0;
      case TAX_PUC.incomeAdvance:
        return r.taxType === "income" && (r.advanceNextCents ?? 0) > 0;
      case TAX_PUC.priorResults:
        return r.taxType === "income" && fiscalResult(r) !== 0;
    }
  };
  return live.filter(has).length;
}
