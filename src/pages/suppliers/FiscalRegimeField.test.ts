import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { exemptCodesIn, FiscalRegimeField, toggleCode } from "./FiscalRegimeField";

describe("régimen fiscal editable", () => {
  it("ofrece O-15 y O-47 junto a los demás regímenes y marca los activos", () => {
    const html = renderToStaticMarkup(createElement(FiscalRegimeField, { value: "O-13; O-47", onChange: () => {} }));
    for (const text of ["O-13", "O-15", "Autorretenedor", "O-23", "O-47", "Régimen simple de tributación", "R-99-PN"]) expect(html).toContain(text);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html).toContain("no se le calcula ni se le propone retención");
  });

  it("los botones agregan y quitan su código", () => {
    expect(toggleCode("O-13", "O-15")).toBe("O-13; O-15");
    expect(toggleCode("O-13; O-15", "O-15")).toBe("O-13");
    expect(toggleCode("", "O-47")).toBe("O-47");
  });

  it("identifica O-15 y O-47 y no otros", () => {
    expect(exemptCodesIn("o-15; O-23")).toEqual([{ code: "O-15", label: "Autorretenedor" }]);
    expect(exemptCodesIn("O-13;O-23")).toEqual([]);
  });
});
