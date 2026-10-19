import { formatPesos } from "../../../../utils/format";
import { formatRateBp } from "../../../taxes/withholding/services/money";
import type { DocView } from "./model";

/**
 * Resumen compacto de la retención de una factura para la columna «Rete» de la tabla de facturas. Sale del mismo cálculo que el
 * detalle (`DocView.retention`): solo conceptos CONFIRMADOS, sin líneas 7305, con la tarifa y la cuantía mínima de la fecha de la
 * factura, y una retención común a todas las líneas contada una sola vez.
 *
 *  - exempt: proveedor O-15 / O-47 (sin porcentajes ni valores)   - none: ningún concepto confirmado
 *  - calculated: porcentajes únicos y valor calculado (puede ser 0 si no supera la cuantía mínima; no es un bloqueo)
 *  - none sin factura vigente (duplicada, sustituida o excluida): sin información
 */
/** Pesos enteros con espacio tras el signo, coherente con el resto de la tabla pero sin decimales: «$ 3.116», «-$ 8.000». */
export function formatPesosCompact(cents: number): string {
  const pesos = Math.round(Math.abs(cents) / 100);
  return formatPesos(pesos === 0 ? 0 : Math.sign(cents) * pesos).replace("$", "$ ");
}

export type RetentionCell =
  | { kind: "empty" }
  | { kind: "exempt"; text: string }
  | { kind: "none"; text: string }
  | { kind: "calculated"; text: string; percents: string; valueCents: number; belowMinimum: boolean; missingUvt: boolean; hint?: string; informed?: { text: string; cents: number } };

export function retentionCell(d: DocView): RetentionCell {
  if (!d.counts) return { kind: "empty" };
  if (d.exemption) return { kind: "exempt", text: "No aplica" };
  const { byRate, missingUvtYear } = d.retention;
  const informed = d.retention.practicedCents > 0 && d.alerts.some((a) => a.code === "retention-mismatch") ? { cents: d.retention.practicedCents * d.sign, text: `Informada ${formatPesosCompact(d.retention.practicedCents * d.sign)}: revisar` } : undefined;
  if (byRate.length === 0) return informed ? { kind: "calculated", text: `Sin concepto · ${formatPesosCompact(0)}`, percents: "", valueCents: 0, belowMinimum: false, missingUvt: false, informed } : { kind: "none", text: "Sin retención" };
  const percents = [...new Set(byRate.map((r) => r.rateBp))].map((bp) => formatRateBp(bp)).join(" + ");
  // En devoluciones el valor lleva el mismo signo que Base e IVA (resta); el cálculo no se duplica.
  const valueCents = d.retention.expectedCents * d.sign;
  const below = byRate.filter((r) => r.belowMinimum).length;
  const belowMinimum = below > 0 && !missingUvtYear;
  const hint = missingUvtYear
    ? `Falta el UVT de ${missingUvtYear}: no se puede evaluar la cuantía mínima`
    : below === byRate.length
      ? "No supera la cuantía mínima"
      : below > 0
        ? "Un concepto no supera la cuantía mínima"
        : undefined;
  return { kind: "calculated", text: `${percents} · ${formatPesosCompact(valueCents)}`, percents, valueCents, belowMinimum, missingUvt: Boolean(missingUvtYear), hint, informed };
}
