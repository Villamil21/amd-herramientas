import { digitsOf, normalizePhone, upperText } from "../normalize";
import type { CamaraData } from "./camaraParser";
import type { RutData } from "./rutParser";

export type ImportSource = "rut" | "camara";
export const SOURCE_LABEL: Record<ImportSource, string> = { rut: "RUT", camara: "Cámara de Comercio" };

/** Campos del formulario que pueden venir de un documento. */
export interface ImportableValues {
  razonSocial: string;
  nit: string;
  dv: string;
  ciiuCode: string;
  ciudad: string;
  direccion: string;
  correo: string;
  telefono: string;
  subscribedTotalShares: number | null;
  subscribedNominalValue: number | null;
  paidTotalShares: number | null;
  paidNominalValue: number | null;
}
export type ImportField = keyof ImportableValues;

export const FIELD_LABEL: Record<ImportField, string> = {
  razonSocial: "Razón social",
  nit: "NIT",
  dv: "DV",
  ciiuCode: "Código CIIU",
  ciudad: "Ciudad",
  direccion: "Dirección",
  correo: "Correo electrónico",
  telefono: "Teléfono",
  subscribedTotalShares: "Capital suscrito · acciones",
  subscribedNominalValue: "Capital suscrito · valor nominal",
  paidTotalShares: "Capital pagado · acciones",
  paidNominalValue: "Capital pagado · valor nominal",
};

export type ImportValue = string | number;

/** Cómo se guarda cada campo (misma normalización que el backend) para comparar sin falsos desacuerdos. */
function normalizeValue(field: ImportField, value: ImportValue): ImportValue {
  if (typeof value === "number") return value;
  switch (field) {
    case "nit":
    case "dv":
      return digitsOf(value);
    case "ciiuCode":
      return value.replace(/\D/g, "");
    case "correo":
      return value.trim().toLowerCase();
    case "telefono":
      return normalizePhone(value);
    default:
      return upperText(value);
  }
}

const isEmpty = (value: ImportValue | null | undefined) => value === null || value === undefined || value === "" || value === 0;

export interface ImportOption {
  /** «current» = el valor que ya tiene el formulario. */
  source: ImportSource | "current";
  value: ImportValue;
}

export interface ImportConflict {
  field: ImportField;
  label: string;
  options: ImportOption[];
}

export interface ImportPlan {
  /** Valores que se pueden aplicar sin pisar nada. */
  apply: Partial<ImportableValues>;
  /** De dónde viene cada valor aplicado. */
  origin: Partial<Record<ImportField, ImportSource[]>>;
  /** Propiedades con valores distintos: el usuario debe elegir cuál conservar antes de guardar. */
  conflicts: ImportConflict[];
}

type Candidate = { source: ImportSource; value: ImportValue };

function candidatesFrom(rut: RutData | null, camara: CamaraData | null): Partial<Record<ImportField, Candidate[]>> {
  const out: Partial<Record<ImportField, Candidate[]>> = {};
  const add = (field: ImportField, source: ImportSource, value: ImportValue | null | undefined) => {
    if (isEmpty(value)) return;
    (out[field] ??= []).push({ source, value: value as ImportValue });
  };
  if (rut) {
    add("razonSocial", "rut", rut.razonSocial);
    add("nit", "rut", rut.nit);
    add("dv", "rut", rut.dv);
    add("ciiuCode", "rut", rut.ciiu);
    add("ciudad", "rut", rut.ciudad);
    add("direccion", "rut", rut.direccion);
    add("correo", "rut", rut.correo);
    add("telefono", "rut", rut.telefono);
  }
  if (camara) {
    add("razonSocial", "camara", camara.razonSocial);
    add("nit", "camara", camara.nit);
    add("dv", "camara", camara.dv);
    add("subscribedTotalShares", "camara", camara.subscribed.shares);
    add("subscribedNominalValue", "camara", camara.subscribed.nominal);
    add("paidTotalShares", "camara", camara.paid.shares);
    add("paidNominalValue", "camara", camara.paid.nominal);
  }
  return out;
}

/**
 * Compara lo que traen el RUT y la Cámara con lo que ya tiene el formulario. Nunca sobrescribe en silencio:
 * - Un solo valor propuesto y el campo vacío → se aplica (con su origen).
 * - Un solo valor propuesto que ya coincide con el del formulario → no hay nada que hacer.
 * - Valores distintos entre RUT y Cámara, o distintos del que ya está escrito → discrepancia a resolver.
 */
export function planImport(current: ImportableValues, rut: RutData | null, camara: CamaraData | null): ImportPlan {
  const plan: ImportPlan = { apply: {}, origin: {}, conflicts: [] };
  const candidates = candidatesFrom(rut, camara);
  for (const field of Object.keys(candidates) as ImportField[]) {
    const list = candidates[field]!;
    const groups = new Map<ImportValue, Candidate[]>();
    for (const c of list) {
      const key = normalizeValue(field, c.value);
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    const currentValue = current[field];
    const hasCurrent = !isEmpty(currentValue);
    const currentKey = hasCurrent ? normalizeValue(field, currentValue as ImportValue) : null;
    if (groups.size === 1) {
      const [key, sources] = [...groups.entries()][0];
      if (!hasCurrent) {
        plan.apply[field] = sources[0].value as never;
        plan.origin[field] = sources.map((s) => s.source);
      } else if (currentKey !== key) {
        plan.conflicts.push({ field, label: FIELD_LABEL[field], options: [{ source: "current", value: currentValue as ImportValue }, { source: sources[0].source, value: sources[0].value }] });
      }
      continue;
    }
    const options: ImportOption[] = [...groups.values()].map((sources) => ({ source: sources[0].source, value: sources[0].value }));
    if (hasCurrent && !groups.has(currentKey!)) options.unshift({ source: "current", value: currentValue as ImportValue });
    plan.conflicts.push({ field, label: FIELD_LABEL[field], options });
  }
  return plan;
}

/** Cómo se muestra un valor en la discrepancia. */
export const displayValue = (value: ImportValue) => (typeof value === "number" ? new Intl.NumberFormat("es-CO").format(value) : String(value));
