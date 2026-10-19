import { describe, expect, it } from "vitest";
import type { PdfDocumentText } from "../../../bank-analysis/shared/pdf/pdfTypes";
import type { Supplier } from "../../../../types/models";
import type { Company } from "../../../../types/models";
import { computeMonth } from "../calc";
import { payrollCounts, payrollStatus } from "./alerts";
import { detectOperator } from "./detect";
import { build1001Payroll, mergePayroll1001, parafiscalNitsToCreate } from "./exo1001";
import { build1011 } from "./exo1011";
import { amounts2276, build2276 } from "./exo2276";
import { ENTITIES, SMMLV, AUX, WAGES, batchOf, emptyBatch, ficha, months, person, planilla } from "./fixtures";
import { proposeNameSplit } from "./names";
import { entityHistory, proposeEntityChanges } from "./entities";
import { parseEmployeeFocus } from "./focus";
import { dedupeKeyV2, legacyDedupeKeyFor, planillaMetadata, readPlanilla, storedPlanillas } from "./store";
import { buildYearData, monthlyCoverage } from "./year";

const doc = (text: string): PdfDocumentText => ({ pageCount: 1, pages: [{ pageNumber: 1, width: 600, height: 800, items: [{ text, x: 0, y: 0, width: 10, height: 10 }] }] });

const COMPANY = { id: 1, nit: "901000001", razonSocial: "ACME", direccion: "Calle 1", countryCode: "169", deptCode: "05", muniCode: "001" } as Company;
const supplier = (nit: string, over: Partial<Supplier> = {}): Supplier => ({ id: Number(nit.slice(-3)), nit, businessName: "SURA SA", address: "Cra 1", countryCode: "169", deptCode: "05", muniCode: "001", dv: "", ...over }) as Supplier;

/** Un periodo por mes del año con la misma persona. */
const yearBatches = (make: (period: string) => ReturnType<typeof planilla>) => months(2026).map((m) => batchOf(make(m)));

describe("detección del operador", () => {
  it("MiPlanilla y Aportes en Línea se reconocen por su encabezado; lo demás (incluido SOI) no", () => {
    expect(detectOperator(doc("PLANILLA INTEGRADA DE AUTOLIQUIDACIÓN DE APORTES"))).toBe("miplanilla");
    expect(detectOperator({ pageCount: 1, pages: [{ ...doc("x").pages[0], items: [{ text: "Planilla Resumen", x: 0, y: 0, width: 1, height: 1 }, { text: "DATOS GENERALES DEL APORTANTE", x: 0, y: 5, width: 1, height: 1 }] }] })).toBe("aportes-en-linea");
    expect(detectOperator(doc("Planilla SOI"))).toBeUndefined();
  });
});

describe("identidad de la planilla y duplicados", () => {
  it("la llave v2 incluye aportante, periodo, operador y número: otra planilla del mes convive", () => {
    const a = planilla("2026-01");
    expect(dedupeKeyV2(a)).toBe("payroll:v2:901000001:2026-01:miplanilla:P2026-01");
    expect(dedupeKeyV2({ ...a, planillaNumber: "OTRA" })).not.toBe(dedupeKeyV2(a));
  });

  it("un lote legado de la misma planilla (operador, periodo y empleado) conserva su llave para el flujo de reemplazo", () => {
    const p = planilla("2026-01", { operator: "aportes-en-linea", operatorLabel: "Aportes en Línea" });
    const legacy = { ...batchOf(p), dedupeKey: "payroll:2026-01", metadata: { provider: "Aportes en Línea", period: "2026-01" } };
    const rows = [{ batchId: legacy.id, employeeId: 7 }] as never[];
    const ids = new Map([["CC 111", 7]]);
    expect(legacyDedupeKeyFor(p, [legacy], rows, ids)).toBe("payroll:2026-01");
    // Otro operador u otro empleado: no es la misma planilla.
    expect(legacyDedupeKeyFor({ ...p, operatorLabel: "MiPlanilla" }, [legacy], rows, ids)).toBeUndefined();
    expect(legacyDedupeKeyFor(p, [legacy], rows, new Map([["CC 111", 8]]))).toBeUndefined();
  });

  it("los metadatos v2 se leen de vuelta y un lote legado no se interpreta", () => {
    const p = planilla("2026-01");
    expect(readPlanilla({ metadata: planillaMetadata(p, {}) })?.employees).toHaveLength(1);
    expect(readPlanilla({ metadata: { provider: "MiPlanilla" } })).toBeUndefined();
  });
});

describe("cobertura mensual por periodo de pensión", () => {
  it("planilla, «sin nómina», lote legado sin detalle y mes faltante", () => {
    const legacy = { ...batchOf(planilla("2026-03")), metadata: { provider: "Aportes en Línea", period: "2026-03" } };
    const cov = monthlyCoverage(2026, [batchOf(planilla("2026-01")), emptyBatch("2026-02"), legacy]);
    expect(cov.slice(0, 4).map((c) => c.state)).toEqual(["planilla", "empty", "legacy", "missing"]);
  });

  it("el mes lo da el periodo de pensión aunque el pago caiga en otro mes", () => {
    const p = planilla("2026-01", { paymentDate: "2026-03-05", healthPeriod: "2026-02" });
    expect(monthlyCoverage(2026, [batchOf(p)])[0].state).toBe("planilla");
    expect(monthlyCoverage(2026, [batchOf(p)])[2].state).toBe("missing");
  });

  it("un lote anulado no cubre", () => {
    expect(monthlyCoverage(2026, [{ ...batchOf(planilla("2026-01")), status: "voided" }])[0].state).toBe("missing");
  });
});

describe("Formato 1011", () => {
  const data = buildYearData(2026, yearBatches((m) => planilla(m, { employees: [person("111", { contributions: { pension: 280_145, health: 148_827, arl: 9_139, ccf: 70_036, sena: 1_000, icbf: 2_000 } })] })), WAGES);
  const f = build1011(data);
  const c = computeMonth(SMMLV, 30, SMMLV, AUX);
  const line = (code: string) => f.lines.find((l) => l.code === code)!;

  it("8207 suma salario + vacaciones + prima + intereses + auxilio, sin cesantías", () => {
    const month = c.salaryCents + c.vacacionesCents + c.primaCents + c.interesesCents + c.transportCents;
    expect(line("8207").cents).toBe(month * 12);
    expect(line("8207").terms).toHaveLength(12);
  });
  it("8245 son solo las cesantías (sin intereses)", () => expect(line("8245").cents).toBe(c.cesantiasCents * 12));
  it("los aportes salen de la planilla: CCF, pensión, SENA, ICBF y EPS + ARL", () => {
    expect(line("8242").cents).toBe(70_036 * 100 * 12);
    expect(line("8244").cents).toBe(280_145 * 100 * 12);
    expect(line("8243").cents).toBe(1_000 * 100 * 12);
    expect(line("8241").cents).toBe(2_000 * 100 * 12);
    expect(line("8295").cents).toBe((148_827 + 9_139) * 100 * 12);
  });
  it("no hay doble conteo si la misma persona viene en dos planillas del mismo periodo", () => {
    const dup = buildYearData(2026, [...yearBatches((m) => planilla(m)), batchOf(planilla("2026-01", { planillaNumber: "OTRA" }))], WAGES);
    expect(dup.lines.filter((l) => l.period === "2026-01")).toHaveLength(1);
    expect(dup.duplicates).toHaveLength(1);
    expect(build1011(dup).alerts.find((a) => a.code === "employee-overlap")?.severity).toBe("block");
  });
  it("con todo el año cubierto y datos completos no hay pendientes y propone un registro por concepto con valor", () => {
    expect(f.alerts).toEqual([]);
    expect(f.proposals.map((p) => p.data.concept)).toEqual(["8207", "8241", "8242", "8243", "8244", "8245", "8295"]);
    expect(f.proposals[0].data.balance).toBe(Math.round((c.salaryCents + c.vacacionesCents + c.primaCents + c.interesesCents + c.transportCents) * 12 / 100));
  });
  it("SENA e ICBF en cero real no generan registro; sin valor identificable se explica", () => {
    const zero = build1011(buildYearData(2026, yearBatches((m) => planilla(m)), WAGES));
    expect(zero.lines.find((l) => l.code === "8243")).toMatchObject({ state: "zero", cents: 0 });
    expect(zero.proposals.map((p) => p.data.concept)).not.toContain("8243");
    const combined = buildYearData(2026, yearBatches((m) => planilla(m, { employees: [person("111", { unrecognized: { "SENA e ICBF (sin separar)": 3_000 } })] })), WAGES);
    expect(build1011(combined).lines.find((l) => l.code === "8241")?.state).toBe("unidentified");
  });
  it("sin cobertura de todos los meses se detiene: avance parcial pero con meses por cubrir", () => {
    const partial = build1011(buildYearData(2026, [batchOf(planilla("2026-01")), emptyBatch("2026-02")], WAGES));
    expect(partial.uncovered).toHaveLength(10);
    expect(partial.alerts.find((a) => a.code === "coverage")?.severity).toBe("block");
    expect(partial.proposals.length).toBeGreaterThan(0);
  });
  it("sin SMMLV bloquea 1011 y 2276", () => {
    const a = build1011(buildYearData(2026, yearBatches((m) => planilla(m)), [])).alerts.find((x) => x.code === "wages-missing");
    expect(a?.dests).toEqual(["1011", "2276"]);
  });
});

describe("Formato 2276", () => {
  const data = buildYearData(2026, yearBatches((m) => planilla(m)), WAGES);
  const c = computeMonth(SMMLV, 30, SMMLV, AUX);

  it("acumulados anuales: salarios + vacaciones, primas, auxilio, cesantías + intereses; salud y pensión al 4 % del IBC", () => {
    const a = amounts2276(data.lines);
    expect(a.salaries).toBe((c.salaryCents + c.vacacionesCents) * 12);
    expect(a.benefits).toBe(c.primaCents * 12);
    expect(a.otherPayments).toBe(c.transportCents * 12);
    expect(a.severanceAndInterest).toBe((c.cesantiasCents + c.interesesCents) * 12);
    expect(a.grossTotal).toBe(a.salaries + a.benefits + a.otherPayments + a.severanceAndInterest);
    // 4 % de 1.750.905 = 70.036,2 por mes, no el aporte total de la planilla.
    expect(a.healthContribution).toBe(SMMLV * 4 * 12);
    expect(a.pensionContribution).toBe(SMMLV * 4 * 12);
  });

  it("el promedio de los últimos seis meses usa IBC × 30 / días (no el valor parcial causado)", () => {
    const lines = buildYearData(2026, [batchOf(planilla("2026-11", { employees: [person("111", { pension: { days: 15, ibc: 1_000_000 } })] })), batchOf(planilla("2026-12", { employees: [person("111", { pension: { days: 30, ibc: 2_000_000 } })] }))], WAGES).lines;
    // (1.000.000 × 30/15 + 2.000.000) / 2 = 2.000.000 pesos.
    expect(amounts2276(lines).avgIncome6m).toBe(2_000_000 * 100);
    // Solo cuentan los últimos seis meses trabajados.
    const eight = buildYearData(2026, months(2026).slice(0, 8).map((m, i) => batchOf(planilla(m, { employees: [person("111", { pension: { days: 30, ibc: (i + 1) * 1_000_000 } })] }))), WAGES).lines;
    expect(amounts2276(eight).avgIncome6m).toBe(((3 + 4 + 5 + 6 + 7 + 8) / 6) * 1_000_000 * 100);
  });

  it("un empleado sin separación confirmada no genera registro y queda pendiente de confirmar; el resto de columnas en 0", () => {
    const pendiente = build2276(data, [ficha(1, "111", { nameParts: { firstSurname: "", secondSurname: "", firstName: "", otherNames: "", confirmedAt: null } })], COMPANY);
    expect(pendiente.proposals).toEqual([]);
    const alert = pendiente.alerts.find((a) => a.code === "name-parts")!;
    expect(alert.severity).toBe("pending");
    expect(alert.dests).toEqual(["2276"]);
    expect(pendiente.employees[0].proposal).toMatchObject({ firstSurname: "PEREZ", secondSurname: "GOMEZ", firstName: "JUAN" });

    const listo = build2276(data, [ficha(1, "111")], COMPANY);
    expect(listo.proposals).toHaveLength(1);
    const d = listo.proposals[0].data;
    expect(d).toMatchObject({ entity: "1", docTypeCode: "13", docNumber: "111", firstSurname: "PEREZ", address: "Calle 1", deptCode: "05", muniCode: "001", countryCode: "169" });
    for (const k of ["ecclesiastical", "vouchers", "foodExcess", "fees", "services", "commissions", "perDiem", "representation", "cooperative", "educationSupport", "severanceFund", "severanceAid", "pensions", "voluntaryRais", "voluntaryFunds", "afc", "avc", "withholding", "ivaHigher", "ivaWithholding", "foodUpTo"]) expect(d[k]).toBe(0);
    expect(listo.alerts).toEqual([]);
  });

  it("la separación no segura se deja pendiente en vez de adivinarla", () => {
    expect(proposeNameSplit("CRUZ RODRIGUEZ GABRIEL ANDRES")).toEqual({ firstSurname: "CRUZ", secondSurname: "RODRIGUEZ", firstName: "GABRIEL", otherNames: "ANDRES" });
    expect(proposeNameSplit("SAMPAYO BITAR SHADYA")).toMatchObject({ firstName: "SHADYA", otherNames: "" });
    expect(proposeNameSplit("DE LA CRUZ MARIA")).toBeNull();
    expect(proposeNameSplit("PEREZ JUAN")).toBeNull();
  });

  it("el domicilio incompleto de la empresa bloquea solo el 2276", () => {
    const f = build2276(data, [ficha(1, "111")], { ...COMPANY, deptCode: "", muniCode: "" });
    const alert = f.alerts.find((a) => a.code === "company-domicile")!;
    expect(alert.dests).toEqual(["2276"]);
    expect(alert.severity).toBe("block");
    expect(alert.action?.path).toBe("/empresas/901000001");
    // 1011 y 1001 no se enteran.
    expect(build1011(data).alerts).toEqual([]);
  });

  it("el Fondo de Solidaridad Pensional bloquea con empleado, periodo y valor (por persona o por administradora)", () => {
    const withFsp = buildYearData(2026, yearBatches((m) => planilla(m, { employees: [person("111", { pensionExtras: { solidarity: 17_000 } })] })), WAGES);
    const a = build2276(withFsp, [ficha(1, "111")], COMPANY).alerts.filter((x) => x.code === "fsp");
    expect(a).toHaveLength(12);
    expect(a[0].title).toMatch(/2026-0\d/);
    expect(a[0].title).toContain("17");
    const byEntity = buildYearData(2026, yearBatches((m) => planilla(m, { entities: ENTITIES.map((e) => (e.kind === "AFP" ? { ...e, fsp: 9_000 } : e)) })), WAGES);
    const fspAlert = build2276(byEntity, [ficha(1, "111")], COMPANY).alerts.find((x) => x.code === "fsp");
    expect(fspAlert?.severity).toBe("block");
    expect(fspAlert?.why).toContain("no puede asignarse al empleado");
    expect(fspAlert?.why).toContain("9.000");
    expect(fspAlert?.why).toContain("2026-");
  });

  it("un tipo de documento sin código DIAN o sin IBC de salud bloquea (no se asume cero)", () => {
    const d = buildYearData(2026, [batchOf(planilla("2026-01", { employees: [person("111", { docType: "XX", health: {} })] }))], WAGES);
    const codes = build2276(d, [ficha(1, "111", { docType: "XX" })], COMPANY).alerts.map((a) => a.code);
    expect(codes).toContain("doc-type");
    expect(codes).toContain("no-health-ibc");
  });

  it("PT (permiso por protección temporal) se homologa a 48", () => {
    const d = buildYearData(2026, [batchOf(planilla("2026-01", { employees: [person("1030953", { docType: "PT" })] }))], WAGES);
    expect(build2276(d, [ficha(1, "1030953", { docType: "PT" })], COMPANY).proposals[0].data.docTypeCode).toBe("48");
  });
});

describe("Formato 1001 desde Nómina", () => {
  const data = buildYearData(2026, yearBatches((m) => planilla(m)), WAGES);

  it("agrupa por entidad + concepto: SURA como EPS y como ARL son filas distintas (5011 juntas por NIT), AFP 5012 y CCF 5010", () => {
    const f = build1001Payroll(data, [], null);
    const keys = f.groups.map((g) => `${g.nit}|${g.concept}`);
    expect(keys).toEqual(["800088702|5011", "800138188|5012", "890900841|5010"]);
    // EPS + ARL de Sura: mismo NIT y mismo concepto 5011 → una sola fila con la suma.
    const sura = f.groups.find((g) => g.nit === "800088702")!;
    expect(sura.pesos).toBe((148_827 + 9_139) * 12);
    expect(sura.terms.map((t) => t.kind).sort()).toEqual([...Array(12).fill("ARL"), ...Array(12).fill("EPS")].sort());
  });

  it("solo el aporte liquidado: la mora de la planilla no entra; NIT sin DV; todo lo demás en 0", () => {
    const f = build1001Payroll(data, [supplier("800138188", { businessName: "PROTECCION SA", dv: "4" })], null);
    const prot = f.proposals.find((p) => p.data.docNumber === "800138188")!;
    expect(prot.data).toMatchObject({ concept: "5012", docTypeCode: "31", docNumber: "800138188", dv: "4", deductible: 280_145 * 12, nonDeductible: 0, ivaDeductible: 0, retPracticed: 0, retAssumed: 0, retIvaResponsible: 0, retIvaNonResident: 0 });
    expect(f.proposals.reduce((n, p) => n + (p.data.deductible as number), 0)).toBe((280_145 + 148_827 + 9_139 + 70_036) * 12);
  });

  it("la razón social nunca sale de la planilla: sin proveedor queda vacía y bloquea solo el 1001", () => {
    const f = build1001Payroll(data, [], null);
    expect(f.proposals.every((p) => p.data.businessName === "")).toBe(true);
    const a = f.alerts.filter((x) => x.code === "supplier-missing");
    expect(a).toHaveLength(3);
    expect(a.every((x) => x.dests.length === 1 && x.dests[0] === "1001" && x.severity === "block" && x.action?.path.startsWith("/proveedores/"))).toBe(true);
    const counts = payrollCounts([...a, ...build1011(data).alerts]);
    const status = payrollStatus(counts);
    expect(status["1001"]).toBe("block");
    expect(status["1011"]).toBe("ready");
    expect(status["2276"]).toBe("ready");
    expect(status.EEFF).toBe("ready");
  });

  it("un proveedor completo deja el 1001 sin pendientes; uno sin dirección lo bloquea solo a él", () => {
    const full = ["800088702", "800138188", "890900841"].map((n) => supplier(n));
    expect(build1001Payroll(data, full, null).alerts).toEqual([]);
    const incomplete = build1001Payroll(data, [...full.slice(1), supplier("800088702", { address: "" })], null);
    expect(incomplete.alerts).toHaveLength(1);
    expect(incomplete.alerts[0].code).toBe("supplier-incomplete");
  });

  it("SENA e ICBF: el NIT oficial se acumula sin proveedor y solo bloquea el 1001 hasta completar la ficha", () => {
    const d = buildYearData(2026, yearBatches((m) => planilla(m, { employees: [person("111", { contributions: { pension: 1, health: 1, arl: 1, ccf: 1, sena: 500, icbf: 800 } })], entities: ENTITIES.filter((e) => e.kind !== "CCF") })), WAGES);
    const f = build1001Payroll(d, [], null);
    expect(f.groups.find((g) => g.nit === "899999034")).toMatchObject({ concept: "5010", pesos: 500 * 12, proposedNit: true });
    expect(f.alerts.find((a) => a.id === "1001:supplier-missing:899999034")?.severity).toBe("block");
    expect(f.alerts.find((a) => a.id === "1001:supplier-missing:899999034")?.dests).toEqual(["1001"]);
    expect(f.proposals.find((p) => p.data.docNumber === "899999034")?.data).toMatchObject({ docTypeCode: "31", deductible: 500 * 12 });
  });

  it("SENA / ICBF: la ficha mínima se pide para cada NIT oficial sin proveedor y no se repite si ya existe", () => {
    const d = buildYearData(2026, yearBatches((m) => planilla(m, { employees: [person("111", { contributions: { pension: 1, health: 1, arl: 1, ccf: 1, sena: 500, icbf: 800 } })], entities: ENTITIES.filter((e) => e.kind !== "CCF") })), WAGES);
    const groups = build1001Payroll(d, [], null).groups;
    expect(parafiscalNitsToCreate(groups, []).sort()).toEqual(["899999034", "899999239"]);
    const existing = { id: 1, nit: "899999034", businessName: "", vatType: null, createdAt: "", updatedAt: "", docTypeCode: "31", dataOrigin: "planilla" } as Supplier;
    expect(parafiscalNitsToCreate(groups, [existing])).toEqual(["899999239"]);
    // Las entidades que la planilla sí identifica con NIT nunca se crean solas.
    expect(parafiscalNitsToCreate(groups, []).every((n) => ["899999034", "899999239"].includes(n))).toBe(true);
  });

  it("con la ficha mínima creada (sin razón social ni domicilio) bloquea solo el 1001 y la planilla sigue acumulando", () => {
    const d = buildYearData(2026, yearBatches((m) => planilla(m, { employees: [person("111", { contributions: { pension: 1, health: 1, arl: 1, ccf: 1, sena: 500, icbf: 800 } })], entities: ENTITIES.filter((e) => e.kind !== "CCF") })), WAGES);
    const minimal = (nit: string) => ({ id: 1, nit, businessName: "", vatType: null, createdAt: "", updatedAt: "", docTypeCode: "31", dataOrigin: "planilla" }) as Supplier;
    const f = build1001Payroll(d, [minimal("899999034"), minimal("899999239")], null);
    const incomplete = f.alerts.filter((a) => a.code === "supplier-incomplete");
    expect(incomplete).toHaveLength(2);
    expect(incomplete.every((a) => a.severity === "block" && a.dests.length === 1 && a.dests[0] === "1001")).toBe(true);
    expect(incomplete[0].why).toContain("razón social");
    expect(f.alerts.some((a) => a.code === "supplier-missing" && /89999(9034|9239)/.test(a.id))).toBe(false);
    // El acumulado de Nómina no depende de la ficha.
    expect(f.groups.find((g) => g.nit === "899999034")?.pesos).toBe(500 * 12);
    expect(f.proposals.find((p) => p.data.docNumber === "899999239")?.data).toMatchObject({ docTypeCode: "31", businessName: "", deductible: 800 * 12 });
  });

  it("si Compras ya tiene al mismo tercero y concepto, es una sola fila con los valores sumados", () => {
    const purchases = [{ sourceKey: "third:800138188|5012", origin: "estados_financieros" as const, originRef: "Compras · 1 factura", data: { docNumber: "800138188", concept: "5012", deductible: 100, exactCents: { deductible: 10_000 } } }];
    const payroll = build1001Payroll(data, [], null).proposals;
    const merged = mergePayroll1001(purchases, payroll);
    expect(merged.filter((p) => p.data.docNumber === "800138188")).toHaveLength(1);
    expect(merged.find((p) => p.data.docNumber === "800138188")?.data.deductible).toBe(100 + 280_145 * 12);
    expect(merged).toHaveLength(3);
  });
});

describe("destinos independientes", () => {
  it("los faltantes de un destino no detienen a los demás", () => {
    const data = buildYearData(2026, yearBatches((m) => planilla(m)), WAGES);
    const all = [...build1001Payroll(data, [], null).alerts, ...build2276Alerts(data), ...build1011(data).alerts];
    const status = payrollStatus(payrollCounts(all));
    expect(status).toMatchObject({ EEFF: "ready", "1001": "block", "1011": "ready", "2276": "pending" });
  });
});

function build2276Alerts(data: ReturnType<typeof buildYearData>) {
  return build2276(data, [ficha(1, "111", { nameParts: { firstSurname: "", secondSurname: "", firstName: "", otherNames: "", confirmedAt: null } })], COMPANY).alerts;
}

describe("historial de entidades por empleado", () => {
  const afp2 = { entityCodes: { afp: "230201", eps: "EPS037", arl: "14-11", ccf: "CCF07" } };
  const stored = storedPlanillas([batchOf(planilla("2026-01")), batchOf(planilla("2026-02", { employees: [person("111", afp2)] })), batchOf(planilla("2026-03", { employees: [person("111", afp2)] }))]);

  it("guarda el código de cada entidad por periodo y marca solo el periodo en que cambió", () => {
    const h = entityHistory(stored, "CC", "111");
    expect(h.map((r) => r.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(h.map((r) => r.codes.afp)).toEqual(["230301", "230201", "230201"]);
    expect(h.map((r) => r.changed)).toEqual([[], ["afp"], []]);
    expect(h[0].names.eps).toBe("SURA EPS");
  });

  it("una planilla nueva no reasigna los periodos anteriores", () => {
    const later = storedPlanillas([...stored.map((s) => s.batch), batchOf(planilla("2026-04", { employees: [person("111", { entityCodes: { afp: "999999" } })] }))]);
    const h = entityHistory(later, "CC", "111");
    expect(h.slice(0, 3).map((r) => r.codes.afp)).toEqual(["230301", "230201", "230201"]);
  });

  it("propone entidades nuevas en la primera planilla y un código distinto después; lo igual no se propone", () => {
    const first = proposeEntityChanges(planilla("2026-01"), [], "k");
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: "new", documentKey: "entity:CC 111|2026-01" });
    expect(first[0].changes.map((c) => c.slot)).toEqual(["afp", "eps", "arl", "ccf"]);
    const same = proposeEntityChanges(planilla("2026-04", { employees: [person("111", afp2)] }), stored, "k");
    expect(same).toEqual([]);
    const changed = proposeEntityChanges(planilla("2026-04", { employees: [person("111", { entityCodes: { afp: "230301", eps: "EPS037", arl: "14-11", ccf: "CCF07" } })] }), stored, "k");
    expect(changed[0]).toMatchObject({ kind: "changed", changes: [{ slot: "afp", from: "230201", to: "230301" }] });
  });

  it("al reemplazar la misma planilla, su versión anterior no cuenta como historia; un periodo posterior guardado no se reescribe", () => {
    const own = stored[2].batch.dedupeKey;
    const re = proposeEntityChanges(planilla("2026-03", { employees: [person("111", { entityCodes: { afp: "777777" } })] }), stored, own);
    expect(re[0].changes.find((c) => c.slot === "afp")).toMatchObject({ from: "230201", to: "777777" });
    expect(proposeEntityChanges(planilla("2026-02", { employees: [person("111", { entityCodes: { afp: "555555" } })] }), stored, "otra")).toEqual([]);
  });
});

describe("enlaces que abren el dato", () => {
  it("el foco de un empleado viaja en la ruta: empresa~tipo~número", () => {
    expect(parseEmployeeFocus("7~CC~123")).toEqual({ companyId: 7, docType: "CC", docNumber: "123" });
    expect(parseEmployeeFocus("x~CC~123")).toBeNull();
    expect(parseEmployeeFocus("7~CC")).toBeNull();
  });
});
