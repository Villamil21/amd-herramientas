# AMD Herramientas

Aplicación de escritorio para macOS con herramientas administrativas y contables, organizada en módulos.

- **Tauri 2 + Rust**: backend nativo, SQLite, archivos, diálogos, backups.
- **React + TypeScript + Vite**: interfaz.
- **Solo macOS** (11 o superior; Apple Silicon e Intel).

Primer módulo funcional: **Certificados → Certificado de retención**.

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm install` | Instala dependencias (una vez). |
| `npm run app:dev` | Abre la app en modo desarrollo. |
| `npm test` | Pruebas de cálculos (casos 1–9 del requerimiento y el Excel de referencia). |
| `cd src-tauri && cargo test` | Pruebas de Rust: migraciones, backups, conservación de datos al actualizar, lectura de Excel. |
| `npm run app:build` | Compila `.app` y `.dmg` (requiere la clave de firma del actualizador; ver abajo). |
| `npm run version:bump -- minor` | Sube la versión (`patch` / `minor` / `major` / `X.Y.Z`). |
| `./scripts/release.sh` | Compila, firma y deja lista una versión para publicar. |

Compilación local sin firmar (solo para probar el instalador):

```bash
npx tauri build --bundles app,dmg --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Resultado en `src-tauri/target/release/bundle/`.

Si el paso del `.dmg` falla con `bundle_dmg.sh`, es la personalización de la ventana del DMG vía Finder (requiere permiso de Automatización para la terminal). Para omitirla: anteponer `CI=true` al comando.

> La app no está firmada con un certificado de Apple. La primera vez, macOS pide confirmar la apertura: clic derecho sobre la app → **Abrir**.

---

## Arquitectura

```text
React (presentación, validaciones inmediatas, cálculos puros)
   │  invoke()  ← único canal (src/services/*)
   ▼
Rust / Tauri (SQLite, archivos, diálogos nativos, validación final)
   ▼
~/Library/Application Support/co.amdsoluciones.herramientas/
   ├── database.sqlite
   ├── logos/        (archivos referenciados por nombre desde SQLite)
   └── backups/      (copias automáticas .sqlite, se conservan las últimas 5)
```

Decisiones:

- **React nunca envía rutas arbitrarias a Rust.** Los diálogos de abrir/guardar se abren desde Rust; el frontend no tiene permisos de `fs` ni `dialog` (ver `src-tauri/capabilities/default.json`). La única excepción es el Excel arrastrado sobre la ventana: Rust valida la extensión y el tamaño.
- **Excel**: `calamine` en Rust entrega las celdas con su tipo original (número, texto, fecha). La interpretación contable vive en TypeScript puro y probado (`src/modules/certificates/withholding/logic/`). Así no se empaqueta SheetJS en el frontend.
- **PDF**: jsPDF, cargado solo al generar. La vista previa y el PDF se construyen desde el mismo modelo (`certificateModel.ts`) y la misma geometría (`pdf/layout.ts`, hoja Carta como el PDF de referencia).
- **Dinero en centavos enteros** para evitar errores de coma flotante; el valor retenido se calcula con `BigInt` y se redondea al peso (37.731,96 → $ 37.732,00, igual que la referencia).
- **SQLite con migraciones incrementales** (`src-tauri/migrations/`), cada una en su transacción, con copia automática previa.

### Estructura

```text
src/
├── app/            App, enrutador (hash), registro de módulos, actualizador, changelog
├── components/     Sistema de diseño (components/ui) y piezas compartidas
├── layouts/        Estructura: menú lateral + barra superior
├── pages/          Inicio, Herramientas, Empresas, Conceptos, Configuración
├── modules/
│   ├── bank-analysis/      (próximamente)
│   ├── social-security/    (próximamente)
│   ├── certificates/
│   │   └── withholding/    Certificado de retención
│   │       ├── logic/      análisis del Excel, cálculos, modelo del certificado (+ pruebas)
│   │       ├── pdf/        geometría y generación del PDF
│   │       └── steps/      pasos del asistente
│   └── sales-orders/       (próximamente)
├── services/       Llamadas a Rust (empresas, conceptos, archivos, backup, actualizaciones)
├── hooks/  utils/  types/  styles/ (tokens.css = variables de diseño)
src-tauri/
├── migrations/     001_initial.sql …
└── src/
    ├── commands/   Comandos expuestos al frontend
    ├── database/   Conexión, migraciones, repositorios
    ├── models/     Empresa, Concepto (+ validación)
    ├── services/   rutas, Excel, logos, backups, tiempo
    └── startup.rs  Arranque: copia → migraciones → last_run_version
```

### Agregar un módulo

1. Crear `src/modules/<modulo>/index.ts` exportando un `ModuleDef` (nombre, ícono, submódulos).
2. Para cada submódulo funcional, indicar `component: lazy(() => import("./.../Pagina"))`.
3. Registrarlo en `src/app/modules.ts`.

La navegación, breadcrumbs y tarjetas se generan solos. Si el módulo necesita tablas nuevas, agregar una migración (ver `docs/ACTUALIZACIONES.md`).

---

## Diseño

Tomado de [AMD Soluciones](https://davinzifc.github.io/AMD-soluciones/): tinta `#0D141A`, dorado `#CFBB66`, Sora para títulos y DM Sans para texto (empaquetadas, sin internet), botones con radio de 8 px, primario dorado y secundario con borde. En escritorio, la navegación es oscura como la del sitio y el área de trabajo es clara para jornadas largas. Todas las variables están en `src/styles/tokens.css`.

Atajos: `⌘O` importar Excel (en el certificado), `⌘S` generar PDF (en la vista previa), `⌘,` configuración.

---

## Certificado de retención — reglas implementadas

- Columnas identificadas **por nombre del encabezado** (sin importar tildes, mayúsculas o posición). Si falta alguna, no se continúa.
- `Factura electrónica` suma y `Nota Crédito electrónica` resta. Cualquier otro tipo bloquea y muestra la fila.
- Base por fila = `Total − (IVA, ICA, IC, INC, Timbre, INC Bolsas, IN Carbono, IN Combustibles, IC Datos, ICL, INPP, IBUA, ICUI)`; vacío = 0.
- Todos los `NIT Emisor` deben coincidir; si no, se bloquea y se listan los NIT con sus filas.
- Valores en `Rete IVA / Rete Renta / Rete ICA` generan una alerta que exige confirmación explícita.
- Periodo: desde el día 1 del mes de la fecha mínima hasta la fecha máxima.
- Valor retenido: `% → base × tarifa / 100`, `‰ → base × tarifa / 1000`.
- Título según los tipos de los conceptos (ICA / Retención / Retención e ICA).
- Columna de tarifa: `TASA %`, `TASA ‰` o `TASA` con la unidad en cada fila si se mezclan, para que la presentación no sea engañosa.
- Base cero o negativa bloquea la generación.

Actualizaciones, claves y publicación: **[docs/ACTUALIZACIONES.md](docs/ACTUALIZACIONES.md)**.
