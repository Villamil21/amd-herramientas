import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../../../components/ui";
import type { EinvoiceDoc } from "../../../types/einvoice";
import { buildEinvoiceContribution } from "../domain/einvoiceSales";
import { EinvoiceAuditPanel } from "./EinvoiceAuditPanel";
import { EinvoiceCustomersPanel } from "./EinvoiceCustomersPanel";
import { Einvoice1007Bases, EinvoiceSalesReconciliation } from "./EinvoiceSalesCards";

const doc = (p: Partial<EinvoiceDoc>): EinvoiceDoc => ({
  id: 1,
  companyId: 1,
  documentId: "cufe-1",
  year: 2026,
  issueDate: "2026-03-01",
  docType: "Factura electrónica",
  docTypeKey: "factura electronica",
  category: "sale",
  number: "FE1",
  fileName: "ventas.xlsx",
  sheet: "Ventas",
  rowNumber: 2,
  status: "",
  receiverNitRaw: "900111222",
  receiverName: "CLIENTE UNO SAS",
  totalCents: 1_190_000,
  ivaCents: 190_000,
  eeffBaseCents: 1_000_000,
  eeffColumns: ["IVA", "ICUI", "Rete ICA"],
  exoBaseCents: 1_000_000,
  exoColumns: ["IVA", "ICUI"],
  importedAt: "x",
  updatedAt: "x",
  ...p,
});

/** Humo: las tarjetas nuevas de Exógena se pintan con datos reales (sin pantalla de Tauri disponible en este entorno). */
describe("paneles de Facturación electrónica en Exógena", () => {
  const sales = buildEinvoiceContribution({
    docs: [doc({}), doc({ id: 2, documentId: "cufe-2", category: "return", receiverNitRaw: "1020304050", receiverName: "PEREZ ANA" })],
    customers: [],
    companyVat: [{ companyId: 1, effectiveDate: "2020-01-01", responsible: true, source: "manual", note: "", createdAt: "x" }],
    year: 2026,
  });

  it("auditoría, bases y conciliación", () => {
    const audit = renderToString(createElement(EinvoiceAuditPanel, { format: "1006", sales }));
    expect(audit).toContain("Auditoría");
    expect(audit).toContain("ventas.xlsx");
    expect(audit).toContain("Impuesto generado");
    expect(renderToString(createElement(Einvoice1007Bases, { sales }))).toContain("Total − (IVA … ICUI)");
    const rec = renderToString(createElement(EinvoiceSalesReconciliation, { sales }));
    expect(rec).toContain("1006 / Impuesto generado");
    expect(rec).toContain("1005 / IVA resultante por devoluciones en ventas");
  });

  it("clientes por confirmar", () => {
    const html = renderToString(createElement(ToastProvider, null, createElement(EinvoiceCustomersPanel, { companyId: 1, year: 2026, pending: sales.pendingCustomers, catalogs: null, onChanged: () => undefined })));
    expect(html).toContain("Clientes por confirmar (1)");
    expect(html).toContain("1020304050");
    expect(html.replace(/<!-- -->/g, "")).toContain("Detiene 1007");
  });
});
