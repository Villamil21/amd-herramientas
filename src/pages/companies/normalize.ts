/**
 * Normalización de datos de empresas, representantes y accionistas.
 * Es la misma regla que aplica el backend (`src-tauri/src/models/normalize.rs`, con los mismos
 * casos de prueba): aquí solo sirve para que el formulario muestre lo que se va a guardar.
 */

const SEPARATORS = new Set([" ", ".", ",", "-", " "]);

const collapse = (value: string) => value.trim().split(/\s+/).filter(Boolean).join(" ");

/** Recorta, colapsa espacios y pasa a MAYÚSCULAS (con tildes y ñ). */
export const upperText = (value: string, max = Infinity) => collapse(value).toUpperCase().slice(0, max);

/** Quita espacios y separadores visuales (. , - espacio) que estén entre dos dígitos. */
export function stripDigitSeparators(value: string): string {
  const chars = [...value.trim()];
  let out = "";
  chars.forEach((ch, i) => {
    if (SEPARATORS.has(ch)) {
      const prevDigit = /\d$/.test(out);
      const next = chars.slice(i + 1).find((c) => !SEPARATORS.has(c));
      if (prevDigit && next !== undefined && /\d/.test(next)) return;
    }
    out += ch;
  });
  return collapse(out);
}

/** Documento de identidad: sin separadores entre dígitos y en mayúsculas (conserva el prefijo «CC»). */
export const normalizeDocument = (value: string, max = 60) => stripDigitSeparators(value).toUpperCase().slice(0, max);

/** Teléfono: sin espacios, puntos, guiones ni paréntesis; conserva un «+» inicial. */
export const normalizePhone = (value: string, max = 60) => value.trim().replace(/[ .\-() ]/g, "").toUpperCase().slice(0, max);

export const digitsOf = (value: string) => value.replace(/\D/g, "");

/** NIT y DV por separado. «900.123.456-7» con DV vacío → «900123456» y «7». */
export function splitNitAndDv(nit: string, dv: string): { nit: string; dv: string; error?: string } {
  const raw = nit.trim();
  const given = digitsOf(dv);
  const m = /^(.*\d.*)-\s*(\d)\s*$/.exec(raw);
  const body = m ? m[1] : raw;
  const inline = m ? m[2] : undefined;
  const clean = stripDigitSeparators(body);
  if (inline !== undefined && given && inline !== given) return { nit: clean, dv: given, error: "El NIT incluye un DV distinto al del campo DV." };
  return { nit: clean, dv: inline && !given ? inline : given };
}

/** Compara nombres sin importar mayúsculas, tildes, espacios ni el orden de las palabras («PÉREZ GÓMEZ JUAN» = «Juan Pérez Gómez»). */
export function nameKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

/** ¿Es la misma persona? Por documento cuando ambos lo tienen; si no, por nombre. */
export function samePerson(a: { name: string; document: string }, b: { name: string; document: string }): boolean {
  const da = digitsOf(a.document);
  const db = digitsOf(b.document);
  if (da && db) return da === db;
  return nameKey(a.name) !== "" && nameKey(a.name) === nameKey(b.name);
}

/** Valor total del capital: acciones × valor nominal (nunca se guarda por separado). */
export const capitalTotal = (shares: number | null, nominal: number | null) => (shares && nominal ? shares * nominal : null);

/** Suma de porcentajes en milésimas de punto, sin acumular errores de coma flotante. */
export const totalPercent = (list: { percentage: number }[]) => list.reduce((sum, s) => sum + Math.round((s.percentage || 0) * 1000), 0) / 1000;

export const sumsTo100 = (list: { percentage: number }[]) => Math.abs(totalPercent(list) - 100) <= 0.0005;
