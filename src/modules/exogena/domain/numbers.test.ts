import { describe, expect, it } from "vitest";
import { centsToPesos, exportInteger, formatExoCents, formatExoPesos, formatPesosPlain, isValidPercentage, percentageHundredths, roundPesos, splitPercentage } from "./numbers";

describe("redondeo y formato de montos", () => {
  it("1.000.000,5 se exporta como 1000001 (redondeo convencional) y la interfaz usa separadores", () => {
    expect(exportInteger(1000000.5)).toBe(1000001);
    expect(roundPesos(2.4)).toBe(2);
    expect(roundPesos(2.5)).toBe(3);
    expect(roundPesos(-2.5)).toBe(-3);
    expect(roundPesos(-0.4)).toBe(0);
    expect(Object.is(roundPesos(-0.4), 0)).toBe(true);
    expect(formatPesosPlain(1000001)).toBe("1.000.001");
    expect(formatPesosPlain(-1234567.5)).toBe("-1.234.568");
    expect(formatPesosPlain(0)).toBe("0");
    expect(() => roundPesos(Number.NaN)).toThrow();
  });

  it("convierte centavos exactos a pesos enteros", () => {
    expect(centsToPesos(100050)).toBe(1001); // 1.000,50 → 1.001
    expect(centsToPesos(100049)).toBe(1000);
    expect(centsToPesos(-100050)).toBe(-1001);
  });
});

describe("porcentaje de participación", () => {
  it("separa entero y dos dígitos decimales: 50,20 % → 50 y 20; 50 % → 50 y 0", () => {
    expect(splitPercentage(50.2)).toEqual({ integer: 50, decimal: 20 });
    expect(splitPercentage(50)).toEqual({ integer: 50, decimal: 0 });
    expect(splitPercentage(33.33)).toEqual({ integer: 33, decimal: 33 });
    expect(splitPercentage(0.05)).toEqual({ integer: 0, decimal: 5 });
    expect(splitPercentage(100)).toEqual({ integer: 100, decimal: 0 });
    // Errores típicos de coma flotante no cambian los dígitos.
    expect(splitPercentage(0.1 + 0.2 + 49.7)).toEqual({ integer: 50, decimal: 0 });
  });

  it("valida hasta dos decimales y el rango", () => {
    for (const ok of [100, 50.2, 0.01, 33.34]) expect(isValidPercentage(ok)).toBe(true);
    for (const bad of [0, -1, 100.01, 50.123, Number.NaN]) expect(isValidPercentage(bad)).toBe(false);
    expect(percentageHundredths(33.33) + percentageHundredths(33.33) + percentageHundredths(33.34)).toBe(10000);
  });
});

describe("pesos enteros para mostrar e imprimir", () => {
  it("sin decimales, con miles y signo antes del símbolo", () => {
    expect(formatExoPesos(1000000.5)).toBe("$ 1.000.001");
    expect(formatExoPesos(-2.5)).toBe("-$ 3");
    expect(formatExoPesos(0)).toBe("$ 0");
    expect(formatExoCents(311_637)).toBe("$ 3.116");
    expect(formatExoCents(311_850)).toBe("$ 3.119");
    expect(formatExoCents(-800_049)).toBe("-$ 8.000");
    for (const v of [formatExoPesos(12345.67), formatExoCents(123_456_789)]) expect(v).not.toMatch(/,\d/);
  });
});
