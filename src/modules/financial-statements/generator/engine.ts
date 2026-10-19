import type { Company } from "../../../types/models";
import {
  EERR_SECTIONS,
  ESF_SECTIONS,
  SECTION_LABEL,
  type BankAccountLifecycle,
  type BankBalance,
  type FsCatalog,
  type FsLine,
  type FsPucMapping,
  type FsSectionKey,
  type FsSource,
  type Movement,
  type Presentation,
} from "../../../types/fs";
import { estimatedIncomeTax, monthsBetween, roundThousands } from "../shared/money";
import { buildMappingResolver, familyOf } from "../shared/pucGroups";
import { taxEffects, type TaxEffects, type TaxInput } from "../tax-obligations/services/effects";
import { CAPITAL_RECEIVABLE_KEY, SHORT_TAX_LABEL } from "../tax-obligations/types";

/**
 * Motor de los Estados Financieros: consolida los movimientos de UNA empresa
 * por código PUC y por el Catálogo de cuentas, y arma el Estado de Situación
 * Financiera (saldos a la fecha final) y el Estado de Resultados (movimientos
 * del rango). Función pura: no lee ni escribe nada.
 *
 * - La ubicación de cada PUC sale solo del catálogo (nunca del signo, prefijo
 *   o descripción). Un PUC con movimientos y sin destino bloquea.
 * - Valores exactos en centavos; el redondeo al millar es de presentación.
 * - Signo bancario ≠ signo contable: una salida del banco (D) aumenta una cuenta
 *   de naturaleza débito (gasto, costo, activo) y una entrada (C) la reduce, así
 *   que un concepto de gasto vale salidas − entradas (negativo solo si las
 *   devoluciones superan los cargos).
 * - Saldo bancario: la foto del MES de la fecha final de cada cuenta (no se suman
 *   meses). Sin ella la cuenta queda pendiente: el último saldo conocido es solo
 *   referencia y nunca entra al ESF.
 * - Cuenta por pagar: cuenta mientras no se haya pagado a la fecha final (settlesOn).
 * - Obligaciones tributarias: el efecto de las declaraciones guardadas a la
 *   fecha final (por pagar, saldos a favor como foto, anticipo del año y
 *   resultados fiscales de años anteriores); ver tax-obligations/services/effects.
 *   La Retefuente pendiente de años anteriores al del corte se presenta en el
 *   pasivo no corriente aunque su PUC esté en una línea corriente.
 * - Clasificación por grupo de cuatro dígitos: 2370 cubre todas sus subcuentas. Los códigos sin clasificar se agrupan por
 *   esos cuatro dígitos (con las subcuentas como trazabilidad) y las clasificaciones antiguas de seis dígitos que se
 *   contradicen se reportan como conflicto en vez de elegir una (ver shared/pucGroups).
 * - Corriente / no corriente: la línea del PUC es la clasificación BASE. Los saldos pendientes de una línea corriente
 *   (activo o pasivo) cuyo origen es de un año anterior al de la fecha final se presentan en la línea no corriente del
 *   MISMO nombre. El origen es la fecha contable del movimiento; los pagos y cruces disminuyen primero el documento al
 *   que hacen referencia y, si no lo tienen, el origen más antiguo (PEPS) de la misma cuenta. Un cruce sin origen no se
 *   adivina: queda para revisión. Si falta la línea no corriente equivalente el valor se queda en su línea corriente y
 *   el periodo se bloquea hasta crearla. Nada de esto cambia el PUC ni los movimientos: es presentación del periodo.
 * - Capital social: el capital suscrito de la empresa; la diferencia con el
 *   pagado va a 132505 (A socios).
 * - Reporte de operaciones (cripto): resultado propio = ventas − compras. Banco:
 *   ingresos y costo de terceros = promedio mensual de ventas. OTC: se condensa
 *   en Ventas y Costo de Ventas. El resultado nunca cambia por la presentación.
 */


/** Secciones de naturaleza débito: una salida del banco (D) las aumenta. */
const DEBIT_SECTIONS = new Set<FsSectionKey>(["asset_current", "asset_noncurrent", "costs", "admin_expenses", "sales_expenses", "other_expenses"]);

/** Clases PUC de naturaleza débito (activo, gastos, costos, cuentas de orden deudoras). */
const DEBIT_PUC_CLASSES = new Set(["1", "5", "6", "7", "8"]);

/**
 * Valor contable de un movimiento bancario (centavos, valor absoluto + dirección):
 * positivo cuando la dirección coincide con la naturaleza de la cuenta.
 * Gasto: salida → +, entrada (devolución) → −.
 */
export const bankAccountingCents = (dc: "D" | "C", cents: number, debitNature: boolean) => ((dc === "D") === debitNature ? cents : -cents);

/** Naturaleza de un PUC aún sin línea del catálogo: solo para mostrarlo con su signo contable mientras se clasifica. */
export const isDebitPuc = (pucCode: string) => DEBIT_PUC_CLASSES.has(pucCode.trim().charAt(0));

export interface EngineInput {
  company: Pick<Company, "subscribedTotalShares" | "subscribedNominalValue" | "paidTotalShares" | "paidNominalValue">;
  catalog: FsCatalog;
  mappings: FsPucMapping[];
  movements: Movement[];
  bankBalances: BankBalance[];
  /** Concepto de cada código PUC (para mostrar los pendientes). */
  pucConcepts?: Map<string, string>;
  start: string;
  end: string;
  presentation: Presentation;
  /** Declaraciones tributarias de la empresa (Obligaciones tributarias). */
  tax?: TaxInput;
  /** Cuenta PUC de la CxC a socios (capital suscrito − pagado). Sin ella la diferencia no entra a EEFF. */
  capitalReceivablePuc?: string | null;
  /** Apertura / cierre confirmados de las cuentas bancarias. */
  bankLifecycles?: BankAccountLifecycle[];
}

export interface Contribution {
  pucCode: string;
  concept: string;
  cents: number;
  count: number;
}

export interface LineValue {
  line: FsLine;
  cents: number;
  /** De dónde sale el valor (por PUC), para revisar. */
  contributions: Contribution[];
  /** Valor automático (capital, resultado del ejercicio, presentación Banco / OTC). */
  automatic?: string;
}

export interface SectionValue {
  key: FsSectionKey;
  lines: LineValue[];
  totalCents: number;
  representativeLineId: number | null;
}

/** Un valor sin clasificar con su origen (trazabilidad desde el grupo hasta el documento). */
export interface UnclassifiedEntry {
  movementId?: number;
  date: string | null;
  source?: FsSource;
  documentNumber: string;
  description: string;
  cents: number;
}

/** Subcuenta (seis dígitos) de un grupo sin clasificar: solo trazabilidad. */
export interface UnclassifiedChild {
  pucCode: string;
  concept: string;
  count: number;
  cents: number;
  entries: UnclassifiedEntry[];
}

/** Grupo de cuatro dígitos sin clasificar: se clasifica una sola vez para todas sus subcuentas. */
export interface UnclassifiedPuc {
  /** Código agrupador de cuatro dígitos. */
  pucCode: string;
  concept: string;
  count: number;
  cents: number;
  /** El PUC apunta a una línea desactivada. */
  inactiveLine?: string;
  children: UnclassifiedChild[];
}

/** Clasificaciones antiguas de subcuentas de un mismo grupo que se contradicen: se resuelven desde el grupo. */
export interface MappingConflict {
  family: string;
  concept: string;
  count: number;
  cents: number;
  options: { key: string; lineId: number | null; excluded: boolean; label: string; codes: string[] }[];
}

/** Saldo pendiente de una línea corriente presentado en su contraparte no corriente (auditoría). */
export interface Reclassification {
  /** Línea corriente base (la del PUC) y la no corriente donde se presentó. */
  lineId: number;
  lineName: string;
  targetLineId: number;
  targetLineName: string;
  pucCode: string;
  concept: string;
  /** Fecha contable del movimiento de origen; sin ella (obligaciones tributarias) solo se conoce que es de un año anterior. */
  originDate: string | null;
  originYear: number | null;
  /** Años entre el origen y la fecha final del informe. */
  ageYears: number | null;
  /** Documento / referencia del origen. */
  document: string;
  movementId?: number;
  source?: FsSource;
  /** Valor original del movimiento, lo aplicado por pagos o cruces y lo que queda pendiente (el reclasificado). */
  originalCents: number;
  appliedCents: number;
  pendingCents: number;
}

/** Valor reclasificado agrupado por antigüedad. */
export interface ReclassificationAge {
  originYear: number | null;
  ageYears: number | null;
  cents: number;
  count: number;
}

/** Saldo cuyo origen no se pudo determinar (cruce sin saldo al que aplicarse): no se reclasifica, se revisa. */
export interface ReclassificationReview {
  lineId: number;
  lineName: string;
  pucCode: string;
  concept: string;
  date: string;
  document: string;
  movementId?: number;
  cents: number;
  reason: string;
}

/** Falta la línea no corriente equivalente de una línea corriente con saldos de años anteriores. */
export interface MissingCounterpart {
  lineId: number;
  lineName: string;
  section: FsSectionKey;
  targetSection: FsSectionKey;
  cents: number;
}

export const reclassificationAges = (items: Reclassification[]): ReclassificationAge[] => {
  const byAge = new Map<string, ReclassificationAge>();
  for (const r of items) {
    const key = String(r.originYear);
    const a = byAge.get(key) ?? { originYear: r.originYear, ageYears: r.ageYears, cents: 0, count: 0 };
    a.cents += r.pendingCents;
    a.count++;
    byAge.set(key, a);
  }
  return [...byAge.values()].sort((a, b) => (a.originYear ?? 0) - (b.originYear ?? 0));
};

export interface CryptoSummary {
  buysCents: number;
  sellsCents: number;
  ownResultCents: number;
  months: { period: string; sellsCents: number }[];
  /** Promedio mensual de ventas (un mes sin ventas cuenta como 0). */
  monthlyAverageCents: number;
}

/** Saldo de una cuenta bancaria para el ESF: el del mes final o pendiente. */
export interface BankBalanceStatus {
  key: string;
  bank: string;
  accountNumber: string;
  /** AAAA-MM del mes final del periodo. */
  month: string;
  /** Saldo del mes final (el que entra al ESF). */
  balance: BankBalance | null;
  /** Sin saldo del mes final: el último anterior, solo como referencia (no entra al ESF). */
  lastKnown: BankBalance | null;
  /** AAAA-MM del cierre confirmado, si fue antes del mes final: saldo 0, nunca pendiente. */
  closedPeriod?: string;
}

export interface Statements {
  sections: Record<FsSectionKey, SectionValue>;
  esf: { currentAssets: number; nonCurrentAssets: number; assets: number; currentLiabilities: number; nonCurrentLiabilities: number; liabilities: number; equity: number; liabilitiesAndEquity: number; differenceCents: number };
  eerr: { income: number; costs: number; gross: number; admin: number; sales: number; operatingExpenses: number; operating: number; otherIncome: number; otherExpenses: number; beforeTax: number };
  incomeTaxPesos: number;
  unclassified: UnclassifiedPuc[];
  /** Grupos con clasificaciones antiguas contradictorias (bloquean hasta resolverlos). */
  mappingConflicts: MappingConflict[];
  /** Saldos de años anteriores de líneas corrientes presentados en no corriente. */
  reclassifications: Reclassification[];
  reclassificationReviews: ReclassificationReview[];
  /** Líneas corrientes con saldos de años anteriores y sin contraparte no corriente (bloquean). */
  missingCounterparts: MissingCounterpart[];
  crypto: CryptoSummary;
  /** Saldo exacto de cada PUC (ESF a la fecha final; EERR en el rango): base de «Valor anterior» de un ajuste. */
  pucBalances: Map<string, number>;
  /** Una fila por cuenta bancaria con saldos hasta el mes final. */
  bankBalances: BankBalanceStatus[];
  /** Efecto de las obligaciones tributarias a la fecha final y lo que falta resolver. */
  tax: TaxEffects;
  /** CxC a socios (capital suscrito − pagado) que SÍ entró a EEFF por tener PUC y ubicación; 0 si falta alguno. */
  sociosReceivableCents: number;
  presentation: Presentation;
}

/** Origen de un movimiento, para auditar de dónde sale un valor. */
interface PostMeta {
  movementId?: number;
  source?: FsSource;
  documentNumber?: string;
  documentId?: string;
  supplierNit?: string;
  description?: string;
}

interface PostOpts {
  dc?: "D" | "C" | null;
  settlesOn?: string | null;
  noncurrent?: string;
  ref?: string;
  meta?: PostMeta;
}

/** Valor de un movimiento en una línea ESF corriente, con lo que falta por aplicar de pagos o cruces. Signo = naturaleza de la cuenta (+ aumenta). */
interface Layer {
  lineId: number;
  pucCode: string;
  concept: string;
  date: string;
  seq: number;
  value: number;
  remaining: number;
  applied: number;
  docKey: string;
  document: string;
  meta: PostMeta;
}

/**
 * El efectivo y sus equivalentes (PUC 11) son una posición a la fecha, no un saldo con origen: nunca se reclasifican. Es la única
 * excepción por cuenta y se aplica solo a la clase 11; todo lo demás sale de la línea configurada, sin listas de PUC especiales.
 */
const CASH_PUC = /^11/;

interface Bucket {
  cents: number;
  byPuc: Map<string, Contribution>;
  automatic: string[];
}

const isEsf = (s: FsSectionKey) => ESF_SECTIONS.includes(s);

export function buildStatements(input: EngineInput): Statements {
  const { catalog, start, end, presentation } = input;
  const lines = new Map(catalog.lines.map((l) => [l.id, l]));
  const byRole = new Map(catalog.lines.filter((l) => l.role).map((l) => [l.role!, l]));
  const resolver = buildMappingResolver(input.mappings);
  const concept = (code: string) => input.pucConcepts?.get(code) ?? "";
  const buckets = new Map<number, Bucket>();
  const bucket = (id: number) => {
    let b = buckets.get(id);
    if (!b) buckets.set(id, (b = { cents: 0, byPuc: new Map(), automatic: [] }));
    return b;
  };
  const unclassified = new Map<string, UnclassifiedPuc>();
  const pucBalances = new Map<string, number>();
  const endYear = Number(end.slice(0, 4));
  /** Lo contabilizado por subcuenta de cada grupo (para reportar conflictos de clasificación con su valor). */
  const touched = new Map<string, Map<string, { count: number; cents: number }>>();
  const layers = new Map<string, Layer[]>();
  let layerSeq = 0;
  const reclassifications: Reclassification[] = [];
  const reclassificationReviews: ReclassificationReview[] = [];
  const missing = new Map<number, MissingCounterpart>();

  /** Línea no corriente EQUIVALENTE a una corriente (pasivo o activo): la activa de la sección destino con el mismo nombre. Sin ella no se adivina otra. */
  const NONCURRENT_TARGET: Partial<Record<FsSectionKey, FsSectionKey>> = { liability_current: "liability_noncurrent", asset_current: "asset_noncurrent" };
  const noncurrentFor = (line: FsLine) => {
    const target = NONCURRENT_TARGET[line.section];
    if (!target) return undefined;
    const name = line.name.trim().toLowerCase();
    return catalog.lines
      .filter((l) => l.section === target && l.isActive && l.name.trim().toLowerCase() === name)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)[0];
  };
  const noteMissing = (line: FsLine, cents: number) => {
    const m = missing.get(line.id) ?? { lineId: line.id, lineName: line.name, section: line.section, targetSection: NONCURRENT_TARGET[line.section]!, cents: 0 };
    m.cents += cents;
    missing.set(line.id, m);
  };

  /**
   * Suma un valor de un PUC según su destino en el catálogo. La ubicación se busca por el código completo y, si no está,
   * por su grupo de cuatro dígitos (una sola clasificación de presentación por cuenta, p. ej. 2365). Devuelve si entró.
   * Los valores sin clasificar se agrupan SIEMPRE por los cuatro dígitos (se clasifica una vez); las subcuentas quedan de trazabilidad.
   */
  function post(pucCode: string, pucConcept: string, cents: number, date: string | null, opts: PostOpts = {}): boolean {
    if (date !== null && date > end) return false;
    const familyCode = familyOf(pucCode);
    const accounting = (nature: boolean) => (opts.dc ? bankAccountingCents(opts.dc, cents, nature) : cents);
    const seen = touched.get(familyCode) ?? new Map<string, { count: number; cents: number }>();
    const t = seen.get(pucCode) ?? { count: 0, cents: 0 };
    t.count++;
    t.cents += accounting(isDebitPuc(pucCode));
    seen.set(pucCode, t);
    touched.set(familyCode, seen);
    const m = resolver.resolve(pucCode)?.mapping;
    if (m?.excluded) return false;
    let line = m?.lineId ? lines.get(m.lineId) : undefined;
    // Presentación no corriente forzada por el origen del saldo (obligaciones tributarias): el PUC original se conserva en la contribución.
    let reclassified: string | undefined;
    let baseLine: FsLine | undefined;
    let noCounterpart = false;
    if (opts.noncurrent && line?.isActive && NONCURRENT_TARGET[line.section]) {
      const target = noncurrentFor(line);
      if (target) {
        reclassified = `${opts.noncurrent} (PUC ${pucCode}, línea corriente «${line.name}»)`;
        baseLine = line;
        line = target;
      } else noCounterpart = true;
    }
    if (!line || !line.isActive) {
      const u = unclassified.get(familyCode) ?? { pucCode: familyCode, concept: concept(familyCode) || pucConcept || concept(pucCode), count: 0, cents: 0, inactiveLine: line ? line.name : undefined, children: [] };
      const value = accounting(isDebitPuc(pucCode));
      u.count++;
      u.cents += value;
      let child = u.children.find((c) => c.pucCode === pucCode);
      if (!child) u.children.push((child = { pucCode, concept: pucConcept || concept(pucCode), count: 0, cents: 0, entries: [] }));
      child.count++;
      child.cents += value;
      child.entries.push({ movementId: opts.meta?.movementId, date, source: opts.meta?.source, documentNumber: opts.meta?.documentNumber ?? opts.ref ?? "", description: opts.meta?.description ?? "", cents: value });
      unclassified.set(familyCode, u);
      return false;
    }
    const esf = isEsf(line.section);
    if (esf && opts.settlesOn && opts.settlesOn <= end) return false; // cuenta por pagar ya pagada a la fecha final
    if (!esf && date !== null && date < start) return false; // EERR: solo el rango
    const value = accounting(DEBIT_SECTIONS.has(line.section));
    const b = bucket(line.id);
    b.cents += value;
    if (reclassified && !b.automatic.includes(reclassified)) b.automatic.push(reclassified);
    // Los valores de obligaciones tributarias se detallan por declaración y periodo (`ref`), no solo por PUC.
    const contributionKey = opts.ref ? `${pucCode}|${opts.ref}` : pucCode;
    const c = b.byPuc.get(contributionKey) ?? { pucCode, concept: opts.ref || pucConcept || concept(pucCode), cents: 0, count: 0 };
    c.cents += value;
    c.count++;
    b.byPuc.set(contributionKey, c);
    pucBalances.set(pucCode, (pucBalances.get(pucCode) ?? 0) + value);
    if (noCounterpart) noteMissing(line, value);
    if (baseLine) {
      reclassifications.push({
        lineId: baseLine.id,
        lineName: baseLine.name,
        targetLineId: line.id,
        targetLineName: line.name,
        pucCode,
        concept: opts.ref || pucConcept || concept(pucCode),
        originDate: null,
        originYear: null,
        ageYears: null,
        document: opts.ref ?? "",
        originalCents: value,
        appliedCents: 0,
        pendingCents: value,
      });
    } else if (esf && !opts.ref && !opts.noncurrent && NONCURRENT_TARGET[line.section] && !CASH_PUC.test(pucCode) && value !== 0) {
      // Capa de origen: sirve para saber, al final, cuánto del saldo pendiente viene de años anteriores.
      const key = `${line.id}|${pucCode}`;
      const group = layers.get(key) ?? [];
      const meta = opts.meta ?? {};
      const doc = (meta.documentNumber || meta.documentId || "").trim();
      group.push({ lineId: line.id, pucCode, concept: pucConcept || concept(pucCode), date: date ?? end, seq: layerSeq++, value, remaining: value, applied: 0, docKey: doc ? `${(meta.supplierNit ?? "").trim()}|${doc}` : "", document: doc || meta.description || "", meta });
      layers.set(key, group);
    }
    return true;
  }

  // 1. Movimientos activos (el reporte de operaciones va aparte: solo alimenta la presentación).
  const crypto = { buys: 0, sells: 0, byMonth: new Map<string, number>() };
  for (const mv of input.movements) {
    if (mv.status !== "active") continue;
    if (mv.source === "sales_tpsv") {
      if (mv.accountingDate < start || mv.accountingDate > end) continue;
      if (mv.conceptKey === "tpsv.sell") {
        crypto.sells += mv.amountCents;
        const p = mv.accountingDate.slice(0, 7);
        crypto.byMonth.set(p, (crypto.byMonth.get(p) ?? 0) + mv.amountCents);
      } else if (mv.conceptKey === "tpsv.buy") crypto.buys += mv.amountCents;
      continue;
    }
    post(mv.pucCode, mv.pucConcept, mv.amountCents, mv.accountingDate, {
      dc: mv.dc,
      settlesOn: mv.settlesOn,
      meta: { movementId: mv.id, source: mv.source, documentNumber: mv.documentNumber, documentId: mv.documentId, supplierNit: mv.supplierNit, description: mv.description },
    });
  }

  // 2. Saldo bancario: la foto del mes final de cada cuenta; sin ella, pendiente (sin respaldo silencioso al mes anterior).
  const bankBalances = bankBalanceStatus(input.bankBalances, end, input.bankLifecycles);
  for (const b of bankBalances) if (b.balance) post(b.balance.pucCode, "", b.balance.balanceCents, null);

  // 2b. Obligaciones tributarias a la fecha final (sin PUC configurado no se envían: bloquea en la lista de verificación).
  const tax: TaxEffects = input.tax ? taxEffects(input.tax, end) : { effects: [], issues: [], excessReviews: [] };
  for (const e of tax.effects) if (e.pucCode) post(e.pucCode, "", e.cents, e.date ?? null, { ref: e.label, ...(e.noncurrent && { noncurrent: `${SHORT_TAX_LABEL[e.taxType]} de años anteriores a ${end.slice(0, 4)} (no corriente)` }) });

  // 3. Capital: suscrito en Capital social; la diferencia con el pagado en 132505.
  const { subscribedTotalShares, subscribedNominalValue, paidTotalShares, paidNominalValue } = input.company;
  const subscribed = (subscribedTotalShares ?? 0) * (subscribedNominalValue ?? 0) * 100;
  const paid = (paidTotalShares ?? 0) * (paidNominalValue ?? 0) * 100;
  const capitalLine = byRole.get("share_capital");
  if (capitalLine && subscribed) {
    const b = bucket(capitalLine.id);
    b.cents += subscribed;
    b.automatic.push("Capital suscrito (Empresas)");
  }
  let sociosReceivableCents = 0;
  if (subscribed && subscribed !== paid) {
    // La CxC a socios exige un PUC configurado; la ubicación (y si es corriente / no corriente) sale de su clasificación.
    if (input.capitalReceivablePuc) {
      if (post(input.capitalReceivablePuc, "A SOCIOS", subscribed - paid, null)) sociosReceivableCents = subscribed - paid;
    } else tax.issues.push({ level: "blocking", taxType: "capital", pucKey: CAPITAL_RECEIVABLE_KEY, code: "puc_missing", message: "Configura la cuenta PUC de la cuenta por cobrar a socios (capital suscrito − pagado): sin ella no se incluye en los Estados Financieros." });
  }

  // 3b. Saldos pendientes de años anteriores: la línea corriente del PUC es la base; lo originado antes del año de la fecha final
  // se presenta en la línea no corriente del mismo nombre. Los pagos y cruces disminuyen su origen (el documento al que hacen
  // referencia o, si no lo tienen, el más antiguo de la misma cuenta); un cruce sin origen se deja para revisión.
  for (const group of layers.values()) {
    const ordered = [...group].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
    let open: Layer[] = [];
    for (const layer of ordered) {
      const sign = Math.sign(layer.value);
      const opposite = open.filter((o) => Math.sign(o.remaining) === -sign);
      const targets = layer.docKey ? [...opposite.filter((o) => o.docKey === layer.docKey), ...opposite.filter((o) => o.docKey !== layer.docKey)] : opposite;
      let left = layer.value;
      for (const o of targets) {
        if (left === 0) break;
        const take = Math.min(Math.abs(left), Math.abs(o.remaining));
        left -= sign * take;
        o.remaining += sign * take;
        o.applied += take;
      }
      layer.remaining = left;
      open = open.filter((o) => o.remaining !== 0);
      if (left !== 0) open.push(layer);
    }
    for (const layer of ordered) {
      const base = lines.get(layer.lineId)!;
      if (layer.remaining < 0) {
        reclassificationReviews.push({
          lineId: base.id,
          lineName: base.name,
          pucCode: layer.pucCode,
          concept: layer.concept,
          date: layer.date,
          document: layer.document,
          movementId: layer.meta.movementId,
          cents: layer.remaining,
          reason: "Pago o cruce sin un saldo de origen al que aplicarse: no se asume su origen ni se reclasifica.",
        });
        continue;
      }
      const originYear = Number(layer.date.slice(0, 4));
      if (layer.remaining === 0 || originYear >= endYear) continue;
      const target = noncurrentFor(base);
      if (!target) {
        noteMissing(base, layer.remaining);
        continue;
      }
      const from = bucket(base.id);
      const to = bucket(target.id);
      from.cents -= layer.remaining;
      to.cents += layer.remaining;
      const source = from.byPuc.get(layer.pucCode);
      if (source) {
        source.cents -= layer.remaining;
        source.count -= 1;
        if (source.count <= 0 && source.cents === 0) from.byPuc.delete(layer.pucCode);
      }
      const contributionKey = `${layer.pucCode}|origen ${originYear}`;
      const moved = to.byPuc.get(contributionKey) ?? { pucCode: layer.pucCode, concept: `${layer.concept} — saldo originado en ${originYear}`.trim(), cents: 0, count: 0 };
      moved.cents += layer.remaining;
      moved.count++;
      to.byPuc.set(contributionKey, moved);
      const note = `Saldos de años anteriores a ${endYear} presentados como no corrientes`;
      if (!to.automatic.includes(note)) to.automatic.push(note);
      reclassifications.push({
        lineId: base.id,
        lineName: base.name,
        targetLineId: target.id,
        targetLineName: target.name,
        pucCode: layer.pucCode,
        concept: layer.concept,
        originDate: layer.date,
        originYear,
        ageYears: endYear - originYear,
        document: layer.document,
        movementId: layer.meta.movementId,
        source: layer.meta.source,
        originalCents: layer.value,
        appliedCents: layer.applied,
        pendingCents: layer.remaining,
      });
    }
  }
  reclassifications.sort((a, b) => (a.originDate ?? "") < (b.originDate ?? "") ? -1 : (a.originDate ?? "") > (b.originDate ?? "") ? 1 : a.pucCode < b.pucCode ? -1 : 1);

  // Clasificaciones antiguas contradictorias dentro de un grupo con movimientos: no se elige ninguna, se reporta.
  const mappingConflicts: MappingConflict[] = [];
  for (const [family, codes] of touched) {
    const info = resolver.info(family);
    if (!info.conflict) continue;
    let count = 0;
    let cents = 0;
    for (const t of codes.values()) {
      count += t.count;
      cents += t.cents;
    }
    mappingConflicts.push({
      family,
      concept: concept(family) || [...codes.keys()].map(concept).find(Boolean) || "",
      count,
      cents,
      options: info.options.map((o) => ({ key: o.key, lineId: o.mapping.lineId, excluded: o.mapping.excluded, label: o.mapping.excluded ? "No afecta Estados Financieros" : (lines.get(o.mapping.lineId ?? -1)?.name ?? "—"), codes: o.codes })),
    });
  }
  mappingConflicts.sort((a, b) => (a.family < b.family ? -1 : 1));

  // 4. Reporte de operaciones según la presentación (el resultado es el mismo en ambas).
  const months = monthsBetween(start, end).map((period) => ({ period, sellsCents: crypto.byMonth.get(period) ?? 0 }));
  const monthlyAverageCents = months.length ? crypto.sells / months.length : 0;
  const ownResult = crypto.sells - crypto.buys;
  const addRole = (role: Parameters<typeof byRole.get>[0], cents: number, label: string) => {
    const line = byRole.get(role);
    if (!line || cents === 0) return;
    const b = bucket(line.id);
    b.cents += cents;
    b.automatic.push(label);
  };
  if (presentation === "bank") {
    addRole("sales", ownResult, "Resultado propio de operaciones cripto");
    addRole("third_party_income", monthlyAverageCents, "Promedio mensual de ventas cripto");
    addRole("third_party_cost", monthlyAverageCents, "Promedio mensual de ventas cripto");
  } else {
    addRole("sales", ownResult + monthlyAverageCents, "Resultado propio + valor de terceros (cripto)");
    addRole("cost_of_sales", monthlyAverageCents, "Valor de terceros (cripto)");
    // OTC condensa: lo que haya en las líneas de terceros se presenta en Ventas / Costo de Ventas.
    for (const [from, to] of [["third_party_income", "sales"], ["third_party_cost", "cost_of_sales"]] as const) {
      const source = byRole.get(from);
      const target = byRole.get(to);
      const b = source ? buckets.get(source.id) : undefined;
      if (!b || !target || b.cents === 0) continue;
      const t = bucket(target.id);
      t.cents += b.cents;
      for (const c of b.byPuc.values()) t.byPuc.set(c.pucCode, { ...c, cents: (t.byPuc.get(c.pucCode)?.cents ?? 0) + c.cents });
      buckets.delete(source!.id);
    }
  }

  // 5. Secciones.
  const representative = new Map(catalog.sections.map((s) => [s.section, s.representativeLineId]));
  const sections = {} as Record<FsSectionKey, SectionValue>;
  for (const key of [...ESF_SECTIONS, ...EERR_SECTIONS]) {
    const sectionLines = catalog.lines
      .filter((l) => l.section === key && (l.isActive || buckets.has(l.id)))
      .filter((l) => !(presentation === "otc" && (l.role === "third_party_income" || l.role === "third_party_cost")))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    const values: LineValue[] = sectionLines.map((line) => {
      const b = buckets.get(line.id);
      return {
        line,
        cents: b?.cents ?? 0,
        contributions: b ? [...b.byPuc.values()].sort((x, y) => (x.pucCode < y.pucCode ? -1 : 1)) : [],
        automatic: b?.automatic.length ? b.automatic.join(" · ") : undefined,
      };
    });
    sections[key] = { key, lines: values, totalCents: values.reduce((s, v) => s + v.cents, 0), representativeLineId: representative.get(key) ?? null };
  }

  const total = (k: FsSectionKey) => sections[k].totalCents;
  const income = total("income");
  const costs = total("costs");
  const gross = income - costs;
  const admin = total("admin_expenses");
  const salesExp = total("sales_expenses");
  const operating = gross - admin - salesExp;
  const beforeTax = operating + total("other_income") - total("other_expenses");

  // 6. Resultado del ejercicio en el patrimonio (negativo si hay pérdida).
  const resultLine = byRole.get("period_result");
  const equity = sections.equity;
  const resultValue = resultLine ? equity.lines.find((v) => v.line.id === resultLine.id) : undefined;
  if (resultValue) {
    resultValue.cents += beforeTax;
    resultValue.automatic = [resultValue.automatic, "RESULTADO ANTES DE IMPUESTOS del Estado de Resultados"].filter(Boolean).join(" · ");
    equity.totalCents += beforeTax;
  }

  const currentAssets = total("asset_current");
  const nonCurrentAssets = total("asset_noncurrent");
  const currentLiabilities = total("liability_current");
  const nonCurrentLiabilities = total("liability_noncurrent");
  const assets = currentAssets + nonCurrentAssets;
  const liabilities = currentLiabilities + nonCurrentLiabilities;
  const liabilitiesAndEquity = liabilities + equity.totalCents;

  return {
    sections,
    esf: { currentAssets, nonCurrentAssets, assets, currentLiabilities, nonCurrentLiabilities, liabilities, equity: equity.totalCents, liabilitiesAndEquity, differenceCents: assets - liabilitiesAndEquity },
    eerr: { income, costs, gross, admin, sales: salesExp, operatingExpenses: admin + salesExp, operating, otherIncome: total("other_income"), otherExpenses: total("other_expenses"), beforeTax },
    incomeTaxPesos: estimatedIncomeTax(beforeTax),
    unclassified: [...unclassified.values()].sort((a, b) => (a.pucCode < b.pucCode ? -1 : 1)),
    mappingConflicts,
    reclassifications,
    reclassificationReviews,
    missingCounterparts: [...missing.values()],
    crypto: { buysCents: crypto.buys, sellsCents: crypto.sells, ownResultCents: ownResult, months, monthlyAverageCents },
    pucBalances,
    bankBalances,
    tax,
    sociosReceivableCents,
    presentation,
  };
}

const newer = (a: BankBalance, b: BankBalance | null) => !b || a.balanceDate > b.balanceDate || (a.balanceDate === b.balanceDate && a.id > b.id);

/**
 * Saldo de cada cuenta (banco + número) para un ESF con fecha final `end`: el
 * extracto del MES de la fecha final (si hay varios, el más reciente). Solo se
 * consideran las cuentas con algún saldo activo hasta ese mes; las que tengan
 * solo saldos posteriores aún no existían. Los saldos son fotos: nunca se suman.
 * Una cuenta con cierre confirmado antes del mes final tiene saldo 0 (no queda pendiente).
 */
export function bankBalanceStatus(balances: BankBalance[], end: string, lifecycles: BankAccountLifecycle[] = []): BankBalanceStatus[] {
  const month = end.slice(0, 7);
  const accounts = new Map<string, BankBalanceStatus>();
  for (const b of balances) {
    const m = b.balanceDate.slice(0, 7);
    if (!b.active || m > month) continue;
    const key = `${b.bank.trim()}|${b.accountNumber.trim()}`;
    let a = accounts.get(key);
    if (!a) accounts.set(key, (a = { key, bank: b.bank.trim(), accountNumber: b.accountNumber.trim(), month, balance: null, lastKnown: null }));
    if (m === month) {
      if (newer(b, a.balance)) a.balance = b;
    } else if (newer(b, a.lastKnown)) a.lastKnown = b;
  }
  const list = [...accounts.values()].sort((x, y) => x.bank.localeCompare(y.bank, "es", { sensitivity: "base" }) || x.accountNumber.localeCompare(y.accountNumber));
  // Con saldo del mes final, el anterior no hace falta ni como referencia.
  for (const a of list) if (a.balance) a.lastKnown = null;
  for (const a of list) {
    const closed = lifecycles.find((l) => l.bank.trim() === a.bank && l.accountNumber.trim() === a.accountNumber)?.closedPeriod;
    if (!a.balance && closed && closed < month) a.closedPeriod = closed;
  }
  return list;
}

/** Cuentas sin saldo del mes final (bloquean el periodo). Una cuenta cerrada antes no está pendiente. */
export const pendingBankBalances = (s: Pick<Statements, "bankBalances">) => s.bankBalances.filter((b) => !b.balance && !b.closedPeriod);

// ---------------------------------------------------------------------------
// Filas para mostrar (app, previsualizador y PDF usan las mismas)
// ---------------------------------------------------------------------------

export type RowKind = "title" | "header" | "line" | "subtotal" | "total" | "result" | "gap";

export interface StatementRow {
  kind: RowKind;
  label: string;
  /** Valor exacto (centavos); sin definir en títulos y espacios. */
  cents?: number;
  /** Pesos redondeados al millar (calculado desde el exacto). */
  pesos?: number;
  lineId?: number;
  /** Número de la nota (columna NOTA): lo asigna `notes/model.ts`; no interviene en ningún cálculo. */
  note?: number;
}

const valueRow = (kind: RowKind, label: string, cents: number, lineId?: number): StatementRow => ({ kind, label, cents, pesos: roundThousands(cents), lineId });

/**
 * Líneas de una sección: se ocultan las que quedan en cero (al millar); si
 * todas quedan en cero se muestra la cuenta representativa en 0.
 */
function sectionRows(section: SectionValue): StatementRow[] {
  const visible = section.lines.filter((v) => roundThousands(v.cents) !== 0);
  if (visible.length) return visible.map((v) => valueRow("line", v.line.name, v.cents, v.line.id));
  const rep = section.lines.find((v) => v.line.id === section.representativeLineId) ?? section.lines[0];
  return rep ? [valueRow("line", rep.line.name, rep.cents, rep.line.id)] : [];
}

export function esfRows(s: Statements): StatementRow[] {
  const S = s.sections;
  return [
    { kind: "title", label: "ACTIVO" },
    { kind: "header", label: SECTION_LABEL.asset_current },
    ...sectionRows(S.asset_current),
    valueRow("subtotal", "TOTAL ACTIVO CORRIENTE", s.esf.currentAssets),
    { kind: "header", label: SECTION_LABEL.asset_noncurrent },
    ...sectionRows(S.asset_noncurrent),
    valueRow("subtotal", "TOTAL ACTIVO NO CORRIENTE", s.esf.nonCurrentAssets),
    valueRow("total", "TOTAL ACTIVO", s.esf.assets),
    { kind: "gap", label: "" },
    { kind: "title", label: "PASIVO Y PATRIMONIO" },
    { kind: "header", label: SECTION_LABEL.liability_current },
    ...sectionRows(S.liability_current),
    valueRow("subtotal", "TOTAL PASIVO CORRIENTE", s.esf.currentLiabilities),
    { kind: "header", label: SECTION_LABEL.liability_noncurrent },
    ...sectionRows(S.liability_noncurrent),
    valueRow("subtotal", "TOTAL PASIVO NO CORRIENTE", s.esf.nonCurrentLiabilities),
    valueRow("total", "TOTAL PASIVOS", s.esf.liabilities),
    { kind: "header", label: SECTION_LABEL.equity },
    ...sectionRows(S.equity),
    valueRow("total", "TOTAL PATRIMONIO", s.esf.equity),
    valueRow("total", "TOTAL PASIVOS Y PATRIMONIO", s.esf.liabilitiesAndEquity),
  ];
}

export function eerrRows(s: Statements): StatementRow[] {
  const S = s.sections;
  const e = s.eerr;
  return [
    { kind: "header", label: SECTION_LABEL.income },
    ...sectionRows(S.income),
    valueRow("subtotal", "TOTAL INGRESOS OPERACIONALES", e.income),
    { kind: "header", label: SECTION_LABEL.costs },
    ...sectionRows(S.costs),
    valueRow("subtotal", "TOTAL COSTOS OPERACIONALES", e.costs),
    valueRow("result", "RESULTADO BRUTO", e.gross),
    { kind: "header", label: SECTION_LABEL.admin_expenses },
    ...sectionRows(S.admin_expenses),
    valueRow("subtotal", "TOTAL GASTOS OPERACIONALES ADMINISTRACIÓN", e.admin),
    { kind: "header", label: SECTION_LABEL.sales_expenses },
    ...sectionRows(S.sales_expenses),
    valueRow("subtotal", "TOTAL GASTOS OPERACIONALES VENTAS", e.sales),
    valueRow("total", "GASTOS OPERACIONALES", e.operatingExpenses),
    valueRow("result", "RESULTADO OPERACIONAL", e.operating),
    ...sectionRows(S.other_income),
    ...sectionRows(S.other_expenses),
    valueRow("result", "RESULTADO ANTES DE IMPUESTOS", e.beforeTax),
  ];
}

/** El ESF cuadra exactamente: Activo = Pasivo + Patrimonio. */
export const isBalanced = (s: Statements) => s.esf.differenceCents === 0;
