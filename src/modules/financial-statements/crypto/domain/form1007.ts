import { centsToPesos } from "../../../exogena/domain/numbers";
import { countryByDocument, thirdKey } from "./documents";
import type { Operation } from "./operations";
import { partyName, partyOf, PENDING } from "./parties";
import type { CryptoProblem } from "./problems";

/**
 * Formato 1007 — Ingresos recibidos. Se arma con las Ventas aceptadas del año, agrupadas por tipo documental DIAN e
 * identificación normalizada. Concepto siempre 4001; devoluciones, rebajas y descuentos siempre 0.
 */
export const CONCEPT_1007 = "4001";

export interface Data1007 {
  concept: string;
  docTypeCode: string;
  docNumber: string;
  dv: string;
  firstSurname: string;
  secondSurname: string;
  firstName: string;
  otherNames: string;
  businessName: string;
  countryCode: string;
  /** Pesos enteros. */
  grossIncome: number;
  returns: number;
  [key: string]: unknown;
}

export interface Record1007 {
  sourceKey: string;
  originRef: string;
  data: Data1007;
  /** Suma exacta de las Ventas del tercero (centavos), antes de pasar a pesos enteros. */
  sourceCents: number;
  operations: Operation[];
  /** Solo la identificación; los pendientes están en `problems`. */
}

export interface Form1007 {
  records: Record1007[];
  problems: CryptoProblem[];
  /** Ventas aceptadas del año (centavos). */
  originCents: number;
  /** Ventas que sí entraron a algún registro (centavos exactos). */
  includedCents: number;
  /** Ventas que no se pudieron proponer (tipo de documento sin clasificar o sin identificación). */
  unproposedCents: number;
}

export const sourceKey1007 = (docCode: string, number: string) => `ingresos:${thirdKey(docCode, number)}`;

export function buildForm1007(sales: readonly Operation[], countryDecisions: ReadonlyMap<string, string>): Form1007 {
  const accepted = sales.filter((o) => o.kind === "sale" && o.status === "accepted");
  const problems: CryptoProblem[] = [];
  const groups = new Map<string, Operation[]>();
  const unproposed: Operation[] = [];
  const unknownTypes = new Map<string, Operation[]>();
  for (const op of accepted) {
    if (op.docCode === null) {
      unknownTypes.set(op.docTypeKey, [...(unknownTypes.get(op.docTypeKey) ?? []), op]);
      unproposed.push(op);
    } else if (!op.docNumber) {
      problems.push({ level: "blocking", kind: "identification", message: `Ventas, ${op.fileName}, fila ${op.rowNumber}: falta el número de identificación de quien recibe el ingreso; la fila no se puede proponer al 1007.` });
      unproposed.push(op);
    } else {
      const key = thirdKey(op.docCode, op.docNumber);
      groups.set(key, [...(groups.get(key) ?? []), op]);
    }
  }
  for (const [key, ops] of unknownTypes)
    problems.push({
      level: "blocking",
      kind: "document_type",
      message: key ? `El tipo de documento «${ops[0].docTypeRaw}» de ${ops.length} ${ops.length === 1 ? "venta" : "ventas"} no está clasificado: elige su código DIAN una vez.` : `${ops.length} ${ops.length === 1 ? "venta no tiene" : "ventas no tienen"} tipo de documento: no se pueden proponer al 1007.`,
      payload: { docTypeKey: key, docTypeRaw: ops[0].docTypeRaw },
    });

  const records: Record1007[] = [];
  for (const [key, ops] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [docCode, number] = key.split("|");
    const party = partyOf(ops, docCode, number);
    const sourceCents = ops.reduce((s, o) => s + (o.amountCents ?? 0), 0);
    const recordKey = sourceKey1007(docCode, number);
    const chosen = countryByDocument(docCode) ?? countryDecisions.get(key);
    const label = partyName(ops) || `${docCode} ${number}`;
    if (!chosen) problems.push({ level: "blocking", kind: "country", message: `${label}: el tipo de documento ${docCode} exige confirmar manualmente el país de residencia o domicilio.`, recordKey, field: "countryCode", payload: { thirdKey: key, label } });
    for (const m of party.missing) problems.push({ level: "blocking", kind: "name", message: `${label}: falta ${m}.`, recordKey });
    records.push({
      sourceKey: recordKey,
      originRef: `Transacciones Cripto · Ventas · ${ops.length} ${ops.length === 1 ? "fila" : "filas"} · ${label}`,
      sourceCents,
      operations: ops,
      data: {
        concept: CONCEPT_1007,
        ...party.fields,
        countryCode: chosen ?? PENDING,
        grossIncome: centsToPesos(sourceCents),
        returns: 0,
      },
    });
  }
  const originCents = accepted.reduce((s, o) => s + (o.amountCents ?? 0), 0);
  const unproposedCents = unproposed.reduce((s, o) => s + (o.amountCents ?? 0), 0);
  if (unproposedCents !== 0 || unproposed.length) problems.push({ level: "blocking", kind: "unproposed", message: `${unproposed.length} ${unproposed.length === 1 ? "venta" : "ventas"} sin tipo o número de documento quedan fuera del 1007 (suman ${(unproposedCents / 100).toLocaleString("es-CO")}).` });
  return { records, problems, originCents, includedCents: records.reduce((s, r) => s + r.sourceCents, 0), unproposedCents };
}

