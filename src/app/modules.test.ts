import { describe, expect, it } from "vitest";
import type { ModuleDef } from "../types/modules";
import { findModule, orderedSubmodules } from "./modules";

describe("orden de las tarjetas", () => {
  it("el Generador de Estados Financieros siempre es la primera tarjeta", () => {
    const fs = findModule("estados-financieros")!;
    const names = orderedSubmodules(fs).map((s) => s.name);
    expect(names[0]).toBe("Generador de Estados Financieros");
    // Los demás conservan su orden declarado.
    expect(names.slice(1)).toEqual(fs.submodules.filter((s) => s.id !== "generador").map((s) => s.name));
  });

  it("un submódulo nuevo (aunque se declare antes o se llame «A…») no desplaza a uno con prioridad 0", () => {
    const fs = findModule("estados-financieros")!;
    const extra = { id: "x", name: "Activos fijos", description: "", icon: fs.icon };
    const module: ModuleDef = { ...fs, submodules: [extra, ...fs.submodules, { ...extra, id: "y", name: "Notas Financieras" }] };
    expect(orderedSubmodules(module)[0].id).toBe("generador");
  });
});
