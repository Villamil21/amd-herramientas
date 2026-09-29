import type { BaseVat, DocumentTypeSummary, InvoiceStatus } from "../types";

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  processed: "Procesada",
  "pending-supplier": "Proveedor pendiente",
  review: "Requiere revisión",
  incompatible: "No compatible",
  error: "Error",
};

/** Renglones del resumen por tipo de documento, en el orden solicitado. */
export const SUMMARY_CATEGORIES: { label: string; value: (s: DocumentTypeSummary) => BaseVat }[] = [
  { label: "De bienes gravados a la tarifa del 5%", value: (s) => s.purchases5 },
  { label: "De bienes gravados a la tarifa general", value: (s) => s.purchases19 },
  { label: "De servicios gravados a la tarifa general", value: (s) => s.services19 },
  { label: "De bienes y servicios excluidos, exentos y no gravados", value: (s) => ({ baseCents: s.zeroBaseCents, vatCents: 0 }) },
];
