import { describe, expect, it } from "vitest";
import { describeMonths } from "./money";

describe("describeMonths", () => {
  it("un mes, meses consecutivos, no consecutivos y cruce de año", () => {
    expect(describeMonths([])).toBe("");
    expect(describeMonths(["2026-01", "2026-01"])).toBe("Enero 2026");
    expect(describeMonths(["2026-03", "2026-01", "2026-02"])).toBe("Enero a marzo de 2026");
    expect(describeMonths(["2026-05", "2026-01", "2026-03"])).toBe("Enero, marzo y mayo de 2026");
    expect(describeMonths(["2026-01", "2025-12"])).toBe("Diciembre 2025 a enero 2026");
    expect(describeMonths(["2025-11", "2026-01"])).toBe("Noviembre 2025 y enero 2026");
  });
});
