import { describe, expect, it } from "vitest";
import type { FsPucMapping } from "../../../types/fs";
import { buildMappingResolver } from "./pucGroups";

const map = (pucCode: string, lineId: number | null, excluded = false): FsPucMapping => ({ pucCode, lineId, excluded, updatedAt: "", origin: "manual" });

describe("resolución de clasificación por grupo de cuatro dígitos", () => {
  it("la decisión del grupo cubre todas las subcuentas, también las futuras", () => {
    const r = buildMappingResolver([map("2370", 6)]);
    expect(r.resolve("237005")).toMatchObject({ via: "family", mapping: { lineId: 6 } });
    expect(r.resolve("237099")?.mapping.lineId).toBe(6);
    expect(r.resolve("2380")).toBeUndefined();
  });

  it("subcuentas antiguas que coinciden se muestran como una sola clasificación del grupo", () => {
    const r = buildMappingResolver([map("237005", 6), map("237006", 6)]);
    expect(r.info("2370")).toMatchObject({ conflict: false, inferred: { lineId: 6 } });
    expect(r.resolve("237010")).toMatchObject({ via: "inferred", mapping: { lineId: 6 } });
    expect(r.resolve("237005")?.via).toBe("exact");
  });

  it("subcuentas distintas: conflicto, sin decisión inventada para las no clasificadas", () => {
    const r = buildMappingResolver([map("237005", 6), map("237006", 5), map("237010", null, true)]);
    const info = r.info("2370");
    expect(info.conflict).toBe(true);
    expect(info.options.map((o) => o.codes)).toEqual([["237005"], ["237006"], ["237010"]]);
    expect(r.resolve("237099")).toBeUndefined();
    expect(r.resolve("237005")?.mapping.lineId).toBe(6); // lo antiguo se respeta mientras no se resuelva
  });

  it("excluir y una línea son clasificaciones distintas", () => {
    expect(buildMappingResolver([map("7305", null, true), map("730505", 4)]).info("7305").conflict).toBe(true);
  });
});
