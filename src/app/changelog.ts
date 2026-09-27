/**
 * Novedades por versión (changelog.json). Se muestran en la app tras
 * actualizar y `npm run release:manifest` las usa como notas del manifiesto
 * de actualización. Agrega la entrada nueva AL INICIO antes de publicar.
 */
import entries from "./changelog.json";

export interface ChangelogEntry {
  version: string;
  date: string; // AAAA-MM-DD
  notes: string[];
}

export const CHANGELOG: ChangelogEntry[] = entries;

export function changelogFor(version: string) {
  return CHANGELOG.find((e) => e.version === version) ?? null;
}
