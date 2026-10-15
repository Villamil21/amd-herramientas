import { describe, expect, it } from "vitest";
import type { StatementRow } from "./engine";
import { fitRows, labelWidth, PAGE, renderStatementsPdf, statementsFileName, type StatementsPdfModel } from "./pdf";

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
});
