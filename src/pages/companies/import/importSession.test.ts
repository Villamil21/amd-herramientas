import { describe, expect, it, vi } from "vitest";
import { createImportSession, discardFiles } from "./importSession";

describe("sesión de importación", () => {
  it("una lectura iniciada antes de un reinicio deja de ser vigente (borrador cerrado → empresa existente)", () => {
    const session = createImportSession();
    const token = session.current();
    expect(session.isCurrent(token)).toBe(true);
    session.next(); // cerrar sin guardar / abrir otra empresa
    expect(session.isCurrent(token)).toBe(false);
  });

  it("cambiar consecutivamente entre empresas solo deja vigente la última sesión", () => {
    const session = createImportSession();
    const tokens = [session.current(), session.next(), session.next()];
    expect(tokens.map((t) => session.isCurrent(t))).toEqual([false, false, true]);
  });
});

describe("descartar archivos sin guardar", () => {
  it("pide borrar únicamente los archivos del borrador, no los de empresas guardadas", async () => {
    const discard = vi.fn().mockResolvedValue(undefined);
    const saved = ["empresa-a-rut.pdf", "empresa-b-camara.pdf"];
    const draft = ["borrador-rut.pdf", "borrador-camara.pdf"];
    await discardFiles(draft, discard);
    expect(discard.mock.calls.map((c) => c[0])).toEqual(draft);
    for (const f of saved) expect(discard).not.toHaveBeenCalledWith(f);
  });

  it("un fallo al borrar un archivo no impide borrar los demás ni rompe el cierre", async () => {
    const discard = vi.fn().mockRejectedValueOnce(new Error("disco")).mockResolvedValue(undefined);
    await expect(discardFiles(["a.pdf", "b.pdf", "c.pdf"], discard)).resolves.toBeUndefined();
    expect(discard).toHaveBeenCalledTimes(3);
  });

  it("sin archivos pendientes no llama al backend (guardar una empresa nueva vacía su lista antes de cerrar)", async () => {
    const discard = vi.fn();
    await discardFiles([], discard);
    expect(discard).not.toHaveBeenCalled();
  });
});
