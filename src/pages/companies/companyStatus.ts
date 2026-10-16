import type { Company } from "../../types/models";

/**
 * Estado compacto de una empresa para el listado: ¿tiene lo necesario para trabajar (Estados Financieros, Exógena, Notas)?
 *  - «Faltan datos»: falta algo que los demás módulos necesitan.
 *  - «Requiere revisión»: está completa pero hay algo por confirmar (Cámara no confirmó un dato, un RUT de socio con diferencias).
 *  - «Lista».
 * Función pura: el listado solo muestra el resultado y su detalle breve.
 */
export type CompanyState = "lista" | "revision" | "faltan";

export const COMPANY_STATE_LABEL: Record<CompanyState, string> = { lista: "Lista", revision: "Requiere revisión", faltan: "Faltan datos" };

export interface CompanyStatus {
  state: CompanyState;
  missing: string[];
  review: string[];
  /** Documentos vigentes cargados de los dos que se esperan (RUT y Cámara). */
  documents: { rut: boolean; camara: boolean; count: number };
  /** Resumen de una línea para el tooltip. */
  detail: string;
}

type StatusInput = Pick<Company, "razonSocial" | "nit" | "ciiuCode" | "subscribedTotalShares" | "subscribedNominalValue" | "shareholders" | "documents" | "legalRepName" | "registralReview">;

export function companyStatus(c: StatusInput): CompanyStatus {
  const rut = c.documents.some((d) => d.kind === "rut");
  const camara = c.documents.some((d) => d.kind === "camara");
  const missing: string[] = [];
  if (!rut) missing.push("RUT sin cargar");
  if (!camara) missing.push("Cámara de Comercio sin cargar");
  if (!c.ciiuCode.trim()) missing.push("Código CIIU");
  if (!c.subscribedTotalShares || !c.subscribedNominalValue) missing.push("Capital suscrito");
  if (c.shareholders.length === 0) missing.push("Socios");
  if (!c.legalRepName.trim()) missing.push("Representante legal");
  const review: string[] = [];
  if (c.registralReview.length > 0) review.push(`${c.registralReview.length} ${c.registralReview.length === 1 ? "dato registral" : "datos registrales"} por revisar`);
  const rutDiffs = c.shareholders.filter((s) => s.rutStatus === "revisar").length;
  if (rutDiffs > 0) review.push(`${rutDiffs} ${rutDiffs === 1 ? "RUT de socio con diferencias" : "RUT de socios con diferencias"}`);
  const state: CompanyState = missing.length ? "faltan" : review.length ? "revision" : "lista";
  const items = state === "faltan" ? missing : state === "revision" ? review : [];
  const detail = state === "lista" ? "Documentos, socios y datos completos." : `${items.slice(0, 3).join(" · ")}${items.length > 3 ? ` · y ${items.length - 3} más` : ""}`;
  return { state, missing, review, documents: { rut, camara, count: Number(rut) + Number(camara) }, detail };
}
