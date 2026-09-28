import { formatMoney, formatNumber, type CompositionDocument } from "./model";

// Carta: 8.5 × 11 pulgadas = 612 × 792 puntos. Márgenes uniformes de 0.75".
const PAGE = { width: 612, height: 792, margin: 54 };

export async function renderCompositionPdf(doc: CompositionDocument): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const { width, height, margin } = PAGE;
  const right = width - margin;
  const totalRows = doc.subscribed.rows.length + doc.paid.rows.length;
  // fitToSinglePage: tipografía, filas y espacios se reducen juntos sin crear otra página.
  const scale = Math.max(0.36, Math.min(1, (height - margin * 2) / (470 + totalRows * 38)));
  const S = (value: number) => value * scale;
  let y = margin;
  const text = (value: string, x: number, yPos: number, size: number, align: "left" | "center" = "left", bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(S(size)); pdf.text(value, x, yPos, { align });
  };
  const logoFormat = doc.logo.startsWith("data:image/png") ? "PNG" : "JPEG";
  pdf.addImage(doc.logo, logoFormat, width / 2 - S(34), y, S(68), S(30), undefined, "FAST");
  y += S(57); text("COMPOSICIÓN ACCIONARIA", width / 2, y, 20, "center", true); y += S(24);
  const paragraph = (value: string) => { for (const line of pdf.splitTextToSize(value, right - margin)) { text(line, margin, y, 9); y += S(12); } };
  paragraph(`Mediante el presente documento y obrando en mi calidad de Contadora Pública titulada mediante resolución expedida por el Ministerio de educación Nacional a través la Junta Central de Contadores bajo la Matrícula T-${doc.professionalNumber}`);
  y += S(8);
  paragraph(`Que la sociedad ${doc.company.razonSocial}, identificada con NIT ${formatNumber(Number(doc.company.nit.replace(/\D/g, "")))}-${doc.company.dv}. Tiene un capital accionario dividido de la siguiente manera:`);

  const table = (capital: typeof doc.subscribed) => {
    y += S(12); text(capital.title, width / 2, y, 11, "center", true); y += S(8);
    const cols = [margin, margin + 26, margin + 166, margin + 266, margin + 350, margin + 430, right];
    const headerHeight = S(24), rowHeight = S(19), bottom = y + headerHeight + rowHeight * (capital.rows.length + 1);
    pdf.setFillColor(180, 180, 180); pdf.rect(margin, y, right - margin, headerHeight, "F"); pdf.setDrawColor(35);
    for (const x of cols) pdf.line(x, y, x, bottom);
    pdf.line(margin, y, right, y); pdf.line(margin, y + headerHeight, right, y + headerHeight);
    ["No", "Accionista", "Doc Identidad", "Vlr Nominal", "No Acciones", "Vlr Acciones"].forEach((label, index) => text(label, (cols[index] + cols[index + 1]) / 2, y + S(15), 6.5, "center", true));
    let rowY = y + headerHeight;
    for (const row of capital.rows) {
      const values = [String(row.index), row.shareholder.name, row.shareholder.identityDocument, formatMoney(row.nominal), formatNumber(row.shares), formatMoney(row.value)];
      values.forEach((value, index) => pdf.text(value, (cols[index] + cols[index + 1]) / 2, rowY + S(12), { align: "center", maxWidth: cols[index + 1] - cols[index] - 3 }));
      rowY += rowHeight; pdf.line(margin, rowY, right, rowY);
    }
    text("TOTAL", (cols[1] + cols[4]) / 2, rowY + S(12), 7, "center", true);
    text(formatNumber(capital.totalShares), (cols[4] + cols[5]) / 2, rowY + S(12), 7, "center", true);
    text(formatMoney(capital.totalShares * capital.nominalValue), (cols[5] + cols[6]) / 2, rowY + S(12), 7, "center", true);
    y = bottom;
  };
  table(doc.subscribed); table(doc.paid); y += S(18); paragraph(doc.dateText); y += S(6);
  pdf.addImage(doc.signature, "PNG", margin, y, S(150), S(42), undefined, "FAST"); y += S(52);
  text(doc.signer.name, margin, y, 8, "left", true); y += S(11); text(doc.signer.role, margin, y, 8, "left", true); y += S(11); text(`TP. T-${doc.professionalNumber} JUNTA CENTRAL DE CONTADORES`, margin, y, 8, "left", true);
  return new Uint8Array(pdf.output("arraybuffer"));
}
