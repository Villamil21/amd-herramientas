import { describe, expect, it } from "vitest";
import { parseCentsInput, totalCheck } from "./totals";

describe("parseCentsInput", () => {
  it.each([
    ["22.175,67", 2_217_567],
    ["22175,67", 2_217_567],
    ["22175.67", 2_217_567],
    ["1.000.000", 100_000_000],
    ["1.000", 100_000],
    ["163900", 16_390_000],
    ["$ 5,5", 550],
  ])("%s", (t, cents) => expect(parseCentsInput(t)).toBe(cents));
  it("rechaza texto", () => expect(parseCentsInput("abc")).toBeUndefined());
});

describe("totalCheck", () => {
  it("compara con valores absolutos y sin Total Bruto no valida", () => {
    expect(totalCheck({ linesCents: -1000, grossCents: -1500 }).status).toBe("rounding");
    expect(totalCheck({ linesCents: 1000, grossCents: undefined }).status).toBe("none");
  });
});
