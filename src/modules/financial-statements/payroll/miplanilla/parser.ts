import type { PdfDocumentText, PdfPageText, PdfTextItem } from "../../../bank-analysis/shared/pdf/pdfTypes";
import { StatementError } from "../../../bank-analysis/shared/types";
import { PARAFISCALS, type AdministratorSums, type MiPlanillaEmployee, type MiPlanillaIssue, type MiPlanillaSummary, type MiPlanillaTotals, type Parafiscal, type Subsystem, type SubsystemTotal } from "./types";

/**
 * Parser propio de MiPlanilla («Planilla Integrada de Autoliquidación de Aportes»). No comparte reglas con
 * el de Aportes en Línea: este PDF es un formulario con columnas fijas, así que cada valor se lee por la
 * posición de su encabezado (centro de la columna), no por el orden del texto.
 *
 * Zonas: datos del aportante y de la planilla (arriba), totales por subsistema (salud, pensión, riesgos,
 * cajas, parafiscales) y el detalle por cotizante (una fila por empleado; el nombre puede ocupar 2-3 líneas).
 */

const cx = (i: PdfTextItem) => i.x + i.width / 2;
const MONEY = /^\$?\s*\d[\d.,]*$/;
const isMoney = (i: PdfTextItem) => MONEY.test(i.text.trim());
/** Pesos enteros: «1.750.905», «$5,252,715», «$1.280.100». La PILA no tiene decimales. */
const toPesos = (text: string) => Number(text.replace(/\D/g, ""));

interface Row {
  y: number;
  items: PdfTextItem[];
}

function rowsOf(items: PdfTextItem[], tolerance = 2.6): Row[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Row[] = [];
  for (const item of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - item.y) <= tolerance) last.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

const find = (items: PdfTextItem[], re: RegExp) => items.find((i) => re.test(i.text.trim()));
const nearest = <T extends PdfTextItem>(list: T[], center: number, maxDistance: number): T | undefined =>
  list.filter((i) => Math.abs(cx(i) - center) <= maxDistance).sort((a, b) => Math.abs(cx(a) - center) - Math.abs(cx(b) - center))[0];

// ---------------------------------------------------------------------------
// Datos del aportante y de la planilla
// ---------------------------------------------------------------------------

interface Header {
  employerNit?: string;
  employerDv?: string;
  employerName?: string;
  planillaNumber?: string;
  paymentDate?: string;
  pensionPeriod?: string;
  healthPeriod?: string;
  planillaType?: string;
  declaredEmployees?: number;
  totalPayroll?: number;
  totalToPay?: number;
}

function parseHeader(page: PdfPageText): Header {
  const items = page.items;
  const out: Header = {};
  // El NIT del aportante está en la fila de datos del aportante (entre «Nombre aportante» y «Forma presentación»);
  // las administradoras de más abajo también muestran NIT con dígito de verificación.
  const nameTop = find(items, /^NOMBRE APORTANTE$/);
  const formTop = find(items, /^FORMA PRESENTACI[ÓO]N$/);
  const nitItem = items.find((i) => /^\d{5,12}-\d$/.test(i.text.trim()) && (!nameTop || i.y < nameTop.y - 3) && (!formTop || i.y > formTop.y + 3));
  if (nitItem) {
    const [nit, dv] = nitItem.text.trim().split("-");
    out.employerNit = nit;
    out.employerDv = dv;
    const row = items.filter((i) => Math.abs(i.y - nitItem.y) <= 2.6);
    const nameHeader = find(items, /^NOMBRE APORTANTE$/);
    const addressHeader = find(items, /^DIRECCI[ÓO]N$/);
    if (nameHeader && addressHeader) {
      // La razón social queda centrada bajo su encabezado: se toma lo que está más cerca de él que del de la dirección.
      const limit = (cx(nameHeader) + cx(addressHeader)) / 2;
      const name = row.filter((i) => cx(i) >= cx(nameHeader) - 45 && cx(i) < limit && !isMoney(i)).sort((a, b) => a.x - b.x).map((i) => i.text.trim()).join(" ");
      out.employerName = name || undefined;
    }
    // Datos de la planilla: número, fecha de pago y cantidad de empleados, por columna.
    const numberHeader = items.filter((i) => /^N[ÚU]MERO$/.test(i.text.trim())).sort((a, b) => b.x - a.x)[0];
    if (numberHeader) {
      const n = nearest(row.filter((i) => /^\d{5,}$/.test(i.text.trim())), cx(numberHeader), 16);
      out.planillaNumber = n?.text.trim();
    }
    const dateHeader = find(items, /^FECHA PAGO$/);
    if (dateHeader) {
      const d = nearest(row.filter((i) => /^\d{2}\/\d{2}\/\d{4}$/.test(i.text.trim())), cx(dateHeader), 22);
      if (d) {
        const [dd, mm, yyyy] = d.text.trim().split("/");
        out.paymentDate = `${yyyy}-${mm}-${dd}`;
      }
    }
    const employeesHeader = find(items, /^EMPLEADOS$/);
    if (employeesHeader) {
      // La cantidad se imprime en un tipo más pequeño y queda unos puntos más arriba que el resto de la fila.
      const e = nearest(items.filter((i) => i.y >= nitItem.y - 3 && i.y <= nitItem.y + 8 && /^\d{1,5}$/.test(i.text.trim())), cx(employeesHeader), 14);
      if (e) out.declaredEmployees = Number(e.text.trim());
    }
  }
  // Períodos, tipo y totales: están en la fila de abajo, bajo sus encabezados.
  const pensionHeader = find(items, /^PERIODO PENSI[ÓO]N$/);
  const healthHeader = find(items, /^PERIODO SALUD$/);
  const periodRow = rowsOf(items).find((r) => r.items.filter((i) => /^\d{4}-\d{2}$/.test(i.text.trim())).length >= 1 && pensionHeader && r.y < pensionHeader.y - 3 && r.y > pensionHeader.y - 30);
  if (periodRow && pensionHeader) {
    const periods = periodRow.items.filter((i) => /^\d{4}-\d{2}$/.test(i.text.trim()));
    out.pensionPeriod = nearest(periods, cx(pensionHeader), 14)?.text.trim();
    if (healthHeader) out.healthPeriod = nearest(periods, cx(healthHeader), 14)?.text.trim();
    const typeHeader = find(items, /^TIPO PLANILLA$/);
    if (typeHeader) out.planillaType = nearest(periodRow.items.filter((i) => /^[A-Z]{1,2}$/.test(i.text.trim())), cx(typeHeader), 14)?.text.trim();
    const payrollHeader = find(items, /^TOTAL N[ÓO]MINA$/);
    const payHeader = find(items, /^TOTAL A PAGAR$/);
    const money = periodRow.items.filter((i) => i.text.trim().startsWith("$"));
    if (payrollHeader) {
      const m = nearest(money, cx(payrollHeader), 18);
      if (m) out.totalPayroll = toPesos(m.text);
    }
    if (payHeader) {
      const m = nearest(money, cx(payHeader), 18);
      if (m) out.totalToPay = toPesos(m.text);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Totales por subsistema
// ---------------------------------------------------------------------------

const TITLES: { key: Subsystem | "parafiscales" | "summary"; re: RegExp }[] = [
  { key: "health", re: /^TOTALES SALUD$/i },
  { key: "pension", re: /^TOTALES PENSI[ÓO]N$/i },
  { key: "risk", re: /^TOTALES RIESGOS LABORALES$/i },
  { key: "ccf", re: /^TOTALES CAJAS/i },
  { key: "parafiscales", re: /^TOTALES PARAFISCALES$/i },
  { key: "summary", re: /^TOTALES POR SUBSISTEMA/i },
];

const CONTRIBUTION_HEADER: Record<Subsystem, RegExp> = {
  health: /^Cotizaci[óo]n Obligatoria$/i,
  pension: /^Cotizaci[óo]n$/i,
  risk: /^Cotizaci[óo]n$/i,
  ccf: /^Valor Aporte$/i,
};

function readAdministrators(band: PdfTextItem[], subsystem: Subsystem): AdministratorSums {
  const headers = band.filter((i) => !isMoney(i));
  const contributionHeader = headers.filter((i) => CONTRIBUTION_HEADER[subsystem].test(i.text.trim())).sort((a, b) => a.x - b.x)[0];
  const payHeader = headers.filter((i) => /^Total a Pagar$/i.test(i.text.trim())).sort((a, b) => a.x - b.x)[0];
  const sums: AdministratorSums = { rows: 0, entities: [] };
  if (!contributionHeader) return sums;
  for (const row of rowsOf(band)) {
    // Fila de administradora: un código a la izquierda y varias cifras a la derecha.
    const code = row.items.find((i) => i.x < 70);
    const values = row.items.filter((i) => i.x >= 70 && isMoney(i));
    if (!code || values.length < 3) continue;
    const contribution = nearest(values, cx(contributionHeader), 14);
    if (!contribution) continue;
    sums.rows += 1;
    sums.contribution = (sums.contribution ?? 0) + toPesos(contribution.text);
    // Nombre y NIT («800251440-6») de la administradora: solo su valor antes de mora, sin intereses ni «total a pagar».
    const nitItem = row.items.find((i) => /^\d{5,12}-\d$/.test(i.text.trim()));
    if (nitItem) {
      const name = row.items
        .filter((i) => i !== code && i !== nitItem && i.x > code.x + 2 && i.x < nitItem.x - 1 && !isMoney(i))
        .map((i) => i.text.trim())
        .join(" ");
      const [nit, dv] = nitItem.text.trim().split("-");
      sums.entities!.push({ code: code.text.trim(), name: name.replace(/\s+/g, " ").trim(), nit, dv, contribution: toPesos(contribution.text) });
    }
    const pay = payHeader ? nearest(values, cx(payHeader), 14) : undefined;
    if (pay) sums.toPay = (sums.toPay ?? 0) + toPesos(pay.text);
  }
  return sums;
}

const LABEL_TO_KEY: [RegExp, Subsystem | Parafiscal | "grand"][] = [
  [/^Salud$/i, "health"],
  [/^Pensi[óo]n$/i, "pension"],
  [/^Riesgos Laborales$/i, "risk"],
  [/^CCF$/i, "ccf"],
  [/^SENA$/, "sena"],
  [/^ICBF$/, "icbf"],
  [/^ESAP$/, "esap"],
  [/^MEN$/, "men"],
  [/^TOTALES$/i, "grand"],
];

/** Tabla «Totales por subsistema» (cuadro de la derecha): No. de administradoras, valor antes de mora y total a pagar. */
function readSubsystemTable(items: PdfTextItem[], totals: MiPlanillaTotals) {
  const labels = items.filter((i) => i.x >= 495 && LABEL_TO_KEY.some(([re]) => re.test(i.text.trim())));
  for (const label of labels) {
    const key = LABEL_TO_KEY.find(([re]) => re.test(label.text.trim()))![1];
    const values = items.filter((i) => Math.abs(i.y - label.y) <= 2.6 && i.x > label.x + label.width && isMoney(i)).sort((a, b) => a.x - b.x);
    if (values.length < 3) continue;
    const entry: SubsystemTotal = { administrators: toPesos(values[0].text), contribution: toPesos(values[1].text), toPay: toPesos(values[2].text) };
    if (key === "grand") totals.grand = entry;
    else if ((PARAFISCALS as string[]).includes(key)) totals.parafiscales[key as Parafiscal] = entry;
    else totals.subsystems[key as Subsystem] = entry;
  }
}

function parseTotals(pages: PdfPageText[]): { totals: MiPlanillaTotals; administrators: Partial<Record<Subsystem, AdministratorSums>> } {
  const totals: MiPlanillaTotals = { subsystems: {}, parafiscales: {} };
  const administrators: Partial<Record<Subsystem, AdministratorSums>> = {};
  for (const page of pages) {
    const titles = TITLES.flatMap((t) => {
      const item = find(page.items, t.re);
      return item ? [{ key: t.key, item }] : [];
    }).sort((a, b) => b.item.y - a.item.y);
    titles.forEach((title, index) => {
      const below = titles.slice(index + 1).find((t) => t.item.y < title.item.y - 1);
      const bottom = below ? below.item.y : 50;
      const band = page.items.filter((i) => i.y < title.item.y - 1 && i.y > bottom - 0.5);
      if (title.key === "summary") readSubsystemTable(band, totals);
      else if (title.key !== "parafiscales") {
        const sums = readAdministrators(band.filter((i) => i.x < 760), title.key);
        if (sums.rows) administrators[title.key] = sums;
      }
    });
    // La tabla del cuadro de la derecha puede compartir fila con «Totales parafiscales»: se lee entera.
    const summary = titles.find((t) => t.key === "summary");
    if (summary) readSubsystemTable(page.items.filter((i) => i.y < summary.item.y - 1), totals);
  }
  return { totals, administrators };
}

// ---------------------------------------------------------------------------
// Detalle por cotizante
// ---------------------------------------------------------------------------

interface Columns {
  ibcPension: number;
  /** Centros de las columnas IBC de salud, riesgos y CCF (no siempre se encuentran: los datos quedan sin leer). */
  ibcOthers?: { health?: number; risk?: number; ccf?: number };
  /** Centros de las columnas de código de AFP, EPS, ARL y CCF. */
  codes?: { afp?: number; eps?: number; arl?: number; ccf?: number };
  /** Columnas de novedad (rótulos girados) con el centro de cada una. */
  novelties?: { code: string; center: number }[];
  /** Columnas de aportes voluntarios y FSP de pensión, con su centro. */
  extrasColumns?: { voluntaryAffiliate?: number; voluntaryEmployer?: number; fspSolidarity?: number; fspSubsistence?: number };
  days: number[];
  contribution: number[];
  ccf: number;
  parafiscales: Record<Parafiscal, number>;
  /** Rango de las columnas de aportes voluntarios y FSP de pensión. */
  extras: [number, number];
}

function readColumns(header: PdfTextItem[]): Columns | string {
  const ibc = find(header, /^IBC AFP$/);
  const days = header.filter((i) => /^D[ií]as$/.test(i.text.trim())).sort((a, b) => a.x - b.x);
  const contribution = header.filter((i) => /^Cotizaci[óo]n(?:\s*\/)?$/.test(i.text.trim())).sort((a, b) => a.x - b.x);
  const ccfHeaders = header.filter((i) => /^CCF$/.test(i.text.trim())).sort((a, b) => b.y - a.y);
  // «CCF» aparece también como título del grupo (más arriba): las columnas son las dos de abajo.
  const ccfColumns = (ccfHeaders.length > 2 ? ccfHeaders.slice(1) : ccfHeaders).sort((a, b) => a.x - b.x);
  const parafiscales = {} as Record<Parafiscal, number>;
  for (const p of PARAFISCALS) {
    const h = find(header, new RegExp(`^${p.toUpperCase()}$`));
    if (!h) return `No se encontró la columna ${p.toUpperCase()} del detalle por cotizante.`;
    parafiscales[p] = cx(h);
  }
  const epsCode = find(header, /^C[óo]d\. EPS$/);
  if (!ibc) return "No se encontró la columna IBC AFP (pensión) del detalle por cotizante.";
  if (days.length < 4) return `Se esperaban 4 columnas «Días» (pensión, salud, riesgos y CCF) y se encontraron ${days.length}.`;
  if (contribution.length < 3) return `Se esperaban 3 columnas «Cotización» (pensión, salud y riesgos) y se encontraron ${contribution.length}.`;
  if (ccfColumns.length < 2) return "No se encontró la columna de aporte CCF del detalle por cotizante.";
  if (!epsCode) return "No se encontró la columna Cód. EPS del detalle por cotizante.";
  const center = (i: PdfTextItem | undefined) => (i ? cx(i) : undefined);
  const novelties = header
    .filter((i) => i.rotated && NOVELTY_CODES.has(i.text.trim().toLowerCase()))
    .map((i) => ({ code: i.text.trim().toLowerCase(), center: cx(i) }));
  // Rótulos de la zona de pensión extra: «Aporte Voluntario Afiliado / Aportante» y «Aporte FSP — Solidaridad / Subsistencia».
  const zone = header.filter((i) => !i.rotated && cx(i) > cx(contribution[0]) + 8 && cx(i) < epsCode.x - 4);
  const byLabel = (re: RegExp) => zone.find((i) => re.test(i.text.trim()));
  return {
    ibcPension: cx(ibc),
    ibcOthers: { health: center(find(header, /^IBC EPS$/)), risk: center(find(header, /^IBC ARL$/)), ccf: center(find(header, /^IBC CCF$/)) },
    codes: {
      afp: center(header.find((i) => /^AFP$/.test(i.text.trim()) && cx(i) < epsCode.x - 30 && cx(i) > 200)),
      eps: cx(epsCode),
      arl: center(header.find((i) => /^ARL$/.test(i.text.trim()) && cx(i) > 480 && cx(i) < 560)),
      ccf: center(find(header, /^C[óo]digo$/)),
    },
    novelties,
    extrasColumns: {
      voluntaryAffiliate: center(byLabel(/^Afiliado$/i)),
      voluntaryEmployer: center(byLabel(/^Aportante$/i)),
      fspSolidarity: center(byLabel(/^solidaridad$/i)),
      fspSubsistence: center(byLabel(/^subsistencia$/i)),
    },
    days: days.slice(0, 4).map(cx),
    contribution: contribution.slice(0, 3).map(cx),
    ccf: cx(ccfColumns[ccfColumns.length - 1]),
    parafiscales,
    extras: [cx(contribution[0]) + 14, epsCode.x - 4],
  };
}

const DOC_TYPE = /^[A-Z]{2,4}$/;
const NOVELTY_CODES = new Set(["ing", "ret", "tde", "tae", "tdp", "tap", "vsp", "vst", "sln", "ige", "lma", "vac", "avp", "vct", "irl", "cor"]);

function parseDetailPage(page: PdfPageText, cached?: Columns): { employees: MiPlanillaEmployee[]; issues: MiPlanillaIssue[]; detected: number; columns?: Columns } {
  const title = find(page.items, /^DETALLE POR COTIZANTE$/);
  const anchorsAll = page.items.filter((i) => i.x < 16 && /^\d{1,4}$/.test(i.text.trim()) && (!title || i.y < title.y - 30));
  const anchors = anchorsAll.sort((a, b) => b.y - a.y);
  const issues: MiPlanillaIssue[] = [];
  if (!title && !cached) return { employees: [], issues, detected: 0 };
  if (!anchors.length) return { employees: [], issues, detected: 0, columns: cached };

  let columns = cached;
  if (title) {
    const first = anchors[0];
    const header = page.items.filter((i) => i.y > first.y + 8 && i.y < title.y - 6);
    const read = readColumns(header);
    if (typeof read === "string") {
      issues.push({ page: page.pageNumber, text: "Detalle por cotizante", reason: read });
      return { employees: [], issues, detected: anchors.length, columns: cached };
    }
    columns = read;
  }
  if (!columns) return { employees: [], issues, detected: 0 };
  const cols = columns;

  const pitch = anchors.length > 1 ? Math.min(...anchors.slice(1).map((a, i) => anchors[i].y - a.y)) : 13;
  const left = page.items.filter((i) => i.x >= 14 && i.x < 118 && i.y < (title ? title.y - 30 : Infinity) && !anchors.includes(i));
  const employees: MiPlanillaEmployee[] = [];
  for (const anchor of anchors) {
    const rowNumber = Number(anchor.text.trim());
    const numeric = page.items.filter((i) => Math.abs(i.y - anchor.y) <= 2.6 && i.x >= 118 && isMoney(i));
    const cell = (center: number) => nearest(numeric, center, 11);
    const value = (center: number) => {
      const c = cell(center);
      return c ? toPesos(c.text) : null;
    };

    // Identificación y nombre: las líneas a la izquierda más cercanas a esta fila (el nombre puede ocupar 2-3 líneas).
    const mine = left.filter((i) => {
      const dist = Math.abs(i.y - anchor.y);
      if (dist > pitch * 0.6) return false;
      return anchors.every((a) => a === anchor || Math.abs(i.y - a.y) > dist || (Math.abs(i.y - a.y) === dist && a.y < anchor.y));
    });
    const lines = rowsOf(mine, 1);
    const idItems = mine.filter((i) => i.x < 50).sort((a, b) => b.y - a.y || a.x - b.x);
    const idText = idItems.map((i) => i.text.trim()).join(" ").replace(/\s+/g, " ");
    const idMatch = /^([A-Z]{2,4})\s*(\d+)$/.exec(idText) ?? (DOC_TYPE.test(idItems[0]?.text.trim() ?? "") ? /^([A-Z]{2,4})\s+(\d+)$/.exec(idText) : null);
    const name = mine.filter((i) => i.x >= 50).sort((a, b) => b.y - a.y || a.x - b.x).map((i) => i.text.trim()).join(" ").replace(/\s+/g, " ").trim();
    void lines;

    const pensionIbc = value(cols.ibcPension);
    const pensionDays = value(cols.days[0]);
    const pension = value(cols.contribution[0]);
    const health = value(cols.contribution[1]);
    const risk = value(cols.contribution[2]);
    const ccf = value(cols.ccf);
    const missing = [!idMatch && "documento", !name && "nombre", pensionIbc === null && "IBC de pensión", pensionDays === null && "días de pensión", pension === null && "cotización de pensión", health === null && "cotización de salud", risk === null && "cotización de riesgos", ccf === null && "aporte CCF"].filter(Boolean);
    if (missing.length) {
      issues.push({ page: page.pageNumber, text: `Fila ${rowNumber}${name ? ` · ${name}` : ""}`, reason: `No se pudo leer: ${missing.join(", ")}.` });
      continue;
    }
    const extraCells = numeric.filter((i) => cx(i) > cols.extras[0] && cx(i) < cols.extras[1]);
    const extras = extraCells.reduce((sum, i) => sum + toPesos(i.text), 0);
    // Desglose: cada cifra va a la columna de rótulo más cercana. Sin rótulos confiables solo queda el total.
    const labelled = Object.entries(cols.extrasColumns ?? {}).filter((e): e is [string, number] => e[1] !== undefined);
    const split = { voluntaryAffiliate: 0, voluntaryEmployer: 0, fspSolidarity: 0, fspSubsistence: 0 } as Record<string, number>;
    let breakdown = labelled.length === 4;
    if (breakdown) {
      for (const cell of extraCells) {
        const [key] = labelled.reduce((best, cur) => (Math.abs(cur[1] - cx(cell)) < Math.abs(best[1] - cx(cell)) ? cur : best));
        split[key] += toPesos(cell.text);
      }
    }
    const anyOf = (center: number | undefined) => (center === undefined ? undefined : numeric.find((i) => Math.abs(cx(i) - center) <= 11));
    const integer = (center: number | undefined) => {
      const c = anyOf(center);
      return c ? toPesos(c.text) : undefined;
    };
    const codeAt = (center: number | undefined) => {
      if (center === undefined) return undefined;
      const hits = page.items.filter((i) => Math.abs(i.y - anchor.y) <= 2.6 && i.x >= 118 && Math.abs(cx(i) - center) <= 14 && !i.rotated && /^[A-Z0-9-]{2,12}$/i.test(i.text.trim()));
      const hit = hits.sort((a, b) => Math.abs(cx(a) - center) - Math.abs(cx(b) - center))[0];
      return hit ? hit.text.trim().toUpperCase() : undefined;
    };
    // Novedades: una «X» (o marca) en la zona de rótulos girados → el rótulo de su columna.
    const noveltyZone = cols.novelties?.length ? [Math.min(...cols.novelties.map((n) => n.center)) - 6, Math.max(...cols.novelties.map((n) => n.center)) + 6] : null;
    const novelties = noveltyZone
      ? page.items
          .filter((i) => Math.abs(i.y - anchor.y) <= 2.6 && !i.rotated && /^[Xx]$/.test(i.text.trim()) && cx(i) >= noveltyZone[0] && cx(i) <= noveltyZone[1])
          .map((i) => cols.novelties!.reduce((best, n) => (Math.abs(n.center - cx(i)) < Math.abs(best.center - cx(i)) ? n : best)).code)
      : [];
    const parafiscales = Object.fromEntries(PARAFISCALS.map((p) => [p, value(cols.parafiscales[p]) ?? 0])) as Record<Parafiscal, number>;
    employees.push({
      rowNumber,
      identification: `${idMatch![1]} ${idMatch![2]}`,
      name,
      pensionDays: pensionDays!,
      pensionIbc: pensionIbc!,
      pensionContribution: pension!,
      healthContribution: health!,
      riskContribution: risk!,
      ccfContribution: ccf!,
      pensionExtras: extras,
      ...(breakdown ? { voluntaryPension: split.voluntaryAffiliate + split.voluntaryEmployer, fspSolidarity: split.fspSolidarity, fspSubsistence: split.fspSubsistence } : {}),
      healthDays: integer(cols.days[1]),
      healthIbc: integer(cols.ibcOthers?.health),
      riskDays: integer(cols.days[2]),
      riskIbc: integer(cols.ibcOthers?.risk),
      ccfDays: integer(cols.days[3]),
      ccfIbc: integer(cols.ibcOthers?.ccf),
      entityCodes: { afp: codeAt(cols.codes?.afp), eps: codeAt(cols.codes?.eps), arl: codeAt(cols.codes?.arl), ccf: codeAt(cols.codes?.ccf) },
      novelties: [...new Set(novelties)],
      parafiscales,
      page: page.pageNumber,
    });
  }
  return { employees, issues, detected: anchors.length, columns };
}

// ---------------------------------------------------------------------------

export function parseMiPlanilla(doc: PdfDocumentText): MiPlanillaSummary {
  // Normaliza los textos (algunas tildes vienen como letra + acento combinado).
  doc = { ...doc, pages: doc.pages.map((p) => ({ ...p, items: p.items.map((i) => ({ ...i, text: i.text.normalize("NFC") })) })) };
  const first = doc.pages[0];
  if (!first || !first.items.some((i) => /PLANILLA INTEGRADA DE AUTOLIQUIDACI/i.test(i.text))) {
    throw new StatementError("El PDF no parece una planilla de MiPlanilla (Planilla Integrada de Autoliquidación de Aportes). Verifica que sea el PDF descargado del operador.");
  }
  const header = parseHeader(first);
  if (!header.pensionPeriod) {
    throw new StatementError("No se encontró el período de pensión de la planilla. MiPlanilla se contabiliza por el período de pensión.");
  }
  const { totals, administrators } = parseTotals(doc.pages);

  const employees: MiPlanillaEmployee[] = [];
  const issues: MiPlanillaIssue[] = [];
  let detected = 0;
  let columns: Columns | undefined;
  for (const page of doc.pages) {
    const result = parseDetailPage(page, columns);
    columns = result.columns ?? columns;
    employees.push(...result.employees);
    issues.push(...result.issues);
    detected += result.detected;
  }
  return {
    pageCount: doc.pageCount,
    employerNit: header.employerNit,
    employerDv: header.employerDv,
    employerName: header.employerName,
    planillaNumber: header.planillaNumber,
    paymentDate: header.paymentDate,
    pensionPeriod: header.pensionPeriod,
    healthPeriod: header.healthPeriod,
    planillaType: header.planillaType,
    declaredEmployees: header.declaredEmployees,
    totalPayroll: header.totalPayroll,
    totalToPay: header.totalToPay,
    employees,
    totals,
    administrators,
    detectedRows: detected,
    issues,
  };
}
