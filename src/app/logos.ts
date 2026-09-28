/**
 * Logos de la carpeta Logos/ del proyecto (por ahora, logos de bancos).
 *
 * Vite incluye cada archivo en el build como recurso propio, así que la ruta
 * funciona igual en desarrollo, en el build y dentro del .app. Agregar un
 * banco en una versión nueva = poner su logo en Logos/ y declarar
 * `logo: "<Archivo>.png"` en el submódulo; no requiere nada más.
 *
 * Los logos son recursos de la aplicación: no se guardan en SQLite.
 */
const files = import.meta.glob("/Logos/*.{png,jpg,jpeg,svg,webp}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

const byFileName = new Map(Object.entries(files).map(([path, url]) => [path.slice("/Logos/".length), url]));

const warned = new Set<string>();

/** URL del logo por su nombre exacto de archivo, o undefined si no existe. */
export function logoUrl(fileName: string | undefined): string | undefined {
  if (!fileName) return undefined;
  const url = byFileName.get(fileName);
  if (!url) reportMissingLogo(fileName);
  return url;
}

/** Aviso discreto solo en desarrollo; al usuario no se le muestra nada roto. */
export function reportMissingLogo(fileName: string) {
  if (!import.meta.env.DEV || warned.has(fileName)) return;
  warned.add(fileName);
  console.warn(`[logos] No se encontró o no se pudo cargar Logos/${fileName}; se muestra solo el nombre.`);
}
