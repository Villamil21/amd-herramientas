import { describe, expect, it } from "vitest";
import type { ExoRecord } from "../../../types/exogena";
import type { PurchasesModel } from "../../financial-statements/purchases/domain/model";
import { auditFileName, buildPurchasesAudit } from "./purchasesAudit";
import type { PurchasesFormatState } from "./purchasesFormat";

const docView = { counts: true, supplierNit: "900111222", kind: "purchase", vatCents: 1_900_000, ready: { EEFF: true, "1001": true, "1005": true, "1006": true }, data: { number: "FE1" }, doc: { fileName: "f.pdf", issueDate: "2025-03-10" }, lines: [{ concept1001: "5001", pucCode: "510506", baseCents: 10_000_000, line: { index: 0, code: "A", description: "Servicio" } }] };
const model = { docs: [docView], coverage: [{ month: 3, purchases: 1, returns: 0, duplicates: 0, pending: 0, blocked: 0 }], reconciliation: { applicable: false }, totals: { documents: 1, lines: 1, pendingLines: 0 } } as unknown as PurchasesModel;
const state: PurchasesFormatState = { proposals: [], changes: [{ sourceKey: "third:900111222|5001", kind: "changed", fields: ["deductible"] }], problems: [{ level: "warning", message: "revisar" }], notApplicableReason: null };
const record = { id: 1, sourceKey: "third:900111222|5001", data: { concept: "5001", docNumber: "900111222", businessName: "PROV SAS", deductible: 100000, ivaDeductible: 19000 } } as unknown as ExoRecord;

describe("buildPurchasesAudit", () => {
  it("traza cada registro de 1001 hasta las líneas de las facturas y marca lo desactualizado", () => {
    const a = buildPurchasesAudit({ model, format: "1001", state, records: [record], company: { razonSocial: "MONO SAS", nit: "901817531" }, year: 2025, statusLabel: "Listo" });
    expect(a.records[0].third).toBe("PROV SAS");
    expect(a.records[0].outdated).toBe(true);
    expect(a.records[0].trace).toHaveLength(1);
    expect(a.records[0].trace[0].detail).toContain("PUC 510506");
    expect(a.problems[0].level).toBe("Advertencia");
    expect(a.coverage[0].month).toBe("Marzo");
  });

  it("nombre de archivo sin tildes ni símbolos", () => expect(auditFileName("Inversiones D&P Ñandú", "1005", 2025)).toBe("Auditoria_1005_2025_Inversiones_D_P_Nandu"));
});
