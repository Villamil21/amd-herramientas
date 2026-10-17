import type { ExoCatalogs } from "../../../../types/exogena";
import { classifyOperations } from "./classify";
import { coverageMatrix, missingMonths, uploadCoverage, yearMonths, type MatrixMonth, type UploadCoverage } from "./coverage";
import type { DuplicateGroup } from "./duplicates";
import { componentReadiness, computeEeff, eeffComponents, type ComponentReadiness, type CryptoEeff, type PucCheck } from "./eeff";
import { buildForm1007, type Form1007 } from "./form1007";
import { buildForm1647, type Form1647 } from "./form1647";
import { buildOperations, decisionMap, type Operation } from "./operations";
import { buildPlaceLookup, type PlaceLookup } from "./places";
import { blocking, type CryptoProblem } from "./problems";
import type { CryptoDecision, CryptoPresentation, CryptoState, Homologation } from "./types";

/**
 * Modelo de Transacciones Cripto: todo se deriva, de forma determinista, del origen (cargas y filas), las decisiones del
 * usuario, la configuración PUC y el corte. Cambiar una carga, una decisión, el corte, la presentación o una cuenta PUC
 * recalcula todo; nada calculado se guarda como fuente de verdad.
 */

export interface CryptoSettings {
  cutoff: string;
  presentation: CryptoPresentation;
}

export const defaultSettings = (year: number): CryptoSettings => ({ cutoff: `${year}-12-31`, presentation: "otc" });

/** Corte y presentación guardados; un corte de otro año o ilegible vuelve al cierre del año. */
export function readSettings(decisions: readonly CryptoDecision[], year: number): CryptoSettings {
  const settings = decisionMap(decisions, "setting");
  const base = defaultSettings(year);
  const cutoff = settings.get("cutoff")?.value ?? "";
  const presentation = settings.get("presentation")?.value;
  return {
    cutoff: /^\d{4}-\d{2}-\d{2}$/.test(cutoff) && Number(cutoff.slice(0, 4)) === year ? cutoff : base.cutoff,
    presentation: presentation === "otc" || presentation === "banks" || presentation === "dr" ? presentation : base.presentation,
  };
}

const EMPTY_CATALOGS: ExoCatalogs = { version: "", source: "", documentTypes: [], countries: [], departments: [], municipalities: [] };

export interface ModelInput {
  year: number;
  state: CryptoState;
  homologations: readonly Homologation[];
  catalogs: ExoCatalogs | null;
  companyAddress: string;
  puc: (key: string) => PucCheck;
}

export interface OperationCounts {
  files: number;
  accepted: number;
  pending: number;
  excluded: number;
  acceptedPurchases: number;
  acceptedSales: number;
  pendingDuplicateGroups: number;
  coveredMonths: number;
  purchasesCents: number;
  salesCents: number;
}

export interface RowBucket {
  purchase: number;
  sale: number;
}

export interface RowReconciliation {
  /** Filas guardadas de las cargas vigentes. */
  total: number;
  accepted: RowBucket;
  /** Compras con fecha de otro año (la fecha se lee bien). */
  outOfYear: RowBucket;
  /** Fecha ilegible o valor ilegible/vacío. */
  invalid: RowBucket;
  /** Filas de grupos de posibles duplicados sin decidir (los grupos son `duplicateGroups`). */
  duplicatesPending: RowBucket;
  duplicateGroups: number;
  /** Excluidas por el usuario (fuera de año, ilegibles…). */
  excludedByUser: RowBucket;
  /** Excluidas por el usuario como duplicado. */
  excludedAsDuplicate: RowBucket;
  /** Filas de cargas retiradas: se conservan pero no cuentan (no forman parte del total). */
  retired: number;
  /** total − suma de categorías. Debe ser 0; si no, hay una fila sin estado y se bloquea todo resultado. */
  unexplained: number;
}

export interface Reconciliation {
  eeff: {
    components: ComponentReadiness[];
    resultCents: number | null;
    ownIncomeCents: number | null;
    differenceCents: number | null;
  };
  f1007: { originCents: number; proposedCents: number; unproposedCents: number; differenceCents: number };
  f1647: { originCents: number; distributedCents: number; unassignedCents: number; unproposedCents: number; unusedSalesCents: number; differenceCents: number };
  uploads: { id: number; fileName: string; version: number; status: string; coverage: string; rows: number; excluded: number; pending: number }[];
  /** Conciliación exacta de filas: cada fila de las cargas vigentes cae en una sola categoría. */
  rows: RowReconciliation;
  pending: { duplicates: number; cities: number; documentTypes: number; puc: number; requiredFields: number };
}

export interface CryptoModel {
  year: number;
  settings: CryptoSettings;
  operations: Operation[];
  groups: DuplicateGroup[];
  coverages: UploadCoverage[];
  matrix: MatrixMonth[];
  missing: string[];
  counts: OperationCounts;
  eeff: CryptoEeff;
  components: ComponentReadiness[];
  places: PlaceLookup;
  form1007: Form1007;
  form1647: Form1647;
  problems: { operations: CryptoProblem[]; eeff: CryptoProblem[]; f1007: CryptoProblem[]; f1647: CryptoProblem[] };
  reconciliation: Reconciliation;
}

const sum = (ops: readonly Operation[]) => ops.reduce((s, o) => s + (o.amountCents ?? 0), 0);

const emptyBucket = (): RowBucket => ({ purchase: 0, sale: 0 });
const bucketTotal = (b: RowBucket) => b.purchase + b.sale;

/** Cada operación cae en una sola categoría (precedencia: excluida → ilegible → fuera de año → duplicado → aceptada). */
export function reconcileRows(operations: readonly Operation[], duplicateGroups: number, retired: number): RowReconciliation {
  const r: RowReconciliation = { total: operations.length, accepted: emptyBucket(), outOfYear: emptyBucket(), invalid: emptyBucket(), duplicatesPending: emptyBucket(), duplicateGroups, excludedByUser: emptyBucket(), excludedAsDuplicate: emptyBucket(), retired, unexplained: 0 };
  for (const o of operations) {
    const codes = o.issues.map((i) => i.code);
    if (o.status === "excluded") r[o.excludedBy === "duplicate" ? "excludedAsDuplicate" : "excludedByUser"][o.kind]++;
    else if (o.status === "accepted" && codes.length === 0) r.accepted[o.kind]++;
    else if (o.status === "pending" && (codes.includes("amount") || codes.includes("date"))) r.invalid[o.kind]++;
    else if (o.status === "pending" && codes.includes("year")) r.outOfYear[o.kind]++;
    else if (o.status === "pending" && codes.includes("duplicate")) r.duplicatesPending[o.kind]++;
  }
  const explained = [r.accepted, r.outOfYear, r.invalid, r.duplicatesPending, r.excludedByUser, r.excludedAsDuplicate].reduce((s, b) => s + bucketTotal(b), 0);
  r.unexplained = r.total - explained;
  return r;
}

export function buildModel(input: ModelInput): CryptoModel {
  const { year, state } = input;
  const catalogs = input.catalogs ?? EMPTY_CATALOGS;
  const settings = readSettings(state.decisions, year);
  const stored = new Map(input.homologations.filter((h) => h.kind === "document").map((h) => [h.sourceKey, h.value]));
  const docLookup = { stored, catalogCodes: new Set(catalogs.documentTypes.filter((d) => d.isActive).map((d) => d.code)) };
  const places = buildPlaceLookup(catalogs, input.homologations);

  const raw = buildOperations(state.uploads, state.rows, { year, docLookup });
  const { operations, groups } = classifyOperations(raw, state.decisions);
  const activeUploads = state.uploads.filter((u) => u.status === "active");
  const coverages = activeUploads.map((u) => uploadCoverage(u, operations, year));
  const matrix = coverageMatrix(year, coverages);
  const missing = missingMonths(year, coverages);

  const accepted = operations.filter((o) => o.status === "accepted");
  const pendingOps = operations.filter((o) => o.status === "pending");
  const eeff = computeEeff({ year, cutoff: settings.cutoff, operations, coverages });
  const components = componentReadiness(eeffComponents(settings.presentation, eeff), input.puc);

  const countryDecisions = new Map([...decisionMap(state.decisions, "country")].map(([k, d]) => [k, d.value]));
  const cityDecisions = new Map([...decisionMap(state.decisions, "city")].map(([k, d]) => [k, d.value]));
  const assignments = new Map([...decisionMap(state.decisions, "assignment")].map(([k, d]) => [k, d.value]));
  const form1007 = buildForm1007(operations, countryDecisions);
  const form1647 = buildForm1647({ purchases: operations, sales: operations, places, companyAddress: input.companyAddress, assignments, cityDecisions, countryDecisions });

  // Pendientes de las operaciones (comunes a todo resultado).
  const opProblems: CryptoProblem[] = [];
  const unresolved = groups.filter((g) => !g.resolved);
  const rows = reconcileRows(operations, unresolved.length, state.rows.length - operations.length);
  if (rows.unexplained !== 0) opProblems.push({ level: "blocking", kind: "unclassified", message: `${rows.unexplained} ${rows.unexplained === 1 ? "fila no tiene" : "filas no tienen"} un estado definido: ningún resultado puede calcularse hasta explicarlas.` });
  if (unresolved.length) opProblems.push({ level: "blocking", kind: "duplicate", message: `${unresolved.length} ${unresolved.length === 1 ? "grupo de posibles duplicados espera" : "grupos de posibles duplicados esperan"} tu decisión: sus filas no cuentan hasta entonces.` });
  const outOfYear = pendingOps.filter((o) => o.issues.some((i) => i.code === "year" || i.code === "date"));
  if (outOfYear.length) opProblems.push({ level: "blocking", kind: "year", message: `${outOfYear.length} ${outOfYear.length === 1 ? "compra tiene" : "compras tienen"} fecha fuera del año ${year} o ilegible: exclúyelas o corrige el archivo y vuelve a importarlo con el mismo nombre.` });
  const badAmount = pendingOps.filter((o) => o.issues.some((i) => i.code === "amount"));
  if (badAmount.length) opProblems.push({ level: "blocking", kind: "amount", message: `${badAmount.length} ${badAmount.length === 1 ? "fila tiene" : "filas tienen"} un valor ilegible o vacío: exclúyelas o corrige el archivo.` });

  // Pendientes de Estados Financieros.
  const eeffProblems: CryptoProblem[] = [...opProblems];
  if (accepted.length === 0) eeffProblems.push({ level: "blocking", kind: "coverage", message: "No hay operaciones aceptadas para calcular." });
  if (settings.cutoff.slice(0, 4) !== String(year)) eeffProblems.push({ level: "blocking", kind: "cutoff", message: `La fecha de corte debe estar dentro de ${year}.` });
  for (const reason of eeff.blockedSales) eeffProblems.push({ level: "blocking", kind: "coverage", message: reason });
  for (const c of components) if (c.issue) eeffProblems.push({ level: "blocking", kind: c.cents === null ? "coverage" : "puc", message: `${c.label}: ${c.issue}`, payload: { pucKey: c.pucKey } });
  const withPending = matrix.filter((m) => m.pending.length && m.month <= settings.cutoff.slice(0, 7)).map((m) => m.month);
  if (withPending.length) eeffProblems.push({ level: "warning", kind: "coverage", message: `${withPending.length === 1 ? "El mes" : "Los meses"} ${withPending.join(", ")} ${withPending.length === 1 ? "tiene" : "tienen"} filas pendientes por resolver y no se marca${withPending.length === 1 ? "" : "n"} como cubierto${withPending.length === 1 ? "" : "s"} hasta aceptarlas o excluirlas.` });
  const lacking = yearMonths(year).filter((m) => m <= settings.cutoff.slice(0, 7) && missing.includes(m) && !withPending.includes(m));
  if (lacking.length) eeffProblems.push({ level: "warning", kind: "coverage", message: `Sin cargas para ${lacking.length === 1 ? "el mes" : "los meses"} ${lacking.join(", ")}: el resultado solo incluye lo importado.` });

  const f1007Problems = [...opProblems, ...form1007.problems];
  const f1647Problems = [...opProblems, ...form1647.problems];

  const allResultProblems = [...f1007Problems, ...f1647Problems];
  const countKind = (kinds: CryptoProblem["kind"][]) => allResultProblems.filter((p) => kinds.includes(p.kind)).length;
  const resultCents = components.every((c) => c.cents !== null) ? components.reduce((s, c) => s + (c.key === "cost_of_sales" || c.key === "third_cost" ? -(c.cents ?? 0) : c.cents ?? 0), 0) : null;
  const reconciliation: Reconciliation = {
    eeff: { components, resultCents, ownIncomeCents: eeff.ownIncomeCents, differenceCents: resultCents === null || eeff.ownIncomeCents === null ? null : resultCents - eeff.ownIncomeCents },
    f1007: { originCents: form1007.originCents, proposedCents: form1007.includedCents, unproposedCents: form1007.unproposedCents, differenceCents: form1007.originCents - form1007.includedCents },
    f1647: {
      originCents: form1647.originCents,
      distributedCents: form1647.assignedCents,
      unassignedCents: form1647.unassignedCents,
      unproposedCents: form1647.unproposedCents,
      unusedSalesCents: form1647.unusedSalesCents,
      differenceCents: form1647.originCents - form1647.assignedCents,
    },
    rows,
    uploads: state.uploads.map((u) => {
      const own = operations.filter((o) => o.uploadId === u.id);
      const cov = coverages.find((c) => c.uploadId === u.id);
      return { id: u.id, fileName: u.fileName, version: u.version, status: u.status, coverage: cov?.months.length ? `${cov.first} a ${cov.last}${cov.overridden ? " (ajustada)" : ""}` : "Sin cobertura", rows: u.rowCount, excluded: own.filter((o) => o.status === "excluded").length, pending: own.filter((o) => o.status === "pending").length };
    }),
    pending: {
      duplicates: unresolved.length,
      cities: form1647.problems.filter((p) => p.kind.startsWith("city_")).length,
      documentTypes: new Set([...form1007.problems, ...form1647.problems].filter((p) => p.kind === "document_type").map((p) => String(p.payload?.docTypeKey ?? ""))).size,
      puc: components.filter((c) => c.issue && c.cents !== null).length,
      requiredFields: countKind(["name", "identification", "country", "address", "assignment", "unproposed"]),
    },
  };

  const counts: OperationCounts = {
    files: activeUploads.length,
    accepted: accepted.length,
    pending: pendingOps.length,
    excluded: operations.filter((o) => o.status === "excluded").length,
    acceptedPurchases: accepted.filter((o) => o.kind === "purchase").length,
    acceptedSales: accepted.filter((o) => o.kind === "sale").length,
    pendingDuplicateGroups: unresolved.length,
    coveredMonths: new Set(coverages.flatMap((c) => c.months)).size,
    purchasesCents: sum(accepted.filter((o) => o.kind === "purchase")),
    salesCents: sum(accepted.filter((o) => o.kind === "sale")),
  };

  return { year, settings, operations, groups, coverages, matrix, missing, counts, eeff, components, places, form1007, form1647, problems: { operations: opProblems, eeff: eeffProblems, f1007: f1007Problems, f1647: f1647Problems }, reconciliation };
}

/** Motivo (el primero) que impide marcar un resultado como listo; null = listo. */
export const firstBlocker = (problems: readonly CryptoProblem[]): string | null => blocking(problems)[0]?.message ?? null;

