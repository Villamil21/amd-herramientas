import type { IssuerData } from "../../taxes/invoice-vat/types";
import type { ExoCatalogs } from "../../../types/exogena";
import type { Supplier, SupplierTaxInput } from "../../../types/models";
import { resolveTerritoryByName } from "./territory";
import { COLOMBIA, DOC_NIT, thirdPartyOf } from "./thirdParty";

/**
 * Datos del emisor de una factura («Datos del Emisor / Vendedor») → ficha del tercero, de forma REVISABLE:
 *  - Lo que el proveedor no tenía se propone para completar (marcado de entrada).
 *  - Lo que ya tenía y la factura contradice se muestra como diferencia (sin marcar): nunca se pisa en silencio.
 *  - Una persona jurídica es NIT (31). Una persona natural cuya factura no revela el tipo de documento NO recibe uno: queda la
 *    tarea «Tipo de documento pendiente» (nunca se inventa el 13).
 */

export type ChangeKey = "personType" | "docTypeCode" | "address" | "countryCode" | "deptCode" | "muniCode";

export interface FieldChange {
  key: ChangeKey;
  label: string;
  current: string;
  proposed: string;
  /** Mostrado: valor legible (con el nombre del catálogo). */
  currentLabel: string;
  proposedLabel: string;
  /** fill: el proveedor no lo tenía · conflict: ya tiene otro valor. */
  kind: "fill" | "conflict";
}

export interface SupplierProposal {
  supplier: Supplier;
  changes: FieldChange[];
  /** Persona natural cuyo tipo de documento sigue sin conocerse. */
  needsDocType: boolean;
  warnings: string[];
}

export interface IssuerInvoice {
  nit: string;
  name: string;
  issuer?: IssuerData;
}

const LABEL: Record<ChangeKey, string> = { personType: "Tipo de persona", docTypeCode: "Tipo de documento", address: "Dirección", countryCode: "País", deptCode: "Departamento", muniCode: "Municipio" };
const PERSON = { PJ: "Persona jurídica", PN: "Persona natural" } as const;

const key = (v: string) => v.trim().replace(/\s+/g, " ").toUpperCase();

/** Propuestas por proveedor existente (una por NIT: la primera factura con datos del emisor). Los NIT sin ficha no se tocan. */
export function proposeFromInvoices(invoices: IssuerInvoice[], suppliers: Supplier[], catalogs: ExoCatalogs): SupplierProposal[] {
  const byNit = new Map(suppliers.map((s) => [s.nit, s]));
  const seen = new Set<string>();
  const out: SupplierProposal[] = [];
  for (const inv of invoices) {
    const supplier = byNit.get(inv.nit);
    if (!supplier || !inv.issuer || seen.has(inv.nit)) continue;
    seen.add(inv.nit);
    const t = thirdPartyOf(supplier);
    const place = resolveTerritoryByName(catalogs, { country: inv.issuer.country, department: inv.issuer.department, city: inv.issuer.city });
    const nameOf = {
      docTypeCode: (c: string) => catalogs.documentTypes.find((d) => d.code === c)?.description,
      countryCode: (c: string) => catalogs.countries.find((x) => x.code === c)?.name,
      deptCode: (c: string) => catalogs.departments.find((x) => x.code === c)?.name,
      muniCode: (c: string, dept: string) => catalogs.municipalities.find((m) => m.deptCode === dept && m.code === c)?.name,
    };
    const proposedPerson = inv.issuer.personType ?? "";
    const effectivePerson = proposedPerson || t.personType || "";
    const candidates: [ChangeKey, string, string][] = [
      ["personType", t.personType ?? "", proposedPerson],
      // Persona jurídica = NIT. Para una natural la factura no dice el tipo de documento: no se propone ninguno.
      ["docTypeCode", t.docTypeCode ?? "", effectivePerson === "PJ" ? DOC_NIT : ""],
      ["address", t.address, inv.issuer.address ? key(inv.issuer.address) : ""],
      ["countryCode", t.countryCode, place.countryCode],
      ["deptCode", t.deptCode, place.countryCode === COLOMBIA || (!place.countryCode && place.deptCode) ? place.deptCode : ""],
      ["muniCode", t.muniCode, place.muniCode],
    ];
    const changes: FieldChange[] = [];
    for (const [k, current, proposed] of candidates) {
      if (!proposed || key(current) === key(proposed)) continue;
      const show = (v: string): string => {
        if (!v) return "";
        if (k === "personType") return PERSON[v as "PJ" | "PN"] ?? v;
        if (k === "address") return v;
        const name = k === "docTypeCode" ? nameOf.docTypeCode(v) : k === "countryCode" ? nameOf.countryCode(v) : k === "deptCode" ? nameOf.deptCode(v) : nameOf.muniCode(v, place.deptCode || t.deptCode);
        return name ? `${v} — ${name}` : v;
      };
      changes.push({ key: k, label: LABEL[k], current, proposed, currentLabel: show(current), proposedLabel: show(proposed), kind: current ? "conflict" : "fill" });
    }
    const docType = changes.find((c) => c.key === "docTypeCode")?.proposed ?? t.docTypeCode;
    out.push({ supplier, changes, needsDocType: effectivePerson === "PN" && !docType, warnings: place.warnings });
  }
  return out.filter((p) => p.changes.length > 0 || p.needsDocType);
}

/** Datos tributarios resultantes de aceptar solo algunos cambios (el resto del proveedor se conserva tal cual). */
export function applyProposal(proposal: SupplierProposal, accepted: ReadonlySet<ChangeKey>): SupplierTaxInput {
  const t = thirdPartyOf(proposal.supplier);
  const pick = (k: ChangeKey, current: string) => {
    const change = proposal.changes.find((c) => c.key === k);
    return change && accepted.has(k) ? change.proposed : current;
  };
  const personType = (pick("personType", t.personType ?? "") || null) as "PJ" | "PN" | null;
  const countryCode = pick("countryCode", t.countryCode);
  return {
    data: {
      docTypeCode: pick("docTypeCode", t.docTypeCode ?? "") || null,
      dv: t.dv,
      personType,
      firstSurname: t.firstSurname,
      secondSurname: t.secondSurname,
      firstName: t.firstName,
      otherNames: t.otherNames,
      address: pick("address", t.address),
      countryCode,
      deptCode: countryCode === COLOMBIA ? pick("deptCode", t.deptCode) : "",
      muniCode: countryCode === COLOMBIA ? pick("muniCode", t.muniCode) : "",
    },
    dataOrigin: "factura",
  };
}
