#!/usr/bin/env node
/**
 * Cambia la versión de la app en un solo paso.
 *   npm run version:bump -- patch | minor | major | 1.4.0
 *
 * Fuente única: package.json (tauri.conf.json la lee con "version": "../package.json").
 * Cargo.toml se sincroniza para que el binario Rust reporte lo mismo.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const cargoPath = join(root, "src-tauri", "Cargo.toml");
const changelogPath = join(root, "src", "app", "changelog.json");

const arg = process.argv[2];
if (!arg) {
  console.error("Uso: npm run version:bump -- patch | minor | major | X.Y.Z");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);
const next =
  arg === "patch" ? `${major}.${minor}.${patch + 1}`
  : arg === "minor" ? `${major}.${minor + 1}.0`
  : arg === "major" ? `${major + 1}.0.0`
  : arg;

if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`Versión no válida: ${next}. Usa MAJOR.MINOR.PATCH.`);
  process.exit(1);
}
const cmp = (a, b) => a.split(".").map(Number).reduce((r, n, i) => r || n - b.split(".").map(Number)[i], 0);
if (cmp(next, pkg.version) <= 0) {
  console.error(`La nueva versión (${next}) debe ser mayor que la actual (${pkg.version}); si no, el actualizador no la detecta.`);
  process.exit(1);
}

pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const cargo = readFileSync(cargoPath, "utf8").replace(/^version = ".*"$/m, `version = "${next}"`);
writeFileSync(cargoPath, cargo);

const changelog = JSON.parse(readFileSync(changelogPath, "utf8"));
if (!changelog.some((e) => e.version === next)) {
  const today = new Date().toISOString().slice(0, 10);
  changelog.unshift({ version: next, date: today, notes: ["(Describe aquí las novedades de esta versión)"] });
  writeFileSync(changelogPath, JSON.stringify(changelog, null, 2) + "\n");
}

console.log(`Versión actualizada a ${next}.`);
console.log(`Siguiente paso: edita las novedades en src/app/changelog.json y ejecuta scripts/release.sh`);
