import { describe, expect, it } from "vitest";
import { allocateCapital, subscribedCapitalPesos } from "./capital";

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe("capital asignado por socio", () => {
  it("capital suscrito = acciones × valor nominal; sin configurar es null", () => {
    expect(subscribedCapitalPesos({ subscribedTotalShares: 1000, subscribedNominalValue: 100000 })).toBe(100_000_000);
    expect(subscribedCapitalPesos({ subscribedTotalShares: null, subscribedNominalValue: 1000 })).toBeNull();
    expect(subscribedCapitalPesos({ subscribedTotalShares: 0, subscribedNominalValue: 1000 })).toBeNull();
  });

  it("un solo socio recibe todo el capital", () => {
    expect(allocateCapital(100_000_000, [{ percentage: 100 }])).toEqual([100_000_000]);
  });

  it("reparte exacto cuando la división es entera", () => {
    expect(allocateCapital(100_000_000, [{ percentage: 50.2 }, { percentage: 49.8 }])).toEqual([50_200_000, 49_800_000]);
  });

  it("la suma de los socios siempre coincide con el capital total (tres tercios)", () => {
    const result = allocateCapital(100, [{ percentage: 33.33 }, { percentage: 33.33 }, { percentage: 33.34 }]);
    expect(result).toEqual([33, 33, 34]);
    expect(sum(result)).toBe(100);
    // 1.000.000 en tres partes de 33,33 / 33,33 / 33,34: 333.300 + 333.300 + 333.400.
    expect(allocateCapital(1_000_000, [{ percentage: 33.33 }, { percentage: 33.33 }, { percentage: 33.34 }])).toEqual([333_300, 333_300, 333_400]);
  });

  it("los pesos sobrantes van a los mayores restos y, en empate, al primero", () => {
    // 10 pesos en tres partes iguales (con participación 33,33 / 33,33 / 33,34): partes exactas 3,333 / 3,333 / 3,334 → pisos 3,3,3, sobra 1 → al mayor resto (el tercero).
    expect(allocateCapital(10, [{ percentage: 33.33 }, { percentage: 33.33 }, { percentage: 33.34 }])).toEqual([3, 3, 4]);
    // Empate de restos: dos socios al 50 % con capital impar → el primero recibe el peso sobrante.
    expect(allocateCapital(11, [{ percentage: 50 }, { percentage: 50 }])).toEqual([6, 5]);
    // Determinista: mismo resultado en cada llamada.
    expect(allocateCapital(11, [{ percentage: 50 }, { percentage: 50 }])).toEqual(allocateCapital(11, [{ percentage: 50 }, { percentage: 50 }]));
  });

  it("no pierde precisión con capitales grandes (más de 2^53 / 10000)", () => {
    const total = 9_000_000_000_000; // 9 billones
    const result = allocateCapital(total, [{ percentage: 33.33 }, { percentage: 33.33 }, { percentage: 33.34 }]);
    expect(sum(result)).toBe(total);
    expect(result[0]).toBe(2_999_700_000_000);
  });

  it("participaciones que no suman 100 no inventan un reparto: solo el piso de cada parte", () => {
    const result = allocateCapital(1000, [{ percentage: 60 }, { percentage: 30 }]);
    expect(result).toEqual([600, 300]);
  });

  it("rechaza capitales no enteros", () => {
    expect(() => allocateCapital(100.5, [{ percentage: 100 }])).toThrow();
    expect(() => allocateCapital(-1, [{ percentage: 100 }])).toThrow();
  });
});
