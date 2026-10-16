import { describe, expect, it } from "vitest";
import type { ModuleDef } from "../types/modules";
import { findModule, MODULES, orderedSubmodules } from "./modules";

describe("orden de las tarjetas", () => {
  it("el Generador de Estados Financieros siempre es la primera tarjeta", () => {
    const fs = findModule("estados-financieros")!;
    const names = orderedSubmodules(fs).map((s) => s.name);
    expect(names[0]).toBe("Generador de Estados Financieros");
    // Los demás, alfabéticamente.
    expect(names.slice(1)).toEqual(["Clasificación contable de compras", "Empleados", "Extractos bancarios", "Movimientos contables", "Nómina", "Obligaciones tributarias", "Saldos iniciales", "Ventas"]);
  });

  it("un submódulo nuevo (aunque se declare antes o se llame «A…») no desplaza a uno con prioridad 0", () => {
    const fs = findModule("estados-financieros")!;
    const extra = { id: "x", name: "Activos fijos", description: "", icon: fs.icon };
    const module: ModuleDef = { ...fs, submodules: [extra, ...fs.submodules, { ...extra, id: "y", name: "Notas Financieras" }] };
    expect(orderedSubmodules(module)[0].id).toBe("generador");
  });

  it("las herramientas y los submódulos se ordenan alfabéticamente", () => {
    expect(MODULES.filter((m) => m.submodules.length > 0).map((m) => m.name)).toEqual(["Calculadoras", "Certificados", "Dropi", "Estados Financieros", "Impuestos", "Información Exógena", "Reportes regulatorios", "Seguridad social"]);
    expect(orderedSubmodules(findModule("certificados")!).map((s) => s.name)).toEqual(["Certificado de ingresos", "Certificado de Rete fuente e ICA", "Composición Accionaria"]);
    expect(orderedSubmodules(findModule("dropi")!).map((s) => s.name)).toEqual(["Órdenes", "Historial de cartera"]);
    expect(orderedSubmodules(findModule("calculadoras")!).map((s) => s.name)).toEqual(["Calculadora de aportes para Dependientes", "Calculadora de aportes para Independientes"]);
  });

  it("Información Exógena tiene solo las pantallas de la fase 1: 1010, 1009 y Control y exportación", () => {
    const exo = findModule("informacion-exogena")!;
    expect(orderedSubmodules(exo).map((s) => s.id)).toEqual(["1010", "1009", "control"]);
    expect(exo.submodules.every((s) => Boolean(s.component))).toBe(true);
    expect(exo.landing).toBeDefined();
  });
});
