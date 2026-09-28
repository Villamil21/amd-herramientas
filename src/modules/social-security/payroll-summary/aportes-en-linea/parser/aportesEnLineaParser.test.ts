import { describe, expect, it } from "vitest";
import type { PdfDocumentText, PdfPageText, PdfTextItem } from "../../../../bank-analysis/shared/pdf/pdfTypes";
import { StatementError } from "../../../../bank-analysis/shared/types";
import { formatPesos } from "../../../../../utils/format";
import { parsePesoAmount } from "../../shared/money";
import { buildPayrollSheets, suggestedPayrollExportName } from "../../shared/export/excelExport";
import { analyzeAportesEnLinea } from "../services/analysis";
import { MESSAGES, parseAportesEnLinea } from "./aportesEnLineaParser";

// ---------------------------------------------------------------------------
// PDF sintético con la geometría de la planilla real de Aportes en Línea:
// página horizontal de 1008 pt, letra de 4,5 pt en la tabla (~2,3 pt por
// carácter), importes alineados a la derecha, filas cada 14,5 pt y nombres
// partidos en dos líneas (la segunda 5,3 pt más abajo).
// ---------------------------------------------------------------------------

const CW = 2.3;
const t = (text: string, x: number, y: number, height = 4.5): PdfTextItem => ({ text, x, y, width: text.length * CW, height });
const r = (text: string, right: number, y: number) => t(text, right - text.length * CW, y);
const money = (n: number) => `$${n.toLocaleString("en-US")}`;

function generalBlock(topY: number, o: { period?: string; salud?: string; limit?: string; date?: string; value?: string } = {}): PdfTextItem[] {
  const y = topY;
  return [
    t("DATOS GENERALES DEL APORTANTE", 20, y + 38.7, 6),
    t("Identificación", 26.6, y + 28.3, 5.5),
    t("Razon Social", 114.6, y + 28.3, 5.5),
    t("NIT 900000001", 20, y + 12, 5),
    t("EMPRESA DE PRUEBA S.A.S.", 85.8, y + 12, 5),
    t("DATOS GENERALES DE LA LIQUIDACION", 20, y, 6),
    t("Periodo", 40.5, y - 10.3, 5.5),
    t("Clave", 133.9, y - 10.3, 5.5),
    t("Tipo", 214.8, y - 10.3, 5.5),
    t("Fecha", 285.5, y - 10.3, 5.5),
    t("Pago", 458.4, y - 10.3, 5.5),
    t("Pensión", 23.8, y - 20.8, 5.5),
    t("Salud", 59.3, y - 20.8, 5.5),
    t("Pago", 106, y - 20.8, 5.5),
    t("Planilla", 160.6, y - 20.8, 5.5),
    t("Planilla", 211, y - 20.8, 5.5),
    t("Limite", 258.3, y - 20.8, 5.5),
    t("Pago", 311.8, y - 20.8, 5.5),
    t("Banco", 390.5, y - 20.8, 5.5),
    t("Dias Mora", 461.4, y - 20.8, 5.5),
    t("Valor", 533.1, y - 20.8, 5.5),
    ...(o.period === "" ? [] : [t(o.period ?? "2026-03", 20, y - 30.6, 5)]),
    t(o.salud ?? "2026-04", 51.6, y - 30.6, 5),
    t("92657601", 84.7, y - 30.6, 5),
    t("9499368247", 143.2, y - 30.6, 5),
    t("E", 219.2, y - 30.6, 5),
    t(o.limit ?? "2026/04/15", 262.8, y - 30.6, 5),
    ...(o.date === "" ? [] : [t(o.date ?? "2026/04/20", 316.3, y - 30.6, 5)]),
    t("BANCOLOMBIA", 346.5, y - 30.6, 5),
    t("3", 490.9, y - 30.6, 5),
    ...(o.value === "" ? [] : [t(o.value ?? "$0", 557.6, y - 30.6, 5)]),
  ];
}

const HEADER_Y = 474.1;

function detailHeader(y = HEADER_Y, withTitle = true): PdfTextItem[] {
  return [
    ...(withTitle ? [t("LIQUIDACION DETALLADA DE APORTES", 19, y + 21.9, 6)] : []),
    t("EMPLEADO", 55.8, y + 10.5, 6),
    t("NOVEDADES", 186.6, y + 10.5, 6),
    t("PENSION", 315.2, y + 10.5, 6),
    t("SALUD", 406.9, y + 10.5, 6),
    t("CCF", 500, y + 10.5, 6),
    t("RIESGOS", 583.9, y + 10.5, 6),
    t("PARAFISCALES", 669.9, y + 10.5, 6),
    ...[
      ["No.", 21.2],
      ["Identificación", 42.1],
      ["Nombre", 94.2],
      ["Codigo", 284.3],
      ["Días", 301.2],
      ["IBC", 322.9],
      ["Aporte", 349.6],
      ["Codigo", 372.8],
      ["Dias", 389.7],
      ["IBC", 411.8],
      ["Aporte", 438.6],
      ["Codigo", 462.7],
      ["Días", 480.1],
      ["IBC", 501.8],
      ["Aporte", 528.6],
      ["Codigo", 552.7],
      ["Días", 570.1],
      ["IBC", 591.8],
      ["Aporte", 618.6],
      ["Días", 642.1],
      ["IBC", 663.8],
      ["Aporte", 690.6],
      ["Exonerado", 714.9],
      ["Total Aportes", 741.6],
    ].map(([text, x]) => t(text as string, x as number, y)),
    t("ing", 125.4, y - 5.3),
    t("ret", 134.7, y - 5.3),
    t("tde tae tdp tap", 143.6, y - 5.3),
    t("vsp", 181.2, y - 5.3),
    t("SENA e", 718.4, y - 5.3),
    t("ICBF", 721.7, y - 10.5),
  ];
}

interface Emp {
  doc: string;
  name: string[];
  days: number;
  ibc: number;
  pension: number;
  health: number;
  ccfIbc?: number;
  ccf: number;
  risk: number;
  total?: number;
  novelty?: boolean;
  /** Aporte de pensión y código de salud en un solo fragmento, como en el PDF real. */
  merged?: boolean;
}

const totalOf = (e: Emp) => e.total ?? e.pension + e.health + e.ccf + e.risk;

function employeeRow(e: Emp, no: number, y: number): PdfTextItem[] {
  const [docType, docNumber] = e.doc.split(" ");
  const d = String(e.days);
  return [
    t(String(no), 23.5 - (String(no).length - 1) * CW, y),
    t(docType, 32, y),
    t(docNumber, 49.2, y),
    ...e.name.map((line, i) => t(line, 80.9, y - i * 5.3)),
    ...(e.novelty ? [t("X", 127.1, y)] : []),
    t("230301", 283.2, y),
    t(d, 302.9, y),
    r(money(e.ibc), 340.8, y),
    ...(e.merged ? [t(`${money(e.pension)} EPS010`, 371.2 - money(e.pension).length * CW, y)] : [r(money(e.pension), 371.2, y), t("EPS010", 373.5, y)]),
    t(d, 391.5, y),
    r(money(e.ibc), 429.7, y),
    r(money(e.health), 459.9, y),
    t("CCF07", 465.5, y),
    t(d, 481.8, y),
    r(money(e.ccfIbc ?? e.ibc), 519.7, y),
    r(money(e.ccf), 549.9, y),
    t("14-11", 556.8, y),
    t(d, 571.8, y),
    r(money(e.ibc), 609.7, y),
    r(money(e.risk), 639.9, y),
    t(d, 643.8, y),
    t("$0", 676.9, y),
    t("$0", 707.2, y),
    t("Si", 724.2, y),
    r(money(totalOf(e)), 770.5, y),
  ];
}

function totalRow(emps: Emp[], y: number, declared = emps.length, total = emps.reduce((a, e) => a + totalOf(e), 0)): PdfTextItem[] {
  const sum = (f: (e: Emp) => number) => emps.reduce((a, e) => a + f(e), 0);
  return [
    t("Total", 19, y + 0.3, 5),
    t(`Afiliados( ${declared})`, 44.9, y + 0.3, 5),
    r(money(sum((e) => e.ibc)), 340.8, y),
    r(money(sum((e) => e.pension)), 371, y),
    r(money(sum((e) => e.ibc)), 429.7, y),
    r(money(sum((e) => e.health)), 460, y),
    r(money(sum((e) => e.ccfIbc ?? e.ibc)), 519.7, y),
    r(money(sum((e) => e.ccf)), 550, y),
    r(money(sum((e) => e.ibc)), 609.7, y),
    r(money(sum((e) => e.risk)), 639.9, y),
    t("$0", 676.9, y),
    t("$0", 705.7, y),
    r(money(total), 768.8, y),
  ];
}

const footer = (n: number, of: number) => t(`Página ${n} de ${of}`, 20, 9.3, 8);

function paymentSummaryPage(emps: Emp[], interest: number, o: { liquidated?: number; toPay?: number } = {}): PdfTextItem[] {
  const sum = (f: (e: Emp) => number) => emps.reduce((a, e) => a + f(e), 0);
  const liquidated = o.liquidated ?? sum(totalOf);
  const H = 479;
  const row = (label: string, y: number, vl: number, im: number, toPay: number, size = 6) => [
    t(label, 20, y, size),
    t(String(emps.length), 279.9, y, size),
    { text: money(vl), x: 351.5 - money(vl).length * 3.9, y, width: money(vl).length * 3.9, height: size },
    { text: money(im), x: 416.3 - money(im).length * 3, y, width: money(im).length * 3, height: size },
    t("$0", 748.9, y, size),
    { text: money(toPay), x: 819.9 - money(toPay).length * 3.9, y, width: money(toPay).length * 3.9, height: size },
  ];
  return [
    t("RESUMEN DE PAGO", 20, H + 12.3, 7),
    ...[
      ["RIESGO", 20, 23.4],
      ["CODIGO", 150.1, 25.3],
      ["NIT", 197.8, 10.9],
      ["DV", 227.7, 8.8],
      ["AFILIADOS", 249.4, 33.7],
      ["VALOR LIQUIDADO", 289.4, 59.7],
      ["INTERESES MORA", 358.3, 55.2],
      ["Fondo", 443.2, 20.2],
      ["Intereses de", 505.2, 40.1],
      ["Fondo", 581.3, 20.2],
      ["Intereses de", 636.3, 40.1],
      ["SALDOS E", 708.3, 30.9],
      ["VALOR A PAGAR", 763.3, 52.4],
    ].map(([text, x, width]) => ({ text: text as string, x: x as number, y: H, width: width as number, height: 7 })),
    { text: "Solidaridad", x: 436.1, y: H - 8.2, width: 36.4, height: 7 },
    ...row("AFP (ADMINISTRADORAS: 1)", 449.2, sum((e) => e.pension), 0, sum((e) => e.pension)),
    ...row("PORVENIR", 436.5, sum((e) => e.pension), 0, sum((e) => e.pension)),
    ...row("ARL (ADMINISTRADORAS: 1)", 423.7, sum((e) => e.risk), 0, sum((e) => e.risk)),
    ...row("CCF (ADMINISTRADORAS: 1)", 410.9, sum((e) => e.ccf), 0, sum((e) => e.ccf)),
    ...row("EPS (ADMINISTRADORAS: 1)", 398.2, sum((e) => e.health), 0, sum((e) => e.health)),
    ...row("TOTAL", 385.4, liquidated, interest, o.toPay ?? liquidated + interest, 7),
  ];
}

const page = (pageNumber: number, items: PdfTextItem[]): PdfPageText => ({ pageNumber, width: 1008, height: 612, items });
const docOf = (...pages: PdfPageText[]): PdfDocumentText => ({ pageCount: pages.length, pages });

const EMPS: Emp[] = [
  { doc: "CC 1192816998", name: ["ANGARITA LOPEZ", "RONALDO"], days: 30, ibc: 1_750_905, pension: 280_200, health: 70_100, ccf: 70_100, risk: 9_200, novelty: true },
  { doc: "CC 22517821", name: ["FONTALVO ALTAMAR", "YURLYS JOHANA"], days: 30, ibc: 1_750_905, ccfIbc: 1_400_000, pension: 280_200, health: 70_100, ccf: 56_000, risk: 9_200, merged: true },
  { doc: "CE 1129572599", name: ["MARTINEZ ORTIZ", "HUGO ALFREDO"], days: 29, ibc: 1_692_542, pension: 270_900, health: 67_800, ccf: 67_800, risk: 8_900 },
];

interface BuildOptions {
  interest?: number;
  declared?: number;
  total?: number;
  value?: string;
  withSummary?: boolean;
  summary?: { liquidated?: number; toPay?: number };
  general?: Parameters<typeof generalBlock>[1];
}

/** Planilla completa: detalle en la página 1 y Resumen de pago en la página 2. */
function planilla(emps: Emp[], o: BuildOptions = {}): PdfDocumentText {
  const interest = o.interest ?? 8_000;
  const total = o.total ?? emps.reduce((a, e) => a + totalOf(e), 0);
  const value = o.value ?? money(emps.reduce((a, e) => a + totalOf(e), 0) + interest);
  const rows = emps.flatMap((e, i) => employeeRow(e, i + 1, 454.3 - i * 14.5));
  const p1 = page(1, [
    t("Planilla Resumen", 256.8, 598, 12),
    ...generalBlock(537.6, { value, ...o.general }),
    ...detailHeader(),
    ...rows,
    ...totalRow(emps, 454.3 - emps.length * 14.5 + 0.1, o.declared, total),
    footer(1, 2),
  ]);
  const p2 = page(2, [t("Planilla Resumen", 256.8, 598, 12), ...generalBlock(537.2, { value, ...o.general }), ...(o.withSummary === false ? [] : paymentSummaryPage(emps, interest, o.summary)), footer(2, 2)]);
  return docOf(p1, p2);
}

const expectError = (fn: () => unknown, message: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(StatementError);
    expect((e as Error).message).toBe(message);
    return;
  }
  throw new Error("se esperaba un error");
};

describe("importes de planilla", () => {
  it("interpreta el formato del PDF sin decimales", () => {
    expect(parsePesoAmount("$1,750,905")).toBe(1_750_905);
    expect(parsePesoAmount("$0")).toBe(0);
    expect(parsePesoAmount("$9,200")).toBe(9_200);
    expect(parsePesoAmount("-$1,200")).toBe(-1_200);
    expect(parsePesoAmount("$1,75,905")).toBeNull();
    expect(parsePesoAmount("1,750,905")).toBeNull();
    expect(parsePesoAmount("EPS010")).toBeNull();
  });

  it("muestra el formato colombiano", () => {
    expect(formatPesos(1_750_905)).toBe("$1.750.905");
    expect(formatPesos(280_200)).toBe("$280.200");
    expect(formatPesos(9_200)).toBe("$9.200");
    expect(formatPesos(0)).toBe("$0");
    expect(formatPesos(-8_000)).toBe("-$8.000");
  });
});

describe("parser Aportes en Línea", () => {
  it("extrae datos generales, empleados y totales", () => {
    const { summary: s, validation } = analyzeAportesEnLinea(planilla(EMPS));
    expect(s.period).toBe("2026-03"); // Pensión, no Salud (2026-04)
    expect(s.paymentDate).toBe("2026/04/20"); // Fecha Pago, no Límite
    expect(s.paymentAmount).toBe(1_268_500);
    expect(s.totalContributions).toBe(1_260_500);
    expect(s.lateInterest).toBe(8_000);
    expect(s.employeeCount).toBe(3);
    expect(s.employees[0]).toEqual({
      rowNumber: 1,
      identification: "CC 1192816998",
      name: "ANGARITA LOPEZ RONALDO",
      pensionDays: 30,
      pensionIbc: 1_750_905,
      pensionContribution: 280_200,
      healthContribution: 70_100,
      ccfContribution: 70_100,
      riskContribution: 9_200,
      totalContribution: 429_600,
      otherContribution: 0,
      page: 1,
    });
    // Aporte de pensión pegado al código de salud en el mismo fragmento; CCF con IBC distinto.
    expect(s.employees[1]).toMatchObject({ name: "FONTALVO ALTAMAR YURLYS JOHANA", pensionContribution: 280_200, healthContribution: 70_100, ccfContribution: 56_000, totalContribution: 415_500 });
    expect(s.employees[2]).toMatchObject({ identification: "CE 1129572599", pensionDays: 29, pensionIbc: 1_692_542 });
    expect(s.joinedNames).toBe(3);
    expect(s.issues).toEqual([]);
    expect(validation.validated).toBe(true);
  });

  it("procesa muchas filas, números de fila de dos dígitos, nombres de 1 y 3 líneas e importes grandes", () => {
    const emps: Emp[] = Array.from({ length: 24 }, (_, i) => ({
      doc: `CC ${1000 + i}`,
      name: i === 5 ? ["PEREZ"] : i === 7 ? ["DE LA ESPRIELLA", "GOMEZ MARIA", "DEL CARMEN"] : [`APELLIDO${String.fromCharCode(65 + i)} UNO`, "NOMBRE"],
      days: i === 3 ? 15 : 30,
      ibc: i === 9 ? 25_000_000 : 1_423_500,
      pension: i === 9 ? 4_000_000 : 227_800,
      health: i === 9 ? 1_000_000 : 0,
      ccf: 56_900,
      risk: 7_500,
    }));
    const s = parseAportesEnLinea(planilla(emps));
    expect(s.employeeCount).toBe(24);
    expect(s.employees.map((e) => e.rowNumber)).toEqual(emps.map((_, i) => i + 1));
    expect(s.employees[5].name).toBe("PEREZ");
    expect(s.employees[7].name).toBe("DE LA ESPRIELLA GOMEZ MARIA DEL CARMEN");
    expect(s.employees[3].pensionDays).toBe(15);
    expect(s.employees[9]).toMatchObject({ pensionIbc: 25_000_000, pensionContribution: 4_000_000, healthContribution: 1_000_000 });
    expect(s.employees[23].name).toBe("APELLIDOX UNO NOMBRE");
    expect(s.issues).toEqual([]);
    expect(analyzeAportesEnLinea(planilla(emps)).validation.validated).toBe(true);
  });

  it("une el detalle que continúa en otra página", () => {
    const emps = [...EMPS, { ...EMPS[0], doc: "CC 55", name: ["RUIZ CASSIANI", "RAYNEL RAFAEL"] }];
    const p1 = page(1, [...generalBlock(537.6, { value: "$1,698,500" }), ...detailHeader(), ...emps.slice(0, 2).flatMap((e, i) => employeeRow(e, i + 1, 454.3 - i * 14.5)), footer(1, 3)]);
    const p2 = page(2, [
      ...generalBlock(537.6, { value: "$1,698,500" }),
      ...detailHeader(HEADER_Y, false),
      ...emps.slice(2).flatMap((e, i) => employeeRow(e, i + 3, 454.3 - i * 14.5)),
      ...totalRow(emps, 454.3 - 2 * 14.5 + 0.1),
      footer(2, 3),
    ]);
    const p3 = page(3, [...generalBlock(537.6, { value: "$1,698,500" }), ...paymentSummaryPage(emps, 8_400), footer(3, 3)]);
    const { summary: s, validation } = analyzeAportesEnLinea(docOf(p1, p2, p3));
    expect(s.employees.map((e) => [e.rowNumber, e.page, e.name])).toEqual([
      [1, 1, "ANGARITA LOPEZ RONALDO"],
      [2, 1, "FONTALVO ALTAMAR YURLYS JOHANA"],
      [3, 2, "MARTINEZ ORTIZ HUGO ALFREDO"],
      [4, 2, "RUIZ CASSIANI RAYNEL RAFAEL"],
    ]);
    expect(s.lateInterest).toBe(8_400);
    expect(validation.validated).toBe(true);
  });

  it("procesa una planilla de 1 página con rótulos y códigos partidos en dos líneas", () => {
    // Geometría de una planilla real de 1 página: todas las secciones en la
    // misma página, «Codig» / «o» en el encabezado, códigos «23030» / «1» y
    // «EPS03» / «7», columna Tarifa en Riesgos y un documento PT.
    const H = 467.7;
    const header: PdfTextItem[] = [
      t("LIQUIDACION DETALLADA DE APORTES", 23.4, 488.8, 6),
      ...[["EMPLEADO", 50.6], ["NOVEDADES", 148.7], ["PENSION", 251.6], ["SALUD", 339], ["CCF", 427.8], ["RIESGOS", 514.4], ["PARAFISCALES", 604.8]].map(([x, px]) => t(x as string, px as number, 478.3, 6)),
      ...[["Codig", 223.1], ["Días", 236.6], ["Codig", 307.1], ["Dias", 321.4], ["Codigo Días", 391.5], ["Codig", 477.3], ["Días", 490.9], ["Tarifa", 532.1], ["Días", 577], ["Exonerado", 648.8], ["Total Aportes", 677.7]].map(([x, px]) => t(x as string, px as number, H)),
      ...[["No", 25.1], ["Identificación", 36.8], ["Nombre", 80.9], ["IBC", 257.1], ["Aporte", 283], ["IBC", 342.3], ["Aporte", 368.2], ["IBC", 427.6], ["Aporte", 453.5], ["IBC", 511.5], ["Aporte", 553.5], ["IBC", 597.5], ["Aporte", 623.4]].map(([x, px]) => t(x as string, px as number, H - 0.5, 5)),
      ...[["in", 110], ["re", 115.8], ["td", 122.2], ["vi", 217]].map(([x, px]) => t(x as string, px as number, H - 2.8)),
      ...[227.4, 311.4, 481.6].map((x) => t("o", x, H - 5.3)),
      t("SENA e ICBF", 647.9, H - 5.3),
      t(".", 27.2, H - 6.2, 5),
      ...[["g", 110.8], ["t", 117.1], ["p", 217.5]].map(([x, px]) => t(x as string, px as number, H - 8.1)),
    ];
    const row = (no: number, doc: string, name: string[], y: number): PdfTextItem[] => {
      const [docType, docNumber] = doc.split(" ");
      return [
        t(String(no), 26.9, y),
        t(docType, 34.3, y),
        t(docNumber, 43.3, y),
        ...name.map((line, i) => t(line, 70.9, y - i * 5.3)),
        t("X", 150.2, y),
        t("23030", 222.3, y),
        t("1", 222.3, y - 5.3),
        t("30", 238.2, y),
        r("$1,750,905", 275.1, y),
        t("$280,200 EPS03", 286.8, y),
        t("7", 317, y - 5.3),
        t("30", 323.1, y),
        r("$1,750,905", 360.4, y),
        r("$70,100", 390.1, y),
        t("CCF57", 393, y),
        t("30", 408.7, y),
        r("$1,750,905", 445.6, y),
        r("$70,100", 475.4, y),
        t("14-11", 478.2, y),
        t("30", 492.6, y),
        t("$1,750,905 0.522%", 507.3, y),
        r("$9,200", 575.4, y),
        t("30", 578.7, y),
        t("$0", 610.8, y),
        t("$0", 640.7, y),
        t("Si", 658.3, y),
        r("$429,600", 700.4, y),
      ];
    };
    const summaryItems = paymentSummaryPage(
      Array.from({ length: 3 }, () => ({ ...EMPS[0], total: 429_600 })),
      11_700,
    ).map((i) => ({ ...i, y: i.y - 110 }));
    const d = docOf(
      page(1, [
        ...generalBlock(530.7, { period: "2026-01", salud: "2026-02", date: "2026/02/27", value: "$1,300,500" }),
        ...header,
        ...row(1, "CC 900001", ["APELLIDO UNO", "NOMBRE"], 447.7),
        ...row(2, "CC 900002", ["APELLIDO", "DOS NOMBRE", "SEGUNDO"], 433.2),
        ...row(3, "PT 900003", ["APELLIDO TRES", "OTRO NOMBRE"], 413.4),
        t("Total", 23.4, 399.2, 5),
        t("Afiliados( 3)", 49.3, 399.2, 5),
        r("$5,252,715", 275.1, 398.9),
        r("$840,600", 304.9, 398.9),
        r("$210,300", 390.2, 398.9),
        r("$210,300", 475.4, 398.9),
        r("$27,600", 575.4, 398.9),
        r("$1,288,800", 702.4, 398.9),
        ...summaryItems,
        t("Página 1 de 1", 24.4, 10, 8),
      ]),
    );
    const { summary: s, validation } = analyzeAportesEnLinea(d);
    expect(s.issues).toEqual([]);
    expect(s.employees.map((e) => [e.identification, e.name])).toEqual([
      ["CC 900001", "APELLIDO UNO NOMBRE"],
      ["CC 900002", "APELLIDO DOS NOMBRE SEGUNDO"],
      ["PT 900003", "APELLIDO TRES OTRO NOMBRE"],
    ]);
    for (const e of s.employees) {
      expect(e).toMatchObject({ pensionDays: 30, pensionIbc: 1_750_905, pensionContribution: 280_200, healthContribution: 70_100, ccfContribution: 70_100, riskContribution: 9_200, totalContribution: 429_600 });
    }
    expect([s.period, s.paymentDate, s.paymentAmount, s.totalContributions, s.lateInterest, s.employeeCount]).toEqual(["2026-01", "2026/02/27", 1_300_500, 1_288_800, 11_700, 3]);
    expect(s.paymentSummary).toMatchObject({ liquidated: 1_288_800, lateInterest: 11_700, toPay: 1_300_500 });
    expect(validation.validated).toBe(true);
  });

  it("rechaza un PDF que no es de Aportes en Línea sin inventar datos", () => {
    const bank = docOf(page(1, [t("EXTRACTO DE CUENTA DE AHORROS", 20, 700, 10), t("SALDO ANTERIOR", 20, 680, 8), t("$1,000", 200, 680, 8)]));
    expectError(() => parseAportesEnLinea(bank), MESSAGES.format);
  });

  it("informa si falta la tabla de liquidación detallada", () => {
    expectError(() => parseAportesEnLinea(docOf(page(1, [...generalBlock(537.6, { value: "$10,000" })]))), MESSAGES.detail);
  });

  it("distingue la tabla encontrada cuyas filas no se pueden reconstruir", () => {
    expectError(() => parseAportesEnLinea(docOf(page(1, [...generalBlock(537.6, { value: "$10,000" }), t("LIQUIDACION DETALLADA DE APORTES", 19, 496, 6)]))), MESSAGES.detailRows);
  });

  it("informa si no hay empleados", () => {
    const d = docOf(page(1, [...generalBlock(537.6, { value: "$10,000" }), ...detailHeader(), ...totalRow([], 440)]));
    expectError(() => parseAportesEnLinea(d), MESSAGES.noEmployees);
  });

  it("informa si falta el valor pagado, el periodo o la fecha de pago", () => {
    expectError(() => parseAportesEnLinea(planilla(EMPS, { value: "" })), MESSAGES.payment);
    expectError(() => parseAportesEnLinea(planilla(EMPS, { general: { period: "" } })), MESSAGES.period);
    expectError(() => parseAportesEnLinea(planilla(EMPS, { general: { date: "" } })), MESSAGES.paymentDate);
  });
});

describe("validaciones", () => {
  const failed = (d: PdfDocumentText) =>
    analyzeAportesEnLinea(d)
      .validation.checks.filter((c) => c.status !== "ok")
      .map((c) => c.id);

  it("advierte si la suma por empleado no coincide con el total, sin corregir valores", () => {
    const a = analyzeAportesEnLinea(planilla(EMPS, { total: 1_300_000, summary: { liquidated: 1_300_000 } }));
    expect(a.validation.validated).toBe(false);
    expect(a.validation.checks.find((c) => c.id === "employee-sum")).toMatchObject({
      status: "failed",
      detail: "La suma de los aportes por empleado ($1.260.500) no coincide con el total de la planilla ($1.300.000).",
    });
    expect(a.summary.totalContributions).toBe(1_300_000);
    expect(a.summary.employees.map((e) => e.totalContribution)).toEqual([429_600, 415_500, 415_400]);
  });

  it("advierte si Total Afiliados no coincide con los empleados extraídos", () => {
    expect(failed(planilla(EMPS, { declared: 4 }))).toEqual(["employee-count"]);
  });

  it("indica cuántas filas detectadas no se pudieron interpretar", () => {
    const emps = [EMPS[0], { ...EMPS[1], doc: "CC SINNUMERO" }, EMPS[2]];
    const a = analyzeAportesEnLinea(planilla(emps));
    expect(a.summary.employeeCount).toBe(2);
    expect(a.validation.checks.find((c) => c.id === "issues")?.detail).toBe("Se detectaron 3 empleados, pero 1 fila(s) no pudieron interpretarse correctamente.");
  });

  it("advierte si una fila no suma su Total Aportes", () => {
    const emps = [EMPS[0], { ...EMPS[1], total: 400_000 }, EMPS[2]];
    expect(failed(planilla(emps))).toEqual(["row-sums"]);
  });

  it("advierte si los intereses calculados no coinciden con el Resumen de pago", () => {
    const d = planilla(EMPS, { interest: 8_000, summary: { toPay: 1_270_500 } });
    // Valor pagado 1.268.500 − 1.260.500 = 8.000, pero el resumen trae valor a pagar 1.270.500.
    expect(failed(d)).toEqual(["payment-summary"]);
  });

  it("sin Resumen de pago no se da por validado", () => {
    const a = analyzeAportesEnLinea(planilla(EMPS, { withSummary: false }));
    expect(a.validation.validated).toBe(false);
    expect(a.validation.checks.filter((c) => c.status === "unavailable").map((c) => c.id)).toEqual(["payment-summary", "late-interest"]);
    expect(a.summary.lateInterest).toBe(8_000);
  });
});

describe("exportación", () => {
  it("arma las hojas Resumen y Empleados con números, no textos", () => {
    const s = parseAportesEnLinea(planilla(EMPS));
    const [summary, employees] = buildPayrollSheets(s);
    expect(summary.columns.map((c) => c.header)).toEqual(["Periodo", "Fecha", "Pago", "Total Aportes", "Intereses de Mora", "Cantidad de Empleados"]);
    expect(summary.rows).toEqual([["2026-03", "2026/04/20", 1_268_500, 1_260_500, 8_000, 3]]);
    expect(employees.columns.map((c) => c.header)).toEqual(["Empleado", "Nombre", "Pensión Días", "Pensión IBC", "Pensión Aporte", "Salud Aporte", "CCF Aporte", "Riesgos Aporte", "Total Aportes"]);
    expect(employees.rows[0]).toEqual(["CC 1192816998", "ANGARITA LOPEZ RONALDO", 30, 1_750_905, 280_200, 70_100, 70_100, 9_200, 429_600]);
    expect(employees.rows).toHaveLength(3);
    expect(suggestedPayrollExportName(s)).toBe("Resumen_Planilla_AportesEnLinea_2026-03");
  });
});
