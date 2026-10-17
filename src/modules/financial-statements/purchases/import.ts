import { call, errorMessage } from "../../../services/tauri";
import type { ParsedPurchase, PurchaseDocFileInput, ReplaceFile, SavePurchaseUploadInput, UploadSummary } from "../../../types/purchases";
import { normalizeKey } from "../../../utils/text";
import { extractPdfText } from "../../bank-analysis/shared/pdf/pdfExtractor";
import { StatementError } from "../../bank-analysis/shared/types";
import { InvoiceFormatError } from "../../taxes/invoice-vat/parser/invoiceParser";
import { nitDigits } from "../../exogena/domain/text";
import { numberKey, parsePurchaseDocument } from "./parser/purchaseParser";

export { pickInvoiceFolder, type InvoiceFolder } from "../../taxes/invoice-vat/services/invoiceFolderService";

/**
 * Importación de una carpeta de facturas: lee cada PDF, deduce la empresa (NIT de «Datos del adquiriente / comprador») y el año
 * (fecha de expedición) sin pedirlos, y agrupa por NIT comprador. Una carga corresponde a un único NIT comprador: el de la
 * mayoría de las facturas; las demás son excepciones que se señalan y solo se guardan si el usuario lo pide, cada una en su
 * propia carga.
 */

export type ReadResult =
  | { fileName: string; kind: "parsed"; data: ParsedPurchase }
  | { fileName: string; kind: "incompatible" | "error"; message: string };

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

async function readFile(fileName: string): Promise<ReadResult> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await call<ArrayBuffer>("read_invoice_pdf", { fileName }));
  } catch (e) {
    return { fileName, kind: "error", message: errorMessage(e) };
  }
  try {
    return { fileName, kind: "parsed", data: parsePurchaseDocument(await extractPdfText(bytes)) };
  } catch (e) {
    if (e instanceof InvoiceFormatError) return { fileName, kind: "incompatible", message: e.message };
    if (e instanceof StatementError) return { fileName, kind: "error", message: e.message };
    if (import.meta.env.DEV) console.error("[compras]", fileName, e);
    return { fileName, kind: "error", message: "No fue posible leer el documento. Verifica que el archivo no esté dañado." };
  }
}

/** Lee los archivos uno a uno; un archivo con problemas no detiene la carpeta. */
export async function readFolder(files: string[], onProgress: (done: number, total: number) => void, isCancelled: () => boolean): Promise<ReadResult[]> {
  const out: ReadResult[] = [];
  for (const [i, name] of files.entries()) {
    if (isCancelled()) break;
    out.push(await readFile(name));
    onProgress(i + 1, files.length);
    await nextFrame();
  }
  return out;
}

/** Huella corta y estable del contenido (FNV-1a de 32 bits en hexadecimal ×2 con dos semillas). */
function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

export function toDocInput(fileName: string, data: ParsedPurchase): PurchaseDocFileInput {
  const issuerNit = nitDigits(data.issuer.nit);
  const buyerNit = nitDigits(data.buyerNit ?? "");
  const issueDate = data.issueDate ?? null;
  const total = data.totalCents ?? null;
  return {
    fileName,
    buyerNit,
    buyerName: data.buyerName ?? "",
    year: issueDate ? Number(issueDate.slice(0, 4)) : null,
    issueDate,
    issuerNit,
    issuerName: data.issuer.name,
    numberKey: numberKey(data.number),
    totalCents: total,
    titleKey: normalizeKey(data.title),
    cufe: data.cufe ?? null,
    fingerprint: hash(JSON.stringify([issuerNit, numberKey(data.number), issueDate, total, data.lines.map((l) => [l.baseCents, l.vatCents, normalizeKey(l.description)])])),
    data,
  };
}

export interface FolderPlan {
  /** NIT comprador principal de la carpeta (el más frecuente). */
  dominantNit: string | null;
  /** Facturas del NIT principal. */
  main: PurchaseDocFileInput[];
  /** Facturas de otros NIT, agrupadas por NIT (excepciones). */
  others: { buyerNit: string; buyerName: string; files: PurchaseDocFileInput[] }[];
  /** Sin NIT del adquiriente: no se pueden ubicar en ninguna empresa. */
  noBuyer: { fileName: string }[];
  unreadable: NonNullable<UploadSummary["unreadable"]>;
}

export function planFolder(results: readonly ReadResult[]): FolderPlan {
  const unreadable: FolderPlan["unreadable"] = [];
  const docs: PurchaseDocFileInput[] = [];
  const noBuyer: FolderPlan["noBuyer"] = [];
  for (const r of results) {
    if (r.kind !== "parsed") {
      unreadable.push({ fileName: r.fileName, kind: r.kind, message: r.message });
      continue;
    }
    const input = toDocInput(r.fileName, r.data);
    if (!input.buyerNit) noBuyer.push({ fileName: r.fileName });
    else docs.push(input);
  }
  const byNit = new Map<string, PurchaseDocFileInput[]>();
  for (const d of docs) byNit.set(d.buyerNit, [...(byNit.get(d.buyerNit) ?? []), d]);
  const ranked = [...byNit.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const dominantNit = ranked[0]?.[0] ?? null;
  return {
    dominantNit,
    main: ranked[0]?.[1] ?? [],
    others: ranked.slice(1).map(([buyerNit, files]) => ({ buyerNit, buyerName: files[0].buyerName, files })),
    noBuyer,
    unreadable,
  };
}

/** Carga lista para guardar: un NIT comprador, con el resumen de lo que no entró. */
export function uploadFor(folderName: string, buyerNit: string, files: PurchaseDocFileInput[], plan: FolderPlan, includeSummary: boolean): SavePurchaseUploadInput {
  const byScope = new Map<string, { buyerNit: string; year: number | null; count: number }>();
  for (const f of files) {
    const key = String(f.year);
    const e = byScope.get(key) ?? { buyerNit, year: f.year, count: 0 };
    e.count += 1;
    byScope.set(key, e);
  }
  const summary: UploadSummary = {
    byScope: [...byScope.values()].sort((a, b) => (a.year ?? 0) - (b.year ?? 0)),
    ...(includeSummary
      ? {
          unreadable: plan.unreadable,
          dominantNit: plan.dominantNit ?? undefined,
          exceptions: plan.others.flatMap((o) => o.files.map((f) => ({ fileName: f.fileName, buyerNit: o.buyerNit }))).concat(plan.noBuyer.map((n) => ({ fileName: n.fileName, buyerNit: "" }))),
        }
      : {}),
  };
  return { folderName, buyerNit, files, summary };
}

/** Huellas de contenido de la carpeta: con ellas se busca una carga vigente idéntica (no depende de nombres ni del orden). */
export const folderFingerprints = (files: readonly PurchaseDocFileInput[]): string[] => files.map((f) => f.fingerprint);

/** Nombre de cada archivo y huella de su contenido: lo único que cambia al reemplazar una carga idéntica. */
export const replaceFilesOf = (files: readonly PurchaseDocFileInput[]): ReplaceFile[] => files.map((f) => ({ fileName: f.fileName, fingerprint: f.fingerprint }));
