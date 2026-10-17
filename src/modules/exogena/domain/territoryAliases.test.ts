import { describe, expect, it } from "vitest";
import type { ExoCatalogs } from "../../../types/exogena";
import type { ExoAlias } from "../../../types/purchases";
import { resolveTerritoryByName } from "./territory";

const catalogs = {
  countries: [{ code: "169", name: "Colombia", isActive: true }, { code: "249", name: "Estados Unidos", isActive: true }],
  departments: [{ code: "47", name: "Magdalena", isActive: true }, { code: "13", name: "Bolívar", isActive: true }],
  municipalities: [{ code: "001", deptCode: "47", name: "Santa Marta D.T.C.H.", isActive: true }, { code: "001", deptCode: "13", name: "Cartagena de Indias", isActive: true }],
} as unknown as ExoCatalogs;

const alias = (kind: ExoAlias["kind"], aliasKey: string, target: string, parent = ""): ExoAlias => ({ kind, aliasKey, parent, alias: aliasKey, target, updatedAt: "" });

describe("alias de territorio", () => {
  it("sin alias un nombre abreviado no se adivina", () => {
    const r = resolveTerritoryByName(catalogs, { country: "Colombia", department: "Magdalena", city: "Sta Marta" });
    expect(r.muniCode).toBe("");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("el alias del municipio (por departamento) lo resuelve y persiste entre llamadas", () => {
    const aliases = [alias("municipality", "STA MARTA", "001", "47")];
    const r = resolveTerritoryByName(catalogs, { country: "Colombia", department: "Magdalena", city: "Sta. Marta" }, aliases);
    expect(r).toMatchObject({ countryCode: "169", deptCode: "47", muniCode: "001" });
    // El mismo alias de otro departamento no aplica.
    expect(resolveTerritoryByName(catalogs, { country: "Colombia", department: "Bolívar", city: "Sta Marta" }, aliases).muniCode).toBe("");
  });

  it("alias de país y de departamento", () => {
    const aliases = [alias("country", "USA", "249"), alias("department", "MAGD", "47")];
    expect(resolveTerritoryByName(catalogs, { country: "USA" }, aliases).countryCode).toBe("249");
    expect(resolveTerritoryByName(catalogs, { department: "Magd", city: "" }, aliases).deptCode).toBe("47");
  });

  it("un alias que apunta a un código inexistente no inventa nada", () => {
    const r = resolveTerritoryByName(catalogs, { department: "Magdalena", city: "Sta Marta" }, [alias("municipality", "STA MARTA", "999", "47")]);
    expect(r.muniCode).toBe("");
  });
});
