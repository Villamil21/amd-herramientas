import {
  RETENTION_TYPE_LABEL,
  RETENTION_TYPES,
  type DocumentTitleMapping,
  type PersonType,
  type Supplier,
  type SupplierWithholdingRule,
  type UvtValue,
  type WithholdingRate,
} from "../../../../types/models";
import { normalizeKey } from "../../../../utils/text";
import { formatCop } from "../../invoice-vat/parser/amounts";
import type {
  AppliedRule,
  DocDecision,
  DocRow,
  FileResult,
  FiscalChange,
  FiscalConflict,
  MonthCount,
  ParsedDocument,
  PendingSupplier,
  RuleLine,
  SubtypeDetail,
  SummaryLine,
  UnknownTitle,
  WithholdingReport,
} from "../types";
import { EXCLUDED_CODES, excludedCode, fiscalCodes, regimeKey, regimeValue } from "./fiscal";
import { formatRateBp, impliedRateBp, minBaseCents, periodLabel, retentionCents, roundToThousands, sameRetention } from "./money";

export interface AnalysisContext {
  suppliers: Supplier[];
  rates: WithholdingRate[];
  uvts: UvtValue[];
  titles: DocumentTitleMapping[];
  /** Periodo elegido por el usuario cuando hay empate (AAAA-MM). */
  periodChoice?: string;
  /** Decisiones por archivo (regla para esta factura, base manual, revisión de la Rete fuente). */
  decisions?: Record<string, DocDecision>;
  /** Cambios fiscales que el usuario decidió mantener o revisar después: `${nit}|${regimeKey}`. */
  dismissedFiscal?: ReadonlySet<string>;
}

export const fiscalDismissKey = (nit: string, regime: string) => `${nit}|${regimeKey(regime)}`;

/** «Persona Jurídica» → PJ, «Persona Natural» → PN. */
export function suggestPersonType(taxpayerType?: string): PersonType | undefined {
  const key = normalizeKey(taxpayerType ?? "");
  if (/juridica/.test(key)) return "PJ";
  if (/natural/.test(key)) return "PN";
  return undefined;
}

const documentKey = (nit: string, number: string) => `${nit}|${number.replace(/[\s-]/g, "").toUpperCase()}`;

function mostFrequent(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function detectPeriod(parsed: ParsedDocument[], choice?: string) {
  const counts = new Map<string, number>();
  for (const d of parsed) if (d.issueDate) counts.set(d.issueDate.slice(0, 7), (counts.get(d.issueDate.slice(0, 7)) ?? 0) + 1);
  const months: MonthCount[] = [...counts.entries()]
    .map(([key, count]) => ({ key, label: periodLabel(key), count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const max = months[0]?.count ?? 0;
  const tie = months.filter((m) => m.count === max).length > 1 ? months.filter((m) => m.count === max) : [];
  const key = choice && counts.has(choice) ? choice : tie.length ? undefined : months[0]?.key;
  return { key, label: key ? periodLabel(key) : undefined, months, tie };
}

/** Datos del PDF comunes a todas las filas leídas. */
function baseRow(fileName: string, doc: ParsedDocument): DocRow {
  const informed = doc.retefuenteCents;
  return {
    fileName,
    status: "review",
    counts: false,
    issues: [],
    notes: [],
    title: doc.title,
    titleKey: normalizeKey(doc.title),
    number: doc.number,
    issueDate: doc.issueDate,
    periodKey: doc.issueDate?.slice(0, 7),
    nit: doc.supplierNit,
    supplierName: doc.supplierName,
    taxpayerType: doc.taxpayerType,
    fiscalText: doc.fiscalText,
    fiscalCodes: doc.fiscalCodes,
    ruleOptions: [],
    lines: [],
    subtotalCents: doc.subtotalCents,
    informedCents: informed,
    impliedRateBp: informed && doc.subtotalCents ? impliedRateBp(informed, doc.subtotalCents) : undefined,
    retentionCents: 0,
    pageCount: doc.pageCount,
    products: doc.products,
  };
}

function appliedRule(rateId: number, baseMode: AppliedRule["baseMode"], rates: Map<number, WithholdingRate>): AppliedRule | undefined {
  const rate = rates.get(rateId);
  return rate ? { rateId, retentionType: rate.retentionType, subtypeName: rate.name, baseMode } : undefined;
}

/**
 * Configuración del proveedor, regla, tope y comparación con la Rete fuente
 * del PDF para un documento del periodo que no está duplicado ni excluido.
 */
function evaluate(row: DocRow, doc: ParsedDocument, supplier: Supplier | undefined, ctx: AnalysisContext, rates: Map<number, WithholdingRate>): void {
  const decision = ctx.decisions?.[row.fileName] ?? {};

  if (!supplier) {
    row.status = "pending-supplier";
    row.issues.push("El proveedor no está registrado: configura PJ / PN, tipo, subtipo y modo de base.");
    return;
  }
  row.supplierId = supplier.id;
  row.personType = supplier.personType ?? undefined;
  const rules = supplier.withholdingRules ?? [];
  row.ruleOptions = rules.flatMap((r) => appliedRule(r.rateId, r.baseMode, rates) ?? []);
  const missing = [!supplier.personType && "PJ / PN", rules.length === 0 && "tipo, subtipo y modo de base"].filter(Boolean);
  if (missing.length) {
    row.status = "pending-supplier";
    row.issues.push(`Falta completar el proveedor: ${missing.join(" y ")}.`);
    return;
  }

  if (rules.some((r) => !rates.has(r.rateId))) {
    row.status = "review";
    row.issues.push("Error de configuración: el subtipo de retención del proveedor ya no existe en la Tabla de retenciones.");
    return;
  }
  if (rules.length > 1) return evaluateRules(row, doc, rules, decision, ctx, rates);
  const chosen = rules[0];
  const rate = rates.get(chosen.rateId)!;
  row.rule = { rateId: rate.id, retentionType: rate.retentionType, subtypeName: rate.name, baseMode: chosen.baseMode };

  const year = Number(doc.issueDate!.slice(0, 4));
  const uvt = ctx.uvts.find((u) => u.year === year);
  if (!uvt) {
    row.status = "review";
    row.issues.push(`Error de configuración: no hay valor UVT para ${year} en la Tabla de retenciones.`);
    return;
  }
  row.uvtYear = year;
  row.uvtPesos = uvt.valuePesos;
  row.baseUvtCenti = rate.baseUvtCenti;
  row.minBaseCents = minBaseCents(rate.baseUvtCenti, uvt.valuePesos);

  // Base y tarifa: revisión del usuario, base manual o subtotal.
  const informed = doc.retefuenteCents ?? 0;
  const review = decision.review;
  let base: number | undefined;
  let rateBp = rate.rateBp;
  if (review?.kind === "corrected") {
    base = review.baseCents;
    rateBp = review.rateBp;
  } else if (review?.kind === "accept-informed" && informed > 0 && doc.subtotalCents) {
    base = doc.subtotalCents;
    rateBp = row.impliedRateBp ?? rateBp;
  } else if (chosen.baseMode === "manual") {
    base = decision.manualBaseCents;
    if (base === undefined) {
      row.status = "pending-base";
      row.issues.push("La regla usa una base diferente: indica la base de retención de este documento (puedes revisar los productos).");
      return;
    }
  } else {
    base = doc.subtotalCents;
    if (base === undefined) {
      row.status = "review";
      row.issues.push("No se encontró el Subtotal en «Datos Totales».");
      return;
    }
  }
  row.baseCents = base;
  row.rateBp = rateBp;

  // Tope: por debajo de la base mínima no hay retención ni base para la declaración.
  if (base < row.minBaseCents) {
    row.status = "below-minimum";
    row.calculatedCents = 0;
    if (informed > 0) row.notes.push(`El documento informa Rete fuente de ${formatCop(informed)} aunque la base no supera el tope.`);
    return;
  }

  const calculated = review?.kind === "accept-informed" && informed > 0 ? informed : retentionCents(base, rateBp);
  row.calculatedCents = calculated;
  if (informed <= 0) {
    row.comparison = "none";
    row.notes.push("El documento no informa Rete fuente: se usa la retención calculada con la configuración.");
  } else if (sameRetention(calculated, informed)) {
    row.comparison = "match";
    if (review?.kind === "accept-informed") row.notes.push("Base y tarifa detectadas confirmadas por el usuario.");
    if (review?.kind === "corrected") row.notes.push("Base y tarifa corregidas por el usuario; coinciden con la Rete fuente informada.");
  } else {
    row.comparison = "difference";
    row.status = "difference";
    row.issues.push(
      review?.kind === "corrected"
        ? "La base y tarifa ingresadas no coinciden con la Rete fuente informada."
        : `La retención calculada (${formatCop(calculated)}) no coincide con la Rete fuente del documento (${formatCop(informed)}).`,
    );
    return;
  }

  row.status = "validated";
  row.retentionCents = calculated;
  row.counts = calculated > 0;
  if (calculated === 0) row.notes.push(`No genera retención (tarifa ${formatRateBp(rateBp)}): no se lleva a la declaración.`);
}

const ruleName = (rule: AppliedRule) => `${RETENTION_TYPE_LABEL[rule.retentionType]} — ${rule.subtypeName}`;

/** Valor común a todas las líneas, o undefined si difieren. */
function shared<T>(values: T[]): T | undefined {
  return values.length > 0 && values.every((v) => v === values[0]) ? values[0] : undefined;
}

/**
 * Proveedor con varias reglas: cada una se decide por documento (aplica / no
 * aplica) y tiene su propia base, tope y tarifa. La Rete fuente del PDF se
 * compara con la suma de las que aplican.
 */
function evaluateRules(row: DocRow, doc: ParsedDocument, rules: SupplierWithholdingRule[], decision: DocDecision, ctx: AnalysisContext, rates: Map<number, WithholdingRate>): void {
  const year = Number(doc.issueDate!.slice(0, 4));
  const uvt = ctx.uvts.find((u) => u.year === year);
  if (!uvt) {
    row.status = "review";
    row.issues.push(`Error de configuración: no hay valor UVT para ${year} en la Tabla de retenciones.`);
    return;
  }
  row.uvtYear = year;
  row.uvtPesos = uvt.valuePesos;

  // Sin decisión del usuario manda la predeterminada: ella aplica y las demás no.
  const hasDefault = rules.some((r) => r.isDefault);
  const lines = rules.map((r): RuleLine => {
    const rate = rates.get(r.rateId)!;
    const d = decision.rules?.[r.rateId] ?? {};
    const applies = d.applies ?? (hasDefault ? r.isDefault : undefined);
    const min = minBaseCents(rate.baseUvtCenti, uvt.valuePesos);
    const line: RuleLine = {
      rule: { rateId: rate.id, retentionType: rate.retentionType, subtypeName: rate.name, baseMode: r.baseMode },
      state: applies === undefined ? "pending" : applies ? "applies" : "not-applicable",
      baseUvtCenti: rate.baseUvtCenti,
      minBaseCents: min,
      rateBp: rate.rateBp,
      belowMinimum: false,
      counts: false,
    };
    if (!applies) return line;
    line.baseCents = d.baseCents ?? (r.baseMode === "manual" ? undefined : doc.subtotalCents);
    if (line.baseCents !== undefined) {
      line.belowMinimum = line.baseCents < min;
      line.calculatedCents = line.belowMinimum ? 0 : retentionCents(line.baseCents, rate.rateBp);
    }
    return line;
  });
  row.lines = lines;

  const applied = lines.filter((l) => l.state === "applies");
  const undecided = lines.filter((l) => l.state === "pending");
  const withoutBase = applied.filter((l) => l.baseCents === undefined);
  if (undecided.length) row.issues.push(`Indica si aplica en este documento: ${undecided.map((l) => `«${ruleName(l.rule)}»`).join(", ")}.`);
  for (const l of withoutBase) row.issues.push(`Falta la base de retención de «${ruleName(l.rule)}» (puedes revisar los productos).`);
  if (undecided.length || withoutBase.length) {
    row.status = undecided.length ? "review" : "pending-base";
    return;
  }

  // Cada regla aporta solo su propia base: el subtotal no se repite por regla.
  const total = applied.reduce((s, l) => s + l.calculatedCents!, 0);
  const bases = applied.reduce((s, l) => s + l.baseCents!, 0);
  row.baseCents = applied.length ? bases : undefined;
  row.calculatedCents = total;
  row.rateBp = shared(applied.map((l) => l.rateBp));
  row.minBaseCents = shared(applied.map((l) => l.minBaseCents));
  for (const l of applied) {
    if (l.belowMinimum) row.notes.push(`«${ruleName(l.rule)}»: la base (${formatCop(l.baseCents!)}) no supera la base mínima (${formatCop(l.minBaseCents)}); no genera retención.`);
  }
  if (applied.length > 1 && doc.subtotalCents !== undefined && bases > doc.subtotalCents) {
    row.notes.push(`Las bases de las reglas suman ${formatCop(bases)}, más que el Subtotal del documento (${formatCop(doc.subtotalCents)}).`);
  }

  const informed = doc.retefuenteCents ?? 0;
  if (informed > 0) {
    if (!sameRetention(total, informed)) {
      row.comparison = "difference";
      row.status = "difference";
      row.issues.push(
        applied.length
          ? `La suma de las retenciones calculadas (${formatCop(total)}) no coincide con la Rete fuente del documento (${formatCop(informed)}): revisa las reglas y sus bases.`
          : `Ninguna regla aplica, pero el documento informa Rete fuente de ${formatCop(informed)}.`,
      );
      return;
    }
    row.comparison = "match";
  } else {
    if (applied.length && applied.every((l) => l.belowMinimum)) {
      row.status = "below-minimum";
      return;
    }
    row.comparison = "none";
    if (total > 0) row.notes.push("El documento no informa Rete fuente: se usa la retención calculada con la configuración.");
  }

  row.status = "validated";
  row.retentionCents = total;
  row.counts = total > 0;
  for (const l of applied) l.counts = l.calculatedCents! > 0;
  if (!applied.length) row.notes.push("Ninguna regla aplica en esta factura: no se lleva a la declaración.");
  else if (total === 0) row.notes.push("No genera retención: no se lleva a la declaración.");
}

/** Proveedor con una sola regla: su retención como línea única, con los datos ya resueltos del documento. */
function singleLine(row: DocRow, rates: Map<number, WithholdingRate>): RuleLine[] {
  if (!row.rule || row.minBaseCents === undefined) return [];
  return [
    {
      rule: row.rule,
      state: "applies",
      baseUvtCenti: row.baseUvtCenti!,
      minBaseCents: row.minBaseCents,
      rateBp: row.rateBp ?? rates.get(row.rule.rateId)!.rateBp,
      baseCents: row.baseCents,
      calculatedCents: row.calculatedCents,
      belowMinimum: row.status === "below-minimum",
      counts: row.counts,
    },
  ];
}

/**
 * Cruza los documentos leídos con proveedores, tabla de retenciones, UVT y
 * títulos. Función pura: al cambiar una configuración o una decisión basta
 * con volver a llamarla (no se releen los PDF).
 */
export function buildWithholdingReport(results: FileResult[], ctx: AnalysisContext): WithholdingReport {
  const rates = new Map(ctx.rates.map((r) => [r.id, r]));
  const suppliersByNit = new Map(ctx.suppliers.map((s) => [s.nit, s]));
  const titles = new Map(ctx.titles.map((t) => [t.normalizedTitle, t]));
  const parsedDocs = results.flatMap((r) => (r.kind === "parsed" ? [r.doc] : []));
  const period = detectPeriod(parsedDocs, ctx.periodChoice);
  const seen = new Map<string, string>();

  const rows: DocRow[] = results.map((r) => {
    if (r.kind !== "parsed") {
      return { fileName: r.fileName, status: r.kind, counts: false, issues: [r.message], notes: [], fiscalCodes: [], ruleOptions: [], lines: [], retentionCents: 0 };
    }
    const { doc } = r;
    const row = baseRow(r.fileName, doc);
    const supplier = suppliersByNit.get(doc.supplierNit);
    row.personType = supplier?.personType ?? undefined;
    row.category = titles.get(row.titleKey!)?.category;

    if (!doc.issueDate) {
      row.issues.push("No se encontró la fecha de emisión: no se puede asignar al periodo.");
      return row;
    }
    if (!period.key) {
      row.status = "pending-period";
      row.issues.push("Hay el mismo número de documentos en varios meses: elige el periodo a procesar.");
      return row;
    }
    if (row.periodKey !== period.key) {
      row.status = "out-of-period";
      row.issues.push(`Fecha de emisión fuera del periodo (${periodLabel(row.periodKey!)}).`);
      return row;
    }
    if (!doc.number) {
      row.issues.push("No se encontró el número del documento.");
      return row;
    }
    const key = documentKey(doc.supplierNit, doc.number);
    row.duplicateOf = seen.get(key);
    if (row.duplicateOf) {
      row.status = "duplicate";
      row.issues.push(`Posible duplicado de «${row.duplicateOf}» (mismo NIT y número).`);
      return row;
    }
    seen.set(key, r.fileName);

    // Régimen / responsabilidad del emisor: el del PDF; si no trae, el guardado.
    const codes = doc.fiscalCodes.length ? doc.fiscalCodes : fiscalCodes(supplier?.fiscalRegime);
    if (!doc.fiscalCodes.length && codes.length) row.notes.push(`La factura no muestra el régimen fiscal; se usa el guardado en el proveedor (${codes.join(";")}).`);
    const excluded = excludedCode(codes);
    if (excluded) {
      row.status = "ignored-regime";
      row.excludedCode = excluded;
      row.issues.push(`${excluded}: ${EXCLUDED_CODES[excluded]}. No se calcula retención.`);
      return row;
    }
    if (!row.category) {
      row.status = "pending-title";
      row.issues.push(`Título nuevo «${doc.title}»: indica si es Factura o Nota.`);
      return row;
    }
    evaluate(row, doc, supplier, ctx, rates);
    if (!row.lines.length) row.lines = singleLine(row, rates);
    return row;
  });

  const inPeriod = rows.filter((r) => r.periodKey && r.periodKey === period.key && r.status !== "duplicate");

  // Proveedores pendientes: uno por NIT.
  const pendingByNit = new Map<string, DocRow[]>();
  for (const r of rows) if (r.status === "pending-supplier") pendingByNit.set(r.nit!, [...(pendingByNit.get(r.nit!) ?? []), r]);
  const pendingSuppliers: PendingSupplier[] = [...pendingByNit.entries()].map(([nit, list]) => {
    const s = suppliersByNit.get(nit);
    const withFiscal = list.find((r) => r.fiscalCodes.length || r.fiscalText);
    return {
      nit,
      name: mostFrequent(list.map((r) => r.supplierName ?? "").filter(Boolean)),
      taxpayerType: list.find((r) => r.taxpayerType)?.taxpayerType,
      fiscalText: withFiscal?.fiscalText,
      fiscalRegime: withFiscal ? regimeValue(withFiscal.fiscalCodes, withFiscal.fiscalText) : undefined,
      documentCount: list.length,
      supplierId: s?.id,
      missing: s ? [!s.personType && "PJ / PN", !(s.withholdingRules ?? []).length && "reglas de retención"].filter((x): x is string => Boolean(x)) : [],
    };
  });

  // Régimen fiscal: cambios frente a lo guardado y conflictos dentro del lote.
  const fiscalByNit = new Map<string, Map<string, { regime: string; files: string[] }>>();
  for (const r of inPeriod) {
    if (!r.nit || (!r.fiscalCodes.length && !r.fiscalText)) continue;
    const regime = regimeValue(r.fiscalCodes, r.fiscalText);
    const variants = fiscalByNit.get(r.nit) ?? new Map();
    const v = variants.get(regimeKey(regime)) ?? { regime, files: [] };
    v.files.push(r.fileName);
    variants.set(regimeKey(regime), v);
    fiscalByNit.set(r.nit, variants);
  }
  const fiscalConflicts: FiscalConflict[] = [];
  const fiscalChanges: FiscalChange[] = [];
  const fiscalMissing: WithholdingReport["fiscalMissing"] = [];
  for (const [nit, variants] of fiscalByNit) {
    const s = suppliersByNit.get(nit);
    const name = s?.businessName ?? rows.find((r) => r.nit === nit)?.supplierName ?? "";
    if (variants.size > 1) {
      fiscalConflicts.push({ nit, name, variants: [...variants.values()] });
      continue;
    }
    if (!s) continue;
    const [{ regime, files }] = [...variants.values()];
    if (!s.fiscalRegime) fiscalMissing.push({ supplierId: s.id, nit, name, detected: regime });
    else if (regimeKey(s.fiscalRegime) !== regimeKey(regime) && !ctx.dismissedFiscal?.has(fiscalDismissKey(nit, regime))) {
      fiscalChanges.push({ supplierId: s.id, nit, name, stored: s.fiscalRegime, detected: regime, files });
    }
  }

  const fiscalUnknown: WithholdingReport["fiscalUnknown"] = [];
  for (const r of inPeriod) {
    const s = r.nit ? suppliersByNit.get(r.nit) : undefined;
    if (!s || s.fiscalRegime?.trim() || fiscalByNit.has(r.nit!)) continue;
    const u = fiscalUnknown.find((x) => x.nit === s.nit);
    if (u) u.files.push(r.fileName);
    else fiscalUnknown.push({ supplierId: s.id, nit: s.nit, name: s.businessName, files: [r.fileName] });
  }

  const unknown = new Map<string, UnknownTitle>();
  for (const r of rows) {
    if (r.status !== "pending-title") continue;
    const u = unknown.get(r.titleKey!) ?? { normalizedTitle: r.titleKey!, displayTitle: r.title!, documentCount: 0 };
    u.documentCount++;
    unknown.set(r.titleKey!, u);
  }

  // Resumen para la declaración: solo Facturas válidas que generaron retención.
  const counted = rows.filter((r) => r.counts);
  const summary: SummaryLine[] = RETENTION_TYPES.map((t) => ({ retentionType: t, pj: { baseCents: 0, retentionCents: 0 }, pn: { baseCents: 0, retentionCents: 0 } }));
  const detail: SubtypeDetail[] = [];
  let invoicesCents = 0;
  const notesSummary = { baseCents: 0, retentionCents: 0, documentCount: 0 };
  for (const r of counted) {
    const person = r.personType!;
    if (r.category !== "invoice") notesSummary.documentCount++;
    // Una línea por regla que generó retención: cada una suma su propia base.
    for (const l of r.lines) {
      if (!l.counts) continue;
      const base = l.baseCents!;
      const retention = l.calculatedCents!;
      if (r.category === "invoice") {
        const line = summary.find((x) => x.retentionType === l.rule.retentionType)!;
        const cell = person === "PJ" ? line.pj : line.pn;
        cell.baseCents += base;
        cell.retentionCents += retention;
        invoicesCents += retention;
      } else {
        notesSummary.baseCents += base;
        notesSummary.retentionCents += retention;
      }
      const d = detail.find((x) => x.category === r.category && x.retentionType === l.rule.retentionType && x.subtypeName === l.rule.subtypeName && x.personType === person && x.rateBp === l.rateBp);
      if (d) {
        d.baseCents += base;
        d.retentionCents += retention;
        d.documentCount++;
      } else {
        detail.push({ category: r.category!, retentionType: l.rule.retentionType, subtypeName: l.rule.subtypeName, personType: person, rateBp: l.rateBp, baseCents: base, retentionCents: retention, documentCount: 1 });
      }
    }
  }
  detail.sort((a, b) => a.category.localeCompare(b.category) || RETENTION_TYPES.indexOf(a.retentionType) - RETENTION_TYPES.indexOf(b.retentionType) || a.subtypeName.localeCompare(b.subtypeName) || a.personType.localeCompare(b.personType));
  const notesCents = notesSummary.retentionCents;
  const netCents = invoicesCents - notesCents;

  const count = (...statuses: DocRow["status"][]) => rows.filter((r) => statuses.includes(r.status)).length;
  const uvtYears = [...new Set(rows.filter((r) => r.uvtYear).map((r) => r.uvtYear!))].sort();

  return {
    rows,
    period,
    stats: {
      files: rows.length,
      processed: parsedDocs.length,
      ignored: count("ignored-regime", "incompatible", "error"),
      outOfPeriod: count("out-of-period"),
      duplicates: count("duplicate"),
      belowMinimum: count("below-minimum"),
      validated: count("validated"),
      pending: count("pending-supplier", "pending-base", "pending-title", "pending-period", "difference", "review"),
      failed: count("incompatible", "error"),
    },
    pendingSuppliers,
    fiscalChanges,
    fiscalMissing,
    fiscalConflicts,
    fiscalUnknown,
    unknownTitles: [...unknown.values()],
    summary,
    detail,
    notesSummary,
    totals: { invoicesCents, notesCents, netCents, netRoundedCents: roundToThousands(netCents) },
    uvtUsed: uvtYears.map((year) => ({ year, valuePesos: ctx.uvts.find((u) => u.year === year)!.valuePesos })),
  };
}
