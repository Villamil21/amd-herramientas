import type { ExoCatalogs } from "../../../../types/exogena";
import type { BatchSummary, Employee } from "../../../../types/fs";
import type { Company, MinimumWage, Supplier } from "../../../../types/models";
import { NOMINA_PATH, payrollCounts, payrollStatus, sortPayrollAlerts, type PayrollAlert } from "./alerts";
import { build1001Payroll, type Form1001Payroll } from "./exo1001";
import { build1011, monthName, type Form1011 } from "./exo1011";
import { build2276, type Form2276 } from "./exo2276";
import { buildYearData, type YearData } from "./year";

export interface PayrollInput {
  year: number;
  batches: BatchSummary[];
  employees: Employee[];
  wages: MinimumWage[];
  suppliers: Supplier[];
  catalogs: ExoCatalogs | null;
  company: Company | null;
}

export interface PayrollOverview {
  data: YearData;
  f1001: Form1001Payroll;
  f1011: Form1011;
  f2276: Form2276;
  /** Todas las alertas (cada una ya trae los destinos que afecta), la más grave primero y sin repetir. */
  alerts: PayrollAlert[];
  counts: ReturnType<typeof payrollCounts>;
  status: ReturnType<typeof payrollStatus>;
}

/**
 * Todo lo que se sabe de Nómina y seguridad social de una empresa en un año, por destino. Las alertas de un destino no
 * detienen a los demás: cada una se cuenta solo en los destinos que afecta.
 */
export function payrollOverview(input: PayrollInput): PayrollOverview {
  const data = buildYearData(input.year, input.batches, input.wages);
  const f1001 = build1001Payroll(data, input.suppliers, input.catalogs);
  const f1011 = build1011(data);
  const f2276 = build2276(data, input.employees, input.company);
  const extra: PayrollAlert[] = [];

  for (const m of data.coverage) {
    if (m.state === "legacy") {
      extra.push({
        id: `legacy:${m.month}`,
        code: "legacy-batch",
        severity: "block",
        dests: ["1001", "1011", "2276"],
        title: `${monthName(m.month)}: planilla enviada antes del detalle de seguridad social`,
        why: "Ese lote solo guarda los valores contables: no tiene el detalle por entidad, IBC ni entidades que necesitan 1001, 1011 y 2276, y no se reconstruye en silencio. Estados Financieros no cambia.",
        how: "Importa de nuevo el PDF de esa planilla: el sistema la reconoce como la misma y te pide confirmar el reemplazo.",
        action: { label: "Abrir Nómina", path: NOMINA_PATH },
      });
    } else if (m.state === "missing") {
      extra.push({
        id: `missing:${m.month}`,
        code: "month-missing",
        severity: "review",
        dests: ["EEFF"],
        title: `${monthName(m.month)}: sin planilla ni «Periodo sin nómina»`,
        why: "El mes no tiene nómina cargada ni registrada como vacía; los estados financieros quedarían sin esos gastos.",
        how: "Importa la planilla o registra el periodo sin nómina.",
        action: { label: "Abrir Nómina", path: NOMINA_PATH },
      });
    }
  }
  for (const d of data.duplicates) {
    extra.push({
      id: `eeff-dup:${d.key}|${d.period}`,
      code: "employee-overlap",
      severity: "block",
      dests: ["EEFF"],
      title: `${d.name} aparece en más de una planilla de ${d.period}`,
      why: "La misma persona está en lotes distintos del mismo periodo: sus importes podrían estar duplicados en Estados Financieros.",
      how: "Anula el lote que sobra desde Movimientos contables.",
      action: { label: "Abrir Nómina", path: NOMINA_PATH },
    });
  }

  const seen = new Set<string>();
  const alerts = sortPayrollAlerts(
    [...f1001.alerts, ...f1011.alerts, ...f2276.alerts, ...extra].flatMap((a) => {
      if (seen.has(a.id)) return [];
      seen.add(a.id);
      return [a];
    }),
  );
  // La misma causa de 1011 y 2276 (SMMLV, solape) llega dos veces con ids distintos: se deja una con los dos destinos.
  const merged = mergeSharedCauses(alerts);
  const counts = payrollCounts(merged);
  return { data, f1001, f1011, f2276, alerts: merged, counts, status: payrollStatus(counts) };
}

function mergeSharedCauses(alerts: PayrollAlert[]): PayrollAlert[] {
  const byCause = new Map<string, PayrollAlert>();
  const out: PayrollAlert[] = [];
  for (const a of alerts) {
    const cause = a.code === "wages-missing" || a.code === "employee-overlap" || a.code === "no-pension-base" ? `${a.code}|${a.title}` : null;
    if (!cause) {
      out.push(a);
      continue;
    }
    const first = byCause.get(cause);
    if (first) first.dests = [...new Set([...first.dests, ...a.dests])];
    else {
      const copy = { ...a, dests: [...a.dests] };
      byCause.set(cause, copy);
      out.push(copy);
    }
  }
  return out;
}
