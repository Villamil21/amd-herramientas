import { describe, expect, it, vi } from "vitest";
import type { BatchInput } from "../../../types/fs";
import { runEeffSync, type EeffSyncApi } from "./eeffSyncRunner";

const built = { companyId: 1, source: "crypto_ops", dedupeKey: "crypto:2026", movements: [] } as unknown as BatchInput;
const api = (over: Partial<EeffSyncApi> = {}): EeffSyncApi => ({ send: vi.fn(async () => ({ kind: "sent" }) as never), void: vi.fn(async () => 1), markOutdated: vi.fn(async () => undefined), ...over });

describe("actualización del lote de Cripto en Estados Financieros", () => {
  it("reemplaza el lote con el cálculo vigente", async () => {
    const a = api();
    expect(await runEeffSync("update", built, { id: 7 }, [], a)).toEqual({ kind: "updated" });
    expect(a.send).toHaveBeenCalledWith({ ...built, replace: true });
    expect(a.markOutdated).not.toHaveBeenCalled();
  });

  it("si el periodo está cerrado, el lote previo queda solo para auditoría: se marca desactualizado y no sigue vigente", async () => {
    const a = api({ send: vi.fn(async () => { throw new Error("El periodo cerrado de 2026-05 no se puede modificar."); }) });
    const result = await runEeffSync("update", built, { id: 7 }, [], a);
    expect(result).toMatchObject({ kind: "outdated" });
    expect(a.markOutdated).toHaveBeenCalledWith(7, expect.stringContaining("periodo cerrado"));
  });

  it("si no se puede calcular y el periodo está cerrado, igual se marca desactualizado", async () => {
    const a = api({ void: vi.fn(async () => { throw new Error("periodo cerrado"); }) });
    const result = await runEeffSync("retire", null, { id: 7 }, ["Falta la cuenta PUC de Ingresos para terceros"], a);
    expect(result).toMatchObject({ kind: "outdated" });
    expect(a.markOutdated).toHaveBeenCalledWith(7, expect.stringContaining("Falta la cuenta PUC de Ingresos para terceros"));
  });

  it("sin pendientes que lo impidan, retirar anula el lote", async () => {
    const a = api();
    expect(await runEeffSync("retire", null, { id: 7 }, ["x"], a)).toEqual({ kind: "retired" });
    expect(a.markOutdated).not.toHaveBeenCalled();
  });
});
