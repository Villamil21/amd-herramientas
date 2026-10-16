import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaxParamsBar } from "./TaxParamsBar";

const render = (actions?: boolean) =>
  renderToStaticMarkup(
    <TaxParamsBar companies={[]} companyId={null} onCompany={() => {}} cut="2026-12-31" onCut={() => {}} actions={actions ? <button>Importar declaración</button> : undefined} />,
  );

describe("TaxParamsBar — Empresa y Fecha de corte alineadas", () => {
  it("ambos parámetros viven en la misma grilla y las acciones en una fila aparte", () => {
    const html = render(true);
    const grid = html.slice(html.indexOf("tax-params__grid"), html.indexOf("tax-params__actions"));
    expect(grid).toContain("Empresa");
    expect(grid).toContain("Fecha de corte");
    expect(grid).not.toContain("Importar declaración");
    expect(html.indexOf("tax-params__actions")).toBeGreaterThan(html.lastIndexOf("Fecha de corte"));
    expect(html).toContain("Importar declaración");
  });

  it("sin acciones no deja una fila vacía", () => {
    expect(render(false)).not.toContain("tax-params__actions");
  });
});
