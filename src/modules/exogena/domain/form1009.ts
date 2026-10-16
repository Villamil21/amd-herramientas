import { bankAccountingCents } from "../../financial-statements/generator/engine";
import type { Statements } from "../../financial-statements/generator/engine";
import { taxEffects, type TaxInput, type TaxTrace } from "../../financial-statements/tax-obligations/services/effects";
import type { ExoRecord, RecordData, SyncProposal } from "../../../types/exogena";
import type { BatchSummary, FsCatalog, FsPucMapping, Movement } from "../../../types/fs";
import type { Company, Supplier } from "../../../types/models";
import type { CatalogIndex } from "./catalogIndex";
import { centsToPesos } from "./numbers";
import { isPayableAtCut, readPlanillaEntities, type PlanillaEntity } from "./planillaEntities";
import type { Problem } from "./problems";
import { COLOMBIA, documentNumber, thirdPartyOf } from "./thirdParty";
import { checkThirdPartyData } from "./thirdPartyCheck";
import { nitDigits } from "./text";

/**
 * Formato 1009 — Saldo de cuentas por pagar al 31 de diciembre.
 *
 * Es un ESTADO por tercero al cierre anual (no una lista de pagos). Se arma, para el año y el corte seleccionados, de:
 *  - Compras y demás movimientos activos con tercero cuya deuda existe al corte (settlesOn vacío o posterior).
 *  - Obligaciones tributarias (IVA, retención en la fuente y renta: saldo declarado — sanciones incluidas — menos pagos con fecha ≤ corte) → proveedor DIAN.
 *  - Seguridad social: el valor liquidado de cada entidad de las planillas pagadas después del corte o pendientes.
 *
 * Nada se calcula con datos posteriores al 31 de diciembre del año informado: un informe 2025 nunca muestra deudas de 2026.
 */

export const FORMAT_1009 = "1009";
export const DIAN_NIT = "800197268";

export const CONCEPTS_1009: { code: string; label: string }[] = [
  { code: "2201", label: "Pasivos con proveedores" },
  { code: "2202", label: "Pasivos con compañías vinculadas, accionistas y socios" },
  { code: "2203", label: "Obligaciones financieras" },
  { code: "2204", label: "Pasivos por impuestos, gravámenes y tasas" },
  { code: "2206", label: "Demás pasivos" },
  { code: "2214", label: "Aportes parafiscales, salud, pensión y cesantías" },
  { code: "2215", label: "Pasivos laborales consolidados en cabeza del trabajador" },
];

/** Concepto 1009 según el PUC de la obligación (por prefijo: no depende de cómo se llamen las líneas del catálogo). */
export function conceptForPuc(pucCode: string): string {
  const p = pucCode.trim();
  if (/^(2355|2305|2310|2315)/.test(p)) return "2202";
  if (/^2370/.test(p)) return "2214";
  // Retención en la fuente (2365), IVA retenido (2367) e ICA retenido (2368): impuestos aunque estén en el grupo 23.
  if (p.startsWith("236")) return "2204";
  if (p.startsWith("21")) return "2203";
  if (p.startsWith("22") || p.startsWith("23")) return "2201";
  if (p.startsWith("24")) return "2204";
  if (p.startsWith("25")) return "2215";
  return "2206";
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const LIABILITY_SECTIONS = ["liability_current", "liability_noncurrent"];
/** Conceptos de movimiento de nómina que son aportes de seguridad social por pagar (se detallan por entidad desde la planilla). */
const SS_PAYABLE = /^payroll\.(pension|health|arl|ccf)\.payable$/;

/** Datos del tercero de un registro 1009 (los mismos campos que el 1010 más su ficha). */
export interface ThirdFields1009 {
  supplierId: number | null;
  thirdName: string;
  personType: "PJ" | "PN" | null;
  docTypeCode: string;
  docNumber: string;
  dv: string;
  firstSurname: string;
  secondSurname: string;
  firstName: string;
  otherNames: string;
  businessName: string;
  address: string;
  deptCode: string;
  muniCode: string;
  countryCode: string;
}

export interface Data1009 extends RecordData, ThirdFields1009 {
  concept: string;
  /** Tercero: `nit:<número>` (estable aunque la ficha se cree después). */
  thirdKey: string;
  /** De dónde sale el saldo: «compras», «tributaria», «seguridad_social». */
  sources: string[];
  /** Obligaciones tributarias de las que sale el saldo (impuesto, periodo, formulario, valor declarado, pagos y corte). Las correcciones manuales no las alteran. */
  taxTrace?: TaxTrace[];
  /** Saldo exacto en centavos y en pesos enteros (lo que se exporta). */
  balanceCents: number;
  balance: number;
}

export interface Sources1009 {
  year: number;
  company: Pick<Company, "shareholders">;
  suppliers: Supplier[];
  movements: Movement[];
  catalog: FsCatalog;
  mappings: FsPucMapping[];
  /** Lotes activos de la empresa (los de Nómina traen el detalle por entidad). */
  batches: BatchSummary[];
  tax: TaxInput;
  /** Estados al corte (el total de pasivos del ESF sale de aquí). */
  statements: Pick<Statements, "esf">;
}

/** Una obligación que no se puede asignar a un tercero o que no cuadra con el ESF. */
export interface UnmatchedItem {
  kind: "no_third_party" | "ss_without_entities" | "tax_unconfigured" | "residual";
  label: string;
  cents: number;
  detail?: string;
  action?: { label: string; path: string };
}

export interface Built1009 {
  proposals: SyncProposal[];
  unmatched: UnmatchedItem[];
  /** Pendientes de las fuentes (por ejemplo cuentas PUC de impuestos sin configurar). */
  issues: Problem[];
  liabilitiesCents: number;
  /** Para informar qué fuentes se leyeron y cuántos registros salieron de cada una. */
  summary: { sources: string[]; purchases: number; tax: number; socialSecurity: number; unmatched: number };
}

function supplierByNit(suppliers: Supplier[]): Map<string, Supplier> {
  return new Map(suppliers.map((s) => [nitDigits(s.nit), s]));
}

/** Datos del tercero tomados de su ficha (o de lo que traiga la fuente, si aún no tiene ficha). */
export function thirdPartyFields(nit: string, fallbackName: string, supplier: Supplier | undefined, fallback?: Partial<ThirdFields1009>): ThirdFields1009 {
  if (supplier) {
    const t = thirdPartyOf(supplier);
    const legal = t.personType === "PJ";
    const colombia = t.countryCode === COLOMBIA;
    return {
      supplierId: supplier.id,
      thirdName: supplier.businessName,
      personType: t.personType,
      docTypeCode: t.docTypeCode ?? "",
      docNumber: documentNumber(supplier.nit, t.docTypeCode),
      dv: t.docTypeCode === "31" ? t.dv : "",
      firstSurname: legal ? "" : t.firstSurname,
      secondSurname: legal ? "" : t.secondSurname,
      firstName: legal ? "" : t.firstName,
      otherNames: legal ? "" : t.otherNames,
      businessName: legal ? supplier.businessName : "",
      address: t.address,
      deptCode: colombia ? t.deptCode : "",
      muniCode: colombia ? t.muniCode : "",
      countryCode: t.countryCode,
    };
  }
  return {
    supplierId: null,
    thirdName: fallbackName || nit,
    personType: null,
    docTypeCode: "",
    docNumber: nit,
    dv: "",
    firstSurname: "",
    secondSurname: "",
    firstName: "",
    otherNames: "",
    businessName: "",
    address: "",
    deptCode: "",
    muniCode: "",
    countryCode: "",
    ...fallback,
  };
}

/** Movimientos activos que son deuda al corte (misma regla del ESF: clasificados en una línea de pasivo y no pagados a esa fecha). */
export function openLiabilityMovements(movements: Movement[], catalog: FsCatalog, mappings: FsPucMapping[], end: string): { movement: Movement; cents: number }[] {
  const lines = new Map(catalog.lines.map((l) => [l.id, l]));
  const mapping = new Map(mappings.map((m) => [m.pucCode, m]));
  const out: { movement: Movement; cents: number }[] = [];
  for (const mv of movements) {
    if (mv.status !== "active" || mv.source === "sales_tpsv" || mv.accountingDate > end) continue;
    const m = mapping.get(mv.pucCode);
    if (!m || m.excluded || !m.lineId) continue;
    const line = lines.get(m.lineId);
    if (!line || !line.isActive || !LIABILITY_SECTIONS.includes(line.section)) continue;
    if (mv.settlesOn && mv.settlesOn <= end) continue;
    // Una deuda tiene naturaleza crédito: una entrada del banco (C) la aumenta, una salida (D) la reduce.
    out.push({ movement: mv, cents: mv.dc ? bankAccountingCents(mv.dc, mv.amountCents, false) : mv.amountCents });
  }
  return out;
}

interface Group {
  nit: string;
  concept: string;
  name: string;
  cents: number;
  sources: Set<string>;
  refs: Set<string>;
  fallback?: Partial<ThirdFields1009>;
  traces: TaxTrace[];
}

/**
 * Propuestas del 1009 al corte del 31 de diciembre de `year`, más lo que no se puede asignar a un tercero.
 * Función pura: no lee ni escribe nada.
 */
export function build1009(src: Sources1009): Built1009 {
  const end = `${src.year}-12-31`;
  const bySupplier = supplierByNit(src.suppliers);
  const shareholderDocs = new Set(src.company.shareholders.map((s) => documentNumber(s.identityDocument.replace(/^[A-Za-z. ]+/, ""), null)).filter(Boolean));
  const groups = new Map<string, Group>();
  const unmatched: UnmatchedItem[] = [];
  const issues: Problem[] = [];
  const add = (nit: string, concept: string, name: string, cents: number, source: string, ref: string, fallback?: Partial<ThirdFields1009>, trace?: TaxTrace) => {
    const key = `nit:${nit}|${concept}`;
    const g = groups.get(key) ?? { nit, concept, name, cents: 0, sources: new Set(), refs: new Set(), fallback, traces: [] };
    if (trace) g.traces.push(trace);
    g.cents += cents;
    g.sources.add(source);
    if (ref) g.refs.add(ref);
    if (!g.name && name) g.name = name;
    groups.set(key, g);
  };

  // 1. Movimientos con tercero. Los aportes de seguridad social por pagar se detallan por entidad desde la planilla.
  const ssOpenByBatch = new Map<number, number>();
  const withoutThird = new Map<string, UnmatchedItem>();
  for (const { movement: mv, cents } of openLiabilityMovements(src.movements, src.catalog, src.mappings, end)) {
    if (SS_PAYABLE.test(mv.conceptKey)) {
      ssOpenByBatch.set(mv.batchId, (ssOpenByBatch.get(mv.batchId) ?? 0) + cents);
      continue;
    }
    const nit = nitDigits(mv.supplierNit) || (mv.supplierId !== null ? nitDigits(src.suppliers.find((s) => s.id === mv.supplierId)?.nit ?? "") : "");
    if (!nit) {
      const who = mv.supplierName || (mv.employeeId !== null ? "Empleado" : mv.bank || "Sin tercero");
      const key = `${mv.pucCode}|${who}`;
      const item = withoutThird.get(key) ?? { kind: "no_third_party" as const, label: `${who} · PUC ${mv.pucCode}${mv.pucConcept ? ` ${mv.pucConcept}` : ""}`, cents: 0, detail: "", action: { label: "Ver movimientos", path: "/herramientas/estados-financieros/movimientos-contables" } };
      item.cents += cents;
      withoutThird.set(key, item);
      continue;
    }
    const supplier = bySupplier.get(nit);
    let concept = conceptForPuc(mv.pucCode);
    if (nit === DIAN_NIT) concept = "2204";
    else if (shareholderDocs.has(nit)) concept = "2202";
    add(nit, concept, supplier?.businessName ?? mv.supplierName, cents, "compras", mv.documentNumber || mv.documentId);
  }
  unmatched.push(...[...withoutThird.values()].filter((i) => i.cents !== 0));

  // 2. Obligaciones tributarias pendientes al corte → DIAN (concepto 2204): el mismo saldo del ESF (el total declarado ya incluye las sanciones del formulario).
  const tax = taxEffects(src.tax, end);
  let taxTotal = 0;
  // Los excedentes a favor y la CxC a socios afectan EEFF y 1008, no el 1009.
  for (const issue of tax.issues) if (issue.level === "blocking" && issue.code !== "excess_review" && issue.taxType !== "capital") issues.push({ level: "blocking", message: issue.message, action: { label: "Obligaciones tributarias", path: "/herramientas/estados-financieros/obligaciones-tributarias" } });
  for (const effect of tax.effects) {
    if (effect.kind !== "withholding_payable" && effect.kind !== "vat_payable" && effect.kind !== "income_payable" && effect.kind !== "sanction_payable") continue;
    if (!effect.pucCode) {
      unmatched.push({ kind: "tax_unconfigured", label: `${effect.label}: falta la cuenta PUC`, cents: effect.cents, action: { label: "Obligaciones tributarias", path: "/herramientas/estados-financieros/obligaciones-tributarias" } });
      continue;
    }
    taxTotal += effect.cents;
    add(DIAN_NIT, "2204", bySupplier.get(DIAN_NIT)?.businessName ?? "DIAN", effect.cents, "tributaria", effect.label, undefined, effect.trace);
  }

  // 3. Seguridad social: valor liquidado por entidad de las planillas pagadas después del corte o pendientes.
  const payroll = src.batches.filter((b) => b.source === "payroll" && b.status === "active");
  let ssTotal = 0;
  for (const batch of payroll) {
    const entities = readPlanillaEntities(batch).filter((e) => isPayableAtCut(e, end));
    const covered = entities.reduce((n, e) => n + e.liquidated * 100, 0);
    for (const e of entities) {
      ssTotal += e.liquidated * 100;
      add(e.nit, "2214", e.name, e.liquidated * 100, "seguridad_social", `${batch.periodLabel} · ${e.type}`, entityFallback(e));
    }
    const open = ssOpenByBatch.get(batch.id) ?? 0;
    if (open > covered) {
      unmatched.push({
        kind: "ss_without_entities",
        label: `${batch.periodLabel}: aportes por pagar sin detalle por entidad`,
        cents: open - covered,
        detail: covered === 0 ? "La planilla se envió antes de guardar las entidades. Vuelve a importarla en Nómina y envíala de nuevo." : "Los aportes por pagar superan el resumen de pago de la planilla.",
        action: { label: "Nómina", path: "/herramientas/estados-financieros/nomina" },
      });
    }
    ssOpenByBatch.delete(batch.id);
  }
  // Lotes de nómina que ya no están activos pero dejaron aportes por pagar: se muestran igual.
  for (const [batchId, open] of ssOpenByBatch) {
    const batch = src.batches.find((b) => b.id === batchId);
    unmatched.push({ kind: "ss_without_entities", label: `${batch?.periodLabel ?? `Lote ${batchId}`}: aportes por pagar sin detalle por entidad`, cents: open, action: { label: "Nómina", path: "/herramientas/estados-financieros/nomina" } });
  }

  const proposals: SyncProposal[] = [];
  for (const [key, g] of groups) {
    if (g.cents === 0) continue;
    const supplier = bySupplier.get(g.nit);
    const base = thirdPartyFields(g.nit, g.name, supplier, g.fallback);
    const data: Data1009 = { concept: g.concept, thirdKey: `nit:${g.nit}`, ...base, sources: [...g.sources].sort(), ...(g.traces.length && { taxTrace: g.traces.sort((a, b) => a.returnId - b.returnId) }), balanceCents: g.cents, balance: centsToPesos(g.cents) };
    proposals.push({ sourceKey: key, origin: "estados_financieros", originRef: [...g.refs].slice(0, 6).join(" · ") || "Estados Financieros", data });
  }
  proposals.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));

  return {
    proposals,
    unmatched,
    issues,
    liabilitiesCents: src.statements.esf.liabilities,
    summary: {
      sources: ["compras y movimientos", "obligaciones tributarias", "planillas de seguridad social"],
      purchases: proposals.filter((p) => (p.data.sources as string[]).includes("compras")).length,
      tax: taxTotal === 0 ? 0 : 1,
      socialSecurity: proposals.filter((p) => (p.data.sources as string[]).includes("seguridad_social")).length,
      unmatched: unmatched.length,
    },
  };
}

/** Una entidad de seguridad social sin ficha: tipo de documento NIT y persona jurídica (son datos de la planilla, no suposiciones). */
function entityFallback(e: PlanillaEntity): Partial<ThirdFields1009> {
  return { dv: e.dv, docTypeCode: "31", personType: "PJ", businessName: e.name, thirdName: e.name };
}

// ---------------------------------------------------------------------------
// Conciliación y validación
// ---------------------------------------------------------------------------

export interface Reconciliation {
  /** Total de pasivos del ESF al 31/12 (centavos). */
  liabilitiesCents: number;
  /** Suma de los registros del 1009 (centavos). */
  recordsCents: number;
  differenceCents: number;
  /** Lo que explica la diferencia, para resolverlo; el resto se muestra como «Otras diferencias». */
  items: UnmatchedItem[];
}

const cents = (r: Pick<ExoRecord, "data">) => (typeof r.data.balanceCents === "number" ? r.data.balanceCents : 0);

export function reconcile(built: Pick<Built1009, "liabilitiesCents" | "unmatched">, records: Pick<ExoRecord, "data">[]): Reconciliation {
  const recordsCents = records.reduce((n, r) => n + cents(r), 0);
  const differenceCents = built.liabilitiesCents - recordsCents;
  const explained = built.unmatched.reduce((n, i) => n + i.cents, 0);
  const items = [...built.unmatched];
  const residual = differenceCents - explained;
  if (residual !== 0) {
    items.push({ kind: "residual", label: "Otras diferencias (correcciones manuales o cuentas sin movimientos individuales)", cents: residual });
  }
  return { liabilitiesCents: built.liabilitiesCents, recordsCents, differenceCents, items };
}

/**
 * Pendientes del 1009 con sus datos finales (incluidas las correcciones manuales). Un registro sincronizado cuyo tercero no
 * tiene ficha solo pide crearla (sus datos salen de la ficha); uno manual debe traer sus datos completos.
 */
export function checkRecord1009(record: Pick<ExoRecord, "sourceKey" | "data"> & { origin?: string }, catalog: CatalogIndex): Problem[] {
  const d = record.data as Partial<Data1009>;
  const label = `${d.thirdName || record.sourceKey} (${d.concept ?? "sin concepto"})`;
  const manual = record.origin === "manual";
  const out: Problem[] = [];
  if (!manual && (d.supplierId === null || d.supplierId === undefined)) {
    out.push({
      level: "blocking",
      message: d.docNumber === DIAN_NIT ? `Falta el proveedor DIAN (NIT ${DIAN_NIT}): créalo o búscalo en Proveedores para usarlo como contraparte de impuestos.` : `${label}: el tercero no tiene ficha. Créala para completar sus datos.`,
      recordKey: record.sourceKey,
      field: "supplierId",
      // El enlace abre la búsqueda del proveedor y, si no existe, el formulario con el NIT puesto (DIAN: sin DV inventado).
      action: { label: d.docNumber === DIAN_NIT ? "Crear o buscar proveedor DIAN" : "Proveedores", path: `/proveedores/${str(d.docNumber)}` },
    });
  } else {
    out.push(...checkThirdPartyData(d, label, record.sourceKey, catalog));
  }
  if (!CONCEPTS_1009.some((c) => c.code === d.concept)) out.push({ level: "blocking", message: `${label}: el concepto no es válido.`, recordKey: record.sourceKey, field: "concept" });
  if (typeof d.balance !== "number" || !Number.isSafeInteger(d.balance)) out.push({ level: "blocking", message: `${label}: el saldo debe ser un entero de pesos.`, recordKey: record.sourceKey, field: "balance" });
  else if (d.balance < 0) out.push({ level: "blocking", message: `${label}: el saldo es negativo (saldo a favor del tercero, no una deuda). Revísalo.`, recordKey: record.sourceKey, field: "balance" });
  return out;
}

export function check1009(records: (Pick<ExoRecord, "sourceKey" | "data"> & { origin?: string })[], built: Built1009, reconciliation: Reconciliation, catalog: CatalogIndex, pending: { kind: string }[]): Problem[] {
  const out: Problem[] = [...built.issues];
  for (const r of records) out.push(...checkRecord1009(r, catalog));
  for (const item of built.unmatched) out.push({ level: "blocking", message: `${item.label}: sin tercero o sin correspondencia.`, action: item.action });
  if (reconciliation.differenceCents !== 0) out.push({ level: "blocking", message: "El total del 1009 no coincide con los pasivos del Estado de Situación Financiera al 31/12." });
  if (pending.length > 0) out.push({ level: "blocking", message: `Hay ${pending.length} cambios en Estados Financieros o en los terceros sin sincronizar.` });
  return out;
}
