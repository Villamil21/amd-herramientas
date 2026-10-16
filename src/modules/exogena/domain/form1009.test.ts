import { describe, expect, it } from "vitest";
import { TAX_PUC, type TaxReturn } from "../../financial-statements/tax-obligations/types";
import type { BatchSummary, FsCatalog, FsLine, FsPucMapping, Movement } from "../../../types/fs";
import type { Supplier } from "../../../types/models";
import { FORMAT_1009_COLUMNS } from "./formats";
import { build1009, check1009, checkRecord1009, conceptForPuc, DIAN_NIT, openLiabilityMovements, reconcile, type Sources1009 } from "./form1009";
import { CATALOG_INDEX, company, shareholder, stored } from "./fixtures";
import { isPayableAtCut, periodEnd, readPlanillaEntities } from "./planillaEntities";

const line = (id: number, section: FsLine["section"], name: string): FsLine => ({ id, section, name, sortOrder: id, role: null, isActive: true, hasHistory: false });
const CATALOG: FsCatalog = {
  lines: [line(1, "asset_current", "Disponible"), line(4, "liability_current", "Obligaciones financieras"), line(5, "liability_current", "Proveedores"), line(6, "liability_current", "Cuentas por pagar"), line(7, "liability_current", "Impuestos"), line(13, "liability_noncurrent", "Otros pasivos"), line(18, "income", "Ventas")],
  sections: [],
};
const mapping = (pucCode: string, lineId: number | null, excluded = false): FsPucMapping => ({ pucCode, lineId, excluded, updatedAt: "x" });
const MAPPINGS = [mapping("220505", 5), mapping("233525", 6), mapping("210505", 4), mapping("236505", 7), mapping("237005", 6), mapping("410505", 18), mapping("111005", 1), mapping("2701", null, true)];

let seq = 0;
function movement(over: Partial<Movement>): Movement {
  return {
    id: ++seq,
    companyId: 1,
    batchId: 1,
    accountingDate: "2025-11-15",
    source: "purchases",
    conceptKey: "purchase",
    documentId: "FE-1",
    documentNumber: "FE-1",
    documentType: "",
    supplierId: null,
    supplierNit: "",
    supplierName: "",
    employeeId: null,
    employmentId: null,
    bank: "",
    accountNumber: "",
    pucCode: "220505",
    description: "",
    amountCents: 100_000_00,
    dc: null,
    settlesOn: null,
    pucConcept: "",
    status: "active",
    detail: null,
    createdAt: "x",
    ...over,
  } as Movement;
}

function supplier(over: Partial<Supplier>): Supplier {
  return {
    id: 1,
    nit: "900319753",
    businessName: "PRICESMART COLOMBIA S.A.S.",
    vatType: "purchase",
    createdAt: "x",
    updatedAt: "x",
    personType: "PJ",
    docTypeCode: "31",
    dv: "3",
    address: "CL 1",
    countryCode: "169",
    deptCode: "11",
    muniCode: "001",
    dataStatus: "completo",
    ...over,
  };
}

function taxReturn(over: Partial<TaxReturn>): TaxReturn {
  return {
    id: 1,
    companyId: 1,
    taxType: "withholding",
    year: 2025,
    period: 12,
    periodicity: "monthly",
    periodStart: "2025-12-01",
    periodEnd: "2025-12-31",
    formNumber: "350",
    previousFormNumber: "",
    isCorrection: false,
    supersededBy: null,
    payableCents: 500_000_00,
    favorCents: 0,
    resolution: null,
    nit: "901741186",
    companyName: "E",
    fileName: "",
    incomeOrdinaryCents: null,
    incomeLossCents: null,
    advanceNextCents: null,
    advanceTargetYear: null,
    detail: {},
    createdAt: "x",
    updatedAt: "x",
    events: [],
    payments: [],
    ...over,
  } as TaxReturn;
}

function payrollBatch(id: number, period: string, paymentDate: string | null, entities: unknown[]): BatchSummary {
  return { id, companyId: 1, source: "payroll", fileName: "", periodLabel: `Nómina ${period}`, periodStart: `${period}-01`, periodEnd: `${period}-28`, dedupeKey: `payroll:${period}`, recordCount: 1, totalCents: 0, status: "active", replacedBy: null, metadata: { period, paymentDate, entities }, createdAt: "x" };
}

const AFP = { type: "AFP", name: "COLFONDOS", code: "231001", nit: "800227940", dv: "6", liquidated: 280_200 };

function sources(over: Partial<Sources1009> = {}): Sources1009 {
  return {
    year: 2025,
    company: company([shareholder()]),
    suppliers: [supplier({})],
    movements: [],
    catalog: CATALOG,
    mappings: MAPPINGS,
    batches: [],
    tax: { returns: [], puc: new Map([[TAX_PUC.withholdingPayable, "236505"], [TAX_PUC.vatPayable, "240801"], [TAX_PUC.incomePayable, "240405"]]), vatPeriodicity: null },
    statements: { esf: { liabilities: 0 } as never },
    ...over,
  };
}

describe("1009 — encabezados y conceptos", () => {
  it("las 14 columnas, en el orden pactado", () => {
    expect(FORMAT_1009_COLUMNS.map((c) => c.header)).toEqual([
      "Concepto", "Tipo de documento", "Número identificación", "DV", "Primer apellido", "Segundo apellido", "Primer nombre", "Otros nombres", "Razón social", "Dirección", "Código dpto.", "Código mcp", "País de residencia o domicilio", "Saldo cuentas por pagar al 31-12",
    ]);
  });

  it("el concepto sale del PUC de la obligación", () => {
    expect(conceptForPuc("220505")).toBe("2201");
    expect(conceptForPuc("233525")).toBe("2201");
    expect(conceptForPuc("210505")).toBe("2203");
    expect(conceptForPuc("236505")).toBe("2204");
    expect(conceptForPuc("237005")).toBe("2214");
    expect(conceptForPuc("235505")).toBe("2202");
    expect(conceptForPuc("250505")).toBe("2215");
    expect(conceptForPuc("270505")).toBe("2206");
  });
});

describe("1009 — compras y corte anual", () => {
  it("agrupa por tercero y concepto y suma solo lo pendiente al 31/12 del año", () => {
    const movements = [
      movement({ supplierNit: "900319753", amountCents: 100_000_00 }),
      movement({ supplierNit: "900319753", amountCents: 50_000_00, accountingDate: "2025-12-20" }),
      movement({ supplierNit: "900319753", amountCents: 70_000_00, settlesOn: "2025-12-31" }), // pagada el mismo día: sin deuda
      movement({ supplierNit: "900319753", amountCents: 30_000_00, settlesOn: "2026-01-10" }), // pagada después: sigue siendo deuda al corte
      movement({ supplierNit: "900319753", amountCents: 999_00, accountingDate: "2026-01-02" }), // del año siguiente: no entra
      movement({ supplierNit: "900319753", amountCents: 999_00, status: "voided" }),
    ];
    const built = build1009(sources({ movements }));
    expect(built.proposals).toHaveLength(1);
    expect(built.proposals[0].sourceKey).toBe("nit:900319753|2201");
    expect(built.proposals[0].data).toMatchObject({ concept: "2201", docNumber: "900319753", balanceCents: 180_000_00, balance: 180_000, supplierId: 1, sources: ["compras"] });
  });

  it("un informe 2025 nunca muestra deudas de 2026 y uno 2026 sí las ve", () => {
    const movements = [movement({ supplierNit: "900319753", accountingDate: "2026-01-02", amountCents: 80_000_00 })];
    expect(build1009(sources({ year: 2025, movements })).proposals).toHaveLength(0);
    expect(build1009(sources({ year: 2026, movements })).proposals[0].data.balance).toBe(80_000);
  });

  it("las obligaciones sin tercero quedan en la lista de pendientes, agrupadas, y no se inventa un registro", () => {
    const movements = [movement({ amountCents: 40_000_00, supplierName: "" }), movement({ amountCents: 10_000_00 }), movement({ pucCode: "233525", amountCents: 5_000_00, employeeId: 4 })];
    const built = build1009(sources({ movements }));
    expect(built.proposals).toHaveLength(0);
    expect(built.unmatched.map((i) => i.cents).sort((a, b) => a - b)).toEqual([5_000_00, 50_000_00]);
    expect(built.unmatched.every((i) => i.kind === "no_third_party")).toBe(true);
  });

  it("un NIT sin ficha genera el registro con lo que trae la factura y pide crear la ficha", () => {
    const built = build1009(sources({ suppliers: [], movements: [movement({ supplierNit: "901.398.069-1", supplierName: "MONO COLOMBIA", amountCents: 20_000_00 })] }));
    const rec = built.proposals[0];
    expect(rec.data).toMatchObject({ supplierId: null, thirdName: "MONO COLOMBIA", docNumber: "901398069", docTypeCode: "" });
    const problems = checkRecord1009({ sourceKey: rec.sourceKey, data: rec.data }, CATALOG_INDEX);
    expect(problems.map((p) => p.field)).toContain("supplierId");
  });

  it("los movimientos financieros se leen con la naturaleza crédito de una deuda (entrada C aumenta, salida D reduce)", () => {
    const open = openLiabilityMovements(
      [movement({ source: "bank", pucCode: "210505", dc: "C", amountCents: 1_000_00 }), movement({ source: "bank", pucCode: "210505", dc: "D", amountCents: 300_00 }), movement({ pucCode: "410505" }), movement({ pucCode: "111005" }), movement({ pucCode: "2701" })],
      CATALOG,
      MAPPINGS,
      "2025-12-31",
    );
    expect(open.map((o) => o.cents)).toEqual([1_000_00, -300_00]);
  });

  it("un tercero que es socio de la empresa va al concepto 2202", () => {
    const built = build1009(sources({ company: company([shareholder({ identityDocument: "CC 1192816998" })]), suppliers: [supplier({ nit: "1192816998", docTypeCode: "13" })], movements: [movement({ supplierNit: "1192816998", pucCode: "233525", amountCents: 9_000_00 })] }));
    expect(built.proposals[0].data.concept).toBe("2202");
  });

  it("sincronizar dos veces produce exactamente las mismas propuestas (clave de origen idempotente)", () => {
    const movements = [movement({ supplierNit: "900319753" }), movement({ supplierNit: "800197268", pucCode: "236505", amountCents: 1_00 })];
    const a = build1009(sources({ movements, suppliers: [supplier({}), supplier({ id: 2, nit: DIAN_NIT, businessName: "DIAN" })] }));
    const b = build1009(sources({ movements, suppliers: [supplier({}), supplier({ id: 2, nit: DIAN_NIT, businessName: "DIAN" })] }));
    expect(a.proposals).toEqual(b.proposals);
    expect(new Set(a.proposals.map((p) => p.sourceKey)).size).toBe(a.proposals.length);
  });
});

describe("1009 — obligaciones tributarias y DIAN", () => {
  const dian = supplier({ id: 9, nit: DIAN_NIT, businessName: "DIRECCION DE IMPUESTOS Y ADUANAS NACIONALES", dv: "4", deptCode: "11" });

  it("la retención causada y no pagada al corte va al proveedor DIAN existente (2204)", () => {
    const built = build1009(sources({ suppliers: [dian], tax: { ...sources().tax, returns: [taxReturn({})] } }));
    expect(built.proposals).toHaveLength(1);
    expect(built.proposals[0].data).toMatchObject({ concept: "2204", supplierId: 9, docNumber: DIAN_NIT, balance: 500_000, sources: ["tributaria"] });
  });

  it("sin proveedor DIAN: se genera el registro, pero queda un pendiente enlazable a Proveedores y no se crea nada", () => {
    const built = build1009(sources({ suppliers: [], tax: { ...sources().tax, returns: [taxReturn({})] } }));
    const rec = built.proposals[0];
    expect(rec.data).toMatchObject({ supplierId: null, docNumber: DIAN_NIT, dv: "" });
    const problem = checkRecord1009({ sourceKey: rec.sourceKey, data: rec.data }, CATALOG_INDEX)[0];
    expect(problem.message).toContain("proveedor DIAN");
    expect(problem.action?.path).toBe("/proveedores/800197268");
  });

  it("una declaración pagada antes o el mismo día del corte no es deuda; pagada después, conserva su saldo; solo lo causado", () => {
    const base = sources({ suppliers: [dian] }).tax;
    const paid = (date: string, cents = 500_000_00) => taxReturn({ payments: [{ id: 1, returnId: 1, paymentDate: date, amountCents: cents, note: "", reference: "", createdAt: "x", updatedAt: "x" }] });
    expect(build1009(sources({ suppliers: [dian], tax: { ...base, returns: [paid("2025-12-31")] } })).proposals).toHaveLength(0);
    expect(build1009(sources({ suppliers: [dian], tax: { ...base, returns: [paid("2025-12-15")] } })).proposals).toHaveLength(0);
    // Pagada el 20/01/2026: al 31/12/2025 sigue siendo deuda por el valor causado (sin intereses de mora posteriores).
    const late = build1009(sources({ suppliers: [dian], tax: { ...base, returns: [paid("2026-01-20", 520_000_00)] } }));
    expect(late.proposals[0].data.balance).toBe(500_000);
    // Pago parcial antes del corte: solo queda el pendiente al corte.
    const partial = build1009(sources({ suppliers: [dian], tax: { ...base, returns: [paid("2025-12-20", 200_000_00)] } }));
    expect(partial.proposals[0].data.balance).toBe(300_000);
    // Una declaración de un periodo posterior al corte no cuenta.
    const next = build1009(sources({ suppliers: [dian], tax: { ...base, returns: [taxReturn({ year: 2026, period: 1, periodStart: "2026-01-01", periodEnd: "2026-01-31" })] } }));
    expect(next.proposals).toHaveLength(0);
  });

  it("IVA, retención y renta se suman en un solo registro DIAN", () => {
    const base = sources({ suppliers: [dian] }).tax;
    const returns = [taxReturn({ id: 1 }), taxReturn({ id: 2, taxType: "vat", period: 6, periodicity: "bimonthly", periodStart: "2025-11-01", periodEnd: "2025-12-31", payableCents: 300_000_00 })];
    const built = build1009(sources({ suppliers: [dian], tax: { ...base, returns, vatPeriodicity: "bimonthly" } }));
    expect(built.proposals).toHaveLength(1);
    expect(built.proposals[0].data.balance).toBe(800_000);
  });

  it("una cuenta PUC de impuestos sin configurar no se asigna: queda como pendiente con su valor", () => {
    const base = sources({ suppliers: [dian] }).tax;
    const built = build1009(sources({ suppliers: [dian], tax: { ...base, puc: new Map(), returns: [taxReturn({})] } }));
    expect(built.proposals).toHaveLength(0);
    expect(built.unmatched[0]).toMatchObject({ kind: "tax_unconfigured", cents: 500_000_00 });
    expect(built.issues.some((i) => i.level === "blocking")).toBe(true);
  });
});

describe("1009 — seguridad social por entidad", () => {
  it("lee las entidades del lote y descarta lo que no tiene el formato esperado", () => {
    const batch = payrollBatch(1, "2025-12", "2026-01-15", [
      { ...AFP, paymentDate: "2026-01-15", period: "2025-12" },
      { type: "ZZZ", name: "RARA", nit: "1", dv: "", liquidated: 5, period: "2025-12", paymentDate: null },
      { name: "SIN NIT", liquidated: 5, period: "2025-12" },
      "basura",
    ]);
    const entities = readPlanillaEntities(batch);
    expect(entities.map((e) => [e.type, e.nit, e.liquidated, e.paymentDate])).toEqual([["AFP", "800227940", 280200, "2026-01-15"], ["OTRO", "1", 5, null]]);
    expect(readPlanillaEntities({ metadata: null })).toEqual([]);
  });

  it("una planilla pagada después del corte o pendiente es deuda a nombre de cada entidad; pagada antes o el mismo día no", () => {
    expect(isPayableAtCut({ period: "2025-12", paymentDate: "2026-01-15" }, "2025-12-31")).toBe(true);
    expect(isPayableAtCut({ period: "2025-12", paymentDate: null }, "2025-12-31")).toBe(true);
    expect(isPayableAtCut({ period: "2025-12", paymentDate: "2025-12-31" }, "2025-12-31")).toBe(false);
    expect(isPayableAtCut({ period: "2025-11", paymentDate: "2025-12-10" }, "2025-12-31")).toBe(false);
    // El periodo de enero de 2026 todavía no existía al corte de 2025.
    expect(isPayableAtCut({ period: "2026-01", paymentDate: "2026-02-26" }, "2025-12-31")).toBe(false);
    expect(periodEnd("2024-02")).toBe("2024-02-29");
  });

  it("crea un registro por entidad (2214) con el valor liquidado, sin intereses ni fondos adicionales", () => {
    const batches = [payrollBatch(1, "2025-12", "2026-01-15", [{ ...AFP, paymentDate: "2026-01-15", period: "2025-12" }, { type: "EPS", name: "EPS SURA", code: "EPS010", nit: "800088702", dv: "2", liquidated: 140_200, paymentDate: "2026-01-15", period: "2025-12" }])];
    const built = build1009(sources({ batches }));
    expect(built.proposals.map((p) => [p.data.thirdName, p.data.concept, p.data.balance, p.data.supplierId])).toEqual([["EPS SURA", "2214", 140_200, null], ["COLFONDOS", "2214", 280_200, null]]); // orden por NIT
    // La entidad sin ficha trae lo que dice la planilla: NIT, DV y persona jurídica; faltan dirección y ubicación.
    expect(built.proposals[1].data).toMatchObject({ docTypeCode: "31", dv: "6", personType: "PJ", businessName: "COLFONDOS", address: "" });
  });

  it("una planilla de 2026 (o pagada antes del corte) no genera deuda al 31/12/2025", () => {
    const batches = [payrollBatch(1, "2026-01", "2026-02-26", [{ ...AFP, paymentDate: "2026-02-26", period: "2026-01" }]), payrollBatch(2, "2025-11", "2025-12-10", [{ ...AFP, paymentDate: "2025-12-10", period: "2025-11" }])];
    expect(build1009(sources({ batches })).proposals).toHaveLength(0);
  });

  it("los aportes por pagar del ESF que la planilla no detalla por entidad quedan como pendiente", () => {
    const ssMovement = movement({ batchId: 1, source: "payroll", conceptKey: "payroll.pension.payable", pucCode: "237005", amountCents: 280_200_00, employeeId: 1, settlesOn: "2026-01-15", accountingDate: "2025-12-31" });
    const withoutEntities = build1009(sources({ movements: [ssMovement], batches: [payrollBatch(1, "2025-12", "2026-01-15", [])] }));
    expect(withoutEntities.unmatched[0]).toMatchObject({ kind: "ss_without_entities", cents: 280_200_00 });
    const withEntities = build1009(sources({ movements: [ssMovement], batches: [payrollBatch(1, "2025-12", "2026-01-15", [{ ...AFP, paymentDate: "2026-01-15", period: "2025-12" }])] }));
    expect(withEntities.unmatched).toEqual([]);
    expect(withEntities.proposals[0].data.balance).toBe(280_200);
  });
});

describe("1009 — conciliación con el ESF", () => {
  const dian = supplier({ id: 9, nit: DIAN_NIT, businessName: "DIAN", dv: "4" });

  function scenario(liabilitiesCents: number) {
    const movements = [movement({ supplierNit: "900319753", amountCents: 100_000_00 })];
    const built = build1009(sources({ movements, suppliers: [supplier({}), dian], statements: { esf: { liabilities: liabilitiesCents } as never } }));
    const records = built.proposals.map((p, i) => stored(p, { id: i + 1, formatCode: "1009" }));
    return { built, records };
  }

  it("diferencia cero: sin pendientes de conciliación", () => {
    const { built, records } = scenario(100_000_00);
    const rec = reconcile(built, records);
    expect(rec).toMatchObject({ liabilitiesCents: 100_000_00, recordsCents: 100_000_00, differenceCents: 0, items: [] });
    expect(check1009(records, built, rec, CATALOG_INDEX, []).filter((p) => p.level === "blocking")).toEqual([]);
  });

  it("diferencia distinta de cero bloquea y muestra la diferencia como pendiente por resolver", () => {
    const { built, records } = scenario(130_000_00);
    const rec = reconcile(built, records);
    expect(rec.differenceCents).toBe(30_000_00);
    expect(rec.items).toEqual([{ kind: "residual", label: expect.stringContaining("Otras diferencias"), cents: 30_000_00 }]);
    const problems = check1009(records, built, rec, CATALOG_INDEX, []);
    expect(problems.some((p) => p.level === "blocking" && p.message.includes("no coincide"))).toBe(true);
  });

  it("una obligación sin tercero explica la diferencia y bloquea con su propio pendiente", () => {
    const movements = [movement({ supplierNit: "900319753", amountCents: 100_000_00 }), movement({ amountCents: 30_000_00, supplierName: "" })];
    const built = build1009(sources({ movements, suppliers: [supplier({})], statements: { esf: { liabilities: 130_000_00 } as never } }));
    const records = built.proposals.map((p, i) => stored(p, { id: i + 1 }));
    const rec = reconcile(built, records);
    expect(rec.differenceCents).toBe(30_000_00);
    expect(rec.items).toHaveLength(1);
    expect(rec.items[0]).toMatchObject({ kind: "no_third_party", cents: 30_000_00 });
    const problems = check1009(records, built, rec, CATALOG_INDEX, []);
    expect(problems.filter((p) => p.message.includes("sin tercero"))).toHaveLength(1);
  });

  it("los cambios pendientes de sincronizar también impiden dejar el formato listo", () => {
    const { built, records } = scenario(100_000_00);
    const rec = reconcile(built, records);
    expect(check1009(records, built, rec, CATALOG_INDEX, [{ kind: "changed" }]).some((p) => p.message.includes("sin sincronizar"))).toBe(true);
  });

  it("un saldo negativo o un registro manual con datos incompletos bloquean; el manual completo no pide ficha", () => {
    const manualOk = { sourceKey: "manual:1", origin: "manual", data: { concept: "2206", supplierId: null, thirdName: "ACREEDOR", personType: "PJ", docTypeCode: "31", docNumber: "900111222", dv: "5", firstSurname: "", secondSurname: "", firstName: "", otherNames: "", businessName: "ACREEDOR SAS", address: "CL 1", deptCode: "76", muniCode: "001", countryCode: "169", balanceCents: 5_000_00, balance: 5000 } };
    expect(checkRecord1009(manualOk, CATALOG_INDEX)).toEqual([]);
    expect(checkRecord1009({ ...manualOk, data: { ...manualOk.data, address: "" } }, CATALOG_INDEX).map((p) => p.field)).toEqual(["address"]);
    expect(checkRecord1009({ ...manualOk, data: { ...manualOk.data, balance: -5 } }, CATALOG_INDEX).map((p) => p.field)).toEqual(["balance"]);
    expect(checkRecord1009({ ...manualOk, data: { ...manualOk.data, concept: "9999" } }, CATALOG_INDEX).map((p) => p.field)).toEqual(["concept"]);
  });

  it("un registro completo con ficha sincronizada no tiene pendientes", () => {
    const built = build1009(sources({ movements: [movement({ supplierNit: "900319753" })] }));
    const p = built.proposals[0];
    expect(checkRecord1009({ sourceKey: p.sourceKey, data: p.data }, CATALOG_INDEX)).toEqual([]);
  });
});
