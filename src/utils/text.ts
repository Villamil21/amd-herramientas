/** Minúsculas, sin tildes y con espacios colapsados: para comparar textos. */
export function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Copia ordenada alfabéticamente por `name` (español, sin distinguir mayúsculas ni tildes). */
export function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
}
