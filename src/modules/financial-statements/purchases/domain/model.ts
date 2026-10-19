import type { ExoCatalogs, SyncProposal } from "../../../../types/exogena";
import type { MovementInput } from "../../../../types/fs";
import type { Company, Supplier, UvtValue, WithholdingRate } from "../../../../types/models";
import type {
  CompanyVatEntry,
  DocFlag,
  LineClass,
  ParsedPurchase,
  PurchaseDocument,
  PurchaseLine,
  PurchaseRule,
  PurchasesState,
  RetentionPick,
  SupplierFiscalEntry,
  TitleKind,
  RateVersion,
  TitleType,
  YearConcept,
  ExoAlias,
} from "../../../../types/purchases";
import { normalizeKey } from "../../../../utils/text";
import { formatMoneyCents } from "../../../../utils/format";
import { centsToPesos } from "../../../exogena/domain/numbers";
import { nitDigits } from "../../../exogena/domain/text";
import { findCompanyByNit, namesMatch } from "../../shared/companyMatch";
import type { PucIndex } from "../../puc-codes/services/pucCatalog";
import { conceptProblem, isNotApplicablePuc, normalizeClassification, proposeLine, pucProblem, type Proposal } from "./classify";
import { regimeAt, regimeChanged, retentionExemption, vatResponsibleAt, vatYearCoverage, type RegimeAt } from "./history";
import { computeRetention, ratesNear, type RetentionResult } from "./retention";
import { ratesAt } from "./rateVersions";
import { countByDest, DESTS, destStatus, emptyCounts, sortAlerts, type Alert, type AlertTarget, type Dest, type DestCounts, type DestStatus, type Severity } from "./status";
import { resolveThird, thirdColumns, type ResolvedThird } from "./third";

/**
 * Modelo de Compras, costos y exógena para una empresa (NIT comprador) y un año. Es una función pura: recibe lo guardado
 * (facturas, clasificaciones, decisiones) y los datos maestros y recalcula todo. Nada calculado se guarda como fuente de verdad.
 *
 * Reglas que gobiernan el modelo:
 *  - Solo cuentan las facturas vigentes (`current`) y no excluidas. Las versiones duplicadas son evidencia y no afectan resultados.
 *  - Compra suma; Devolución resta base, IVA y retención. El IVA de una devolución va en 1006, no en 1005.
 *  - Un faltante exclusivo de un destino solo bloquea ese destino (EEFF, 1001, 1005, 1006).
 *  - Nunca se inventa un dato tributario, de tercero, de ubicación o de clasificación.
 */

export const ALL_DESTS = DESTS;

export interface PurchasesInput {
  buyerNit: string;
  /** null = facturas sin fecha de expedición. */
  year: number | null;
  state: PurchasesState;
  company?: Company;
  companyVat: readonly CompanyVatEntry[];
  titleTypes: readonly TitleType[];
  rules: readonly PurchaseRule[];
  suppliers: readonly Supplier[];
  supplierFiscal: readonly SupplierFiscalEntry[];
  pucIndex: PucIndex;
  pucConcepts: ReadonlyMap<string, string>;
  concepts1001: readonly YearConcept[];
  rates: readonly WithholdingRate[];
  /** Vigencias por fecha de la Tabla de retenciones. */
  rateVersions?: readonly RateVersion[];
  /** Alias persistentes de Catálogos Exógena. */
  aliases?: readonly ExoAlias[];
  uvts: readonly UvtValue[];
  catalogs: ExoCatalogs | null;
}

export interface LineView {
  docId: number;
  line: PurchaseLine;
  /** +1 compra · −1 devolución. */
  sign: 1 | -1;
  class?: LineClass;
  proposal: Proposal;
  /** Valores confirmados (vacíos mientras la línea esté «Por confirmar»). */
  pucCode: string;
  concept1001: string;
  retention: RetentionPick[];
  confirmed: boolean;
  /** Confirmada con el PUC 7305: excluida a propósito de EEFF y de todo formato exógeno; sus importes de abajo son 0. */
  notApplicable: boolean;
  /** Importes de la línea excluida (con signo): solo informativos, nunca se suman a nada. */
  excludedBaseCents: number;
  excludedVatCents: number;
  /** Importes de la línea con signo. */
  baseCents: number;
  vatCents: number;
  /** Lo que se envía a Estados Financieros: la base y, si la empresa no era responsable de IVA, el IVA como mayor valor. */
  eeffCents: number;
  practicedCents: number;
  assumedCents: number;
  /** Conceptos de esta línea que forman parte de la retención común de la factura (se calcula una sola vez; aquí solo participa). */
  commonRetentionRateIds: number[];
  pucProblem?: string;
  conceptProblem?: string;
}

export interface DocView {
  doc: PurchaseDocument;
  data: ParsedPurchase;
  kind?: TitleKind;
  sign: 1 | -1;
  /** Vigente y no excluida: la única que alimenta resultados. */
  counts: boolean;
  excluded: boolean;
  month: number | null;
  supplierNit: string;
  supplier?: Supplier;
  regime: RegimeAt;
  exemption?: { code: string; label: string };
  vatResponsible: boolean | undefined;
  lines: LineView[];
  baseCents: number;
  vatCents: number;
  retention: RetentionResult;
  alerts: Alert[];
  /** Destinos para los que la factura está lista (sin rojo ni azul propios). */
  ready: Record<Dest, boolean>;
  /** Para una evidencia: diferencias frente a la versión vigente. */
  differences: string[];
}

export interface MonthCoverage {
  /** 1–12, o 0 = sin fecha. */
  month: number;
  purchases: number;
  returns: number;
  purchaseCents: number;
  returnCents: number;
  duplicates: number;
  pending: number;
  blocked: number;
  excluded: number;
  /** Líneas «No aplica» (7305) y su importe: informativo, fuera de compras, EEFF y exógena. */
  notApplicableLines: number;
  notApplicableCents: number;
}

export interface SupplierView {
  nit: string;
  name: string;
  supplier?: Supplier;
  documents: number;
  third: ResolvedThird;
  regimeText: string;
  regimeFrom: RegimeAt["from"];
  history: SupplierFiscalEntry[];
}

export interface Reconciliation {
  applicable: boolean;
  /** 1005 − 1006, en centavos exactos. */
  netVatCents: number;
  /** IVA deducible del 1001, en centavos exactos. */
  vat1001Cents: number;
  differenceCents: number;
  discountableCents: number;
  recoveredCents: number;
  /** Facturas listas para unos destinos y no para otros (explican la diferencia). */
  uneven: string[];
}

export interface EeffPlan {
  movements: MovementInput[];
  readyDocs: number;
  /** Facturas que aún no pueden enviarse (con su mes). */
  pendingDocs: number;
  pendingMonths: string[];
  totalCents: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface PurchasesModel {
  buyerNit: string;
  year: number | null;
  company?: Company;
  docs: DocView[];
  alerts: Alert[];
  counts: Record<Dest, DestCounts>;
  status: Record<Dest, DestStatus>;
  /** Justificación de «No aplica» (1005 y 1006 cuando la empresa no era responsable de IVA). */
  notApplicable: Partial<Record<Dest, string>>;
  coverage: MonthCoverage[];
  suppliers: SupplierView[];
  proposals: { "1001": SyncProposal[]; "1005": SyncProposal[]; "1006": SyncProposal[] };
  reconciliation: Reconciliation;
  eeff: EeffPlan;
  totals: { purchaseCents: number; returnCents: number; purchaseVatCents: number; returnVatCents: number; documents: number; lines: number; pendingLines: number };
}

const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export const monthName = (month: number) => (month === 0 ? "Sin fecha" : (MONTH_NAMES[month - 1] ?? String(month)));

const ivaDest = (kind: TitleKind | undefined): Dest => (kind === "return" ? "1006" : "1005");

const signOf = (kind: TitleKind | undefined): 1 | -1 => (kind === "return" ? -1 : 1);

export const lineLabel = (l: PurchaseLine) => l.description || l.code || `Línea ${l.index + 1}`;

function mostFrequentName(names: string[]): string {
  const counts = new Map<string, { n: number; name: string }>();
  for (const name of names) {
    const key = normalizeKey(name);
    if (!key) continue;
    const c = counts.get(key) ?? { n: 0, name };
    c.n += 1;
    counts.set(key, c);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.name ?? "";
}

/** Diferencias entre dos versiones de la misma factura (para decidir si se sustituye). */
export function documentDifferences(current: PurchaseDocument, other: PurchaseDocument): string[] {
  const out: string[] = [];
  if (current.issueDate !== other.issueDate) out.push(`Fecha: ${current.issueDate ?? "—"} → ${other.issueDate ?? "—"}`);
  if (current.totalCents !== other.totalCents) out.push(`Total: ${current.totalCents === null ? "—" : formatMoneyCents(current.totalCents)} → ${other.totalCents === null ? "—" : formatMoneyCents(other.totalCents)}`);
  if ((current.cufe ?? "") !== (other.cufe ?? "")) out.push("CUFE distinto");
  const a = current.data.lines;
  const b = other.data.lines;
  if (a.length !== b.length) out.push(`Líneas: ${a.length} → ${b.length}`);
  else {
    const changed = a.filter((l, i) => l.baseCents !== b[i].baseCents || l.vatCents !== b[i].vatCents || normalizeKey(l.description) !== normalizeKey(b[i].description)).length;
    if (changed) out.push(`${changed} ${changed === 1 ? "línea cambia" : "líneas cambian"} de valor o descripción`);
  }
  if (current.fingerprint !== other.fingerprint && out.length === 0) out.push("El contenido no es idéntico");
  return out;
}

export function buildPurchasesModel(input: PurchasesInput): PurchasesModel {
  const { state, company } = input;
  const titleKinds = new Map(input.titleTypes.map((t) => [t.titleKey, t.kind]));
  const aliases = input.aliases ?? [];
  const titleAlias = new Map(aliases.filter((a) => a.kind === "title_type").map((a) => [a.aliasKey, a.target]));
  /** Tipo del encabezado: el propio o el de su alias persistente. */
  const kindOfTitle = (titleKey: string) => titleKinds.get(titleKey) ?? titleKinds.get(titleAlias.get(titleKey) ?? "");
  const flagsByDoc = new Map<number, Map<string, DocFlag>>();
  for (const f of state.flags) {
    const m = flagsByDoc.get(f.documentId) ?? new Map<string, DocFlag>();
    m.set(f.kind, f);
    flagsByDoc.set(f.documentId, m);
  }
  const classByLine = new Map(state.lineClasses.map((c) => [`${c.documentId}:${c.lineIndex}`, c]));
  const rulesByKey = (supplierNit: string) => new Map(input.rules.filter((r) => r.supplierNit === supplierNit).map((r) => [r.productKey, r]));
  const supplierByNit = new Map(input.suppliers.map((s) => [nitDigits(s.nit), s]));
  const fiscalByNit = new Map<string, SupplierFiscalEntry[]>();
  for (const e of input.supplierFiscal) fiscalByNit.set(e.supplierNit, [...(fiscalByNit.get(e.supplierNit) ?? []), e]);
  const docById = new Map(state.documents.map((d) => [d.id, d]));

  const currentDocs = state.documents.filter((d) => d.status === "current");
  const majorityBuyerName = mostFrequentName(currentDocs.map((d) => d.buyerName));
  const referenceName = company?.razonSocial ?? majorityBuyerName;
  const vatCoverage = input.year === null ? undefined : vatYearCoverage(input.companyVat, input.year);

  const docs: DocView[] = [];
  for (const doc of state.documents) {
    docs.push(buildDoc(doc));
  }

  function buildDoc(doc: PurchaseDocument): DocView {
    const data = doc.data;
    const flags = flagsByDoc.get(doc.id) ?? new Map<string, DocFlag>();
    const kind = kindOfTitle(doc.titleKey);
    const sign = signOf(kind);
    const excluded = flags.has("exclude");
    const counts = doc.status === "current" && !excluded;
    const supplierNit = doc.issuerNit;
    const supplier = supplierByNit.get(supplierNit);
    const history = fiscalByNit.get(supplierNit) ?? [];
    const regime = regimeAt(history, doc.issueDate, data.issuer.fiscalCodes, data.issuer.fiscalText);
    const exemption = retentionExemption(regime);
    const vatResponsible = company ? vatResponsibleAt(input.companyVat, doc.issueDate) : undefined;
    const month = doc.issueDate ? Number(doc.issueDate.slice(5, 7)) : null;

    const alerts: Alert[] = [];
    const add = (a: Omit<Alert, "id"> & { key?: string }) => alerts.push({ ...a, docId: doc.id, id: `${a.code}:${doc.id}:${a.key ?? ""}` });
    const docTarget: AlertTarget = { kind: "document", docId: doc.id };
    const label = `${data.number ?? doc.fileName}`;

    // --- Versiones duplicadas: evidencia que no afecta resultados ---
    let differences: string[] = [];
    if (doc.status === "evidence" && doc.duplicateOf !== null) {
      const original = docById.get(doc.duplicateOf);
      if (original) differences = documentDifferences(original, doc);
      add({
        code: "duplicate-evidence",
        severity: differences.length ? "review" : "info",
        dests: [],
        title: `Factura ${label} duplicada`,
        why: differences.length
          ? `Ya existe una versión vigente con el mismo emisor y número, pero difiere: ${differences.join("; ")}. La nueva queda como evidencia y no afecta resultados.`
          : "Ya existe una versión vigente idéntica (mismo emisor, número, fecha y total). Queda como evidencia y no afecta resultados.",
        how: differences.length ? "Revisa las diferencias; si la nueva versión es la correcta, autoriza explícitamente sustituir la vigente." : "No requiere acción.",
        target: docTarget,
        action: "Ver versiones",
      });
    }
    if (doc.status !== "current") return emptyView();
    if (excluded) {
      add({ code: "excluded", severity: "info", dests: [], title: `Factura ${label} excluida`, why: "La factura se excluyó a mano: no suma en ningún destino.", how: "Restáurala desde su detalle si fue un error.", target: docTarget });
      return emptyView();
    }

    // --- Datos mínimos de la factura ---
    const block = (code: string, title: string, why: string, how: string, dests: Dest[] = [...DESTS], target: AlertTarget = docTarget, action?: string, key?: string) =>
      add({ code, severity: "block", dests, title, why, how, target, action, key });
    if (!kind) {
      block(
        "title-unknown",
        `Encabezado «${data.title}» sin clasificar`,
        "No se sabe si el documento es una compra (suma) o una devolución (resta), así que no puede entrar a ningún destino.",
        "Clasifica el encabezado como Compra o Devolución; la homologación queda guardada para las próximas cargas.",
        [...DESTS],
        { kind: "title", titleKey: doc.titleKey, title: data.title },
        "Clasificar encabezado",
      );
    }
    if (!doc.issueDate) block("no-date", `Factura ${label} sin fecha de expedición`, "El año y el mes salen de la fecha de expedición; sin ella no se puede ubicar en ningún período.", "Abre la factura y verifica que el PDF traiga la «Fecha de Emisión».");
    if (!doc.buyerNit) block("no-buyer", `Factura ${label} sin NIT del adquiriente`, "La empresa de cada factura se identifica por el NIT del adquiriente.", "Verifica que el PDF traiga «Datos del Adquiriente / Comprador».");
    else if (!company) {
      block("unknown-company", `El NIT ${doc.buyerNit} no es de una empresa registrada`, `Las facturas se guardan, pero no pueden enviarse a Estados Financieros ni a Exógena hasta que exista la empresa ${doc.buyerName || doc.buyerNit}.`, "Crea la empresa en Empresas con ese NIT.", [...DESTS], { kind: "company", nit: doc.buyerNit }, "Ir a Empresas");
    }
    // Nombre del adquiriente frente a la empresa del NIT (o, sin empresa, frente a las demás facturas).
    if (doc.buyerNit && doc.buyerName && referenceName && !namesMatch(doc.buyerName, referenceName) && !flags.has("name_confirm")) {
      block(
        "name-mismatch",
        `Factura ${label}: el nombre del adquiriente no coincide`,
        `El NIT ${doc.buyerNit} es de «${referenceName}» pero la factura dice «${doc.buyerName}». Mientras no se confirme, la factura no entra a EEFF ni a Exógena.`,
        "Confirma que la factura es de esta empresa (queda registrado) o exclúyela.",
        [...DESTS],
        docTarget,
        "Confirmar o excluir",
      );
    }

    // --- Líneas ---
    const unread = data.lines.filter((l) => l.issue || l.baseCents === undefined);
    if (data.lines.length === 0) block("no-lines", `Factura ${label} sin productos`, "No se encontraron filas en «Detalles de Productos».", "Verifica el PDF; sin líneas no hay nada que clasificar.");
    if (unread.length)
      block(
        "lines-unread",
        `Factura ${label}: ${unread.length} ${unread.length === 1 ? "línea no se pudo leer" : "líneas no se pudieron leer"}`,
        "Sin el importe de cada línea los totales no son confiables y la factura no puede entrar a ningún destino.",
        "Abre la factura y revisa la lectura de esas filas (el PDF no se modifica).",
        [...DESTS],
        { kind: "line", docId: doc.id, lineIndex: unread[0].index },
        "Ver líneas",
      );
    const baseSum = data.lines.reduce((s, l) => s + (l.baseCents ?? 0), 0);
    const vatSum = data.lines.reduce((s, l) => s + (l.vatCents ?? 0), 0);
    // Líneas «No aplica» (7305): no cuentan para el IVA, el régimen ni el tercero de los formatos.
    const isNaLine = (index: number) => {
      const c = classByLine.get(`${doc.id}:${index}`);
      return Boolean(c && isNotApplicablePuc(c.pucCode));
    };
    const activeLines = data.lines.filter((l) => !isNaLine(l.index));
    const activeVatSum = activeLines.reduce((s, l) => s + (l.vatCents ?? 0), 0);
    const hasActive = activeLines.length > 0 || data.lines.length === 0;
    if (!unread.length && data.subtotalCents !== undefined && Math.abs(baseSum - data.subtotalCents) > 100) {
      add({
        code: "base-mismatch",
        severity: "review",
        dests: [...DESTS],
        title: `Factura ${label}: las líneas no suman el subtotal`,
        why: `Las líneas suman ${formatMoneyCents(baseSum)} y el subtotal del documento es ${formatMoneyCents(data.subtotalCents)}.`,
        how: "Revisa la lectura de las líneas contra el PDF antes de confiar en los totales.",
        target: docTarget,
      });
    }
    if (!unread.length && data.vatCents !== undefined && Math.abs(vatSum - data.vatCents) > 100) {
      add({
        code: "vat-mismatch",
        severity: "review",
        dests: ["1001", "1005", "1006"],
        title: `Factura ${label}: el IVA de las líneas no suma el IVA del documento`,
        why: `Las líneas suman ${formatMoneyCents(vatSum)} de IVA y el documento informa ${formatMoneyCents(data.vatCents)}.`,
        how: "Revisa la lectura de las columnas IVA y % contra el PDF.",
        target: docTarget,
      });
    }

    // --- IVA de la empresa en la fecha de la factura ---
    if (company && doc.issueDate && activeVatSum > 0 && vatResponsible === undefined) {
      block(
        "vat-profile-unknown",
        `Factura ${label}: falta el perfil de IVA de la empresa`,
        `No hay una responsabilidad de IVA (48) vigente el ${doc.issueDate}. Sin ella no se sabe si el IVA es descontable (1005/1006) o mayor valor del costo (EEFF y 1001).`,
        "Registra la responsabilidad frente al IVA con su fecha efectiva en Empresas → Fiscal.",
        ["EEFF", "1001", ivaDest(kind)],
        { kind: "company", nit: doc.buyerNit },
        "Ir a Empresas",
      );
    }

    // --- Proveedor: régimen y datos del tercero ---
    if (regime.from === "unknown" && hasActive) {
      add({
        code: "regime-unknown",
        severity: "pending",
        dests: ["1001"],
        title: `Proveedor ${data.issuer.name || supplierNit}: régimen fiscal sin identificar`,
        why: "La factura no trae el régimen del emisor y no hay uno guardado: no se sabe si es autorretenedor o del régimen simple (O-15 / O-47), que no generan retención automática.",
        how: "Captura el régimen del proveedor (con su fecha efectiva) en su ficha.",
        target: { kind: "supplier", nit: supplierNit, name: data.issuer.name },
        action: "Capturar régimen",
        key: "regime",
      });
    } else if (regimeChanged(history, doc.issueDate, data.issuer.fiscalText, data.issuer.fiscalCodes)) {
      add({
        code: "regime-changed",
        severity: "review",
        dests: [],
        title: `Proveedor ${data.issuer.name || supplierNit}: la factura trae otro régimen`,
        why: `El historial dice «${regime.text}» y la factura ${label} dice «${data.issuer.fiscalCodes.join(";")}».`,
        how: "Si el cambio es real, regístralo con su fecha efectiva; las facturas anteriores conservan el régimen que tenían.",
        target: { kind: "supplier", nit: supplierNit, name: data.issuer.name },
        action: "Revisar régimen",
        key: "regime",
      });
    }

    // --- Líneas clasificadas ---
    const proposalContext = { rulesByKey: rulesByKey(supplierNit), pucConcepts: input.pucConcepts, supplierRules: input.rules.filter((r) => r.supplierNit === supplierNit), supplier };
    const year = doc.issueDate ? Number(doc.issueDate.slice(0, 4)) : null;
    const conceptsOfYear = input.concepts1001.filter((c) => year === null || c.year === year);

    const lines: LineView[] = data.lines.map((line) => {
      const cls = classByLine.get(`${doc.id}:${line.index}`);
      const proposal = proposeLine(line, proposalContext);
      const rawBase = (line.baseCents ?? 0) * sign;
      const rawVat = (line.vatCents ?? 0) * sign;
      const clean = cls ? normalizeClassification(cls) : undefined;
      const na = Boolean(clean && isNotApplicablePuc(clean.pucCode));
      // Una línea 7305 no aporta importes a ningún resultado: queda solo el informativo.
      const base = na ? 0 : rawBase;
      const vat = na ? 0 : rawVat;
      const view: LineView = {
        docId: doc.id,
        line,
        sign,
        class: cls,
        proposal,
        pucCode: clean?.pucCode ?? "",
        concept1001: clean?.concept1001 ?? "",
        retention: clean?.retention ?? [],
        confirmed: Boolean(cls),
        notApplicable: na,
        excludedBaseCents: na ? rawBase : 0,
        excludedVatCents: na ? rawVat : 0,
        baseCents: base,
        vatCents: vat,
        eeffCents: base + (vatResponsible === false ? vat : 0),
        practicedCents: 0,
        assumedCents: 0,
        commonRetentionRateIds: [],
      };
      if (cls && !na) {
        view.pucProblem = cls.pucCode ? pucProblem(input.pucIndex, cls.pucCode) : "Falta el código PUC.";
        view.conceptProblem = cls.concept1001 ? conceptProblem(conceptsOfYear, cls.concept1001, doc.issueDate) : "Falta el concepto 1001.";
      }
      return view;
    });

    // Retención: se reparte por línea con los conceptos confirmados.
    const informedCents = data.retefuenteCents ?? 0;
    // Tarifa, base mínima y porcentaje vigentes en la fecha de ESTA factura (una vigencia posterior no la recalcula).
    const ratesOfDoc = ratesAt(input.rates, input.rateVersions ?? [], doc.issueDate);
    const retention = computeRetention({
      // Las líneas «No aplica» no participan: ni base, ni conceptos, ni parte de la retención informada.
      lines: lines.filter((l) => !l.notApplicable).map((l) => ({ index: l.line.index, baseCents: l.line.baseCents ?? 0, picks: l.retention })),
      informedCents: lines.some((l) => !l.notApplicable) ? informedCents : 0,
      exempt: Boolean(exemption),
      exemptDecision: (flags.get("retention_decision")?.value as "keep" | "remove" | undefined) ?? undefined,
      issueYear: year,
      rates: ratesOfDoc,
      uvts: input.uvts,
    });
    for (const l of lines) {
      l.practicedCents = (retention.practicedByLine.get(l.line.index) ?? 0) * sign;
      l.assumedCents = (retention.assumedByLine.get(l.line.index) ?? 0) * sign;
      l.commonRetentionRateIds = l.notApplicable ? [] : retention.byRate.filter((e) => e.scope === "invoice" && l.retention.some((r) => r.rateId === e.rateId)).map((e) => e.rateId);
    }

    // Alertas por línea: «Por confirmar» o faltantes por destino.
    const unconfirmed = lines.filter((l) => !l.confirmed && !l.line.issue);
    for (const l of unconfirmed) {
      const p = l.proposal;
      const hasProposal = Boolean(p.pucCode || p.concept1001);
      add({
        code: "line-unconfirmed",
        variant: hasProposal ? "proposal" : "no-proposal",
        severity: "pending",
        dests: ["EEFF", "1001"],
        title: `${label} · ${lineLabel(l.line)}`,
        why: hasProposal ? "Hay una propuesta de PUC y concepto 1001, pero toda propuesta requiere confirmación antes de usarse." : "La línea no tiene PUC ni concepto 1001 y no hay propuesta para sugerir.",
        how: hasProposal ? "Abre la línea y confirma o corrige la propuesta." : "Abre la línea y elige el PUC y el concepto 1001.",
        target: { kind: "line", docId: doc.id, lineIndex: l.line.index },
        action: "Confirmar",
        key: String(l.line.index),
      });
    }
    for (const l of lines.filter((x) => x.confirmed && !x.notApplicable)) {
      const target: AlertTarget = { kind: "line", docId: doc.id, lineIndex: l.line.index };
      if (l.pucProblem) add({ code: "puc-invalid", severity: "block", dests: ["EEFF"], title: `${label} · ${lineLabel(l.line)}: PUC no válido`, why: l.pucProblem, how: "Elige un código PUC de activo, costo o gasto vigente en la Tabla de Códigos PUC.", target, action: "Corregir PUC", key: String(l.line.index) });
      if (l.conceptProblem) add({ code: "concept-invalid", severity: "block", dests: ["1001"], title: `${label} · ${lineLabel(l.line)}: concepto 1001`, why: l.conceptProblem, how: "Elige un concepto vigente del catálogo 1001 del año (Datos → Catálogos Exógena).", target, action: "Corregir concepto", key: String(l.line.index) });
    }

    // Retenciones.
    const target: AlertTarget = { kind: "document", docId: doc.id };
    if (retention.missingUvtYear && lines.some((l) => l.retention.length)) {
      block("uvt-missing", `Factura ${label}: falta el UVT de ${retention.missingUvtYear}`, "La cuantía mínima de la retención se evalúa con el UVT del año de la factura.", "Registra el valor del UVT en Datos → Tabla de retenciones.", ["1001"], target, undefined, "uvt");
    }
    if (retention.missingRates.length) {
      block("retention-concept-missing", `Factura ${label}: un concepto de retención ya no existe`, "Una línea usa un concepto que se eliminó de la Tabla de retenciones.", "Elige otro concepto de retención en la línea.", ["1001"], target, undefined, "rate");
    }
    if (exemption && informedCents > 0 && !flags.has("retention_decision")) {
      add({
        code: "retention-exempt",
        severity: "review",
        dests: ["1001"],
        title: `Factura ${label}: retención informada de un proveedor ${exemption.code}`,
        why: `El proveedor es ${exemption.label} (${exemption.code}) y no genera retención automática, pero la factura informa ${formatMoneyCents(informedCents)}. Por ahora se conserva el valor documentado.`,
        how: "Decide si la retención informada se conserva o se elimina.",
        target,
        action: "Decidir",
        key: "exempt",
      });
    }
    if (retention.mismatch) {
      const near = ratesNear(ratesOfDoc, retention.suggestedRateBp);
      add({
        code: "retention-mismatch",
        severity: "review",
        dests: ["1001"],
        title: `Factura ${label}: la retención informada difiere del cálculo`,
        why: `La factura informa ${formatMoneyCents(retention.practicedCents)} y la Tabla de retenciones da ${formatMoneyCents(retention.expectedCents)}. Se conserva el valor documentado (practicada); no se suma ninguna asumida adicional.${retention.suggestedRateBp !== undefined ? ` La tarifa implícita es ${(retention.suggestedRateBp / 100).toFixed(2).replace(".", ",")} %${near.length ? ` (${near.map((r) => r.name).join(", ")})` : ""}.` : ""}`,
        how: "Si el concepto de retención de la línea es otro, elígelo o créalo desde la línea.",
        target,
        action: "Revisar retención",
        key: "mismatch",
      });
    }

    // Datos del tercero.
    const third = resolveThird(supplierNit, data.issuer, supplier, input.catalogs, aliases);
    if (third.missing.length && hasActive) {
      const dests: Dest[] = ["1001"];
      if (vatResponsible !== false && (activeVatSum > 0 || vatResponsible === undefined)) dests.push(ivaDest(kind));
      add({
        code: "third-incomplete",
        severity: "block",
        dests,
        title: `Proveedor ${data.issuer.name || supplierNit}: datos del tercero incompletos`,
        why: `Faltan: ${third.missing.join("; ")}. Los formatos exógenos exigen identificación, nombres o razón social, dirección y ubicación; no se inventan.${third.unknownDocType ? ` La factura dice «${third.unknownDocType}» como tipo de documento y no coincide con ningún tipo ni alias: agrégalo en Catálogos Exógena → Alias.` : ""}`,
        how: "Completa los datos del proveedor desde Compras (se guardan en Proveedores).",
        target: { kind: "supplier", nit: supplierNit, name: data.issuer.name },
        action: "Completar proveedor",
        key: "third",
      });
    }

    return finalize(alerts, lines, retention, third);

    function finalize(list: Alert[], lv: LineView[], ret: RetentionResult, _third: ResolvedThird): DocView {
      const stopped = new Set<Dest>();
      for (const a of list) if (a.severity === "block" || a.severity === "pending") for (const d of a.dests) stopped.add(d);
      return {
        doc,
        data,
        kind,
        sign,
        counts,
        excluded,
        month,
        supplierNit,
        supplier,
        regime,
        exemption,
        vatResponsible,
        lines: lv,
        baseCents: lv.reduce((s, l) => s + l.baseCents, 0),
        vatCents: lv.reduce((s, l) => s + l.vatCents, 0),
        retention: ret,
        alerts: list,
        ready: Object.fromEntries(DESTS.map((d) => [d, !stopped.has(d)])) as Record<Dest, boolean>,
        differences,
      };
    }

    function emptyView(): DocView {
      return {
        doc,
        data,
        kind,
        sign,
        counts: false,
        excluded,
        month,
        supplierNit,
        supplier,
        regime,
        exemption,
        vatResponsible,
        lines: [],
        baseCents: 0,
        vatCents: 0,
        retention: computeRetention({ lines: [], informedCents: 0, exempt: false, issueYear: null, rates: [], uvts: [] }),
        alerts,
        ready: Object.fromEntries(DESTS.map((d) => [d, false])) as Record<Dest, boolean>,
        differences,
      };
    }
  }

  const counted = docs.filter((d) => d.counts);

  // --- Terceros ---
  const suppliers = buildSuppliers(counted, input, supplierByNit, fiscalByNit);
  const thirdByNit = new Map(suppliers.map((s) => [s.nit, s.third]));

  // --- Formatos ---
  const forms = buildForms(counted, thirdByNit, vatCoverage, input);

  // --- Alertas globales ---
  const globalAlerts: Alert[] = [];
  if (company && vatCoverage && !vatCoverage.known && input.year !== null) {
    globalAlerts.push({
      id: `vat-year-unknown:${input.year}`,
      code: "vat-year-unknown",
      severity: "block",
      dests: ["1005", "1006"],
      title: `Falta el perfil de IVA de ${company.razonSocial} para ${input.year}`,
      why: "Sin la responsabilidad de IVA (48) con su fecha efectiva no se sabe si 1005 y 1006 aplican o son «No aplica».",
      how: "Registra la responsabilidad frente al IVA en Empresas → Fiscal (puede leerse del RUT).",
      target: { kind: "company", nit: input.buyerNit },
      action: "Ir a Empresas",
    });
  }
  const notApplicable: Partial<Record<Dest, string>> = {};
  if (vatCoverage?.neverResponsible && input.year !== null) {
    const reason = `La empresa no era responsable de IVA (responsabilidad 48) durante ${input.year}: 1005 y 1006 no aplican.`;
    notApplicable["1005"] = reason;
    notApplicable["1006"] = reason;
  }
  const rec = forms.reconciliation;
  if (rec.applicable && rec.differenceCents !== 0) {
    globalAlerts.push({
      id: "iva-reconciliation",
      code: "iva-reconciliation",
      severity: "block",
      dests: ["1001", "1005", "1006"],
      title: "IVA descontable 1005 − IVA recuperado 1006 ≠ IVA deducible 1001",
      why: `1005 ${formatMoneyCents(rec.discountableCents)} − 1006 ${formatMoneyCents(rec.recoveredCents)} = ${formatMoneyCents(rec.netVatCents)}, pero el IVA deducible del 1001 es ${formatMoneyCents(rec.vat1001Cents)} (diferencia ${formatMoneyCents(rec.differenceCents)}).${rec.uneven.length ? ` Facturas listas para unos destinos y no para otros: ${rec.uneven.slice(0, 6).join(", ")}${rec.uneven.length > 6 ? "…" : ""}.` : ""}`,
      how: "Resuelve los pendientes de esas facturas para que los tres formatos salgan del mismo conjunto de facturas.",
      target: { kind: "none" },
    });
  }
  forms.alerts.forEach((a) => globalAlerts.push(a));

  const alerts = sortAlerts([...docs.flatMap((d) => d.alerts), ...globalAlerts]);
  const counts = countByDest(alerts);
  const status = Object.fromEntries(DESTS.map((d) => [d, destStatus(counts[d], d in notApplicable)])) as Record<Dest, DestStatus>;

  const eeff = buildEeffPlan(counted);
  const coverage = buildCoverage(docs);

  const lines = counted.flatMap((d) => d.lines);
  const sum = (kind: TitleKind, pick: (d: DocView) => number) => counted.filter((d) => d.kind === kind).reduce((s, d) => s + pick(d), 0);
  const totals = {
    purchaseCents: sum("purchase", (d) => d.baseCents),
    returnCents: -sum("return", (d) => d.baseCents),
    purchaseVatCents: sum("purchase", (d) => d.vatCents),
    returnVatCents: -sum("return", (d) => d.vatCents),
    documents: counted.length,
    lines: lines.length,
    pendingLines: lines.filter((l) => !l.confirmed).length,
  };

  return { buyerNit: input.buyerNit, year: input.year, company, docs, alerts, counts, status, notApplicable, coverage, suppliers, proposals: forms.proposals, reconciliation: rec, eeff, totals };
}

// ---------------------------------------------------------------------------
// Terceros
// ---------------------------------------------------------------------------

function buildSuppliers(counted: DocView[], input: PurchasesInput, supplierByNit: Map<string, Supplier>, fiscalByNit: Map<string, SupplierFiscalEntry[]>): SupplierView[] {
  const byNit = new Map<string, DocView[]>();
  for (const d of counted) byNit.set(d.supplierNit, [...(byNit.get(d.supplierNit) ?? []), d]);
  const out: SupplierView[] = [];
  for (const [nit, list] of byNit) {
    // La factura más reciente es la que mejor describe al emisor hoy.
    const latest = [...list].sort((a, b) => (b.doc.issueDate ?? "").localeCompare(a.doc.issueDate ?? ""))[0];
    const supplier = supplierByNit.get(nit);
    out.push({
      nit,
      name: supplier?.businessName || latest.data.issuer.name || nit,
      supplier,
      documents: list.length,
      third: resolveThird(nit, latest.data.issuer, supplier, input.catalogs, input.aliases ?? []),
      regimeText: latest.regime.text,
      regimeFrom: latest.regime.from,
      history: fiscalByNit.get(nit) ?? [],
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

// ---------------------------------------------------------------------------
// Formatos 1001, 1005 y 1006
// ---------------------------------------------------------------------------

interface Built {
  proposals: PurchasesModel["proposals"];
  reconciliation: Reconciliation;
  alerts: Alert[];
}

function buildForms(counted: DocView[], thirds: Map<string, ResolvedThird>, vatCoverage: ReturnType<typeof vatYearCoverage> | undefined, input: PurchasesInput): Built {
  const alerts: Alert[] = [];
  interface G1001 {
    nit: string;
    concept: string;
    deductible: number;
    ivaDeductible: number;
    ivaNonDeductible: number;
    practiced: number;
    assumed: number;
    docs: Set<string>;
    lines: number;
  }
  const g1001 = new Map<string, G1001>();
  const g1005 = new Map<string, { nit: string; cents: number; docs: Set<string> }>();
  const g1006 = new Map<string, { nit: string; cents: number; docs: Set<string> }>();

  for (const d of counted) {
    const docLabel = d.data.number ?? d.doc.fileName;
    const in1001 = d.ready["1001"];
    for (const l of d.lines) {
      if (in1001 && !l.notApplicable) {
        const key = `${d.supplierNit}|${l.concept1001}`;
        const g = g1001.get(key) ?? { nit: d.supplierNit, concept: l.concept1001, deductible: 0, ivaDeductible: 0, ivaNonDeductible: 0, practiced: 0, assumed: 0, docs: new Set<string>(), lines: 0 };
        g.deductible += l.baseCents;
        if (d.vatResponsible === true) g.ivaDeductible += l.vatCents;
        else if (d.vatResponsible === false) g.ivaNonDeductible += l.vatCents;
        g.practiced += l.practicedCents;
        g.assumed += l.assumedCents;
        g.docs.add(docLabel);
        g.lines += 1;
        g1001.set(key, g);
      }
    }
    // 1005 (compras) y 1006 (devoluciones): solo con la empresa responsable de IVA en la fecha de la factura.
    if (d.vatResponsible === true && d.kind && d.ready[ivaDest(d.kind)] && d.vatCents !== 0) {
      const map = d.kind === "return" ? g1006 : g1005;
      const g = map.get(d.supplierNit) ?? { nit: d.supplierNit, cents: 0, docs: new Set<string>() };
      g.cents += d.kind === "return" ? -d.vatCents : d.vatCents;
      g.docs.add(docLabel);
      map.set(d.supplierNit, g);
    }
  }

  const thirdOf = (nit: string) => thirds.get(nit)!;
  const origin = (docs: Set<string>, lines?: number) => `Compras · ${docs.size} ${docs.size === 1 ? "factura" : "facturas"}${lines ? ` · ${lines} ${lines === 1 ? "línea" : "líneas"}` : ""}`;

  const proposals1001: SyncProposal[] = [];
  for (const g of [...g1001.values()].sort((a, b) => (a.nit + a.concept).localeCompare(b.nit + b.concept))) {
    if (g.deductible === 0 && g.ivaDeductible === 0 && g.ivaNonDeductible === 0 && g.practiced === 0 && g.assumed === 0) continue;
    const t = thirdOf(g.nit);
    proposals1001.push({
      sourceKey: `third:${g.nit}|${g.concept}`,
      origin: "estados_financieros",
      originRef: origin(g.docs, g.lines),
      data: {
        concept: g.concept,
        ...thirdColumns(t.fields),
        thirdName: t.fields.thirdName,
        supplierId: t.fields.supplierId,
        deductible: centsToPesos(g.deductible),
        nonDeductible: 0,
        ivaDeductible: centsToPesos(g.ivaDeductible),
        ivaNonDeductible: centsToPesos(g.ivaNonDeductible),
        retPracticed: centsToPesos(g.practiced),
        retAssumed: centsToPesos(g.assumed),
        retIvaResponsible: 0,
        retIvaNonResident: 0,
        exactCents: { deductible: g.deductible, ivaDeductible: g.ivaDeductible, ivaNonDeductible: g.ivaNonDeductible, retPracticed: g.practiced, retAssumed: g.assumed },
      },
    });
    if (g.deductible < 0 || g.ivaDeductible < 0 || g.ivaNonDeductible < 0 || g.practiced < 0 || g.assumed < 0) {
      alerts.push({
        id: `negative-1001:${g.nit}|${g.concept}`,
        code: "negative-1001",
        severity: "review",
        dests: ["1001"],
        title: `1001 · ${t.fields.thirdName} · concepto ${g.concept}: valor negativo`,
        why: "Las devoluciones superan las compras de este tercero y concepto: el formato no admite valores negativos.",
        how: "Revisa las devoluciones y el concepto 1001 de sus líneas.",
        target: { kind: "supplier", nit: g.nit, name: t.fields.thirdName },
      });
    }
  }

  const simple = (map: Map<string, { nit: string; cents: number; docs: Set<string> }>, valueKey: string, zeroKeys: Record<string, number>): SyncProposal[] =>
    [...map.values()]
      .filter((g) => g.cents !== 0)
      .sort((a, b) => a.nit.localeCompare(b.nit))
      .map((g) => {
        const t = thirdOf(g.nit);
        return {
          sourceKey: `third:${g.nit}`,
          origin: "estados_financieros" as const,
          originRef: origin(g.docs),
          data: { ...thirdColumns(t.fields), thirdName: t.fields.thirdName, supplierId: t.fields.supplierId, [valueKey]: centsToPesos(g.cents), ...zeroKeys, exactCents: { [valueKey]: g.cents } },
        };
      });
  const proposals1005 = simple(g1005, "discountable", { salesReturns: 0, costIva: 0 });
  const proposals1006 = simple(g1006, "purchaseReturns", { generated: 0, consumption: 0 });

  // Conciliación: IVA descontable 1005 − IVA recuperado 1006 = IVA deducible 1001 (en centavos exactos).
  const discountable = [...g1005.values()].reduce((s, g) => s + g.cents, 0);
  const recovered = [...g1006.values()].reduce((s, g) => s + g.cents, 0);
  const vat1001 = [...g1001.values()].reduce((s, g) => s + g.ivaDeductible, 0);
  const applicable = Boolean(vatCoverage?.anyResponsible) && (discountable !== 0 || recovered !== 0 || vat1001 !== 0);
  const uneven = counted
    .filter((d) => d.vatResponsible === true && d.vatCents !== 0 && d.kind && d.ready["1001"] !== d.ready[ivaDest(d.kind)])
    .map((d) => d.data.number ?? d.doc.fileName);
  const reconciliation: Reconciliation = {
    applicable,
    netVatCents: discountable - recovered,
    vat1001Cents: vat1001,
    differenceCents: discountable - recovered - vat1001,
    discountableCents: discountable,
    recoveredCents: recovered,
    uneven,
  };
  void input;
  return { proposals: { "1001": proposals1001, "1005": proposals1005, "1006": proposals1006 }, reconciliation, alerts };
}

// ---------------------------------------------------------------------------
// Estados Financieros
// ---------------------------------------------------------------------------

/**
 * Movimientos para Estados Financieros: uno por línea, solo de facturas listas para EEFF (con PUC confirmado y válido). Las
 * facturas que aún no pueden enviarse quedan fuera y se informan por mes, para que el Generador solo se bloquee en los meses
 * afectados. No se crean saldos por pagar ni retenciones: solo costo, gasto o activo.
 */
function buildEeffPlan(counted: DocView[]): EeffPlan {
  const movements: MovementInput[] = [];
  const pendingMonths = new Set<string>();
  let readyDocs = 0;
  let pendingDocs = 0;
  let total = 0;
  const dates: string[] = [];
  for (const d of counted) {
    if (!d.ready.EEFF) {
      pendingDocs += 1;
      pendingMonths.add(d.doc.issueDate ? d.doc.issueDate.slice(0, 7) : "sin-fecha");
      continue;
    }
    readyDocs += 1;
    const documentId = d.doc.cufe ?? `${d.doc.issuerNit}|${d.doc.numberKey || d.doc.fileName}`;
    for (const l of d.lines) {
      if (l.notApplicable || l.eeffCents === 0) continue;
      dates.push(d.doc.issueDate!);
      total += l.eeffCents;
      movements.push({
        accountingDate: d.doc.issueDate!,
        documentId,
        documentNumber: d.data.number ?? "",
        documentType: d.kind === "return" ? "Devolución de compra" : "Compra",
        supplierId: d.supplier?.id ?? null,
        supplierNit: d.doc.issuerNit,
        supplierName: d.doc.issuerName,
        conceptKey: d.kind === "return" ? "purchases.return" : "purchases.line",
        pucCode: l.pucCode,
        amountCents: l.eeffCents,
        description: lineLabel(l.line),
        detail: {
          document: d.doc.id,
          file: d.doc.fileName,
          page: l.line.page,
          line: l.line.index + 1,
          concept1001: l.concept1001,
          retention: l.retention.map((r) => r.rateId),
          rule: l.class?.ruleId ?? null,
          scope: l.class?.scope ?? null,
          vat: l.vatCents,
          vatIncluded: d.vatResponsible === false,
        },
      });
    }
  }
  dates.sort();
  return { movements, readyDocs, pendingDocs, pendingMonths: [...pendingMonths].sort(), totalCents: total, firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null };
}

// ---------------------------------------------------------------------------
// Cobertura mensual
// ---------------------------------------------------------------------------

function buildCoverage(docs: DocView[]): MonthCoverage[] {
  const months = new Map<number, MonthCoverage>();
  const at = (m: number) => {
    const c = months.get(m) ?? { month: m, purchases: 0, returns: 0, purchaseCents: 0, returnCents: 0, duplicates: 0, pending: 0, blocked: 0, excluded: 0, notApplicableLines: 0, notApplicableCents: 0 };
    months.set(m, c);
    return c;
  };
  for (let m = 1; m <= 12; m++) at(m);
  for (const d of docs) {
    const c = at(d.month ?? 0);
    if (d.doc.status === "evidence") {
      c.duplicates += 1;
      continue;
    }
    if (d.doc.status !== "current") continue;
    if (d.excluded) {
      c.excluded += 1;
      continue;
    }
    if (d.kind === "return") {
      c.returns += 1;
      c.returnCents += d.lines.reduce((s, l) => s + Math.abs(l.baseCents), 0);
    } else {
      c.purchases += 1;
      c.purchaseCents += d.lines.reduce((s, l) => s + l.baseCents, 0);
    }
    for (const l of d.lines) {
      if (!l.notApplicable) continue;
      c.notApplicableLines += 1;
      c.notApplicableCents += Math.abs(l.excludedBaseCents);
    }
    if (d.alerts.some((a) => a.severity === "pending")) c.pending += 1;
    if (d.alerts.some((a) => a.severity === "block")) c.blocked += 1;
  }
  return [...months.values()].filter((c) => c.month !== 0 || c.purchases + c.returns + c.duplicates + c.excluded > 0).sort((a, b) => a.month - b.month);
}

/** Agrupa alertas repetidas por tipo (para no listar mil líneas por confirmar una a una). */
/** Clave de agrupación: severidad + tipo (+ subtipo cuando la misma causa se resuelve distinto) + destinos. */
export const groupKey = (a: Alert) => `${a.severity}|${a.code}${a.variant ? `:${a.variant}` : ""}|${a.dests.join(",")}`;

export function groupAlerts(alerts: readonly Alert[]): { code: string; severity: Severity; dests: Dest[]; title: string; items: Alert[] }[] {
  const groups = new Map<string, { code: string; severity: Severity; dests: Dest[]; title: string; items: Alert[] }>();
  for (const a of alerts) {
    const key = groupKey(a);
    const g = groups.get(key) ?? { code: a.code, severity: a.severity, dests: a.dests, title: a.title, items: [] };
    g.items.push(a);
    groups.set(key, g);
  }
  return [...groups.values()];
}

export { emptyCounts, findCompanyByNit };
