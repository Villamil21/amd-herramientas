import { describe, expect, it } from "vitest";
import type { ModuleDef } from "../types/modules";
import { findModule, MODULES, orderedSubmodules } from "./modules";

describe("orden de las tarjetas", () => {
  it("Transacciones Cripto es la primera tarjeta y el Generador la sigue", () => {
    const fs = findModule("estados-financieros")!;
    const names = orderedSubmodules(fs).map((s) => s.name);
    expect(names[0]).toBe("Transacciones Cripto");
    expect(names[1]).toBe("Generador de Estados Financieros");
    // Notas Financieras va junto al Generador; los demás, alfabéticamente.
    expect(names[2]).toBe("Notas Financieras");
    expect(names.slice(3)).toEqual(["Compras, costos y exógena", "Empleados", "Extractos bancarios", "Movimientos contables", "Nómina y seguridad social", "Obligaciones tributarias", "Saldos iniciales", "Ventas"]);
  });

  it("un submódulo nuevo (aunque se declare antes o se llame «A…») no desplaza a los de prioridad definida", () => {
    const fs = findModule("estados-financieros")!;
    const extra = { id: "x", name: "Activos fijos", description: "", icon: fs.icon };
    const module: ModuleDef = { ...fs, submodules: [extra, ...fs.submodules, { ...extra, id: "y", name: "Notas Financieras" }] };
    expect(orderedSubmodules(module).slice(0, 2).map((s) => s.id)).toEqual(["transacciones-cripto", "generador"]);
  });

  it("las herramientas y los submódulos se ordenan alfabéticamente", () => {
    expect(MODULES.filter((m) => m.submodules.length > 0).map((m) => m.name)).toEqual(["Calculadoras", "Certificados", "Dropi", "Estados Financieros", "Impuestos", "Información Exógena", "Reportes regulatorios", "Seguridad social"]);
    expect(orderedSubmodules(findModule("certificados")!).map((s) => s.name)).toEqual(["Certificado de ingresos", "Certificado de Rete fuente e ICA", "Composición Accionaria"]);
    expect(orderedSubmodules(findModule("dropi")!).map((s) => s.name)).toEqual(["Órdenes", "Historial de cartera"]);
    expect(orderedSubmodules(findModule("calculadoras")!).map((s) => s.name)).toEqual(["Calculadora de aportes para Dependientes", "Calculadora de aportes para Independientes"]);
  });

  it("Información Exógena tiene las pantallas 1010, 1009, 1008, 1007, 1647, 1001, 1005, 1006, 1011, 2276 y Control y exportación", () => {
    const exo = findModule("informacion-exogena")!;
    expect(orderedSubmodules(exo).map((s) => s.id)).toEqual(["1010", "1009", "1008", "1007", "1647", "1001", "1005", "1006", "1011", "2276", "control"]);
    expect(exo.submodules.every((s) => Boolean(s.component))).toBe(true);
    expect(exo.landing).toBeDefined();
  });
});
