import type { TextRow } from "../../../bank-analysis/shared/pdf/rows";
import { DETAILS_HEADING, findField, ISSUER_HEADING, normalizeNit, qrField, rowKey, rowText, type PageRows } from "../../../taxes/invoice-vat/parser/invoiceParser";

/**
 * Lectura del adquiriente (NIT y nombre) y del CUFE / CUDE de una factura electrónica. Los usa el lector de Compras, costos y
 * exógena para ubicar cada factura en su empresa y detectar duplicados.
 */

const BUYER_HEADING = /^datos del (adquiriente|adquirente|comprador|cliente)/;
const BUYER_NIT_LABEL = /^(n[uú]mero( de)? documento|nit( del)?( adquiriente| adquirente| comprador| cliente)?|identificaci[oó]n)\s*:/i;
const BUYER_NAME_LABEL = /^(nombre o raz[oó]n social|raz[oó]n social|nombre( del)?( adquiriente| comprador| cliente)?)\s*:/i;
const CUFE_LABEL = /\b(cufe|cude)\b/;
const HEX = /^[0-9a-f]+$/i;
/** SHA-384 en hexadecimal (96 caracteres); se admite desde SHA-256 por si la plantilla cambia. */
const validCufe = (value: string) => value.length >= 64 && value.length <= 128 && HEX.test(value);

/**
 * CUFE / CUDE de «Datos del Documento»: el valor va junto a su etiqueta o en
 * las líneas siguientes (puede partirse en dos). Respaldo: el texto del QR.
 */
export function readCufe(documentRows: TextRow[], pages: PageRows[]): string | undefined {
  const index = documentRows.findIndex((r) => CUFE_LABEL.test(rowKey(r)));
  if (index !== -1) {
    const sameRow = rowText(documentRows[index]).split(":").pop()!.replace(/\s/g, "");
    let value = HEX.test(sameRow) ? sameRow : "";
    for (let i = index + 1; i < documentRows.length && value.length < 96; i++) {
      const text = rowText(documentRows[i]).replace(/\s/g, "");
      if (!HEX.test(text)) break;
      value += text;
    }
    if (validCufe(value)) return value.toLowerCase();
  }
  const qr = qrField(pages, "CUFE") ?? qrField(pages, "CUDE");
  return qr && validCufe(qr) ? qr.toLowerCase() : undefined;
}

/**
 * «Datos del Adquiriente / Comprador»: NIT (Número Documento) y nombre. Con
 * ellos se relaciona la factura con una Empresa guardada (por NIT; el nombre
 * solo valida). Respaldo del NIT: el texto del QR (NitAdq).
 */
export function readBuyer(pages: PageRows[]): { nit?: string; name?: string } {
  for (const p of pages) {
    const start = p.rows.findIndex((r) => BUYER_HEADING.test(rowKey(r)));
    if (start === -1) continue;
    const section: TextRow[] = [];
    for (let i = start + 1; i < p.rows.length; i++) {
      const key = rowKey(p.rows[i]);
      if (DETAILS_HEADING.test(key) || ISSUER_HEADING.test(key) || /^datos (del|de la|de los) /.test(key)) break;
      section.push(p.rows[i]);
    }
    const nit = findField(section, BUYER_NIT_LABEL);
    const name = findField(section, BUYER_NAME_LABEL);
    return { nit: nit ? normalizeNit(nit) || undefined : undefined, name: name || undefined };
  }
  const qr = qrField(pages, "NitAdq");
  return { nit: qr ? normalizeNit(qr) || undefined : undefined };
}
