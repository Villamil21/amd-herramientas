import { describe, expect, it } from "vitest";
import type { PurchaseDocument, PurchaseLine, PurchasesState, YearConcept } from "../../../../types/purchases";
import { buildPucIndex } from "../../puc-codes/services/pucCatalog";
import { buildPurchasesModel, type PurchasesInput } from "./model";

const NIT = "901817531";
const COMPANY = { id: 1, nit: NIT, razonSocial: "MONO SAS" } as never;

const line = (index: number, baseCents: number, vatCents: number, description = `Producto ${index}`): PurchaseLine => ({ index, page: 1, code: `P${index}`, description, unit: "UN", baseCents, vatCents });

function doc(id: number, over: Partial<PurchaseDocument> & { lines?: PurchaseLine[]; vat?: number; title?: string } = {}): PurchaseDocument {
  const lines = over.lines ?? [line(0, 100_000_00, 19_000_00)];
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
      issuer: { nit: "900111222", name: "PROVEEDOR SAS", personType: "PJ", fiscalCodes: ["O-13"] },
      buyerNit: NIT,
      buyerName: "MONO SAS",
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
    titleTypes: [
      { titleKey: "factura electronica de venta", kind: "purchase" } as never,
      { titleKey: "nota credito electronica", kind: "return" } as never,
    ],
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

const classify = (docId: number, idx = 0) => ({ documentId: docId, lineIndex: idx, pucCode: "510506", concept1001: "5001", retention: [], ruleId: null, scope: "invoice", confirmedAt: "" }) as never;

describe("buildPurchasesModel", () => {
  it("una línea sin confirmar queda pendiente para EEFF y 1001 y no entra a EEFF", () => {
    const m = buildPurchasesModel(input([doc(1)]));
    expect(m.counts.EEFF.pending).toBe(1);
    expect(m.counts["1001"].pending).toBe(1);
    expect(m.eeff.movements).toHaveLength(0);
    expect(m.eeff.pendingDocs).toBe(1);
  });

  it("una línea confirmada con PUC de gasto envía la base a EEFF (IVA descontable no se suma)", () => {
    const m = buildPurchasesModel(input([doc(1)], {}, { lineClasses: [classify(1)] }));
    expect(m.eeff.movements).toHaveLength(1);
    expect(m.eeff.movements[0].amountCents).toBe(100_000_00);
    expect(m.eeff.movements[0].pucCode).toBe("510506");
  });

  it("si la empresa no era responsable de IVA, el IVA es mayor valor del costo y 1005 no tiene datos", () => {
    const m = buildPurchasesModel(input([doc(1)], { companyVat: [{ effectiveDate: "2025-01-01", responsible: false } as never] }, { lineClasses: [classify(1)] }));
    expect(m.eeff.movements[0].amountCents).toBe(119_000_00);
    expect(m.proposals["1005"]).toHaveLength(0);
    expect(m.notApplicable["1005"]).toBeTruthy();
    expect(m.status["1005"]).toBe("na");
    expect(m.status["1006"]).toBe("na");
  });

  it("sin responsabilidad de IVA, el IVA suma al costo en EEFF y se reporta como IVA no deducible en 1001", () => {
    const m = buildPurchasesModel(input([doc(1)], { companyVat: [{ effectiveDate: "2025-01-01", responsible: false } as never] }, { lineClasses: [classify(1)] }));
    expect(m.eeff.movements[0].amountCents).toBe(119_000_00);
    const r = m.proposals["1001"][0].data;
    expect([r.deductible, r.ivaDeductible, r.ivaNonDeductible]).toEqual([100_000, 0, 19_000]);
  });

  it("una devolución resta y su IVA va a 1006, no a 1005", () => {
    const docs = [doc(1), doc(2, { title: "nota credito electronica", lines: [line(0, 20_000_00, 3_800_00)] })];
    const m = buildPurchasesModel(input(docs, {}, { lineClasses: [classify(1), classify(2)] }));
    const total = m.eeff.movements.reduce((s, x) => s + x.amountCents, 0);
    expect(total).toBe(80_000_00);
    expect(m.proposals["1005"][0].data.discountable).toBe(19_000);
    expect(m.proposals["1006"][0].data.purchaseReturns).toBe(3_800);
    expect(m.proposals["1001"][0].data.deductible).toBe(80_000);
  });

  it("encabezado sin clasificar bloquea los cuatro destinos", () => {
    const m = buildPurchasesModel(input([doc(1, { titleKey: "documento raro" })], {}, { lineClasses: [classify(1)] }));
    for (const d of ["EEFF", "1001", "1005", "1006"] as const) expect(m.counts[d].block).toBeGreaterThan(0);
  });

  it("falta de perfil IVA bloquea solo EEFF, 1001 y el destino del IVA; no bloquea 1006", () => {
    const m = buildPurchasesModel(input([doc(1)], { companyVat: [] }, { lineClasses: [classify(1)] }));
    expect(m.counts["1005"].block).toBeGreaterThan(0);
    expect(m.counts["1006"].block).toBe(1); // alerta anual del perfil
  });

  it("nombre del adquiriente distinto bloquea hasta confirmarlo", () => {
    const d = doc(1, { buyerName: "OTRA EMPRESA SAS" });
    const blocked = buildPurchasesModel(input([d], {}, { lineClasses: [classify(1)] }));
    expect(blocked.alerts.some((a) => a.code === "name-mismatch")).toBe(true);
    const ok = buildPurchasesModel(input([d], {}, { lineClasses: [classify(1)], flags: [{ documentId: 1, kind: "name_confirm", value: "1", decidedAt: "" }] }));
    expect(ok.alerts.some((a) => a.code === "name-mismatch")).toBe(false);
  });

  it("la duplicada es evidencia y no suma", () => {
    const m = buildPurchasesModel(input([doc(1), doc(2, { status: "evidence", duplicateOf: 1 })], {}, { lineClasses: [classify(1)] }));
    expect(m.totals.documents).toBe(1);
    expect(m.eeff.movements).toHaveLength(1);
    expect(m.alerts.some((a) => a.code === "duplicate-evidence")).toBe(true);
  });

  it("concilia 1005 − 1006 = IVA deducible 1001 cuando todo está confirmado", () => {
    const docs = [doc(1), doc(2, { title: "nota credito electronica", lines: [line(0, 20_000_00, 3_800_00)] })];
    const m = buildPurchasesModel(input(docs, {}, { lineClasses: [classify(1), classify(2)] }));
    expect(m.reconciliation.differenceCents).toBe(0);
    expect(m.reconciliation.netVatCents).toBe(15_200_00);
  });

  it("la cobertura mensual cuenta compras y devoluciones por mes", () => {
    const m = buildPurchasesModel(input([doc(1), doc(2, { issueDate: "2025-05-02", year: 2025 })]));
    expect(m.coverage.find((c) => c.month === 3)?.purchases).toBe(1);
    expect(m.coverage.find((c) => c.month === 5)?.purchases).toBe(1);
  });

  it("un PUC de pasivo no sirve para una compra", () => {
    const idx = buildPucIndex([{ code: "220505", concept: "Proveedores" }] as never);
    const m = buildPurchasesModel(input([doc(1)], { pucIndex: idx }, { lineClasses: [{ ...(classify(1) as object), pucCode: "220505" } as never] }));
    expect(m.alerts.some((a) => a.code === "puc-invalid")).toBe(true);
    expect(m.eeff.movements).toHaveLength(0);
  });

  describe("vigencia de la Tabla de retenciones", () => {
    const rate = { id: 1, retentionType: "services", name: "Servicios", baseUvtCenti: 0, rateBp: 400, sortOrder: 1, createdAt: "", updatedAt: "" } as never;
    const uvts = [{ year: 2025, valuePesos: 49_799 } as never];
    const withRetention = (id: number) => ({ ...(classify(id) as object), retention: [{ rateId: 1 }] }) as never;
    const docs = [doc(1), doc(2, { issueDate: "2025-07-01" })];
    const run = (versions: object[]) =>
      buildPurchasesModel(input(docs, { rates: [rate], uvts, rateVersions: versions as never }, { lineClasses: [withRetention(1), withRetention(2)] }));
    const assumed = (m: ReturnType<typeof run>, id: number) => m.docs.find((d) => d.doc.id === id)!.retention.assumedCents;

    it("sin vigencias usa la tarifa base", () => {
      const m = run([]);
      expect(assumed(m, 1)).toBe(4_000_00);
      expect(assumed(m, 2)).toBe(4_000_00);
    });

    it("una vigencia posterior solo rige desde su fecha: la factura anterior no se recalcula", () => {
      const m = run([{ rateId: 1, effectiveFrom: "2025-06-01", baseUvtCenti: 0, rateBp: 1100, note: "", createdAt: "" }]);
      expect(assumed(m, 1)).toBe(4_000_00); // 2025-03-10 → regla base
      expect(assumed(m, 2)).toBe(11_000_00); // 2025-07-01 → vigencia nueva
    });

    it("la cuantía mínima también es la vigente en la fecha de cada factura", () => {
      // Desde junio la base mínima sube a 10 UVT (≈ $497.990): la compra de $100.000 queda por debajo y no retiene.
      const m = run([{ rateId: 1, effectiveFrom: "2025-06-01", baseUvtCenti: 1000, rateBp: 400, note: "", createdAt: "" }]);
      expect(assumed(m, 1)).toBe(4_000_00);
      expect(assumed(m, 2)).toBe(0);
    });

    it("con varias vigencias toma la más reciente que no supera la fecha de la factura", () => {
      const m = run([
        { rateId: 1, effectiveFrom: "2025-02-01", baseUvtCenti: 0, rateBp: 200, note: "", createdAt: "" },
        { rateId: 1, effectiveFrom: "2025-06-01", baseUvtCenti: 0, rateBp: 1100, note: "", createdAt: "" },
        { rateId: 1, effectiveFrom: "2026-01-01", baseUvtCenti: 0, rateBp: 700, note: "", createdAt: "" },
      ]);
      expect(assumed(m, 1)).toBe(2_000_00);
      expect(assumed(m, 2)).toBe(11_000_00);
    });
  });

  describe("alias persistentes", () => {
    it("un alias de tipo de comprobante hace que el encabezado se entienda como devolución", () => {
      const d = doc(1, { titleKey: "nc electronica" });
      const sin = buildPurchasesModel(input([d]));
      expect(sin.alerts.some((a) => a.code === "title-unknown")).toBe(true);
      const con = buildPurchasesModel(input([d], { aliases: [{ kind: "title_type", aliasKey: "nc electronica", parent: "", alias: "NC Electrónica", target: "nota credito electronica", updatedAt: "" }] }));
      expect(con.alerts.some((a) => a.code === "title-unknown")).toBe(false);
      expect(con.docs[0].kind).toBe("return");
    });
  });

  describe("tipo de documento del proveedor por alias en 1001, 1005 y 1006", () => {
    const catalogs = {
      documentTypes: [{ code: "13", description: "Cédula de ciudadanía", isActive: true }, { code: "31", description: "NIT", isActive: true }],
      countries: [{ code: "169", name: "Colombia", isActive: true }],
      departments: [{ code: "76", name: "Valle del Cauca", isActive: true }],
      municipalities: [{ code: "001", deptCode: "76", name: "Cali", isActive: true }],
    } as never;
    const supplier = { id: 9, nit: "900111222", businessName: "PERSONA NATURAL", vatType: null, personType: "PN", firstSurname: "PEREZ", secondSurname: "", firstName: "ANA", otherNames: "", address: "Calle 1", countryCode: "169", deptCode: "76", muniCode: "001", createdAt: "", updatedAt: "" } as never;
    const naturalDoc = (id: number, over: object = {}) => {
      const d = doc(id, over);
      d.data.issuer = { ...d.data.issuer, personType: "PN", docTypeText: "C.C." };
      return d;
    };
    const run = (aliases: object[]) =>
      buildPurchasesModel(input([naturalDoc(1), naturalDoc(2, { title: "nota credito electronica", lines: [line(0, 20_000_00, 3_800_00)] })], { suppliers: [supplier], catalogs, aliases: aliases as never }, { lineClasses: [classify(1), classify(2)] }));

    it("sin alias la denominación «C.C.» no se reconoce: el tercero queda incompleto y avisa qué agregar", () => {
      const m = run([]);
      expect(m.suppliers[0].third.fields.docTypeCode).toBe("");
      expect(m.suppliers[0].third.unknownDocType).toBe("C.C.");
      expect(m.proposals["1001"]).toHaveLength(0);
      expect(m.alerts.find((a) => a.code === "third-incomplete")?.why).toContain("Alias");
    });

    it("con el alias CC → 13 el mismo código llega a los registros de 1001, 1005 y 1006", () => {
      const m = run([{ kind: "document_type", aliasKey: "CC", parent: "", alias: "CC", target: "13", updatedAt: "" }]);
      expect(m.suppliers[0].third.fields.docTypeCode).toBe("13");
      for (const f of ["1001", "1005", "1006"] as const) {
        expect(m.proposals[f], f).toHaveLength(1);
        expect(m.proposals[f][0].data.docTypeCode, f).toBe("13");
      }
    });

    describe("la ficha del proveedor no fuerza NIT", () => {
      const cat = { ...(catalogs as object), documentTypes: [{ code: "13", description: "Cédula de ciudadanía", isActive: true }, { code: "22", description: "Cédula de extranjería", isActive: true }, { code: "31", description: "NIT", isActive: true }, { code: "48", description: "Permiso por protección temporal", isActive: true }] } as never;
      const withType = (docTypeCode: string | null, personType: "PN" | "PJ" = "PN") => ({ ...(supplier as object), docTypeCode, personType, dv: "" }) as never;
      // La factura lo puede tratar como jurídica y con «NIT»: manda la ficha.
      const asLegalInvoice = (id: number, over: object = {}) => {
        const d = doc(id, over);
        d.data.issuer = { ...d.data.issuer, personType: "PJ", docTypeText: "NIT" };
        return d;
      };
      const go = (sup: never, make: (id: number, o?: object) => ReturnType<typeof doc>) =>
        buildPurchasesModel(input([make(1), make(2, { title: "nota credito electronica", lines: [line(0, 20_000_00, 3_800_00)] })], { suppliers: [sup], catalogs: cat, aliases: [] }, { lineClasses: [classify(1), classify(2)] }));

      it.each(["13", "22", "48"])("persona natural con tipo %s se conserva en 1001, 1005 y 1006 (no se convierte a NIT)", (code) => {
        for (const make of [naturalDoc, asLegalInvoice]) {
          const m = go(withType(code), make);
          expect(m.suppliers[0].third.fields.docTypeCode).toBe(code);
          expect(m.suppliers[0].third.fields.dv).toBe("");
          for (const f of ["1001", "1005", "1006"] as const) {
            expect(m.proposals[f], f).toHaveLength(1);
            expect(m.proposals[f][0].data.docTypeCode, f).toBe(code);
            expect(m.proposals[f][0].data.docTypeCode, f).not.toBe("31");
            expect(m.proposals[f][0].data.dv, f).toBe("");
          }
        }
      });

      it("ficha de persona natural sin tipo y factura que dice jurídica: no se inventa NIT, queda pendiente", () => {
        const m = go(withType(null), (id, o) => { const d = asLegalInvoice(id, o); d.data.issuer = { ...d.data.issuer, docTypeText: undefined }; return d; });
        expect(m.suppliers[0].third.fields.docTypeCode).toBe("");
        expect(m.proposals["1001"]).toHaveLength(0);
      });

      it("persona jurídica sigue siendo NIT con su DV", () => {
        const m = go(withType(null, "PJ"), asLegalInvoice);
        expect(m.suppliers[0].third.fields.docTypeCode).toBe("31");
        expect(m.suppliers[0].third.fields.dv).not.toBe("");
      });
    });
  });
});
