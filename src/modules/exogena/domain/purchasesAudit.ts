import type { ExoRecord } from "../../../types/exogena";
import { formatExoCents, formatExoPesos } from "./numbers";
import { lineLabel, monthName, type DocView, type PurchasesModel } from "../../financial-statements/purchases/domain/model";
import { DEST_LABEL } from "../../financial-statements/purchases/domain/status";
import type { EinvoiceContribution } from "./einvoiceSales";
import type { PurchasesExoFormat, PurchasesFormatState } from "./purchasesFormat";

/**
 * Contenido de la auditoría interna de 1001 / 1005 / 1006 (PDF): de cada registro a las facturas y líneas que lo originan, la
 * cobertura mensual y los pendientes. Es un documento de control de la firma, no un formato para la DIAN.
 */

export interface AuditTraceLine {
  invoice: string;
  date: string;
  file: string;
  /** Línea o resumen del aporte de la factura al registro. */
  detail: string;
  amountCents: number;
}

export interface AuditRecord {
  third: string;
  document: string;
  concept: string;
  values: { label: string; value: string }[];
  trace: AuditTraceLine[];
  /** El registro guardado difiere de lo que Compras propone hoy. */
  outdated: boolean;
}

export interface PurchasesAudit {
  format: PurchasesExoFormat;
  title: string;
  company: string;
  nit: string;
  year: number;
  statusLabel: string;
  notApplicableReason: string | null;
  records: AuditRecord[];
  coverage: { month: string; purchases: number; returns: number; duplicates: number; pending: number; blocked: number }[];
  problems: { level: "Bloquea" | "Advertencia"; message: string }[];
  reconciliation: { label: string; value: string }[] | null;
  /** Conciliación independiente de ventas (Facturación electrónica): nunca se mezcla con la de compras. */
  salesReconciliation: { label: string; value: string }[] | null;
  totals: { documents: number; lines: number; pendingLines: number };
}

const money = (v: unknown) => (typeof v === "number" ? formatExoPesos(v) : "—");

function thirdName(d: Record<string, unknown>): string {
  const business = String(d.businessName ?? "").trim();
  if (business) return business;
  return [d.firstName, d.otherNames, d.firstSurname, d.secondSurname].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ") || String(d.thirdName ?? "");
}

function docTrace(d: DocView, format: PurchasesExoFormat, concept: string | null): AuditTraceLine[] {
  const base = { invoice: d.data.number ?? d.doc.fileName, date: d.doc.issueDate ?? "sin fecha", file: d.doc.fileName };
  if (format === "1001") return d.lines.filter((l) => !l.notApplicable && l.concept1001 === concept).map((l) => ({ ...base, detail: `Línea ${l.line.index + 1} · ${lineLabel(l.line)} · PUC ${l.pucCode}`, amountCents: l.baseCents }));
  return [{ ...base, detail: `${d.kind === "return" ? "Devolución" : "Compra"} · IVA de la factura`, amountCents: Math.abs(d.vatCents) }];
}

/** Documentos de Facturación electrónica que aportan a un registro de 1005 / 1006 (mismo tercero), con su archivo, hoja y fila. */
function salesTrace(sales: EinvoiceContribution | null | undefined, format: PurchasesExoFormat, record: ExoRecord): AuditTraceLine[] {
  if (!sales || (format !== "1005" && format !== "1006")) return [];
  const own = sales.proposals[format].filter((p) => p.data.docNumber === record.data.docNumber && p.data.docTypeCode === record.data.docTypeCode);
  return own.flatMap((p) =>
    (sales.audit[p.sourceKey] ?? []).map((l) => ({
      invoice: `${l.docType} · ${l.fileName} · ${l.sheet} fila ${l.row}`,
      date: l.issueDate,
      file: l.fileName,
      detail: `Facturación electrónica · ${format === "1006" ? "IVA de la factura (Impuesto generado)" : "IVA de la nota crédito (devolución en ventas)"} · ${l.documentId.slice(0, 12)}`,
      amountCents: Math.abs(l.ivaCents),
    })),
  );
}

export function buildPurchasesAudit(args: { model: PurchasesModel; format: PurchasesExoFormat; state: PurchasesFormatState; records: ExoRecord[]; company: { razonSocial: string; nit: string }; year: number; statusLabel: string; sales?: EinvoiceContribution | null }): PurchasesAudit {
  const { model, format, state, records, company, year, sales } = args;
  const changed = new Set(state.changes.map((c) => c.sourceKey));
  const counted = model.docs.filter((d) => d.counts && d.ready[format === "1001" ? "1001" : format]);
  const out: AuditRecord[] = records
    .slice()
    .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))
    .map((r) => {
      const [, nit = "", concept = ""] = /^third:([^|]+)\|?(.*)$/.exec(r.sourceKey) ?? [];
      const docs = counted.filter((d) => d.supplierNit === nit && (format !== "1005" || d.kind !== "return") && (format !== "1006" || d.kind === "return"));
      const trace = [...docs.flatMap((d) => docTrace(d, format, format === "1001" ? concept : null)), ...salesTrace(sales, format, r)].filter((t) => t.amountCents !== 0);
      const values = (format === "1001"
        ? [["Deducible", "deductible"], ["IVA mayor valor deducible", "ivaDeductible"], ["IVA mayor valor no deducible", "ivaNonDeductible"], ["Retención practicada", "retPracticed"], ["Retención asumida", "retAssumed"]]
        : format === "1005"
          ? [["IVA descontable (compras)", "discountable"], ["IVA por devoluciones en ventas", "salesReturns"]]
          : [["IVA recuperado en devoluciones (compras)", "purchaseReturns"], ["IVA generado (ventas)", "generated"]]
      ).map(([label, key]) => ({ label, value: money(r.data[key]) }));
      return { third: thirdName(r.data), document: String(r.data.docNumber ?? nit), concept: format === "1001" ? String(r.data.concept ?? concept) : "", values, trace, outdated: changed.has(r.sourceKey) };
    });
  const rec = model.reconciliation;
  return {
    format,
    title: `Auditoría interna · Formato ${format}`,
    company: company.razonSocial,
    nit: company.nit,
    year,
    statusLabel: args.statusLabel,
    notApplicableReason: state.notApplicableReason,
    records: out,
    coverage: model.coverage.map((c) => ({ month: monthName(c.month), purchases: c.purchases, returns: c.returns, duplicates: c.duplicates, pending: c.pending, blocked: c.blocked })),
    problems: state.problems.map((p) => ({ level: p.level === "blocking" ? "Bloquea" : "Advertencia", message: p.message })),
    reconciliation: rec.applicable
      ? [
          { label: "IVA descontable 1005", value: formatExoCents(rec.discountableCents) },
          { label: "IVA recuperado 1006", value: formatExoCents(rec.recoveredCents) },
          { label: "Neto 1005 − 1006", value: formatExoCents(rec.netVatCents) },
          { label: "IVA deducible 1001", value: formatExoCents(rec.vat1001Cents) },
          { label: "Diferencia", value: formatExoCents(rec.differenceCents) },
        ]
      : null,
    salesReconciliation:
      sales && (format === "1005" || format === "1006") && (sales.reconciliation.invoiceIvaCents || sales.reconciliation.creditNoteIvaCents)
        ? [
            { label: "IVA de Facturas electrónicas → 1006 / Impuesto generado", value: `${formatExoCents(sales.reconciliation.invoiceIvaCents)} → ${formatExoCents(sales.reconciliation.generatedCents)}` },
            { label: "IVA de Notas de crédito electrónicas → 1005 / IVA por devoluciones en ventas", value: `${formatExoCents(sales.reconciliation.creditNoteIvaCents)} → ${formatExoCents(sales.reconciliation.salesReturnsCents)}` },
          ]
        : null,
    totals: { documents: model.totals.documents, lines: model.totals.lines, pendingLines: model.totals.pendingLines },
  };
}

export const auditFileName = (company: string, format: string, year: number) => `Auditoria_${format}_${year}_${company.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40)}`;
export { DEST_LABEL };
