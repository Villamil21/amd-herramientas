import { personKey, type StoredPlanilla } from "./store";
import type { NormalizedPlanilla } from "./types";

/**
 * Historial por periodo de la EPS, AFP, ARL y CCF de cada empleado, tal como aparece en cada planilla. Se deriva de las planillas
 * guardadas (una por periodo): una planilla nueva solo agrega su periodo y NUNCA reasigna periodos anteriores.
 */
export type EntitySlot = "afp" | "eps" | "arl" | "ccf";
export const ENTITY_SLOTS: EntitySlot[] = ["afp", "eps", "arl", "ccf"];
export const SLOT_LABEL: Record<EntitySlot, string> = { afp: "AFP", eps: "EPS", arl: "ARL", ccf: "CCF" };
const KIND_OF: Record<EntitySlot, "AFP" | "EPS" | "ARL" | "CCF"> = { afp: "AFP", eps: "EPS", arl: "ARL", ccf: "CCF" };

export type EntityCodes = Partial<Record<EntitySlot, string>>;

export interface EntityHistoryRow {
  period: string;
  codes: EntityCodes;
  /** Nombre de la entidad según la propia planilla (informativo). */
  names: Partial<Record<EntitySlot, string>>;
  batchId: number;
  operatorLabel: string;
  /** Entidades que cambiaron respecto al periodo anterior con planilla. */
  changed: EntitySlot[];
}

const entityName = (p: NormalizedPlanilla, slot: EntitySlot, code: string | undefined) => (code ? p.entities.find((e) => e.kind === KIND_OF[slot] && e.code === code)?.name : undefined);

export function entityHistory(planillas: StoredPlanilla[], docType: string, docNumber: string): EntityHistoryRow[] {
  const key = personKey(docType, docNumber);
  const rows: EntityHistoryRow[] = [];
  for (const { batch, planilla } of planillas) {
    const e = planilla?.employees.find((x) => personKey(x.docType, x.docNumber) === key);
    if (!planilla || !e) continue;
    const names: EntityHistoryRow["names"] = {};
    for (const s of ENTITY_SLOTS) {
      const n = entityName(planilla, s, e.entityCodes[s]);
      if (n) names[s] = n;
    }
    rows.push({ period: planilla.period, codes: { ...e.entityCodes }, names, batchId: batch.id, operatorLabel: planilla.operatorLabel, changed: [] });
  }
  rows.sort((a, b) => a.period.localeCompare(b.period) || a.batchId - b.batchId);
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.changed = prev ? ENTITY_SLOTS.filter((s) => (r.codes[s] ?? "") !== (prev.codes[s] ?? "")) : [];
  });
  return rows;
}

export interface EntityProposal {
  /** Llave estable de la propuesta para guardar su confirmación con el lote: `entity:CC 123|2026-01`. */
  documentKey: string;
  person: string;
  name: string;
  period: string;
  kind: "new" | "changed";
  /** Por entidad: código anterior (vacío en el primer periodo) y nuevo. */
  changes: { slot: EntitySlot; from: string; to: string }[];
}

/**
 * Qué propone la planilla que se va a importar frente al último periodo ANTERIOR conocido de cada empleado: primera aparición
 * (entidades nuevas) o un código distinto. `ownKey` es la llave de la planilla que se reemplaza (no cuenta como historia). Si la
 * persona ya tiene un periodo posterior guardado, no se propone nada: no se reescribe.
 */
export function proposeEntityChanges(p: NormalizedPlanilla, stored: StoredPlanilla[], ownKey: string): EntityProposal[] {
  const others = stored.filter((s) => s.batch.dedupeKey !== ownKey);
  const out: EntityProposal[] = [];
  for (const e of p.employees) {
    const history = entityHistory(others, e.docType, e.docNumber);
    if (history.some((h) => h.period > p.period)) continue;
    const previous = [...history].reverse().find((h) => h.period < p.period);
    const changes = ENTITY_SLOTS.filter((s) => e.entityCodes[s] && e.entityCodes[s] !== (previous?.codes[s] ?? "")).map((slot) => ({ slot, from: previous?.codes[slot] ?? "", to: e.entityCodes[slot]! }));
    if (changes.length === 0) continue;
    const person = personKey(e.docType, e.docNumber);
    out.push({ documentKey: `entity:${person}|${p.period}`, person, name: e.name, period: p.period, kind: previous ? "changed" : "new", changes });
  }
  return out;
}
