import type { SyncProposal } from "../../../../types/exogena";
import type { Employee } from "../../../../types/fs";
import type { Company } from "../../../../types/models";
import { employeePath, companyPath, NOMINA_PATH, type PayrollAlert } from "./alerts";
import { monthName } from "./exo1011";
import { dianDocType, proposeNameSplit, type NameSplit } from "./names";
import { isCovered, type MonthLine, type YearData } from "./year";

/**
 * Formato 2276 (ingresos laborales): un registro anual por empleado con la separación de su nombre CONFIRMADA en la ficha.
 * El domicilio es el de la empresa informante. Las columnas de pagos que esta fase no calcula van siempre en 0.
 */

const peso = (cents: number) => Math.round(cents / 100);

export interface Amounts2276 {
  /** Pagos por salarios: salario efectivamente causado por los días trabajados + vacaciones. */
  salaries: number;
  /** Pagos por prestaciones sociales: primas. */
  benefits: number;
  /** Otros pagos: auxilio de transporte. */
  otherPayments: number;
  /** Cesantías e intereses de cesantías efectivamente pagadas: cesantías + intereses causados en el año. */
  severanceAndInterest: number;
  grossTotal: number;
  /** IBC de salud × 4 % por periodo, acumulado. */
  healthContribution: number;
  /** IBC de pensión × 4 % por periodo, acumulado. */
  pensionContribution: number;
  /** Promedio de la base salarial mensual (IBC × 30 / días) de los últimos hasta seis meses trabajados. */
  avgIncome6m: number;
}

export interface Employee2276 {
  key: string;
  docType: string;
  docNumber: string;
  name: string;
  /** Periodos con planilla del empleado en el año. */
  periods: string[];
  amountsCents: Record<keyof Amounts2276, number>;
  amounts: Amounts2276;
  /** Separación del nombre confirmada en la ficha (undefined = pendiente). */
  confirmed?: NameSplit;
  /** Propuesta cuando aún no está confirmada; `null` = no se pudo separar con seguridad. */
  proposal?: NameSplit | null;
  employeeId?: number;
  lines: MonthLine[];
}

export interface Form2276 {
  employees: Employee2276[];
  proposals: SyncProposal[];
  alerts: PayrollAlert[];
  uncovered: string[];
}

/** Cálculo anual de un empleado a partir de sus líneas mensuales. */
export function amounts2276(lines: MonthLine[]): Employee2276["amountsCents"] {
  const sum = (f: (l: MonthLine) => number) => lines.reduce((n, l) => n + f(l), 0);
  const salaries = sum((l) => l.calc.salaryCents + l.calc.vacacionesCents);
  const benefits = sum((l) => l.calc.primaCents);
  const otherPayments = sum((l) => l.calc.transportCents);
  const severanceAndInterest = sum((l) => l.calc.cesantiasCents + l.calc.interesesCents);
  // IBC en pesos × 100 (centavos) × 4 % = IBC × 4 centavos, exacto.
  const healthContribution = sum((l) => (l.person.health.ibc ?? 0) * 4);
  const pensionContribution = sum((l) => (l.person.pension.ibc ?? 0) * 4);
  const worked = [...lines].filter((l) => l.calc.days > 0).sort((a, b) => a.period.localeCompare(b.period)).slice(-6);
  const avgIncome6m = worked.length ? Math.round(worked.reduce((n, l) => n + l.calc.baseSalaryCents, 0) / worked.length) : 0;
  return { salaries, benefits, otherPayments, severanceAndInterest, grossTotal: salaries + benefits + otherPayments + severanceAndInterest, healthContribution, pensionContribution, avgIncome6m };
}

const toPesos = (a: Employee2276["amountsCents"]): Amounts2276 => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, peso(v)])) as unknown as Amounts2276;

export function build2276(data: YearData, employees: Employee[], company: Company | null): Form2276 {
  const alerts: PayrollAlert[] = [];
  const uncovered = data.coverage.filter((m) => !isCovered(m.state)).map((m) => m.month);
  const byKey = new Map<string, MonthLine[]>();
  for (const l of data.lines) byKey.set(l.key, [...(byKey.get(l.key) ?? []), l]);

  const out: Employee2276[] = [];
  for (const [key, lines] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const first = lines[0];
    const ficha = employees.find((e) => e.docType.toUpperCase() === first.person.docType && e.docNumber === first.person.docNumber);
    const parts = ficha?.nameParts;
    const confirmed = parts?.confirmedAt ? { firstSurname: parts.firstSurname, secondSurname: parts.secondSurname, firstName: parts.firstName, otherNames: parts.otherNames } : undefined;
    const name = ficha?.name ?? first.person.name;
    const amountsCents = amounts2276(lines);
    out.push({
      key,
      docType: first.person.docType,
      docNumber: first.person.docNumber,
      name,
      periods: [...new Set(lines.map((l) => l.period))].sort(),
      amountsCents,
      amounts: toPesos(amountsCents),
      confirmed,
      proposal: confirmed ? undefined : proposeNameSplit(parts && (parts.firstSurname || parts.firstName) ? [parts.firstSurname, parts.secondSurname, parts.firstName, parts.otherNames].filter(Boolean).join(" ") : name),
      employeeId: ficha?.id,
      lines,
    });
  }

  if (data.wagesMissing) {
    alerts.push({
      id: "2276:wages",
      code: "wages-missing",
      severity: "block",
      dests: ["2276", "1011"],
      title: `Falta el SMMLV o el auxilio de transporte de ${data.year}`,
      why: "Sin ellos no se calculan salario, auxilio, prima, cesantías ni intereses del 2276.",
      how: "Registra el SMMLV y el auxilio de transporte del año.",
      action: { label: "Ir a SMMLV por año", path: "/smmlv" },
    });
  }

  // Domicilio: el del beneficiario es el de la empresa informante.
  const missingDomicile: string[] = [];
  if (!company?.direccion.trim()) missingDomicile.push("dirección");
  if (!company?.countryCode) missingDomicile.push("país");
  else if (company.countryCode === "169") {
    if (!company.deptCode) missingDomicile.push("departamento");
    if (!company.muniCode) missingDomicile.push("municipio");
  }
  if (out.length > 0 && company && missingDomicile.length) {
    alerts.push({
      id: "2276:domicile",
      code: "company-domicile",
      severity: "block",
      dests: ["2276"],
      title: `La empresa no tiene ${missingDomicile.join(", ")}`,
      why: "En el 2276 el domicilio del beneficiario es el de la empresa informante; sin él el formato no se puede dejar listo.",
      how: "Completa el domicilio en la ficha de la empresa.",
      action: { label: "Abrir empresa", path: companyPath(company.nit) },
    });
  }

  for (const e of out) {
    if (!e.employeeId) {
      alerts.push({
        id: `2276:no-ficha:${e.key}`,
        code: "no-employee-record",
        severity: "block",
        dests: ["2276"],
        title: `${e.name}: sin ficha de empleado`,
        why: "El 2276 toma el nombre separado de la ficha del empleado, y no existe (se borró o nunca se creó).",
        how: "Procesa de nuevo la planilla o crea la ficha.",
        action: { label: "Abrir Empleados", path: "/herramientas/estados-financieros/empleados" },
      });
    } else if (!e.confirmed) {
      alerts.push({
        id: `2276:name:${e.key}`,
        code: "name-parts",
        severity: "pending",
        dests: ["2276"],
        title: `${e.name}: confirmar apellidos y nombres`,
        why: e.proposal
          ? `La planilla trae el nombre en un solo texto. Se propone: ${[e.proposal.firstSurname, e.proposal.secondSurname].filter(Boolean).join(" ")} / ${[e.proposal.firstName, e.proposal.otherNames].filter(Boolean).join(" ")}. Sin tu confirmación no hay registro 2276.`
          : "La planilla trae el nombre en un solo texto y no se puede separar con seguridad (menos de tres términos o apellidos compuestos). Sin la separación confirmada no hay registro 2276.",
        how: "Abre la ficha del empleado, revisa la separación y confírmala.",
        action: { label: "Abrir empleado", path: employeePath(company?.id ?? 0, e.docType, e.docNumber) },
      });
    }
    if (!dianDocType(e.docType)) {
      alerts.push({
        id: `2276:doctype:${e.key}`,
        code: "doc-type",
        severity: "block",
        dests: ["2276"],
        title: `${e.name}: tipo de documento «${e.docType}» sin código DIAN`,
        why: "El 2276 exige el código DIAN del tipo de documento y esta sigla no está homologada; no se adivina.",
        how: "Revisa el tipo de documento en la ficha del empleado.",
        action: { label: "Abrir empleado", path: employeePath(company?.id ?? 0, e.docType, e.docNumber) },
      });
    }
    const noHealth = e.lines.filter((l) => !l.person.health.ibc);
    for (const l of noHealth) {
      alerts.push({
        id: `2276:no-health:${e.key}|${l.period}`,
        code: "no-health-ibc",
        severity: "block",
        dests: ["2276"],
        title: `${e.name} · ${l.period}: sin IBC de salud`,
        why: "El aporte de salud del trabajador se calcula como IBC de salud × 4 %; el PDF no trae ese IBC y un cero no es un dato.",
        how: "Revisa la planilla original.",
        action: { label: "Ver planilla", path: NOMINA_PATH },
      });
    }
    // Fondo de Solidaridad Pensional: sin tratamiento definido → bloquea con empleado, periodo y valor.
    for (const l of e.lines) {
      const fsp = (l.person.pensionExtras?.solidarity ?? 0) + (l.person.pensionExtras?.subsistence ?? 0);
      if (fsp > 0) {
        alerts.push({
          id: `2276:fsp:${e.key}|${l.period}`,
          code: "fsp",
          severity: "block",
          dests: ["2276"],
          title: `${e.name} · ${l.period}: Fondo de Solidaridad Pensional ${fsp.toLocaleString("es-CO")}`,
          why: "La planilla trae aporte al Fondo de Solidaridad Pensional. Su tratamiento en el 2276 está pendiente de definir: no se calcula ni se suma todavía.",
          how: "Define con el contador cómo reportarlo antes de dejar el 2276 listo.",
          action: { label: "Ver planilla", path: NOMINA_PATH },
        });
      }
    }
  }
  // Planillas de Aportes en Línea: el FSP viene por administradora (no por persona).
  for (const { planilla, batch } of data.planillas) {
    for (const e of planilla.entities) {
      if (e.kind === "AFP" && (e.fsp ?? 0) > 0) {
        alerts.push({
          id: `2276:fsp-entity:${batch.id}|${e.code}`,
          code: "fsp",
          severity: "block",
          dests: ["2276"],
          title: `Fondo de Solidaridad Pensional no asignable al empleado · ${e.name} · ${planilla.period} · ${(e.fsp ?? 0).toLocaleString("es-CO")}`,
          why: `El PDF de Aportes en Línea solo informa el Fondo de Solidaridad Pensional por administradora (${e.name}, periodo ${planilla.period}, valor ${(e.fsp ?? 0).toLocaleString("es-CO")}) y no por empleado: no puede asignarse al empleado y no se inventa una distribución individual.`,
          how: "Define con el contador cómo reportarlo, o consigue el detalle por empleado, antes de dejar el 2276 listo.",
          action: { label: "Ver planilla", path: NOMINA_PATH },
        });
      }
    }
  }
  if (uncovered.length) {
    alerts.push({
      id: "2276:coverage",
      code: "coverage",
      severity: "block",
      dests: ["2276"],
      title: `Faltan ${uncovered.length} ${uncovered.length === 1 ? "mes" : "meses"} por cubrir`,
      why: `2276 es anual: no se puede dejar listo ni exportar hasta que cada mes tenga una planilla válida o «Periodo sin nómina» (faltan ${uncovered.map(monthName).join(", ")}).`,
      how: "Importa la planilla del mes o regístralo como «Periodo sin nómina».",
      action: { label: "Abrir Nómina", path: NOMINA_PATH },
    });
  }

  const proposals: SyncProposal[] = [];
  if (company)
    for (const e of out) {
      const code = dianDocType(e.docType);
      if (!e.confirmed || !code) continue;
      const a = e.amounts;
      proposals.push({
        sourceKey: `empleado:${e.docType}-${e.docNumber}`,
        origin: "estados_financieros",
        originRef: `Nómina · ${e.periods.length} ${e.periods.length === 1 ? "periodo" : "periodos"}`,
        data: {
          entity: "1",
          docTypeCode: code,
          docNumber: e.docNumber,
          firstSurname: e.confirmed.firstSurname,
          secondSurname: e.confirmed.secondSurname,
          firstName: e.confirmed.firstName,
          otherNames: e.confirmed.otherNames,
          address: company.direccion,
          deptCode: company.deptCode,
          muniCode: company.muniCode,
          countryCode: company.countryCode,
          salaries: a.salaries,
          ecclesiastical: 0,
          vouchers: 0,
          foodExcess: 0,
          fees: 0,
          services: 0,
          commissions: 0,
          benefits: a.benefits,
          perDiem: 0,
          representation: 0,
          cooperative: 0,
          educationSupport: 0,
          otherPayments: a.otherPayments,
          severanceAndInterest: a.severanceAndInterest,
          severanceFund: 0,
          severanceAid: 0,
          pensions: 0,
          grossTotal: a.grossTotal,
          healthContribution: a.healthContribution,
          pensionContribution: a.pensionContribution,
          voluntaryRais: 0,
          voluntaryFunds: 0,
          afc: 0,
          avc: 0,
          withholding: 0,
          ivaHigher: 0,
          ivaWithholding: 0,
          foodUpTo: 0,
          avgIncome6m: a.avgIncome6m,
          exactCents: { ...e.amountsCents },
        },
      });
    }
  return { employees: out, proposals, alerts, uncovered };
}
