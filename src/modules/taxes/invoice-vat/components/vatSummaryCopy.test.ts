import { describe, expect, it } from "vitest";
import { invoicesTable, notesTable } from "./VatSummary";
import type { VatSummaryData } from "../types";

const amount = (baseCents: number, vatCents: number) => ({ baseCents, vatCents });

describe("Copiar tabla (IVA de compras)", () => {
  it("copia texto tabulado real: columnas con TAB, filas con salto de línea, sin «$» ni HTML", async () => {
    const { SUMMARY_CATEGORIES } = await import("../services/labels");
    // Resumen mínimo: cada categoría lee sus valores con c.value(invoices).
    const invoices = new Proxy({ documentCount: 2 } as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : amount(100000, 19000)) });
    const summary = { invoices, notes: { documentCount: 1, ...amount(5000050, 0) } } as unknown as VatSummaryData;
    const lines = invoicesTable(summary).split("\n");
    expect(lines[0].split("\t")).toEqual(["Categoría", "Base", "IVA"]);
    expect(lines).toHaveLength(SUMMARY_CATEGORIES.length + 2);
    expect(lines.every((l) => l.split("\t").length === 3)).toBe(true);
    expect(lines.join("")).not.toMatch(/[$<>|]/);
    expect(notesTable(summary).split("\n")[1].split("\t").slice(1)).toEqual(["50000,50", "0"]);
  });
});
