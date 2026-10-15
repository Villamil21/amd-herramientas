import type { BatchInput, MovementInput } from "../../../../types/fs";
import type { Company, Supplier } from "../../../../types/models";
import { findCompanyByNit, namesMatch } from "../../shared/companyMatch";
import { DOC_CATEGORY_LABEL, type Assignments, type DocRow, type PucReport } from "../types";
import { signOf } from "./analysis";

/**
 * Clasificación contable de compras → Estados Financieros.
 *
 * La empresa de cada factura es la del NIT del adquiriente (nunca el nombre).
 * Si el nombre escrito es muy distinto al de la empresa: alerta bloqueante con
 * «Ignorar factura» o «Procesar de todas formas» (la decisión queda trazada).
 */

export type CompanyProblem = "no-buyer" | "unknown-company" | "name-mismatch" | "no-date";

export interface DocCompany {
  row: DocRow;
  company?: Company;
  problem?: CompanyProblem;
  /** Decisión del usuario ante «name-mismatch». */
  decision?: "ignore" | "process";
}

export const PROBLEM_TEXT: Record<CompanyProblem, (d: DocCompany) => string> = {
  "no-buyer": () => "No se encontró el NIT del adquiriente en la factura.",
  "unknown-company": (d) => `El NIT del adquiriente ${d.row.buyerNit} no corresponde a ninguna empresa registrada.`,
  "name-mismatch": (d) => `El NIT ${d.row.buyerNit} es de ${d.company?.razonSocial}, pero la factura dice «${d.row.buyerName}».`,
  "no-date": () => "No se identificó la fecha de emisión.",
};

/** Documentos que se enviarían (clasificados, con valor) y su empresa. */
export function companyCheck(report: PucReport, companies: Company[], assignments: Assignments): DocCompany[] {
  const out: DocCompany[] = [];
  for (const row of report.rows) {
    if (row.excluded || !row.category || row.allocations.length === 0) continue;
    const decision = assignments[row.fileName]?.companyDecision;
    const company = findCompanyByNit(companies, row.buyerNit);
    let problem: CompanyProblem | undefined;
    if (!row.buyerNit) problem = "no-buyer";
    else if (!company) problem = "unknown-company";
    else if (!namesMatch(row.buyerName, company.razonSocial) && !decision) problem = "name-mismatch";
    else if (!row.issueDate) problem = "no-date";
    out.push({ row, company, problem, decision });
  }
  return out;
}

/** Motivo que impide enviar (null = listo). */
export function sendBlock(pendingActions: number, docs: DocCompany[]): string | null {
  if (pendingActions > 0) return pendingActions === 1 ? "1 pendiente" : `${pendingActions} pendientes`;
  const problems = docs.filter((d) => d.problem).length;
  if (problems) return problems === 1 ? "1 factura con alerta" : `${problems} facturas con alertas`;
  const sendable = docs.filter((d) => d.decision !== "ignore");
  if (sendable.length === 0) return "No hay facturas clasificadas para enviar";
  const companies = new Set(sendable.map((d) => d.company!.id));
  if (companies.size > 1) return "La carpeta tiene facturas de varias empresas: envía una empresa a la vez";
  return null;
}

/** Un movimiento por producto (código por producto) o por factura (un solo código): el detalle individual. */
export function buildPurchasesBatch(docs: DocCompany[], suppliers: Supplier[], folderName: string): BatchInput | null {
  const sendable = docs.filter((d) => !d.problem && d.decision !== "ignore" && d.company);
  if (sendable.length === 0) return null;
  const supplierByNit = new Map(suppliers.map((s) => [s.nit, s]));
  const movements: MovementInput[] = [];
  const dates: string[] = [];
  for (const { row } of sendable) {
    const sign = signOf(row.category!);
    const documentId = row.cufe ?? `${row.issuerNit}|${row.number ?? row.fileName}`;
    const supplier = row.issuerNit ? supplierByNit.get(row.issuerNit) : undefined;
    const base = {
      accountingDate: row.issueDate!,
      documentId,
      documentNumber: row.number ?? "",
      documentType: DOC_CATEGORY_LABEL[row.category!],
      supplierId: supplier?.id ?? null,
      supplierNit: row.issuerNit ?? "",
      supplierName: row.issuerName ?? "",
      conceptKey: "purchases.line",
    };
    dates.push(row.issueDate!);
    if (row.mode === "document") {
      const a = row.allocations[0];
      movements.push({ ...base, pucCode: a.code, amountCents: a.valueCents, description: "Toda la factura (Total Bruto Factura)", detail: { file: row.fileName } });
      continue;
    }
    for (const l of row.lines) {
      if (!l.code || !l.concept || l.priceCents === undefined) continue;
      movements.push({ ...base, pucCode: l.code, amountCents: sign * l.priceCents, description: l.description, detail: { file: row.fileName, page: l.page, row: l.row } });
    }
  }
  dates.sort();
  return {
    companyId: sendable[0].company!.id,
    source: "purchases",
    fileName: folderName,
    periodLabel: `Compras · ${folderName}`,
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
    metadata: { folder: folderName, documents: sendable.length },
    movements,
    decisions: docs
      .filter((d) => d.decision)
      .map((d) => ({
        documentKey: d.row.cufe ?? `${d.row.issuerNit}|${d.row.number ?? d.row.fileName}`,
        decision: d.decision === "ignore" ? "Ignorar factura" : "Procesar de todas formas",
        detail: `NIT ${d.row.buyerNit} de ${d.company?.razonSocial}; la factura dice «${d.row.buyerName}» (${d.row.fileName}).`,
      })),
  };
}
