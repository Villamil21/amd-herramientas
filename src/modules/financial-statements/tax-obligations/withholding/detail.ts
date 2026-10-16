import type { TaxReturn } from "../types";

/**
 * Retención en la fuente (Formulario 350) discriminada por concepto contable.
 *
 * El lector del PDF guarda las casillas numéricas tal como salen del formulario (`detail.withholding.casillas`). Aquí se
 * consolidan por concepto lógico: personas jurídicas + personas naturales en UNA fila (un solo PUC por concepto), las
 * autorretenciones en un único total y la casilla 129 (devoluciones / retenciones en exceso) siempre como valor NEGATIVO
 * distribuible entre conceptos. El detalle por casilla se conserva para auditoría.
 */

export interface WhConceptDef {
  key: string;
  label: string;
  /** Casillas de retención: personas jurídicas / personas naturales. */
  ret: { pj: number | null; pn: number | null };
  /** Casillas de base (solo auditoría). */
  base: { pj: number | null; pn: number | null };
}

export const WH_SELF_KEY = "self";
export const WH_VAT_KEY = "vat";
export const WH_STAMP_KEY = "stamp";

/** Conceptos de retención a título de renta del Formulario 350 (versión 2026). */
export const WH_CONCEPTS: WhConceptDef[] = [
  { key: "labor", label: "Rentas de trabajo", ret: { pj: null, pn: 93 }, base: { pj: null, pn: 77 } },
  { key: "pensions", label: "Rentas de pensiones", ret: { pj: null, pn: 94 }, base: { pj: null, pn: 78 } },
  { key: "fees", label: "Honorarios", ret: { pj: 42, pn: 95 }, base: { pj: 29, pn: 79 } },
  { key: "commissions", label: "Comisiones", ret: { pj: 43, pn: 96 }, base: { pj: 30, pn: 80 } },
  { key: "services", label: "Servicios", ret: { pj: 44, pn: 97 }, base: { pj: 31, pn: 81 } },
  { key: "yields", label: "Rendimientos financieros e intereses", ret: { pj: 45, pn: 98 }, base: { pj: 32, pn: 82 } },
  { key: "leases", label: "Arrendamientos (muebles e inmuebles)", ret: { pj: 46, pn: 99 }, base: { pj: 33, pn: 83 } },
  { key: "royalties", label: "Regalías y explotación de la propiedad intelectual", ret: { pj: 47, pn: 100 }, base: { pj: 34, pn: 84 } },
  { key: "dividends", label: "Dividendos y participaciones", ret: { pj: 48, pn: 101 }, base: { pj: 35, pn: 85 } },
  { key: "purchases", label: "Compras", ret: { pj: 49, pn: 102 }, base: { pj: 36, pn: 86 } },
  { key: "cards", label: "Transacciones con tarjetas débito y crédito", ret: { pj: 50, pn: 103 }, base: { pj: 37, pn: 87 } },
  { key: "construction", label: "Contratos de construcción", ret: { pj: 51, pn: 104 }, base: { pj: 38, pn: 88 } },
  { key: "fixed_assets", label: "Enajenación de activos fijos de personas naturales", ret: { pj: null, pn: 105 }, base: { pj: null, pn: 89 } },
  { key: "lotteries", label: "Loterías, rifas, apuestas y similares", ret: { pj: 52, pn: 106 }, base: { pj: 39, pn: 90 } },
  { key: "hydrocarbons", label: "Hidrocarburos, carbón y demás productos mineros", ret: { pj: 53, pn: 107 }, base: { pj: 40, pn: 91 } },
  { key: "other_payments", label: "Otros pagos sujetos a retención", ret: { pj: 54, pn: 108 }, base: { pj: 41, pn: 92 } },
  { key: "foreign_no_treaty", label: "Pagos al exterior a países sin convenio", ret: { pj: 57, pn: 111 }, base: { pj: 55, pn: 109 } },
  { key: "foreign_treaty", label: "Pagos al exterior a países con convenio vigente", ret: { pj: 58, pn: 112 }, base: { pj: 56, pn: 110 } },
];

/** Autorretenciones: retención PJ 68–76 y PN 121–128 (la casilla 59 es la base del renglón de exonerados, junto a la 68). */
export const WH_SELF_RET: number[] = [68, 69, 70, 71, 72, 73, 74, 75, 76, 121, 122, 123, 124, 125, 126, 127, 128];
export const WH_SELF_BASE: number[] = [59, 60, 61, 62, 63, 64, 65, 66, 67, 113, 114, 115, 116, 117, 118, 119, 120];

export const CASILLA_RETURNS = 129;
export const CASILLA_VAT_RESPONSIBLE = 131;
export const CASILLA_VAT_NONRESIDENT = 132;
export const CASILLA_VAT_RETURNS = 133;
export const CASILLA_STAMP = 135;
export const CASILLA_SANCTIONS = 137;
export const CASILLA_TOTAL = 138;
export const CASILLA_TOTAL_INCOME = 130;

/** Rango de casillas que lee el parser del 350 (bases, retenciones y totales). */
export const WH_CASILLA_RANGE: [number, number] = [29, 138];

export const WH_PUC_PREFIX = "tax.wh.";
export const whPucKey = (conceptKey: string) => `${WH_PUC_PREFIX}${conceptKey}`;

/** Conceptos que pueden recibir una distribución de la casilla 129 (todo lo que sea retención positiva). */
export interface WhTarget {
  key: string;
  label: string;
}

export interface WhSource {
  casilla: number;
  party: "PJ" | "PN" | "";
  kind: "base" | "retention";
  cents: number;
}

export interface WhConceptRow {
  key: string;
  label: string;
  pjCents: number;
  pnCents: number;
  /** Retención positiva consolidada (PJ + PN). */
  grossCents: number;
  /** Casilla 129 distribuida a este concepto (valor negativo o 0). */
  adjustmentCents: number;
  /** Valor contable del concepto: positivo − devoluciones distribuidas. */
  netCents: number;
  sources: WhSource[];
}

/** Fila manual de «Devoluciones y ajustes - casilla 129»: se guarda como magnitud positiva y se aplica con signo negativo. */
export interface Adjustment129 {
  id: string;
  conceptKey: string;
  cents: number;
  note: string;
}

export interface WhManual {
  adjustments129?: Adjustment129[];
}

export interface WhBreakdown {
  rows: WhConceptRow[];
  /** Σ retenciones positivas (renta + IVA + timbre + autorretenciones). */
  positiveCents: number;
  /** Casilla 129 leída del formulario (magnitud; siempre se resta). */
  casilla129Cents: number;
  adjustments: Adjustment129[];
  distributed129Cents: number;
  undistributed129Cents: number;
  sanctionCents: number;
  /** Casilla 138 del formulario. */
  formTotalCents: number;
  /** Retenciones positivas − 129 + sanciones. */
  computedTotalCents: number;
  /** computedTotal − formTotal (0 si concilia con el formulario). */
  differenceCents: number;
  /** Detalle de las autorretenciones por casilla para auditoría. */
  selfDetail: WhSource[];
}

type CasillaMap = Record<string, number>;

export const hasWithholdingDetail = (r: Pick<TaxReturn, "detail">): boolean => Boolean(r.detail?.withholding && Object.keys(r.detail.withholding.casillas ?? {}).length > 0);

const val = (m: CasillaMap, c: number | null) => (c === null ? 0 : (m[String(c)] ?? 0));

export function whTargets(): WhTarget[] {
  return [...WH_CONCEPTS.map((c) => ({ key: c.key, label: c.label })), { key: WH_SELF_KEY, label: "Autorretenciones" }];
}

/** Concepto contable (y sus filas) a partir de las casillas del formulario y la distribución manual de la casilla 129. */
export function whBreakdown(casillas: CasillaMap, manual?: WhManual): WhBreakdown {
  const adjustments = (manual?.adjustments129 ?? []).filter((a) => a.cents > 0);
  const adjFor = (key: string) => adjustments.filter((a) => a.conceptKey === key).reduce((n, a) => n + a.cents, 0);
  const rows: WhConceptRow[] = [];
  const push = (row: Omit<WhConceptRow, "adjustmentCents" | "netCents" | "grossCents"> & { grossCents?: number }) => {
    const gross = row.grossCents ?? row.pjCents + row.pnCents;
    const adj = adjFor(row.key);
    if (gross === 0 && adj === 0) return;
    rows.push({ ...row, grossCents: gross, adjustmentCents: -adj, netCents: gross - adj });
  };
  for (const c of WH_CONCEPTS) {
    const sources: WhSource[] = [];
    const add = (casilla: number | null, party: "PJ" | "PN", kind: "base" | "retention") => {
      if (casilla !== null && String(casilla) in casillas) sources.push({ casilla, party, kind, cents: casillas[String(casilla)] });
    };
    add(c.base.pj, "PJ", "base");
    add(c.ret.pj, "PJ", "retention");
    add(c.base.pn, "PN", "base");
    add(c.ret.pn, "PN", "retention");
    push({ key: c.key, label: c.label, pjCents: val(casillas, c.ret.pj), pnCents: val(casillas, c.ret.pn), sources });
  }
  const selfDetail: WhSource[] = [];
  for (const [list, kind] of [[WH_SELF_BASE, "base"], [WH_SELF_RET, "retention"]] as const)
    for (const casilla of list) if (String(casilla) in casillas) selfDetail.push({ casilla, party: casilla >= 113 ? "PN" : "PJ", kind, cents: casillas[String(casilla)] });
  const selfPj = WH_SELF_RET.filter((c) => c < 113).reduce((n, c) => n + val(casillas, c), 0);
  const selfPn = WH_SELF_RET.filter((c) => c >= 113).reduce((n, c) => n + val(casillas, c), 0);
  push({ key: WH_SELF_KEY, label: "Autorretenciones", pjCents: selfPj, pnCents: selfPn, sources: selfDetail });
  const vat = val(casillas, CASILLA_VAT_RESPONSIBLE) + val(casillas, CASILLA_VAT_NONRESIDENT) - val(casillas, CASILLA_VAT_RETURNS);
  push({
    key: WH_VAT_KEY,
    label: "Retenciones a título de IVA",
    pjCents: 0,
    pnCents: 0,
    grossCents: vat,
    sources: [CASILLA_VAT_RESPONSIBLE, CASILLA_VAT_NONRESIDENT, CASILLA_VAT_RETURNS].filter((c) => String(c) in casillas).map((casilla) => ({ casilla, party: "" as const, kind: "retention" as const, cents: casillas[String(casilla)] })),
  });
  push({ key: WH_STAMP_KEY, label: "Retenciones impuesto timbre nacional", pjCents: 0, pnCents: 0, grossCents: val(casillas, CASILLA_STAMP), sources: String(CASILLA_STAMP) in casillas ? [{ casilla: CASILLA_STAMP, party: "", kind: "retention", cents: casillas[String(CASILLA_STAMP)] }] : [] });

  const casilla129 = val(casillas, CASILLA_RETURNS);
  const distributed = adjustments.reduce((n, a) => n + a.cents, 0);
  const positive = rows.reduce((n, r) => n + r.grossCents, 0);
  const sanction = val(casillas, CASILLA_SANCTIONS);
  const formTotal = val(casillas, CASILLA_TOTAL);
  const computed = positive - casilla129 + sanction;
  return {
    rows,
    positiveCents: positive,
    casilla129Cents: casilla129,
    adjustments,
    distributed129Cents: distributed,
    // Pueden registrarse devoluciones aunque el formulario traiga 0 en la 129 (nota crédito de una factura anterior): el saldo es solo lo que falta.
    undistributed129Cents: Math.max(0, casilla129 - distributed),
    sanctionCents: sanction,
    formTotalCents: formTotal,
    computedTotalCents: computed,
    differenceCents: computed - formTotal,
    selfDetail,
  };
}

export function whBreakdownOf(r: Pick<TaxReturn, "detail">): WhBreakdown | null {
  const casillas = r.detail?.withholding?.casillas;
  if (!casillas || Object.keys(casillas).length === 0) return null;
  return whBreakdown(casillas, r.detail.manual as WhManual | undefined);
}

/** Distribución de la 129 que supera lo declarado, o a un concepto sin retención suficiente (revisión, no bloquea el guardado). */
export function adjustmentWarnings(b: WhBreakdown): string[] {
  const out: string[] = [];
  if (b.distributed129Cents > b.casilla129Cents) out.push(b.casilla129Cents === 0 ? "El formulario trae 0 en la casilla 129: estas devoluciones no concilian con el total declarado." : "Lo distribuido supera la casilla 129 del formulario.");
  for (const r of b.rows) if (r.netCents < 0) out.push(`${r.label}: las devoluciones superan la retención del periodo.`);
  return out;
}
