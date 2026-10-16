import { describe, expect, it } from "vitest";
import type { Supplier } from "../../../types/models";
import { CATALOGS } from "./fixtures";
import { applyProposal, proposeFromInvoices } from "./issuerProposal";
import { resolveTerritoryByName } from "./territory";

const supplier = (over: Partial<Supplier> = {}): Supplier => ({ id: 1, nit: "900319753", businessName: "PRICESMART COLOMBIA S.A.S.", vatType: "purchase", createdAt: "x", updatedAt: "x", ...over });
const PRICESMART = { nit: "900319753", name: "PRICESMART COLOMBIA S.A.S.", issuer: { personType: "PJ" as const, address: "CL 26 71 A 16", country: "Colombia", department: "Bogotá", city: "BOGOTÁ D.C." } };

describe("territorio escrito con nombres (facturas)", () => {
  it("resuelve «Bogotá» + «BOGOTÁ D.C.» y «Bogotá D.C» + «Bogotá, D.C» a 11 / 001", () => {
    expect(resolveTerritoryByName(CATALOGS, { country: "Colombia", department: "Bogotá", city: "BOGOTÁ D.C." })).toMatchObject({ countryCode: "169", deptCode: "11", muniCode: "001", warnings: [] });
    expect(resolveTerritoryByName(CATALOGS, { country: "Colombia", department: "Bogotá D.C", city: "Bogotá, D.C" })).toMatchObject({ deptCode: "11", muniCode: "001" });
  });

  it("deduce el departamento de un municipio único y no adivina lo ambiguo", () => {
    expect(resolveTerritoryByName(CATALOGS, { country: "Colombia", city: "Cali" })).toMatchObject({ deptCode: "76", muniCode: "001" });
    const out = resolveTerritoryByName(CATALOGS, { country: "Colombia", department: "Valle del Cauca", city: "Pueblo inexistente" });
    expect(out).toMatchObject({ deptCode: "76", muniCode: "" });
    expect(out.warnings.join(" ")).toContain("Pueblo inexistente");
  });

  it("fuera de Colombia no hay departamento ni municipio", () => {
    expect(resolveTerritoryByName(CATALOGS, { country: "Estados Unidos", department: "Florida", city: "Miami" })).toEqual({ countryCode: "249", deptCode: "", muniCode: "", warnings: [] });
  });
});

describe("prellenado revisable de la ficha desde la factura", () => {
  it("un proveedor sin datos recibe tipo 31 (PJ), dirección y ubicación como cambios por completar", () => {
    const [p] = proposeFromInvoices([PRICESMART], [supplier()], CATALOGS);
    expect(p.changes.map((c) => [c.key, c.proposed, c.kind])).toEqual([["personType", "PJ", "fill"], ["docTypeCode", "31", "fill"], ["address", "CL 26 71 A 16", "fill"], ["countryCode", "169", "fill"], ["deptCode", "11", "fill"], ["muniCode", "001", "fill"]]);
    const tax = applyProposal(p, new Set(p.changes.map((c) => c.key)));
    expect(tax.data).toMatchObject({ personType: "PJ", docTypeCode: "31", address: "CL 26 71 A 16", countryCode: "169", deptCode: "11", muniCode: "001" });
    expect(tax.dataOrigin).toBe("factura");
  });

  it("un valor ya confirmado que la factura contradice es una diferencia: no se pisa sin aceptarla", () => {
    const [p] = proposeFromInvoices([PRICESMART], [supplier({ address: "CL 1 2 3", personType: "PJ", docTypeCode: "31", countryCode: "169", deptCode: "11", muniCode: "001" })], CATALOGS);
    expect(p.changes).toEqual([expect.objectContaining({ key: "address", kind: "conflict", current: "CL 1 2 3", proposed: "CL 26 71 A 16" })]);
    // Sin aceptar el cambio, la ficha queda igual.
    expect(applyProposal(p, new Set()).data.address).toBe("CL 1 2 3");
    expect(applyProposal(p, new Set(["address"])).data.address).toBe("CL 26 71 A 16");
  });

  it("lo que coincide no genera cambios y un proveedor al día no aparece", () => {
    const full = supplier({ address: "cl 26 71 a 16", personType: "PJ", docTypeCode: "31", countryCode: "169", deptCode: "11", muniCode: "001" });
    expect(proposeFromInvoices([PRICESMART], [full], CATALOGS)).toEqual([]);
  });

  it("persona natural: la factura no revela el tipo de documento, así que NO se inventa el 13 y queda la tarea pendiente", () => {
    const natural = { nit: "1192816998", name: "ANGARITA LOPEZ RONALDO", issuer: { personType: "PN" as const, address: "CL 5", country: "Colombia", department: "Valle del Cauca", city: "Cali" } };
    const [p] = proposeFromInvoices([natural], [supplier({ id: 2, nit: "1192816998", businessName: "ANGARITA LOPEZ RONALDO" })], CATALOGS);
    expect(p.changes.find((c) => c.key === "docTypeCode")).toBeUndefined();
    expect(p.needsDocType).toBe(true);
    const tax = applyProposal(p, new Set(p.changes.map((c) => c.key)));
    expect(tax.data.docTypeCode).toBeNull();
    expect(tax.data.personType).toBe("PN");
  });

  it("solo toca proveedores que ya existen y usa una propuesta por NIT", () => {
    expect(proposeFromInvoices([{ ...PRICESMART, nit: "111" }], [supplier()], CATALOGS)).toEqual([]);
    expect(proposeFromInvoices([PRICESMART, PRICESMART], [supplier()], CATALOGS)).toHaveLength(1);
    expect(proposeFromInvoices([{ nit: "900319753", name: "X" }], [supplier()], CATALOGS)).toEqual([]);
  });
});
