import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import type { TaxReturn } from "../tax-obligations/types";
import { periodRange } from "../tax-obligations/services/effects";
import { estimatedIncomeTaxNet, isActivationKey } from "./estimatedTax";

function f350(month: number, self: number, c129: number, adj: { conceptKey: string; cents: number }[]): TaxReturn {
  const { start, end } = periodRange("monthly", 2026, month);
  return {
    id: month, companyId: 1, taxType: "withholding", year: 2026, period: month, periodicity: "monthly", periodStart: start, periodEnd: end, formNumber: `3500${month}`, previousFormNumber: "", isCorrection: false, supersededBy: null,
    payableCents: 0, favorCents: 0, payments: [], resolution: "", nit: "", companyName: "", fileName: "", incomeOrdinaryCents: null, incomeLossCents: null, advanceNextCents: null, advanceTargetYear: null,
    detail: { presentedOn: `${end.slice(0, 7)}-15`, withholding: { casillas: { "68": self * 100, "129": c129 * 100 } }, manual: { adjustments129: adj.map((a, i) => ({ id: `a${i}`, conceptKey: a.conceptKey, cents: a.cents * 100, note: "" })) } },
    createdAt: "", updatedAt: "", events: [],
  };
}

// El router lee `window` al cargarse: entorno node, así que se simula antes de importar el componente.
let EstimatedTaxCard: typeof import("./EstimatedTaxCard").EstimatedTaxCard;
let EstimatedTaxDetail: typeof import("./EstimatedTaxCard").EstimatedTaxDetail;
beforeAll(async () => {
  (globalThis as unknown as { window: unknown }).window = { location: { hash: "" }, addEventListener: () => {}, removeEventListener: () => {} };
  ({ EstimatedTaxCard, EstimatedTaxDetail } = await import("./EstimatedTaxCard"));
});

const partial = estimatedIncomeTaxNet({ baseCents: 100_000_000 * 100, returns: [f350(1, 120_000, 30_000, [{ conceptKey: "self", cents: 5_000 }, { conceptKey: "services", cents: 20_000 }])], cut: "2026-02-28" });
const favor = estimatedIncomeTaxNet({ baseCents: 1_000_000 * 100, returns: [f350(1, 900_000, 0, [])], cut: "2026-01-31" });

describe("Tarjeta de impuesto de renta estimado", () => {
  it("10. toda la tarjeta es un botón accesible con valor, pista y advertencia parcial", () => {
    const html = renderToStaticMarkup(createElement(EstimatedTaxCard, { tax: partial, companyId: 1 }));
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("Impuesto de renta estimado neto");
    expect(html).toContain("Incluye autorretenciones netas declaradas en Formularios 350 · Ver detalle");
    expect(html).toContain("Estimado parcial: faltan declaraciones de retención de febrero 2026");
    expect(html).toContain("$34.885.000"); // 35.000.000 − 115.000
  });

  it("10. Enter y Espacio abren; otras teclas no", () => {
    expect(isActivationKey("Enter")).toBe(true);
    expect(isActivationKey(" ")).toBe(true);
    expect(isActivationKey("a")).toBe(false);
    expect(isActivationKey("Tab")).toBe(false);
  });

  it("10. el desglose trae resumen, 350 incluidos, excluidos y pendientes", () => {
    const html = renderToStaticMarkup(createElement(EstimatedTaxDetail, { tax: partial, companyId: 1 }));
    for (const text of ["Utilidad base usada", "Tarifa estimada", "35%", "Impuesto de renta estimado bruto", "(−) Autorretenciones netas acumuladas", "Impuesto de renta estimado neto"]) expect(html).toContain(text);
    for (const text of ["Período", "Formulario", "Presentación", "Autorretenciones brutas", "Devoluciones de autorretenciones", "Autorretenciones netas", "Devoluciones de otros conceptos (excluidas)", "Estado", "Abrir declaración", "35001"]) expect(html).toContain(text);
    expect(html).toContain("$ 120.000,00");
    expect(html).toContain("$ 115.000,00");
    expect(html).toContain("$ 20.000,00");
    expect(html).toContain("Pendiente de distribuir: $ 5.000,00");
    expect(html).toContain("Meses sin declaración 350");
    expect(html).toContain("febrero 2026");
    expect(html).toContain("Ir a Retención en la fuente");
  });

  it("8. con autorretenciones mayores se muestra «Saldo a favor estimado por autorretenciones»", () => {
    const card = renderToStaticMarkup(createElement(EstimatedTaxCard, { tax: favor, companyId: 1 }));
    expect(card).toContain("Saldo a favor estimado por autorretenciones");
    expect(card).not.toContain("Estimado parcial");
    expect(card).toContain("$550.000");
    expect(renderToStaticMarkup(createElement(EstimatedTaxDetail, { tax: favor, companyId: 1 }))).toContain("$ 550.000,00");
  });

  it("11. el indicador no entra al PDF ni al snapshot aprobado, y solo es lectura", () => {
    const here = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
    expect(here("./pdf.ts")).not.toMatch(/estimat|incomeTax|autorreten/i);
    expect(here("./snapshot.ts")).toContain("incomeTaxPesos: s.incomeTaxPesos"); // el snapshot sigue guardando el bruto del motor
    expect(here("./estimatedTax.ts")).not.toMatch(/post\(|taxService|fsService|invoke\(/);
    expect(here("./engine.ts")).not.toContain("estimatedTax");
  });
});
