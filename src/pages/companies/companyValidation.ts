import type { CompanyInput } from "../../types/models";
import { selectedRep } from "./import/legalReps";
import { splitNitAndDv, sumsTo100, totalPercent } from "./normalize";

export type CompanyErrors = Partial<Record<keyof CompanyInput, string>> & { shareholders?: string; representation?: string };

/** Validaciones que impiden guardar. Cada error se muestra junto al campo de su pestaña. */
export function validateCompany(v: CompanyInput): CompanyErrors {
  const e: CompanyErrors = {};
  if (!v.razonSocial.trim()) e.razonSocial = "La razón social es obligatoria.";
  const nit = splitNitAndDv(v.nit, v.dv);
  if (!v.nit.trim()) e.nit = "El NIT es obligatorio.";
  else if (nit.error) e.nit = nit.error;
  else if (!/^\d+$/.test(nit.nit)) e.nit = "Solo números; el DV va en su propio campo.";
  if (v.dv.trim() && !/^\d+$/.test(v.dv.replace(/\s/g, ""))) e.dv = "Solo números.";
  if (v.ciiuCode.trim() && !/^\d{1,6}$/.test(v.ciiuCode.trim())) e.ciiuCode = "Solo números (ej. 6201 o 0111).";
  if (v.correo.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.correo.trim())) e.correo = "Correo no válido.";

  const people = v.shareholders;
  if (people.some((s) => !s.name.trim() || !s.identityDocument.trim() || !(s.percentage > 0) || s.percentage > 100)) {
    e.shareholders = "Cada accionista necesita nombre, documento y un porcentaje mayor que 0 y hasta 100.";
  } else if (people.some((s) => Math.abs(s.percentage * 100 - Math.round(s.percentage * 100)) > 1e-6)) {
    e.shareholders = "La participación admite hasta dos decimales (por ejemplo 50,20).";
  } else if (people.length && !sumsTo100(people)) {
    e.shareholders = `La participación debe sumar exactamente 100 % (hoy suma ${totalPercent(people)} %).`;
  }
  const principal = selectedRep(v, "principal");
  const alternate = selectedRep(v, "alternate");
  if (alternate && !principal) e.representation = "Define primero el representante legal principal; el suplente no lo reemplaza.";
  else if (principal?.kind === "manual" && !v.legalRepManual) e.representation = "El representante legal principal debe seleccionarse entre los socios.";
  else if (alternate?.kind === "manual" && !v.legalRepAltManual) e.representation = "El representante legal suplente debe seleccionarse entre los socios.";
  return e;
}

/** Pestaña donde está cada error, para llevar allí al usuario. */
export function firstErrorTab(e: CompanyErrors): "generales" | "societaria" | "fiscal" | null {
  if (e.razonSocial || e.nit || e.dv || e.correo) return "generales";
  if (e.shareholders || e.representation) return "societaria";
  if (e.ciiuCode) return "fiscal";
  return null;
}
