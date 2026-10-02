import { describe, expect, it } from "vitest";
import type { Cell, Workbook } from "../../../../types/excel";
import type { Company } from "../../../../types/models";
import { analyzeWorkbook } from "./excelAnalysis";
import { certificateFileName, certificateTitle, resolveTipo, retainedCents } from "./calculations";
import { buildCertificateDocument, validateCertificate, type CertificateConceptLine } from "./certificateModel";
import { parseNumericText } from "../../../../utils/numbers";
import { formatMoneyCents, formatRate } from "../../../../utils/format";

// ---------- Utilidades para construir libros de prueba ----------

const HEADERS = [
  "Tipo de documento", "CUFE/CUDE", "Folio", "Prefijo", "Divisa", "Forma de Pago", "Medio de Pago",
  "Fecha Emisión", "Fecha Recepción", "NIT Emisor", "Nombre Emisor", "NIT Receptor", "Nombre Receptor",
  "IVA", "ICA", "IC", "INC", "Timbre", "INC Bolsas", "IN Carbono", "IN Combustibles", "IC Datos", "ICL",
  "INPP", "IBUA", "ICUI", "Rete IVA", "Rete Renta", "Rete ICA", "Total", "Estado", "Grupo",
];

const s = (v: string): Cell => ({ t: "s", v });
const n = (v: number): Cell => ({ t: "n", v });
const E: Cell = { t: "e" };

interface RowSpec {
  tipo?: string;
  fecha?: string;
  nit?: string;
  nombre?: string;
  iva?: number;
  total: number | string;
  rete?: Partial<Record<"Rete IVA" | "Rete Renta" | "Rete ICA", number>>;
}

function row(spec: RowSpec): Cell[] {
  const cells: Cell[] = HEADERS.map(() => n(0));
  const set = (h: string, c: Cell) => (cells[HEADERS.indexOf(h)] = c);
  set("Tipo de documento", s(spec.tipo ?? "Factura electrónica"));
  set("CUFE/CUDE", s("abc"));
  set("Fecha Emisión", s(spec.fecha ?? "30-04-2026"));
  set("NIT Emisor", s(spec.nit ?? "901398069"));
  set("Nombre Emisor", s(spec.nombre ?? "RETENIDO DE PRUEBA S.A.S."));
  set("Nombre Receptor", s("EMISORA"));
  set("IVA", n(spec.iva ?? 0));
  set("Total", typeof spec.total === "number" ? n(spec.total) : s(spec.total));
  for (const [k, v] of Object.entries(spec.rete ?? {})) set(k, n(v!));
  set("Estado", s("Aprobado"));
  set("Grupo", s("Recibido"));
  return cells;
}

function book(...rows: RowSpec[]): Workbook {
  return { fileName: "prueba.xlsx", sheets: [{ name: "Hoja1", rows: [HEADERS.map(s), ...rows.map(row)] }] };
}

const company: Company = {
  id: 1, razonSocial: "EMISORA DE PRUEBA", nit: "800000001", direccion: "Calle 1", ciudad: "Cali",
  telefono: "300", correo: "", infoAdicional: "", logoFile: null, dv: "", subscribedTotalShares: null, subscribedNominalValue: null, paidTotalShares: null, paidNominalValue: null, ciiuCode: "", shareholders: [], createdAt: "", updatedAt: "",
};

const ica: CertificateConceptLine = {
  key: "a", conceptId: 1, nombre: "ICA APLICADO A SERVICIOS DECLARANTES", tipo: "ICA", unidad: "POR_MIL", rateText: "9,66",
};
const rete: CertificateConceptLine = {
  key: "b", conceptId: 2, nombre: "RETENCIÓN EN LA FUENTE POR SERVICIOS", tipo: "RETEFUENTE", unidad: "PORCENTAJE", rateText: "4",
};

function doc(workbook: Workbook, lines: CertificateConceptLine[]) {
  const analysis = analyzeWorkbook(workbook);
  const input = { company, logoDataUrl: null, analysis, lines, consignadoEn: "Cali", generatedAt: new Date(2026, 5, 18, 15, 27, 1) };
  expect(validateCertificate(input)).toEqual([]);
  return buildCertificateDocument(input);
}

// ---------- Archivo de referencia ----------

describe("Excel de referencia (Facturacion Obedservices.xlsx)", () => {
  // Mismos valores del archivo real: fechas como texto, montos numéricos, filas vacías al final.
  const reference = book(
    { fecha: "30-04-2026", nombre: "MONO COLOMBIA S.A.S.", iva: 224580, total: 1406580 },
    { fecha: "31-03-2026", nombre: "MONO COLOMBIA S.A.S.", iva: 232560, total: 1456560 },
    { fecha: "02-03-2026", nombre: "MONO COLOMBIA S.A.S.", iva: 285000, total: 1785000 },
  );
  reference.sheets[0].rows.push(HEADERS.map(() => E), HEADERS.map(() => E));

  it("calcula base 3.906.000, periodo y retención ICA 9,66 ‰ = 37.732", () => {
    const a = analyzeWorkbook(reference);
    expect(a.errors).toEqual([]);
    expect(a.documents).toHaveLength(3);
    expect(a.baseCents).toBe(3_906_000_00);
    expect(a.period?.label).toBe("01-MARZO-2026 A 30-ABRIL-2026");
    expect(a.retenido).toEqual({ nombre: "MONO COLOMBIA S.A.S.", nit: "901398069" });
    expect(retainedCents(a.baseCents, 9.66, "POR_MIL")).toBe(37_732_00);

    const d = doc(reference, [ica]);
    expect(d.title).toBe("CERTIFICADO DE ICA A TÍTULO DE RENTA");
    expect(d.rows[0]).toMatchObject({ tasa: "9,66", base: "$ 3.906.000,00", valor: "$ 37.732,00" });
    expect(d.rateHeader).toBe("TASA ‰");
    expect(d.info.find((i) => i.label === "FECHA Y HORA DE GENERACIÓN")?.value).toBe("2026-06-18 15:27:01");
    expect(d.info.find((i) => i.label === "CONSIGNADO EN")?.value).toBe("CALI");
    expect(d.fileName).toBe("Certificado_ICA_MONO_COLOMBIA_2026-03_2026-04.pdf");
  });

  it("no interpreta 9,66 como porcentaje", () => {
    expect(retainedCents(3_906_000_00, 9.66, "PORCENTAJE")).toBe(377_320_00);
    expect(retainedCents(3_906_000_00, 9.66, "POR_MIL")).toBe(37_732_00);
  });
});

// ---------- Pruebas obligatorias ----------

describe("Casos obligatorios", () => {
  it("Caso 1 — solo facturas: la base es la suma de todas", () => {
    const a = analyzeWorkbook(book({ total: 1000, iva: 190 }, { total: 2000 }, { total: 500.5 }));
    expect(a.errors).toEqual([]);
    expect(a.invoiceCount).toBe(3);
    expect(a.baseCents).toBe((810 + 2000 + 500.5) * 100);
  });

  it("Caso 2 — la factura suma y la nota crédito resta", () => {
    const a = analyzeWorkbook(
      book({ total: 1190, iva: 190 }, { tipo: "Nota Crédito electrónica", total: 238, iva: 38 }),
    );
    expect(a.errors).toEqual([]);
    expect(a.creditNoteCount).toBe(1);
    expect(a.baseCents).toBe((1000 - 200) * 100);
  });

  it("Caso 2b — tipo de documento sin distinguir mayúsculas ni espacios", () => {
    const a = analyzeWorkbook(book({ total: 1000 }, { tipo: "  nota   CRÉDITO electrónica ", total: 100 }));
    expect(a.errors).toEqual([]);
    expect(a.baseCents).toBe(900_00);
  });

  it("Caso 3 — dos meses: 01-MARZO-2026 A 30-ABRIL-2026", () => {
    const a = analyzeWorkbook(book({ fecha: "31-03-2026", total: 1 }, { fecha: "30-04-2026", total: 1 }));
    expect(a.period?.label).toBe("01-MARZO-2026 A 30-ABRIL-2026");
  });

  it("Caso 3b — un solo día y meses no contiguos", () => {
    expect(analyzeWorkbook(book({ fecha: "30-04-2026", total: 1 })).period?.label).toBe(
      "01-ABRIL-2026 A 30-ABRIL-2026",
    );
    expect(
      analyzeWorkbook(book({ fecha: "08-03-2026", total: 1 }, { fecha: "15-01-2026", total: 1 })).period?.label,
    ).toBe("01-ENERO-2026 A 08-MARZO-2026");
  });

  it("Caso 4 — NIT diferentes bloquea la generación", () => {
    const a = analyzeWorkbook(book({ total: 1, nit: "901398069" }, { total: 1, nit: "900123456" }));
    expect(a.errors.map((e) => e.message)).toContain("Se encontraron varios NIT de emisores dentro del archivo.");
    expect(a.errors[0].details?.join(" ")).toContain("900123456");
    expect(
      validateCertificate({ company, logoDataUrl: null, analysis: a, lines: [ica], consignadoEn: "CALI" }),
    ).toContain("Corrige los errores del archivo Excel.");
  });

  it("Caso 5 — valores en Rete IVA / Rete Renta / Rete ICA generan alerta", () => {
    const a = analyzeWorkbook(book({ total: 1000 }, { total: 1000, rete: { "Rete Renta": 40, "Rete ICA": 9.66 } }));
    expect(a.errors).toEqual([]);
    expect(a.priorRetentions).toEqual([
      { row: 3, column: "Rete Renta", cents: 4000 },
      { row: 3, column: "Rete ICA", cents: 966 },
    ]);
  });

  it("Caso 6 — varios conceptos generan varias filas", () => {
    const d = doc(book({ total: 3_906_000 }), [ica, rete]);
    expect(d.rows).toHaveLength(2);
    expect(d.rows[1]).toMatchObject({ index: 2, tasa: "4 %", valor: "$ 156.240,00" });
    expect(d.rows[0].tasa).toBe("9,66 ‰");
    expect(d.rateHeader).toBe("TASA");
  });

  it("Caso 7 — solo ICA", () => {
    expect(doc(book({ total: 100 }), [ica]).title).toBe("CERTIFICADO DE ICA A TÍTULO DE RENTA");
  });

  it("Caso 8 — solo retención en la fuente", () => {
    const d = doc(book({ total: 100 }), [rete]);
    expect(d.title).toBe("CERTIFICADO DE RETENCIÓN A TÍTULO DE RENTA");
    expect(d.rateHeader).toBe("TASA %");
  });

  it("Caso 9 — ICA + retención", () => {
    expect(certificateTitle(["ICA", "RETEFUENTE"])).toBe("CERTIFICADO DE RETENCIÓN E ICA A TÍTULO DE RENTA");
    expect(doc(book({ total: 100 }), [rete, ica]).title).toBe("CERTIFICADO DE RETENCIÓN E ICA A TÍTULO DE RENTA");
  });
});

// ---------- Validaciones del archivo ----------

describe("Validaciones del Excel", () => {
  it("tipo de documento desconocido: alerta con fila y tipo", () => {
    const a = analyzeWorkbook(book({ total: 1 }, { tipo: "Nota Débito electrónica", total: 1 }));
    expect(a.errors[0].message).toBe("Tipo de documento no reconocido: «Nota Débito electrónica».");
    expect(a.errors[0].details?.[0]).toBe("Filas: 3.");
  });

  it("Total no numérico: mensaje comprensible con número de fila", () => {
    const a = analyzeWorkbook(book({ total: 1 }, { total: "abc" }));
    expect(a.errors[0].details).toContain("La fila 3 contiene un valor no válido en la columna Total.");
  });

  it("columnas faltantes", () => {
    const wb = book({ total: 1 });
    wb.sheets[0].rows[0][HEADERS.indexOf("ICUI")] = s("Otra");
    const a = analyzeWorkbook(wb);
    expect(a.errors[0].message).toBe("Faltan columnas necesarias en el archivo.");
    expect(a.errors[0].details).toEqual(["Columna «ICUI»"]);
  });

  it("identifica columnas por nombre aunque cambien de posición", () => {
    const wb = book({ total: 1190, iva: 190 });
    for (const r of wb.sheets[0].rows) r.reverse();
    expect(analyzeWorkbook(wb).baseCents).toBe(1000_00);
  });

  it("celdas de impuestos vacías cuentan como cero", () => {
    const wb = book({ total: 500 });
    wb.sheets[0].rows[1][HEADERS.indexOf("IVA")] = E;
    const a = analyzeWorkbook(wb);
    expect(a.errors).toEqual([]);
    expect(a.baseCents).toBe(500_00);
  });

  it("fecha inválida bloquea", () => {
    const a = analyzeWorkbook(book({ total: 1, fecha: "31-02-2026" }));
    expect(a.errors[0].details?.[0]).toContain("fecha válida");
  });

  it("base negativa bloquea", () => {
    const a = analyzeWorkbook(book({ total: 100 }, { tipo: "Nota Crédito electrónica", total: 300 }));
    expect(a.errors[0].message).toContain("La base de retención calculada es -$ 200,00");
  });
});

// ---------- Números, formatos y utilidades ----------

describe("Números y formatos", () => {
  it.each([
    ["3906000", 3906000],
    ["3.906.000", 3906000],
    ["3,906,000", 3906000],
    ["3906000.00", 3906000],
    ["3906000,00", 3906000],
    ["$ 3.906.000,00", 3906000],
    ["3,906,000.50", 3906000.5],
    ["(1.000)", -1000],
    ["0,5", 0.5],
  ])("interpreta %s", (text, expected) => {
    expect(parseNumericText(text)).toBe(expected);
  });

  it("rechaza textos no numéricos", () => {
    expect(parseNumericText("abc")).toBeNull();
    expect(parseNumericText("1.2.3,4,5")).toBeNull();
  });

  it("formatea en estilo colombiano", () => {
    expect(formatMoneyCents(3_906_000_00)).toBe("$ 3.906.000,00");
    expect(formatMoneyCents(37_732_00)).toBe("$ 37.732,00");
    expect(formatRate(9.66)).toBe("9,66");
    expect(formatRate(4)).toBe("4");
  });

  it("tipo de retención: campo estructurado primero, nombre como respaldo", () => {
    expect(resolveTipo({ nombre: "ICA APLICADO", tipoRetencion: "RETEFUENTE" })).toBe("RETEFUENTE");
    expect(resolveTipo({ nombre: "ICA APLICADO A SERVICIOS", tipoRetencion: null })).toBe("ICA");
    expect(resolveTipo({ nombre: "RETENCIÓN EN LA FUENTE HONORARIOS" })).toBe("RETEFUENTE");
    expect(resolveTipo({ nombre: "Otro" })).toBeNull();
  });

  it("nombre de archivo sanitizado", () => {
    expect(certificateFileName(["RETEFUENTE"], "MONO COLOMBIA S.A.S.", "2026-03", "2026-04")).toBe(
      "Certificado_Retencion_MONO_COLOMBIA_2026-03_2026-04.pdf",
    );
    expect(certificateFileName(["ICA"], "Ñandú & Cía / Ltda", "2026-01", "2026-01")).toBe(
      "Certificado_ICA_NANDU_CIA_2026-01.pdf",
    );
  });
});
