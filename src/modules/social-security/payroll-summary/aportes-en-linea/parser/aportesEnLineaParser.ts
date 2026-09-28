/**
 * Parser de la «Planilla Resumen» de Aportes en Línea (PDF).
 *
 * Estructura del PDF (analizada sobre planillas reales de 1 y 2 páginas). Las
 * secciones se localizan por su título, nunca por número de página: todas
 * pueden estar en la misma página o repartidas en varias.
 *
 * - DATOS GENERALES DE LA LIQUIDACION (en cada página): tres filas.
 *     Periodo | Clave | Tipo | Fecha        | Pago
 *     Pensión Salud | Pago | Planilla | Planilla | Limite Pago | Banco Dias Mora Valor
 *     2026-01 2026-02 | …  | …        | …        | 2026/02/19 2026/02/26 | NEQUI 7 $1,684,000
 *   Cada subtítulo se asocia al título de arriba más cercano (hay dos «Pago»:
 *   el de Clave y el de Fecha) y cada valor al subtítulo más cercano; además
 *   se exige el formato esperado (AAAA-MM, AAAA/MM/DD, $importe).
 *
 * - LIQUIDACION DETALLADA DE APORTES: fila de secciones (EMPLEADO, NOVEDADES,
 *   PENSION, SALUD, CCF, RIESGOS, PARAFISCALES) y fila de columnas
 *   (No. Identificación Nombre … Codigo Días IBC Aporte ×4 … Total Aportes).
 *   Algunas planillas parten rótulos en celdas angostas («Codig» y debajo
 *   «o»): los pedazos de las líneas de abajo se unen al rótulo de encima
 *   cuando juntos forman un rótulo conocido.
 *   Las columnas de cada sección se toman del grupo «Codigo … Aporte» que
 *   queda debajo del título de esa sección, así Pensión, Salud, CCF y Riesgos
 *   nunca se confunden. Cada valor va a la columna cuyo encabezado empieza a
 *   su izquierda más cerca (los importes están alineados a la derecha y
 *   pueden empezar antes que su encabezado, por eso se usa el centro).
 *   Un empleado empieza en la fila con el número de la columna No.; el nombre
 *   continúa en líneas de abajo que solo tienen texto en la zona del nombre
 *   o el final de un código partido («23030» / «1», «EPS03» / «7»).
 *   La tabla termina en «Total Afiliados(n)», que trae los totales.
 *
 * - RESUMEN DE PAGO: subtotales por riesgo (AFP, ARL, CCF,
 *   EPS) y fila TOTAL con VALOR LIQUIDADO, INTERESES MORA y VALOR A PAGAR.
 *   Solo se usa para validar; nunca se toma como empleado.
 *
 * Todo ocurre en memoria, en el equipo.
 */
import { StatementError } from "../../../../bank-analysis/shared/types";
import { center, joinWords, splitWords, type Word } from "../../../../bank-analysis/shared/pdf/rows";
import type { PdfDocumentText, PdfPageText, PdfTextItem } from "../../../../bank-analysis/shared/pdf/pdfTypes";
import { isPesoAmount, parsePesoAmount } from "../../shared/money";
import type { PaymentSummary, PayrollDetailTotals, PayrollEmployee, PayrollIssue, PayrollSummary } from "../../shared/types";

export const MESSAGES = {
  format: "El archivo no coincide con el formato de Aportes en Línea soportado.",
  detail: "No fue posible identificar la tabla de liquidación detallada.",
  detailRows: "Se encontró la tabla de liquidación, pero no fue posible reconstruir las filas de empleados.",
  noEmployees: "No se encontraron empleados en la planilla.",
  payment: "No fue posible identificar el valor pagado.",
  period: "No fue posible identificar el periodo de pensión de la planilla.",
  paymentDate: "No fue posible identificar la fecha de pago de la planilla.",
  total: "No fue posible identificar el total de aportes de la planilla (fila Total Afiliados).",
};

/** Mayúsculas, sin tildes y con espacios simples, para comparar rótulos. */
export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

/** Registro de desarrollo (consola del modo dev); nunca se muestra en la interfaz. */
const devLog = (...args: unknown[]) => {
  if (import.meta.env?.DEV && import.meta.env.MODE !== "test") console.debug("[aportes-en-linea]", ...args);
};

// ---------------------------------------------------------------------------
// Filas visuales
// ---------------------------------------------------------------------------

/** Un fragmento de texto del PDF tal cual (ej. "Dias Mora", "$280,200 EPS010"). */
interface Cell {
  item: PdfTextItem;
  key: string;
  x: number;
  right: number;
  center: number;
}

interface Row {
  y: number;
  cells: Cell[];
  words: Word[];
  text: string;
}

/** Agrupa los fragmentos por línea base, de arriba hacia abajo, sin depender del orden interno del PDF. */
function buildPageRows(page: PdfPageText): Row[] {
  const items = [...page.items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: { y: number; height: number; items: PdfTextItem[] }[] = [];
  for (const item of items) {
    const g = groups[groups.length - 1];
    const tolerance = Math.max(1.5, 0.35 * Math.max(item.height, g?.height ?? 0));
    if (g && Math.abs(g.y - item.y) <= tolerance) g.items.push(item);
    else groups.push({ y: item.y, height: item.height, items: [item] });
  }
  return groups.map((g) => {
    const cells = g.items
      .map((item) => ({ item, key: norm(item.text), x: item.x, right: item.x + item.width, center: item.x + item.width / 2 }))
      .sort((a, b) => a.x - b.x);
    const words = cells.flatMap((c) => splitWords(c.item)).sort((a, b) => a.x - b.x);
    return { y: g.y, cells, words, text: joinWords(words) };
  });
}

const isFooter = (row: Row) => /^PAGINA \d+ DE \d+/.test(norm(row.text));

const HEADINGS = {
  contributor: "DATOS GENERALES DEL APORTANTE",
  general: "DATOS GENERALES DE LA LIQUIDACION",
  detail: "LIQUIDACION DETALLADA DE APORTES",
  payment: "RESUMEN DE PAGO",
};
const compact = (s: string) => norm(s).replace(/ /g, "");

/**
 * Índice de la fila con el título de una sección, sin importar tildes,
 * espacios ni que el título quede partido en dos líneas seguidas.
 */
function findHeading(rows: Row[], heading: string, from = 0): number {
  const target = compact(heading);
  for (let i = from; i < rows.length; i++) {
    const text = compact(rows[i].text);
    if (text.includes(target)) return i;
    if (i + 1 < rows.length && target.startsWith(text) && text.length >= 6 && (text + compact(rows[i + 1].text)).includes(target)) return i;
  }
  return -1;
}

function nearest<T>(list: T[], x: number, pos: (t: T) => number): T | undefined {
  let best: T | undefined;
  for (const t of list) if (best === undefined || Math.abs(pos(t) - x) < Math.abs(pos(best) - x)) best = t;
  return best;
}

// ---------------------------------------------------------------------------
// Datos generales de la liquidación
// ---------------------------------------------------------------------------

interface GeneralData {
  period?: string;
  paymentDate?: string;
  paymentAmount?: number;
}

const PERIOD = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}\/\d{2}\/\d{2}$/;

function parseGeneralData(rows: Row[]): GeneralData | undefined {
  const title = findHeading(rows, HEADINGS.general);
  if (title < 0) return undefined;
  // Fila de títulos (Periodo … Fecha … Pago), subtítulos y valores, en ese orden.
  const top = rows.findIndex((r, i) => i > title && i <= title + 3 && ["PERIODO", "FECHA", "PAGO"].every((k) => r.cells.some((c) => c.key === k)));
  if (top < 0 || top + 2 >= rows.length) return {};
  const parents = rows[top].cells;
  const subs = rows[top + 1].cells.map((cell) => ({ cell, parent: nearest(parents, cell.center, (p) => p.center)?.key }));
  const values = rows[top + 2].words;

  /** Valor con el formato pedido cuyo subtítulo más cercano es «label» bajo el título «parent». */
  const read = (parent: string, label: string, valid: (text: string) => boolean): string | undefined => {
    const target = subs.find((s) => s.parent === parent && s.cell.key === label);
    if (!target) return undefined;
    const matches = values.filter((v) => valid(v.text) && nearest(subs, center(v), (s) => s.cell.center) === target);
    return matches.length === 1 ? matches[0].text : undefined;
  };

  const amount = read("PAGO", "VALOR", isPesoAmount);
  return {
    period: read("PERIODO", "PENSION", (t) => PERIOD.test(t)),
    paymentDate: read("FECHA", "PAGO", (t) => DATE.test(t)),
    paymentAmount: amount === undefined ? undefined : (parsePesoAmount(amount) ?? undefined),
  };
}

// ---------------------------------------------------------------------------
// Liquidación detallada de aportes
// ---------------------------------------------------------------------------

type Section = "PENSION" | "SALUD" | "CCF" | "RIESGOS" | "PARAFISCALES";
const SECTIONS: Section[] = ["PENSION", "SALUD", "CCF", "RIESGOS", "PARAFISCALES"];
const FIELD: Record<string, string> = { CODIGO: "codigo", DIAS: "dias", IBC: "ibc", APORTE: "aporte" };

interface Column {
  key: string;
  left: number;
}

interface DetailLayout {
  /** Inicio del encabezado «Identificación»: lo que queda a su izquierda es la columna No. */
  identificationLeft: number;
  /** Inicio de las NOVEDADES: el nombre termina antes. */
  noveltyLeft: number;
  /** Inicio de la sección PENSION: desde aquí todo son columnas de valores. */
  dataLeft: number;
  columns: Column[];
}

const REQUIRED_COLUMNS = ["PENSION.dias", "PENSION.ibc", "PENSION.aporte", "SALUD.aporte", "CCF.aporte", "RIESGOS.aporte", "total"];

/** Rótulos de la fila de columnas; sirven para reconocer rótulos partidos. */
const LABELS = new Set(["NO", "NO.", "IDENTIFICACION", "NOMBRE", "CODIGO", "DIAS", "IBC", "APORTE", "TARIFA", "EXONERADO", "TOTAL", "APORTES"]);

/** No exige «Codigo»: en algunas planillas llega partido («Codig» + «o»). */
const isColumnHeader = (r: Row) => {
  const keys = new Set(r.words.map((w) => norm(w.text)));
  return keys.has("IDENTIFICACION") && keys.has("NOMBRE") && keys.has("APORTES");
};

/**
 * Palabras de la fila de columnas con los rótulos partidos ya unidos: un
 * pedazo de las dos líneas de abajo que cae dentro de un rótulo se le agrega
 * solo si juntos forman un rótulo conocido («Codig» + «o» → «Codigo»).
 */
function headerWords(rows: Row[], headerIndex: number): Word[] {
  const header = rows[headerIndex].words.map((w) => ({ ...w }));
  const lineHeight = Math.max(...header.map((w) => w.height));
  for (let i = headerIndex + 1; i < rows.length && rows[headerIndex].y - rows[i].y <= 2.2 * lineHeight; i++) {
    for (const piece of rows[i].words) {
      const c = center(piece);
      const target = header.find((w) => c >= w.x && c <= w.right && !LABELS.has(norm(w.text)) && LABELS.has(norm(w.text + piece.text)));
      if (target) target.text += piece.text;
    }
  }
  return header;
}

function buildLayout(rows: Row[], headerIndex: number): DetailLayout | undefined {
  const header = headerWords(rows, headerIndex);
  // Fila de secciones: la más cercana por encima de la de columnas.
  let titleRow: Row | undefined;
  for (let i = headerIndex - 1; i >= 0 && i >= headerIndex - 3; i--) {
    const keys = rows[i].words.map((w) => norm(w.text));
    if (["PENSION", "SALUD", "CCF", "RIESGOS"].every((k) => keys.includes(k))) {
      titleRow = rows[i];
      break;
    }
  }
  if (!titleRow) return undefined;
  const titles = titleRow.words.map((w) => ({ key: norm(w.text), center: center(w), x: w.x }));
  const sectionTitles = titles.filter((t) => (SECTIONS as string[]).includes(t.key));

  const identification = header.find((w) => norm(w.text) === "IDENTIFICACION");
  const name = header.find((w) => norm(w.text) === "NOMBRE");
  const firstCode = header.findIndex((w) => norm(w.text) === "CODIGO");
  if (!identification || !name || firstCode < 0) return undefined;

  const columns: Column[] = [];
  const push = (key: string, left: number) => {
    if (!columns.some((c) => c.key === key)) columns.push({ key, left });
  };
  for (let i = firstCode; i < header.length; i++) {
    const k = norm(header[i].text);
    if (k === "CODIGO") {
      // Grupo Codigo … Aporte: pertenece a la sección cuyo título queda encima del grupo.
      let j = i;
      while (j < header.length && norm(header[j].text) !== "APORTE") j++;
      if (j === header.length) return undefined;
      const group = header.slice(i, j + 1);
      const section = sectionTitles.find((t) => t.center >= group[0].x && t.center <= group[group.length - 1].right);
      if (!section) return undefined;
      for (const w of group) push(`${section.key}.${FIELD[norm(w.text)] ?? norm(w.text).toLowerCase()}`, w.x);
      i = j;
    } else if (k === "TOTAL" && norm(header[i + 1]?.text ?? "") === "APORTES") {
      push("total", header[i].x);
      i++;
    } else {
      // Columnas sueltas (parafiscales: Días, IBC, Aporte, Exonerado).
      const section = nearest(sectionTitles, center(header[i]), (t) => t.center);
      push(`${section?.key ?? "OTRA"}.${FIELD[k] ?? k.toLowerCase()}`, header[i].x);
    }
  }
  columns.sort((a, b) => a.left - b.left);
  if (!REQUIRED_COLUMNS.every((k) => columns.some((c) => c.key === k))) return undefined;
  const dataLeft = columns[0].left;

  // Las novedades (ing, ret, tde…) se rotulan en líneas debajo de la fila de columnas.
  const noveltyTitle = titles.find((t) => t.key === "NOVEDADES");
  let noveltyLeft = Infinity;
  for (let i = headerIndex; i < rows.length && i <= headerIndex + 3; i++) {
    for (const w of rows[i].words) if (w.x > name.right && w.right <= dataLeft && w.x < noveltyLeft) noveltyLeft = w.x;
  }
  if (!Number.isFinite(noveltyLeft)) noveltyLeft = noveltyTitle ? (name.right + noveltyTitle.x) / 2 : dataLeft;

  return { identificationLeft: identification.x, noveltyLeft, dataLeft, columns };
}

/** Columna de valores de una palabra (la de encabezado más cercano a su izquierda). */
function columnOf(w: Word, layout: DetailLayout): string | undefined {
  const c = center(w);
  if (c < layout.dataLeft) return undefined;
  let column = layout.columns[0];
  for (const col of layout.columns) if (col.left <= c) column = col;
  return column.key;
}

/** Palabras de la zona de valores agrupadas por columna. */
function byColumn(words: Word[], layout: DetailLayout): Map<string, Word[]> {
  const map = new Map<string, Word[]>();
  for (const w of words) {
    const key = columnOf(w, layout);
    if (key) map.set(key, [...(map.get(key) ?? []), w]);
  }
  return map;
}

const cellText = (cols: Map<string, Word[]>, key: string) => {
  const words = cols.get(key);
  return words?.length ? joinWords(words) : undefined;
};

const TOTAL_ROW = /^TOTAL AFILIADOS ?\( ?(\d+) ?\)/;
const DOC_TYPE = /^[A-Z]{1,3}$/;
const DOC_NUMBER = /^(?=.*\d)[A-Z0-9-]+$/;

interface RawEmployee {
  page: number;
  y: number;
  row: Row;
  nameLines: { y: number; words: Word[] }[];
}

interface DetailResult {
  /** Se encontró el título LIQUIDACION DETALLADA DE APORTES. */
  titleFound: boolean;
  /** Se reconstruyó la fila de columnas. */
  found: boolean;
  /** Filas que empiezan un empleado (con número en la columna No.). */
  detectedRows: number;
  employees: PayrollEmployee[];
  totals: PayrollDetailTotals;
  issues: PayrollIssue[];
  joinedNames: number;
}

function parseDetail(pages: { page: PdfPageText; rows: Row[] }[]): DetailResult {
  const result: DetailResult = { titleFound: false, found: false, detectedRows: 0, employees: [], totals: {}, issues: [], joinedNames: 0 };
  let finished = false;
  let layout: DetailLayout | undefined;

  for (const { page, rows } of pages) {
    if (finished) break;
    const title = findHeading(rows, HEADINGS.detail);
    if (title >= 0) result.titleFound = true;
    // La fila de columnas se busca en toda la página (puede repetirse sin título
    // en las páginas siguientes). Si la tabla continúa sin encabezado, se usa
    // la última distribución de columnas vista.
    const headerIndex = rows.findIndex((r, i) => i > title && isColumnHeader(r));
    let start: number;
    if (headerIndex >= 0) {
      const pageLayout = buildLayout(rows, headerIndex);
      if (!pageLayout) {
        devLog(`página ${page.pageNumber}: fila de columnas sin reconstruir`, rows[headerIndex].text);
        continue;
      }
      layout = pageLayout;
      start = headerIndex + 1;
    } else if (layout && result.found) {
      start = 0;
    } else continue;
    result.found = true;
    const current = layout;
    const issue = (text: string, reason: string) => result.issues.push({ page: page.pageNumber, text, reason });

    // Clasificar filas: inicio de empleado, línea de nombre, total o fin de tabla.
    // El nombre empieza en la línea de la fila y sigue hacia abajo, así que
    // cada línea suelta pertenece al último empleado visto.
    const raws: RawEmployee[] = [];
    for (let i = start; i < rows.length; i++) {
      const row = rows[i];
      if (isFooter(row) || findHeading([row], HEADINGS.payment) === 0) break;
      const total = TOTAL_ROW.exec(norm(row.text));
      if (total) {
        const cols = byColumn(row.words, current);
        const amount = (key: string) => {
          const t = cellText(cols, key);
          return t === undefined ? undefined : (parsePesoAmount(t) ?? undefined);
        };
        result.totals = {
          declaredEmployees: Number(total[1]),
          pensionIbc: amount("PENSION.ibc"),
          pensionContribution: amount("PENSION.aporte"),
          healthContribution: amount("SALUD.aporte"),
          ccfContribution: amount("CCF.aporte"),
          riskContribution: amount("RIESGOS.aporte"),
          totalContribution: amount("total"),
        };
        finished = true;
        break;
      }
      const first = row.words[0];
      if (first && /^\d+$/.test(first.text) && center(first) < current.identificationLeft) {
        raws.push({ page: page.pageNumber, y: row.y, row, nameLines: [] });
        continue;
      }
      // Filas antes del primer empleado: rótulos de novedades y parafiscales.
      if (raws.length === 0) continue;
      const last = raws[raws.length - 1];
      const nameWords = row.words.filter((w) => center(w) < current.noveltyLeft);
      if (nameWords.length) last.nameLines.push({ y: row.y, words: nameWords });
      // Final de un código partido en dos líneas («23030» / «1»): no es un valor nuevo.
      const lastCols = byColumn(last.row.words, current);
      const unexpected = row.words.filter((w) => {
        const key = columnOf(w, current);
        return key !== undefined && !(key.endsWith(".codigo") && lastCols.has(key));
      });
      if (unexpected.length) issue(row.text, "Texto inesperado entre las filas de empleados; no se asignó a ningún empleado.");
    }
    devLog(`página ${page.pageNumber}: ${raws.length} fila(s) de empleado detectadas`);

    // Interpretar cada empleado.
    result.detectedRows += raws.length;
    for (const raw of raws) {
      const employee = parseEmployee(raw, current, issue);
      if (employee) {
        if (raw.nameLines.length) result.joinedNames++;
        result.employees.push(employee);
      } else devLog("fila descartada", raw.row.text);
    }
  }
  return result;
}

function parseEmployee(raw: RawEmployee, layout: DetailLayout, issue: (text: string, reason: string) => void): PayrollEmployee | undefined {
  const { row } = raw;
  const left = row.words.filter((w) => center(w) < layout.noveltyLeft);
  const [no, docType, docNumber, ...firstNameWords] = left;
  if (!docType || !docNumber || !DOC_TYPE.test(docType.text) || !DOC_NUMBER.test(docNumber.text.toUpperCase())) {
    issue(row.text, "No se pudo leer el tipo y número de identificación.");
    return undefined;
  }
  // Líneas de nombre en orden visual (de arriba hacia abajo), incluida la de la fila.
  const lines = [{ y: row.y, words: firstNameWords }, ...raw.nameLines].sort((a, b) => b.y - a.y);
  const nameLeft = firstNameWords[0]?.x ?? docNumber.right;
  const stray = raw.nameLines.flatMap((l) => l.words).filter((w) => w.right <= nameLeft);
  if (stray.length) issue(joinWords(stray), "Texto en la columna de identificación que no corresponde a ningún empleado.");
  const name = lines
    .map((l) => joinWords(l.words.filter((w) => w.right > nameLeft)))
    .filter(Boolean)
    .join(" ");
  if (!name) {
    issue(row.text, "No se encontró el nombre del empleado.");
    return undefined;
  }

  const cols = byColumn(row.words, layout);
  const problems: string[] = [];
  /** Sección sin ningún dato = el empleado no aporta a ese sistema (0). */
  const sectionBlank = (section: Section) => ![...cols.keys()].some((k) => k.startsWith(`${section}.`));
  const money = (key: string, label: string): number => {
    const section = key.split(".")[0] as Section;
    const text = cellText(cols, key);
    if (text === undefined && sectionBlank(section)) return 0;
    const value = text === undefined ? null : parsePesoAmount(text);
    if (value === null) problems.push(`${label}: ${text === undefined ? "sin valor" : `«${text}» no es un importe válido`}`);
    return value ?? 0;
  };
  const daysText = cellText(cols, "PENSION.dias");
  let pensionDays = 0;
  if (daysText !== undefined || !sectionBlank("PENSION")) {
    if (daysText !== undefined && /^\d{1,2}$/.test(daysText) && Number(daysText) <= 31) pensionDays = Number(daysText);
    else problems.push(`Pensión Días: ${daysText === undefined ? "sin valor" : `«${daysText}» no es un número de días válido`}`);
  }

  const employee: PayrollEmployee = {
    rowNumber: Number(no.text),
    identification: `${docType.text} ${docNumber.text}`,
    name,
    pensionDays,
    pensionIbc: money("PENSION.ibc", "Pensión IBC"),
    pensionContribution: money("PENSION.aporte", "Pensión Aporte"),
    healthContribution: money("SALUD.aporte", "Salud Aporte"),
    ccfContribution: money("CCF.aporte", "CCF Aporte"),
    riskContribution: money("RIESGOS.aporte", "Riesgos Aporte"),
    totalContribution: 0,
    page: raw.page,
  };
  const total = cellText(cols, "total");
  const totalValue = total === undefined ? null : parsePesoAmount(total);
  if (totalValue === null) problems.push(`Total Aportes: ${total === undefined ? "sin valor" : `«${total}» no es un importe válido`}`);
  employee.totalContribution = totalValue ?? 0;
  const other = cellText(cols, "PARAFISCALES.aporte");
  if (other !== undefined) employee.otherContribution = parsePesoAmount(other) ?? undefined;

  if (problems.length) {
    issue(`${employee.identification} ${name}`, `No se pudo leer: ${problems.join("; ")}.`);
    return undefined;
  }
  return employee;
}

// ---------------------------------------------------------------------------
// Resumen de pago (validación)
// ---------------------------------------------------------------------------

const RISK_ROW = /^([A-Z]+) \(ADMINISTRADORAS/;

function parsePaymentSummary(rows: Row[]): PaymentSummary | undefined {
  const title = findHeading(rows, HEADINGS.payment);
  if (title < 0) return undefined;
  const header = rows.findIndex((r, i) => i > title && r.cells.some((c) => c.key === "VALOR LIQUIDADO") && r.cells.some((c) => c.key === "VALOR A PAGAR"));
  if (header < 0) return undefined;
  const headers = rows[header].cells;
  const summary: PaymentSummary = { liquidatedByRisk: {} };

  for (let i = header + 1; i < rows.length; i++) {
    const row = rows[i];
    if (isFooter(row)) break;
    const label = row.cells[0]?.key ?? "";
    const isTotal = label === "TOTAL";
    const risk = RISK_ROW.exec(label)?.[1];
    if (!isTotal && !risk) continue; // administradoras individuales y rótulos de varias líneas
    const values = new Map<string, number>();
    for (const w of row.words) {
      const value = parsePesoAmount(w.text);
      const column = nearest(headers, center(w), (h) => h.center)?.key;
      if (value !== null && column && !values.has(column)) values.set(column, value);
    }
    if (isTotal) {
      summary.liquidated = values.get("VALOR LIQUIDADO");
      summary.lateInterest = values.get("INTERESES MORA");
      summary.toPay = values.get("VALOR A PAGAR");
      break;
    }
    const liquidated = values.get("VALOR LIQUIDADO");
    if (risk && liquidated !== undefined) summary.liquidatedByRisk[risk] = liquidated;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Documento completo
// ---------------------------------------------------------------------------

export function parseAportesEnLinea(doc: PdfDocumentText): PayrollSummary {
  const pages = doc.pages.map((page) => ({ page, rows: buildPageRows(page) }));
  const has = (heading: string) => pages.some(({ rows }) => findHeading(rows, heading) >= 0);
  const sections = Object.fromEntries(Object.entries(HEADINGS).map(([k, heading]) => [k, has(heading)]));
  devLog(`${doc.pageCount} página(s); secciones:`, sections);
  if (!sections.general || (!sections.detail && !sections.contributor)) {
    throw new StatementError(MESSAGES.format);
  }

  let general: GeneralData = {};
  for (const { rows } of pages) {
    const found = parseGeneralData(rows);
    if (found) {
      general = found;
      break;
    }
  }

  const detail = parseDetail(pages);
  devLog(`filas detectadas: ${detail.detectedRows}; empleados reconstruidos: ${detail.employees.length}; descartadas: ${detail.detectedRows - detail.employees.length}; totales:`, detail.totals);
  if (!detail.found) throw new StatementError(detail.titleFound ? MESSAGES.detailRows : MESSAGES.detail);
  if (detail.employees.length === 0) {
    if (detail.detectedRows > 0) throw new StatementError(`${MESSAGES.detailRows} ${detail.issues[0]?.reason ?? ""}`.trim());
    throw new StatementError(detail.issues.length ? `${MESSAGES.noEmployees} ${detail.issues[0].reason}` : MESSAGES.noEmployees);
  }
  if (general.paymentAmount === undefined) throw new StatementError(MESSAGES.payment);
  if (!general.period) throw new StatementError(MESSAGES.period);
  if (!general.paymentDate) throw new StatementError(MESSAGES.paymentDate);
  const totalContributions = detail.totals.totalContribution;
  if (totalContributions === undefined) throw new StatementError(MESSAGES.total);

  let paymentSummary: PaymentSummary | undefined;
  for (const { rows } of pages) {
    paymentSummary = parsePaymentSummary(rows);
    if (paymentSummary) break;
  }
  devLog("datos generales:", general, "resumen de pago:", paymentSummary);

  return {
    provider: "aportes-en-linea",
    pageCount: doc.pageCount,
    period: general.period,
    paymentDate: general.paymentDate,
    paymentAmount: general.paymentAmount,
    totalContributions,
    lateInterest: general.paymentAmount - totalContributions,
    employeeCount: detail.employees.length,
    detectedRows: detail.detectedRows,
    employees: detail.employees,
    detailTotals: detail.totals,
    paymentSummary,
    issues: detail.issues,
    joinedNames: detail.joinedNames,
  };
}
