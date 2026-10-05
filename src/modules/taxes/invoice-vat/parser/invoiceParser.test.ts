import { describe, expect, it } from "vitest";
import type { PdfPageText, PdfTextItem } from "../../../bank-analysis/shared/pdf/pdfTypes";
import { parseCopAmount, parseRate } from "./amounts";
import { InvoiceFormatError, parseInvoice } from "./invoiceParser";

/** Texto con el ancho proporcional a los caracteres (como estima splitWords). */
const t = (text: string, x: number, y: number, size = 7.5): PdfTextItem => ({ text, x, y, width: text.length * size * 0.45, height: size });
/** Valor alineado a la derecha en `right`. */
const r = (text: string, right: number, y: number, size = 7.5) => t(text, right - text.length * size * 0.45, y, size);

function header(y: number): PdfTextItem[] {
  return [
    t("IMPUESTOS", 444, y + 14), t("Precio", 532, y + 14), t("unitario de", 525, y + 5), t("venta", 533, y - 3),
    t("Nro.", 34, y), t("Descripción", 100, y), t("Cantidad", 191, y), t("Precio unitario", 231, y), t("Recargo detalle", 349, y),
    t("IVA", 420, y), t("%", 454, y), t("INC", 482, y), t("%", 510, y),
  ];
}

function product(y: number, n: number, desc: string, vat: string | null, rate: string | null, sale: string | null): PdfTextItem[] {
  return [
    t(String(n), 39, y), t(desc, 90, y), t("1,00", 199, y), t("$", 228, y), r(sale ?? "1,00", 284, y), t("$", 348, y), r("0,00", 404, y),
    t("$", 408, y), ...(vat ? [r(vat, 446, y)] : []), ...(rate ? [r(rate, 464, y)] : []), t("$", 524, y), ...(sale ? [r(sale, 563, y)] : []),
  ];
}

function firstPage(title: string, nit: string, name: string, number: string, rows: PdfTextItem[], pages: number): PdfPageText {
  return {
    pageNumber: 1,
    width: 595,
    height: 842,
    items: [
      t(title, 174, 785, 16),
      t("Representación Gráfica", 229, 754, 13.8),
      t("Datos del Documento", 70, 728, 12),
      t("Número de Factura:", 76, 682, 9.2), t(number, 163, 682, 9.8), t("Forma de pago:", 298, 682, 9.2), t("Contado", 368, 682, 9.8),
      t("Datos del Emisor / Vendedor", 70, 619, 12),
      t("Razón Social:", 76, 598, 9.2), t(name, 137, 598, 9.8),
      t("Nit del Emisor:", 76, 574, 9.2), t(nit, 141, 574, 9.8), t("País:", 298, 574, 9.2), t("Colombia", 324, 574, 9.8),
      t("Datos del Adquiriente / Comprador", 70, 489, 12),
      t("Nombre o Razón Social:", 76, 467, 9.2), t("CLIENTE SAS", 178, 467, 9.8),
      t("Número Documento:", 76, 443, 9.2), t("901748281", 166, 443, 9.8),
      t("Detalles de Productos", 70, 366, 12),
      ...header(332),
      ...rows,
      t(`Hoja 1 de ${pages}`, 505, 18, 13.4),
    ],
  };
}

function totalsPage(n: number, pages: number, subtotal: string, vat: string, before: PdfTextItem[] = []): PdfPageText {
  return {
    pageNumber: n,
    width: 595,
    height: 842,
    items: [
      ...before,
      t("Notas Finales", 70, 801, 12),
      t("NumFac: X ValIva: 1.00", 30, 676, 9.8),
      t("Datos Totales", 70, 385, 12),
      t("Subtotal", 168, 330, 8.1), t("Subtotal", 382, 330, 8.1), r(subtotal, 562, 330, 8.1),
      t("Total Bruto Factura", 168, 296, 8.1), t("Total Bruto Factura", 382, 296, 8.1), r(subtotal, 562, 296, 8.1),
      t("IVA", 168, 285, 8.1), t("IVA", 382, 285, 8.1), r(vat, 562, 285, 8.1),
      t("Total factura (=)", 168, 197, 8.1), t("Total factura (=)", 382, 197, 8.1), r("999.999,00", 562, 197, 8.1),
      t("Rete IVA", 166, 101, 8.1), r("0,00", 348, 101, 8.1), t("Rete IVA", 380, 101, 8.1), r("7,00", 562, 101, 8.1),
      t(`Hoja ${n} de ${pages}`, 505, 18, 13.4),
    ],
  };
}

describe("importes", () => {
  it("interpreta el formato colombiano sin parseFloat", () => {
    expect(parseCopAmount("133.238,00")).toBe(13_323_800);
    expect(parseCopAmount("0,00")).toBe(0);
    expect(parseCopAmount("$1.234.567,5")).toBe(123_456_750);
    expect(parseCopAmount("-6.662,00")).toBe(-666_200);
    expect(parseCopAmount("5.00")).toBeNull();
    expect(parseCopAmount("12.34.567")).toBeNull();
  });

  it("interpreta la columna %", () => {
    expect(parseRate("19.00")).toBe(1900);
    expect(parseRate("5,00")).toBe(500);
    expect(parseRate("0.00")).toBe(0);
    expect(parseRate("8.5")).toBe(850);
    expect(parseRate("190.00")).toBeNull();
  });
});

describe("parseInvoice", () => {
  it("lee título, emisor, número y la tabla cuando continúa en otra página (sin encabezado repetido)", () => {
    const page1 = firstPage("NOTA ELECTRÓNICA DE VENTA", "800.123.456-7", "PROVEEDOR B S.A.S.", "NE-10", [
      ...product(317, 1, "Servicio A", "1.900,00", "19.00", "10.000,00"),
      ...product(306, 2, "Exento", "0,00", "0.00", "5.000,00"),
    ], 2);
    const page2 = totalsPage(2, 2, "35.000,00", "5.700,00", [
      t("NOTA ELECTRÓNICA DE VENTA", 174, 815, 16),
      ...product(790, 3, "Servicio B", "3.800,00", "19.00", "20.000,00"),
      t("continuación de la descripción", 90, 780),
    ]);
    const inv = parseInvoice({ pageCount: 2, pages: [page1, { ...page2, items: page2.items.map((i) => (i.text === "Notas Finales" ? { ...i, y: 760 } : i)) }] });
    expect(inv).toMatchObject({ documentType: "NOTA ELECTRÓNICA DE VENTA", supplierNit: "800123456", supplierName: "PROVEEDOR B S.A.S.", invoiceNumber: "NE-10" });
    expect(inv.lines.map((l) => [l.page, l.rateBp, l.vatCents, l.baseCents])).toEqual([
      [1, 1900, 190_000, 1_000_000],
      [1, 0, 0, 500_000],
      [2, 1900, 380_000, 2_000_000],
    ]);
    expect(inv.lineIssues).toEqual([]);
    // Detalle de productos: todas las filas de ambas páginas, solo con la columna «Descripción» y los valores de las líneas.
    expect(inv.products).toEqual([
      { page: 1, description: "Servicio A", rateBp: 1900, vatCents: 190_000, baseCents: 1_000_000 },
      { page: 1, description: "Exento", rateBp: 0, vatCents: 0, baseCents: 500_000 },
      { page: 2, description: "Servicio Bcontinuación de la descripción", rateBp: 1900, vatCents: 380_000, baseCents: 2_000_000 },
    ]);
    expect(inv.products).toEqual(inv.lines);
    // Datos Totales: la caja con valores (derecha); «Rete IVA» y «Total factura» no se confunden con IVA.
    expect(inv).toMatchObject({ subtotalCents: 3_500_000, grossTotalCents: 3_500_000, invoiceVatCents: 570_000 });
  });

  it("re-ubica las columnas si el encabezado se repite en la página siguiente", () => {
    const page1 = firstPage("FACTURA ELECTRÓNICA DE VENTA", "900", "A", "F-1", product(317, 1, "Uno", "500,00", "5.00", "10.000,00"), 2);
    const shifted = (items: PdfTextItem[]) => items.map((i) => ({ ...i, x: i.x - 6 }));
    const page2: PdfPageText = {
      pageNumber: 2, width: 595, height: 842,
      items: [t("Detalles de Productos", 70, 800, 12), ...shifted(header(770)), ...shifted(product(755, 2, "Dos", "1.000,00", "10.00", "10.000,00")), t("Datos Totales", 70, 385, 12), t("Hoja 2 de 2", 505, 18, 13.4)],
    };
    const inv = parseInvoice({ pageCount: 2, pages: [page1, page2] });
    expect(inv.lines.map((l) => l.rateBp)).toEqual([500, 1000]);
  });

  it("marca filas sin tarifa o sin precio de venta y no inventa datos", () => {
    const inv = parseInvoice({
      pageCount: 1,
      pages: [firstPage("FACTURA ELECTRÓNICA DE VENTA", "900", "A", "F-1", [
        ...product(317, 1, "Sin tarifa", "190,00", null, "1.000,00"),
        ...product(306, 2, "Sin precio de venta", "190,00", "19.00", null),
        ...product(296, 3, "Cero sin IVA impreso", null, "0.00", "2.000,00"),
      ], 1)],
    });
    expect(inv.lines.map((l) => [l.rateBp, l.vatCents, l.baseCents])).toEqual([[0, 0, 200_000]]);
    expect(inv.lineIssues.map((i) => i.reason)).toEqual(["No se pudo identificar: %.", "No se pudo identificar: Precio unitario de venta."]);
    // Las filas incompletas siguen en el detalle, en su orden, con lo que sí se leyó.
    expect(inv.products).toEqual([
      { page: 1, description: "Sin tarifa", rateBp: undefined, vatCents: 19_000, baseCents: 100_000 },
      { page: 1, description: "Sin precio de venta", rateBp: 1900, vatCents: 19_000, baseCents: undefined },
      { page: 1, description: "Cero sin IVA impreso", rateBp: 0, vatCents: 0, baseCents: 200_000 },
    ]);
  });

  it("rechaza PDF sin la tabla o sin texto", () => {
    expect(() => parseInvoice({ pageCount: 1, pages: [{ pageNumber: 1, width: 595, height: 842, items: [] }] })).toThrow(InvoiceFormatError);
    expect(() => parseInvoice({ pageCount: 1, pages: [{ pageNumber: 1, width: 595, height: 842, items: [t("Extracto bancario", 70, 700, 12)] }] })).toThrow(/Detalles de Productos/);
  });
});
