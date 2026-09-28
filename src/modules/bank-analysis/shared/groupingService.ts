import { SIGN_ORDER } from "./money";
import type { BankMovement, MovementGroup } from "./types";

/**
 * Normalización técnica mínima permitida: espacios al inicio y al final, y
 * espacios repetidos. Nada más: no se cambian palabras, números, referencias
 * ni mayúsculas.
 */
export function normalizeDescription(description: string): string {
  return description.replace(/\s+/g, " ").trim();
}

/**
 * Agrupación ESTRICTA por descripción exacta + signo del valor. Una misma
 * descripción con valores positivos y negativos produce dos grupos
 * independientes: nunca se netean. Sin coincidencias aproximadas.
 */
export function groupMovements(movements: BankMovement[]): MovementGroup[] {
  const groups = new Map<string, MovementGroup>();
  for (const m of movements) {
    const description = normalizeDescription(m.description);
    const key = `${description}|${m.sign}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, description, sign: m.sign, count: 0, totalCents: 0, movements: [] };
      groups.set(key, group);
    }
    group.movements.push(m);
    group.count += 1;
    group.totalCents += m.valueCents;
  }
  return sortGroups([...groups.values()], "description", "asc");
}

export type GroupSortKey = "description" | "count" | "total";
export type SortDirection = "asc" | "desc";

const collator = new Intl.Collator("es", { sensitivity: "variant", numeric: true });

/**
 * Orden consistente: el criterio elegido y, en empate, la descripción y luego
 * el signo (positivo, negativo, cero). Así el grupo positivo y el negativo de
 * una misma descripción siempre aparecen juntos y en el mismo orden al
 * ordenar por descripción.
 */
export function sortGroups(groups: MovementGroup[], key: GroupSortKey, direction: SortDirection): MovementGroup[] {
  const dir = direction === "asc" ? 1 : -1;
  const byDescription = (a: MovementGroup, b: MovementGroup) =>
    collator.compare(a.description, b.description) || SIGN_ORDER[a.sign] - SIGN_ORDER[b.sign];
  return [...groups].sort((a, b) => {
    const primary =
      key === "description" ? collator.compare(a.description, b.description) : key === "count" ? a.count - b.count : a.totalCents - b.totalCents;
    return dir * primary || byDescription(a, b);
  });
}
