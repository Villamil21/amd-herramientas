import { getLogoDataUrl } from "../../../services/companyService";
import { signerService } from "../../../services/signerService";
import type { FsCatalog, FsPucMapping, Presentation } from "../../../types/fs";
import type { CertificateSigner, Company } from "../../../types/models";
import { eerrRows, esfRows, type Statements, type StatementRow } from "./engine";
import { statementsFileName, type PdfImage, type StatementsPdfModel } from "./pdf";

/**
 * Snapshot exacto de una generación (o de un cierre): empresa, periodo,
 * presentación interna, valores, catálogo y mapeos usados, firmas, datos de la
 * empresa y fecha/hora. Con él se regenera la misma versión aunque después
 * cambien el catálogo, los mapeos, la empresa o las firmas.
 */
export interface StatementsSnapshot {
  format: 1;
  generatedAt: string;
  fileName: string;
  period: { start: string; end: string };
  /** Solo interna: nunca aparece en el PDF. */
  presentation: Presentation;
  company: Pick<Company, "id" | "razonSocial" | "nit" | "dv" | "logoFile" | "legalRepName" | "legalRepDocument" | "subscribedTotalShares" | "subscribedNominalValue" | "paidTotalShares" | "paidNominalValue">;
  accountant: Pick<CertificateSigner, "id" | "name" | "professionalDocument" | "accountantTitle" | "signatureFile"> | null;
  esfRows: StatementRow[];
  eerrRows: StatementRow[];
  totals: Statements["esf"] & { beforeTax: number; incomeTaxPesos: number };
  catalog: FsCatalog;
  mappings: FsPucMapping[];
}

export function buildSnapshot(s: Statements, args: { company: Company; accountant: CertificateSigner | null; start: string; end: string; presentation: Presentation; catalog: FsCatalog; mappings: FsPucMapping[] }): StatementsSnapshot {
  const { company: c, accountant: a } = args;
  return {
    format: 1,
    generatedAt: new Date().toISOString(),
    fileName: statementsFileName(c.razonSocial, args.end),
    period: { start: args.start, end: args.end },
    presentation: args.presentation,
    company: { id: c.id, razonSocial: c.razonSocial, nit: c.nit, dv: c.dv, logoFile: c.logoFile, legalRepName: c.legalRepName, legalRepDocument: c.legalRepDocument, subscribedTotalShares: c.subscribedTotalShares, subscribedNominalValue: c.subscribedNominalValue, paidTotalShares: c.paidTotalShares, paidNominalValue: c.paidNominalValue },
    accountant: a ? { id: a.id, name: a.name, professionalDocument: a.professionalDocument, accountantTitle: a.accountantTitle, signatureFile: a.signatureFile } : null,
    esfRows: esfRows(s),
    eerrRows: eerrRows(s),
    totals: { ...s.esf, beforeTax: s.eerr.beforeTax, incomeTaxPesos: s.incomeTaxPesos },
    catalog: args.catalog,
    mappings: args.mappings,
  };
}

function loadImage(dataUrl: string | null): Promise<PdfImage | null> {
  if (!dataUrl) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/** Modelo del PDF a partir del snapshot (logo y firma se leen de sus archivos, que nunca cambian de contenido). */
export async function pdfModel(snapshot: StatementsSnapshot): Promise<StatementsPdfModel> {
  const [logo, signature] = await Promise.all([
    getLogoDataUrl(snapshot.company.logoFile).then(loadImage),
    snapshot.accountant?.signatureFile ? signerService.dataUrl(snapshot.accountant.signatureFile).then(loadImage, () => null) : Promise.resolve(null),
  ]);
  return {
    companyName: snapshot.company.razonSocial,
    nit: snapshot.company.nit,
    dv: snapshot.company.dv,
    logo,
    startDate: snapshot.period.start,
    endDate: snapshot.period.end,
    esfRows: snapshot.esfRows,
    eerrRows: snapshot.eerrRows,
    legalRep: { name: snapshot.company.legalRepName, document: snapshot.company.legalRepDocument },
    accountant: { name: snapshot.accountant?.name ?? "", title: snapshot.accountant?.accountantTitle ?? "", professionalDocument: snapshot.accountant?.professionalDocument ?? "", signature },
  };
}
