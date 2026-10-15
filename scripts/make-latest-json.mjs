#!/usr/bin/env node
/**
 * Genera release/v<versión>/ con:
 *   - AMD-Herramientas_<versión>_aarch64.app.tar.gz (+ .sig)  → paquete de actualización (solo Apple Silicon)
 *   - AMD-Herramientas_<versión>_aarch64.dmg                  → instalador para usuarios nuevos
 *   - latest.json                                               → manifiesto que consulta la app
 *
 * Subir TODOS esos archivos al release de GitHub con etiqueta v<versión>.
 * Variable opcional RELEASE_BASE_URL para usar otro servidor.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const changelog = JSON.parse(readFileSync(join(root, "src", "app", "changelog.json"), "utf8"));
const version = pkg.version;

const bundleDirs = [
  join(root, "src-tauri", "target", "aarch64-apple-darwin", "release", "bundle"),
  join(root, "src-tauri", "target", "release", "bundle"),
];
const bundleDir = bundleDirs.find((d) => existsSync(join(d, "macos")));
if (!bundleDir) {
  console.error("No se encontró el bundle. Ejecuta primero scripts/release.sh (o tauri build).");
  process.exit(1);
}
const arch = bundleDir.includes("aarch64-apple-darwin") || process.arch === "arm64" ? "aarch64" : "x64";

const macos = join(bundleDir, "macos");
const tarball = readdirSync(macos).find((f) => f.endsWith(".app.tar.gz"));
if (!tarball || !existsSync(join(macos, `${tarball}.sig`))) {
  console.error("Falta el paquete firmado (.app.tar.gz y .sig). Revisa que TAURI_SIGNING_PRIVATE_KEY esté definida al compilar.");
  process.exit(1);
}

const outDir = join(root, "release", `v${version}`);
mkdirSync(outDir, { recursive: true });
const updateName = `AMD-Herramientas_${version}_${arch}.app.tar.gz`;
copyFileSync(join(macos, tarball), join(outDir, updateName));
const signature = readFileSync(join(macos, `${tarball}.sig`), "utf8").trim();
writeFileSync(join(outDir, `${updateName}.sig`), signature);

const dmgDir = join(bundleDir, "dmg");
const dmg = existsSync(dmgDir) ? readdirSync(dmgDir).find((f) => f.endsWith(".dmg") && f.includes(version)) : null;
if (dmg) copyFileSync(join(dmgDir, dmg), join(outDir, `AMD-Herramientas_${version}_${arch}.dmg`));

// https://github.com/OWNER/REPO/releases/latest/download/latest.json → .../releases/download/vX.Y.Z/
const endpoint = conf.plugins.updater.endpoints[0];
const baseUrl = (process.env.RELEASE_BASE_URL ?? endpoint.replace(/latest\/download\/latest\.json$/, `download/v${version}/`)).replace(/\/?$/, "/");

const entry = changelog.find((e) => e.version === version);
const platform = { signature, url: `${baseUrl}${updateName}` };
const platforms = arch === "aarch64" ? { "darwin-aarch64": platform } : { "darwin-x86_64": platform };

const manifest = {
  version,
  notes: entry ? entry.notes.map((n) => `• ${n}`).join("\n") : "",
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  platforms,
};
writeFileSync(join(outDir, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log(`Listo: ${outDir}`);
for (const f of readdirSync(outDir)) console.log(`  - ${f}`);
if (arch !== "aarch64") console.warn("Aviso: este build no es para Apple Silicon. Usa scripts/release.sh.");
