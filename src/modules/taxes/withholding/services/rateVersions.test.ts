import { describe, expect, it } from "vitest";
import type { Supplier, UvtValue, WithholdingRate } from "../../../../types/models";
import type { RateVersion } from "../../../../types/purchases";
import { computeRetention } from "../../../financial-statements/purchases/domain/retention";
import type { FileResult, ParsedDocument } from "../types";
import { buildWithholdingReport } from "./analysis";
import { rateAt, ratesAt } from "./rateVersions";

const pesos = (n: number) => n * 100;
const RATE: WithholdingRate = { id: 6, retentionType: "services", name: "Servicios generales (declarantes)", baseUvtCenti: 200, rateBp: 400, sortOrder: 6, createdAt: "", updatedAt: "" };
const OTHER: WithholdingRate = { id: 7, retentionType: "services", name: "Transporte", baseUvtCenti: 200, rateBp: 100, sortOrder: 7, createdAt: "", updatedAt: "" };
const UVTS: UvtValue[] = [{ year: 2026, valuePesos: 52_374, updatedAt: "" }];
// Desde el 1-jun-2026 el concepto pasa a 6 % con base mínima de 4 UVT.
const VERSIONS: RateVersion[] = [{ rateId: 6, effectiveFrom: "2026-06-01", baseUvtCenti: 400, rateBp: 600, note: "", createdAt: "" }];

const doc = (number: string, issueDate: string, subtotal: number): ParsedDocument => ({
  pageCount: 1,
  title: "FACTURA ELECTRÓNICA DE VENTA",
  number,
  issueDate,
  supplierNit: "900",
  supplierName: "PROV",
  taxpayerType: "Persona Jurídica",
  fiscalText: "Régimen Fiscal: R-99-PN",
  fiscalCodes: ["R-99-PN"],
  subtotalCents: pesos(subtotal),
  retefuenteCents: 0,
  products: { columns: [], rows: [] },
});
const file = (name: string, d: ParsedDocument): FileResult => ({ fileName: name, kind: "parsed", doc: d });
const supplier = (rules: Supplier["withholdingRules"]): Supplier => ({ id: 1, nit: "900", businessName: "PROV", vatType: "service", createdAt: "", updatedAt: "", personType: "PJ", fiscalRegime: "R-99-PN", fiscalCheckedAt: null, withholdingRules: rules });
const TITLES = [{ id: 1, normalizedTitle: "factura electronica de venta", displayTitle: "FACTURA ELECTRÓNICA DE VENTA", category: "invoice" as const, createdAt: "", updatedAt: "" }];

const retefuente = (versions: RateVersion[], rules: Supplier["withholdingRules"], d: ParsedDocument) =>
  buildWithholdingReport([file("a.pdf", d)], { suppliers: [supplier(rules)], rates: [RATE, OTHER], rateVersions: versions, uvts: UVTS, titles: TITLES }).rows[0];

const compras = (versions: RateVersion[], d: ParsedDocument) =>
  computeRetention({
    lines: [{ index: 0, baseCents: d.subtotalCents!, picks: [{ rateId: 6 }] }],
    informedCents: 0,
    exempt: false,
    issueYear: Number(d.issueDate!.slice(0, 4)),
    rates: ratesAt([RATE, OTHER], versions, d.issueDate),
    uvts: UVTS,
  });

describe("vigencia de la Tabla de retenciones: un concepto se calcula igual en Retefuente y en Compras", () => {
  const before = doc("A-1", "2026-03-10", 1_950_000);
  const after = doc("A-2", "2026-07-10", 1_950_000);
  const single = [{ id: 1, rateId: 6, baseMode: "invoice_subtotal" as const, isDefault: false }];

  it("el resolvedor común usa lo vigente en la fecha del documento", () => {
    expect(rateAt(RATE, VERSIONS, "2026-05-31")).toMatchObject({ rateBp: 400, baseUvtCenti: 200 });
    expect(rateAt(RATE, VERSIONS, "2026-06-01")).toMatchObject({ rateBp: 600, baseUvtCenti: 400, appliedFrom: "2026-06-01" });
    expect(rateAt(RATE, VERSIONS, null)).toBe(RATE);
    expect(rateAt(OTHER, VERSIONS, "2026-07-10")).toBe(OTHER);
  });

  it("Retefuente: factura anterior a la vigencia usa 4 % / 2 UVT y la posterior 6 % / 4 UVT", () => {
    expect(retefuente(VERSIONS, single, before)).toMatchObject({ rateBp: 400, minBaseCents: pesos(104_748), calculatedCents: pesos(78_000) });
    expect(retefuente(VERSIONS, single, after)).toMatchObject({ rateBp: 600, minBaseCents: pesos(209_496), calculatedCents: pesos(117_000) });
  });

  it("agregar la vigencia no recalcula la factura anterior (igual que sin vigencias)", () => {
    expect(retefuente(VERSIONS, single, before)).toMatchObject({ rateBp: retefuente([], single, before).rateBp, calculatedCents: retefuente([], single, before).calculatedCents });
  });

  it("Retefuente con varios conceptos por proveedor también usa la vigencia de la fecha", () => {
    const multi = [
      { id: 1, rateId: 6, baseMode: "invoice_subtotal" as const, isDefault: true },
      { id: 2, rateId: 7, baseMode: "invoice_subtotal" as const, isDefault: false },
    ];
    const rowBefore = retefuente(VERSIONS, multi, before);
    const rowAfter = retefuente(VERSIONS, multi, after);
    expect(rowBefore.lines.find((l) => l.rule.rateId === 6)).toMatchObject({ rateBp: 400, calculatedCents: pesos(78_000) });
    expect(rowAfter.lines.find((l) => l.rule.rateId === 6)).toMatchObject({ rateBp: 600, calculatedCents: pesos(117_000) });
    expect(rowAfter.lines.find((l) => l.rule.rateId === 7)).toMatchObject({ rateBp: 100 });
  });

  it("Compras y Retefuente coinciden en la misma factura, antes y después de la vigencia", () => {
    for (const d of [before, after]) {
      expect(compras(VERSIONS, d).expectedCents).toBe(retefuente(VERSIONS, single, d).calculatedCents);
    }
    // Una base por debajo de la mínima nueva no retiene en ninguno de los dos módulos.
    const small = doc("A-3", "2026-07-10", 150_000);
    expect(compras(VERSIONS, small).expectedCents).toBe(0);
    expect(retefuente(VERSIONS, single, small)).toMatchObject({ calculatedCents: 0, counts: false });
    const smallBefore = doc("A-4", "2026-03-10", 150_000);
    expect(compras(VERSIONS, smallBefore).expectedCents).toBe(pesos(6_000));
    expect(retefuente(VERSIONS, single, smallBefore).calculatedCents).toBe(pesos(6_000));
  });
});
