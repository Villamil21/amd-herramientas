import { docTypeFromPrefix } from "../../../exogena/domain/thirdParty";

export interface NameSplit {
  firstSurname: string;
  secondSurname: string;
  firstName: string;
  otherNames: string;
}

/** Partículas de apellidos y nombres compuestos («DE LA CRUZ», «DEL RIO»): con ellas la separación posicional no es segura. */
const PARTICLES = new Set(["DE", "DEL", "LA", "LAS", "LOS", "Y", "E", "SAN", "SANTA", "DA", "DI", "VAN", "VON", "MC", "MAC"]);

/**
 * Propuesta de separación del nombre completo de la planilla («APELLIDO APELLIDO NOMBRE NOMBRE…»): los dos primeros
 * términos son apellidos y el resto, nombres. `null` cuando no se puede separar con seguridad (menos de tres términos o
 * partículas de apellidos compuestos): queda pendiente y el usuario la escribe en la ficha. Es solo una propuesta.
 */
export function proposeNameSplit(fullName: string): NameSplit | null {
  const tokens = fullName.normalize("NFC").toUpperCase().split(/\s+/).filter(Boolean);
  if (tokens.length < 3 || tokens.some((t) => PARTICLES.has(t))) return null;
  return { firstSurname: tokens[0], secondSurname: tokens[1], firstName: tokens[2], otherNames: tokens.slice(3).join(" ") };
}

/** Tipo de documento de la planilla («CC», «CE», «PT»…) → código DIAN. `undefined` si no se reconoce (nunca se adivina). */
export function dianDocType(prefix: string): string | undefined {
  return prefix.toUpperCase() === "PT" ? "48" : docTypeFromPrefix(prefix);
}
