import { describe, expect, it } from "vitest";
import type { PdfPageText, PdfTextItem } from "../../../bank-analysis/shared/pdf/pdfTypes";
import { isEmptyVat, parsePurchaseDocument } from "./purchaseParser";

const t = (text: string, x: number, y: number, size = 7.5): PdfTextItem => ({ text, x, y, width: text.length * size * 0.45, height: size });
const r = (text: string, right: number, y: number, size = 7.5) => t(text, right - text.length * size * 0.45, y, size);

const header = (y: number): PdfTextItem[] => [
  t("IMPUESTOS", 444, y + 14), t("Precio", 532, y + 14), t("unitario de", 525, y + 5), t("venta", 533, y - 3),
  t("Nro.", 34, y), t("Descripción", 100, y), t("Cantidad", 191, y), t("Precio unitario", 231, y), t("Recargo detalle", 349, y),
  t("IVA", 420, y), t("%", 454, y), t("INC", 482, y), t("%", 510, y),
];

const product = (y: number, desc: string, vat: string | null, rate: string | null, sale = "210.000,00"): PdfTextItem[] => [
  t("1", 39, y), t(desc, 90, y), t("1,00", 199, y), t("$", 228, y), r(sale, 284, y), t("$", 348, y), r("0,00", 404, y),
  t("$", 408, y), ...(vat ? [r(vat, 446, y)] : []), ...(rate ? [r(rate, 464, y)] : []), t("$", 524, y), r(sale, 563, y),
];

function pages(rows: PdfTextItem[]) {
  const first: PdfPageText = {
    pageNumber: 1, width: 595, height: 842,
    items: [
      t("FACTURA ELECTRÓNICA DE VENTA", 174, 785, 16), t("Representación Gráfica", 229, 754, 13.8), t("Datos del Documento", 70, 728, 12),
      t("Número de Factura:", 76, 682, 9.2), t("PAY-1", 163, 682, 9.8),
      t("Datos del Emisor / Vendedor", 70, 619, 12), t("Razón Social:", 76, 598, 9.2), t("PROVEEDOR SAS", 137, 598, 9.8), t("Nit del Emisor:", 76, 574, 9.2), t("900111222", 141, 574, 9.8),
      t("Datos del Adquiriente / Comprador", 70, 489, 12), t("Nombre o Razón Social:", 76, 467, 9.2), t("CLIENTE SAS", 178, 467, 9.8), t("Número Documento:", 76, 443, 9.2), t("901748281", 166, 443, 9.8),
      t("Detalles de Productos", 70, 366, 12), ...header(332), ...rows,
    ],
  };
  const second: PdfPageText = {
    pageNumber: 2, width: 595, height: 842,
    items: [
      t("Notas Finales", 70, 801, 12), t("Datos Totales", 70, 385, 12),
      t("Subtotal", 168, 330, 8.1), t("Subtotal", 382, 330, 8.1), r("210.000,00", 562, 330, 8.1),
      t("Total Bruto Factura", 168, 296, 8.1), t("Total Bruto Factura", 382, 296, 8.1), r("210.000,00", 562, 296, 8.1),
      t("IVA", 168, 285, 8.1), t("IVA", 382, 285, 8.1), r("0,00", 562, 285, 8.1),
    ],
  };
  return { pageCount: 2, pages: [first, second] };
}

const lineOf = (rows: PdfTextItem[]) => parsePurchaseDocument(pages(rows)).lines[0];

describe("IVA y porcentaje en compras", () => {
  it("ambos vacíos: IVA 0 y tarifa 0 %, sin incidencia (queda disponible para clasificar)", () => {
    const line = lineOf(product(317, "Plataforma SAAS", null, null));
    expect(line.issue).toBeUndefined();
    expect(line).toMatchObject({ vatCents: 0, rateBp: 0, baseCents: 21_000_000 });
  });

  it("cero explícito en IVA y % se lee igual, sin incidencia", () => {
    const line = lineOf(product(317, "Servicio exento", "0,00", "0,00"));
    expect(line.issue).toBeUndefined();
    expect(line).toMatchObject({ vatCents: 0, rateBp: 0 });
  });

  it("tarifa 19 % con su IVA se conserva", () => {
    expect(lineOf(product(317, "Servicio", "39.900,00", "19,00"))).toMatchObject({ vatCents: 3_990_000, rateBp: 1900 });
  });

  it("IVA con valor pero sin porcentaje: alerta y pide revisión (no asume 0)", () => {
    const line = lineOf(product(317, "Servicio", "39.900,00", null));
    expect(line.issue).toContain("%");
    expect(line.rateBp).toBeUndefined();
  });

  it("valor de IVA inválido: alerta y pide revisión", () => {
    const line = lineOf(product(317, "Servicio", "1.9.0", "19,00"));
    expect(line.issue).toContain("IVA");
    expect(line.vatCents).toBeUndefined();
  });

  it("isEmptyVat solo acepta vacío real con precio de venta", () => {
    expect(isEmptyVat({ emptyTax: true, baseCents: 1 })).toBe(true);
    expect(isEmptyVat({ emptyTax: true, baseCents: undefined })).toBe(false);
    expect(isEmptyVat({ emptyTax: true, rateBp: 0, baseCents: 1 })).toBe(false);
    expect(isEmptyVat({ emptyTax: undefined, baseCents: 1 })).toBe(false);
  });
});
