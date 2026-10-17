import { describe, expect, it } from "vitest";
import type { ParsedPurchase } from "../../../types/purchases";
import { planFolder, toDocInput, uploadFor, type ReadResult } from "./import";

const parsed = (buyerNit: string | undefined, number: string, date = "2025-03-10"): ParsedPurchase => ({
  pageCount: 1,
  title: "FACTURA ELECTRÓNICA DE VENTA",
  number,
  issueDate: date,
  issuer: { nit: "900111222", name: "PROVEEDOR SAS", personType: "PJ", fiscalCodes: ["O-13"] },
  buyerNit,
  buyerName: "EMPRESA",
  lines: [{ index: 0, page: 1, code: "A", description: "Producto", unit: "UN", baseCents: 1000, vatCents: 190 }],
  subtotalCents: 1000,
  vatCents: 190,
  totalCents: 1190,
});
const ok = (name: string, data: ParsedPurchase): ReadResult => ({ fileName: name, kind: "parsed", data });

describe("planFolder", () => {
  it("la empresa es el NIT más frecuente; los demás son excepciones y los ilegibles se informan", () => {
    const plan = planFolder([ok("a.pdf", parsed("901", "F1")), ok("b.pdf", parsed("901", "F2", "2026-01-02")), ok("c.pdf", parsed("902", "F3")), ok("d.pdf", parsed(undefined, "F4")), { fileName: "e.pdf", kind: "error", message: "dañado" }]);
    expect(plan.dominantNit).toBe("901");
    expect(plan.main.map((f) => f.numberKey)).toEqual(["F1", "F2"]);
    expect(plan.others).toHaveLength(1);
    expect(plan.others[0].buyerNit).toBe("902");
    expect(plan.noBuyer).toEqual([{ fileName: "d.pdf" }]);
    expect(plan.unreadable).toHaveLength(1);
  });

  it("el año sale de la fecha de expedición y la huella cambia si cambia el contenido", () => {
    const a = toDocInput("a.pdf", parsed("901", "F1", "2025-12-31"));
    expect(a.year).toBe(2025);
    const b = toDocInput("a.pdf", { ...parsed("901", "F1", "2025-12-31"), totalCents: 2000 });
    expect(a.fingerprint).not.toBe(b.fingerprint);
    expect(toDocInput("copy.pdf", parsed("901", "F1", "2025-12-31")).fingerprint).toBe(a.fingerprint);
  });

  it("la carga resume por año y la secundaria no arrastra las excepciones", () => {
    const plan = planFolder([ok("a.pdf", parsed("901", "F1")), ok("b.pdf", parsed("901", "F2", "2026-01-02")), ok("c.pdf", parsed("902", "F3"))]);
    const main = uploadFor("carpeta", "901", plan.main, plan, true);
    expect(main.summary.byScope).toEqual([{ buyerNit: "901", year: 2025, count: 1 }, { buyerNit: "901", year: 2026, count: 1 }]);
    expect(main.summary.exceptions).toEqual([{ fileName: "c.pdf", buyerNit: "902" }]);
    const other = uploadFor("carpeta", "902", plan.others[0].files, plan, false);
    expect(other.summary.exceptions).toBeUndefined();
  });
});
