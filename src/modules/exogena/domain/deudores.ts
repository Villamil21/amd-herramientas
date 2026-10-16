import type { Statements } from "../../financial-statements/generator/engine";
import type { TaxEffect } from "../../financial-statements/tax-obligations/services/effects";
import type { ExoRecord } from "../../../types/exogena";
import { normalizeKey } from "../../../utils/text";

/** Total de «Deudores» del ESF: corrientes y no corrientes (la clasificación no excluye un saldo del 1008). */
export function deudoresCents(statements: Pick<Statements, "sections">): number {
  let total = 0;
  for (const key of ["asset_current", "asset_noncurrent"] as const) for (const v of statements.sections[key]?.lines ?? []) if (normalizeKey(v.line.name) === "deudores") total += v.cents;
  return total;
}

export interface DeudoresRow {
  key: "socios" | "vat_favor" | "income_favor" | "excess_favor" | "other";
  label: string;
  /** Valor en el ESF (centavos). */
  eeffCents: number;
  /** Valor en los registros del 1008 (centavos). */
  exogenaCents: number;
  differenceCents: number;
}

export interface DeudoresReconciliation {
  /** Deudores corrientes + no corrientes del ESF (centavos). */
  eeffCents: number;
  /** Total del 1008 (centavos). */
  exogenaCents: number;
  differenceCents: number;
  rows: DeudoresRow[];
}

const pesosToCents = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) : 0);

/**
 * Conciliación Deudores (ESF) ↔ total 1008 explicada por fuente: CxC a socios, IVA a favor, Renta a favor y los demás deudores.
 * Los saldos a favor del 1008 se leen de la traza de los registros (no se reparten por concepto), así una corrección manual del
 * total se ve como diferencia en «Otros deudores» y no cambia lo que salió de la declaración.
 */
export function reconcileDeudores(src: { eeffDeudoresCents: number; /** CxC a socios que SÍ entró a EEFF (con PUC y ubicación); 0 si falta alguno. */
  sociosReceivableCents: number; taxEffects: Pick<TaxEffect, "kind" | "cents">[]; records: Pick<ExoRecord, "sourceKey" | "data">[] }): DeudoresReconciliation {
  const eeffVat = src.taxEffects.filter((e) => e.kind === "vat_favor").reduce((n, e) => n + e.cents, 0);
  const eeffIncome = src.taxEffects.filter((e) => e.kind === "income_favor").reduce((n, e) => n + e.cents, 0);
  const eeffExcess = src.taxEffects.filter((e) => e.kind === "excess_favor").reduce((n, e) => n + e.cents, 0);
  const exoTotal = src.records.reduce((n, r) => n + pesosToCents(r.data.balance), 0);
  let exoSocios = 0;
  let exoVat = 0;
  let exoIncome = 0;
  let exoExcess = 0;
  for (const r of src.records) {
    if (r.sourceKey.startsWith("socio-cxc:")) exoSocios += pesosToCents(r.data.balance);
    else if (r.sourceKey.startsWith("dian-cxc:") && Array.isArray(r.data.taxTrace))
      for (const t of r.data.taxTrace as { kind: string; resultCents: number }[]) {
        if (t.kind === "vat_favor") exoVat += t.resultCents;
        else if (t.kind === "income_favor") exoIncome += t.resultCents;
        else if (t.kind === "excess_favor") exoExcess += t.resultCents;
      }
  }
  const row = (key: DeudoresRow["key"], label: string, eeffCents: number, exogenaCents: number): DeudoresRow => ({ key, label, eeffCents, exogenaCents, differenceCents: eeffCents - exogenaCents });
  const rows = [
    row("socios", "CxC a socios (capital suscrito − pagado)", src.sociosReceivableCents, exoSocios),
    row("vat_favor", "Saldo a favor de IVA (DIAN)", eeffVat, exoVat),
    row("income_favor", "Saldo a favor de Renta (DIAN)", eeffIncome, exoIncome),
    row("excess_favor", "Excedentes a favor de la DIAN (pagos)", eeffExcess, exoExcess),
    row("other", "Otros deudores y ajustes", src.eeffDeudoresCents - src.sociosReceivableCents - eeffVat - eeffIncome - eeffExcess, exoTotal - exoSocios - exoVat - exoIncome - exoExcess),
  ];
  return { eeffCents: src.eeffDeudoresCents, exogenaCents: exoTotal, differenceCents: src.eeffDeudoresCents - exoTotal, rows };
}
