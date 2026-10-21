import type { EinvoiceCategory, EinvoiceDocInput } from "../../../types/einvoice";
import type { SalesDocCategory } from "../../../types/fs";
import { einvoiceDocumentId, exoBaseCents, type EInvoiceRow, type ExoScope } from "./readers";

/**
 * Clasificación de los documentos importados y su destino. Una fila con error o con un tipo de documento sin clasificar NO va a
 * ningún destino (ni EEFF ni 1007 / 1005 / 1006) hasta que se resuelva; «ignorar» excluye de EEFF y de Exógena a la vez.
 */
export interface EInvoiceClassification {
  /** Documentos que van a EEFF y a Exógena. */
  counted: EInvoiceRow[];
  ignored: EInvoiceRow[];
  issues: EInvoiceRow[];
  /** Tipos de documento que nadie ha clasificado: [clave normalizada, texto original]. */
  unknownTypes: [string, string][];
  /** Documentos afectados por cada tipo sin clasificar. */
  unknownDocuments: Record<string, EInvoiceRow[]>;
}

export function classifyEInvoice(rows: readonly EInvoiceRow[], types: ReadonlyMap<string, SalesDocCategory>): EInvoiceClassification {
  const unknown = new Map<string, [string, EInvoiceRow[]]>();
  for (const r of rows) {
    if (!r.docType || types.has(r.docTypeKey)) continue;
    const entry = unknown.get(r.docTypeKey) ?? [r.docType, []];
    entry[1].push(r);
    unknown.set(r.docTypeKey, entry);
  }
  return {
    counted: rows.filter((r) => !r.issue && types.get(r.docTypeKey) && types.get(r.docTypeKey) !== "ignore"),
    ignored: rows.filter((r) => types.get(r.docTypeKey) === "ignore"),
    issues: rows.filter((r) => r.issue),
    unknownTypes: [...unknown.entries()].map(([key, [label]]) => [key, label]),
    unknownDocuments: Object.fromEntries([...unknown.entries()].map(([key, [, docs]]) => [key, docs])),
  };
}

/** Valor que un documento aporta a Estados Financieros: la base (Total − IVA … Rete ICA) en positivo; la devolución resta. */
export const eeffAmountCents = (row: Pick<EInvoiceRow, "baseCents">, category: SalesDocCategory | undefined): number => (category === "return" ? -1 : 1) * Math.abs(row.baseCents);

/**
 * Detalle que se guarda para Exógena. Un documento repetido dentro del archivo cuenta una sola vez (mismo identificador fuerte);
 * el año de cada uno lo decide su fecha de emisión al guardarse, no el archivo.
 */
export function toExoDocs(counted: readonly EInvoiceRow[], types: ReadonlyMap<string, SalesDocCategory>, fileName: string, taxColumns: readonly string[], scope: ExoScope | undefined): EinvoiceDocInput[] {
  const seen = new Set<string>();
  const out: EinvoiceDocInput[] = [];
  for (const r of counted) {
    const documentId = einvoiceDocumentId(r);
    if (seen.has(documentId)) continue;
    seen.add(documentId);
    out.push({
      documentId,
      issueDate: r.issueDate!,
      docType: r.docType,
      docTypeKey: r.docTypeKey,
      category: (types.get(r.docTypeKey) === "return" ? "return" : "sale") as EinvoiceCategory,
      number: r.number,
      fileName,
      sheet: r.sheet,
      rowNumber: r.rowNumber,
      status: r.status,
      receiverNitRaw: r.receiverNit,
      receiverName: r.receiverName,
      totalCents: r.totalCents,
      ivaCents: r.ivaCents,
      eeffBaseCents: r.baseCents,
      eeffColumns: [...taxColumns],
      exoBaseCents: scope ? exoBaseCents(r, scope) : null,
      exoColumns: scope ? [...scope.columns] : [],
    });
  }
  return out;
}
