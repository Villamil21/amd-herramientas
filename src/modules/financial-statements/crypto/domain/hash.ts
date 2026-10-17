import type { RowData } from "./types";

/** Huella estable (cyrb53, 53 bits) de un texto: identifica el contenido de una fila, no es criptográfica. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Huella del contenido de una fila: independiente del orden de sus columnas y de su posición en el archivo. */
export function fingerprintRow(kind: string, data: RowData): string {
  const entries = Object.entries(data)
    .map(([k, v]) => [k.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim(), typeof v === "string" ? v.trim() : v] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return hashText(`${kind}|${JSON.stringify(entries)}`);
}
