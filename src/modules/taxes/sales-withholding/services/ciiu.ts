/**
 * Clave de comparación de un código CIIU: solo dígitos y, si tiene 4 o menos,
 * completado a 4 posiciones con ceros a la izquierda. La tabla del decreto trae
 * «111» y la empresa puede tener «0111»: ambos dan «0111». Otras longitudes se
 * conservan tal cual. Debe coincidir con `normalize_ciiu` de Rust.
 */
export function normalizeCiiu(code: string): string {
  const digits = code.replace(/\D/g, "");
  return digits && digits.length < 4 ? digits.padStart(4, "0") : digits;
}

/** Código escrito por el usuario: vacío o solo dígitos (hasta 6). */
export const isValidCiiuInput = (code: string) => /^\d{1,6}$/.test(code.trim());
