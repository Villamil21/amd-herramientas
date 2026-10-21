import type { EinvoiceCustomer, EinvoiceDoc } from "../../../types/einvoice";
import type { RecordData, SyncProposal } from "../../../types/exogena";
import type { CompanyVatEntry } from "../../../types/purchases";
import { vatResponsibleAt, vatYearCoverage } from "../../financial-statements/purchases/domain/history";
import { centsToPesos, formatExoCents } from "./numbers";
import { normalizeNit } from "../../financial-statements/shared/companyMatch";
import type { Problem } from "./problems";
import { COLOMBIA, computeNitDv, DOC_NIT } from "./thirdParty";

/**
 * Ventas por facturación electrónica → Exógena 1007, 1005 y 1006. Todo se recalcula desde los documentos guardados
 * (`exo_einvoice_docs`) y la identidad confirmada de los clientes; nada calculado es fuente de verdad.
 *
 *  - 1007: concepto 4001 por cliente y tipo de documento. Facturas → «Ingresos brutos recibidos»; notas crédito →
 *    «Devoluciones, rebajas y descuentos». Base = Total − (IVA … ICUI). Nunca se netean entre sí.
 *  - 1006: solo facturas, IVA del documento en «Impuesto generado».
 *  - 1005: solo notas crédito, IVA del documento en «IVA resultante por devoluciones en ventas…».
 *  - 1005 y 1006 solo cuentan los documentos de una fecha en que la empresa era responsable de IVA (48).
 */

export type EinvoiceFormat = "1007" | "1005" | "1006";
export const EINVOICE_FORMATS: EinvoiceFormat[] = ["1007", "1005", "1006"];

export const EINVOICE_PATH = "/herramientas/estados-financieros/ventas/facturacion-electronica";
export const EINVOICE_ORIGIN = "Facturación electrónica";
export const CONCEPT_4001 = "4001";

/** Prefijo de `sourceKey`: distingue estos registros de los de Transacciones Cripto y de Compras. */
export const EINVOICE_KEY_PREFIX = "fe-ventas:";
export const isEinvoiceKey = (sourceKey: string) => sourceKey.startsWith(EINVOICE_KEY_PREFIX);

export interface ReceiverIdentity {
  /** Número de identificación limpio (solo dígitos, sin DV); vacío si el Excel no lo trae. */
  number: string;
  status: "ready" | "pending" | "missing";
  /** nit90: NIT de 9 dígitos que empieza por 90 · confirmed: ficha confirmada por el usuario. */
  origin: "nit90" | "confirmed" | "none";
  docTypeCode: string;
  dv: string;
  firstSurname: string;
  secondSurname: string;
  firstName: string;
  otherNames: string;
  businessName: string;
}

const EMPTY: Omit<ReceiverIdentity, "number" | "status" | "origin"> = { docTypeCode: "", dv: "", firstSurname: "", secondSurname: "", firstName: "", otherNames: "", businessName: "" };

/**
 * Regla única de identidad del cliente (1007, 1005 y 1006). Un NIT de 9 dígitos que empieza por 90 es NIT: tipo 31, DV calculado,
 * `Nombre receptor` exacto como razón social y sin nombres. Cualquier otro identificador queda pendiente hasta que el usuario
 * confirme tipo y nombres; con la ficha ya confirmada se reutiliza.
 */
export function receiverIdentity(rawNit: string, receiverName: string, customers: ReadonlyMap<string, EinvoiceCustomer>): ReceiverIdentity {
  const number = normalizeNit(rawNit);
  if (!number) return { number, status: "missing", origin: "none", ...EMPTY };
  if (/^90\d{7}$/.test(number)) return { number, status: "ready", origin: "nit90", ...EMPTY, docTypeCode: DOC_NIT, dv: computeNitDv(number), businessName: receiverName };
  const known = customers.get(number);
  if (known) {
    return {
      number,
      status: "ready",
      origin: "confirmed",
      docTypeCode: known.docTypeCode,
      dv: known.dv,
      firstSurname: known.firstSurname,
      secondSurname: known.secondSurname,
      firstName: known.firstName,
      otherNames: known.otherNames,
      businessName: known.businessName,
    };
  }
  return { number, status: "pending", origin: "none", ...EMPTY };
}

export interface PendingCustomer {
  number: string;
  /** Nombres del receptor tal como llegan en los documentos. */
  names: string[];
  rawNits: string[];
  documents: number;
  /** Formatos que ese cliente detiene (1007 siempre; 1005 / 1006 solo si tiene IVA aplicable). */
  formats: EinvoiceFormat[];
}

export interface AuditLine {
  documentId: string;
  fileName: string;
  sheet: string;
  row: number;
  issueDate: string;
  docType: string;
  receiverNitRaw: string;
  receiverName: string;
  totalCents: number;
  ivaCents: number;
  /** Columnas restadas para la base del 1007 (IVA … ICUI) y la base resultante. */
  subtractedColumns: string[];
  exoBaseCents: number | null;
  /** Valor que el documento aporta a cada columna del formato, en centavos. */
  contributions: Record<string, number>;
}

export interface SalesReconciliation {
  /** IVA de facturas electrónicas con empresa responsable de IVA en su fecha → 1006 / Impuesto generado. */
  invoiceIvaCents: number;
  generatedCents: number;
  /** IVA de notas crédito electrónicas con empresa responsable de IVA en su fecha → 1005 / IVA por devoluciones en ventas. */
  creditNoteIvaCents: number;
  salesReturnsCents: number;
}

export interface EinvoiceContribution {
  proposals: Record<EinvoiceFormat, SyncProposal[]>;
  problems: Record<EinvoiceFormat, Problem[]>;
  pendingCustomers: PendingCustomer[];
  audit: Record<string, AuditLine[]>;
  reconciliation: SalesReconciliation;
  /** Documentos del año que se leyeron. */
  documents: number;
  /** Total − (IVA … Rete ICA) y Total − (IVA … ICUI) de todo el año, por categoría (centavos): para mostrar ambas bases. */
  bases: { eeffSale: number; eeffReturn: number; exoSale: number; exoReturn: number };
}

const abs = Math.abs;

function personColumns(i: ReceiverIdentity) {
  return { docTypeCode: i.docTypeCode, docNumber: i.number, dv: i.dv, firstSurname: i.firstSurname, secondSurname: i.secondSurname, firstName: i.firstName, otherNames: i.otherNames, businessName: i.businessName };
}

const displayName = (i: ReceiverIdentity, fallback: string) => i.businessName || [i.firstSurname, i.secondSurname, i.firstName, i.otherNames].filter(Boolean).join(" ") || fallback || i.number;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const listSome = (items: string[], limit = 4) => `${items.slice(0, limit).join(", ")}${items.length > limit ? `… (+${items.length - limit})` : ""}`;

interface Group {
  identity: ReceiverIdentity;
  fallbackName: string;
  docTypeKey: string;
  docs: EinvoiceDoc[];
  cents: number;
}

export function buildEinvoiceContribution(input: { docs: readonly EinvoiceDoc[]; customers: readonly EinvoiceCustomer[]; companyVat: readonly CompanyVatEntry[]; year: number }): EinvoiceContribution {
  const customers = new Map(input.customers.map((c) => [c.docNumber, c]));
  const docs = input.docs.filter((d) => d.year === input.year);
  const problems: Record<EinvoiceFormat, Problem[]> = { "1007": [], "1005": [], "1006": [] };
  const audit: Record<string, AuditLine[]> = {};
  const pending = new Map<string, PendingCustomer>();
  const noIdentity: EinvoiceDoc[] = [];
  const noScope: EinvoiceDoc[] = [];
  const noVatProfile: EinvoiceDoc[] = [];
  const g1007 = new Map<string, Group>();
  const g1005 = new Map<string, Group>();
  const g1006 = new Map<string, Group>();
  const bases = { eeffSale: 0, eeffReturn: 0, exoSale: 0, exoReturn: 0 };
  const rec: SalesReconciliation = { invoiceIvaCents: 0, generatedCents: 0, creditNoteIvaCents: 0, salesReturnsCents: 0 };

  const need = (doc: EinvoiceDoc, id: ReceiverIdentity, format: EinvoiceFormat) => {
    const p = pending.get(id.number) ?? { number: id.number, names: [], rawNits: [], documents: 0, formats: [] };
    if (doc.receiverName && !p.names.includes(doc.receiverName)) p.names.push(doc.receiverName);
    if (!p.rawNits.includes(doc.receiverNitRaw)) p.rawNits.push(doc.receiverNitRaw);
    if (!p.formats.includes(format)) p.formats.push(format);
    pending.set(id.number, p);
  };
  const countDoc = (id: ReceiverIdentity, seen: Set<string>, doc: EinvoiceDoc) => {
    const p = pending.get(id.number);
    if (p && !seen.has(doc.documentId)) {
      seen.add(doc.documentId);
      p.documents += 1;
    }
  };
  const seenDocs = new Set<string>();
  const add = (map: Map<string, Group>, key: string, identity: ReceiverIdentity, doc: EinvoiceDoc, cents: number) => {
    const g = map.get(key) ?? { identity, fallbackName: doc.receiverName, docTypeKey: doc.docTypeKey, docs: [], cents: 0 };
    g.docs.push(doc);
    g.cents += cents;
    map.set(key, g);
  };
  const trace = (key: string, doc: EinvoiceDoc, contributions: Record<string, number>) => {
    (audit[key] ??= []).push({
      documentId: doc.documentId,
      fileName: doc.fileName,
      sheet: doc.sheet,
      row: doc.rowNumber,
      issueDate: doc.issueDate,
      docType: doc.docType,
      receiverNitRaw: doc.receiverNitRaw,
      receiverName: doc.receiverName,
      totalCents: doc.totalCents,
      ivaCents: doc.ivaCents,
      subtractedColumns: doc.exoColumns,
      exoBaseCents: doc.exoBaseCents,
      contributions,
    });
  };

  for (const doc of docs) {
    const isSale = doc.category === "sale";
    if (isSale) bases.eeffSale += doc.eeffBaseCents;
    else bases.eeffReturn += abs(doc.eeffBaseCents);
    if (doc.exoBaseCents !== null) {
      if (isSale) bases.exoSale += doc.exoBaseCents;
      else bases.exoReturn += abs(doc.exoBaseCents);
    }
    const id = receiverIdentity(doc.receiverNitRaw, doc.receiverName, customers);
    if (id.status === "missing") {
      noIdentity.push(doc);
      continue;
    }
    const responsible = vatResponsibleAt(input.companyVat, doc.issueDate);
    const iva = abs(doc.ivaCents);
    const vatApplies = responsible === true && iva !== 0;
    if (iva !== 0 && responsible === undefined) noVatProfile.push(doc);
    if (vatApplies) {
      if (isSale) rec.invoiceIvaCents += iva;
      else rec.creditNoteIvaCents += iva;
    }

    // 1007
    if (doc.exoBaseCents === null) noScope.push(doc);
    if (id.status === "pending") {
      need(doc, id, "1007");
      countDoc(id, seenDocs, doc);
      if (vatApplies) need(doc, id, isSale ? "1006" : "1005");
      continue;
    }
    if (doc.exoBaseCents !== null) add(g1007, `${id.docTypeCode}|${id.number}|${doc.docTypeKey}|${doc.category}`, id, doc, isSale ? doc.exoBaseCents : abs(doc.exoBaseCents));
    // 1006 (facturas) y 1005 (notas crédito)
    if (vatApplies) add(isSale ? g1006 : g1005, `${id.docTypeCode}|${id.number}`, id, doc, iva);
  }

  const proposals: Record<EinvoiceFormat, SyncProposal[]> = { "1007": [], "1005": [], "1006": [] };

  for (const [key, g] of [...g1007.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sale = g.docs[0].category === "sale";
    const sourceKey = `${EINVOICE_KEY_PREFIX}1007:${g.docTypeKey}|${g.identity.docTypeCode}|${g.identity.number}|${g.docs[0].category}`;
    void key;
    const label = displayName(g.identity, g.fallbackName);
    proposals["1007"].push({
      sourceKey,
      origin: "estados_financieros",
      originRef: `${EINVOICE_ORIGIN} · ${g.docs[0].docType} · ${plural(g.docs.length, "documento", "documentos")} · ${label}`,
      data: {
        concept: CONCEPT_4001,
        ...personColumns(g.identity),
        countryCode: COLOMBIA,
        grossIncome: sale ? centsToPesos(g.cents) : 0,
        returns: sale ? 0 : centsToPesos(g.cents),
        thirdName: label,
        exactCents: sale ? { grossIncome: g.cents } : { returns: g.cents },
      },
    });
    for (const d of g.docs) trace(sourceKey, d, { [sale ? "grossIncome" : "returns"]: sale ? (d.exoBaseCents ?? 0) : abs(d.exoBaseCents ?? 0) });
  }
  const simple = (map: Map<string, Group>, format: "1005" | "1006", valueKey: string, zeros: RecordData) => {
    for (const g of [...map.values()].sort((a, b) => (a.identity.number + a.identity.docTypeCode).localeCompare(b.identity.number + b.identity.docTypeCode))) {
      const label = displayName(g.identity, g.fallbackName);
      const sourceKey = `${EINVOICE_KEY_PREFIX}${format}:${g.identity.docTypeCode}|${g.identity.number}`;
      proposals[format].push({
        sourceKey,
        origin: "estados_financieros",
        originRef: `${EINVOICE_ORIGIN} · ${plural(g.docs.length, format === "1006" ? "factura" : "nota crédito", format === "1006" ? "facturas" : "notas crédito")} · ${label}`,
        data: { ...personColumns(g.identity), [valueKey]: centsToPesos(g.cents), ...zeros, thirdName: label, exactCents: { [valueKey]: g.cents } },
      });
      for (const d of g.docs) trace(sourceKey, d, { [valueKey]: abs(d.ivaCents) });
    }
  };
  simple(g1006, "1006", "generated", { purchaseReturns: 0, consumption: 0 });
  simple(g1005, "1005", "salesReturns", { discountable: 0, costIva: 0 });
  rec.generatedCents = proposals["1006"].reduce((s, p) => s + ((p.data.exactCents as Record<string, number>).generated ?? 0), 0);
  rec.salesReturnsCents = proposals["1005"].reduce((s, p) => s + ((p.data.exactCents as Record<string, number>).salesReturns ?? 0), 0);

  // --- Pendientes ---
  const customersList = [...pending.values()].sort((a, b) => a.number.localeCompare(b.number));
  for (const format of EINVOICE_FORMATS) {
    const own = customersList.filter((c) => c.formats.includes(format));
    if (own.length)
      problems[format].push({
        level: "blocking",
        message: `${EINVOICE_ORIGIN}: ${plural(own.length, "cliente sin identidad confirmada", "clientes sin identidad confirmada")} (${listSome(own.map((c) => `${c.number} ${c.names[0] ?? ""}`.trim()))}). Confirma el tipo de documento y los nombres en «Clientes por confirmar» de esta pantalla; sus documentos no entran al ${format} hasta entonces.`,
      });
  }
  const sheetRow = (d: EinvoiceDoc) => `${d.fileName} · ${d.sheet} · fila ${d.rowNumber}`;
  if (noIdentity.length)
    for (const format of EINVOICE_FORMATS) {
      const relevant = format === "1007" ? noIdentity : noIdentity.filter((d) => d.category === (format === "1006" ? "sale" : "return") && d.ivaCents !== 0);
      if (relevant.length)
        problems[format].push({
          level: "blocking",
          message: `${EINVOICE_ORIGIN}: ${plural(relevant.length, "documento no trae", "documentos no traen")} NIT receptor (${listSome(relevant.map(sheetRow), 3)}); no se puede identificar al cliente.`,
          action: { label: "Abrir Facturación electrónica", path: EINVOICE_PATH },
        });
    }
  if (noScope.length)
    problems["1007"].push({
      level: "blocking",
      message: `${EINVOICE_ORIGIN}: ${plural(noScope.length, "documento no tiene", "documentos no tienen")} base para el 1007 porque el Excel no trae la columna ICUI (ni un encabezado equivalente) y no se definió hasta qué columna restar. Vuelve a importar el archivo eligiendo esa columna.`,
      action: { label: "Abrir Facturación electrónica", path: EINVOICE_PATH },
    });
  if (noVatProfile.length) {
    const cover = vatYearCoverage(input.companyVat, input.year);
    for (const format of ["1005", "1006"] as const) {
      const relevant = noVatProfile.filter((d) => d.category === (format === "1006" ? "sale" : "return"));
      if (relevant.length)
        problems[format].push({
          level: "blocking",
          message: `${EINVOICE_ORIGIN}: ${plural(relevant.length, "documento con IVA tiene fecha", "documentos con IVA tienen fecha")} sin responsabilidad de IVA (48) vigente${cover.known ? "" : " (falta el perfil de IVA del año)"}; no se sabe si entran al ${format}. Regístrala con su fecha efectiva en Empresas → Fiscal.`,
        });
    }
  }
  return { proposals, problems, pendingCustomers: customersList, audit, reconciliation: rec, documents: docs.length, bases };
}

/** Texto corto para mostrar una diferencia de conciliación. */
export const money = (cents: number) => formatExoCents(cents);

/**
 * Suma las filas de ventas a las que ya propone otro origen (Compras) cuando son del MISMO tercero: una sola fila por informado
 * en 1005 y 1006, cada aporte en su propia columna. Las filas sin coincidencia se agregan tal cual.
 */
export function mergeByThird(base: SyncProposal[], extra: SyncProposal[], valueKeys: string[]): SyncProposal[] {
  const out = base.map((p) => ({ ...p, data: { ...p.data } }));
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  for (const p of extra) {
    const same = out.find((x) => x.data.docNumber === p.data.docNumber && x.data.docTypeCode === p.data.docTypeCode);
    if (!same) {
      out.push(p);
      continue;
    }
    const exact = { ...((same.data.exactCents ?? {}) as Record<string, number>) };
    const extraExact = (p.data.exactCents ?? {}) as Record<string, number>;
    for (const k of valueKeys) {
      same.data[k] = num(same.data[k]) + num(p.data[k]);
      if (k in extraExact) exact[k] = num(exact[k]) + num(extraExact[k]);
    }
    same.data.exactCents = exact;
    same.originRef = `${same.originRef} + ${p.originRef}`;
  }
  return out;
}

/** Los registros de 1007 que propone ventas pueden coincidir con los de Cripto (mismo tercero y concepto 4001): se avisa, no se mezclan. */
export function overlapWarnings(crypto: SyncProposal[], sales: SyncProposal[]): Problem[] {
  const key = (p: SyncProposal) => `${p.data.docTypeCode}|${p.data.docNumber}`;
  const cryptoKeys = new Set(crypto.map(key));
  const shared = [...new Set(sales.filter((p) => cryptoKeys.has(key(p))).map((p) => `${p.data.docNumber}`))];
  return shared.length
    ? [{ level: "warning", message: `${plural(shared.length, "tercero aparece", "terceros aparecen")} en Transacciones Cripto y en Facturación electrónica con concepto 4001 (${listSome(shared)}): quedan filas separadas por origen; revisa que no sea el mismo ingreso.` }]
    : [];
}
