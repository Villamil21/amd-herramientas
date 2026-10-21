import { describe, expect, it } from "vitest";
import type { StatementRow } from "./engine";
import { accountantSignName, fitRows, isMajorTotal, labelWidth, legalRepSignName, notesBaseline, PAGE, renderStatementsPdf, rowFontSize, statementsFileName, type StatementsPdfModel } from "./pdf";

const lines = (n: number): StatementRow[] => [
  { kind: "title", label: "ACTIVO" },
  { kind: "header", label: "ACTIVO CORRIENTE" },
  ...Array.from({ length: n }, (_, i): StatementRow => ({ kind: "line", label: `Línea ${i + 1}`, cents: (i % 3 === 0 ? -1 : 1) * 100_000_000, pesos: (i % 3 === 0 ? -1 : 1) * 1_000_000 })),
  { kind: "subtotal", label: "TOTAL ACTIVO CORRIENTE", cents: 0, pesos: 0 },
  { kind: "total", label: "TOTAL ACTIVO", cents: 0, pesos: 0 },
];

const model = (n: number): StatementsPdfModel => ({
  companyName: "Gesap ERP INC SAS",
  nit: "900111111",
  dv: "1",
  logo: null,
  startDate: "2026-01-01",
  endDate: "2026-08-31",
  esfRows: lines(n),
  eerrRows: lines(Math.ceil(n / 2)),
  legalRep: { name: "Ana Pérez", document: "CC 1.234.567" },
  accountant: { name: "Leidy Villamil", title: "Contadora Pública", professionalDocument: "TP-290048", signature: null },
});

describe("PDF de Estados Financieros", () => {
  it("siempre exactamente 2 páginas, también con muchas líneas", async () => {
    for (const n of [5, 40, 120, 300]) {
      const { pages, bytes } = await renderStatementsPdf(model(n));
      expect(pages).toBe(2);
      expect(bytes.length).toBeGreaterThan(1000);
    }
  });

  it("reduce fuente y espaciado para que todo quepa en una página", () => {
    const available = PAGE.height - 150 - 156;
    const few = fitRows(lines(10), available);
    const many = fitRows(lines(120), available);
    expect(few.size).toBe(9.5);
    expect(many.size).toBeLessThan(few.size);
    expect(many.height).toBeLessThanOrEqual(available);
    expect(fitRows(lines(500), available).height).toBeLessThanOrEqual(available + 0.001);
  });

  it("encabezados, totales y resultados no reservan NOTA: tienen más ancho que una cuenta", () => {
    const header = labelWidth({ kind: "header", label: "INGRESOS DE ACTIVIDADES ORDINARIAS" });
    const result = labelWidth({ kind: "result", label: "RESULTADO ANTES DE IMPUESTOS", cents: 0, pesos: 0 });
    const line = labelWidth({ kind: "line", label: "Ventas", cents: 0, pesos: 0 });
    expect(header).toBe(PAGE.width - 2 * 54);
    expect(result).toBeGreaterThan(line);
    expect(header).toBeGreaterThan(result);
  });

  it("un texto partido en dos renglones ocupa más alto (y sigue cabiendo)", () => {
    const available = PAGE.height - 150 - 156;
    const one = fitRows(lines(10), available);
    const two = fitRows(lines(10), available, (r) => (r.kind === "header" ? 2 : 1));
    expect(two.height).toBeGreaterThan(one.height);
    expect(two.height).toBeLessThanOrEqual(available);
  });

  it("nombre del archivo: EEFF (mes final) (año) - (empresa).pdf", () => {
    expect(statementsFileName("Gesap ERP INC SAS", "2026-08-31")).toBe("EEFF 08 2026 - Gesap ERP INC SAS.pdf");
  });

  it("la columna NOTA conserva sus números y solo las cuentas la usan", () => {
    const rows: StatementRow[] = [
      { kind: "header", label: "ACTIVO CORRIENTE" },
      { kind: "line", label: "Caja", cents: 0, pesos: 1000, note: 3 },
      { kind: "subtotal", label: "TOTAL ACTIVO CORRIENTE", cents: 0, pesos: 1000 },
      { kind: "total", label: "TOTAL ACTIVO", cents: 0, pesos: 1000 },
    ];
    expect(rows.filter((r) => r.note !== undefined).map((r) => [r.kind, r.note])).toEqual([["line", 3]]);
    // La NOTA está más cerca del texto, pero deja espacio para el rótulo más largo.
    const line = labelWidth({ kind: "line", label: "x" });
    expect(line).toBeGreaterThan(245);
    expect(line).toBeLessThan(PAGE.width - 2 * 54 - 150);
  });

  it("los totales principales tienen fuente mayor que una línea ordinaria", () => {
    const major = ["TOTAL ACTIVO", "TOTAL PASIVOS", "TOTAL PATRIMONIO", "TOTAL PASIVOS Y PATRIMONIO", "GASTOS OPERACIONALES"].map((label): StatementRow => ({ kind: "total", label, pesos: 1 }));
    major.push(...["RESULTADO BRUTO", "RESULTADO ANTES DE IMPUESTOS"].map((label): StatementRow => ({ kind: "result", label, pesos: 1 })));
    for (const row of major) {
      expect(isMajorTotal(row)).toBe(true);
      expect(rowFontSize(row, 9.5)).toBeGreaterThan(rowFontSize({ kind: "line", label: "x" }, 9.5));
      expect(rowFontSize(row, 9.5)).toBeLessThan(12); // no compite con el título del estado
    }
    expect(isMajorTotal({ kind: "subtotal", label: "TOTAL ACTIVO", pesos: 1 })).toBe(false);
    expect(isMajorTotal({ kind: "total", label: "TOTAL ACTIVO CORRIENTE", pesos: 1 })).toBe(false);
  });

  it("el texto de notas queda pegado a la tabla y dentro de la página, sobre las firmas", () => {
    expect(notesBaseline(300)).toBeCloseTo(316);
    for (const end of [160, 400, 642, 5000]) {
      const y = notesBaseline(end);
      expect(y).toBeLessThan(PAGE.height - 150 + 30); // las firmas empiezan ≈ 688 pt
    }
  });

  it("firmas: representante «NOMBRES APELLIDOS» en mayúsculas; contador en mayúsculas", () => {
    expect(legalRepSignName("DAZA MARTINEZ ANA MARIA", { firstName: "Ana", otherNames: "Maria", firstSurname: "Daza", secondSurname: "Martinez" })).toBe("ANA MARIA DAZA MARTINEZ");
    expect(legalRepSignName("Daza Martinez Ana", { firstName: "Ana", firstSurname: "Daza" })).toBe("ANA DAZA");
    // Sin partes confiables no se invierte el texto libre.
    expect(legalRepSignName("Daza Martinez Ana", null)).toBe("DAZA MARTINEZ ANA");
    expect(legalRepSignName("Ana Pérez", { firstName: "Ana" })).toBe("ANA PÉREZ");
    expect(accountantSignName("Leidy Villamil")).toBe("LEIDY VILLAMIL");
  });
});
