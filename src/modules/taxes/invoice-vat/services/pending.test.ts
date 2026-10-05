import { describe, expect, it } from "vitest";
import type { Supplier } from "../../../../types/models";
import type { Decisions, FileResult, InvoiceLine, ParsedInvoice, ProductLine, TitleRule } from "../types";
import { buildReport } from "./analysis";
import { actionsByFile, buildPendingActions, groupLabel, groupSummary, lotStatus, nextPending } from "./pending";

const line = (rateBp: number, baseCents: number, vatCents: number): InvoiceLine => ({ page: 1, description: "", rateBp, baseCents, vatCents });

function invoice(nit: string, number: string, products: ProductLine[], extra: Partial<ParsedInvoice> = {}): ParsedInvoice {
  const lines = products.filter((p): p is InvoiceLine => !p.issue);
  return {
    pageCount: 1,
    documentType: "FACTURA ELECTRÓNICA DE VENTA",
    invoiceNumber: number,
    supplierNit: nit,
    supplierName: `PROV ${nit}`,
    lines,
    lineIssues: [],
    products,
    subtotalCents: products.reduce((s, p) => s + (p.baseCents ?? 0), 0),
    invoiceVatCents: lines.reduce((s, l) => s + l.vatCents, 0),
    ...extra,
  };
}

const file = (fileName: string, inv: ParsedInvoice): FileResult => ({ fileName, kind: "parsed", invoice: inv });
const supplier = (id: number, nit: string): Supplier => ({ id, nit, businessName: `PROV ${nit}`, vatType: "purchase", createdAt: "", updatedAt: "" });
const TITLES: TitleRule[] = [{ normalizedTitle: "factura electronica de venta", category: "invoice" }];

/** 2 proveedores sin Tipo IVA, 1 título nuevo, 2 documentos con productos sin interpretar y 1 archivo ilegible. */
const FILES: FileResult[] = [
  file("a1.pdf", invoice("111", "A-1", [line(1900, 10_000, 1_900)])),
  file("a2.pdf", invoice("111", "A-2", [line(1900, 10_000, 1_900)])),
  file("b1.pdf", invoice("222", "B-1", [line(0, 5_000, 0)])),
  file("x1.pdf", invoice("333", "X-1", [line(0, 5_000, 0)], { documentType: "DOCUMENTO NUEVO XYZ" })),
  file("p1.pdf", invoice("333", "P-1", [{ page: 1, description: "Sin tarifa", vatCents: 190, baseCents: 1_000, issue: "No se pudo identificar: %." }], { invoiceVatCents: 190 })),
  file("p2.pdf", invoice("333", "P-2", [{ page: 1, description: "Sin tarifa", vatCents: 190, baseCents: 1_000, issue: "No se pudo identificar: %." }], { invoiceVatCents: 190 })),
  { fileName: "roto.pdf", kind: "error", message: "El PDF está dañado." },
];

const pending = (suppliers: Supplier[], titles = TITLES, decisions: Decisions = {}) => buildPendingActions(buildReport(FILES, suppliers, titles, { decisions }));

describe("pendientes de IVA de compras", () => {
  it("agrupa los pendientes en una frase por tipo de problema", () => {
    const actions = pending([supplier(3, "333")]);
    expect(actions).toHaveLength(6);
    expect(lotStatus(actions)).toEqual({ kind: "attention", pending: 6 });
    expect(groupSummary(actions).map((g) => groupLabel(g.group, g.count))).toEqual([
      "2 proveedores sin Tipo IVA",
      "1 nuevo tipo de documento sin clasificar",
      "2 documentos con productos no interpretados",
      "1 documento con información incompleta",
    ]);
    // Un proveedor con varias facturas es un solo pendiente que cubre todas sus filas.
    expect(actions[0]).toMatchObject({ id: "supplier:111", actionLabel: "Configurar proveedor", fileNames: ["a1.pdf", "a2.pdf"] });
    expect(actions.find((a) => a.group === "product")).toMatchObject({ actionLabel: "Revisar producto", target: { kind: "document", fileName: "p1.pdf" } });
  });

  it("al resolver uno baja el contador y el recorrido sigue con el siguiente", () => {
    const before = pending([supplier(3, "333")]);
    expect(nextPending(before)?.id).toBe("supplier:111");
    expect(nextPending(before, "supplier:111")?.id).toBe("supplier:222");

    const after = pending([supplier(3, "333"), supplier(1, "111")]);
    expect(after).toHaveLength(before.length - 1);
    expect(nextPending(after)?.id).toBe("supplier:222");
    expect(actionsByFile(after).has("a1.pdf")).toBe(false);
    expect(actionsByFile(after).get("b1.pdf")?.id).toBe("supplier:222");
  });

  it("queda «Listo para declaración» solo cuando no hay ningún pendiente", () => {
    const suppliers = [supplier(1, "111"), supplier(2, "222"), supplier(3, "333")];
    const titles: TitleRule[] = [...TITLES, { normalizedTitle: "documento nuevo xyz", category: "credit_note" }];
    const almost = pending(suppliers, titles, { "p1.pdf": { lines: { 0: 1900 } }, "p2.pdf": { lines: { 0: 1900 } } });
    expect(almost.map((a) => a.id)).toEqual(["doc:roto.pdf"]);
    expect(lotStatus(almost)).toEqual({ kind: "attention", pending: 1 });

    const done = buildReport(FILES, suppliers, titles, { decisions: { "p1.pdf": { lines: { 0: 1900 } }, "p2.pdf": { lines: { 0: 1900 } }, "roto.pdf": { excluded: true } } });
    expect(lotStatus(buildPendingActions(done))).toEqual({ kind: "ready" });
    expect(done.stats).toMatchObject({ pending: 0, validated: 6, excluded: 1 });
    expect(done.summary.notes.documentCount).toBe(1);
  });

  it("un documento con su propio problema se resuelve en su detalle aunque su proveedor también esté pendiente", () => {
    const actions = pending([]);
    expect(actionsByFile(actions).get("p1.pdf")?.id).toBe("doc:p1.pdf");
    expect(actionsByFile(actions).get("x1.pdf")?.id).toBe("supplier:333");
  });
});
