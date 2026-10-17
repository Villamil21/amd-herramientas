import { compareText } from "./documents";
import { decisionMap, nameKey, type Operation } from "./operations";
import type { CryptoDecision } from "./types";

/**
 * Posibles duplicados entre cargas activas y dentro de una misma carga. Una coincidencia, exacta o probable, es solo una
 * alerta: nada se omite, excluye ni enlaza de forma automática. Mientras el usuario no decida, las filas candidatas no
 * alimentan Estados Financieros ni Exógena.
 */

export type DuplicateLevel = "exact" | "probable";

export interface DuplicateGroup {
  id: string;
  kind: Operation["kind"];
  level: DuplicateLevel;
  /** Qué coincide (para explicarlo en la pantalla de revisión). */
  basis: string;
  members: Operation[];
  /** Filas que siguen contando (no excluidas por el usuario como duplicado). */
  active: Operation[];
  /** El usuario ya decidió: queda una sola fila activa o todas se conservaron expresamente. */
  resolved: boolean;
}

class DisjointSet {
  private parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b);
  }
}

const docIdentity = (o: Operation) => `${o.docCode ?? `?${o.docTypeKey}`}|${o.docNumber}`;

/** Sin número de identificación no hay otra forma de distinguir a dos terceros que su nombre. */
const baseKey = (o: Operation) => `${o.kind}|${o.date ?? ""}|${docIdentity(o)}|${o.docNumber ? "" : nameKey(o.names)}|${o.amountCents}`;

/** Dos compras con Orden distinta son operaciones distintas; si alguna no tiene Orden, no hay con qué descartarlo. */
function compatible(a: Operation, b: Operation): boolean {
  if (a.kind === "sale") return true;
  const oa = compareText(a.order);
  const ob = compareText(b.order);
  return !oa || !ob || oa === ob;
}

const exactKey = (o: Operation) => `${compareText(o.order)}|${nameKey(o.names)}`;

/** Grupos candidatos entre las operaciones válidas (sin problemas propios y sin excluir). */
export function findDuplicateGroups(candidates: readonly Operation[], decisions: readonly CryptoDecision[]): DuplicateGroup[] {
  const buckets = new Map<string, Operation[]>();
  for (const o of candidates) {
    const key = baseKey(o);
    buckets.set(key, [...(buckets.get(key) ?? []), o]);
  }
  const dupDecisions = decisionMap(decisions, "duplicate");
  const groups: DuplicateGroup[] = [];
  for (const [key, bucket] of buckets) {
    if (bucket.length < 2) continue;
    const sets = new DisjointSet(bucket.length);
    for (let i = 0; i < bucket.length; i++) for (let j = i + 1; j < bucket.length; j++) if (compatible(bucket[i], bucket[j])) sets.union(i, j);
    const components = new Map<number, Operation[]>();
    bucket.forEach((o, i) => components.set(sets.find(i), [...(components.get(sets.find(i)) ?? []), o]));
    for (const members of components.values()) {
      if (members.length < 2) continue;
      const sorted = [...members].sort((a, b) => a.uploadId - b.uploadId || a.rowNumber - b.rowNumber);
      const exact = sorted.every((m) => exactKey(m) === exactKey(sorted[0]));
      const active = sorted.filter((m) => dupDecisions.get(m.identity)?.value !== "exclude");
      const resolved = active.length < 2 || active.every((m) => dupDecisions.get(m.identity)?.value === "keep");
      const first = sorted[0];
      groups.push({
        id: `${key}#${first.identity}`,
        kind: first.kind,
        level: exact ? "exact" : "probable",
        basis:
          first.kind === "purchase"
            ? `Misma fecha, tipo y número de documento, valor${sorted.every((m) => m.order) ? " y orden" : ""}${exact ? " y datos del tercero" : " (cambian el orden o los datos del tercero)"}`
            : `Mismo tipo y número de documento y valor${exact ? " y datos del pagador" : " (cambian los datos del pagador)"}`,
        members: sorted,
        active,
        resolved,
      });
    }
  }
  return groups.sort((a, b) => a.members[0].uploadId - b.members[0].uploadId || a.members[0].rowNumber - b.members[0].rowNumber);
}
