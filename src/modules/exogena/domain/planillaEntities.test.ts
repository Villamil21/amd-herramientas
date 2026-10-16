import { describe, expect, it } from "vitest";
import { planillaEntitiesFor, type RawPlanillaEntity } from "./planillaEntities";

const raw: RawPlanillaEntity[] = [
  { type: "AFP", name: "COLFONDOS", code: "231001", nit: "800.227.940", dv: "6", liquidated: 280_200 },
  { type: "AFP", name: "PORVENIR", code: "230301", nit: "800224808", dv: "8", liquidated: 560_400 },
  { type: "EPS", name: "EPS SURA", code: "EPS010", nit: "800088702", dv: "2", liquidated: 140_200 },
];

describe("detalle por entidad de la planilla", () => {
  it("se guarda con el período y la fecha de pago de la planilla cuando cuadra con los totales por tipo", () => {
    const { entities, warning } = planillaEntitiesFor(raw, { AFP: 840_600, EPS: 140_200 }, "2025-12", "2026-01-15");
    expect(warning).toBeNull();
    expect(entities).toHaveLength(3);
    expect(entities[0]).toEqual({ type: "AFP", name: "COLFONDOS", code: "231001", nit: "800227940", dv: "6", liquidated: 280_200, paymentDate: "2026-01-15", period: "2025-12" });
    // Planilla sin pagar: la fecha queda en null (sigue siendo deuda).
    expect(planillaEntitiesFor(raw, { AFP: 840_600 }, "2025-12", null).entities[0].paymentDate).toBeNull();
  });

  it("si la suma por tipo no cuadra con el total de la planilla, no se guarda ningún detalle y se explica", () => {
    const { entities, warning } = planillaEntitiesFor(raw, { AFP: 840_601 }, "2025-12", null);
    expect(entities).toEqual([]);
    expect(warning).toContain("no se guardó el detalle por entidad");
  });

  it("una planilla sin detalle por entidad avisa que el 1009 no podrá detallar sus aportes", () => {
    const { entities, warning } = planillaEntitiesFor([], {}, "2025-12", null);
    expect(entities).toEqual([]);
    expect(warning).toContain("1009");
  });
});
