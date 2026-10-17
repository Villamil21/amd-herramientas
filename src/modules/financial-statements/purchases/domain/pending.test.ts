import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PurchaseDocument, PurchaseLine, PurchasesState, YearConcept } from "../../../../types/purchases";
import { buildPucIndex } from "../../puc-codes/services/pucCatalog";
import { PendingPanelBody, type PanelMemo } from "../ui/PendingPanel";
import { StatusStrip, cardLabel } from "../ui/StatusStrip";
import { getPendingReturn, setPendingReturn, takePendingReturn } from "../pendingReturn";
import { buildPurchasesModel, type PurchasesInput } from "./model";
import { buildPendingReport, panelVisible, progressText } from "./pending";
import { DESTS } from "./status";

const NIT = "901817531";
const COMPANY = { id: 1, nit: NIT, razonSocial: "MONO SAS" } as never;

const line = (index: number): PurchaseLine => ({ index, page: 1, code: `P${index}`, description: `Producto ${index}`, unit: "UN", baseCents: 100_000_00, vatCents: 19_000_00 });

function doc(id: number, over: Partial<PurchaseDocument> & { lines?: PurchaseLine[]; title?: string; issuer?: object } = {}): PurchaseDocument {
  const lines = over.lines ?? [line(0)];
  const base = lines.reduce((s, l) => s + (l.baseCents ?? 0), 0);
  const vat = lines.reduce((s, l) => s + (l.vatCents ?? 0), 0);
  return {
    id,
    uploadId: 1,
    fileName: `f${id}.pdf`,
    buyerNit: NIT,
    buyerName: "MONO SAS",
    year: 2025,
    issueDate: "2025-03-10",
    issuerNit: "900111222",
    issuerName: "PROVEEDOR SAS",
    numberKey: `FE${id}`,
    totalCents: base + vat,
    titleKey: over.title ?? "factura electronica de venta",
    cufe: null,
    fingerprint: `fp${id}`,
    status: "current",
    duplicateOf: null,
    importedAt: "2025-04-01",
    data: {
      pageCount: 1,
      title: "FACTURA ELECTRÓNICA DE VENTA",
      number: `FE${id}`,
      issueDate: "2025-03-10",
      issuer: { nit: "900111222", name: "PROVEEDOR SAS", personType: "PJ", fiscalCodes: ["O-13"], ...(over.issuer ?? {}) },
      buyerNit: NIT,
      buyerName: over.buyerName ?? "MONO SAS",
      lines,
      subtotalCents: base,
      vatCents: vat,
      totalCents: base + vat,
    },
    ...over,
  } as PurchaseDocument;
}

const concept: YearConcept = { year: 2025, code: "5001", description: "Salarios", isActive: true, validFrom: "2025-01-01", validTo: null } as never;

function input(docs: PurchaseDocument[], over: Partial<PurchasesInput> = {}, state: Partial<PurchasesState> = {}): PurchasesInput {
  return {
    buyerNit: NIT,
    year: 2025,
    state: { uploads: [], documents: docs, lineClasses: [], flags: [], audit: [], ...state },
    company: COMPANY,
    companyVat: [{ effectiveDate: "2025-01-01", responsible: true } as never],
    titleTypes: [{ titleKey: "factura electronica de venta", kind: "purchase" } as never, { titleKey: "nota credito electronica", kind: "return" } as never],
    rules: [],
    suppliers: [],
    supplierFiscal: [],
    pucIndex: buildPucIndex([{ code: "510506", concept: "Sueldos" }, { code: "1", concept: "Activo" }, { code: "5", concept: "Gastos" }] as never),
    pucConcepts: new Map(),
    concepts1001: [concept],
    rates: [],
    uvts: [],
    catalogs: null,
    ...over,
  };
}

const classify = (docId: number, idx = 0, over: object = {}) => ({ documentId: docId, lineIndex: idx, pucCode: "510506", concept1001: "5001", retention: [], ruleId: null, scope: "invoice", confirmedAt: "", ...over }) as never;
const many = (n: number) => Array.from({ length: n }, (_, i) => doc(i + 1, { lines: [line(0), line(1)] }));

describe("panel de pendientes por destino", () => {
  it("agrupa la misma causa de varias facturas en un solo grupo y cuenta líneas y facturas", () => {
    const m = buildPurchasesModel(input(many(3)));
    const r = buildPendingReport(m, "EEFF");
    const g = r.groups.find((x) => x.code === "line-unconfirmed")!;
    expect(r.groups.filter((x) => x.code === "line-unconfirmed")).toHaveLength(1);
    expect(g.items).toHaveLength(6);
    expect(g.documents).toBe(3);
    expect(g.lines).toBe(6);
    expect(g.scope).toBe("6 líneas en 3 facturas");
    expect(g.cause).toBe("Líneas sin PUC o concepto");
    expect(g.effect).toContain("Estados Financieros");
    expect(g.action).toBe("Confirmar");
  });

  it("filtra por destino: un PUC inválido solo bloquea EEFF y un concepto inválido solo el 1001", () => {
    const m = buildPurchasesModel(input([doc(1), doc(2)], {}, { lineClasses: [classify(1, 0, { pucCode: "999999" }), classify(2, 0, { concept1001: "ZZZZ" })] }));
    const eeff = buildPendingReport(m, "EEFF");
    const f1001 = buildPendingReport(m, "1001");
    expect(eeff.groups.map((g) => g.code)).toContain("puc-invalid");
    expect(f1001.groups.map((g) => g.code)).not.toContain("puc-invalid");
    expect(f1001.groups.map((g) => g.code)).toContain("concept-invalid");
    expect(eeff.groups.map((g) => g.code)).not.toContain("concept-invalid");
    // el resumen coincide con los conteos de la tarjeta
    expect(eeff.summary).toEqual(m.counts.EEFF);
    expect(f1001.summary).toEqual(m.counts["1001"]);
  });

  it("un pendiente que afecta solo al formato 1001 no aparece en Estados Financieros ni en 1005/1006", () => {
    const m = buildPurchasesModel(input([doc(1)], {}, { lineClasses: [classify(1, 0, { concept1001: "ZZZZ" })] }));
    expect(buildPendingReport(m, "EEFF").groups.map((g) => g.code)).not.toContain("concept-invalid");
    const g = buildPendingReport(m, "1001").groups.find((x) => x.code === "concept-invalid")!;
    expect(g.scope).toBe("1 línea en 1 factura");
    expect(g.effect).toContain("Formato 1001");
    expect(buildPendingReport(m, "1005").groups.map((x) => x.code)).not.toContain("concept-invalid");
    expect(buildPendingReport(m, "1006").groups.map((x) => x.code)).not.toContain("concept-invalid");
  });

  it("resolver una línea actualiza de inmediato conteos, grupos y progreso", () => {
    const before = buildPurchasesModel(input(many(2)));
    const b = buildPendingReport(before, "EEFF");
    expect(b.progress).toEqual({ resolved: 0, total: 4 });
    const after = buildPurchasesModel(input(many(2), {}, { lineClasses: [classify(1, 0)] }));
    const a = buildPendingReport(after, "EEFF");
    expect(a.summary.pending).toBe(b.summary.pending - 1);
    expect(a.progress).toEqual({ resolved: 1, total: 4 });
    expect(progressText(a.progress!)).toBe("1 de 4 líneas resueltas");
    expect(a.groups.find((g) => g.code === "line-unconfirmed")!.items).toHaveLength(3);
    expect(after.counts.EEFF.pending).toBe(a.summary.pending);
  });

  it("separa las líneas con propuesta de las que no tienen PUC ni concepto", () => {
    const m = buildPurchasesModel(input([doc(1)]));
    expect(buildPendingReport(m, "EEFF").groups.find((g) => g.code === "line-unconfirmed")!.cause).toBe("Líneas sin PUC o concepto");
  });

  it("destino listo: sin grupos y estado Listo", () => {
    const m = buildPurchasesModel(input([doc(1)], { suppliers: [], catalogs: null }, { lineClasses: [classify(1)] }));
    const r = buildPendingReport(m, "EEFF");
    expect(r.status).toBe("ready");
    expect(r.groups).toHaveLength(0);
    expect(r.progress).toEqual({ resolved: 1, total: 1 });
  });

  it("1005 y 1006 muestran «No aplica» con su justificación y ninguna lista cuando la empresa no es responsable de IVA", () => {
    const m = buildPurchasesModel(input([doc(1)], { companyVat: [{ effectiveDate: "2025-01-01", responsible: false } as never] }));
    for (const d of ["1005", "1006"] as const) {
      const r = buildPendingReport(m, d);
      expect(r.status).toBe("na");
      expect(r.groups).toHaveLength(0);
      expect(r.notApplicable).toContain("no era responsable de IVA");
    }
    expect(buildPendingReport(m, "EEFF").notApplicable).toBeUndefined();
  });

  it("perfil de IVA faltante: causa única de empresa que apunta a la ficha de Empresas", () => {
    const m = buildPurchasesModel(input([doc(1)], { companyVat: [] }));
    const g = buildPendingReport(m, "1005").groups.find((x) => x.code === "vat-year-unknown")!;
    expect(g.cause).toBe("Perfil de IVA de la empresa faltante");
    expect(g.items[0].target).toEqual({ kind: "company", nit: NIT });
    expect(buildPendingReport(m, "EEFF").groups.map((x) => x.code)).not.toContain("vat-year-unknown");
  });

  it("encabezado sin clasificar y nombre de comprador por confirmar son causas propias", () => {
    const m = buildPurchasesModel(input([doc(1, { title: "documento raro" }), doc(2, { buyerName: "OTRA EMPRESA SA" })]));
    const codes = buildPendingReport(m, "EEFF").groups.map((g) => g.cause);
    expect(codes).toContain("Tipo de comprobante sin clasificar");
    expect(codes).toContain("Facturas con nombre de comprador por confirmar");
  });

  it("el estado de cada destino se respeta tal cual lo calcula el modelo", () => {
    const m = buildPurchasesModel(input(many(1)));
    for (const d of DESTS) expect(buildPendingReport(m, d).status).toBe(m.status[d]);
  });
});

describe("render del panel", () => {
  const memo = () => ({ current: { expanded: [], scroll: 0 } as PanelMemo });
  const html = (m: ReturnType<typeof buildPurchasesModel>, d: (typeof DESTS)[number]) => renderToStaticMarkup(createElement(PendingPanelBody, { report: buildPendingReport(m, d), memo: memo(), onResolve: () => undefined }));

  it("muestra resumen, avance, causa, efecto y acción", () => {
    const out = html(buildPurchasesModel(input(many(2))), "EEFF");
    expect(out).toContain("0 de 4 líneas resueltas");
    expect(out).toContain("bloquean");
    expect(out).toContain("por confirmar");
    expect(out).toContain("por revisar");
    expect(out).toContain("Líneas sin PUC o concepto");
    expect(out).toContain("4 líneas en 2 facturas");
    expect(out).toContain("Efecto en Estados Financieros");
    expect(out).toContain("Cómo resolverlo");
    expect(out).toContain("Confirmar: la primera");
  });

  it("estado vacío cuando el destino está listo", () => {
    const out = html(buildPurchasesModel(input([doc(1)], {}, { lineClasses: [classify(1)] })), "EEFF");
    expect(out).toContain("Sin pendientes");
    expect(out).not.toContain("pending-group");
  });

  it("No aplica muestra la justificación y no la lista", () => {
    const out = html(buildPurchasesModel(input([doc(1)], { companyVat: [{ effectiveDate: "2025-01-01", responsible: false } as never] })), "1005");
    expect(out).toContain("No aplica");
    expect(out).toContain("no era responsable de IVA");
    expect(out).not.toContain("pending-group");
  });

  it("los grupos abiertos que recuerda el panel se vuelven a mostrar al regresar", () => {
    const m = buildPurchasesModel(input(many(2)));
    const key = buildPendingReport(m, "EEFF").groups[0].key;
    const out = renderToStaticMarkup(createElement(PendingPanelBody, { report: buildPendingReport(m, "EEFF"), memo: { current: { expanded: [key], scroll: 120 } }, onResolve: () => undefined }));
    expect(out).toContain("pending-group__items");
  });
});

describe("tarjetas de destino", () => {
  const m = buildPurchasesModel(input(many(1)));
  type El = { type: unknown; props: { children?: unknown; onClick?: () => void; [k: string]: unknown } };
  const find = (node: unknown, pred: (e: El) => boolean, out: El[] = []): El[] => {
    if (Array.isArray(node)) node.forEach((n) => find(n, pred, out));
    else if (node && typeof node === "object" && "props" in node) {
      const e = node as El;
      if (pred(e)) out.push(e);
      find(e.props.children, pred, out);
    }
    return out;
  };

  it("cada tarjeta es un único botón que contiene destino, estado y detalle, y abre su propio destino", () => {
    const picked: string[] = [];
    const tree = StatusStrip({ counts: m.counts, status: m.status, notApplicable: m.notApplicable, onSelect: (d) => picked.push(d) });
    const buttons = find(tree, (e) => e.type === "button");
    expect(buttons).toHaveLength(4);
    for (const b of buttons) {
      expect(b.props.type).toBe("button"); // foco y Enter/Espacio nativos
      expect(b.props["aria-haspopup"]).toBe("dialog");
      expect(String(b.props["aria-label"])).toContain("Abrir pendientes");
      expect(String(b.props.className)).toContain("state-strip__item--action");
      b.props.onClick?.();
    }
    expect(picked).toEqual(["EEFF", "1001", "1005", "1006"]);
  });

  it("el nombre accesible resume destino, estado y cantidades", () => {
    expect(cardLabel("1001", "block", { block: 2, pending: 1, review: 0 })).toBe("Formato 1001: Bloquea (2 bloquean, 1 por confirmar, 0 por revisar). Abrir pendientes");
    expect(cardLabel("1005", "na", { block: 0, pending: 0, review: 0 })).toBe("Formato 1005: No aplica. Abrir pendientes");
  });

  it("sin onSelect (Generador) las tarjetas siguen siendo informativas", () => {
    const tree = StatusStrip({ counts: m.counts, status: m.status });
    expect(find(tree, (e) => e.type === "button")).toHaveLength(0);
  });
});

describe("retorno al panel conservando contexto", () => {
  it("el panel se oculta mientras se edita y reaparece con el mismo destino", () => {
    expect(panelVisible({ panelDest: "1001", editing: false })).toBe(true);
    expect(panelVisible({ panelDest: "1001", editing: true })).toBe(false);
    expect(panelVisible({ panelDest: "1001", editing: false })).toBe(true);
    expect(panelVisible({ panelDest: null, editing: false })).toBe(false);
  });

  it("la ruta de regreso desde otro módulo conserva destino, empresa, año, posición y grupos, y se consume una vez", () => {
    setPendingReturn({ dest: "1005", buyerNit: NIT, year: 2025, companyName: "MONO SAS", scroll: 340, expanded: ["block|vat-year-unknown"], openCompanyNit: NIT, companyTab: "fiscal" });
    expect(getPendingReturn()?.openCompanyNit).toBe(NIT);
    const back = takePendingReturn();
    expect(back).toMatchObject({ dest: "1005", buyerNit: NIT, year: 2025, scroll: 340, expanded: ["block|vat-year-unknown"] });
    expect(getPendingReturn()).toBeNull();
    expect(takePendingReturn()).toBeNull();
  });
});
