import { describe, expect, it } from "vitest";
import type { DocumentTitleMapping, PersonType, Supplier, SupplierWithholdingRule, UvtValue, WithholdingRate } from "../../../../types/models";
import type { FileResult, ParsedDocument } from "../types";
import { buildWithholdingReport, type AnalysisContext } from "./analysis";
import { actionable, actionsByFile, buildPendingActions, groupLabel, groupSummary, lotStatus, nextPending } from "./pending";

const pesos = (n: number) => n * 100;

const RATES: WithholdingRate[] = [{ id: 6, retentionType: "services", name: "Servicios generales (declarantes)", baseUvtCenti: 200, rateBp: 400, sortOrder: 6, createdAt: "", updatedAt: "" }];
const UVTS: UvtValue[] = [{ year: 2026, valuePesos: 52_374, updatedAt: "" }];
const INVOICE: DocumentTitleMapping = { id: 1, normalizedTitle: "factura electronica de venta", displayTitle: "FACTURA ELECTRÓNICA DE VENTA", category: "invoice", createdAt: "", updatedAt: "" };
const NOTE: DocumentTitleMapping = { id: 2, normalizedTitle: "nota credito electronica", displayTitle: "NOTA CRÉDITO ELECTRÓNICA", category: "credit_note", createdAt: "", updatedAt: "" };

function doc(nit: string, number: string, subtotal: number, extra: Partial<ParsedDocument> = {}): ParsedDocument {
  return {
    pageCount: 1,
    title: "FACTURA ELECTRÓNICA DE VENTA",
    number,
    issueDate: "2026-01-15",
    supplierNit: nit,
    supplierName: `PROV ${nit}`,
    taxpayerType: "Persona Jurídica",
    fiscalText: "Régimen Fiscal: R-99-PN",
    fiscalCodes: ["R-99-PN"],
    subtotalCents: pesos(subtotal),
    retefuenteCents: 0,
    products: { columns: [], rows: [] },
    ...extra,
  };
}

const file = (fileName: string, d: ParsedDocument): FileResult => ({ fileName, kind: "parsed", doc: d });
const rule: SupplierWithholdingRule = { id: 6, rateId: 6, baseMode: "invoice_subtotal", isDefault: true };
const supplier = (id: number, nit: string, personType: PersonType | null, rules: SupplierWithholdingRule[]): Supplier => ({
  id, nit, businessName: `PROV ${nit}`, vatType: "service", createdAt: "", updatedAt: "", personType, fiscalRegime: "R-99-PN", fiscalCheckedAt: null, withholdingRules: rules,
});

// Lote de la prueba: proveedor sin PJ / PN, proveedor sin subtipo, título desconocido y diferencia de retención.
const FILES = [
  file("sin-pj.pdf", doc("1", "A-1", 1_000_000)),
  file("sin-subtipo.pdf", doc("2", "B-1", 1_000_000)),
  file("titulo.pdf", doc("3", "C-1", 1_000_000, { title: "DOCUMENTO SOPORTE" })),
  file("diferencia.pdf", doc("3", "C-2", 1_000_000, { retefuenteCents: pesos(25_000) })),
  file("ok.pdf", doc("3", "C-3", 1_000_000, { retefuenteCents: pesos(40_000) })),
];

function analyze(ctx: Partial<AnalysisContext> = {}) {
  const suppliers = ctx.suppliers ?? [supplier(1, "1", null, [rule]), supplier(2, "2", "PJ", []), supplier(3, "3", "PJ", [rule])];
  const report = buildWithholdingReport(FILES, { suppliers, rates: RATES, uvts: UVTS, titles: [INVOICE, NOTE], ...ctx });
  return { report, actions: buildPendingActions(report) };
}

describe("pendientes del lote", () => {
  it("4 pendientes bloqueantes, agrupados, con su acción y filas afectadas", () => {
    const { actions } = analyze();
    expect(actionable(actions)).toHaveLength(4);
    expect(lotStatus(actions)).toEqual({ kind: "attention", pending: 4, blocking: 4 });
    expect(actions.map((a) => [a.id, a.group, a.actionLabel])).toEqual([
      ["supplier:1", "supplier-person", "Configurar ahora"],
      ["supplier:2", "supplier-rules", "Configurar ahora"],
      ["doc:diferencia.pdf", "difference", "Revisar"],
      ["title:documento soporte", "title", "Clasificar"],
    ]);
    expect(groupSummary(actions).map((g) => groupLabel(g.group, g.count))).toEqual([
      "1 proveedor sin PJ / PN",
      "1 proveedor sin tipo y subtipo de retención",
      "1 documento con diferencia de retención",
      "1 título de documento sin clasificar",
    ]);
    const byFile = actionsByFile(actions);
    expect([...byFile.keys()].sort()).toEqual(["diferencia.pdf", "sin-pj.pdf", "sin-subtipo.pdf", "titulo.pdf"]);
    expect(byFile.has("ok.pdf")).toBe(false);
    expect(nextPending(actions)?.id).toBe("supplier:1");
    expect(nextPending(actions, "supplier:1")?.id).toBe("supplier:2");
  });

  it("al resolver uno pasa de 4 a 3 sin releer los PDF; resueltos todos queda listo para declaración", () => {
    const fixed = [supplier(1, "1", "PJ", [rule]), supplier(2, "2", "PJ", []), supplier(3, "3", "PJ", [rule])];
    const step1 = analyze({ suppliers: fixed });
    expect(actionable(step1.actions)).toHaveLength(3);

    const all = [supplier(1, "1", "PJ", [rule]), supplier(2, "2", "PJ", [rule]), supplier(3, "3", "PJ", [rule])];
    const done = analyze({
      suppliers: all,
      titles: [INVOICE, NOTE, { ...INVOICE, id: 3, normalizedTitle: "documento soporte", displayTitle: "DOCUMENTO SOPORTE" }],
      decisions: { "diferencia.pdf": { review: { kind: "accept-informed" } } },
    });
    expect(done.actions).toEqual([]);
    expect(lotStatus(done.actions)).toEqual({ kind: "ready", warnings: 0 });
    expect(done.report.rows.every((r) => r.status === "validated")).toBe(true);
  });

  it("un cambio de régimen es advertencia: no impide «Listo para declaración»", () => {
    const suppliers = [1, 2, 3].map((n) => ({ ...supplier(n, String(n), "PJ", [rule]), fiscalRegime: n === 1 ? "O-13" : "R-99-PN" }));
    const { actions } = analyze({
      suppliers,
      titles: [INVOICE, NOTE, { ...INVOICE, id: 3, normalizedTitle: "documento soporte", displayTitle: "DOCUMENTO SOPORTE" }],
      decisions: { "diferencia.pdf": { review: { kind: "accept-informed" } } },
    });
    expect(actions.map((a) => [a.id, a.severity])).toEqual([["fiscal-change:1", "warning"]]);
    expect(lotStatus(actions)).toEqual({ kind: "ready", warnings: 1 });
  });

  it("proveedor sin régimen asignado es bloqueante: detectado en la factura o por escribir", () => {
    const noRegime = (id: number, nit: string) => ({ ...supplier(id, nit, "PJ", [rule]), fiscalRegime: null });
    const files = [file("a.pdf", doc("7", "X-1", 1_000_000)), file("b.pdf", doc("8", "Y-1", 1_000_000, { fiscalCodes: [], fiscalText: undefined }))];
    const report = buildWithholdingReport(files, { suppliers: [noRegime(7, "7"), noRegime(8, "8")], rates: RATES, uvts: UVTS, titles: [INVOICE] });
    const actions = buildPendingActions(report);
    expect(actions.map((a) => [a.id, a.severity, a.fileNames])).toEqual([
      ["fiscal-missing:7", "blocking", ["a.pdf"]],
      ["fiscal-unknown:8", "blocking", ["b.pdf"]],
    ]);
    expect(lotStatus(actions)).toEqual({ kind: "attention", pending: 2, blocking: 2 });

    const saved = buildWithholdingReport(files, { suppliers: [supplier(7, "7", "PJ", [rule]), { ...supplier(8, "8", "PJ", [rule]), fiscalRegime: "O-13" }], rates: RATES, uvts: UVTS, titles: [INVOICE] });
    expect(buildPendingActions(saved)).toEqual([]);
  });

  it("régimen en conflicto dentro del lote es bloqueante hasta confirmarlo", () => {
    const files = [file("a.pdf", doc("9", "X-1", 1_000_000)), file("b.pdf", doc("9", "X-2", 1_000_000, { fiscalCodes: ["O-13"], fiscalText: "O-13" }))];
    const report = buildWithholdingReport(files, { suppliers: [supplier(9, "9", "PJ", [rule])], rates: RATES, uvts: UVTS, titles: [INVOICE] });
    expect(buildPendingActions(report).map((a) => [a.group, a.severity])).toEqual([["fiscal-conflict", "blocking"]]);
    expect(buildPendingActions(report, new Set(["9"]))).toEqual([]);
  });
});
