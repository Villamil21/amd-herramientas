import type { PurchasesAudit } from "./purchasesAudit";

/** PDF interno de auditoría de 1001 / 1005 / 1006: hoja Carta, texto corrido con salto de página y numeración al pie. */
const PAGE = { width: 612, height: 792 };
const MX = 48;
const WIDTH = PAGE.width - MX * 2;
const BOTTOM = PAGE.height - 50;

export async function renderPurchasesAuditPdf(audit: PurchasesAudit): Promise<{ bytes: Uint8Array; pages: number }> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: [PAGE.width, PAGE.height], compress: true });
  let y = 56;
  const ensure = (h: number) => {
    if (y + h > BOTTOM) {
      pdf.addPage();
      y = 56;
    }
  };
  const text = (value: string, o: { size?: number; bold?: boolean; x?: number; color?: string; width?: number } = {}) => {
    const size = o.size ?? 9;
    pdf.setFont("helvetica", o.bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(o.color ?? "#222222");
    const lines = pdf.splitTextToSize(value, o.width ?? WIDTH - ((o.x ?? MX) - MX)) as string[];
    for (const l of lines) {
      ensure(size + 3);
      pdf.text(l, o.x ?? MX, y);
      y += size + 3;
    }
  };
  const heading = (value: string) => {
    ensure(30);
    y += 8;
    text(value, { size: 11, bold: true, color: "#1f3a6e" });
    y += 2;
  };

  text(audit.company.toUpperCase(), { size: 13, bold: true });
  text(`NIT ${audit.nit} · Año ${audit.year}`, { color: "#555555" });
  y += 4;
  text(audit.title, { size: 12, bold: true });
  text(`Estado del formato: ${audit.statusLabel} · ${audit.records.length} registros · ${audit.totals.documents} facturas vigentes · ${audit.totals.lines} líneas (${audit.totals.pendingLines} por confirmar)`, { color: "#555555" });
  text("Documento interno de control: no es un formato para la DIAN.", { size: 8, color: "#777777" });

  if (audit.notApplicableReason) {
    heading("No aplica");
    text(audit.notApplicableReason);
  }

  heading("Cobertura mensual");
  for (const c of audit.coverage) text(`${c.month}: ${c.purchases} compras · ${c.returns} devoluciones · ${c.duplicates} duplicadas · ${c.pending} con pendientes por confirmar · ${c.blocked} bloqueadas`);

  if (audit.reconciliation) {
    heading("Conciliación del IVA (1005 − 1006 = 1001)");
    for (const r of audit.reconciliation) text(`${r.label}: ${r.value}`);
  }

  heading("Pendientes");
  if (audit.problems.length === 0) text("Sin pendientes.");
  for (const p of audit.problems) text(`• [${p.level}] ${p.message}`);

  heading("Registros y su origen");
  if (audit.records.length === 0) text("Sin registros.");
  for (const r of audit.records) {
    ensure(40);
    y += 4;
    text(`${r.third} · ${r.document}${r.concept ? ` · concepto ${r.concept}` : ""}${r.outdated ? " · DESACTUALIZADO" : ""}`, { bold: true });
    text(r.values.map((v) => `${v.label}: ${v.value}`).join(" · "), { x: MX + 10 });
    for (const t of r.trace) text(`${t.date} · ${t.invoice} (${t.file}) · ${t.detail} · $ ${(t.amountCents / 100).toLocaleString("es-CO")}`, { size: 8, x: MX + 10, color: "#555555" });
  }

  const total = pdf.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor("#777777");
    pdf.text(`Página ${i} de ${total}`, PAGE.width / 2, PAGE.height - 28, { align: "center" });
  }
  return { bytes: new Uint8Array(pdf.output("arraybuffer")), pages: total };
}
