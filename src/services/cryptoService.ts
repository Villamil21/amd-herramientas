import type { CryptoState, DecisionKind, Homologation, SaveUploadInput, SaveUploadOutcome } from "../modules/financial-statements/crypto/domain/types";
import { call } from "./tauri";

/** Transacciones Cripto → Reporte de operaciones: cargas de Excel, decisiones del usuario y homologaciones (todo en SQLite). */
export const cryptoService = {
  state: (companyId: number, year: number) => call<CryptoState>("get_crypto_state", { companyId, year }),
  /** Con el mismo nombre de archivo no crea otra carga: devuelve `exists` hasta que se confirme el reemplazo (`replace`). */
  save: (input: SaveUploadInput) => call<SaveUploadOutcome>("save_crypto_upload", { input }),
  setStatus: (uploadId: number, status: "active" | "retired") => call<void>("set_crypto_upload_status", { uploadId, status }),
  /** Meses AAAA-MM que cubre la carga; `null` vuelve al período derivado de Compras.Fecha. */
  setCoverage: (uploadId: number, months: string[] | null) => call<void>("set_crypto_upload_coverage", { uploadId, months }),
  decide: (companyId: number, year: number, kind: DecisionKind, key: string, value: string, fingerprint = "") => call<void>("set_crypto_decision", { companyId, year, kind, key, value, fingerprint }),
  undecide: (companyId: number, year: number, kind: DecisionKind, key: string) => call<void>("delete_crypto_decision", { companyId, year, kind, key }),
  homologations: () => call<Homologation[]>("list_crypto_homologations"),
  saveHomologation: (kind: Homologation["kind"], sourceKey: string, value: string) => call<void>("save_crypto_homologation", { kind, sourceKey, value }),
};
