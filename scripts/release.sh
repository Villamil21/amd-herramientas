#!/usr/bin/env bash
# Compila, firma y prepara una nueva versión para publicar.
#
#   1. npm run version:bump -- minor        (o patch / major / X.Y.Z)
#   2. Edita src/app/changelog.json
#   3. ./scripts/release.sh
#   4. Sube el contenido de release/vX.Y.Z/ a un release de GitHub con etiqueta vX.Y.Z
#
# La clave PRIVADA se lee de fuera del proyecto y nunca se copia al repositorio.
set -euo pipefail
cd "$(dirname "$0")/.."

KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/amd-herramientas.key}"
if [[ ! -f "$KEY_PATH" ]]; then
  echo "No se encontró la clave privada en $KEY_PATH" >&2
  echo "Define TAURI_SIGNING_PRIVATE_KEY_PATH o genera una con: npx tauri signer generate -w ~/.tauri/amd-herramientas.key" >&2
  exit 1
fi
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD+x}" ]]; then
  read -rsp "Contraseña de la clave de firma: " TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  echo
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
fi

echo "→ Pruebas"
npm test
(cd src-tauri && cargo test --quiet)

# Un instalador ya abierto (/Volumes/AMD Herramientas) impide crear el .dmg nuevo con el mismo nombre.
for vol in /Volumes/AMD\ Herramientas*; do
  [[ -d "$vol" ]] || continue
  echo "→ Expulsando instalador montado: $vol"
  diskutil eject "$vol" >/dev/null
done
rm -f src-tauri/target/universal-apple-darwin/release/bundle/macos/rw.*.dmg

echo "→ Compilación universal (Apple Silicon + Intel)"
rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
npx tauri build --target universal-apple-darwin --bundles app,dmg

echo "→ Manifiesto de actualización"
node scripts/make-latest-json.mjs
