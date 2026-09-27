# Actualizaciones sin perder datos

La app usa el actualizador oficial de Tauri 2 (`tauri-plugin-updater` + `tauri-plugin-process`). Flujo para el usuario:

```text
Abre la app → (5 s después, en segundo plano) consulta latest.json
→ aviso discreto "Nueva versión disponible" (instalada / nueva / Novedades)
→ Actualizar ahora → descarga con progreso → verifica la firma → reemplaza el .app
→ Reiniciar ahora → copia .sqlite automática → migraciones → "Novedades de la versión X"
```

También en **Configuración → Acerca de → Buscar actualizaciones**.

---

## 1. Por qué los datos no se pierden

| Qué | Dónde | ¿Lo toca una actualización? |
|---|---|---|
| Programa (React, Rust, recursos) | `/Applications/AMD Herramientas.app` | Sí, se reemplaza completo |
| Base de datos, logos, copias | `~/Library/Application Support/co.amdsoluciones.herramientas/` | **No** |

- La ruta se obtiene con `app.path().app_data_dir()` (nada escrito a mano) y depende del **identifier** `co.amdsoluciones.herramientas` de `tauri.conf.json`. **No cambies nunca el identifier**: la app buscaría sus datos en otra carpeta.
- La actualización no ejecuta lógica de desinstalación. No existe ningún código que borre la carpeta de datos.
- Si la descarga, la verificación de firma o la instalación fallan, el `.app` actual sigue intacto y se muestra: *"No se pudo instalar la actualización. Tu versión actual continuará funcionando normalmente…"*

Prueba automática del escenario "Empresa A, Empresa B, Concepto ICA, Concepto Retención → actualizar → siguen existiendo": `startup::tests::update_keeps_existing_data` (`cargo test`).

---

## 2. Claves de firma

El actualizador exige que cada paquete esté firmado. La app verifica la firma con la clave pública antes de instalar; un paquete manipulado se rechaza.

| Archivo | Tipo | ¿Se distribuye? | Dónde vive |
|---|---|---|---|
| `~/.tauri/amd-herramientas.key` | **Privada** (cifrada con contraseña) | **Nunca** | Solo en tu Mac + copia en tu gestor de contraseñas |
| Contraseña de esa clave | **Secreta** | **Nunca** | Gestor de contraseñas |
| `~/.tauri/amd-herramientas.key.pub` | Pública | Sí (va dentro de la app) | Copiada en `tauri.conf.json → plugins.updater.pubkey` |

- El par de claves que ya existía en `~/.tauri/` es el que está configurado. No se generó uno nuevo.
- **No subas al repositorio** la clave privada, su contraseña, ni archivos `.env` que las contengan (`.gitignore` ya excluye `*.key`, `.env*` y `release/`).
- La clave privada nunca pasa por React: solo la usa `tauri build` en tu equipo.
- **Si pierdes la clave privada o su contraseña**, las apps ya instaladas no aceptarán nuevas versiones: habría que reinstalar manualmente una versión con una clave nueva. Guarda una copia segura.

---

## 3. Infraestructura necesaria

Solo se necesita un lugar público donde alojar archivos estáticos. Está configurado para **GitHub Releases**:

```text
tauri.conf.json → plugins.updater.endpoints:
https://github.com/Villamil21/amd-herramientas/releases/latest/download/latest.json
```

1. Crea el repositorio `amd-herramientas` en GitHub (puede ser privado el código, pero **los releases deben ser descargables sin autenticación**; si el repositorio es privado, usa un repositorio público solo para releases o cambia el endpoint a otro servidor).
2. Si usas otro usuario o repositorio, cambia el endpoint en `tauri.conf.json` **antes** de distribuir la primera versión (las apps instaladas consultan la URL con la que fueron compiladas).

---

## 4. Publicar una versión nueva

```bash
npm run version:bump -- minor      # patch = correcciones · minor = módulos/funciones · major = cambios incompatibles
# edita las novedades en src/app/changelog.json
./scripts/release.sh               # pide la contraseña de la clave; corre pruebas; compila universal; firma
```

Queda en `release/vX.Y.Z/`:

- `AMD-Herramientas_X.Y.Z_universal.app.tar.gz` y `.sig` → paquete de actualización firmado
- `AMD-Herramientas_X.Y.Z_universal.dmg` → instalador para usuarios nuevos
- `latest.json` → manifiesto (versión, novedades, firma, URL)

Crea en GitHub un release con etiqueta **`vX.Y.Z`** (márcalo como *latest*) y sube esos cuatro archivos. Las apps instaladas lo detectarán en el próximo arranque.

La versión vive en un solo lugar: `package.json` (`tauri.conf.json` la lee con `"version": "../package.json"`; `version:bump` sincroniza `Cargo.toml`).

### Qué se puede automatizar después

- Un workflow de GitHub Actions (runner `macos-latest`) que ejecute `release.sh` al crear una etiqueta `v*`, con la clave y su contraseña como *secrets* (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) y suba los archivos con `gh release upload`.
- Firma de código y notarización de Apple: cuando tengas un Apple Developer ID, configura `bundle.macOS.signingIdentity` y las variables `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`. El actualizador es compatible sin cambios: su firma es independiente de la de Apple.

---

## 5. Migraciones de base de datos

Al arrancar (`src-tauri/src/startup.rs`):

```text
¿hay migraciones pendientes y la base ya tiene datos?
  → copia backups/database-before-<versión>-<fecha>.sqlite (se conservan las 5 más recientes)
→ cada migración en su propia transacción (BEGIN … COMMIT; si falla, ROLLBACK)
→ last_run_version = versión actual (si cambió, se muestra "Novedades")
```

Si una migración falla, la base queda exactamente como estaba, la app abre y muestra el problema con acceso a la carpeta de copias.

### Crear una migración

1. Nuevo archivo `src-tauri/migrations/002_descripcion.sql`.
2. Agregarlo al final de `MIGRATIONS` en `src-tauri/src/database/migrations.rs`.
3. `cargo test` (hay pruebas que rechazan `DROP TABLE` y `DELETE FROM` en migraciones).

Reglas:

- Nunca editar ni reordenar una migración ya publicada.
- Solo agregar: `CREATE TABLE`, `ALTER TABLE … ADD COLUMN` (con `DEFAULT` si es `NOT NULL`), `CREATE INDEX`.
- Para cambiar el tipo de una columna o quitarla (SQLite no lo permite directamente): crear tabla nueva → `INSERT INTO nueva SELECT … FROM vieja` → renombrar, todo en la misma migración, y revisarlo manualmente antes de publicar. Esto requiere una decisión consciente; la prueba automática lo bloqueará hasta que se ajuste.

---

## 6. Probar una actualización de punta a punta

1. `./scripts/release.sh` con la versión actual (p. ej. 1.0.0), instala el `.dmg` y crea Empresa A, Empresa B, Concepto ICA y Concepto Retención.
2. `npm run version:bump -- patch` (1.0.1), escribe novedades, `./scripts/release.sh`, publica el release.
3. Abre la app 1.0.0: aparece "Nueva versión disponible" → **Actualizar ahora** → **Reiniciar ahora**.
4. Verifica: versión 1.0.1 en Configuración, ventana de novedades, y los cuatro registros intactos.

---

## 7. Eliminar datos

No existe opción para borrar datos. Si se agrega en el futuro, debe ser una acción separada, explícita y con confirmación — nunca parte de una actualización.
