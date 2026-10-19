import type { SyncProposal } from "../../../../types/exogena";
import type { PayrollAlert } from "./alerts";
import { NOMINA_PATH } from "./alerts";
import { isCovered, type MonthLine, type YearData } from "./year";

/**
 * Formato 1011 (declaraciones tributarias): una cifra anual por empresa y concepto, sin terceros. Fase inicial: 8207, 8241, 8242,
 * 8243, 8244, 8245 y 8295. Todo sale de las planillas válidas del año de PENSIÓN; los demás conceptos del formato siguen
 * disponibles para fases posteriores, pero aquí nunca se inventa un valor para ellos.
 */
export type Concept1011 = "8207" | "8241" | "8242" | "8243" | "8244" | "8245" | "8295";

export const CONCEPTS_1011: { code: Concept1011; label: string; rule: string }[] = [
  { code: "8207", label: "Pagos por salarios y demás pagos laborales", rule: "Salario causado por días trabajados + vacaciones + prima + intereses de cesantías + auxilio de transporte, por empleado y periodo. Sin cesantías." },
  { code: "8241", label: "Aportes al ICBF", rule: "Aporte ICBF de la planilla, solo si trae un valor identificable." },
  { code: "8242", label: "Aportes a cajas de compensación familiar", rule: "Aporte CCF liquidado de la planilla." },
  { code: "8243", label: "Aportes al SENA", rule: "Aporte SENA de la planilla, solo si trae un valor identificable." },
  { code: "8244", label: "Aportes a fondos de pensiones", rule: "Valor total aportado a pensión según la planilla." },
  { code: "8245", label: "Cesantías", rule: "Cesantías causadas, sin intereses de cesantías." },
  { code: "8295", label: "Aportes a EPS y ARL", rule: "Aporte de salud + riesgos laborales liquidado de la planilla." },
];

/** Cero real, sin valor identificable en la planilla, o con valor. Nunca se confunden. */
export type ConceptState = "value" | "zero" | "unidentified";

export interface Term1011 {
  period: string;
  /** «CC 123» o vacío cuando el aporte es de toda la planilla. */
  person: string;
  name: string;
  batchId: number;
  fileName: string;
  cents: number;
  /** Cómo se calculó, para auditar. */
  calc: string;
}

export interface Line1011 {
  code: Concept1011;
  label: string;
  rule: string;
  cents: number;
  state: ConceptState;
  terms: Term1011[];
}

export interface Form1011 {
  lines: Line1011[];
  proposals: SyncProposal[];
  alerts: PayrollAlert[];
  /** Meses del año que aún no están cubiertos (planilla válida o «Periodo sin nómina»). */
  uncovered: string[];
}

const peso = (cents: number) => Math.round(cents / 100);
const money = (cents: number) => String(peso(cents));

export const COMBINED_PARAFISCAL = "SENA e ICBF (sin separar)";

function lineTerms(code: Concept1011, l: MonthLine): { cents: number; calc: string } {
  const c = l.calc;
  const s = l.person.contributions;
  switch (code) {
    case "8207": {
      const cents = c.salaryCents + c.vacacionesCents + c.primaCents + c.interesesCents + c.transportCents;
      return { cents, calc: `salario ${money(c.salaryCents)} + vacaciones ${money(c.vacacionesCents)} + prima ${money(c.primaCents)} + intereses cesantías ${money(c.interesesCents)} + auxilio transporte ${money(c.transportCents)}` };
    }
    case "8241":
      return { cents: s.icbf * 100, calc: `ICBF ${s.icbf}` };
    case "8242":
      return { cents: s.ccf * 100, calc: `CCF ${s.ccf}` };
    case "8243":
      return { cents: s.sena * 100, calc: `SENA ${s.sena}` };
    case "8244":
      return { cents: s.pension * 100, calc: `pensión ${s.pension}` };
    case "8245":
      return { cents: c.cesantiasCents, calc: `cesantías ${money(c.cesantiasCents)}` };
    case "8295":
      return { cents: (s.health + s.arl) * 100, calc: `EPS ${s.health} + ARL ${s.arl}` };
  }
}

export function build1011(data: YearData): Form1011 {
  const alerts: PayrollAlert[] = [];
  const uncovered = data.coverage.filter((m) => !isCovered(m.state)).map((m) => m.month);
  const unidentified = new Set<string>();
  for (const l of data.lines) if (l.person.unrecognized[COMBINED_PARAFISCAL]) unidentified.add(l.period);

  const lines: Line1011[] = CONCEPTS_1011.map((def) => {
    const terms: Term1011[] = [];
    for (const l of data.lines) {
      const { cents, calc } = lineTerms(def.code, l);
      if (cents) terms.push({ period: l.period, person: l.key, name: l.person.name, batchId: l.batchId, fileName: l.fileName, cents, calc });
    }
    const cents = terms.reduce((n, t) => n + t.cents, 0);
    const identifiable = !((def.code === "8241" || def.code === "8243") && unidentified.size > 0);
    return { ...def, cents, state: cents > 0 ? "value" : identifiable ? "zero" : "unidentified", terms };
  });

  if (data.wagesMissing) {
    alerts.push({
      id: "1011:wages",
      code: "wages-missing",
      severity: "block",
      dests: ["1011", "2276"],
      title: `Falta el SMMLV o el auxilio de transporte de ${data.year}`,
      why: "El salario causado, el auxilio, la prima, las cesantías y sus intereses se calculan con el SMMLV y el auxilio del año: sin ellos 8207, 8245 y el 2276 saldrían mal.",
      how: "Registra el SMMLV y el auxilio de transporte del año.",
      action: { label: "Ir a SMMLV por año", path: "/smmlv" },
    });
  }
  const noPension = [...new Map(data.lines.filter((l) => !l.person.pension.ibc || !l.person.pension.days).map((l) => [`${l.key}|${l.period}`, l])).values()];
  for (const l of noPension) {
    alerts.push({
      id: `1011:no-pension:${l.key}|${l.period}`,
      code: "no-pension-base",
      severity: "block",
      dests: ["1011", "2276"],
      title: `${l.person.name} · ${l.period}: sin días o IBC de pensión`,
      why: "El salario del periodo se calcula con el IBC y los días de pensión; sin ellos no hay base para 8207, 8245 ni el 2276 (un cero no es lo mismo que un dato faltante).",
      how: "Revisa la planilla original: si la persona no cotiza pensión, el cálculo requiere una decisión que esta fase no automatiza.",
      action: { label: "Ver planilla", path: NOMINA_PATH },
    });
  }
  for (const d of data.duplicates) {
    alerts.push({
      id: `dup:${d.key}|${d.period}`,
      code: "employee-overlap",
      severity: "block",
      dests: ["1011", "2276"],
      title: `${d.name} aparece en más de una planilla de ${d.period}`,
      why: `La misma persona viene en los lotes ${d.batchIds.map((b) => `#${b}`).join(" y ")} del mismo periodo: sus importes no se suman dos veces y no se puede saber cuál es el correcto.`,
      how: "Anula el lote que sobra o quita a la persona de una de las planillas.",
      action: { label: "Abrir Nómina", path: NOMINA_PATH },
    });
  }
  for (const code of ["8241", "8243"] as const) {
    if (lines.find((l) => l.code === code)?.state === "unidentified") {
      alerts.push({
        id: `1011:unidentified:${code}`,
        code: "parafiscal-unidentified",
        severity: "review",
        dests: ["1011"],
        title: `${code} · ${code === "8241" ? "ICBF" : "SENA"}: la planilla no separa SENA de ICBF`,
        why: "Aportes en Línea trae SENA e ICBF en una sola columna: no hay un valor identificable, así que no se reporta ni se inventa.",
        how: "Importa la planilla desde un operador que los separe o valídalo con el contador.",
      });
    }
  }
  if (uncovered.length) {
    alerts.push({
      id: "1011:coverage",
      code: "coverage",
      severity: "block",
      dests: ["1011"],
      title: `Faltan ${uncovered.length} ${uncovered.length === 1 ? "mes" : "meses"} por cubrir`,
      why: `1011 es anual: no se puede dejar listo ni exportar hasta que cada mes tenga una planilla válida o «Periodo sin nómina» (faltan ${uncovered.map(monthName).join(", ")}).`,
      how: "Importa la planilla del mes o regístralo como «Periodo sin nómina».",
      action: { label: "Abrir Nómina", path: NOMINA_PATH },
    });
  }

  const proposals: SyncProposal[] = lines
    .filter((l) => l.state === "value")
    .map((l) => ({
      sourceKey: `nomina:${l.code}`,
      origin: "estados_financieros" as const,
      originRef: `Nómina · ${new Set(l.terms.map((t) => t.batchId)).size} ${new Set(l.terms.map((t) => t.batchId)).size === 1 ? "planilla" : "planillas"} · ${new Set(l.terms.map((t) => t.period)).size} ${new Set(l.terms.map((t) => t.period)).size === 1 ? "periodo" : "periodos"}`,
      data: { concept: l.code, balance: peso(l.cents), exactCents: { balance: l.cents } },
    }));
  return { lines, proposals, alerts, uncovered };
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
