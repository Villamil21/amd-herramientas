import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PurchaseDocument, PurchaseLine, RateVersion, RetentionPick } from "../../../../types/purchases";
import type { UvtValue, WithholdingRate } from "../../../../types/models";
import { buildPucIndex } from "../../puc-codes/services/pucCatalog";
import { RetentionPicker } from "../ui/RetentionPicker";
import { addRetention, moveActive, previewRetention, removeRetention, retentionOptions } from "./lineDraft";
import { buildPurchasesModel } from "./model";

const rate = (id: number, name: string, rateBp: number, baseUvtCenti = 0, retentionType: WithholdingRate["retentionType"] = "services"): WithholdingRate => ({ id, retentionType, name, baseUvtCenti, rateBp, sortOrder: id, createdAt: "", updatedAt: "" }) as WithholdingRate;
const SERVICES = rate(1, "Servicios generales", 400, 400);
const FEES = rate(2, "Honorarios", 1100, 0, "fees");
const RENT = rate(3, "Arrendamientos", 350, 0, "rentals");
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

const ids = (groups: ReturnType<typeof retentionOptions>) => groups.flatMap((g) => g.options.map((o) => o.rate.id));

describe("selector desplegable de retenciones", () => {
  // Compras (4 y 5), Servicios (1, 6), Honorarios (2), Arrendamientos (3) en orden de tabla mezclado.
  const BUY = rate(4, "Compras generales", 250, 2700, "purchases");
  const BUY2 = rate(5, "Compras de café pergamino", 150, 0, "purchases");
  const SRV2 = rate(6, "Transporte de carga", 100, 400);
  const TABLE = [SERVICES, FEES, RENT, BUY, BUY2, SRV2];
  const options = (picks: RetentionPick[] = [], query = "", date = "2025-03-10") => retentionOptions(TABLE, picks, VERSIONS, date, UVT, query);

  it("al abrirlo muestra la tabla completa, agrupada: Compras, Servicios, Honorarios y Arrendamientos", () => {
    const groups = options();
    expect(groups.map((g) => g.label)).toEqual(["Compras", "Servicios", "Honorarios", "Arrendamientos"]);
    expect(ids(groups).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(groups[0].options.map((o) => o.rate.id)).toEqual([4, 5]);
  });

  it("cada opción trae el % vigente, la cuantía mínima y la vigencia de la fecha de la factura", () => {
    const at = (date: string) => options([], "", date).flatMap((g) => g.options).find((o) => o.rate.id === 1)!;
    // Antes de 2025-06-01 rige la regla base (4 %, 4 UVT × $50.000); desde esa fecha, 6 %.
    expect(at("2025-03-10")).toMatchObject({ rateBp: 400, minCents: 20_000_000, appliedFrom: undefined, missingUvt: false });
    expect(at("2025-07-10")).toMatchObject({ rateBp: 600, minCents: 20_000_000, appliedFrom: "2025-06-01" });
    // Sin UVT del año con base mínima: se avisa en vez de inventar la cuantía.
    expect(at("2024-03-10")).toMatchObject({ missingUvt: true });
    const sinMinima = options().flatMap((g) => g.options).find((o) => o.rate.id === 2)!;
    expect(sinMinima).toMatchObject({ minCents: 0, missingUvt: false });
  });

  it("busca por nombre, tipo o porcentaje ignorando mayúsculas, tildes y espacios", () => {
    expect(ids(options([], "ARRENDAMIENT"))).toEqual([3]);
    expect(ids(options([], "cafe  PERGAMINO"))).toEqual([5]);
    expect(ids(options([], "  hono rarios "))).toEqual([2]);
    expect(ids(options([], "servicios")).sort()).toEqual([1, 6]);
    expect(ids(options([], "11"))).toEqual([2]);
    expect(ids(options([], "2,5"))).toEqual([4]);
    expect(ids(options([], "2.5 %"))).toEqual([4]);
    expect(options([], "zzz")).toEqual([]);
  });

  it("no ofrece los conceptos ya elegidos; con todos elegidos no queda ninguno", () => {
    expect(ids(options([{ rateId: 1 }, { rateId: 4 }]))).not.toContain(1);
    expect(ids(options([{ rateId: 1 }, { rateId: 4 }]))).not.toContain(4);
    expect(ids(options([{ rateId: 1 }, { rateId: 4 }])).sort()).toEqual([2, 3, 5, 6]);
    expect(options(TABLE.map((r) => ({ rateId: r.id })))).toEqual([]);
  });

  it("el teclado recorre sin dar la vuelta", () => {
    expect(moveActive(0, "ArrowDown", 3)).toBe(1);
    expect(moveActive(2, "ArrowDown", 3)).toBe(2);
    expect(moveActive(0, "ArrowUp", 3)).toBe(0);
    expect(moveActive(2, "ArrowUp", 3)).toBe(1);
    expect(moveActive(0, "ArrowDown", 0)).toBe(-1);
    expect(moveActive(1, "a", 3)).toBe(1);
  });

  const html = (picks: RetentionPick[], open = false) =>
    renderToStaticMarkup(createElement(RetentionPicker, { rates: TABLE, picks, versions: VERSIONS, uvts: UVT, date: "2025-03-10", onChange: () => {}, preview: (r) => previewRetention(r, VERSIONS, "2025-03-10", UVT, MILLION), suggested: [1], defaultOpen: open }));

  it("cerrado muestra solo las elegidas; abierto, el buscador con rol combobox y la lista con todas", () => {
    const closed = html([{ rateId: 1 }]);
    expect(closed).toContain("Servicios generales");
    expect(closed).toContain("sugerida");
    expect(closed).toContain('role="combobox"');
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain('role="listbox"');
    expect(closed).not.toContain("Transporte de carga");
    for (const col of ["Cuantía mínima", "% vigente", "Vigencia", "Valor calculado"]) expect(closed).toContain(col);

    const open = html([{ rateId: 1 }], true);
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('role="listbox"');
    expect(open).toContain('aria-multiselectable="true"');
    for (const name of ["Honorarios", "Arrendamientos", "Compras generales", "Compras de café pergamino", "Transporte de carga"]) expect(open).toContain(name);
    for (const group of ["Compras", "Servicios", "Honorarios", "Arrendamientos"]) expect(open).toContain(`aria-label="${group}"`);
    // La ya elegida no se ofrece como opción (solo aparece como etiqueta y en la tabla de cálculo).
    expect(open).not.toMatch(/-opt-1"/);
    expect(open).toMatch(/-opt-2"/);
    expect(open).toContain("Mín. ");
    expect(open).toContain("Regla base de la tabla");
  });

  it("ninguna retención: lo dice y los botones de quitar no existen", () => {
    const out = html([]);
    expect(out).toContain("Sin retención");
    expect(out).not.toContain("Quitar ");
  });

  it("varias retenciones: una etiqueta removible por concepto", () => {
    const out = html([{ rateId: 1 }, { rateId: 2 }]);
    expect(out).toContain("Quitar Servicios generales");
    expect(out).toContain("Quitar Honorarios");
    expect(out).not.toContain("Quitar Arrendamientos");
  });

  it("la lista tiene desplazamiento propio y grupos fijos para no perder los botones del panel", () => {
    const css = readFileSync(new URL("../../../../styles/global.css", import.meta.url), "utf8");
    const rule = css.slice(css.indexOf(".retention-list {"), css.indexOf("}", css.indexOf(".retention-list {")));
    expect(rule).toMatch(/max-height:\s*\d+px/);
    expect(rule).toContain("overflow-y: auto");
    expect(css).toMatch(/\.retention-option\.is-active\s*{/);
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
