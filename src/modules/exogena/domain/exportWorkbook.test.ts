import { describe, expect, it } from "vitest";
import type { FormatStatusRow } from "../../../types/exogena";
import { buildExportWorkbook, exportBlockers, rowOf, suggestedExportName } from "./exportWorkbook";
import { FORMAT_1001_COLUMNS, FORMAT_1009_COLUMNS, FORMAT_1010_COLUMNS } from "./formats";
import { buildProposals1010 } from "./form1010";
import { company, shareholder, stored } from "./fixtures";

const status = (formatCode: string, s: FormatStatusRow["status"], extra: Partial<FormatStatusRow> = {}): FormatStatusRow => ({ formatCode, status: s, notApplicableReason: "", lastSyncedAt: null, sourceFingerprint: "", updatedAt: "", recordCount: 0, ...extra });
const problem = (message: string) => ({ level: "blocking" as const, message });
const reconciled = { liabilitiesCents: 0, recordsCents: 0, differenceCents: 0, items: [] };

describe("bloqueos antes de exportar", () => {
  it("un formato en preparación o que requiere actualización bloquea y explica cuál", () => {
    const blockers = exportBlockers({ statuses: { "1010": status("1010", "listo"), "1009": status("1009", "en_preparacion") }, problems: {}, reconciliation1009: null });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ format: "1009" });
    expect(blockers[0].message).toContain("En preparación");
    const stale = exportBlockers({ statuses: { "1010": status("1010", "requiere_actualizacion"), "1009": status("1009", "listo") }, problems: {}, reconciliation1009: reconciled });
    expect(stale[0].message).toContain("Requiere actualización");
  });

  it("un formato no aplicable cuenta como cerrado; todos no aplicables no dejan nada que exportar", () => {
    expect(exportBlockers({ statuses: { "1010": status("1010", "listo"), "1009": status("1009", "no_aplica", { notApplicableReason: "Sin cuentas por pagar" }) }, problems: {}, reconciliation1009: null })).toEqual([]);
    const none = exportBlockers({ statuses: { "1010": status("1010", "no_aplica"), "1009": status("1009", "no_aplica") }, problems: {}, reconciliation1009: null });
    expect(none[0].message).toContain("No hay formatos aplicables");
  });

  it("pendientes vigentes o una diferencia de conciliación distinta de cero bloquean aunque el estado diga «listo»", () => {
    const blockers = exportBlockers({
      statuses: { "1010": status("1010", "listo"), "1009": status("1009", "listo") },
      problems: { "1010": [problem("Falta el DV")] },
      reconciliation1009: { ...reconciled, differenceCents: 500_000 },
    });
    expect(blockers.map((b) => b.format)).toEqual(["1009", "1010"]);
    expect(blockers[0].message).toContain("diferencia");
    expect(blockers[1].message).toContain("Falta el DV");
  });

  it("todo listo y conciliado no tiene bloqueos", () => {
    expect(exportBlockers({ statuses: { "1010": status("1010", "listo"), "1009": status("1009", "listo") }, problems: { "1010": [], "1009": [] }, reconciliation1009: reconciled })).toEqual([]);
  });
});

describe("hojas del Excel", () => {
  const co = company([shareholder({ id: 1, percentage: 50.2 }), shareholder({ id: 2, percentage: 49.8, name: "OTRA", identityDocument: "CC 22517821", firstSurname: "FONTALVO", firstName: "YURLYS", deptCode: "05", muniCode: "001" })], { subscribedTotalShares: 1000, subscribedNominalValue: 100_000 });
  const records1010 = buildProposals1010(co).map((p, i) => stored(p, { id: i + 1 }));
  const record1009 = stored(
    { sourceKey: "nit:800197268|2204", origin: "estados_financieros", originRef: "x", data: { concept: "2204", docTypeCode: "31", docNumber: "0800197268", dv: "4", firstSurname: "", secondSurname: "", firstName: "", otherNames: "", businessName: "DIAN", address: "CL 1", deptCode: "05", muniCode: "001", countryCode: "169", balance: 1000001, balanceCents: 100000050 } },
    { formatCode: "1009" },
  );
  const book = buildExportWorkbook({
    company: { razonSocial: "GLOWING DIGITAL CLOUD S.A.S.", nit: "901741186", dv: "9" },
    year: 2025,
    statuses: { "1010": status("1010", "listo"), "1009": status("1009", "listo") },
    records: { "1010": records1010, "1009": [record1009] },
  });

  it("una hoja por formato aplicable, nombrada con su código, con la identificación de la empresa", () => {
    expect(book.sheets.map((s) => s.name)).toEqual(["1009", "1010"]);
    expect(book).toMatchObject({ companyName: "GLOWING DIGITAL CLOUD S.A.S.", companyNit: "901741186-9", year: 2025 });
    expect(book.sheets[0].title).toBe("Saldo de cuentas por pagar al 31 de diciembre");
  });

  it("encabezados en el orden pactado y solo los registros reales como filas", () => {
    expect(book.sheets[0].columns.map((c) => c.header)).toEqual(FORMAT_1009_COLUMNS.map((c) => c.header));
    expect(book.sheets[1].columns.map((c) => c.header)).toEqual(FORMAT_1010_COLUMNS.map((c) => c.header));
    expect(book.sheets[0].rows).toHaveLength(1);
    expect(book.sheets[1].rows).toHaveLength(2);
  });

  it("identificadores y códigos como texto (con sus ceros); montos y porcentajes como enteros sin decimales", () => {
    const row1009 = book.sheets[0].rows[0];
    expect(row1009).toEqual(["2204", "31", "0800197268", "4", null, null, null, null, "DIAN", "CL 1", "05", "001", "169", 1000001]);
    const row1010 = book.sheets[1].rows[0];
    const cols = FORMAT_1010_COLUMNS.map((c) => c.key);
    expect(row1010[cols.indexOf("deptCode")]).toBe("76");
    expect(row1010[cols.indexOf("muniCode")]).toBe("001");
    expect(row1010[cols.indexOf("countryCode")]).toBe("169");
    expect(row1010[cols.indexOf("nominalValue")]).toBe(50_200_000);
    expect(row1010[cols.indexOf("premium")]).toBe(0);
    expect(row1010[cols.indexOf("pctInteger")]).toBe(50);
    expect(row1010[cols.indexOf("pctDecimal")]).toBe(20);
    for (const sheet of book.sheets) for (const row of sheet.rows) sheet.columns.forEach((c, i) => c.kind === "integer" && expect(Number.isInteger(row[i])).toBe(true));
  });

  it("1.000.000,5 se exporta como 1000001 aunque el registro traiga decimales", () => {
    expect(rowOf("1009", { data: { ...record1009.data, balance: 1000000.5 } })[13]).toBe(1000001);
  });

  it("un formato no aplicable no genera hoja", () => {
    const only = buildExportWorkbook({ company: { razonSocial: "E", nit: "1", dv: "" }, year: 2025, statuses: { "1010": status("1010", "listo"), "1009": status("1009", "no_aplica") }, records: { "1010": records1010, "1009": [] } });
    expect(only.sheets.map((s) => s.name)).toEqual(["1010"]);
    expect(only.companyNit).toBe("1");
  });

  it("nombre sugerido del archivo", () => expect(suggestedExportName({ razonSocial: "Inversiones D&P Capital S.A.S." }, 2025)).toBe("Exogena_2025_Inversiones_D_P_Capital_S_A_S"));

  it("1001, 1005 y 1006 entran al Excel único con sus columnas; los pendientes y un 1005 sin marcar bloquean", () => {
    const r1001 = { id: 1, sourceKey: "third:900|5001", origin: "estados_financieros", originRef: "", manualFields: [], data: { concept: "5001", docTypeCode: "31", docNumber: "900111222", dv: "1", businessName: "PROV SAS", deductible: 100000, ivaDeductible: 19000, retPracticed: 4000 } } as never;
    const book = buildExportWorkbook({ company: { razonSocial: "E", nit: "1", dv: "" }, year: 2025, statuses: { "1001": status("1001", "listo"), "1005": status("1005", "no_aplica"), "1006": status("1006", "no_aplica") }, records: { "1001": [r1001] } });
    expect(book.sheets.map((s) => s.name)).toEqual(["1001"]);
    const cols = FORMAT_1001_COLUMNS.map((c) => c.key);
    expect(book.sheets[0].rows[0][cols.indexOf("deductible")]).toBe(100000);
    expect(book.sheets[0].rows[0][cols.indexOf("nonDeductible")]).toBeNull();

    const blocked = exportBlockers({ statuses: { "1001": status("1001", "listo"), "1005": status("1005", "en_preparacion") }, problems: { "1001": [problem("Línea sin confirmar")] }, reconciliation1009: null });
    expect(blocked.map((b) => b.format)).toEqual(["1001", "1005"]);
  });
});
