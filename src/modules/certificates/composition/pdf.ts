import { formatMoney, formatNumber, type CompositionDocument } from "./model";

const PAGE = { width: 612, height: 792, margin: 54 };
type Asset = { data: string; width: number; height: number; format: "PNG" | "JPEG" };

function loadAsset(data: string): Promise<Asset> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ data, width: image.naturalWidth, height: image.naturalHeight, format: data.startsWith("data:image/png") ? "PNG" : "JPEG" });
    image.onerror = () => reject(new Error("No se pudo cargar la imagen del certificado."));
    image.src = data;
  });
}

function contain(asset: Asset, x: number, y: number, maxWidth: number, maxHeight: number, centered = true) {
  const factor = Math.min(maxWidth / asset.width, maxHeight / asset.height);
  const width = asset.width * factor, height = asset.height * factor;
  return { x: x + (centered ? (maxWidth - width) / 2 : 0), y: y + (maxHeight - height) / 2, width, height };
}

export async function renderCompositionPdf(doc: CompositionDocument): Promise<Uint8Array> {
  const [{ jsPDF }, logo, signature] = await Promise.all([import("jspdf"), loadAsset(doc.logo), loadAsset(doc.signature)]);
  const pdf = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const { width, height, margin } = PAGE, right = width - margin;
  const totalRows = doc.subscribed.rows.length + doc.paid.rows.length;
  const scale = Math.max(0.46, Math.min(1.16, (height - margin * 2) / (455 + totalRows * 42)));
  const S = (value: number) => value * scale;
  let y = margin;
  const text = (value: string, x: number, yPos: number, size: number, align: "left" | "center" = "left", bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(S(size)); pdf.text(value, x, yPos, { align });
  };
  const logoBox = contain(logo, width / 2 - S(100), y, S(200), S(60));
  pdf.addImage(logo.data, logo.format, logoBox.x, logoBox.y, logoBox.width, logoBox.height, undefined, "FAST");
  y += S(92); text("COMPOSICIÓN ACCIONARIA", width / 2, y, 22, "center", true); y += S(27);
  const paragraph = (value: string) => {
    // splitTextToSize usa la fuente actual; establécela antes de medir para que
    // el salto de línea y el texto dibujado tengan exactamente la misma escala.
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(S(10.5));
    const lines = pdf.splitTextToSize(value, right - margin) as string[];
    lines.forEach((line: string, index: number) => {
      const words = line.trim().split(/\s+/);
      const gaps = words.length - 1;
      const naturalWidth = words.reduce((sum, word) => sum + pdf.getTextWidth(word), 0);
      const gapWidth = index === lines.length - 1 || gaps === 0 ? pdf.getTextWidth(" ") : (right - margin - naturalWidth) / gaps;
      let x = margin;
      words.forEach((word, wordIndex) => { pdf.text(word, x, y); x += pdf.getTextWidth(word) + (wordIndex < gaps ? gapWidth : 0); });
      y += S(14);
    });
  };
  paragraph(`Mediante el presente documento y obrando en mi calidad de Contadora Pública titulada mediante resolución expedida por el Ministerio de educación Nacional a través la Junta Central de Contadores bajo la Matrícula T-${doc.professionalNumber}`);
  y += S(9);
  paragraph(`Que la sociedad ${doc.company.razonSocial}, identificada con NIT ${formatNumber(Number(doc.company.nit.replace(/\D/g, "")))}-${doc.company.dv}. Tiene un capital accionario dividido de la siguiente manera:`);

  let tableIndex = 0;
  const table = (capital: typeof doc.subscribed) => {
    y += S(tableIndex++ === 0 ? 15 : 28); text(capital.title, width / 2, y, 13, "center", true); y += S(9);
    // Ancho acotado: las celdas ya no dejan columnas visualmente vacías.
    // La tabla comparte exactamente el mismo ancho útil de los párrafos.
    const left = margin, tableRight = right, cols = [left, left + 28, left + 184, left + 272, left + 344, left + 419, tableRight];
    const headerHeight = S(27), totalHeight = S(22);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(S(8.5));
    const rowLayouts = capital.rows.map((row) => {
      const nameLines = pdf.splitTextToSize(row.shareholder.name, cols[2] - cols[1] - 8) as string[];
      return { row, nameLines, height: Math.max(S(22), nameLines.length * S(10) + S(10)) };
    });
    const bottom = y + headerHeight + totalHeight + rowLayouts.reduce((sum, row) => sum + row.height, 0);
    const totalTop = y + headerHeight + rowLayouts.reduce((sum, row) => sum + row.height, 0);
    pdf.setFillColor(180, 180, 180); pdf.rect(left, y, tableRight - left, headerHeight, "F"); pdf.setDrawColor(35);
    cols.forEach((x, index) => pdf.line(x, y, x, index === 0 || index >= 4 || index === cols.length - 1 ? bottom : totalTop));
    pdf.line(left, y, tableRight, y); pdf.line(left, y + headerHeight, tableRight, y + headerHeight);
    ["No", "Accionista", "Doc Identidad", "Vlr Nominal", "No Acciones", "Vlr Acciones"].forEach((label, index) => text(label, (cols[index] + cols[index + 1]) / 2, y + S(17), 7.6, "center", true));
    let rowY = y + headerHeight;
    for (const { row, nameLines, height: rowHeight } of rowLayouts) {
      const baseline = rowY + rowHeight / 2 + S(3);
      const values = [String(row.index), "", row.shareholder.identityDocument, formatMoney(row.nominal), formatNumber(row.shares), formatMoney(row.value)];
      values.forEach((value, index) => {
        if (index === 1) return;
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(S(8.5));
        pdf.text(value, (cols[index] + cols[index + 1]) / 2, baseline, { align: "center", maxWidth: cols[index + 1] - cols[index] - 4 });
      });
      pdf.text(nameLines, (cols[1] + cols[2]) / 2, rowY + (rowHeight - nameLines.length * S(10)) / 2 + S(8), { align: "center" });
      rowY += rowHeight; pdf.line(left, rowY, tableRight, rowY);
    }
    text("TOTAL", (left + cols[4]) / 2, rowY + S(14), 8.5, "center", true);
    text(formatNumber(capital.totalShares), (cols[4] + cols[5]) / 2, rowY + S(14), 8.5, "center", true);
    text(formatMoney(capital.totalShares * capital.nominalValue), (cols[5] + cols[6]) / 2, rowY + S(14), 8.5, "center", true);
    pdf.line(left, bottom, tableRight, bottom);
    y = bottom;
  };
  table(doc.subscribed); table(doc.paid); y += S(20); paragraph(doc.dateText); y += S(7);
  const signatureBox = contain(signature, margin, y, S(180), S(54), false);
  pdf.addImage(signature.data, signature.format, signatureBox.x, signatureBox.y, signatureBox.width, signatureBox.height, undefined, "FAST");
  y += S(64); text(doc.signer.name, margin, y, 9, "left", true); y += S(12); text(doc.signer.role, margin, y, 9, "left", true); y += S(12); text(`TP. T-${doc.professionalNumber} JUNTA CENTRAL DE CONTADORES`, margin, y, 9, "left", true);
  return new Uint8Array(pdf.output("arraybuffer"));
}
