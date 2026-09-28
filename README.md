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
| `npm test` | Pruebas de cálculos (certificado de retención y análisis de extractos). |
| `BANCOLOMBIA_PDF="/ruta/extracto.pdf" npx vitest run realPdf` | Prueba el parser con extractos reales de Bancolombia (varios archivos separados por `:`). Los PDF no se guardan en el repositorio. |
| `COOPCENTRAL_PDF="/ruta/extracto.pdf" npx vitest run realPdf` | Igual, con extractos reales de Coopcentral. |
| `DAVIVIENDA_PDF="/ruta/extracto.pdf" npx vitest run realPdf` | Igual, con extractos reales de Davivienda. |
| `IRIS_BANK_PDF="/ruta/extracto.pdf" npx vitest run realPdf` | Igual, con extractos reales de Iris Bank. |
| `cd src-tauri && cargo test` | Pruebas de Rust: migraciones, backups, conservación de datos al actualizar, lectura de Excel. |
| `npm run app:build` | Compila `.app` y `.dmg` (requiere la clave de firma del actualizador; ver abajo). |
| `npm run version:bump -- minor` | Sube la versión (`patch` / `minor` / `major` / `X.Y.Z`). |
| `./scripts/release.sh` | Compila, firma y deja lista una versión para publicar. Lee la contraseña de la clave del Llavero de macOS (servicio `amd-herramientas-signing`; guardarla una vez con `security add-generic-password -a "$USER" -s amd-herramientas-signing -w`) o la pregunta. |

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
├── components/     Sistema de diseño (components/ui) y piezas compartidas (BankCard)
├── layouts/        Estructura: menú lateral + barra superior
├── pages/          Inicio, Herramientas, Empresas, Conceptos, Configuración
├── modules/
│   ├── bank-analysis/      Análisis de extractos bancarios
│   │   ├── shared/         pdf/ (texto con coordenadas y filas), agrupación, validación,
│   │   │                   resumen, exportación a Excel y componentes de resultados
│   │   ├── bancolombia/    parser/ del formato Bancolombia (+ pruebas) y su página
│   │   ├── coopcentral/    parser/, services/, components/ y página del formato Coopcentral
│   │   ├── davivienda/     parser/, services/ y página del formato Davivienda (modelo con signo de shared/)
│   │   └── iris-bank/      parser/, services/ y página del formato Iris Bank (modelo con signo de shared/)
│   ├── social-security/    (próximamente)
│   ├── certificates/
│   │   └── withholding/    Certificado de retención
│   │       ├── logic/      análisis del Excel, cálculos, modelo del certificado (+ pruebas)
│   │       ├── pdf/        geometría y generación del PDF
│   │       └── steps/      pasos del asistente
│   └── sales-orders/       (próximamente)
├── services/       Llamadas a Rust (empresas, conceptos, archivos, backup, actualizaciones)
├── hooks/  utils/  types/  styles/ (tokens.css = variables de diseño)
Logos/              Logos de bancos (Bancolombia.png …), incluidos en el build
src-tauri/
├── migrations/     001_initial.sql …
└── src/
    ├── commands/   Comandos expuestos al frontend
    ├── database/   Conexión, migraciones, repositorios
    ├── models/     Empresa, Concepto (+ validación)
    ├── services/   rutas, Excel (lectura y escritura), logos, backups, tiempo
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

## Análisis de extractos — Bancolombia

- Todo se procesa en el equipo con pdf.js (texto real del PDF, sin OCR ni servicios externos). El PDF no se copia ni se guarda.
- Las filas se reconstruyen por **coordenadas**: el PDF puede entregar el texto fila por fila o columna por columna. Las columnas se ubican con el encabezado `FECHA | DESCRIPCIÓN | SUCURSAL | DCTO. | VALOR | SALDO` de cada página.
- Se ignoran el RESUMEN, los datos de la cuenta, los encabezados repetidos, los pies de página y `FIN ESTADO DE CUENTA`.
- Importes con coma de miles y punto decimal (`-126,530.60`), manejados en centavos enteros.
- Agrupación **estricta** por descripción exacta + signo (solo se normalizan espacios). Positivos y negativos de una misma descripción son grupos distintos y nunca se netean.
- Controles: saldo anterior + valor = saldo de cada fila; total positivo = TOTAL ABONOS; total negativo = TOTAL CARGOS; saldo final = SALDO ACTUAL; suma de grupos = suma de movimientos. Si algo no cuadra se advierte y no se marca como validado; los datos no se alteran.
- Exporta a Excel (hojas Resumen y Movimientos) con el diálogo nativo.

## Análisis de extractos — Coopcentral

- Formato de dos columnas: **CREDITOS** (entra dinero) y **DEBITOS** (sale dinero). El tipo lo decide la columna que trae el valor, nunca el texto del concepto. No se usa el modelo `VALOR` con signo de Bancolombia: parser, agrupación, validación y exportación propios en `coopcentral/`.
- Columnas ubicadas con el encabezado de cada página: las de texto (CONCEPTO, DOCT, OFICINA, F.APLI, F.OPER, TRANS. ELECTRONICA) están alineadas a la izquierda bajo su título; los importes, a la derecha. El concepto es solo la columna CONCEPTO (`TRETN`, `AJUST`, números de voucher… son DOCT).
- `SALDO INICIAL` y `SALDO FINAL` no son movimientos: dan los saldos de apertura y cierre. El bloque `TOTALES DEL PERIODO` corta la tabla de cada página y solo se usa como control informativo.
- Agrupación estricta por concepto exacto + tipo; un concepto con créditos y débitos da dos grupos. Neto = total créditos − total débitos.
- Una fila con valor en CREDITOS y DEBITOS a la vez es una **anomalía**: no se clasifica ni se suma y se muestra para revisión. Una fila 0/0 que no es de saldo se reporta.
- Controles: saldo inicial + créditos − débitos = saldo final (obligatorio para validar), secuencia de saldos fila a fila, suma de grupos, y comparación informativa con el bloque de totales (Consignaciones + Notas Crédito + Intereses Recibidos; Retiros + Notas Débito + Retención + GMF).

## Análisis de extractos — Davivienda

- Columnas Fecha | Valor | Doc. | Clase de Movimiento | Oficina. El valor trae el signo al final (`$ 2,900,000.00+`, `$ 742,942.68-`), casi siempre como fragmento aparte; se une al importe. Un valor sin signo se reporta, nunca se supone.
- Columnas ubicadas con el encabezado de cada página: los títulos están centrados sobre columnas contiguas, así que midiendo dónde empieza la Clase se deducen los límites. La Oficina (letra más pequeña, misma fila) nunca entra en la Clase.
- Una línea sin fecha, valor ni documento justo debajo de un movimiento continúa su Clase (p. ej. `TRANSFERENCIA TERCEROS`) o su Oficina.
- Reutiliza el modelo con signo de `shared/` (agrupación por clase exacta + signo, resumen, tabla, detalle); validación y exportación propias.
- Controles: total positivo = Más Créditos; total negativo = Menos Débitos; Saldo Anterior + Más Créditos − Menos Débitos = Nuevo Saldo; Saldo Anterior + neto = Nuevo Saldo; suma de grupos = suma de movimientos.

## Análisis de extractos — Iris Bank

- Columnas DÍA | REFERENCIA | DESCRIPCIÓN | MOVIMIENTOS | SALDO. Día, Referencia y Descripción están alineados a la izquierda bajo su título; Movimientos y Saldo, a la derecha. Cada importe se asigna a la columna cuyo borde derecho está más cerca.
- MOVIMIENTOS trae el signo delante (`$ -2,223,606.00`, `$ 409,488,572.00`); el tipo sale siempre del signo, nunca del texto de la descripción.
- Las descripciones largas ocupan varias líneas **centradas verticalmente** en la fila: con dos líneas, una queda encima y otra debajo de la línea del día y el valor. Cada línea suelta se une a la fila más cercana si no hay un salto mayor que el interlineado; si no pertenece a ninguna fila dentro de la tabla, se reporta.
- El bloque de tasas (`PLAN ACTUAL | TASA E.A.`) y el pie `página N de M` no son movimientos. El avance de lectura se muestra por página («Página 18 de 69»).
- Reutiliza el modelo con signo de `shared/` (agrupación por descripción exacta + signo, resumen, tabla, detalle); validación y exportación propias. El logo `Logos/Iris.png` es el original recortado de sus márgenes transparentes y reducido (el original mide 7200×7200 px).
- Controles: total positivo = Total Abonos; total negativo = Total Cargos; Saldo Mes Anterior + Total Abonos − Total Cargos = Saldo Actual; Saldo Mes Anterior + neto = Saldo Actual; secuencia de saldos fila a fila; saldo del último movimiento = Saldo Actual; suma de grupos = suma de movimientos.

**Agregar un banco:** poner su logo en `Logos/` con el nombre exacto (ej. `Davivienda.png`), declarar `logo: "Davivienda.png"` y el `component` en el submódulo de `src/modules/bank-analysis/index.ts`, y escribir su parser en `src/modules/bank-analysis/<banco>/`. Si el extracto usa una columna VALOR con signo, produce un `ParsedStatement` y reutiliza agrupación, validación, resumen, interfaz y exportación de `shared/`. Si usa columnas separadas de créditos y débitos, sigue el modelo de `coopcentral/`. En ambos casos se comparten el flujo de importación (`useStatementImport`), la tarjeta del archivo, la lectura del PDF, los controles de tabla y el guardado del Excel.

---

Actualizaciones, claves y publicación: **[docs/ACTUALIZACIONES.md](docs/ACTUALIZACIONES.md)**.
