import type { CryptoRowInput, CryptoStoredRow, VersionDiffSummary } from "./types";

/**
 * Comparación de un archivo con el mismo nombre contra su versión vigente, antes de reemplazarla. Las filas materialmente
 * idénticas (misma huella) no cambian aunque cambien de posición; una fila en la misma posición con otro contenido es
 * «modificada»; lo que solo está en una de las dos versiones es «agregado» o «eliminado».
 */
export interface VersionDiff extends VersionDiffSummary {
  addedRows: CryptoRowInput[];
  removedRows: CryptoStoredRow[];
  modifiedRows: { before: CryptoStoredRow; after: CryptoRowInput }[];
}

export function diffVersions(current: readonly CryptoStoredRow[], next: readonly CryptoRowInput[]): VersionDiff {
  const pool = new Map<string, CryptoStoredRow[]>();
  for (const r of current) pool.set(`${r.kind}|${r.fingerprint}`, [...(pool.get(`${r.kind}|${r.fingerprint}`) ?? []), r]);
  let unchanged = 0;
  const leftoverNew: CryptoRowInput[] = [];
  for (const r of next) {
    const key = `${r.kind}|${r.fingerprint}`;
    const bucket = pool.get(key);
    if (bucket?.length) {
      bucket.shift();
      unchanged++;
    } else leftoverNew.push(r);
  }
  const leftoverOld = [...pool.values()].flat();
  const oldByPosition = new Map(leftoverOld.map((r) => [`${r.kind}|${r.rowNumber}`, r]));
  const modifiedRows: VersionDiff["modifiedRows"] = [];
  const addedRows: CryptoRowInput[] = [];
  const matchedOld = new Set<number>();
  for (const r of leftoverNew) {
    const before = oldByPosition.get(`${r.kind}|${r.rowNumber}`);
    if (before && !matchedOld.has(before.id)) {
      matchedOld.add(before.id);
      modifiedRows.push({ before, after: r });
    } else addedRows.push(r);
  }
  const removedRows = leftoverOld.filter((r) => !matchedOld.has(r.id));
  return { added: addedRows.length, modified: modifiedRows.length, unchanged, removed: removedRows.length, addedRows, removedRows, modifiedRows };
}

export const summaryOf = (d: VersionDiff): VersionDiffSummary => ({ added: d.added, modified: d.modified, unchanged: d.unchanged, removed: d.removed });
