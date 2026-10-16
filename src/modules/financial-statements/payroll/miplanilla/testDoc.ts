import type { PdfDocumentText, PdfTextItem } from "../../../bank-analysis/shared/pdf/pdfTypes";

/**
 * Planilla de MiPlanilla sintética: reproduce la geometría y los encabezados de la planilla real
 * («Planilla Integrada de Autoliquidación de Aportes», 2 páginas: totales y detalle por cotizante),
 * con datos inventados. Las coordenadas son las del PDF de referencia.
 */

const WIDTH = 2.7;
/** Texto centrado en `center` (así se alinea con el centro de su encabezado, como en el PDF real). */
const t = (text: string, center: number, y: number): PdfTextItem => {
  const width = Math.max(2, text.length * WIDTH);
  return { text, x: center - width / 2, y, width, height: 4 };
};
/** Encabezado girado 90° (como «Días»): su caja es de un cuerpo de ancho. */
const rotated = (text: string, center: number, y: number): PdfTextItem => ({ text, x: center - 2, y, width: 4, height: text.length * 2.7, rotated: true });

export interface DocEmployee {
  no: number;
  doc: string;
  /** Líneas del nombre (puede ocupar 2 o 3). */
  name: string[];
  ibc: number;
  days: number;
  pension: number;
  health: number;
  risk: number;
  ccf: number;
  sena?: number;
  icbf?: number;
  esap?: number;
  men?: number;
  /** Aportes voluntarios / FSP de pensión (4 columnas). */
  extras?: [number, number, number, number];
}

export interface DocSpec {
  nit?: string;
  name?: string;
  planilla?: string;
  paymentDate?: string;
  healthPeriod?: string;
  pensionPeriod?: string | null;
  declaredEmployees?: number;
  totalPayroll?: string;
  totalToPay?: string;
  employees: DocEmployee[];
  /** Valores de «Totales por subsistema» (antes de mora, a pagar). */
  totals: Record<"health" | "pension" | "risk" | "ccf" | "sena" | "icbf" | "esap" | "men", [number, number]>;
  grand: [number, number];
  /** Filas de administradoras (cotización, a pagar) por subsistema. */
  administrators: Record<"health" | "pension" | "risk" | "ccf", [number, number][]>;
  /** Solo para probar encabezados faltantes. */
  omitHeader?: string;
}

const money = (n: number) => new Intl.NumberFormat("es-CO").format(n);

function pageHeader(spec: DocSpec, n: number): PdfTextItem[] {
  const items: PdfTextItem[] = [
    t("PLANILLA INTEGRADA DE AUTOLIQUIDACION DE APORTES", 411, 572),
    t(`PAG ${n} de 2`, 729, 543),
    t("DATOS DEL APORTANTE", 248, 529),
    t("NOMBRE APORTANTE", 184, 520),
    t("DIRECCIÓN", 257, 520),
    t("NÚMERO", 592, 520),
    t("FECHA PAGO", 647.5, 520),
    t("EMPLEADOS", 698.5, 516),
    t("FORMA PRESENTACIÓN", 62, 490),
    t("PERIODO SALUD", 495, 490),
    t("PERIODO PENSIÓN", 541, 490),
    t("TIPO PLANILLA", 592, 490),
    t("TOTAL NÓMINA", 647.5, 490),
    t("TOTAL A PAGAR", 711.5, 490),
    t(`${spec.nit ?? "901679752-3"}`, 114.5, 501),
    t(spec.name ?? "NFES SOLUTIONS SAS", 182.5, 501),
    t("DG 35 34 29 CA 2", 256.5, 501),
    t(spec.planilla ?? "40724055", 592, 501),
    t(spec.paymentDate ?? "17/02/2026", 647.5, 501),
    t(String(spec.declaredEmployees ?? spec.employees.length), 698.5, 506.4),
    t("ÚNICA", 62, 476),
    t(spec.healthPeriod ?? "2026-02", 495, 476),
    t("E", 592, 476),
    t(spec.totalPayroll ?? "$5,252,715", 647.5, 476),
    t(spec.totalToPay ?? "$1.280.100", 711.5, 476),
    t("Este documento está clasificado como PRIVADO", 360, 28),
  ];
  if (spec.pensionPeriod !== null) items.push(t(spec.pensionPeriod ?? "2026-01", 541, 476));
  return items;
}

function totalsPage(spec: DocSpec): PdfTextItem[] {
  const items = pageHeader(spec, 1);
  const sections: [string, number, number, string, number, number, number][] = [
    // título, y título, y encabezado, encabezado de cotización, centro, centro «Total a pagar», y de la primera fila
    ["TOTALES SALUD", 440, 431, "Cotización Obligatoria", 271.5, 681.5, 412],
    ["TOTALES PENSIÓN", 383, 372, "Cotización", 310.5, 683.5, 356],
    ["TOTALES RIESGOS LABORALES", 325, 316, "Cotización", 256.5, 678.5, 297],
    ["TOTALES CAJAS", 276, 263, "Valor Aporte", 535, 676.5, 249],
  ];
  const keys = ["health", "pension", "risk", "ccf"] as const;
  sections.forEach(([title, ty, hy, contribution, c1, c2, firstRow], i) => {
    items.push(t(title, 100, ty), t(contribution, c1, hy), t("Total a Pagar", c2, hy), t("Código", 55, hy));
    spec.administrators[keys[i]].forEach(([cot, pay], row) => {
      const y = firstRow - row * 10;
      items.push(t(`ADM${i}${row}`, 55, y), t("Administradora", 130, y), t("890000000-1", 214, y), t(money(cot), c1, y), t("0", 330, y), t("5", 560, y), t(money(pay), c2, y), t("2", 724, y));
    });
  });
  items.push(t("TOTALES PARAFISCALES", 136, 219), t("TOTALES POR SUBSISTEMA", 617, 219));
  const rows: [string, number, [number, number]][] = [
    ["Salud", 192, spec.totals.health],
    ["Pensión", 183, spec.totals.pension],
    ["Riesgos Laborales", 173, spec.totals.risk],
    ["CCF", 164, spec.totals.ccf],
    ["ESAP", 154, spec.totals.esap],
    ["ICBF", 144, spec.totals.icbf],
    ["MEN", 135, spec.totals.men],
    ["SENA", 125, spec.totals.sena],
  ];
  for (const [label, y, [antes, pagar]] of rows) items.push(t(label, 527, y), t("1", 594.5, y), t(money(antes), 659, y), t(money(pagar), 717, y));
  items.push(t("TOTALES", 525, 115), t("7", 594.5, 115), t(money(spec.grand[0]), 659, 115), t(money(spec.grand[1]), 717, 115));
  return items;
}

function detailPage(spec: DocSpec): PdfTextItem[] {
  const items = pageHeader(spec, 2);
  const omit = (name: string) => spec.omitHeader === name;
  items.push(t("DETALLE POR COTIZANTE", 59, 418), t("PENSIÓN", 334, 406), t("SALUD", 467, 406), t("RIESGOS LABORALES", 553, 406), t("CCF", 636.8, 406), t("PARAFISCALES", 728, 406));
  items.push(t("No.", 10, 385.2), t("Apellidos y Nombres", 81, 385.2), t("IBC AFP", 273, 385.2), t("Cotización", 305.7, 385.2), t("Cód. EPS", 438, 385.2), t("IBC EPS", 462, 385.2), t("Cotización /", 495.8, 387.4), t("IBC ARL", 541, 385.2), t("Cotización", 586, 385.2), t("IBC CCF", 628.6, 385.2), t("CCF", 607.3, 383), t("CCF", 664.6, 383));
  for (const [name, center] of [["SENA", 712.5], ["ICBF", 732.2], ["ESAP", 752], ["MEN", 771.9]] as const) if (!omit(name)) items.push(t(name, center, 383));
  for (const center of [289.1, 479, 557.7, 646.4]) if (!omit("Días")) items.push(rotated("Días", center, 382.3));
  spec.employees.forEach((e, index) => {
    const y = 362.2 - index * 12.9;
    const [type, number] = e.doc.split(" ");
    items.push(t(String(e.no), 10.4, y), t(type, 30.6, y + 2.3), t(number, 31.2, y - 2.2));
    e.name.forEach((line, i) => items.push(t(line, 80, y + 2.3 - i * 4.5)));
    items.push(t("1", 119.8, y), t("0", 128.3, y), t("S", 146.7, y), t("25-14", 252, y), t(money(e.ibc), 273.3, y), t(String(e.days), 289.7, y), t(money(e.pension), 306.3, y));
    (e.extras ?? [0, 0, 0, 0]).forEach((v, i) => items.push(t(money(v), [331.8, 357.8, 383.8, 411.4][i], y)));
    items.push(t("EPS005", 438.2, y), t(money(e.ibc), 462.8, y), t(String(e.days), 479.6, y), t(money(e.health), 496.2, y), t("14-11", 518.7, y), t(money(e.ibc), 541.3, y), t(String(e.days), 558, y), t("1", 568.4, y), t(money(e.risk), 586, y));
    items.push(t("CCF41", 607.3, y), t(money(e.ibc), 628.6, y), t(String(e.days), 647, y), t(money(e.ccf), 664.6, y), t("0", 689.2, y));
    for (const [key, center] of [["sena", 712.5], ["icbf", 732.3], ["esap", 752.1], ["men", 771.8]] as const) items.push(t(money(e[key] ?? 0), center, y));
  });
  return items;
}

export function miPlanillaDoc(spec: DocSpec): PdfDocumentText {
  return {
    pageCount: 2,
    pages: [
      { pageNumber: 1, width: 792, height: 612, items: totalsPage(spec) },
      { pageNumber: 2, width: 792, height: 612, items: detailPage(spec) },
    ],
  };
}

/** La planilla de referencia: 3 empleados, mora de $4.400, sin parafiscales. */
export const REFERENCE: DocSpec = {
  employees: [
    { no: 1, doc: "CC 1020713259", name: ["SAMPAYO BITAR SHADYA"], ibc: 1_750_905, days: 30, pension: 280_200, health: 70_100, risk: 9_200, ccf: 57_000 },
    { no: 2, doc: "CC 1111545619", name: ["CRUZ RODRIGUEZ GABRIEL", "ANDRES"], ibc: 1_750_905, days: 30, pension: 280_200, health: 70_100, risk: 9_200, ccf: 70_100 },
    { no: 3, doc: "CE 900754", name: ["ERICES AUAD FERNANDO", "ANDRES"], ibc: 1_750_905, days: 30, pension: 280_200, health: 70_100, risk: 9_200, ccf: 70_100 },
  ],
  totals: { health: [210_300, 211_100], pension: [840_600, 843_300], risk: [27_600, 27_700], ccf: [197_200, 198_000], sena: [0, 0], icbf: [0, 0], esap: [0, 0], men: [0, 0] },
  grand: [1_275_700, 1_280_100],
  administrators: {
    health: [[140_200, 140_700], [70_100, 70_400]],
    pension: [[560_400, 562_200], [280_200, 281_100]],
    risk: [[27_600, 27_700]],
    ccf: [[127_100, 127_600], [70_100, 70_400]],
  },
};
