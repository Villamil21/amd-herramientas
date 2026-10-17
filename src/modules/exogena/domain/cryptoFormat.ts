import type { CryptoModel } from "../../financial-statements/crypto/domain/model";
import type { CryptoProblem } from "../../financial-statements/crypto/domain/problems";
import { proposalsFor, type CryptoExoFormat } from "../../financial-statements/crypto/exogenaSync";
import type { ExoRecord, FormatStatus } from "../../../types/exogena";
import { pendingChanges, type PendingChange } from "./pending";
import { blocking, type Problem } from "./problems";

export const CRYPTO_FORMATS: CryptoExoFormat[] = ["1007", "1647"];

export const CRYPTO_PATH = "/herramientas/estados-financieros/transacciones-cripto/reporte-de-operaciones";

const toProblem = (p: CryptoProblem): Problem => ({ level: p.level, message: p.message, recordKey: p.recordKey, field: p.field, action: { label: "Resolver en Transacciones Cripto", path: CRYPTO_PATH } });

export interface CryptoFormatState {
  proposals: ReturnType<typeof proposalsFor>;
  changes: PendingChange[];
  problems: Problem[];
}

/**
 * Pendientes de 1007 / 1647 frente a lo guardado en Exógena: los del modelo (tipos de documento, ciudades, países, asignaciones,
 * duplicados, fechas…) más «desactualizado» cuando lo que Transacciones Cripto propone hoy difiere de lo sincronizado. Cualquier
 * cambio de origen (carga, duplicado, asignación, ciudad, corte…) se refleja en alguno de los dos.
 */
export function cryptoFormatState(model: CryptoModel, format: CryptoExoFormat, stored: ExoRecord[]): CryptoFormatState {
  const proposals = proposalsFor(model, format);
  const changes = pendingChanges(stored, proposals);
  const source = format === "1007" ? model.problems.f1007 : model.problems.f1647;
  const problems = source.map(toProblem);
  if (changes.length) problems.push({ level: "blocking", message: `${changes.length} ${changes.length === 1 ? "registro está desactualizado" : "registros están desactualizados"} frente a Transacciones Cripto: actualiza el formato.` });
  return { proposals, changes, problems };
}

/** Un formato «listo» se reabre (nunca se reescribe en silencio) en cuanto aparece cualquier pendiente bloqueante. */
export const shouldReopen = (status: FormatStatus, problems: Problem[]): boolean => status === "listo" && blocking(problems).length > 0;
