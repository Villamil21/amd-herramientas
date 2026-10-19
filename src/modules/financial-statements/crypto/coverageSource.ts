import { useEffect, useMemo, useState } from "react";
import { cryptoService } from "../../../services/cryptoService";
import type { ExoCatalogs } from "../../../types/exogena";
import { buildModel, type CryptoModel } from "./domain/model";
import type { CryptoState, Homologation } from "./domain/types";

/**
 * Reporte de operaciones como fuente del Generador: un mes está cargado cuando el módulo de Transacciones Cripto lo cubre
 * (misma regla que su «Cobertura por mes»: operaciones aceptadas de esa empresa y ese año). No se duplican datos: se lee lo guardado.
 */
export interface CryptoMonthCell {
  loaded: boolean;
  /** Archivos vigentes que cubren el mes. */
  files: string[];
  /** Filas pendientes de ese mes (no lo cubren hasta resolverlas). */
  pending: number;
}

const NO_PUC = { code: undefined, valid: false, located: false } as const;

/** Celdas por mes AAAA-MM a partir de los modelos ya calculados por año; un año sin modelo no cubre nada. */
export function cryptoCoverageCells(months: readonly string[], models: ReadonlyMap<number, CryptoModel>): Record<string, CryptoMonthCell> {
  return Object.fromEntries(
    months.map((month) => {
      const entry = models.get(Number(month.slice(0, 4)))?.matrix.find((m) => m.month === month);
      const files = entry?.uploads.map((u) => u.fileName) ?? [];
      return [month, { loaded: files.length > 0, files, pending: entry?.pending.reduce((s, p) => s + p.pending.count, 0) ?? 0 }];
    }),
  );
}

/** Modelo de un año con lo guardado; para la cobertura no importan dirección ni PUC. */
export function coverageModel(year: number, state: CryptoState, homologations: readonly Homologation[], catalogs: ExoCatalogs | null): CryptoModel {
  return buildModel({ year, state, homologations, catalogs, companyAddress: "", puc: () => NO_PUC });
}

interface Loaded {
  companyId: number;
  year: number;
  state: CryptoState;
}

/** Carga lo guardado de cada año del rango para la empresa; los resultados de otra empresa o año nunca se mezclan. */
export function useCryptoOpsCoverage(companyId: number | null, months: readonly string[], homologations: Homologation[] | null, catalogs: ExoCatalogs | null, refreshKey?: unknown) {
  const [loaded, setLoaded] = useState<Loaded[]>([]);
  const years = useMemo(() => [...new Set(months.map((m) => Number(m.slice(0, 4))))], [months]);
  const yearsKey = years.join(",");

  useEffect(() => {
    if (companyId === null) return void setLoaded([]);
    let cancelled = false;
    Promise.all(years.map((year) => cryptoService.state(companyId, year).then((state) => ({ companyId, year, state }))))
      .then((r) => !cancelled && setLoaded(r))
      .catch(() => !cancelled && setLoaded([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, yearsKey, refreshKey]);

  return useMemo(() => {
    const models = new Map<number, CryptoModel>();
    if (homologations)
      for (const l of loaded) if (l.companyId === companyId && years.includes(l.year)) models.set(l.year, coverageModel(l.year, l.state, homologations, catalogs));
    return cryptoCoverageCells(months, models);
  }, [loaded, companyId, years, months, homologations, catalogs]);
}

