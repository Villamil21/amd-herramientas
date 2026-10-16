import type { ExoRecord } from "../../../../types/exogena";
import type { TaxEffect, TaxTrace } from "./effects";
import type { TaxType } from "../types";

/**
 * Conciliación de un corte: lo que los Estados Financieros incluyen de cada impuesto frente a lo que contienen los registros
 * guardados de Exógena (1009 para lo que se debe a la DIAN, 1008 para los saldos a favor). Función pura sobre los mismos
 * `TaxEffect` que usa el Generador: no repite el cálculo de saldos.
 */

const PAYABLE = ["withholding_payable", "vat_payable", "income_payable"];
const FAVOR = ["vat_favor", "income_favor"];

export interface TaxReconRow {
  key: string;
  taxType: TaxType | null;
  label: string;
  /** 1009 (por pagar a la DIAN) o 1008 (saldo a favor, deudor DIAN). */
  format: "1009" | "1008";
  eeffCents: number;
  /** null: el formato aún no tiene registros guardados para ese año. */
  exogenaCents: number | null;
  differenceCents: number | null;
}

export interface TaxReconciliation {
  rows: TaxReconRow[];
  eeffCents: number;
  exogenaCents: number | null;
  differenceCents: number | null;
  /** Fecha de corte del 31/12 con diferencia cero (y registros guardados). */
  ready: boolean;
}

type Saved = Pick<ExoRecord, "data">[] | null;

const traces = (records: Saved): TaxTrace[] => (records ?? []).flatMap((r) => (Array.isArray(r.data.taxTrace) ? (r.data.taxTrace as TaxTrace[]) : []));
const sum = (list: { cents: number }[]) => list.reduce((n, x) => n + x.cents, 0);

const LABEL: Record<TaxType, string> = { withholding: "Retención en la fuente", vat: "IVA", income: "Renta" };

export function taxReconciliation(effects: TaxEffect[], saved1009: Saved, saved1008: Saved, cut: string, only?: TaxType): TaxReconciliation {
  const t1009 = traces(saved1009);
  const t1008 = traces(saved1008);
  const rows: TaxReconRow[] = [];
  const taxOf = (e: TaxEffect): TaxType => (e.kind.startsWith("withholding") ? "withholding" : e.kind.startsWith("vat") ? "vat" : "income");
  const add = (taxType: TaxType, kinds: string[], format: "1009" | "1008", noun: string, saved: Saved, from: TaxTrace[]) => {
    const eeff = sum(effects.filter((e) => kinds.includes(e.kind) && taxOf(e) === taxType));
    const exo = saved === null ? null : from.filter((t) => kinds.includes(t.kind) && t.taxType === taxType).reduce((n, t) => n + t.resultCents, 0);
    if (eeff === 0 && !exo) return;
    rows.push({ key: `${taxType}:${format}`, taxType, label: `${LABEL[taxType]} ${noun}`, format, eeffCents: eeff, exogenaCents: exo, differenceCents: exo === null ? null : eeff - exo });
  };
  for (const taxType of ["withholding", "vat", "income"] as TaxType[]) {
    if (only && only !== taxType) continue;
    add(taxType, PAYABLE, "1009", "por pagar", saved1009, t1009);
    if (taxType !== "withholding") add(taxType, FAVOR, "1008", "a favor", saved1008, t1008);
  }
  // Correcciones manuales de los registros de la DIAN: no se atribuyen a un impuesto y se muestran aparte (solo en el total).
  if (!only) {
    const manual = (saved: Saved, format: "1009" | "1008", scale: (r: Pick<ExoRecord, "data">) => number, from: TaxTrace[]) => {
      if (saved === null) return;
      const withTrace = saved.filter((r) => Array.isArray(r.data.taxTrace));
      const diff = withTrace.reduce((n, r) => n + scale(r), 0) - from.reduce((n, t) => n + t.resultCents, 0);
      if (diff !== 0) rows.push({ key: `manual:${format}`, taxType: null, label: `Ajuste manual en el ${format}`, format, eeffCents: 0, exogenaCents: diff, differenceCents: -diff });
    };
    manual(saved1009, "1009", (r) => (typeof r.data.balanceCents === "number" ? r.data.balanceCents : 0), t1009);
    manual(saved1008, "1008", (r) => (typeof r.data.balance === "number" ? Math.round(r.data.balance * 100) : 0), t1008);
  }
  const eeffCents = rows.reduce((n, r) => n + r.eeffCents, 0);
  const missing = rows.some((r) => r.exogenaCents === null);
  const exogenaCents = missing ? null : rows.reduce((n, r) => n + (r.exogenaCents ?? 0), 0);
  const differenceCents = exogenaCents === null ? null : eeffCents - exogenaCents;
  return { rows, eeffCents, exogenaCents, differenceCents, ready: /-12-31$/.test(cut) && differenceCents === 0 && !missing };
}
