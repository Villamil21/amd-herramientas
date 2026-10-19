import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cryptoCoverageCells } from "./coverageSource";
import { model, purchaseData, saleData, stored, upload } from "./domain/testkit";

/** Un archivo con compras aceptadas en los meses dados del año. */
function yearModel(year: number, months: number[], fileName = "a.xlsx", uploadId = 1) {
  const rows = [
    ...months.map((mo, i) => stored(uploadId, "purchase", i + 2, purchaseData({ amount: 1000 * mo, date: `${year}-${String(mo).padStart(2, "0")}-10`, docType: "NIT", doc: String(100 + mo), business: `E${mo}`, order: `${year}${mo}` }))),
    stored(uploadId, "sale", 2, saleData({ amount: 20000, docType: "NIT", doc: "800", business: "V" })),
  ];
  return model({ rows, uploads: [upload(uploadId, fileName, { rowCount: rows.length })], year });
}

const range = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

describe("Reporte de operaciones como fuente de cobertura", () => {
  it("marca solo los meses con operaciones cargadas", () => {
    const cells = cryptoCoverageCells(range(2026), new Map([[2026, yearModel(2026, [1, 2, 4])]]));
    expect(range(2026).filter((m) => cells[m].loaded)).toEqual(["2026-01", "2026-02", "2026-04"]);
    expect(cells["2026-03"]).toEqual({ loaded: false, files: [], pending: 0 });
    expect(cells["2026-01"].files).toEqual(["a.xlsx"]);
  });

  it("sin ningún reporte en el año todos los meses quedan sin cargar", () => {
    const cells = cryptoCoverageCells(range(2026), new Map());
    expect(Object.values(cells).every((c) => !c.loaded)).toBe(true);
    expect(Object.keys(cells)).toHaveLength(12);
  });

  it("un año con datos no cubre los meses de otro año", () => {
    const only2025 = new Map([[2025, yearModel(2025, [1, 2, 3])]]);
    const cells = cryptoCoverageCells(range(2026), only2025);
    expect(Object.values(cells).some((c) => c.loaded)).toBe(false);
    // Rango que cruza años: cada mes lee el modelo de su propio año.
    const mixed = cryptoCoverageCells(["2025-12", "2026-01", "2026-02"], new Map([[2025, yearModel(2025, [12])], [2026, yearModel(2026, [2])]]));
    expect([mixed["2025-12"].loaded, mixed["2026-01"].loaded, mixed["2026-02"].loaded]).toEqual([true, false, true]);
  });

  it("el cambio de empresa se refleja al entregar los modelos de la otra empresa", () => {
    const companyA = new Map([[2026, yearModel(2026, [1])]]);
    const companyB = new Map([[2026, yearModel(2026, [6], "b.xlsx", 7)]]);
    const a = cryptoCoverageCells(range(2026), companyA);
    const b = cryptoCoverageCells(range(2026), companyB);
    expect([a["2026-01"].loaded, a["2026-06"].loaded]).toEqual([true, false]);
    expect([b["2026-01"].loaded, b["2026-06"].loaded]).toEqual([false, true]);
    expect(b["2026-06"].files).toEqual(["b.xlsx"]);
  });

  it("un archivo retirado no cubre meses", () => {
    const rows = [stored(1, "purchase", 2, purchaseData({ amount: 1000, date: "2026-03-10", docType: "NIT", doc: "1", business: "E", order: "1" }))];
    const m = model({ rows, uploads: [upload(1, "a.xlsx", { status: "retired" })] });
    expect(cryptoCoverageCells(["2026-03"], new Map([[2026, m]]))["2026-03"].loaded).toBe(false);
  });
});

describe("clic en un mes de la fila", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    vi.resetModules();
    store.clear();
    vi.stubGlobal("window", { location: { hash: "" }, addEventListener: () => {} });
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("abre Reporte de operaciones con la misma empresa, año y mes", async () => {
    const sel = await import("./selection");
    sel.openCryptoMonth(42, "2025-03");
    expect(window.location.hash).toBe("#/herramientas/estados-financieros/transacciones-cripto/reporte-de-operaciones");
    expect(JSON.parse(store.get("crypto.selection")!)).toMatchObject({ companyId: 42, year: 2025 });
  });

  it("cambiar de mes reemplaza el filtro anterior", async () => {
    const sel = await import("./selection");
    let seen: string | null = null;
    const mod = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const Probe = () => ((seen = sel.useCryptoMonthFocus()[0]), mod.createElement("i"));
    sel.openCryptoMonth(1, "2026-01");
    renderToStaticMarkup(mod.createElement(Probe));
    expect(seen).toBe("2026-01");
    sel.openCryptoMonth(1, "2026-07");
    renderToStaticMarkup(mod.createElement(Probe));
    expect(seen).toBe("2026-07");
  });
});

describe("fila en la tabla de cobertura", () => {
  it("se muestra siempre, con ✓ solo en los meses cargados y — en el resto", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { CoverageTable } = await import("../generator/components");
    const months = ["2026-01", "2026-02", "2026-03"];
    const render = (cells: ReturnType<typeof cryptoCoverageCells>) =>
      renderToStaticMarkup(createElement(CoverageTable, { months, rows: [], companyName: "X", companyId: 5, cryptoOps: cells }));
    // Sin ningún reporte cargado: la fila sigue visible y todos los meses faltan.
    const empty = render(cryptoCoverageCells(months, new Map()));
    expect(empty).toContain("Reporte de operaciones");
    expect(empty.match(/Reporte de operaciones [^"]*: falta/g)).toHaveLength(3);
    // Enero y marzo cargados: febrero queda con —.
    const some = render(cryptoCoverageCells(months, new Map([[2026, yearModel(2026, [1, 3])]])));
    expect(some.match(/Reporte de operaciones [^"]*: cargado/g)).toHaveLength(2);
    expect(some).toMatch(/febrero de 2026: falta|Febrero 2026: falta/i);
    expect(some).toContain("Faltan: ");
  });
});
