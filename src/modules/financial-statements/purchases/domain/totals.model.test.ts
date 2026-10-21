import { describe, expect, it } from "vitest";
import type { LineOverride, PurchaseDocument, PurchaseLine, PurchasesState, TotalDecision, YearConcept } from "../../../../types/purchases";
import { buildPucIndex } from "../../puc-codes/services/pucCatalog";
import { buildPurchasesModel, type PurchasesInput } from "./model";

const NIT = "901817531";
const line = (index: number, baseCents: number, vatCents: number, description = `Producto ${index}`): PurchaseLine => ({ index, page: 1, code: `P${index}`, description, unit: "UN", baseCents, vatCents });

function doc(id: number, lines: PurchaseLine[], gross?: number | null, titleKey = "factura electronica de venta"): PurchaseDocument {
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
    titleKey,
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
      issuer: { nit: "900111222", name: "PROVEEDOR SAS", personType: "PJ", fiscalCodes: ["O-13"] },
      buyerNit: NIT,
      buyerName: "MONO SAS",
      lines,
      // El Subtotal es antes del descuento: NUNCA debe usarse para validar.
      subtotalCents: base + 14_172_433,
      grossTotalCents: gross === null ? undefined : (gross ?? base),
      vatCents: vat,
      totalCents: base + vat,
    },
  } as PurchaseDocument;
}

const concept: YearConcept = { year: 2025, code: "5001", description: "Salarios", isActive: true, validFrom: "2025-01-01", validTo: null } as never;
const RATE = { id: 1, retentionType: "services", name: "Servicios", baseUvtCenti: 0, rateBp: 400, sortOrder: 1, createdAt: "", updatedAt: "" } as never;

function input(docs: PurchaseDocument[], state: Partial<PurchasesState> = {}, over: Partial<PurchasesInput> = {}): PurchasesInput {
  return {
    buyerNit: NIT,
    year: 2025,
    state: { uploads: [], documents: docs, lineClasses: [], flags: [], audit: [], ...state },
    company: { id: 1, nit: NIT, razonSocial: "MONO SAS" } as never,
    companyVat: [{ effectiveDate: "2025-01-01", responsible: true } as never],
    titleTypes: [{ titleKey: "factura electronica de venta", kind: "purchase" } as never, { titleKey: "nota credito", kind: "return" } as never],
    rules: [],
    suppliers: [],
    supplierFiscal: [],
    // 7305 NO está en el catálogo a propósito: la regla no depende de que exista como cuenta.
    pucIndex: buildPucIndex([{ code: "510506", concept: "Sueldos" }, { code: "1", concept: "Activo" }, { code: "5", concept: "Gastos" }] as never),
    pucConcepts: new Map([["7305", "5001"]]),
    concepts1001: [concept],
    rates: [RATE],
    uvts: [{ year: 2025, valuePesos: 50_000, updatedAt: "" }],
    catalogs: null,
    ...over,
  };
}

const cls = (docId: number, idx: number, pucCode: string, concept1001: string, retention: { rateId: number }[] = [], scope: "rule" | "invoice" = "invoice") =>
  ({ documentId: docId, lineIndex: idx, pucCode, concept1001, retention, ruleId: null, scope, confirmedAt: "" }) as never;


const decision = (documentId: number, choice: TotalDecision["choice"], linesCents: number, grossCents: number): TotalDecision => ({ documentId, choice, linesCents, grossCents, reason: "prueba", decidedBy: "yo", decidedAt: "2026-10-21T10:00:00Z" });
const mismatch = (m: ReturnType<typeof buildPurchasesModel>) => m.docs[0].alerts.find((a) => a.code === "base-mismatch");
const CENT = 100; // 1 peso = 100 centavos
const BASE = 22_175_67; // 22.175,67

describe("Compras: líneas frente al Total Bruto Factura", () => {
  it("1. con descuento: Subtotal 163.900 y Total Bruto = líneas → sin alerta", () => {
    const m = buildPurchasesModel(input([doc(1, [line(0, BASE, 0)])]));
    expect(mismatch(m)).toBeUndefined();
    expect(m.docs[0].totalCheck?.status).toBe("ok");
  });

  it.each([
    [1 * CENT, "rounding"],
    [10 * CENT, "rounding"],
    [-10 * CENT, "rounding"],
    [10 * CENT + 1, "mismatch"],
    [-(10 * CENT + 1), "mismatch"],
  ])("2. diferencia %i centavos → %s", (diff, status) => {
    const m = buildPurchasesModel(input([doc(1, [line(0, BASE, 0)], BASE + diff)]));
    expect(m.docs[0].totalCheck?.status).toBe(status);
    expect(Boolean(mismatch(m))).toBe(status === "mismatch");
    if (status === "mismatch") {
      expect(mismatch(m)).toMatchObject({ severity: "block", title: expect.stringContaining("Total Bruto Factura") });
      expect(mismatch(m)?.title).not.toMatch(/subtotal/i);
      expect(mismatch(m)?.action).toBe("Resolver diferencia");
    }
  });

  it("3. dentro del margen prevalece el Total Bruto en EEFF, 1001 y los totales; no bloquea ni crea líneas", () => {
    const d = doc(1, [line(0, BASE, 0), line(1, 1_000_00, 0)], BASE + 1_000_00 + 7 * CENT);
    const m = buildPurchasesModel(input([d], { lineClasses: [cls(1, 0, "510506", "5001"), cls(1, 1, "510506", "5001")] }));
    const v = m.docs[0];
    expect(v.lines).toHaveLength(2);
    expect(v.baseCents).toBe(BASE + 1_000_00 + 7 * CENT);
    expect(v.lines.reduce((s, l) => s + l.eeffCents, 0)).toBe(d.data.grossTotalCents);
    expect(v.lines.filter((l) => l.adjustmentCents !== 0)).toHaveLength(1);
    expect(v.lines[0].adjustmentCents).toBe(7 * CENT);
    expect(v.alerts.filter((a) => a.severity === "block")).toHaveLength(0);
    expect(v.totalCheck).toMatchObject({ status: "rounding", linesCents: BASE + 1_000_00, grossCents: BASE + 1_000_00 + 7 * CENT, differenceCents: 7 * CENT, adjustmentCents: 7 * CENT });
  });

  it("el IVA leído no se modifica con el ajuste", () => {
    const d = doc(1, [line(0, 1_000_000, 190_000)], 1_000_000 + 5 * CENT);
    const v = buildPurchasesModel(input([d])).docs[0];
    expect(v.vatCents).toBe(190_000);
  });

  it("sin Total Bruto Factura legible no se valida (y nunca se usa el Subtotal)", () => {
    const m = buildPurchasesModel(input([doc(1, [line(0, BASE, 0)], null)]));
    expect(m.docs[0].totalCheck?.status).toBe("none");
    expect(mismatch(m)).toBeUndefined();
  });

  it("4. una diferencia mayor bloquea y se resuelve con Usar Total Bruto / Usar suma de líneas / Excluir", () => {
    const d = doc(1, [line(0, 1_000_000, 0)], 1_000_000 + 50_00);
    const base = buildPurchasesModel(input([d]));
    expect(mismatch(base)?.severity).toBe("block");
    expect(base.docs[0].ready.EEFF).toBe(false);

    const gross = buildPurchasesModel(input([d], { totalDecisions: [decision(1, "gross", 1_000_000, 1_005_000)] }));
    expect(mismatch(gross)).toBeUndefined();
    expect(gross.docs[0].baseCents).toBe(1_005_000);
    expect(gross.docs[0].totalCheck?.status).toBe("resolved");

    const lines = buildPurchasesModel(input([d], { totalDecisions: [decision(1, "lines", 1_000_000, 1_005_000)] }));
    expect(mismatch(lines)).toBeUndefined();
    expect(lines.docs[0].baseCents).toBe(1_000_000);

    const excl = buildPurchasesModel(input([d], { totalDecisions: [decision(1, "exclude", 1_000_000, 1_005_000)], flags: [{ documentId: 1, kind: "exclude", value: "1", decidedAt: "" }] }));
    expect(excl.docs[0].counts).toBe(false);
    expect(excl.docs[0].baseCents).toBe(0);
  });

  it("corregir una línea mal leída resuelve la diferencia sin salir de Compras", () => {
    const d = doc(1, [line(0, 900_000, 0)], 1_000_000);
    expect(mismatch(buildPurchasesModel(input([d])))).toBeDefined();
    const override: LineOverride = { documentId: 1, lineIndex: 0, baseCents: 1_000_000, originalCents: 900_000, reason: "mal leída", decidedBy: "yo", decidedAt: "" };
    const m = buildPurchasesModel(input([d], { lineOverrides: [override] }));
    expect(mismatch(m)).toBeUndefined();
    expect(m.docs[0].baseCents).toBe(1_000_000);
    expect(m.docs[0].lines[0].overridden).toBe(true);
  });

  it("si el contenido cambia después de la decisión, se alerta de nuevo (nunca se reutiliza en silencio)", () => {
    const d = doc(1, [line(0, 1_000_000, 0)], 1_000_000 + 50_00);
    const m = buildPurchasesModel(input([d], { totalDecisions: [decision(1, "gross", 1_000_000, 1_999_000)] }));
    expect(m.docs[0].totalCheck?.status).toBe("stale");
    expect(mismatch(m)?.severity).toBe("block");
    expect(mismatch(m)?.why).toContain("cambió");
  });

  it("5. nota crédito: se valida con valores absolutos y se conserva el signo", () => {
    const ok = buildPurchasesModel(input([doc(1, [line(0, BASE, 0)], BASE + 3 * CENT, "nota credito")]));
    expect(ok.docs[0].sign).toBe(-1);
    expect(ok.docs[0].totalCheck?.status).toBe("rounding");
    expect(ok.docs[0].baseCents).toBe(-(BASE + 3 * CENT));
    const bad = buildPurchasesModel(input([doc(1, [line(0, BASE, 0)], BASE + 50 * CENT, "nota credito")]));
    expect(mismatch(bad)?.severity).toBe("block");
  });

  it("6. factura ya confirmada antes de la regla: no se bloquea ni se ajusta sola", () => {
    const classes = [{ ...(cls(1, 0, "510506", "5001") as object), confirmedAt: "2026-01-01T00:00:00Z" } as never];
    const legacy = { lineClasses: classes, totalsRuleSince: "2026-10-21T00:00:00Z" };
    const rounding = buildPurchasesModel(input([doc(1, [line(0, BASE, 0)], BASE + 5 * CENT)], legacy));
    expect(rounding.docs[0].totalCheck?.status).toBe("rounding-legacy");
    expect(rounding.docs[0].baseCents).toBe(BASE);
    expect(rounding.docs[0].alerts.filter((a) => a.severity !== "info")).toHaveLength(0);
    const big = buildPurchasesModel(input([doc(1, [line(0, BASE, 0)], BASE + 500 * CENT)], legacy));
    expect(mismatch(big)?.severity).toBe("review");
    expect(big.docs[0].baseCents).toBe(BASE);
    // Con acción explícita (decisión del usuario) sí se aplica.
    const explicit = buildPurchasesModel(input([doc(1, [line(0, BASE, 0)], BASE + 5 * CENT)], { ...legacy, totalDecisions: [decision(1, "gross", BASE, BASE + 5 * CENT)] }));
    expect(explicit.docs[0].baseCents).toBe(BASE + 5 * CENT);
  });
});
