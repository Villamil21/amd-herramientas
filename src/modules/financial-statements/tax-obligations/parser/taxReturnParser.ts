import type { PdfDocumentText, PdfTextItem } from "../../../bank-analysis/shared/pdf/pdfTypes";
import { normalizeKey } from "../../../../utils/text";
import type { TaxType, VatPeriodicity } from "../types";

/**
 * Lector de declaraciones DIAN (Formularios 350 Retención en la fuente, 300
 * IVA y 110 Renta) a partir del texto posicionado del PDF.
 *
 * Cada valor se localiza por el NOMBRE del concepto (nunca por una casilla o
 * coordenada fija) y se lee en la columna de valores de su misma fila. La
 * casilla impresa junto al valor solo se usa para validar la versión del
 * formulario: si no coincide con la esperada para ese año se avisa.
 *
 * Los formularios no traen el texto en orden: las etiquetas de dos líneas
 * quedan unos puntos por encima o por debajo de su valor, y las casillas a
 * veces no están como texto. Por eso:
 * - una «columna de valores» es un borde derecho donde se alinean los números
 *   con separador de miles o en cero (las casillas tienen otro borde);
 * - el valor de una etiqueta es el de su columna en la fila más cercana (±7 pt)
 *   y antes de la siguiente etiqueta de la misma fila (si la otra columna de la
 *   fila no tiene etiqueta, se toma la columna más próxima a la etiqueta).
 */

export type ValueKey =
  | "withholdingTotal"
  | "vatPayable"
  | "vatFavor"
  | "incomePayable"
  | "incomeFavor"
  | "incomeTaxBalance"
  | "incomeOrdinary"
  | "incomeLoss"
  | "incomeAdvanceNext";

export type EquityKey = "cash" | "investments" | "receivables" | "inventories" | "intangibles" | "biological" | "ppe" | "otherAssets" | "grossEquity" | "liabilities" | "netEquity";

export interface ReadValue {
  label: string;
  cents: number;
  /** Casilla impresa junto al valor (si está como texto). */
  casilla: string | null;
  /** Casilla esperada para esta versión del formulario (si se conoce). */
  expectedCasilla: string | null;
  /** «position»: la etiqueta no está como texto; se tomó la fila siguiente a la de un concepto conocido. */
  foundBy: "label" | "position";
}

export interface ParsedTaxReturn {
  taxType: TaxType;
  formCode: "350" | "300" | "110";
  year: number | null;
  /** «presentation»: el formulario no trae el año como texto; se dedujo de la fecha de presentación (año anterior). */
  yearSource: "form" | "presentation" | null;
  /** Fecha de presentación (AAAA-MM-DD). Nunca es la fecha de pago. */
  presentedOn: string | null;
  period: number | null;
  /** Periodicidad impresa en el formulario de IVA. */
  periodicity: VatPeriodicity | null;
  nit: string;
  dv: string;
  companyName: string;
  formNumber: string;
  /** «26. No. Formulario anterior»: la declaración es una corrección de ese formulario. */
  previousFormNumber: string;
  values: Partial<Record<ValueKey, ReadValue>>;
  /** Solo Renta: patrimonio declarado (informativo, nunca va a los Estados Financieros). */
  equity: { key: EquityKey; label: string; value: ReadValue | null }[];
  warnings: string[];
}

export class TaxReturnError extends Error {}

// ---------------------------------------------------------------------------
// Conceptos y versiones
// ---------------------------------------------------------------------------

interface Concept {
  key: string;
  label: string;
  /** Textos aceptados (normalizados). «prefix» acepta etiquetas de dos líneas. */
  match: string[];
  mode?: "exact" | "prefix";
}

const VALUE_CONCEPTS: Record<TaxType, Concept[]> = {
  withholding: [{ key: "withholdingTotal", label: "Total retenciones más sanciones", match: ["total retenciones mas sanciones"] }],
  vat: [
    { key: "vatPayable", label: "Total saldo a pagar", match: ["total saldo a pagar"] },
    { key: "vatFavor", label: "Total saldo a favor", match: ["total saldo a favor", "o total saldo a favor"] },
  ],
  income: [
    { key: "incomeOrdinary", label: "Renta líquida ordinaria del ejercicio", match: ["renta liquida ordinaria del ejercicio"] },
    { key: "incomeLoss", label: "Pérdida líquida del ejercicio", match: ["perdida liquida del ejercicio"] },
    { key: "incomeAdvanceNext", label: "Anticipo renta para el año gravable siguiente", match: ["anticipo renta para el ano gravable siguiente"] },
    { key: "incomeTaxBalance", label: "Saldo a pagar por impuesto", match: ["saldo a pagar por impuesto"] },
    { key: "incomePayable", label: "Total saldo a pagar", match: ["total saldo a pagar"] },
    { key: "incomeFavor", label: "Total saldo a favor", match: ["total saldo a favor"] },
  ],
};

export const EQUITY_CONCEPTS: (Concept & { key: EquityKey })[] = [
  { key: "cash", label: "Efectivo y equivalentes al efectivo", match: ["efectivo y equivalentes al efectivo"] },
  { key: "investments", label: "Inversiones e instrumentos financieros derivados", match: ["inversiones e instrumentos financieros derivados"] },
  { key: "receivables", label: "Cuentas, documentos y arrendamientos financieros por cobrar", match: ["cuentas, documentos y arrendamientos financieros"], mode: "prefix" },
  { key: "inventories", label: "Inventarios", match: ["inventarios"] },
  { key: "intangibles", label: "Activos intangibles", match: ["activos intangibles"] },
  { key: "biological", label: "Activos biológicos", match: ["activos biologicos"] },
  { key: "ppe", label: "Propiedades, planta y equipo, propiedades de inversión y ANCMV", match: ["propiedades, planta y equipo"], mode: "prefix" },
  { key: "otherAssets", label: "Otros activos", match: ["otros activos"] },
  { key: "grossEquity", label: "Total patrimonio bruto", match: ["total patrimonio bruto"] },
  { key: "liabilities", label: "Pasivos", match: ["pasivos"] },
  { key: "netEquity", label: "Total patrimonio líquido", match: ["total patrimonio liquido"] },
];

/**
 * Casillas esperadas por versión (desde el año gravable `from`), tomadas de
 * los formularios reales revisados. Solo validan: el valor se busca por
 * nombre. Un año sin versión conocida (ej. Renta 2020–2021) no se valida.
 */
interface FormVersion {
  from: number;
  to?: number;
  casillas: Record<string, string>;
}

const EQUITY_2017 = { cash: "33", investments: "34", receivables: "35", inventories: "36", intangibles: "37", biological: "38", ppe: "39", otherAssets: "40", grossEquity: "41", liabilities: "42", netEquity: "43" };
const EQUITY_2022 = { cash: "36", investments: "37", receivables: "38", inventories: "39", intangibles: "40", biological: "41", ppe: "42", otherAssets: "43", grossEquity: "44", liabilities: "45", netEquity: "46" };

export const FORM_VERSIONS: Record<TaxType, FormVersion[]> = {
  withholding: [{ from: 2026, casillas: { withholdingTotal: "138" } }],
  vat: [{ from: 2023, casillas: { vatPayable: "88", vatFavor: "89" } }],
  income: [
    { from: 2017, to: 2017, casillas: { ...EQUITY_2017, incomeOrdinary: "64", incomeLoss: "65", incomeAdvanceNext: "98", incomeTaxBalance: "100", incomePayable: "102", incomeFavor: "103" } },
    { from: 2018, to: 2018, casillas: { ...EQUITY_2017, incomeOrdinary: "64", incomeLoss: "65", incomeAdvanceNext: "97", incomeTaxBalance: "98", incomePayable: "100", incomeFavor: "101" } },
    { from: 2019, to: 2019, casillas: { ...EQUITY_2017, incomeOrdinary: "67", incomeLoss: "68", incomeAdvanceNext: "96", incomeTaxBalance: "100", incomePayable: "102", incomeFavor: "103" } },
    { from: 2022, casillas: { ...EQUITY_2022, incomeOrdinary: "72", incomeLoss: "73", incomeAdvanceNext: "108", incomeTaxBalance: "111", incomePayable: "113", incomeFavor: "114" } },
  ],
};

export function formVersion(taxType: TaxType, year: number | null): FormVersion | null {
  if (year === null) return null;
  return FORM_VERSIONS[taxType].find((v) => year >= v.from && (v.to === undefined || year <= v.to)) ?? null;
}

// ---------------------------------------------------------------------------
// Utilidades de posición
// ---------------------------------------------------------------------------

const ROW = 7;
const norm = (text: string) => normalizeKey(text).replace(/\s*\(marque "x"\)\s*/g, "");
const isNumeric = (t: string) => /^-?[\d.,]+$/.test(t.trim()) && /\d/.test(t);
const right = (i: PdfTextItem) => i.x + i.width;

/** «19,662,000» / «19.662.000» → centavos (las declaraciones van en pesos enteros). */
export function parseDeclaredPesos(text: string): number | null {
  const t = text.trim();
  if (!/^-?\d{1,3}([.,]\d{3})*$|^-?\d+$/.test(t)) return null;
  return Number(t.replace(/[.,]/g, "")) * 100;
}

/** Dígito de verificación DIAN de un NIT. */
export function nitCheckDigit(nit: string): string {
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const digits = nit.replace(/\D/g, "").split("").reverse();
  const sum = digits.reduce((s, d, i) => s + Number(d) * (weights[i] ?? 0), 0);
  const r = sum % 11;
  return String(r >= 2 ? 11 - r : r);
}

class Page {
  readonly items: PdfTextItem[];
  /** Bordes derechos donde se alinean los valores. */
  private readonly columns: number[];

  constructor(items: PdfTextItem[]) {
    this.items = items.filter((i) => i.text.trim());
    const edges = this.items.filter((i) => /\d[.,]\d{3}/.test(i.text) || i.text.trim() === "0").map(right);
    const columns: { edge: number; n: number }[] = [];
    for (const e of edges) {
      const c = columns.find((x) => Math.abs(x.edge - e) <= 6);
      if (c) {
        c.edge = (c.edge * c.n + e) / (c.n + 1);
        c.n++;
      } else columns.push({ edge: e, n: 1 });
    }
    this.columns = columns.filter((c) => c.n >= 3).map((c) => c.edge);
  }

  find(concept: Concept): PdfTextItem | undefined {
    return this.items.find((i) => {
      const t = norm(i.text);
      return concept.match.some((m) => (concept.mode === "prefix" ? t.startsWith(m) : t === m));
    });
  }

  findRegex(re: RegExp): PdfTextItem | undefined {
    return this.items.find((i) => re.test(norm(i.text)));
  }

  isValue(i: PdfTextItem): boolean {
    return isNumeric(i.text) && parseDeclaredPesos(i.text) !== null && this.columns.some((c) => Math.abs(c - right(i)) <= 6);
  }

  /** Valor de una etiqueta: su columna, fila más cercana, antes de la siguiente etiqueta de la fila. */
  valueFor(label: PdfTextItem): PdfTextItem | undefined {
    const boundary = Math.min(
      Infinity,
      ...this.items.filter((i) => !isNumeric(i.text) && Math.abs(i.y - label.y) <= ROW && i.x > label.x + 20 && i.text.trim().length > 3).map((i) => i.x),
    );
    const candidates = this.items.filter((i) => this.isValue(i) && i.x > label.x && i.x < boundary && Math.abs(i.y - label.y) <= ROW);
    // La fila más cercana y, en ella, la columna más próxima a la etiqueta (la de la otra columna de conceptos queda a la derecha).
    return candidates.sort((a, b) => Math.abs(a.y - label.y) - Math.abs(b.y - label.y) || a.x - b.x)[0];
  }

  /** Valor de la fila siguiente (debajo) en la misma columna. */
  valueBelow(anchor: PdfTextItem): PdfTextItem | undefined {
    return this.items
      .filter((i) => this.isValue(i) && Math.abs(right(i) - right(anchor)) <= 6 && anchor.y - i.y >= 8 && anchor.y - i.y <= 17)
      .sort((a, b) => b.y - a.y)[0];
  }

  /** Casilla impresa entre la etiqueta y su valor (número entero sin separadores que no es un valor). */
  casillaFor(label: PdfTextItem | null, value: PdfTextItem): string | null {
    const fromX = label ? label.x : value.x - 120;
    const c = this.items
      .filter((i) => /^\d{1,3}$/.test(i.text.trim()) && !this.isValue(i) && i.x > fromX && i.x < value.x && Math.abs(i.y - value.y) <= ROW)
      .sort((a, b) => Math.abs(a.y - value.y) - Math.abs(b.y - value.y))[0];
    return c ? c.text.trim() : null;
  }

  /** Dígitos sueltos o agrupados de una zona, en orden de lectura. */
  digits(filter: (i: PdfTextItem) => boolean): string {
    return this.items
      .filter((i) => filter(i) && /^[\d ]+$/.test(i.text.trim()))
      .sort((a, b) => a.x - b.x)
      .map((i) => i.text.replace(/\s/g, ""))
      .join("");
  }
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

function detectForm(page: Page): { taxType: TaxType; formCode: ParsedTaxReturn["formCode"] } | null {
  if (page.findRegex(/^total retenciones mas sanciones$/)) return { taxType: "withholding", formCode: "350" };
  if (page.findRegex(/^renta liquida ordinaria del ejercicio$/) || page.findRegex(/^total patrimonio liquido$/)) return { taxType: "income", formCode: "110" };
  if (page.findRegex(/periodicidad$/) && page.findRegex(/^(o )?total saldo a (pagar|favor)$/)) return { taxType: "vat", formCode: "300" };
  return null;
}

export const TAX_FORM_LABEL: Record<TaxType, string> = {
  withholding: "Formulario 350 — Retención en la fuente",
  vat: "Formulario 300 — IVA",
  income: "Formulario 110 — Renta",
};

export function parseTaxReturn(doc: PdfDocumentText): ParsedTaxReturn {
  const first = doc.pages[0];
  if (!first || first.items.length === 0) throw new TaxReturnError("El PDF no tiene texto legible. Usa la declaración descargada de la DIAN (no una imagen escaneada).");
  const page = new Page(first.items);
  const form = detectForm(page);
  if (!form) throw new TaxReturnError("No se reconoce el formulario. Se admiten las declaraciones DIAN de Retención en la fuente (350), IVA (300) y Renta (110).");
  const warnings: string[] = [];

  // Año y periodo: dígitos sueltos a la derecha de su etiqueta.
  const yearLabel = page.findRegex(/^1\. ano$/);
  const periodLabel = page.findRegex(/^3\. periodo$/);
  const yearDigits = yearLabel ? page.digits((i) => i !== yearLabel && i.x > yearLabel.x && i.x < Math.min(yearLabel.x + 100, periodLabel?.x ?? Infinity) && Math.abs(i.y - yearLabel.y) <= 5) : "";
  let year: number | null = /^\d{4}$/.test(yearDigits) ? Number(yearDigits) : null;
  const presentedItem = page.items.find((i) => /^\d{4}-\d{2}-\d{2} \/ /.test(i.text.trim()));
  const presentedOn = presentedItem ? presentedItem.text.trim().slice(0, 10) : null;
  let yearSource: ParsedTaxReturn["yearSource"] = year !== null ? "form" : null;
  if (year === null && form.taxType === "income" && presentedOn) {
    year = Number(presentedOn.slice(0, 4)) - 1;
    yearSource = "presentation";
    warnings.push(`El formulario no trae el año gravable como texto: se propone ${year} (año anterior a la presentación del ${presentedOn}). Confírmalo antes de guardar.`);
  }
  const periodDigits = periodLabel ? page.digits((i) => i !== periodLabel && i.x > periodLabel.x && i.x < periodLabel.x + 90 && Math.abs(i.y - periodLabel.y) <= 5) : "";
  const period = /^\d{1,2}$/.test(periodDigits) ? Number(periodDigits) : null;

  // Número de formulario y formulario anterior (corrección).
  const formLabel = page.findRegex(/^4\. numero de formulario$/);
  const formNumber = formLabel ? (page.items.find((i) => /^\d{9,}$/.test(i.text.trim()) && i.x > formLabel.x && Math.abs(i.y - formLabel.y) <= 8)?.text.trim() ?? "") : "";
  const previousLabel = page.findRegex(/^26\. no\.? formulario/);
  const previousFormNumber = previousLabel
    ? (page.items.find((i) => /^\d{9,}$/.test(i.text.trim()) && i.text.trim() !== formNumber && i.x >= previousLabel.x - 15 && i.x <= previousLabel.x + 180 && i.y <= previousLabel.y + 2 && i.y >= previousLabel.y - 20)?.text.trim() ?? "")
    : "";

  // NIT + DV: el último dígito es el DV si cuadra con el cálculo DIAN; si no, se separa por la columna «DV».
  const nitLabel = page.findRegex(/identificacion tributaria/);
  const dvLabel = page.findRegex(/^6\. ?dv\.?$/);
  let nit = "";
  let dv = "";
  if (nitLabel) {
    const inRow = (i: PdfTextItem) => i.y < nitLabel.y - 4 && i.y > nitLabel.y - 22 && i.x >= nitLabel.x - 10 && i.x < nitLabel.x + 220;
    const all = page.digits(inRow);
    if (all.length >= 2 && nitCheckDigit(all.slice(0, -1)) === all.slice(-1)) {
      nit = all.slice(0, -1);
      dv = all.slice(-1);
    } else if (dvLabel) {
      nit = page.digits((i) => inRow(i) && i.x < dvLabel.x);
      dv = page.digits((i) => inRow(i) && i.x >= dvLabel.x);
      if (dv && nitCheckDigit(nit) !== dv) warnings.push(`El dígito de verificación leído (${dv}) no corresponde al NIT ${nit}.`);
    } else nit = all;
  }

  const nameLabel = page.findRegex(/^11\. razon social$/);
  const companyName = nameLabel
    ? page.items
        .filter((i) => i.y < nameLabel.y - 3 && i.y > nameLabel.y - 20 && i.x >= nameLabel.x - 3 && i.x < nameLabel.x + 300 && !/^\d+$/.test(i.text.trim()))
        .sort((a, b) => a.x - b.x)
        .map((i) => i.text.trim())
        .join(" ")
    : "";

  let periodicity: VatPeriodicity | null = null;
  if (form.taxType === "vat") {
    const label = page.findRegex(/periodicidad$/);
    const value = label && page.items.find((i) => Math.abs(i.y - label.y) <= 4 && i.x > label.x && /^(bimestral|cuatrimestral)$/.test(norm(i.text)));
    periodicity = value ? (norm(value.text) === "bimestral" ? "bimonthly" : "four_monthly") : null;
  }

  // Valores por nombre de concepto.
  const version = formVersion(form.taxType, year);
  const read = (concept: Concept): ReadValue | null => {
    const label = page.find(concept);
    if (!label) return null;
    const value = page.valueFor(label);
    if (!value) return null;
    return { label: concept.label, cents: parseDeclaredPesos(value.text)!, casilla: page.casillaFor(label, value), expectedCasilla: version?.casillas[concept.key] ?? null, foundBy: "label" };
  };
  const values: ParsedTaxReturn["values"] = {};
  for (const c of VALUE_CONCEPTS[form.taxType]) {
    const v = read(c);
    if (v) values[c.key as ValueKey] = v;
  }

  // Renta: la etiqueta «Pérdida líquida del ejercicio» no siempre está como texto; es la fila siguiente a la renta líquida ordinaria.
  let equity: ParsedTaxReturn["equity"] = [];
  if (form.taxType === "income") {
    const ordinaryLabel = page.find(VALUE_CONCEPTS.income[0]);
    const ordinaryValue = ordinaryLabel && page.valueFor(ordinaryLabel);
    if (!values.incomeLoss && ordinaryValue) {
      const below = page.valueBelow(ordinaryValue);
      if (below) values.incomeLoss = { label: "Pérdida líquida del ejercicio", cents: parseDeclaredPesos(below.text)!, casilla: page.casillaFor(null, below), expectedCasilla: version?.casillas.incomeLoss ?? null, foundBy: "position" };
    }
    equity = EQUITY_CONCEPTS.map((c) => ({ key: c.key, label: c.label, value: read(c) }));
  }

  // Conceptos obligatorios y validación de casillas.
  const required: Record<TaxType, ValueKey[]> = {
    withholding: ["withholdingTotal"],
    vat: ["vatPayable", "vatFavor"],
    income: ["incomeOrdinary", "incomeLoss", "incomeAdvanceNext", "incomePayable", "incomeFavor"],
  };
  const missing = required[form.taxType].filter((k) => !values[k]);
  if (missing.length) {
    const labels = VALUE_CONCEPTS[form.taxType].filter((c) => missing.includes(c.key as ValueKey)).map((c) => `«${c.label}»`);
    throw new TaxReturnError(`No se encontró ${labels.join(", ")} en la declaración. Verifica que sea el formulario DIAN completo.`);
  }
  for (const v of [...Object.values(values), ...equity.map((e) => e.value)]) {
    if (v && v.casilla && v.expectedCasilla && v.casilla !== v.expectedCasilla) warnings.push(`«${v.label}» aparece en la casilla ${v.casilla}; para el año ${year} se esperaba la ${v.expectedCasilla}. Revisa el valor leído.`);
  }
  if (year !== null && !version) warnings.push(`No hay casillas de referencia para el formulario de ${year}: los valores se identificaron solo por el nombre del concepto.`);
  if (!nit) warnings.push("No se pudo leer el NIT del declarante.");
  if (!formNumber) warnings.push("No se pudo leer el número de formulario.");
  if (form.taxType !== "income" && period === null) warnings.push("No se pudo leer el periodo de la declaración.");

  return { ...form, year, yearSource, presentedOn, period, periodicity, nit, dv, companyName, formNumber, previousFormNumber, values, equity, warnings };
}
