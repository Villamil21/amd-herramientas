import type { PucUsage } from "../../../../types/models";
import { formatInteger } from "../../../../utils/format";

/** Fuente de un movimiento → «de compras», «de nómina»… */
const MOVEMENT_SOURCE: Record<string, [string, string]> = {
  opening: ["saldo inicial", "saldos iniciales"],
  adjustment: ["movimiento de ajuste", "movimientos de ajuste"],
  purchases: ["movimiento de compras", "movimientos de compras"],
  bank: ["movimiento de extractos bancarios", "movimientos de extractos bancarios"],
  payroll: ["movimiento de nómina", "movimientos de nómina"],
  sales_einvoice: ["movimiento de ventas (facturación electrónica)", "movimientos de ventas (facturación electrónica)"],
  sales_tpsv: ["movimiento de ventas TPSV", "movimientos de ventas TPSV"],
};

const KIND: Record<string, [string, string]> = {
  reclassified: ["movimiento reclasificado desde este código", "movimientos reclasificados desde este código"],
  adjustments: ["ajuste manual", "ajustes manuales"],
  opening_drafts: ["borrador de saldos iniciales", "borradores de saldos iniciales"],
  bank_balances: ["saldo bancario", "saldos bancarios"],
  bank_accounts: ["cuenta bancaria configurada", "cuentas bancarias configuradas"],
  bank_concepts: ["concepto bancario asociado", "conceptos bancarios asociados"],
  puc_settings: ["cuenta configurada (nómina, ventas, impuestos…)", "cuentas configuradas (nómina, ventas, impuestos…)"],
  suppliers: ["proveedor con este código (clasificación de compras)", "proveedores con este código (clasificación de compras)"],
  children: ["código personalizado que depende de este", "códigos personalizados que dependen de este"],
};

/** «3 movimientos de compras», «1 saldo inicial»… */
export function usageLabel(kind: string, count: number): string {
  const words = kind.startsWith("movements:") ? (MOVEMENT_SOURCE[kind.slice(10)] ?? ["movimiento contable", "movimientos contables"]) : (KIND[kind] ?? ["referencia", "referencias"]);
  return `${formatInteger(count)} ${count === 1 ? words[0] : words[1]}`;
}

/** Referencias que siguen usando el código en nuevos envíos aunque se desactive. */
export const CONFIG_KINDS = new Set(["bank_accounts", "bank_concepts", "puc_settings", "opening_drafts"]);

export const configItems = (usage: PucUsage | undefined) => (usage?.items ?? []).filter((i) => CONFIG_KINDS.has(i.kind));
