/**
 * Cálculo de aportes a seguridad social y parafiscales (Calculadoras).
 *
 * aporte = base × porcentaje. Las tarifas se definen como decimales
 * (12,5 % = 0.125; 0,522 % = 0.00522) y el producto se hace en enteros
 * exactos (pesos × millonésimas, con BigInt): 2.000.000 × 0,6 % da 12.000
 * exactos y no 12.000,000000000002.
 *
 * Cada aporte se aproxima al múltiplo de $ 100 superior, como en la PILA
 * (1.750.905 × 4 % = 70.036,2 → $ 70.100). El total suma los aportes ya
 * aproximados, igual que la planilla.
 */

export interface RateOption {
  id: string;
  label: string;
  /** Decimal: 4 % = 0.04. */
  rate: number;
}

/** "12,5%" · "0,522%" · "4%" a partir del decimal. */
export function formatPercent(rate: number): string {
  const units = toMillionths(rate);
  const whole = Math.floor(units / 10_000);
  const decimals = String(units % 10_000).padStart(4, "0").replace(/0+$/, "");
  return `${whole}${decimals ? `,${decimals}` : ""}%`;
}

const percent = (rate: number): RateOption => ({ id: String(rate), label: formatPercent(rate), rate });

/** Riesgos laborales: el mismo menú para dependientes e independientes. */
export const ARL_OPTIONS: RateOption[] = [
  { id: "none", label: "Ninguno", rate: 0 },
  { id: "I", label: "Riesgo I", rate: 0.00522 },
  { id: "II", label: "Riesgo II", rate: 0.01044 },
  { id: "III", label: "Riesgo III", rate: 0.02436 },
  { id: "IV", label: "Riesgo IV", rate: 0.0435 },
  { id: "V", label: "Riesgo V", rate: 0.0696 },
].map((o) => ({ ...o, label: `${o.label} — ${formatPercent(o.rate)}` }));

export interface ContributionLine {
  id: string;
  label: string;
  options: RateOption[];
}

export const DEPENDENT_LINES: ContributionLine[] = [
  { id: "health", label: "Salud", options: [0, 0.04, 0.125].map(percent) },
  { id: "pension", label: "Pensión", options: [0, 0.16].map(percent) },
  { id: "arl", label: "ARL", options: ARL_OPTIONS },
  { id: "ccf", label: "CCF", options: [0, 0.04].map(percent) },
  { id: "sena", label: "SENA", options: [0, 0.02].map(percent) },
  { id: "icbf", label: "ICBF", options: [0, 0.03].map(percent) },
];

export const INDEPENDENT_LINES: ContributionLine[] = [
  { id: "health", label: "Salud", options: [0, 0.125].map(percent) },
  { id: "pension", label: "Pensión", options: [0, 0.16].map(percent) },
  { id: "arl", label: "ARL", options: ARL_OPTIONS },
  { id: "ccf", label: "CCF", options: [0, 0.006, 0.02, 0.04].map(percent) },
];

/** Selección inicial: la primera opción de cada fila (0 % / Ninguno). */
export const defaultSelection = (lines: ContributionLine[]): Record<string, string> => Object.fromEntries(lines.map((l) => [l.id, l.options[0].id]));

/** Porcentaje IBC de independientes: 40 % de los ingresos. */
export const INDEPENDENT_IBC_RATE = 0.4;

function toMillionths(rate: number): number {
  const units = Math.round(rate * 1_000_000);
  if (!Number.isSafeInteger(units) || units < 0) throw new Error(`Tarifa no válida: ${rate}`);
  return units;
}

/** base × tarifa sin aproximar (para mostrar o probar el valor previo al redondeo). */
export function exactContribution(basePesos: number, rate: number): number {
  return (basePesos * toMillionths(rate)) / 1_000_000;
}

/** base × tarifa aproximado al múltiplo de $ 100 superior. Base vacía o 0 → 0. */
export function contribution(basePesos: number, rate: number): number {
  if (!Number.isSafeInteger(basePesos) || basePesos <= 0) return 0;
  const product = BigInt(basePesos) * BigInt(toMillionths(rate));
  const step = 100_000_000n; // $ 100 en pesos × millonésimas
  return Number(((product + step - 1n) / step) * 100n);
}

export interface ContributionResult {
  lines: { id: string; label: string; rate: number; valuePesos: number }[];
  totalPesos: number;
}

/** Aportes de cada fila con la opción elegida, y su total. */
export function calculateContributions(basePesos: number | null, lines: ContributionLine[], selection: Record<string, string>): ContributionResult {
  const result = lines.map((line) => {
    const rate = (line.options.find((o) => o.id === selection[line.id]) ?? line.options[0]).rate;
    return { id: line.id, label: line.label, rate, valuePesos: contribution(basePesos ?? 0, rate) };
  });
  return { lines: result, totalPesos: result.reduce((s, l) => s + l.valuePesos, 0) };
}

export type IndependentIbc =
  | { status: "empty" }
  | { status: "missing-wage" }
  | { status: "ok"; fortyPercentPesos: number; minimumWagePesos: number; ibcPesos: number; usesMinimumWage: boolean };

/**
 * IBC de independientes = MAX(ingresos × 40 %, SMMLV del año). Sin ingresos
 * (vacío o 0) no se aplica el SMMLV: IBC $ 0. Sin SMMLV del año no se calcula.
 * El 40 % se aproxima al peso superior.
 */
export function independentIbc(incomePesos: number | null, minimumWagePesos: number | undefined): IndependentIbc {
  if (!incomePesos || incomePesos <= 0) return { status: "empty" };
  if (!minimumWagePesos) return { status: "missing-wage" };
  const fortyPercentPesos = Number((BigInt(incomePesos) * 4n + 9n) / 10n);
  const usesMinimumWage = fortyPercentPesos < minimumWagePesos;
  return { status: "ok", fortyPercentPesos, minimumWagePesos, ibcPesos: usesMinimumWage ? minimumWagePesos : fortyPercentPesos, usesMinimumWage };
}

/** Pesos enteros → "$ 1.750.905". */
export function formatCalcPesos(pesos: number): string {
  return `$ ${String(Math.round(pesos)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/** Máximo de dígitos aceptados en los campos de valor ($ 999.999.999.999). */
export const MAX_DIGITS = 12;

/** Solo dígitos: "1705905" o "$ 1.705.905" → 1705905; "" → null. Letras, signos y decimales se descartan. */
export function parsePesosInput(text: string): number | null {
  const digits = text.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, MAX_DIGITS);
  return digits === "" ? null : Number(digits);
}
