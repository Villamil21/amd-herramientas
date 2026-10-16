import { describe, expect, it } from "vitest";
import { company, shareholder as sh } from "../../modules/exogena/domain/fixtures";
import type { CompanyDocument } from "../../types/models";
import { capitalSummary } from "./capitalSummary";
import { companyStatus } from "./companyStatus";
import { COMPANY_TABS, dirtyTabs, tabOf, TAB_FIELDS } from "./companyTabs";
import { EMPTY_COMPANY_INPUT } from "./companyDefaults";

const doc = (kind: "rut" | "camara"): CompanyDocument => ({ id: 1, kind, fileName: `${kind}.pdf`, storedFile: `${kind}.pdf`, sizeBytes: 10, uploadedAt: "2026-01-01", isCurrent: true });
const complete = () => company([sh({ id: 1, name: "ANA", percentage: 100, legalRole: "principal" })], { ciiuCode: "6201", legalRepName: "ANA", documents: [doc("rut"), doc("camara")] });

describe("estado de la empresa en el listado", () => {
  it("«Lista» con documentos, CIIU, capital, socios y representante", () => {
    const s = companyStatus(complete());
    expect(s.state).toBe("lista");
    expect(s.documents).toEqual({ rut: true, camara: true, count: 2 });
  });

  it("«Faltan datos» enumera lo que falta, con detalle corto", () => {
    const s = companyStatus(company([], { documents: [doc("rut")] }));
    expect(s.state).toBe("faltan");
    expect(s.missing).toEqual(expect.arrayContaining(["Cámara de Comercio sin cargar", "Código CIIU", "Socios", "Representante legal"]));
    expect(s.detail.split(" · ")).toHaveLength(4); // 3 + «y N más»
    expect(s.detail).toContain("más");
  });

  it("«Requiere revisión» cuando está completa pero la Cámara no confirmó un dato o un RUT de socio tiene diferencias", () => {
    const a = companyStatus({ ...complete(), registralReview: ["registryNumber"] });
    expect(a.state).toBe("revision");
    expect(a.detail).toBe("1 dato registral por revisar");
    const b = companyStatus({ ...complete(), shareholders: [sh({ id: 1, name: "ANA", percentage: 100, legalRole: "principal", rutStatus: "revisar" })] });
    expect(b.state).toBe("revision");
    expect(b.review[0]).toContain("RUT de socio con diferencias");
  });

  it("lo que falta pesa más que lo que se debe revisar", () => {
    expect(companyStatus({ ...company([], { documents: [] }), registralReview: ["registryBook"] }).state).toBe("faltan");
  });
});

describe("resumen de capital", () => {
  it("suscrito, pagado y saldo por cobrar a socios (suscrito − pagado)", () => {
    expect(capitalSummary({ subscribedTotalShares: 100_000, subscribedNominalValue: 1000, paidTotalShares: 40_000, paidNominalValue: 1000 })).toMatchObject({ subscribed: 100_000_000, paid: 40_000_000, receivable: 60_000_000, warnings: [] });
  });
  it("sin pagado definido todo el suscrito está por cobrar", () => {
    expect(capitalSummary({ subscribedTotalShares: 1000, subscribedNominalValue: 1000, paidTotalShares: null, paidNominalValue: null }).receivable).toBe(1_000_000);
  });
  it("advierte inconsistencias sin bloquear: pagado mayor que suscrito, datos a medias, pagado sin suscrito", () => {
    expect(capitalSummary({ subscribedTotalShares: 10, subscribedNominalValue: 1000, paidTotalShares: 20, paidNominalValue: 1000 }).warnings).toContain("El capital pagado supera al suscrito.");
    expect(capitalSummary({ subscribedTotalShares: 10, subscribedNominalValue: null, paidTotalShares: null, paidNominalValue: null }).warnings[0]).toContain("Capital suscrito");
    expect(capitalSummary({ subscribedTotalShares: null, subscribedNominalValue: null, paidTotalShares: 5, paidNominalValue: 1000 }).warnings).toContain("Hay capital pagado pero no suscrito.");
    expect(capitalSummary({ subscribedTotalShares: null, subscribedNominalValue: null, paidTotalShares: null, paidNominalValue: null }).receivable).toBeNull();
  });
});

describe("cada dato se edita en una sola pestaña", () => {
  it("el CIIU solo se edita en «Fiscal y registral»", () => {
    expect(tabOf("ciiuCode")).toBe("fiscal");
    expect(COMPANY_TABS.filter((t) => TAB_FIELDS[t.id].includes("ciiuCode"))).toHaveLength(1);
  });
  it("ningún campo está en dos pestañas y los datos registrales viven con la configuración tributaria", () => {
    const all = Object.values(TAB_FIELDS).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(tabOf("registryNumber")).toBe("fiscal");
    expect(tabOf("shareholders")).toBe("societaria");
    expect(tabOf("razonSocial")).toBe("generales");
  });
  it("señala la pestaña con cambios sin guardar", () => {
    const saved = { ...EMPTY_COMPANY_INPUT, razonSocial: "A" };
    expect(dirtyTabs(saved, { ...saved, ciiuCode: "6201" }, false)).toEqual(["fiscal"]);
    expect(dirtyTabs(saved, { ...saved, ciudad: "CALI", subscribedTotalShares: 10 }, false)).toEqual(["generales", "societaria"]);
    expect(dirtyTabs(saved, saved, true)).toEqual(["resumen"]);
    expect(dirtyTabs(saved, saved, false)).toEqual([]);
  });
});
