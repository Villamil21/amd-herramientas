import { describe, expect, it } from "vitest";
import { classifyStatus, fixedStatus, statusKey } from "./statuses";

describe("statusKey", () => {
  it("normaliza tildes, mayúsculas, guion bajo y espacios", () => {
    expect(statusKey("  Devolución ")).toBe("DEVOLUCION");
    expect(statusKey("devolución")).toBe(statusKey("DEVOLUCION"));
    expect(statusKey("GUIA_ANULADA")).toBe("GUIA ANULADA");
    expect(statusKey("GUÍA  ANULADA")).toBe("GUIA ANULADA");
    expect(statusKey("en   terminal destino")).toBe("EN TERMINAL DESTINO");
  });
});

describe("reglas fijas", () => {
  it("reconoce las variantes de cada estado fijo", () => {
    for (const s of ["GUIA_ANULADA", "GUIA ANULADA", "GUÍA ANULADA"]) expect(fixedStatus(statusKey(s))).toBe("void");
    for (const s of ["DEVOLUCION", "DEVOLUCIÓN"]) expect(fixedStatus(statusKey(s))).toBe("returned");
    for (const s of ["EN PROCESO DE INDEMNIZACION", "EN PROCESO INDEMNIZACION", "EN PROCESO DE INDEMNIZACIÓN", "INDEMNIZADA"]) {
      expect(fixedStatus(statusKey(s))).toBe("indemnity");
    }
    expect(fixedStatus("ENTREGADO")).toBe("delivered");
    expect(fixedStatus("CANCELADO")).toBe("cancelled");
    expect(fixedStatus("RECHAZADO")).toBe("rejected");
    expect(fixedStatus("EN TERMINAL DESTINO")).toBeUndefined();
  });

  it("una regla guardada no cambia la semántica de un estado fijo", () => {
    const rules = new Map([
      ["ENTREGADO", "claim" as const],
      ["EN REPARTO", "in_process" as const],
    ]);
    expect(classifyStatus("ENTREGADO", rules)).toBe("delivered");
    expect(classifyStatus("EN REPARTO", rules)).toBe("in_process");
    expect(classifyStatus("NUEVO ESTADO X", rules)).toBe("unclassified");
    expect(classifyStatus("", rules)).toBe("unclassified");
  });
});
