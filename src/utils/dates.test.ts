import { describe, expect, it } from "vitest";
import { formatDateForDisplay, formatDateForInput, formatDateText, formatDateTimeForDisplay, formatLocalDate, parseDisplayDate, parseTaxPaymentDate } from "./dates";

describe("regla global de fechas: interno AAAA-MM-DD, visible DD/MM/AAAA", () => {
  it("muestra día/mes/año, nunca mes/día/año", () => {
    expect(formatDateForDisplay("2026-09-30")).toBe("30/09/2026"); // Generador EEFF
    expect(formatDateForDisplay("2026-12-31")).toBe("31/12/2026");
    expect(formatDateForDisplay("2026-10-15")).toBe("15/10/2026"); // fecha de pago
    expect(formatDateForDisplay("2026-01-01")).toBe("01/01/2026");
    expect(formatDateForDisplay("2026/02/27")).toBe("27/02/2026"); // extractos y planillas (AAAA/MM/DD)
    expect(formatDateForInput("2026-09-30")).toBe("30/09/2026");
  });

  it("fecha con hora: solo cambia el orden de la fecha", () => {
    expect(formatDateForDisplay("2026-10-15 14:35")).toBe("15/10/2026 14:35");
  });

  it("no corre el día por zona horaria", () => {
    // Fecha pura: se lee como texto, sin Date ni UTC.
    expect(formatDateForDisplay("2026-09-30")).not.toBe("29/09/2026");
    // Marca UTC: se muestra el día local del equipo, igual que lo vería el usuario.
    const at = "2026-10-16T01:30:00Z";
    expect(formatDateForDisplay(at)).toBe(formatLocalDate(new Date(at)));
    expect(formatDateTimeForDisplay(at)).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  });

  it("la persistencia ida y vuelta no intercambia día y mes", () => {
    const stored = parseDisplayDate("30/09/2026");
    expect(stored).toBe("2026-09-30");
    expect(formatDateForDisplay(stored)).toBe("30/09/2026");
  });

  it("interpreta lo que escribe el usuario como DD/MM/AAAA", () => {
    expect(parseDisplayDate("05/10/2026")).toBe("2026-10-05"); // 5 de octubre, no 10 de mayo
    expect(parseDisplayDate("5/1/2026")).toBe("2026-01-05");
    expect(parseDisplayDate("30-09-2026")).toBe("2026-09-30");
    expect(parseDisplayDate("09/30/2026")).toBeNull(); // mes 30 no existe
    expect(parseDisplayDate("31/02/2026")).toBeNull();
    expect(parseDisplayDate("20260429")).toBeNull(); // AAAAMMDD solo en el pago de impuestos
    expect(parseDisplayDate("")).toBeNull();
  });

  it("fecha textual en español", () => {
    expect(formatDateText("2026-09-30")).toBe("30 de septiembre de 2026");
  });

  it("vacío y texto no reconocido", () => {
    expect(formatDateForDisplay(undefined)).toBe("—");
    expect(formatDateForDisplay("")).toBe("—");
    expect(formatDateForDisplay("04-08-2026")).toBe("04-08-2026"); // ya viene día primero (extracto)
  });
});

describe("excepción: fecha de pago de impuestos (AAAAMMDD)", () => {
  it("8 dígitos se leen siempre como AAAAMMDD", () => {
    expect(parseTaxPaymentDate("20260429")).toBe("2026-04-29");
    expect(formatDateForDisplay(parseTaxPaymentDate("20260429"))).toBe("29/04/2026");
    expect(formatDateForDisplay(parseTaxPaymentDate("20261015"))).toBe("15/10/2026");
    expect(formatDateForDisplay(parseTaxPaymentDate("20260101"))).toBe("01/01/2026");
    expect(formatDateForDisplay(parseTaxPaymentDate("20261231"))).toBe("31/12/2026");
    expect(parseTaxPaymentDate(" 20260429 ")).toBe("2026-04-29"); // pegado con espacios
  });

  it("también acepta DD/MM/AAAA", () => {
    expect(parseTaxPaymentDate("15/10/2026")).toBe("2026-10-15");
    expect(parseTaxPaymentDate("29/04/2026")).toBe("2026-04-29");
  });

  it("rechaza fechas inexistentes", () => {
    expect(parseTaxPaymentDate("20261301")).toBeNull();
    expect(parseTaxPaymentDate("20260230")).toBeNull();
    expect(parseTaxPaymentDate("2026042")).toBeNull();
  });
});
