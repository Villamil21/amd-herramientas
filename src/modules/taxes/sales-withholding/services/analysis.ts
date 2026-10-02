import type { Company, SalesCategory, SelfWithholdingRate } from "../../../../types/models";
import { formatInteger } from "../../../../utils/format";
import { roundToThousands } from "../../withholding/services/money";
import type { AnalyzedRow, CategorySummary, IssuerNit, Pending, SalesAnalysis, SalesRow } from "../types";
import { normalizeCiiu } from "./ciiu";
import { sumMicro, withholdingCents } from "./decimal";
import { normalizeNit } from "./workbookReader";

/** Clasificación guardada: normalizeKey del tipo de documento → categoría. */
export type TypeRules = Map<string, SalesCategory>;

export interface AnalysisContext {
  rules: TypeRules;
  companies: Company[];
  rates: SelfWithholdingRate[];
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", formatInteger(n)));

/** Fila Excel de cada documento para los mensajes: «Fila 12 (FE 12558)». */
export const rowLabel = (r: SalesRow) => `Fila ${r.rowNumber}${r.prefix || r.folio ? ` (${[r.prefix, r.folio].filter(Boolean).join(" ")})` : ""}`;

/** Empresa con el NIT Emisor (solo Empresas, nunca Proveedores). Acepta el NIT guardado con o sin DV. */
export function findCompany(companies: Company[], nit: string): Company | undefined {
  if (!nit) return undefined;
  return companies.find((c) => {
    const own = normalizeNit(c.nit);
    return own === nit || (c.dv.trim() !== "" && own === `${nit}${c.dv.trim()}`);
  });
}

export function findRate(rates: SelfWithholdingRate[], ciiu: string): SelfWithholdingRate | undefined {
  const key = normalizeCiiu(ciiu);
  return key ? rates.find((r) => r.normalizedCode === key) : undefined;
}

/** Clave de documento: CUFE/CUDE; sin CUFE, NIT + tipo + prefijo + folio. */
const documentKey = (r: SalesRow) => (r.cufe ? `cufe:${r.cufe.toLowerCase()}` : `doc:${r.nit}|${r.typeKey}|${r.prefix.toUpperCase()}|${r.folio}`);
const folioKey = (r: SalesRow) => (r.folio ? `${r.nit}|${r.typeKey}|${r.prefix.toUpperCase()}|${r.folio}` : "");

function summarize(rows: AnalyzedRow[], category: SalesCategory): CategorySummary {
  const counted = rows.filter((r) => r.counted && r.category === category);
  return { count: counted.length, base: sumMicro(counted.map((r) => r.base!)) };
}

/**
 * Clasifica cada fila, detecta duplicados, identifica la empresa por NIT Emisor,
 * cruza Empresa → CIIU → Tabla de Autorretenciones y calcula:
 *   Autorretención Facturas = Base Facturas × Tarifa
 *   Autorretención Notas Crédito = Base Notas Crédito × Tarifa
 *   Autorretención neta = Facturas − Notas Crédito
 * Nada se asume: sin empresa, CIIU o tarifa no hay autorretención (pendiente bloqueante).
 */
export function analyzeSales(rows: SalesRow[], ctx: AnalysisContext): SalesAnalysis {
  const pending: Pending[] = [];

  // 1. Duplicados (primera aparición cuenta; las siguientes no se suman).
  const firstByKey = new Map<string, number>();
  const analyzed: AnalyzedRow[] = rows.map((r) => {
    const key = documentKey(r);
    const first = firstByKey.get(key);
    if (first === undefined) firstByKey.set(key, r.rowNumber);
    const category = r.typeKey ? ctx.rules.get(r.typeKey) : undefined;
    const status: AnalyzedRow["status"] =
      first !== undefined ? "duplicate" : r.invalid.length > 0 ? "invalid" : !r.typeKey ? "no_type" : !category ? "unclassified" : "ok";
    return { ...r, category, status, duplicateOf: first, counted: status === "ok" };
  });

  // 2. Tipos de documento sin clasificar (una pregunta por tipo, no por fila).
  const newTypes = new Map<string, { key: string; label: string; rows: number }>();
  for (const r of analyzed) {
    if (r.status !== "unclassified") continue;
    const t = newTypes.get(r.typeKey) ?? { key: r.typeKey, label: r.documentType, rows: 0 };
    t.rows += 1;
    newTypes.set(r.typeKey, t);
  }
  for (const t of newTypes.values()) {
    pending.push({ kind: "new_type", blocking: true, title: `Se encontró un nuevo tipo de documento: "${t.label}"`, detail: `${plural(t.rows, "1 fila", "# filas")} sin sumar hasta clasificarlo.` });
  }

  const withoutType = analyzed.filter((r) => r.status === "no_type");
  if (withoutType.length > 0) {
    pending.push({
      kind: "no_type",
      blocking: true,
      title: plural(withoutType.length, "1 fila no tiene Tipo de documento.", "# filas no tienen Tipo de documento."),
      detail: "No se pueden clasificar como Facturas o Notas Crédito. Revisa el archivo original.",
      items: withoutType.map(rowLabel),
    });
  }

  const invalid = analyzed.filter((r) => r.status === "invalid");
  if (invalid.length > 0) {
    pending.push({
      kind: "invalid_value",
      blocking: true,
      title: plural(invalid.length, "1 fila requiere revisión: tiene valores no numéricos.", "# filas requieren revisión: tienen valores no numéricos."),
      detail: "Esas filas no se suman. Solo las celdas vacías cuentan como 0.",
      items: invalid.map((r) => `${rowLabel(r)}: ${r.invalid.map((i) => `${i.column} «${i.text}»`).join(", ")}`),
    });
  }

  const duplicates = analyzed.filter((r) => r.status === "duplicate");
  if (duplicates.length > 0) {
    pending.push({
      kind: "duplicate",
      blocking: false,
      title: plural(duplicates.length, "1 posible duplicado no se sumó.", "# posibles duplicados no se sumaron."),
      detail: "Tienen el mismo CUFE/CUDE (o, sin CUFE, el mismo NIT, tipo, prefijo y folio) que una fila anterior; solo se suma la primera.",
      items: duplicates.map((r) => `${rowLabel(r)}: igual a la fila ${r.duplicateOf}`),
    });
  }

  // Validación secundaria: mismo prefijo y folio con CUFE distinto (sí se suman).
  const byFolio = new Map<string, AnalyzedRow[]>();
  for (const r of analyzed) {
    const key = r.status !== "duplicate" && r.cufe ? folioKey(r) : "";
    if (key) byFolio.set(key, [...(byFolio.get(key) ?? []), r]);
  }
  const sameFolio = [...byFolio.values()].filter((list) => list.length > 1);
  if (sameFolio.length > 0) {
    pending.push({
      kind: "same_folio",
      blocking: false,
      title: plural(sameFolio.length, "1 folio aparece con CUFE/CUDE distintos.", "# folios aparecen con CUFE/CUDE distintos."),
      detail: "Se suman porque son documentos distintos según DIAN; revisa que no estén repetidos.",
      items: sameFolio.map((list) => `${[list[0].prefix, list[0].folio].filter(Boolean).join(" ")}: filas ${list.map((r) => r.rowNumber).join(", ")}`),
    });
  }

  // 3. NIT Emisor: el archivo debe pertenecer a una sola empresa.
  const nitMap = new Map<string, IssuerNit>();
  for (const r of analyzed) {
    if (r.status === "duplicate" || !r.nit) continue;
    const n = nitMap.get(r.nit) ?? { nit: r.nit, name: r.issuerName, rows: 0 };
    n.rows += 1;
    nitMap.set(r.nit, n);
  }
  const nits = [...nitMap.values()];
  const withoutNit = analyzed.filter((r) => r.status !== "duplicate" && !r.nit);
  if (withoutNit.length > 0) {
    pending.push({
      kind: "no_nit",
      blocking: true,
      title: plural(withoutNit.length, "1 fila no tiene NIT Emisor.", "# filas no tienen NIT Emisor."),
      detail: "No se puede confirmar a qué empresa pertenecen.",
      items: withoutNit.map(rowLabel),
    });
  }

  let issuer: IssuerNit | undefined;
  let company: Company | undefined;
  let rate: SelfWithholdingRate | undefined;
  if (nits.length > 1) {
    pending.push({
      kind: "multiple_nits",
      blocking: true,
      title: "Se encontraron ventas de más de un NIT Emisor en el mismo archivo.",
      detail: "No se calcula una única tarifa hasta resolverlo. Revisa que el archivo corresponda a una sola empresa.",
      items: nits.map((n) => `NIT ${n.nit} · ${n.name || "sin nombre"} · ${plural(n.rows, "1 fila", "# filas")}`),
    });
  } else if (nits.length === 1) {
    issuer = nits[0];
    company = findCompany(ctx.companies, issuer.nit);
    if (!company) {
      pending.push({ kind: "company_missing", blocking: true, title: "La empresa emisora no está registrada.", detail: `NIT ${issuer.nit} · ${issuer.name || "sin nombre"}. Créala en Datos → Empresas.` });
    } else if (!company.ciiuCode.trim()) {
      pending.push({ kind: "ciiu_missing", blocking: true, title: `La empresa ${company.razonSocial} no tiene Código CIIU configurado.`, detail: "Sin CIIU no se puede obtener la tarifa de autorretención." });
    } else {
      rate = findRate(ctx.rates, company.ciiuCode);
      if (!rate) {
        pending.push({
          kind: "ciiu_not_found",
          blocking: true,
          title: `El Código CIIU ${company.ciiuCode} de la empresa no existe en la Tabla de Autorretenciones.`,
          detail: "No se asume ninguna tarifa (tampoco 0 %). Corrige el CIIU de la empresa o agrega el código a la tabla.",
        });
      }
    }
  }

  // 4. Bases y autorretención.
  const invoices = summarize(analyzed, "invoice");
  const creditNotes = summarize(analyzed, "credit_note");
  let totals: SalesAnalysis["totals"];
  if (rate) {
    invoices.withholdingCents = withholdingCents(invoices.base, rate.rateBp);
    creditNotes.withholdingCents = withholdingCents(creditNotes.base, rate.rateBp);
    const netCents = invoices.withholdingCents - creditNotes.withholdingCents;
    totals = { netCents, netRoundedCents: roundToThousands(netCents) };
  }

  return {
    rows: analyzed,
    nits,
    issuer,
    company,
    rate,
    invoices,
    creditNotes,
    totals,
    newTypes: [...newTypes.values()],
    pending,
    complete: !pending.some((p) => p.blocking),
  };
}
