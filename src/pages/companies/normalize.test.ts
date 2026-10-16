import { describe, expect, it } from "vitest";
import { capitalTotal, digitsOf, nameKey, normalizeDocument, normalizePhone, samePerson, splitNitAndDv, sumsTo100, totalPercent, upperText } from "./normalize";

// Los mismos casos que `src-tauri/src/models/normalize.rs`: frontend y backend deben coincidir.
describe("normalización compartida con el backend", () => {
  it("mayúsculas con tildes y espacios colapsados", () => {
    expect(upperText("  perez   gómez  ñandú ")).toBe("PEREZ GÓMEZ ÑANDÚ");
    expect(upperText("abcdef", 3)).toBe("ABC");
  });

  it("quita separadores solo entre dígitos", () => {
    expect(normalizeDocument("cc 1.192.729.629")).toBe("CC 1192729629");
    expect(normalizeDocument("1 192 729 629")).toBe("1192729629");
    expect(normalizeDocument("ce 99-123")).toBe("CE 99123");
    expect(normalizeDocument("pa AB-12")).toBe("PA AB-12");
  });

  it("teléfonos sin separadores visuales", () => {
    expect(normalizePhone("+57 300 123-4567")).toBe("+573001234567");
    expect(normalizePhone("(601) 234 5678")).toBe("6012345678");
    expect(normalizePhone("300.123.4567 ext 2")).toBe("3001234567EXT2");
  });

  it("NIT y DV son campos distintos", () => {
    expect(splitNitAndDv("900.123.456", "7")).toEqual({ nit: "900123456", dv: "7" });
    expect(splitNitAndDv("900.123.456-7", "")).toEqual({ nit: "900123456", dv: "7" });
    expect(splitNitAndDv("901679752 - 3", "3")).toEqual({ nit: "901679752", dv: "3" });
    expect(splitNitAndDv("900123456-7", "1").error).toBeTruthy();
    expect(splitNitAndDv("9 0 0 1 2 3 4 5 6", " 7 ")).toEqual({ nit: "900123456", dv: "7" });
  });

  it("extrae dígitos de un documento", () => {
    expect(digitsOf("CC 1.020.713.259")).toBe("1020713259");
  });
});

describe("personas, participación y capital", () => {
  it("compara nombres sin importar mayúsculas, tildes, espacios ni orden", () => {
    expect(nameKey("LOPEZ ESCORCIA  Harold Enrique")).toBe(nameKey("harold enrique lópez escorcia"));
    expect(nameKey("Ana Gómez")).not.toBe(nameKey("Ana Gómez Ruiz"));
  });

  it("la misma persona se reconoce por documento y, sin documento, por nombre", () => {
    expect(samePerson({ name: "Shadya Sampayo", document: "C.C. 1.020.713.259" }, { name: "OTRO NOMBRE", document: "CC 1020713259" })).toBe(true);
    expect(samePerson({ name: "Ana Pérez", document: "" }, { name: "PEREZ ANA", document: "CC 1" })).toBe(true);
    expect(samePerson({ name: "Ana Pérez", document: "CC 2" }, { name: "Ana Pérez", document: "CC 1" })).toBe(false);
    expect(samePerson({ name: "", document: "" }, { name: "", document: "" })).toBe(false);
  });

  it("los porcentajes deben sumar exactamente 100 con decimales seguros", () => {
    expect(sumsTo100([{ percentage: 33.33 }, { percentage: 33.33 }, { percentage: 33.34 }])).toBe(true);
    expect(sumsTo100([{ percentage: 0.1 }, { percentage: 0.2 }, { percentage: 99.7 }])).toBe(true);
    expect(sumsTo100([{ percentage: 60 }, { percentage: 30 }])).toBe(false);
    expect(sumsTo100([{ percentage: 100 }])).toBe(true);
    expect(totalPercent([{ percentage: 33.33 }, { percentage: 33.33 }])).toBe(66.66);
  });

  it("el valor total del capital es acciones × valor nominal", () => {
    expect(capitalTotal(50_000, 1_000)).toBe(50_000_000);
    expect(capitalTotal(10_000, 1_000)).toBe(10_000_000);
    expect(capitalTotal(null, 1_000)).toBeNull();
    expect(capitalTotal(1_000, null)).toBeNull();
  });
});
