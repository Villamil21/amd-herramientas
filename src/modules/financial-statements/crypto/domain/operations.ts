import { cleanDocumentNumber, compareText, displayName, resolveDocumentType, type DocumentLookup, type NameParts } from "./documents";
import { fieldOfHeader, type CryptoField } from "./headers";
import type { CryptoDecision, CryptoKind, CryptoStoredRow, CryptoUpload, RowData } from "./types";

/**
 * Filas de origen → operaciones normalizadas. Una operación nunca borra ni modifica su fila: la fila se conserva tal como
 * llegó y aquí solo se interpreta. El estado (aceptada, pendiente, excluida) es siempre un cálculo, nunca un dato guardado.
 */

export type OperationStatus = "accepted" | "pending" | "excluded";
export type IssueCode = "amount" | "date" | "year" | "duplicate";

export interface RowIssue {
  code: IssueCode;
  message: string;
}

export interface Operation {
  /** Identificador interno de la fila (carga + hoja + número de fila). */
  id: string;
  uploadId: number;
  fileName: string;
  kind: CryptoKind;
  sheet: string;
  rowNumber: number;
  fingerprint: string;
  /** Identidad de la decisión del usuario: archivo | tipo | huella | ocurrencia. Cambia si la fila cambia. */
  identity: string;
  raw: RowData;
  amountCents: number | null;
  /** AAAA-MM-DD (solo Compras). */
  date: string | null;
  dateRaw: string;
  docTypeRaw: string;
  docTypeKey: string;
  /** Código DIAN, o null si el tipo de documento aún no se ha clasificado. */
  docCode: string | null;
  docNumber: string;
  sourceDv: string;
  names: NameParts;
  order: string;
  cityRaw: string;
  status: OperationStatus;
  issues: RowIssue[];
  /** Por qué quedó excluida (decisión del usuario). */
  excludedBy?: "user" | "duplicate";
}

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v).trim());

/** Valor de un campo del contrato dentro de una fila (se busca por encabezado, nunca por posición). */
export function fieldValue(kind: CryptoKind, data: RowData, field: CryptoField): string | number | undefined {
  for (const [header, value] of Object.entries(data)) if (fieldOfHeader(kind, header) === field) return value;
  return undefined;
}

export const rowId = (uploadId: number, kind: CryptoKind, rowNumber: number) => `${uploadId}:${kind}:${rowNumber}`;

/** Identidad de decisión: filas materialmente idénticas del mismo archivo se distinguen por su ocurrencia. */
export const decisionIdentity = (fileName: string, kind: CryptoKind, fingerprint: string, occurrence: number) => `${fileName}|${kind}|${fingerprint}|${occurrence}`;

export interface NormalizeContext {
  year: number;
  docLookup: DocumentLookup;
}

function normalize(row: CryptoStoredRow, upload: CryptoUpload, identity: string, ctx: NormalizeContext): Operation {
  const get = (field: CryptoField) => fieldValue(row.kind, row.data, field);
  const issues: RowIssue[] = [];
  const amountRaw = get("amount");
  let amountCents: number | null = null;
  if (typeof amountRaw === "number" && Number.isFinite(amountRaw)) amountCents = Math.round(amountRaw * 100);
  else issues.push({ code: "amount", message: amountRaw === undefined ? "Falta el valor de la operación." : `El valor «${str(amountRaw)}» no es un número válido.` });

  let date: string | null = null;
  const dateRaw = str(get("date"));
  if (row.kind === "purchase") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      date = dateRaw;
      if (Number(dateRaw.slice(0, 4)) !== ctx.year) issues.push({ code: "year", message: `La fecha ${dateRaw} no pertenece al año ${ctx.year}.` });
    } else issues.push({ code: "date", message: dateRaw ? `La fecha «${dateRaw}» no se pudo leer.` : "Falta la fecha de la compra." });
  }

  const doc = resolveDocumentType(str(get("docType")), ctx.docLookup);
  const cleaned = cleanDocumentNumber(str(get("docNumber")), doc.code);
  const names: NameParts = {
    firstSurname: str(get("firstSurname")),
    secondSurname: str(get("secondSurname")),
    firstName: str(get("firstName")),
    otherNames: str(get("otherNames")),
    businessName: str(get("businessName")),
  };
  return {
    id: rowId(upload.id, row.kind, row.rowNumber),
    uploadId: upload.id,
    fileName: upload.fileName,
    kind: row.kind,
    sheet: row.sheet,
    rowNumber: row.rowNumber,
    fingerprint: row.fingerprint,
    identity,
    raw: row.data,
    amountCents,
    date,
    dateRaw,
    docTypeRaw: doc.raw,
    docTypeKey: doc.key,
    docCode: doc.code,
    docNumber: cleaned.number,
    sourceDv: cleaned.sourceDv || (row.kind === "sale" ? str(get("dv")) : ""),
    names,
    order: str(get("order")),
    cityRaw: str(get("city")),
    status: "accepted",
    issues,
  };
}

/** Todas las operaciones de las cargas activas (las retiradas no alimentan nada), con sus problemas propios aún sin duplicados. */
export function buildOperations(uploads: readonly CryptoUpload[], rows: readonly CryptoStoredRow[], ctx: NormalizeContext): Operation[] {
  const active = new Map(uploads.filter((u) => u.status === "active").map((u) => [u.id, u]));
  const seen = new Map<string, number>();
  const out: Operation[] = [];
  const ordered = [...rows].sort((a, b) => a.uploadId - b.uploadId || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || a.rowNumber - b.rowNumber);
  for (const row of ordered) {
    const upload = active.get(row.uploadId);
    if (!upload) continue;
    const base = `${upload.fileName}|${row.kind}|${row.fingerprint}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    out.push(normalize(row, upload, decisionIdentity(upload.fileName, row.kind, row.fingerprint, occurrence), ctx));
  }
  return out;
}

/** Decisiones indexadas por clase y clave. */
export function decisionMap(decisions: readonly CryptoDecision[], kind: CryptoDecision["kind"]): Map<string, CryptoDecision> {
  return new Map(decisions.filter((d) => d.kind === kind).map((d) => [d.key, d]));
}

/** Clave comparable del nombre del tercero. */
export const nameKey = (n: NameParts) => compareText(displayName(n));
