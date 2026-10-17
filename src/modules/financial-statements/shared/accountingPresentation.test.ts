import { describe, expect, it } from "vitest";
import { PRESENTATION_LABEL } from "../../../types/fs";
import { PRESENTATION_LABEL as CRYPTO_LABEL } from "../crypto/domain/types";
import { ACCOUNTING_LABEL, ACCOUNTING_PRESENTATIONS, engineView, isAccountingPresentation } from "./accountingPresentation";

describe("presentación contable única", () => {
  it("se llama igual en todas las pantallas: Bancos, no Banco", () => {
    expect(ACCOUNTING_LABEL).toEqual({ otc: "OTC", banks: "Bancos", dr: "DR" });
    expect(CRYPTO_LABEL).toBe(ACCOUNTING_LABEL);
    expect(PRESENTATION_LABEL.bank).toBe("Bancos");
    expect(ACCOUNTING_PRESENTATIONS.map((p) => ACCOUNTING_LABEL[p])).toEqual(["OTC", "Bancos", "DR"]);
  });

  it("el motor dibuja OTC condensado y Bancos/DR con las líneas de terceros", () => {
    expect([engineView("otc"), engineView("banks"), engineView("dr")]).toEqual(["otc", "bank", "bank"]);
    expect(isAccountingPresentation("banks")).toBe(true);
    expect(isAccountingPresentation("bank")).toBe(false);
  });
});
