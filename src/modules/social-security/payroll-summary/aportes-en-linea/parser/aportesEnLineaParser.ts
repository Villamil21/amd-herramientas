/**
 * Parser de la «Planilla Resumen» de Aportes en Línea (PDF).
 *
 * Estructura del PDF (analizada sobre una planilla real de 2 páginas):
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
 *   Las columnas de cada sección se toman del grupo «Codigo … Aporte» que
 *   queda debajo del título de esa sección, así Pensión, Salud, CCF y Riesgos
 *   nunca se confunden. Cada valor va a la columna cuyo encabezado empieza a
 *   su izquierda más cerca (los importes están alineados a la derecha y
 *   pueden empezar antes que su encabezado, por eso se usa el centro).
 *   Un empleado empieza en la fila con el número de la columna No.; el nombre
 *   continúa en líneas de abajo que solo tienen texto en la zona del nombre.
 *   La tabla termina en «Total Afiliados(n)», que trae los totales.
 *
 * - RESUMEN DE PAGO (segunda página): subtotales por riesgo (AFP, ARL, CCF,
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
  const title = rows.findIndex((r) => r.cells.some((c) => c.key === "DATOS GENERALES DE LA LIQUIDACION"));
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

const isColumnHeader = (r: Row) => {
  const keys = new Set(r.words.map((w) => norm(w.text)));
  return keys.has("IDENTIFICACION") && keys.has("NOMBRE") && keys.has("CODIGO") && keys.has("APORTES");
};

function buildLayout(rows: Row[], headerIndex: number): DetailLayout | undefined {
  const header = rows[headerIndex].words;
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

/** Palabras de la zona de valores agrupadas por columna. */
function byColumn(words: Word[], layout: DetailLayout): Map<string, Word[]> {
  const map = new Map<string, Word[]>();
  for (const w of words) {
    const c = center(w);
    if (c < layout.dataLeft) continue;
    let column = layout.columns[0];
    for (const col of layout.columns) if (col.left <= c) column = col;
    map.set(column.key, [...(map.get(column.key) ?? []), w]);
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
  found: boolean;
  employees: PayrollEmployee[];
  totals: PayrollDetailTotals;
  issues: PayrollIssue[];
  joinedNames: number;
}

function parseDetail(pages: { page: PdfPageText; rows: Row[] }[]): DetailResult {
  const result: DetailResult = { found: false, employees: [], totals: {}, issues: [], joinedNames: 0 };
  let finished = false;

  for (const { page, rows } of pages) {
    if (finished) break;
    const headerIndex = rows.findIndex(isColumnHeader);
    if (headerIndex < 0) continue;
    const layout = buildLayout(rows, headerIndex);
    if (!layout) continue;
    result.found = true;
    const issue = (text: string, reason: string) => result.issues.push({ page: page.pageNumber, text, reason });

    // Clasificar filas: inicio de empleado, línea de nombre, total o fin de tabla.
    // El nombre empieza en la línea de la fila y sigue hacia abajo, así que
    // cada línea suelta pertenece al último empleado visto.
    const raws: RawEmployee[] = [];
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (isFooter(row)) break;
      const total = TOTAL_ROW.exec(norm(row.text));
      if (total) {
        const cols = byColumn(row.words, layout);
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
      if (first && /^\d+$/.test(first.text) && center(first) < layout.identificationLeft) {
        raws.push({ page: page.pageNumber, y: row.y, row, nameLines: [] });
        continue;
      }
      // Filas antes del primer empleado: rótulos de novedades y parafiscales.
      if (raws.length === 0) continue;
      const nameWords = row.words.filter((w) => center(w) < layout.noveltyLeft);
      const dataWords = row.words.filter((w) => center(w) >= layout.dataLeft);
      if (nameWords.length) raws[raws.length - 1].nameLines.push({ y: row.y, words: nameWords });
      if (dataWords.length) issue(row.text, "Texto inesperado entre las filas de empleados; no se asignó a ningún empleado.");
    }

    // Interpretar cada empleado.
    for (const raw of raws) {
      const employee = parseEmployee(raw, layout, issue);
      if (employee) {
        if (raw.nameLines.length) result.joinedNames++;
        result.employees.push(employee);
      }
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
  const title = rows.findIndex((r) => r.cells.some((c) => c.key === "RESUMEN DE PAGO"));
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
  const has = (key: string) => pages.some(({ rows }) => rows.some((r) => r.cells.some((c) => c.key === key)));
  const detailTitle = has("LIQUIDACION DETALLADA DE APORTES");
  if (!has("DATOS GENERALES DE LA LIQUIDACION") || (!detailTitle && !has("DATOS GENERALES DEL APORTANTE"))) {
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
  if (!detail.found) throw new StatementError(MESSAGES.detail);
  if (detail.employees.length === 0) throw new StatementError(detail.issues.length ? `${MESSAGES.noEmployees} ${detail.issues[0].reason}` : MESSAGES.noEmployees);
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

  return {
    provider: "aportes-en-linea",
    pageCount: doc.pageCount,
    period: general.period,
    paymentDate: general.paymentDate,
    paymentAmount: general.paymentAmount,
    totalContributions,
    lateInterest: general.paymentAmount - totalContributions,
    employeeCount: detail.employees.length,
    employees: detail.employees,
    detailTotals: detail.totals,
    paymentSummary,
    issues: detail.issues,
    joinedNames: detail.joinedNames,
  };
}
