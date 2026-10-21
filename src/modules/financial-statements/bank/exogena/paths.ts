import { bankAnalysisModule } from "../../../bank-analysis";
import { normalizeKey } from "../../../../utils/text";

/** Extractos bancarios dentro de Estados Financieros y su pantalla de cobertura y Exógena. */
export const BANKS_PATH = "/herramientas/estados-financieros/extractos-bancarios";
export const BANK_EXO_PROVIDER_ID = "cobertura-exogena";
export const BANK_EXO_PATH = `${BANKS_PATH}/${BANK_EXO_PROVIDER_ID}`;

/** Lo que abre un pendiente: la ficha de un banco, un banco con su cobertura o el mes exacto de una cuenta. */
export type BankExoFocus =
  | { kind: "profile"; bank: string }
  | { kind: "bank"; companyId: number; year: number; bank: string }
  | { kind: "month"; companyId: number; year: number; bank: string; account: string; month: string };

const SEP = "~";
const enc = (v: string | number) => encodeURIComponent(String(v));

/** Ruta que abre exactamente ese banco, cuenta y mes en «Cobertura y Exógena». */
export function bankExoPath(focus?: BankExoFocus): string {
  if (!focus) return BANK_EXO_PATH;
  const parts =
    focus.kind === "profile" ? ["ficha", focus.bank] : focus.kind === "bank" ? ["banco", focus.companyId, focus.year, focus.bank] : ["mes", focus.companyId, focus.year, focus.bank, focus.account, focus.month];
  return `${BANK_EXO_PATH}/${parts.map(enc).join(SEP)}`;
}

export function parseBankExoFocus(segment: string | undefined): BankExoFocus | null {
  if (!segment) return null;
  const parts = segment.split(SEP).map(decodeURIComponent);
  const num = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
  if (parts[0] === "ficha" && parts[1]) return { kind: "profile", bank: parts[1] };
  if (parts[0] === "banco" && parts[3]) {
    const companyId = num(parts[1]);
    const year = num(parts[2]);
    return companyId && year ? { kind: "bank", companyId, year, bank: parts[3] } : null;
  }
  if (parts[0] === "mes" && parts[3] && /^\d{4}-\d{2}$/.test(parts[5] ?? "")) {
    const companyId = num(parts[1]);
    const year = num(parts[2]);
    return companyId && year ? { kind: "month", companyId, year, bank: parts[3], account: parts[4] ?? "", month: parts[5] } : null;
  }
  return null;
}

/** Pantalla de importación del extracto de ese banco (la de su lector); sin lector propio, la lista de bancos. */
export function bankImportPath(bank: string): string {
  const key = normalizeKey(bank);
  const provider = bankAnalysisModule.submodules.find((s) => normalizeKey(s.name) === key);
  return provider ? `${BANKS_PATH}/${provider.id}` : BANKS_PATH;
}
