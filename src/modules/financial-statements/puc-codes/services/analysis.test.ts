import { describe, expect, it } from "vitest";
import { NO_TITLE } from "../parser/pucParser";
import type { Assignments, DocAssignment, FileResult, ParsedPucDocument, PucProduct, TitleRule } from "../types";
import { assignedLineCount, buildReport, withDocumentCode, withLineCodes, withMode } from "./analysis";
import { loadSeededCatalog } from "./catalogFixture";
import { buildPucSheets, SIGN_LABEL, WHOLE_INVOICE } from "./excelExport";
import { actionsByFile, buildPendingActions, exportBlock, groupSummary, nextPending } from "./pending";
import { buildPucIndex } from "./pucCatalog";

const index = buildPucIndex(loadSeededCatalog());

/** Los títulos iniciales de la migración 010 (normalizados como en SQLite). */
const TITLES: TitleRule[] = [
  { normalizedTitle: "factura electronica de venta", category: "invoice" },
  { normalizedTitle: "nota de credito electronica", category: "credit_note" },
];
const NOTE = { title: "Nota de crédito electrónica" };

const product = (description: string, priceCents: number | undefined, row = 1): PucProduct =>
  priceCents === undefined ? { page: 1, row, description, issue: "No se pudo identificar el «Precio unitario de venta».", detectedText: `${description} ???` } : { page: 1, row, description, priceCents };

function doc(number: string, products: PucProduct[], extra: Partial<ParsedPucDocument> = {}): ParsedPucDocument {
  return {
    pageCount: 1,
    title: "FACTURA ELECTRÓNICA DE VENTA",
    number,
    cufe: `cufe-${number}`,
    issueDate: "2026-05-10",
    issuerNit: "900319753",
    issuerName: "PROVEEDOR SAS",
    products: products.map((p, i) => ({ ...p, row: i + 1 })),
    grossTotalCents: products.reduce((s, p) => s + (p.priceCents ?? 0), 0),
    ...extra,
  };
}
const file = (fileName: string, d: ParsedPucDocument): FileResult => ({ fileName, kind: "parsed", doc: d });
const report = (files: FileResult[], assignments: Assignments = {}, titles = TITLES) => buildReport(files, index, titles, assignments);
const single = (code: string): DocAssignment => withDocumentCode({}, code);

const ABC = [product("Producto A", 10_000_000), product("Producto B", 20_000_000), product("Producto C", 5_000_000)];

describe("buildReport: modalidades de asignación", () => {
  it("al importar todo queda Pendiente, con Código y Concepto PUC por asignar", () => {
    const r = report([file("a.pdf", doc("A-1", ABC))]);
    const row = r.rows[0];
    expect(row).toMatchObject({ classification: "pending", category: "invoice", mode: undefined, classifiedLines: 0, allocations: [] });
    expect(row.lines.map((l) => [l.description, l.priceCents, l.code, l.concept])).toEqual([
      ["Producto A", 10_000_000, undefined, undefined],
      ["Producto B", 20_000_000, undefined, undefined],
      ["Producto C", 5_000_000, undefined, undefined],
    ]);
    expect(row.problems.map((p) => p.code)).toEqual(["no-mode"]);
    expect(r.stats).toMatchObject({ files: 1, pending: 1, partial: 0, classified: 0, invoices: 1 });
    expect(r.summary).toEqual([]);
  });

  it("código único: todas las líneas lo reciben y el valor es el Total Bruto Factura, no la suma del detalle", () => {
    // El detalle suma $350.000 pero el Total Bruto Factura del PDF es $599.884.
    const r = report([file("a.pdf", doc("A-1", ABC, { grossTotalCents: 59_988_400 }))], { "a.pdf": single("513595") });
    const row = r.rows[0];
    expect(row).toMatchObject({ classification: "classified", mode: "document", documentCode: "513595", documentConcept: "OTROS", problems: [], classifiedLines: 3 });
    expect(row.lines.every((l) => l.code === "513595" && l.concept === "OTROS")).toBe(true);
    expect(row.allocations).toEqual([{ code: "513595", concept: "OTROS", valueCents: 59_988_400 }]);
    expect(r.summary).toEqual([{ code: "513595", concept: "OTROS", invoicesCents: 59_988_400, notesCents: 0, netCents: 59_988_400 }]);
  });

  it("código único sin Total Bruto Factura: queda en revisión y no suma", () => {
    const r = report([file("a.pdf", doc("A-1", ABC, { grossTotalCents: undefined }))], { "a.pdf": single("513595") });
    expect(r.rows[0].problems.map((p) => p.code)).toEqual(["gross-missing"]);
    expect(r.rows[0].allocations).toEqual([]);
    expect(exportBlock(r, buildPendingActions(r))).toBe("Falta 1 pendiente por resolver.");
    // El mismo documento se puede clasificar por producto: ahí no se usa el Total Bruto.
    const byProduct = report([file("a.pdf", doc("A-1", ABC, { grossTotalCents: undefined }))], { "a.pdf": withLineCodes({}, [0, 1, 2], "513595") });
    expect(byProduct.rows[0]).toMatchObject({ classification: "classified", problems: [], assignedCents: 35_000_000 });
  });

  it("código por producto: cada producto conserva el suyo y se agrupa por código con su Precio unitario de venta", () => {
    let a = withMode({}, "product", 3);
    a = withLineCodes(a, [0, 2], "510506");
    const partial = report([file("a.pdf", doc("A-1", ABC, { grossTotalCents: 99_999_900 }))], { "a.pdf": a });
    expect(partial.rows[0]).toMatchObject({ classification: "partial", classifiedLines: 2 });
    expect(partial.rows[0].problems.map((p) => p.code)).toEqual(["lines-without-code"]);
    expect(partial.stats).toMatchObject({ pending: 0, partial: 1, classified: 0 });

    a = withLineCodes(a, [1], "513595");
    const done = report([file("a.pdf", doc("A-1", ABC, { grossTotalCents: 99_999_900 }))], { "a.pdf": a });
    expect(done.rows[0].lines.map((l) => [l.code, l.concept])).toEqual([
      ["510506", "SUELDOS"],
      ["513595", "OTROS"],
      ["510506", "SUELDOS"],
    ]);
    expect(done.rows[0]).toMatchObject({ classification: "classified", problems: [] });
    // Producto A + C → $150.000; Producto B → $200.000. El Total Bruto no interviene.
    expect(done.summary).toEqual([
      { code: "510506", concept: "SUELDOS", invoicesCents: 15_000_000, notesCents: 0, netCents: 15_000_000 },
      { code: "513595", concept: "OTROS", invoicesCents: 20_000_000, notesCents: 0, netCents: 20_000_000 },
    ]);
    expect(done.byDocument.map((d) => [d.fileName, d.code, d.valueCents])).toEqual([
      ["a.pdf", "510506", 15_000_000],
      ["a.pdf", "513595", 20_000_000],
    ]);
  });

  it("varias facturas con el mismo código se suman en un solo renglón", () => {
    const r = report([file("1.pdf", doc("F-1", [product("x", 20_000_000)])), file("2.pdf", doc("F-2", [product("y", 30_000_000)]))], { "1.pdf": single("513595"), "2.pdf": single("513595") });
    expect(r.summary).toEqual([{ code: "513595", concept: "OTROS", invoicesCents: 50_000_000, notesCents: 0, netCents: 50_000_000 }]);
    expect(r.totals).toEqual({ invoicesCents: 50_000_000, notesCents: 0, netCents: 50_000_000 });
  });

  it("Factura suma y Nota crédito resta: +$500.000 − $100.000 = $400.000", () => {
    const files = [file("f.pdf", doc("F-1", [product("x", 50_000_000)])), file("n.pdf", doc("N-1", [product("x", 10_000_000)], NOTE))];
    const r = report(files, { "f.pdf": single("513595"), "n.pdf": single("513595") });
    expect(r.rows[1]).toMatchObject({ category: "credit_note", assignedCents: -10_000_000 });
    expect(r.summary).toEqual([{ code: "513595", concept: "OTROS", invoicesCents: 50_000_000, notesCents: -10_000_000, netCents: 40_000_000 }]);
    expect(r.stats).toMatchObject({ invoices: 1, notes: 1, classified: 2 });

    // Lo mismo por producto: la nota resta el Precio unitario de venta de cada línea.
    const byProduct = report(files, { "f.pdf": withLineCodes({}, [0], "513595"), "n.pdf": withLineCodes({}, [0], "513595") });
    expect(byProduct.summary[0].netCents).toBe(40_000_000);
  });

  it("un código que no existe o no es de 6 dígitos nunca se da por válido", () => {
    for (const code of ["999999", "1105", "11", "510505x"]) {
      const r = report([file("a.pdf", doc("A-1", ABC))], { "a.pdf": single(code) });
      expect(r.rows[0], code).toMatchObject({ classification: "pending", documentConcept: undefined, allocations: [] });
      expect(r.rows[0].problems.map((p) => p.code)).toEqual(["invalid-code"]);
    }
    const lines = report([file("a.pdf", doc("A-1", ABC))], { "a.pdf": withLineCodes({}, [0, 1, 2], "1105") });
    expect(lines.rows[0]).toMatchObject({ classification: "pending", classifiedLines: 0 });
    expect(lines.rows[0].problems.map((p) => p.code)).toEqual(["invalid-code"]);
  });

  it("por producto: una fila sin descripción o precio interpretados requiere revisión y no se inventa su valor", () => {
    const d = doc("A-1", [product("Producto A", 10_000_000), product("Producto raro", undefined)]);
    const r = report([file("a.pdf", d)], { "a.pdf": withLineCodes({}, [0], "513595") });
    expect(r.rows[0].problems.map((p) => p.code)).toEqual(["lines-unread"]);
    expect(r.rows[0].classification).toBe("partial");
    expect(r.rows[0].assignedCents).toBe(10_000_000);
    expect(r.extractionIssues).toEqual([{ fileName: "a.pdf", page: 1, row: 2, detectedText: "Producto raro ???", reason: "No se pudo identificar el «Precio unitario de venta»." }]);
    // Con un solo código la fila no bloquea: el valor es el Total Bruto Factura.
    expect(report([file("a.pdf", d)], { "a.pdf": single("513595") }).rows[0]).toMatchObject({ classification: "classified", problems: [] });
  });
});

describe("buildReport: títulos, duplicados y exclusiones", () => {
  it("un título desconocido se pregunta una sola vez y, al clasificarlo, el documento toma su signo", () => {
    const files = [file("a.pdf", doc("A-1", ABC, { title: "DOCUMENTO  XYZ" })), file("b.pdf", doc("B-1", ABC, { title: "Documento xyz" }))];
    const assignments = { "a.pdf": single("513595"), "b.pdf": single("513595") };
    const before = report(files, assignments);
    expect(before.unknownTitles).toEqual([{ normalizedTitle: "documento xyz", displayTitle: "DOCUMENTO  XYZ", documentCount: 2 }]);
    expect(before.rows.every((r) => r.category === undefined && r.allocations.length === 0)).toBe(true);
    const actions = buildPendingActions(before);
    expect(actions.map((a) => a.id)).toEqual(["title:documento xyz"]);
    expect(actions[0].fileNames).toEqual(["a.pdf", "b.pdf"]);

    const after = report(files, assignments, [...TITLES, { normalizedTitle: "documento xyz", category: "credit_note" }]);
    expect(after.unknownTitles).toEqual([]);
    expect(after.summary[0]).toMatchObject({ notesCents: -70_000_000, netCents: -70_000_000 });
    expect(buildPendingActions(after)).toEqual([]);
  });

  it("FACTURA ELECTRÓNICA DE VENTA se reconoce sin importar mayúsculas, tildes ni espacios", () => {
    const r = report([file("a.pdf", doc("A-1", ABC, { title: "  Factura   electronica DE VENTA " }))]);
    expect(r.rows[0].category).toBe("invoice");
    expect(r.rows[0].title).toBe("  Factura   electronica DE VENTA ");
  });

  it("un documento sin título requiere revisión", () => {
    const r = report([file("a.pdf", doc("A-1", ABC, { title: NO_TITLE }))], { "a.pdf": single("513595") });
    expect(r.rows[0].problems.map((p) => p.code)).toEqual(["title-missing"]);
    expect(r.unknownTitles).toEqual([]);
    expect(r.summary).toEqual([]);
  });

  it("duplicado por CUFE: no se suma dos veces y solo se puede excluir", () => {
    const files = [file("a.pdf", doc("A-1", ABC, { cufe: "abc" })), file("copia.pdf", doc("OTRO-NUMERO", ABC, { cufe: "abc" }))];
    const assignments: Assignments = { "a.pdf": single("513595"), "copia.pdf": single("513595") };
    const r = report(files, assignments);
    expect(r.rows[1]).toMatchObject({ duplicateOf: "a.pdf", duplicateBy: "cufe", allocations: [] });
    expect(r.rows[1].problems.map((p) => p.code)).toEqual(["duplicate"]);
    expect(r.summary[0].netCents).toBe(35_000_000);
    expect(r.stats.duplicates).toBe(1);

    const resolved = report(files, { ...assignments, "copia.pdf": { ...assignments["copia.pdf"], excluded: true } });
    expect(resolved.rows[1]).toMatchObject({ excluded: true, problems: [], duplicateOf: undefined });
    expect(resolved.summary[0].netCents).toBe(35_000_000);
    expect(buildPendingActions(resolved)).toEqual([]);
  });

  it("duplicado por NIT + número cuando falta el CUFE; dos CUFE distintos son documentos distintos", () => {
    const sameNumber = [file("a.pdf", doc("FE 100", ABC, { cufe: undefined })), file("b.pdf", doc("fe-100", ABC, { cufe: "zzz" }))];
    const r = report(sameNumber, { "a.pdf": single("513595"), "b.pdf": single("513595") });
    expect(r.rows[1]).toMatchObject({ duplicateOf: "a.pdf", duplicateBy: "number" });
    expect(r.summary[0].netCents).toBe(35_000_000);
    // El usuario confirma que es otro documento: se tiene en cuenta.
    const included = report(sameNumber, { "a.pdf": single("513595"), "b.pdf": { ...single("513595"), includeDuplicate: true } });
    expect(included.rows[1].problems).toEqual([]);
    expect(included.summary[0].netCents).toBe(70_000_000);

    const different = report([file("a.pdf", doc("FE-100", ABC, { cufe: "aaa" })), file("b.pdf", doc("FE-100", ABC, { cufe: "bbb" }))]);
    expect(different.rows.map((x) => x.duplicateOf)).toEqual([undefined, undefined]);
    // Otro emisor con el mismo número no es duplicado.
    const otherIssuer = report([file("a.pdf", doc("FE-100", ABC, { cufe: undefined })), file("b.pdf", doc("FE-100", ABC, { cufe: undefined, issuerNit: "800111222" }))]);
    expect(otherIssuer.rows[1].duplicateOf).toBeUndefined();
  });

  it("archivos que no se pudieron leer bloquean hasta excluirlos", () => {
    const files: FileResult[] = [file("a.pdf", doc("A-1", ABC)), { fileName: "escaneado.pdf", kind: "incompatible", message: "El PDF no contiene texto." }];
    const r = report(files, { "a.pdf": single("513595") });
    const actions = buildPendingActions(r);
    expect(actions.map((a) => [a.group, a.where])).toEqual([["failed", "escaneado.pdf"]]);
    const done = report(files, { "a.pdf": single("513595"), "escaneado.pdf": { excluded: true } });
    expect(buildPendingActions(done)).toEqual([]);
    expect(done.stats).toMatchObject({ excluded: 1, classified: 1, pending: 0 });
  });
});

describe("cambio de estrategia", () => {
  it("de un solo código a por producto: las líneas conservan el código de la factura", () => {
    const a = withMode(single("513595"), "product", 3);
    expect(a).toMatchObject({ mode: "product", documentCode: undefined, lineCodes: { 0: "513595", 1: "513595", 2: "513595" } });
    const changed = withLineCodes(a, [1], "510506");
    const r = report([file("a.pdf", doc("A-1", ABC))], { "a.pdf": changed });
    expect(r.summary.map((s) => [s.code, s.netCents])).toEqual([
      ["510506", 20_000_000],
      ["513595", 15_000_000],
    ]);
  });

  it("aplicar un solo código a toda la factura reemplaza los códigos por producto", () => {
    const perLine = withLineCodes(withLineCodes({}, [0], "510506"), [1], "513595");
    expect(assignedLineCount(perLine)).toBe(2);
    const whole = withMode(perLine, "document", 3);
    expect(whole).toMatchObject({ mode: "document", documentCode: undefined, lineCodes: undefined });
    expect(assignedLineCount(whole)).toBe(0);
    expect(withMode(whole, "document", 3)).toBe(whole);
    // Quitar el código de una línea la deja de nuevo pendiente.
    expect(withLineCodes(perLine, [0], undefined).lineCodes).toEqual({ 1: "513595" });
  });
});

describe("pendientes y bloqueo de exportación", () => {
  const files = [file("a.pdf", doc("A-1", ABC)), file("b.pdf", doc("B-1", ABC)), file("c.pdf", doc("C-1", ABC))];

  it("cada pendiente dice qué falta y en qué factura; mientras exista uno no se exporta", () => {
    const r = report(files, { "a.pdf": single("513595"), "b.pdf": withLineCodes({}, [0], "510506") });
    const actions = buildPendingActions(r);
    expect(actions.map((a) => [a.what, a.where, a.group])).toEqual([
      ["Producto sin código PUC", "B-1 — PROVEEDOR SAS", "code"],
      ["Factura sin modalidad de asignación", "C-1 — PROVEEDOR SAS", "mode"],
    ]);
    expect(actions[0].detail).toBe("2 productos sin código PUC.");
    expect(groupSummary(actions).map((g) => [g.group, g.count])).toEqual([
      ["code", 1],
      ["mode", 1],
    ]);
    expect([...actionsByFile(actions).keys()]).toEqual(["b.pdf", "c.pdf"]);
    expect(exportBlock(r, actions)).toBe("Faltan 2 pendientes por resolver.");
    // «Siguiente pendiente»: avanza y da la vuelta.
    expect(nextPending(actions)?.id).toBe("doc:b.pdf");
    expect(nextPending(actions, "doc:b.pdf")?.id).toBe("doc:c.pdf");
    expect(nextPending(actions, "doc:c.pdf")?.id).toBe("doc:b.pdf");
    expect(nextPending(actions, "doc:a.pdf")?.id).toBe("doc:b.pdf");
  });

  it("con todo resuelto quedan 0 pendientes y se habilita la exportación", () => {
    const r = report(files, { "a.pdf": single("513595"), "b.pdf": withLineCodes({}, [0, 1, 2], "510506"), "c.pdf": { excluded: true } });
    const actions = buildPendingActions(r);
    expect(actions).toEqual([]);
    expect(exportBlock(r, actions)).toBeNull();
    expect(nextPending(actions)).toBeUndefined();
    expect(r.stats).toMatchObject({ pending: 0, partial: 0, classified: 2, excluded: 1 });
  });

  it("sin nada clasificado tampoco hay qué exportar", () => {
    const r = report(files, { "a.pdf": { excluded: true }, "b.pdf": { excluded: true }, "c.pdf": { excluded: true } });
    expect(buildPendingActions(r)).toEqual([]);
    expect(exportBlock(r, [])).toBe("No hay facturas clasificadas para exportar.");
  });
});

describe("exportación a Excel", () => {
  it("Detalle y Resumen PUC cuadran entre sí en los dos modos y con notas crédito", () => {
    const files = [
      file("unico.pdf", doc("U-1", ABC, { grossTotalCents: 59_988_400 })),
      file("productos.pdf", doc("P-1", ABC)),
      file("nota.pdf", doc("N-1", [product("Devolución", 10_000_000)], NOTE)),
      file("fuera.pdf", doc("X-1", ABC)),
    ];
    const r = report(files, {
      "unico.pdf": single("513595"),
      "productos.pdf": withLineCodes(withLineCodes({}, [0, 2], "510506"), [1], "513595"),
      "nota.pdf": withLineCodes({}, [0], "510506"),
      "fuera.pdf": { excluded: true },
    });
    const [detail, summary] = buildPucSheets(r);
    expect(detail.name).toBe("Detalle");
    expect(detail.columns.map((c) => c.header)).toEqual([
      "Archivo",
      "Número de factura",
      "Fecha",
      "NIT emisor",
      "Razón social",
      "Tipo clasificado",
      "Descripción producto",
      "Precio unitario de venta",
      "Código PUC",
      "Concepto PUC",
      "Signo",
      "Valor neto",
    ]);
    expect(detail.rows).toEqual([
      ["unico.pdf", "U-1", "10/05/2026", "900319753", "PROVEEDOR SAS", "Factura electrónica", WHOLE_INVOICE, null, "513595", "OTROS", SIGN_LABEL[1], 599_884],
      ["productos.pdf", "P-1", "10/05/2026", "900319753", "PROVEEDOR SAS", "Factura electrónica", "Producto A", 100_000, "510506", "SUELDOS", SIGN_LABEL[1], 100_000],
      ["productos.pdf", "P-1", "10/05/2026", "900319753", "PROVEEDOR SAS", "Factura electrónica", "Producto B", 200_000, "513595", "OTROS", SIGN_LABEL[1], 200_000],
      ["productos.pdf", "P-1", "10/05/2026", "900319753", "PROVEEDOR SAS", "Factura electrónica", "Producto C", 50_000, "510506", "SUELDOS", SIGN_LABEL[1], 50_000],
      ["nota.pdf", "N-1", "10/05/2026", "900319753", "PROVEEDOR SAS", "Nota crédito", "Devolución", 100_000, "510506", "SUELDOS", SIGN_LABEL[-1], -100_000],
    ]);
    expect(summary.name).toBe("Resumen PUC");
    expect(summary.columns.map((c) => c.header)).toEqual(["Código", "Concepto", "Total Facturas", "Total Notas crédito", "Total neto"]);
    expect(summary.rows).toEqual([
      ["510506", "SUELDOS", 150_000, -100_000, 50_000],
      ["513595", "OTROS", 799_884, 0, 799_884],
    ]);
    const net = (rows: (string | number | null)[][], at: number) => rows.reduce((s, row) => s + (row[at] as number), 0);
    expect(net(detail.rows, 11)).toBe(net(summary.rows, 4));
  });
});
