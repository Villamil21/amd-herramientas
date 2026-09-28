import { formatInteger, formatPesos } from "../../../../../utils/format";
import type { PayrollCheck, PayrollEmployee, PayrollSummary, PayrollValidation } from "../../shared/types";

const sum = (employees: PayrollEmployee[], pick: (e: PayrollEmployee) => number) => employees.reduce((acc, e) => acc + pick(e), 0);

const compare = (id: string, label: string, a: number | undefined, b: number | undefined, detail: (a: number, b: number) => string): PayrollCheck =>
  a === undefined || b === undefined
    ? { id, label, status: "unavailable", detail: "el PDF no trae el dato para comparar." }
    : a === b
      ? { id, label, status: "ok" }
      : { id, label, status: "failed", detail: detail(a, b) };

/** Controles que deben pasar para considerar el análisis validado. */
const REQUIRED = ["employee-count", "employee-sum", "row-sums", "payment-summary", "late-interest"];

/**
 * Compara lo extraído con los totales que trae la propia planilla. No corrige
 * nada: solo informa qué coincide y qué no.
 */
export function validatePayroll(s: PayrollSummary): PayrollValidation {
  const { employees, detailTotals: t, paymentSummary: p } = s;
  const checks: PayrollCheck[] = [];

  checks.push(
    compare("employee-count", "Empleados extraídos = Total Afiliados", employees.length, t.declaredEmployees, (a, b) => `se extrajeron ${formatInteger(a)} empleados y la planilla indica Total Afiliados(${formatInteger(b)}).`),
  );
  checks.push(
    compare("employee-sum", "Suma de Total Aportes por empleado = total de la planilla", sum(employees, (e) => e.totalContribution), s.totalContributions, (a, b) =>
      `La suma de los aportes por empleado (${formatPesos(a)}) no coincide con el total de la planilla (${formatPesos(b)}).`,
    ),
  );

  const badRows = employees.filter(
    (e) => e.pensionContribution + e.healthContribution + e.ccfContribution + e.riskContribution + (e.otherContribution ?? 0) !== e.totalContribution,
  );
  checks.push(
    badRows.length === 0
      ? { id: "row-sums", label: "Aportes por sistema de cada empleado = su Total Aportes", status: "ok" }
      : { id: "row-sums", label: "Aportes por sistema de cada empleado = su Total Aportes", status: "failed", detail: `no cuadran: ${badRows.map((e) => e.name).join(", ")}.` },
  );

  const columns: [string, number | undefined, (e: PayrollEmployee) => number][] = [
    ["Pensión IBC", t.pensionIbc, (e) => e.pensionIbc],
    ["Pensión Aporte", t.pensionContribution, (e) => e.pensionContribution],
    ["Salud Aporte", t.healthContribution, (e) => e.healthContribution],
    ["CCF Aporte", t.ccfContribution, (e) => e.ccfContribution],
    ["Riesgos Aporte", t.riskContribution, (e) => e.riskContribution],
  ];
  const available = columns.filter(([, total]) => total !== undefined);
  const mismatched = available.filter(([, total, pick]) => sum(employees, pick) !== total);
  checks.push(
    available.length === 0
      ? { id: "column-totals", label: "Columnas = fila Total Afiliados", status: "unavailable", detail: "la fila Total Afiliados no trae totales por columna." }
      : mismatched.length === 0
        ? { id: "column-totals", label: "Columnas = fila Total Afiliados", status: "ok" }
        : {
            id: "column-totals",
            label: "Columnas = fila Total Afiliados",
            status: "failed",
            detail: mismatched.map(([label, total, pick]) => `${label}: suma ${formatPesos(sum(employees, pick))}, planilla ${formatPesos(total!)}`).join("; ") + ".",
          },
  );

  if (!p) {
    checks.push({ id: "payment-summary", label: "Resumen de pago", status: "unavailable", detail: "no se encontró el Resumen de pago en el PDF." });
    checks.push({ id: "late-interest", label: "Intereses de mora", status: "unavailable", detail: "no se encontró el Resumen de pago en el PDF." });
  } else {
    const consistent =
      p.liquidated !== undefined && p.lateInterest !== undefined && p.toPay !== undefined
        ? p.liquidated + p.lateInterest === p.toPay && p.liquidated === s.totalContributions && p.toPay === s.paymentAmount
        : undefined;
    checks.push(
      consistent === undefined
        ? { id: "payment-summary", label: "Resumen de pago", status: "unavailable", detail: "la fila TOTAL del Resumen de pago está incompleta." }
        : consistent
          ? { id: "payment-summary", label: "Resumen de pago: valor liquidado + intereses mora = valor a pagar", status: "ok" }
          : {
              id: "payment-summary",
              label: "Resumen de pago: valor liquidado + intereses mora = valor a pagar",
              status: "failed",
              detail: `valor liquidado ${formatPesos(p.liquidated!)} + intereses mora ${formatPesos(p.lateInterest!)} = ${formatPesos(p.liquidated! + p.lateInterest!)}; valor a pagar ${formatPesos(p.toPay!)}; total aportes ${formatPesos(s.totalContributions)}; valor pagado ${formatPesos(s.paymentAmount)}.`,
            },
    );
    checks.push(
      compare("late-interest", "Valor pagado − total aportes = intereses mora del Resumen de pago", s.lateInterest, p.lateInterest, (a, b) =>
        `el cálculo da ${formatPesos(a)} y el Resumen de pago indica ${formatPesos(b)}.`,
      ),
    );

    // Subtotales por riesgo contra las columnas del detalle (solo los que trae el PDF).
    const byRisk: [string, string, (e: PayrollEmployee) => number][] = [
      ["AFP", "Pensión", (e) => e.pensionContribution],
      ["EPS", "Salud", (e) => e.healthContribution],
      ["CCF", "CCF", (e) => e.ccfContribution],
      ["ARL", "Riesgos", (e) => e.riskContribution],
    ];
    const present = byRisk.filter(([risk]) => p.liquidatedByRisk[risk] !== undefined);
    const off = present.filter(([risk, , pick]) => sum(employees, pick) !== p.liquidatedByRisk[risk]);
    if (present.length > 0) {
      checks.push(
        off.length === 0
          ? { id: "by-risk", label: "Aportes por sistema = Resumen de pago (AFP, EPS, CCF, ARL)", status: "ok" }
          : {
              id: "by-risk",
              label: "Aportes por sistema = Resumen de pago (AFP, EPS, CCF, ARL)",
              status: "failed",
              detail: off.map(([risk, label, pick]) => `${label}: detalle ${formatPesos(sum(employees, pick))}, ${risk} ${formatPesos(p.liquidatedByRisk[risk])}`).join("; ") + ".",
            },
      );
    }
  }

  checks.push(
    s.issues.length === 0
      ? { id: "issues", label: "Todas las filas interpretadas", status: "ok" }
      : {
          id: "issues",
          label: "Todas las filas interpretadas",
          status: "failed",
          detail:
            s.detectedRows > s.employees.length
              ? `Se detectaron ${formatInteger(s.detectedRows)} empleados, pero ${formatInteger(s.detectedRows - s.employees.length)} fila(s) no pudieron interpretarse correctamente.`
              : `${s.issues.length} texto(s) de la tabla sin interpretar.`,
        },
  );

  const validated = checks.every((c) => c.status === "ok" || (c.status === "unavailable" && !REQUIRED.includes(c.id)));
  return { validated, checks };
}
