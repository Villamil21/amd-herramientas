/** Copia texto al portapapeles (tabulado para pegar en Excel); respaldo con execCommand si el API asíncrono no está disponible. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) throw new Error("No fue posible copiar al portapapeles.");
  }
}

/** Centavos → pesos para pegar en Excel: sin «$» ni puntos de miles; coma decimal solo si hay centavos. */
export const pastePesos = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace(".", ","));

/** Filas → texto tabulado (una fila por línea). */
export const tabulate = (rows: (string | number)[][]) => rows.map((r) => r.join("\t")).join("\n");
