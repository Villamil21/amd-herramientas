import type { CompanyInput } from "../../types/models";
import { REGISTRAL_FIELDS } from "./import/registral";

/**
 * Pestañas de la ficha de empresa y el campo que edita cada una. Cada dato tiene UNA sola pestaña donde se edita
 * (por ejemplo el CIIU solo en «Fiscal y registral»); sirve también para señalar en qué pestaña quedaron cambios sin guardar.
 */
export type CompanyTab = "resumen" | "generales" | "societaria" | "fiscal";

export const COMPANY_TABS: { id: CompanyTab; label: string }[] = [
  { id: "resumen", label: "Resumen y documentos" },
  { id: "generales", label: "Datos generales" },
  { id: "societaria", label: "Estructura societaria" },
  { id: "fiscal", label: "Fiscal y registral" },
];

type EditableKey = keyof CompanyInput;

export const TAB_FIELDS: Record<CompanyTab, EditableKey[]> = {
  resumen: ["newDocuments"],
  generales: ["logoFile", "razonSocial", "nit", "dv", "ciudad", "direccion", "telefono", "correo", "infoAdicional"],
  societaria: ["subscribedTotalShares", "subscribedNominalValue", "paidTotalShares", "paidNominalValue", "shareholders", "legalRepName", "legalRepDocument", "legalRepAltName", "legalRepAltDocument", "legalRepManual", "legalRepAltManual"],
  fiscal: ["ciiuCode", ...(REGISTRAL_FIELDS as EditableKey[]), "registralReview"],
};

/** Pestaña donde se edita un campo (cada campo pertenece a exactamente una). */
export function tabOf(field: EditableKey): CompanyTab | null {
  return COMPANY_TABS.find((t) => TAB_FIELDS[t.id].includes(field))?.id ?? null;
}

/** Pestañas con cambios respecto del estado guardado. */
export function dirtyTabs(saved: CompanyInput, current: CompanyInput, hasPendingDocuments: boolean): CompanyTab[] {
  return COMPANY_TABS.filter((t) => {
    if (t.id === "resumen" && hasPendingDocuments) return true;
    return TAB_FIELDS[t.id].some((k) => k !== "newDocuments" && JSON.stringify(saved[k] ?? null) !== JSON.stringify(current[k] ?? null));
  }).map((t) => t.id);
}
