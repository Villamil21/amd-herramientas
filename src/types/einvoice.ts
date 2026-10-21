/** Ventas por facturación electrónica para Exógena (`database/einvoice.rs`). */

export type EinvoiceCategory = "sale" | "return";

export interface EinvoiceDocInput {
  documentId: string;
  issueDate: string;
  docType: string;
  docTypeKey: string;
  category: EinvoiceCategory;
  number: string;
  fileName: string;
  sheet: string;
  rowNumber: number;
  status: string;
  receiverNitRaw: string;
  receiverName: string;
  totalCents: number;
  ivaCents: number;
  eeffBaseCents: number;
  eeffColumns: string[];
  /** Total − (IVA … ICUI); null si el alcance no está definido. */
  exoBaseCents: number | null;
  exoColumns: string[];
}

export interface EinvoiceDoc extends EinvoiceDocInput {
  id: number;
  companyId: number;
  year: number;
  importedAt: string;
  updatedAt: string;
}

export interface SaveEinvoiceOutcome {
  inserted: number;
  updated: number;
  unchanged: number;
  conflicts: string[];
  years: number[];
}

export interface EinvoiceCustomer {
  companyId: number;
  docNumber: string;
  docTypeCode: string;
  dv: string;
  firstSurname: string;
  secondSurname: string;
  firstName: string;
  otherNames: string;
  businessName: string;
  confirmedAt?: string;
  updatedAt?: string;
}
