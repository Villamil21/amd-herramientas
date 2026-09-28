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
# Solo el .app (y el paquete firmado de actualización). El .dmg se crea aparte:
# el AppleScript que decora la ventana del instalador en Finder falla a veces
# (-10006) y haría fallar toda la compilación.
npx tauri build --target universal-apple-darwin --bundles app

echo "→ Instalador .dmg"
BUNDLE=src-tauri/target/universal-apple-darwin/release/bundle
VERSION="$(node -p "require('./package.json').version")"
APP="$BUNDLE/macos/AMD Herramientas.app"
DMG="$BUNDLE/dmg/AMD Herramientas_${VERSION}_universal.dmg"
mkdir -p "$BUNDLE/dmg"
rm -f "$DMG" "$BUNDLE"/dmg/rw.*.dmg
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
cp -R "$APP" "$STAGING/"
make_dmg() {
  "$BUNDLE/dmg/bundle_dmg.sh" --volname "AMD Herramientas" --volicon src-tauri/icons/icon.icns \
    --window-size 660 400 --icon "AMD Herramientas.app" 180 170 --app-drop-link 480 170 \
    --hide-extension "AMD Herramientas.app" "$@" "$DMG" "$STAGING" >/dev/null 2>&1
}
built=false
if [[ -x "$BUNDLE/dmg/bundle_dmg.sh" ]]; then
  for attempt in 1 2 3; do
    if make_dmg; then built=true; break; fi
    echo "  Finder no pudo decorar el instalador (intento $attempt de 3); reintentando…"
    rm -f "$DMG" "$BUNDLE"/dmg/rw.*.dmg
    sleep 2
  done
  if ! $built && make_dmg --skip-jenkins; then
    built=true
    echo "  Instalador creado sin la disposición de iconos de Finder."
  fi
fi
if ! $built; then
  # Sin el script de Tauri: imagen simple con la app y el acceso a Aplicaciones.
  ln -s /Applications "$STAGING/Applications"
  hdiutil create -quiet -volname "AMD Herramientas" -srcfolder "$STAGING" -ov -format UDZO "$DMG"
fi

echo "→ Manifiesto de actualización"
node scripts/make-latest-json.mjs
