import { formatCop } from "../../../taxes/invoice-vat/parser/amounts";
import type { DocRow } from "../types";
import { formatDateForDisplay } from "../../../../utils/dates";

export { formatCop };

/** "2026-05-10" → "10/05/2026". */
export const formatIssueDate = (iso: string | undefined) => formatDateForDisplay(iso);

/** Códigos distintos que usa el documento (uno en modo «un solo código»). */
export function rowCodes(r: DocRow): string[] {
  if (r.mode === "document") return r.documentCode ? [r.documentCode] : [];
  return [...new Set(r.lines.map((l) => l.code).filter((c): c is string => Boolean(c)))];
}
