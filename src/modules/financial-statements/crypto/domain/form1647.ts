import { centsToPesos } from "../../../exogena/domain/numbers";
import { compareText, countryByDocument, thirdKey } from "./documents";
import type { Operation } from "./operations";
import { partyName, partyOf, PENDING, type PartyFields } from "./parties";
import { resolveCity, type CityOption, type PlaceLookup } from "./places";
import type { CryptoProblem } from "./problems";

/**
 * Formato 1647 — Ingresos recibidos para terceros. Concepto siempre 4070. Se arma con las Compras aceptadas del año,
 * agrupadas por tercero (tipo DIAN + identificación): ese tercero es para quien se recibió el ingreso. «Quien recibió el
 * ingreso» sale de Ventas con una asignación reproducible y revisable que nunca parte el valor de un tercero entre dos
 * pagadores.
 */
export const CONCEPT_1647 = "4070";

export interface Data1647 {
  concept: string;
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
  /** Pesos enteros. */
  totalValue: number;
  reintegratedValue: number;
  withholdingValue: number;
  recipientCountryCode: string;
  recipientDocTypeCode: string;
  recipientDocNumber: string;
  recipientDv: string;
  recipientFirstSurname: string;
  recipientSecondSurname: string;
  recipientFirstName: string;
  recipientOtherNames: string;
  recipientBusinessName: string;
  [key: string]: unknown;
}

export type CityState = "resolved" | "unknown" | "ambiguous" | "empty" | "multiple";

export interface ThirdCity {
  state: CityState;
  option?: CityOption;
  via?: "code" | "name" | "alias" | "decision";
  /** Textos de ciudad distintos que traen sus compras, con cuántas compras cada uno. */
  raws: { raw: string; count: number }[];
  /** Municipios entre los que el usuario puede elegir (ambiguo: los que coinciden; varias ciudades: las reconocidas). */
  candidates: CityOption[];
}

export interface ThirdSummary {
  key: string;
  docCode: string;
  number: string;
  label: string;
  totalCents: number;
  firstDate: string;
  firstOrder: string;
  operations: Operation[];
  city: ThirdCity;
  payerKey: string | null;
  assignedBy: "auto" | "manual" | null;
}

export interface PayerSummary {
  key: string;
  docCode: string;
  number: string;
  label: string;
  totalCents: number;
  remainingCents: number;
  operations: Operation[];
  assigned: string[];
}

export interface Record1647 {
  sourceKey: string;
  originRef: string;
  data: Data1647;
  third: ThirdSummary;
}

export interface Form1647 {
  records: Record1647[];
  thirds: ThirdSummary[];
  payers: PayerSummary[];
  problems: CryptoProblem[];
  /** Compras aceptadas del año (centavos). */
  originCents: number;
  /** Compras agrupadas en algún tercero. */
  groupedCents: number;
  /** Valor ya asignado a un pagador de Ventas. */
  assignedCents: number;
  /** Valor de terceros sin pagador asignado. */
  unassignedCents: number;
  /** Compras que no se pudieron agrupar (tipo de documento sin clasificar o sin identificación). */
  unproposedCents: number;
  /** Saldos de Ventas sin asignar a ningún tercero. */
  unusedSalesCents: number;
  salesCents: number;
}

export interface Form1647Input {
  purchases: readonly Operation[];
  sales: readonly Operation[];
  places: PlaceLookup;
  companyAddress: string;
  /** Reasignaciones manuales: tercero → pagador. */
  assignments: ReadonlyMap<string, string>;
  /** Ciudad elegida por el usuario: tercero → código DANE de 5 dígitos. */
  cityDecisions: ReadonlyMap<string, string>;
  /** País confirmado por el usuario para quien recibió el ingreso: pagador → código de país. */
  countryDecisions: ReadonlyMap<string, string>;
}

export const sourceKey1647 = (docCode: string, number: string) => `terceros:${thirdKey(docCode, number)}`;

const byOrigin = (a: Operation, b: Operation) => a.uploadId - b.uploadId || a.rowNumber - b.rowNumber;
const byChronology = (a: Operation, b: Operation) => (a.date ?? "").localeCompare(b.date ?? "") || a.order.localeCompare(b.order, "es", { numeric: true }) || byOrigin(a, b);
const money = (cents: number) => (cents / 100).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function groupBy(ops: readonly Operation[]): Map<string, Operation[]> {
  const out = new Map<string, Operation[]>();
  for (const o of ops) {
    const key = thirdKey(o.docCode!, o.docNumber);
    out.set(key, [...(out.get(key) ?? []), o]);
  }
  return out;
}

/** Operaciones que no se pueden agrupar por tercero, con el pendiente que lo explica. */
function ungroupable(label: "Compras" | "Ventas", ops: readonly Operation[], problems: CryptoProblem[]): { usable: Operation[]; lostCents: number } {
  const usable: Operation[] = [];
  const unknown = new Map<string, Operation[]>();
  let lost = 0;
  for (const o of ops) {
    if (o.docCode === null) {
      unknown.set(o.docTypeKey, [...(unknown.get(o.docTypeKey) ?? []), o]);
      lost += o.amountCents ?? 0;
    } else if (!o.docNumber) {
      problems.push({ level: "blocking", kind: "identification", message: `${label}, ${o.fileName}, fila ${o.rowNumber}: falta el número de identificación; la fila no se puede proponer al 1647.` });
      lost += o.amountCents ?? 0;
    } else usable.push(o);
  }
  for (const [key, list] of unknown)
    problems.push({
      level: "blocking",
      kind: "document_type",
      message: key ? `${label}: el tipo de documento «${list[0].docTypeRaw}» (${list.length} ${list.length === 1 ? "fila" : "filas"}) no está clasificado: elige su código DIAN una vez.` : `${label}: ${list.length} ${list.length === 1 ? "fila no tiene" : "filas no tienen"} tipo de documento.`,
      payload: { docTypeKey: key, docTypeRaw: list[0].docTypeRaw },
    });
  return { usable, lostCents: lost };
}

export function resolveThirdCity(ops: readonly Operation[], key: string, places: PlaceLookup, decisions: ReadonlyMap<string, string>): ThirdCity {
  const counts = new Map<string, number>();
  for (const o of ops) counts.set(o.cityRaw, (counts.get(o.cityRaw) ?? 0) + 1);
  const raws = [...counts.entries()].map(([raw, count]) => ({ raw, count })).sort((a, b) => b.count - a.count);
  const resolutions = raws.map((r) => ({ ...r, resolution: resolveCity(r.raw, places) }));
  const resolvedOptions = new Map<string, CityOption>();
  for (const r of resolutions) if (r.resolution.status === "resolved") resolvedOptions.set(r.resolution.option.code, r.resolution.option);

  const chosen = decisions.get(key);
  const chosenOption = chosen ? places.byCode.get(chosen) : undefined;
  if (chosenOption) return { state: "resolved", option: chosenOption, via: "decision", raws, candidates: [...resolvedOptions.values()] };

  // Identidades distintas: ciudades reconocidas por código + textos sin reconocer, ambiguos o vacíos.
  const identities = new Set(resolutions.map((r) => (r.resolution.status === "resolved" ? r.resolution.option.code : `raw:${compareText(r.raw)}`)));
  if (identities.size > 1) return { state: "multiple", raws, candidates: [...resolvedOptions.values()] };
  const only = resolutions[0]?.resolution;
  if (!only || only.status === "empty") return { state: "empty", raws, candidates: [] };
  if (only.status === "resolved") return { state: "resolved", option: only.option, via: only.via, raws, candidates: [only.option] };
  if (only.status === "ambiguous") return { state: "ambiguous", raws, candidates: only.candidates };
  return { state: "unknown", raws, candidates: [] };
}

export function buildForm1647(input: Form1647Input): Form1647 {
  const problems: CryptoProblem[] = [];
  const purchases = input.purchases.filter((o) => o.kind === "purchase" && o.status === "accepted");
  const sales = input.sales.filter((o) => o.kind === "sale" && o.status === "accepted");
  const originCents = purchases.reduce((s, o) => s + (o.amountCents ?? 0), 0);
  const salesCents = sales.reduce((s, o) => s + (o.amountCents ?? 0), 0);

  const buyers = ungroupable("Compras", purchases, problems);
  const sellers = ungroupable("Ventas", sales, problems);

  // Terceros para quienes se recibió el ingreso, en orden cronológico de su primera operación.
  const thirds: ThirdSummary[] = [...groupBy(buyers.usable).entries()]
    .map(([key, ops]) => {
      const sorted = [...ops].sort(byChronology);
      const [docCode, number] = key.split("|");
      return {
        key,
        docCode,
        number,
        label: partyName(sorted) || `${docCode} ${number}`,
        totalCents: sorted.reduce((s, o) => s + (o.amountCents ?? 0), 0),
        firstDate: sorted[0].date ?? "",
        firstOrder: sorted[0].order,
        operations: sorted,
        city: resolveThirdCity(sorted, key, input.places, input.cityDecisions),
        payerKey: null,
        assignedBy: null,
      } satisfies ThirdSummary;
    })
    .sort((a, b) => byChronology(a.operations[0], b.operations[0]));

  // Pagadores de Ventas por su primera aparición, con su saldo disponible.
  const payers: PayerSummary[] = [...groupBy(sellers.usable).entries()]
    .map(([key, ops]) => {
      const sorted = [...ops].sort(byOrigin);
      const [docCode, number] = key.split("|");
      const totalCents = sorted.reduce((s, o) => s + (o.amountCents ?? 0), 0);
      return { key, docCode, number, label: partyName(sorted) || `${docCode} ${number}`, totalCents, remainingCents: totalCents, operations: sorted, assigned: [] } satisfies PayerSummary;
    })
    .sort((a, b) => byOrigin(a.operations[0], b.operations[0]));
  const payerByKey = new Map(payers.map((p) => [p.key, p]));

  const assign = (third: ThirdSummary, payer: PayerSummary, by: "auto" | "manual") => {
    payer.remainingCents -= third.totalCents;
    payer.assigned.push(third.key);
    third.payerKey = payer.key;
    third.assignedBy = by;
  };

  // 1. Reasignaciones manuales (un pagador nunca excede su ingreso disponible).
  for (const third of thirds) {
    const chosen = input.assignments.get(third.key);
    if (!chosen) continue;
    const payer = payerByKey.get(chosen);
    if (payer && third.totalCents > 0 && payer.remainingCents >= third.totalCents) assign(third, payer, "manual");
    else
      problems.push({
        level: "warning",
        kind: "assignment_invalid",
        message: `${third.label}: la asignación manual a ${payer?.label ?? "un pagador que ya no existe"} ya no es posible (el saldo no alcanza); se vuelve a proponer.`,
        payload: { thirdKey: third.key },
      });
  }
  // 2. Propuesta automática: el primer pagador con saldo para cubrir el valor completo; nunca se divide un tercero.
  for (const third of thirds) {
    if (third.payerKey || third.totalCents <= 0) continue;
    const payer = payers.find((p) => p.remainingCents >= third.totalCents);
    if (payer) assign(third, payer, "auto");
  }

  const records: Record1647[] = [];
  const address = input.companyAddress.trim();
  if (!address) problems.push({ level: "blocking", kind: "address", message: "La empresa no tiene dirección guardada: complétala en Empresas para el receptor del 1647." });

  for (const third of thirds) {
    const recordKey = sourceKey1647(third.docCode, third.number);
    const party = partyOf(third.operations, third.docCode, third.number);
    for (const m of party.missing) problems.push({ level: "blocking", kind: "name", message: `${third.label}: falta ${m}.`, recordKey });

    // Ciudad → departamento, municipio y país 169.
    const c = third.city;
    const cityPayload = { thirdKey: third.key, label: third.label, raw: c.raws.map((r) => r.raw).join(" | ") };
    const firstRaw = c.raws[0]?.raw ?? "";
    if (c.state === "unknown") problems.push({ level: "blocking", kind: "city_unknown", message: `${third.label}: la ciudad «${firstRaw}» no se reconoce; elige el municipio y se guardará el alias.`, recordKey, field: "muniCode", payload: { ...cityPayload, raw: firstRaw } });
    else if (c.state === "ambiguous") problems.push({ level: "blocking", kind: "city_ambiguous", message: `${third.label}: la ciudad «${firstRaw}» coincide con ${c.candidates.length} municipios; elige el correcto.`, recordKey, field: "muniCode", payload: { ...cityPayload, raw: firstRaw } });
    else if (c.state === "multiple") problems.push({ level: "blocking", kind: "city_multiple", message: `${third.label}: sus compras traen varias ciudades (${c.raws.map((r) => `«${r.raw || "sin ciudad"}»`).join(", ")}); elige la ciudad del registro.`, recordKey, field: "muniCode", payload: cityPayload });
    else if (c.state === "empty") problems.push({ level: "blocking", kind: "city_empty", message: `${third.label}: sus compras no traen ciudad; elige el municipio.`, recordKey, field: "muniCode", payload: cityPayload });

    // Quien recibió el ingreso.
    const payer = third.payerKey ? payerByKey.get(third.payerKey) : undefined;
    let recipient: PartyFields | null = null;
    let recipientCountry: string = PENDING;
    if (payer) {
      const recipientParty = partyOf(payer.operations, payer.docCode, payer.number);
      recipient = recipientParty.fields;
      for (const m of recipientParty.missing) problems.push({ level: "blocking", kind: "name", message: `${payer.label} (quien recibió el ingreso): falta ${m}.`, recordKey });
      const country = countryByDocument(payer.docCode) ?? input.countryDecisions.get(payer.key);
      recipientCountry = country ?? PENDING;
      if (!country) problems.push({ level: "blocking", kind: "country", message: `${payer.label}: el tipo de documento ${payer.docCode} exige confirmar manualmente el país de quien recibió el ingreso.`, recordKey, field: "recipientCountryCode", payload: { thirdKey: payer.key, label: payer.label } });
    } else if (third.totalCents > 0) {
      problems.push({
        level: "blocking",
        kind: "assignment",
        message: `${third.label}: ningún pagador de Ventas tiene saldo para cubrir ${money(third.totalCents)} sin dividirlo; elige el pagador manualmente.`,
        recordKey,
        field: "recipientDocNumber",
        payload: { thirdKey: third.key, label: third.label },
      });
    } else {
      problems.push({ level: "blocking", kind: "assignment", message: `${third.label}: el valor agrupado (${money(third.totalCents)}) no es positivo y no se puede asignar a un pagador.`, recordKey });
    }

    const pesos = centsToPesos(third.totalCents);
    records.push({
      sourceKey: recordKey,
      originRef: `Transacciones Cripto · Compras · ${third.operations.length} ${third.operations.length === 1 ? "fila" : "filas"} · ${third.label}`,
      third,
      data: {
        concept: CONCEPT_1647,
        ...party.fields,
        address: address || PENDING,
        deptCode: c.option?.deptCode ?? PENDING,
        muniCode: c.option?.muniCode ?? PENDING,
        countryCode: c.option ? "169" : PENDING,
        totalValue: pesos,
        reintegratedValue: pesos,
        withholdingValue: 0,
        recipientCountryCode: recipientCountry,
        recipientDocTypeCode: recipient?.docTypeCode ?? PENDING,
        recipientDocNumber: recipient?.docNumber ?? PENDING,
        recipientDv: recipient?.dv ?? PENDING,
        recipientFirstSurname: recipient?.firstSurname ?? PENDING,
        recipientSecondSurname: recipient?.secondSurname ?? PENDING,
        recipientFirstName: recipient?.firstName ?? PENDING,
        recipientOtherNames: recipient?.otherNames ?? PENDING,
        recipientBusinessName: recipient?.businessName ?? PENDING,
      },
    });
  }

  const groupedCents = thirds.reduce((s, t) => s + t.totalCents, 0);
  const assignedCents = thirds.filter((t) => t.payerKey).reduce((s, t) => s + t.totalCents, 0);
  if (buyers.lostCents !== 0) problems.push({ level: "blocking", kind: "unproposed", message: `Compras sin tipo o número de documento por ${money(buyers.lostCents)} quedan fuera del 1647.` });
  return {
    records,
    thirds,
    payers,
    problems,
    originCents,
    groupedCents,
    assignedCents,
    unassignedCents: groupedCents - assignedCents,
    unproposedCents: originCents - groupedCents,
    unusedSalesCents: payers.reduce((s, p) => s + p.remainingCents, 0),
    salesCents,
  };
}

export interface PayerOption {
  payer: PayerSummary;
  /** Saldo con el que contaría este pagador al elegirlo a mano: su ingreso menos lo ya asignado a mano a otros terceros (las propuestas automáticas se recalculan después). */
  availableCents: number;
  selectable: boolean;
}

/** Pagadores que se pueden elegir para un tercero: solo los que cubren su valor completo (un tercero nunca se divide). */
export function payerOptions(form: Pick<Form1647, "thirds" | "payers">, thirdKey: string): PayerOption[] {
  const third = form.thirds.find((t) => t.key === thirdKey);
  if (!third) return [];
  return form.payers.map((payer) => {
    const manual = form.thirds.filter((t) => t.key !== thirdKey && t.assignedBy === "manual" && t.payerKey === payer.key).reduce((s, t) => s + t.totalCents, 0);
    const availableCents = payer.totalCents - manual;
    return { payer, availableCents, selectable: third.totalCents > 0 && availableCents >= third.totalCents };
  });
}
