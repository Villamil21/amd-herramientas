import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DocFlag, PurchaseDocument, PurchaseLine, PurchaseRule, PurchasesState, SupplierFiscalEntry } from "../../../../types/purchases";
import { buildPucIndex } from "../../puc-codes/services/pucCatalog";
import { RetentionSection } from "../ui/RetentionSection";
import { productKey } from "./classify";
import { cleanupSummary, exemptionMessage, regimeAt, retentionExemption } from "./history";
import { previewRetention } from "./lineDraft";
import { buildPurchasesModel, type PurchasesInput } from "./model";

const NIT = "901817531";
const SUPPLIER = "900111222";
const MILLION = 1_000_000_00;
const line = (index: number, baseCents: number): PurchaseLine => ({ index, page: 1, code: `P${index}`, description: `Producto ${index}`, unit: "UN", baseCents, vatCents: 0 });

function doc(id: number, issueDate: string, retefuenteCents?: number): PurchaseDocument {
  return {
    id, uploadId: 1, fileName: `f${id}.pdf`, buyerNit: NIT, buyerName: "MONO SAS", year: Number(issueDate.slice(0, 4)), issueDate, issuerNit: SUPPLIER, issuerName: "PROVEEDOR SAS",
    numberKey: `FE${id}`, totalCents: MILLION, titleKey: "factura electronica de venta", cufe: null, fingerprint: `fp${id}`, status: "current", duplicateOf: null, importedAt: "2025-04-01",
    data: {
      pageCount: 1, title: "FACTURA ELECTRÓNICA DE VENTA", number: `FE${id}`, issueDate,
      issuer: { nit: SUPPLIER, name: "PROVEEDOR SAS", personType: "PJ", fiscalCodes: ["O-13"] },
      buyerNit: NIT, buyerName: "MONO SAS", lines: [line(0, MILLION)], subtotalCents: MILLION, vatCents: 0, retefuenteCents, totalCents: MILLION,
    },
  } as unknown as PurchaseDocument;
}

const fiscal = (effectiveDate: string, regime: string): SupplierFiscalEntry => ({ supplierNit: SUPPLIER, effectiveDate, regime, source: "manual", note: "", createdAt: "" });
const rate = { id: 1, retentionType: "services", name: "Servicios generales", baseUvtCenti: 0, rateBp: 400, sortOrder: 1, createdAt: "", updatedAt: "" } as never;
const rule = { id: 1, supplierNit: SUPPLIER, productKey: productKey(line(0, MILLION)), productLabel: "Producto 0", pucCode: "510506", concept1001: "5001", retention: [{ rateId: 1 }], uses: 1 } as unknown as PurchaseRule;
const cls = (docId: number) => ({ documentId: docId, lineIndex: 0, pucCode: "510506", concept1001: "5001", retention: [{ rateId: 1 }], ruleId: null, scope: "invoice", confirmedAt: "" }) as never;

function model(docs: PurchaseDocument[], history: SupplierFiscalEntry[], opts: { classes?: boolean; rules?: PurchaseRule[]; flags?: DocFlag[] } = {}) {
  const input: PurchasesInput = {
    buyerNit: NIT, year: 2025,
    state: { uploads: [], documents: docs, lineClasses: opts.classes === false ? [] : docs.map((d) => cls(d.id)), flags: opts.flags ?? [], audit: [] } as PurchasesState,
    company: { id: 1, nit: NIT, razonSocial: "MONO SAS" } as never,
    companyVat: [{ effectiveDate: "2025-01-01", responsible: true } as never],
    titleTypes: [{ titleKey: "factura electronica de venta", kind: "purchase" } as never],
    rules: opts.rules ?? [], suppliers: [], supplierFiscal: history,
    pucIndex: buildPucIndex([{ code: "510506", concept: "Sueldos" }, { code: "1", concept: "Activo" }, { code: "5", concept: "Gastos" }] as never),
    pucConcepts: new Map(),
    concepts1001: [{ year: 2025, code: "5001", description: "Salarios", isActive: true, validFrom: "2025-01-01", validTo: null } as never],
    rates: [rate], uvts: [{ year: 2025, valuePesos: 50_000, updatedAt: "" }], rateVersions: [], catalogs: null,
  };
  return buildPurchasesModel(input);
}
const retAssumed1001 = (m: ReturnType<typeof model>) => m.proposals["1001"].reduce((s, p) => s + (p.data.retAssumed as number), 0);

describe("régimen O-15 / O-47 con fecha efectiva", () => {
  it("se registran y se leen con su nombre; vigente = la última entrada con fecha anterior o igual", () => {
    const history = [fiscal("2024-01-01", "O-13"), fiscal("2025-02-01", "O-15"), fiscal("2025-09-01", "O-47")];
    expect(retentionExemption(regimeAt(history, "2024-12-31", []))).toBeUndefined();
    expect(retentionExemption(regimeAt(history, "2025-02-01", []))).toEqual({ code: "O-15", label: "Autorretenedor" });
    expect(retentionExemption(regimeAt(history, "2025-08-31", []))).toEqual({ code: "O-15", label: "Autorretenedor" });
    expect(retentionExemption(regimeAt(history, "2025-09-01", []))).toEqual({ code: "O-47", label: "Régimen simple de tributación" });
    expect(regimeAt(history, "2025-09-01", [])).toMatchObject({ from: "history", since: "2025-09-01" });
  });

  it("mensajes exactos para el usuario", () => {
    expect(exemptionMessage({ code: "O-15", label: "Autorretenedor" })).toBe("No aplica retención: el proveedor es O-15 Autorretenedor");
    expect(exemptionMessage({ code: "O-47", label: "Régimen simple de tributación" })).toBe("No aplica retención: el proveedor es O-47 Régimen simple de tributación");
  });

  it("sin entrada en el historial rige lo que dice la factura", () => {
    expect(retentionExemption(regimeAt([], "2025-03-10", ["O-47"]))).toMatchObject({ code: "O-47" });
    expect(retentionExemption(regimeAt([], "2025-03-10", ["O-13"]))).toBeUndefined();
  });
});

describe("factura de un proveedor O-15 / O-47", () => {
  for (const [regime, code] of [["O-15", "O-15"], ["O-47", "O-47"]] as const) {
    it(`${code}: sin retención calculada, propuesta ni salida a 1001 aunque la línea o la regla la traigan`, () => {
      const m = model([doc(1, "2025-03-10")], [fiscal("2025-01-01", regime)], { rules: [rule] });
      const d = m.docs[0];
      expect(d.exemption?.code).toBe(code);
      expect(d.lines[0].retention).toEqual([]);
      expect(d.lines[0].proposal.retention).toEqual([]);
      expect(d.retention.expectedCents).toBe(0);
      expect(d.retention.assumedCents).toBe(0);
      expect(d.lines[0].assumedCents).toBe(0);
      expect(retAssumed1001(m)).toBe(0);
    });
  }

  it("la propuesta de una línea sin clasificar no trae la retención de la regla", () => {
    const exempt = model([doc(1, "2025-03-10")], [fiscal("2025-01-01", "O-15")], { classes: false, rules: [rule] });
    expect(exempt.docs[0].lines[0].proposal.retention).toEqual([]);
    const normal = model([doc(1, "2025-03-10")], [fiscal("2025-01-01", "O-13")], { classes: false, rules: [rule] });
    expect(normal.docs[0].lines[0].proposal.retention).toEqual([{ rateId: 1 }]);
  });

  it("la línea exenta se puede confirmar sin retención", () => {
    const m = model([doc(1, "2025-03-10")], [fiscal("2025-01-01", "O-15")], { classes: false, rules: [rule] });
    expect(m.docs[0].lines[0].proposal.pucCode).toBe("510506");
    expect(m.docs[0].alerts.filter((a) => a.severity === "block" && /retenci/i.test(a.title))).toEqual([]);
  });

  it("el panel de la línea no muestra selector ni buscador: solo el mensaje", () => {
    const m = model([doc(1, "2025-03-10")], [fiscal("2025-01-01", "O-47")]);
    const html = renderToStaticMarkup(createElement(RetentionSection, { view: m.docs[0], rates: [rate], versions: [], uvts: [], picks: [], onChange: () => {}, suggested: [], preview: (r) => previewRetention(r, [], "2025-03-10", [], MILLION) }));
    expect(html).toContain("No aplica retención: el proveedor es O-47 Régimen simple de tributación");
    for (const absent of ["combobox", "listbox", "Buscar concepto", "Servicios generales"]) expect(html).not.toContain(absent);
  });

  it("con un régimen que sí retiene el panel vuelve a mostrar el selector", () => {
    const m = model([doc(1, "2025-03-10")], [fiscal("2025-01-01", "O-15"), fiscal("2025-01-02", "O-13")]);
    expect(m.docs[0].exemption).toBeUndefined();
    const html = renderToStaticMarkup(createElement(RetentionSection, { view: m.docs[0], rates: [rate], versions: [], uvts: [], picks: [], onChange: () => {}, suggested: [], preview: (r) => previewRetention(r, [], "2025-03-10", [], MILLION) }));
    expect(html).toContain('role="combobox"');
    expect(html).not.toContain("No aplica retención");
  });
});

describe("cambio de régimen antes y después de la factura", () => {
  it("O-15 desde el 1 de junio: la factura de marzo conserva su retención; la de julio no tiene", () => {
    const history = [fiscal("2024-01-01", "O-13"), fiscal("2025-06-01", "O-15")];
    const m = model([doc(1, "2025-03-10"), doc(2, "2025-07-10")], history);
    const [before, after] = m.docs;
    expect(before.exemption).toBeUndefined();
    expect(before.lines[0].retention).toEqual([{ rateId: 1 }]);
    expect(before.retention.assumedCents).toBe(4_000_000);
    expect(after.exemption?.code).toBe("O-15");
    expect(after.retention.assumedCents).toBe(0);
    expect(retAssumed1001(m)).toBe(40_000);
  });

  it("volver a un régimen con retención después: las facturas posteriores vuelven a retener y la intermedia sigue exenta", () => {
    const history = [fiscal("2025-01-01", "O-47"), fiscal("2025-08-01", "O-13")];
    const m = model([doc(1, "2025-03-10"), doc(2, "2025-09-10")], history);
    expect(m.docs[0].exemption?.code).toBe("O-47");
    expect(m.docs[0].retention.assumedCents).toBe(0);
    expect(m.docs[1].exemption).toBeUndefined();
    expect(m.docs[1].retention.assumedCents).toBe(4_000_000);
  });

  it("una entrada posterior a la factura no la afecta", () => {
    const m = model([doc(1, "2025-03-10")], [fiscal("2025-01-01", "O-13"), fiscal("2025-12-01", "O-15")]);
    expect(m.docs[0].exemption).toBeUndefined();
    expect(m.docs[0].retention.assumedCents).toBe(4_000_000);
  });
});

describe("retención informada en la factura de un O-15 / O-47", () => {
  const informed = 3_000_000;
  const history = [fiscal("2025-01-01", "O-15")];
  const flag = (value: "keep" | "remove"): DocFlag => ({ documentId: 1, kind: "retention_decision", value, decidedAt: "" }) as DocFlag;

  it("no se elimina sola: se alerta y se conserva el valor documentado hasta que el usuario decida", () => {
    const d = model([doc(1, "2025-03-10", informed)], history).docs[0];
    const alert = d.alerts.find((a) => a.code === "retention-exempt");
    expect(alert).toBeDefined();
    expect(alert!.title).toContain("O-15");
    expect(d.retention.practicedCents).toBe(informed);
    expect(d.retention.assumedCents).toBe(0);
  });

  it("conservar: queda la retención informada y la alerta se resuelve", () => {
    const d = model([doc(1, "2025-03-10", informed)], history, { flags: [flag("keep")] }).docs[0];
    expect(d.alerts.some((a) => a.code === "retention-exempt")).toBe(false);
    expect(d.retention.practicedCents).toBe(informed);
  });

  it("quitar: la retención informada sale del cálculo", () => {
    const m = model([doc(1, "2025-03-10", informed)], history, { flags: [flag("remove")] });
    expect(m.docs[0].alerts.some((a) => a.code === "retention-exempt")).toBe(false);
    expect(m.docs[0].retention.practicedCents).toBe(0);
  });

  it("sin retención informada no hay alerta", () => {
    expect(model([doc(1, "2025-03-10")], history).docs[0].alerts.some((a) => a.code === "retention-exempt")).toBe(false);
  });

  it("el panel de la línea avisa que decida en la factura", () => {
    const m = model([doc(1, "2025-03-10", informed)], history);
    const html = renderToStaticMarkup(createElement(RetentionSection, { view: m.docs[0], rates: [rate], versions: [], uvts: [], picks: [], onChange: () => {}, suggested: [], preview: (r) => previewRetention(r, [], "2025-03-10", [], MILLION) }));
    expect(html).toContain("decide en el detalle de la factura");
  });
});

describe("aviso tras aplicar el régimen", () => {
  it("resume lo corregido y vacío si no hubo nada", () => {
    expect(cleanupSummary({ rules: 0, supplierRules: 0, lines: 0, keptInformed: 0 })).toBe("");
    const text = cleanupSummary({ rules: 2, supplierRules: 1, lines: 3, keptInformed: 1 });
    expect(text).toContain("2 reglas de compras sin retención");
    expect(text).toContain("1 regla predeterminada de retención eliminada");
    expect(text).toContain("3 líneas corregidas");
    expect(text).toContain("1 línea con retención informada por el emisor");
  });
});
