import { describe, expect, it } from "vitest";
import type { Movement } from "../../../types/fs";
import { sortMovements } from "./sortMovements";

const mv = (id: number, date: string, extra: Partial<Movement>) => ({ id, accountingDate: date, source: "purchases", status: "active", pucCode: "513595", amountCents: 0, documentNumber: "", documentId: "", ...extra }) as Movement;

describe("orden de Movimientos contables", () => {
  const list = [mv(1, "2026-02-01", { amountCents: 500, pucCode: "110505", source: "bank" }), mv(2, "2026-01-15", { amountCents: -20, documentNumber: "FE10" }), mv(3, "2026-03-01", { amountCents: 90, documentNumber: "FE9", status: "replaced" })];
  it("por fecha, valor, PUC, documento, origen y estado, en ambas direcciones", () => {
    expect(sortMovements(list, "date", "asc").map((m) => m.id)).toEqual([2, 1, 3]);
    expect(sortMovements(list, "value", "desc").map((m) => m.id)).toEqual([1, 3, 2]);
    expect(sortMovements(list, "puc", "asc").map((m) => m.id)).toEqual([1, 2, 3]);
    expect(sortMovements(list, "document", "asc").map((m) => m.id)).toEqual([1, 3, 2]);
    expect(sortMovements(list, "source", "asc").map((m) => m.id)).toEqual([2, 3, 1]);
    expect(sortMovements(list, "status", "asc").map((m) => m.id)).toEqual([2, 1, 3]);
  });
});
