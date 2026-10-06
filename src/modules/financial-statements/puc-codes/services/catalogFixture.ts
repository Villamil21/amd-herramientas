/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PucCode } from "../../../../types/models";

/**
 * Solo para pruebas: el catálogo real, leído de la migración que lo siembra
 * (la misma fuente que usa la app), para no mantener una copia aparte.
 */
export function loadSeededCatalog(): PucCode[] {
  const sql = readFileSync(fileURLToPath(new URL("../../../../../src-tauri/migrations/010_puc.sql", import.meta.url)), "utf8");
  const seed = sql.slice(sql.indexOf("INSERT OR IGNORE INTO puc_codes"));
  return [...seed.matchAll(/\('(\d+)', '((?:[^']|'')*)'\)/g)].map((m) => ({ code: m[1], concept: m[2].replace(/''/g, "'") }));
}
