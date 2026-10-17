import { describe, expect, it } from "vitest";
import type { ExoRecord } from "../../../types/exogena";
import type { PurchasesModel } from "../../financial-statements/purchases/domain/model";
import type { Alert } from "../../financial-statements/purchases/domain/status";
import { problemsFromAlerts, purchasesFormatState, shouldReopenPurchases } from "./purchasesFormat";
import { blocking } from "./problems";

const alert = (over: Partial<Alert>): Alert => ({ id: "a", code: "x", severity: "block", dests: ["1001"], title: "T", why: "porque", how: "haz", target: { kind: "none" }, ...over });

const model = (over: Partial<PurchasesModel>): PurchasesModel =>
  ({ alerts: [], notApplicable: {}, proposals: { "1001": [], "1005": [], "1006": [] }, ...over }) as unknown as PurchasesModel;

const proposal = (sourceKey: string, value: number) => ({ sourceKey, origin: "estados_financieros" as const, originRef: "Compras", data: { discountable: value } });
const stored = (sourceKey: string, value: number): ExoRecord => ({ id: 1, sourceKey, origin: "estados_financieros", originRef: "", manualFields: [], data: { discountable: value } }) as unknown as ExoRecord;

describe("purchasesFormatState", () => {
  it("solo cuentan las alertas que afectan al formato", () => {
    const m = model({ alerts: [alert({ dests: ["EEFF"] }), alert({ dests: ["1001", "1005"], id: "b" })] });
    expect(purchasesFormatState(m, "1001", []).problems).toHaveLength(1);
    expect(purchasesFormatState(m, "1006", []).problems).toHaveLength(0);
  });

  it("bloquea y pendiente de confirmar impiden listo; revisión solo advierte", () => {
    const m = model({ alerts: [alert({}), alert({ id: "p", severity: "pending", code: "p" }), alert({ id: "r", severity: "review", code: "r" }), alert({ id: "i", severity: "info", code: "i" })] });
    const problems = purchasesFormatState(m, "1001", []).problems;
    expect(problems.map((p) => p.level).sort()).toEqual(["blocking", "blocking", "warning"]);
  });

  it("agrupa las alertas repetidas", () => {
    const alerts = Array.from({ length: 10 }, (_, i) => alert({ id: `l${i}`, code: "line-unconfirmed", severity: "pending" }));
    expect(problemsFromAlerts(alerts, "1001")).toHaveLength(1);
    expect(problemsFromAlerts(alerts, "1001")[0].message).toContain("10 pendientes");
  });

  it("No aplica: sin propuestas ni pendientes y con su justificación", () => {
    const m = model({ alerts: [alert({ dests: ["1005"] })], notApplicable: { "1005": "No responsable de IVA" }, proposals: { "1001": [], "1005": [proposal("t:1", 5)], "1006": [] } });
    const s = purchasesFormatState(m, "1005", [stored("t:1", 5)]);
    expect(s.notApplicableReason).toBe("No responsable de IVA");
    expect(s.problems).toHaveLength(0);
    expect(s.proposals).toHaveLength(0);
  });

  it("desactualizado cuando la propuesta difiere de lo guardado", () => {
    const m = model({ proposals: { "1001": [], "1005": [proposal("t:1", 9)], "1006": [] } });
    const s = purchasesFormatState(m, "1005", [stored("t:1", 5)]);
    expect(s.changes).toHaveLength(1);
    expect(blocking(s.problems)).toHaveLength(1);
    expect(purchasesFormatState(m, "1005", [stored("t:1", 9)]).problems).toHaveLength(0);
  });

  it("solo se reabre un formato listo con pendientes bloqueantes", () => {
    const blocked = [{ level: "blocking" as const, message: "x" }];
    expect(shouldReopenPurchases("listo", blocked)).toBe(true);
    expect(shouldReopenPurchases("en_preparacion", blocked)).toBe(false);
    expect(shouldReopenPurchases("listo", [{ level: "warning", message: "x" }])).toBe(false);
  });
});
