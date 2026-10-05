import type { BaseVat, InvoiceStatus, InvoiceSummary } from "../types";

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  processed: "Validado",
  "pending-supplier": "Proveedor pendiente",
  "pending-title": "Tipo de documento pendiente",
  review: "Requiere revisión",
  excluded: "Excluido",
  incompatible: "No compatible",
  error: "Error",
};

/** Renglones del resumen de Facturas electrónicas, en el orden solicitado. */
export const SUMMARY_CATEGORIES: { label: string; value: (s: InvoiceSummary) => BaseVat }[] = [
  { label: "De bienes gravados a la tarifa del 5%", value: (s) => s.purchases5 },
  { label: "De bienes gravados a la tarifa general", value: (s) => s.purchases19 },
  { label: "De servicios gravados a la tarifa general", value: (s) => s.services19 },
  { label: "De bienes y servicios excluidos, exentos y no gravados", value: (s) => ({ baseCents: s.zeroBaseCents, vatCents: 0 }) },
];

/** Total visual del resumen de Facturas: suma de sus renglones (no es una categoría tributaria). */
export const summaryTotal = (s: InvoiceSummary): BaseVat =>
  SUMMARY_CATEGORIES.reduce((t, c) => ({ baseCents: t.baseCents + c.value(s).baseCents, vatCents: t.vatCents + c.value(s).vatCents }), { baseCents: 0, vatCents: 0 });

/** Único renglón del resumen de Notas crédito (todas las tarifas juntas). */
export const NOTES_CATEGORY = "Devoluciones en compras anuladas, rescindidas o resueltas en este periodo";
