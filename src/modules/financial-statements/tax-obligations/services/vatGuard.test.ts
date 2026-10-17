import { describe, expect, it } from "vitest";
import { vatResponsibleIn } from "./vatGuard";

const h = (effectiveDate: string, responsible: boolean) => ({ effectiveDate, responsible });

describe("vatResponsibleIn (espeja el guard de Rust)", () => {
  it("sin historial no se sabe", () => expect(vatResponsibleIn([], "2025-01-01", "2025-02-28")).toBeUndefined());
  it("historial posterior al periodo tampoco permite saberlo", () => expect(vatResponsibleIn([h("2026-01-01", true)], "2025-01-01", "2025-02-28")).toBeUndefined());
  it("responsable al inicio", () => expect(vatResponsibleIn([h("2024-01-01", true)], "2025-01-01", "2025-02-28")).toBe(true));
  it("dejó de serlo antes del periodo", () => expect(vatResponsibleIn([h("2024-01-01", true), h("2024-12-01", false)], "2025-01-01", "2025-02-28")).toBe(false));
  it("pasó a serlo dentro del periodo", () => expect(vatResponsibleIn([h("2024-01-01", false), h("2025-02-01", true)], "2025-01-01", "2025-02-28")).toBe(true));
});
