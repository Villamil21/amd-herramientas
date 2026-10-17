import { describe, expect, it } from "vitest";
import { diffVersions, summaryOf } from "./versions";
import { purchaseData, stored } from "./testkit";
import { fingerprintRow } from "./hash";
import type { CryptoRowInput } from "./types";

const input = (row: number, amount: number): CryptoRowInput => {
  const data = purchaseData({ amount, date: "2026-01-10", doc: "1", docType: "CC" });
  return { kind: "purchase", sheet: "Compras", rowNumber: row, fingerprint: fingerprintRow("purchase", data), data };
};
const current = (row: number, amount: number) => stored(1, "purchase", row, purchaseData({ amount, date: "2026-01-10", doc: "1", docType: "CC" }));

describe("comparación de una carga con su versión vigente", () => {
  it("cuenta filas agregadas, modificadas, sin cambios y eliminadas", () => {
    const diff = diffVersions([current(2, 100), current(3, 200), current(4, 300)], [input(2, 100), input(3, 250), input(5, 400)]);
    expect(summaryOf(diff)).toEqual({ added: 1, modified: 1, unchanged: 1, removed: 1 });
    expect(diff.modifiedRows[0].after.rowNumber).toBe(3);
    expect(diff.removedRows[0].rowNumber).toBe(4);
    expect(diff.addedRows[0].rowNumber).toBe(5);
  });

  it("una fila idéntica que cambia de posición no cuenta como cambio", () => {
    const diff = diffVersions([current(2, 100), current(3, 200)], [input(3, 100), input(4, 200)]);
    expect(summaryOf(diff)).toEqual({ added: 0, modified: 0, unchanged: 2, removed: 0 });
  });

  it("filas repetidas se comparan una a una", () => {
    const diff = diffVersions([current(2, 100), current(3, 100)], [input(2, 100)]);
    expect(summaryOf(diff)).toEqual({ added: 0, modified: 0, unchanged: 1, removed: 1 });
  });
});
