import { describe, expect, it, vi } from "vitest";
import type { ExoRecord } from "../../../types/exogena";
import type { PurchasesModel } from "../../financial-statements/purchases/domain/model";
import { auditFileName, buildPurchasesAudit } from "./purchasesAudit";
import { renderPurchasesAuditPdf } from "./purchasesAuditPdf";
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

  const withDecimals = { ...docView, vatCents: 1_900_049, lines: [{ ...docView.lines[0], baseCents: 10_000_049 }] };
  const decimalModel = { ...model, docs: [withDecimals], reconciliation: { applicable: true, discountableCents: 1_900_049, recoveredCents: 150_050, netVatCents: 1_749_999, vat1001Cents: 1_749_999, differenceCents: 0 } } as unknown as PurchasesModel;
  const decimalRecord = { ...record, data: { ...record.data, deductible: 100000, retAssumed: 3116, ivaDeductible: 19000 } } as unknown as ExoRecord;
  const audit = () => buildPurchasesAudit({ model: decimalModel, format: "1001", state, records: [decimalRecord], company: { razonSocial: "MONO SAS", nit: "901817531" }, year: 2025, statusLabel: "Listo" });

  it("los valores y la conciliación de la auditoría van en pesos enteros, sin decimales", () => {
    const a = audit();
    expect(a.records[0].values[0]).toEqual({ label: "Deducible", value: "$ 100.000" });
    const shown = [...a.records[0].values.map((v) => v.value), ...(a.reconciliation ?? []).map((r) => r.value)];
    expect(shown.length).toBeGreaterThan(5);
    for (const v of shown) expect(v).not.toMatch(/,\d/);
    expect(a.reconciliation?.[0].value).toBe("$ 19.000");
  });

  it("el PDF imprime todos los montos sin decimales, también el detalle por factura", async () => {
    const printed: string[] = [];
    vi.doMock("jspdf", () => ({
      jsPDF: class {
        setFont() {}
        setFontSize() {}
        setTextColor() {}
        addPage() {}
        setPage() {}
        getNumberOfPages() {
          return 1;
        }
        splitTextToSize(v: string) {
          return [v];
        }
        text(v: string) {
          printed.push(v);
        }
        output() {
          return new ArrayBuffer(0);
        }
      },
    }));
    await renderPurchasesAuditPdf(audit());
    vi.doUnmock("jspdf");
    const trace = printed.find((t) => t.includes("FE1 (f.pdf)"));
    expect(trace).toContain("$ 100.000");
    expect(trace).not.toMatch(/,\d/);
    const moneyLines = printed.filter((t) => t.includes("$"));
    expect(moneyLines.length).toBeGreaterThan(2);
    for (const t of moneyLines) expect(t).not.toMatch(/\$ [\d.]*,\d/);
  });
});
