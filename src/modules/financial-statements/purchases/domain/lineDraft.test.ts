import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PurchaseDocument, PurchaseLine, RateVersion, RetentionPick } from "../../../../types/purchases";
import type { UvtValue, WithholdingRate } from "../../../../types/models";
import { buildPucIndex } from "../../puc-codes/services/pucCatalog";
import { RetentionPicker } from "../ui/RetentionPicker";
import { addRetention, previewRetention, removeRetention, searchRates } from "./lineDraft";
import { buildPurchasesModel } from "./model";

const rate = (id: number, name: string, rateBp: number, baseUvtCenti = 0): WithholdingRate => ({ id, retentionType: "services", name, baseUvtCenti, rateBp, sortOrder: id, createdAt: "", updatedAt: "" }) as WithholdingRate;
const SERVICES = rate(1, "Servicios generales", 400, 400);
const FEES = rate(2, "Honorarios", 1100);
const RENT = rate(3, "Arrendamientos", 350);
const ALL = [SERVICES, FEES, RENT];
const UVT: UvtValue[] = [{ year: 2025, valuePesos: 50_000, updatedAt: "" }];
const VERSIONS: RateVersion[] = [{ rateId: 1, effectiveFrom: "2025-06-01", baseUvtCenti: 400, rateBp: 600 } as RateVersion];
const MILLION = 1_000_000_00;

describe("borrador de retenciones de una línea", () => {
  it("agrega sin repetir y quita; ninguna, una y varias", () => {
    let picks: RetentionPick[] = [];
    expect(picks).toEqual([]);
    picks = addRetention(picks, 1);
    expect(picks).toEqual([{ rateId: 1 }]);
    picks = addRetention(addRetention(picks, 2), 1);
    expect(picks).toEqual([{ rateId: 1 }, { rateId: 2 }]);
    expect(removeRetention(picks, 1)).toEqual([{ rateId: 2 }]);
    expect(removeRetention(removeRetention(picks, 1), 2)).toEqual([]);
  });

  it("el selector buscable ignora tildes y mayúsculas y no ofrece lo ya elegido", () => {
    expect(searchRates(ALL, [], "ARRENDAMIENT").map((r) => r.id)).toEqual([3]);
    expect(searchRates(ALL, [], "honorários".replace("á", "a")).map((r) => r.id)).toEqual([2]);
    expect(searchRates(ALL, [{ rateId: 1 }], "").map((r) => r.id)).toEqual([2, 3]);
    expect(searchRates(ALL, [], "zzz")).toEqual([]);
  });

  it("muestra base, cuantía mínima, % vigente en la fecha, vigencia y valor calculado", () => {
    // Antes de la vigencia rige la regla base (4 %); después, 6 % desde 2025-06-01. 4 UVT × $50.000 = $200.000 de mínimo.
    const before = previewRetention(SERVICES, VERSIONS, "2025-03-10", UVT, MILLION);
    expect(before).toMatchObject({ rateBp: 400, appliedFrom: undefined, minCents: 20_000_000, belowMinimum: false, valueCents: 4_000_000 });
    const after = previewRetention(SERVICES, VERSIONS, "2025-07-10", UVT, MILLION);
    expect(after).toMatchObject({ rateBp: 600, appliedFrom: "2025-06-01", valueCents: 6_000_000 });
  });

  it("bajo la cuantía mínima el valor es 0; sin UVT del año se avisa", () => {
    expect(previewRetention(SERVICES, [], "2025-03-10", UVT, 100_000_00)).toMatchObject({ belowMinimum: true, valueCents: 0 });
    // La mínima se evalúa sobre la base del concepto en toda la factura.
    expect(previewRetention(SERVICES, [], "2025-03-10", UVT, 100_000_00, MILLION)).toMatchObject({ belowMinimum: false, valueCents: 400_000 });
    expect(previewRetention(SERVICES, [], "2024-03-10", UVT, MILLION)).toMatchObject({ missingUvt: true, valueCents: 0 });
  });
});

describe("panel de retenciones: no despliega la tabla completa", () => {
  const html = (picks: RetentionPick[]) =>
    renderToStaticMarkup(createElement(RetentionPicker, { rates: ALL, picks, onChange: () => {}, preview: (r) => previewRetention(r, VERSIONS, "2025-03-10", UVT, MILLION), suggested: [1] }));

  it("con una retención sugerida muestra solo esa (etiqueta + cálculo) y el botón «Añadir otra retención»", () => {
    const out = html([{ rateId: 1 }]);
    expect(out).toContain("Servicios generales");
    expect(out).toContain("sugerida");
    expect(out).toContain("Añadir otra retención");
    expect(out).not.toContain("Honorarios");
    expect(out).not.toContain("Arrendamientos");
    expect(out).not.toContain('type="checkbox"');
    for (const col of ["Cuantía mínima", "% vigente", "Vigencia", "Valor calculado"]) expect(out).toContain(col);
    expect(out).toContain("Regla base de la tabla");
  });

  it("varias retenciones: una etiqueta removible por concepto", () => {
    const out = html([{ rateId: 1 }, { rateId: 2 }]);
    expect(out).toContain("Quitar Servicios generales");
    expect(out).toContain("Quitar Honorarios");
    expect(out).not.toContain("Quitar Arrendamientos");
  });

  it("ninguna retención: lo dice y deja abierto el selector buscable", () => {
    const out = html([]);
    expect(out).toContain("Sin retención");
    expect(out).toContain("Buscar concepto de retención");
    expect(out).toContain("Honorarios");
    expect(out).not.toContain("Añadir otra retención");
  });
});

describe("la clasificación sigue funcionando con ninguna, una o varias retenciones", () => {
  const line: PurchaseLine = { index: 0, page: 1, code: "P0", description: "Servicio", unit: "UN", baseCents: MILLION, vatCents: 0 };
  const doc = {
    id: 1, uploadId: 1, fileName: "f.pdf", buyerNit: "901817531", buyerName: "MONO SAS", year: 2025, issueDate: "2025-03-10", issuerNit: "900111222", issuerName: "PROVEEDOR SAS",
    numberKey: "FE1", totalCents: MILLION, titleKey: "factura electronica de venta", cufe: null, fingerprint: "fp1", status: "current", duplicateOf: null, importedAt: "2025-04-01",
    data: { pageCount: 1, title: "FACTURA ELECTRÓNICA DE VENTA", number: "FE1", issueDate: "2025-03-10", issuer: { nit: "900111222", name: "PROVEEDOR SAS", personType: "PJ", fiscalCodes: ["O-13"] }, buyerNit: "901817531", buyerName: "MONO SAS", lines: [line], subtotalCents: MILLION, vatCents: 0, totalCents: MILLION },
  } as unknown as PurchaseDocument;

  const run = (retention: RetentionPick[]) => {
    const m = buildPurchasesModel({
      buyerNit: "901817531", year: 2025,
      state: { uploads: [], documents: [doc], lineClasses: [{ documentId: 1, lineIndex: 0, pucCode: "510506", concept1001: "5001", retention, ruleId: null, scope: "invoice", confirmedAt: "" } as never], flags: [], audit: [] },
      company: { id: 1, nit: "901817531", razonSocial: "MONO SAS" } as never,
      companyVat: [{ effectiveDate: "2025-01-01", responsible: true } as never],
      titleTypes: [{ titleKey: "factura electronica de venta", kind: "purchase" } as never],
      rules: [], suppliers: [], supplierFiscal: [],
      pucIndex: buildPucIndex([{ code: "510506", concept: "Sueldos" }, { code: "1", concept: "Activo" }, { code: "5", concept: "Gastos" }] as never),
      pucConcepts: new Map(),
      concepts1001: [{ year: 2025, code: "5001", description: "Salarios", isActive: true, validFrom: "2025-01-01", validTo: null } as never],
      rates: ALL, uvts: UVT, rateVersions: [], catalogs: null,
    });
    return m.docs[0];
  };

  it("sin retención: línea confirmada y sin retención asumida", () => {
    const d = run([]);
    expect(d.lines[0].confirmed).toBe(true);
    expect(d.retention.assumedCents).toBe(0);
  });

  it("una retención: se asume su valor (4 % de $1.000.000)", () => {
    const d = run([{ rateId: 1 }]);
    expect(d.lines[0].confirmed).toBe(true);
    expect(d.retention.assumedCents).toBe(4_000_000);
  });

  it("varias retenciones sobre la misma línea: suman (4 % + 11 %)", () => {
    const d = run([{ rateId: 1 }, { rateId: 2 }]);
    expect(d.lines[0].confirmed).toBe(true);
    expect(d.lines[0].retention).toEqual([{ rateId: 1 }, { rateId: 2 }]);
    expect(d.retention.assumedCents).toBe(4_000_000 + 11_000_000);
  });
});
