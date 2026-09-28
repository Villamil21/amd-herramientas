import { formatInteger } from "../../../../../utils/format";
import { FIELD, UIAF_FIELD_COUNT, type UiafCheck, type UiafReport, type UiafValidation } from "../types";

const MAX_LISTED = 5;

/** Los primeros casos y cuántos más hay. */
function listed(messages: string[]): string[] {
  if (messages.length <= MAX_LISTED) return messages;
  return [...messages.slice(0, MAX_LISTED), `… y ${formatInteger(messages.length - MAX_LISTED)} más.`];
}

const plural = (n: number, one: string, many: string) => `${formatInteger(n)} ${n === 1 ? one : many}`;

/**
 * Controles del TXT. Nunca modifican registros: si algo no cuadra, solo se
 * informa. El archivo es válido si tiene encabezado y cierre reconocibles,
 * todas las líneas tienen 26 campos, las cantidades declaradas coinciden,
 * todos los Códigos Tipo son conocidos y la numeración no tiene vacíos,
 * duplicados ni saltos.
 */
export function validateUiaf(report: UiafReport): UiafValidation {
  const checks: UiafCheck[] = [structure(report), fieldCount(report), declaredCounts(report), codeTypes(report), recordNumbers(report)];
  return { valid: checks.every((c) => c.status === "ok"), checks };
}

function structure({ header, footer, detailLines }: UiafReport): UiafCheck {
  const label = "Estructura: encabezado, registros de detalle y cierre";
  const details: string[] = [];
  if (!header) details.push("No se encontró el encabezado de control en la primera línea.");
  else if (!header.parsed) details.push(`El encabezado de control (línea ${header.line}) no tiene el formato esperado: «${header.text.trim()}».`);
  if (!footer) details.push("No se encontró el registro final de control en la última línea.");
  else if (!footer.parsed) details.push(`El registro final de control (línea ${footer.line}) no tiene el formato esperado: «${footer.text.trim()}».`);
  if (header?.parsed && footer?.parsed && header.parsed.entityCode !== footer.parsed.entityCode) {
    details.push(`El código de la entidad del encabezado (${header.parsed.entityCode}) no coincide con el del cierre (${footer.parsed.entityCode}).`);
  }
  if (detailLines === 0) details.push("El archivo no tiene registros de detalle.");
  return details.length ? { id: "structure", label, status: "failed", details } : { id: "structure", label, status: "ok" };
}

function fieldCount({ invalid }: UiafReport): UiafCheck {
  const label = `Cada registro tiene ${UIAF_FIELD_COUNT} campos`;
  if (invalid.length === 0) return { id: "fields", label, status: "ok" };
  return {
    id: "fields",
    label,
    status: "failed",
    details: [`${plural(invalid.length, "fila inválida", "filas inválidas")}: no se reparten en columnas y se exportan aparte, en la hoja «Filas inválidas».`, ...listed(invalid.map((i) => i.reason))],
  };
}

function declaredCounts({ header, footer, detailLines }: UiafReport): UiafCheck {
  const label = "Cantidad de registros declarada en el encabezado y el cierre";
  const declared = [
    { where: "El encabezado", count: header?.parsed?.declaredCount },
    { where: "El registro final de control", count: footer?.parsed?.declaredCount },
  ].filter((d): d is { where: string; count: number } => d.count !== undefined);
  if (declared.length === 0) return { id: "counts", label, status: "unavailable", details: ["No fue posible leer la cantidad declarada en el encabezado ni en el cierre."] };
  const details = declared
    .filter((d) => d.count !== detailLines)
    .map((d) => `${d.where} indica ${plural(d.count, "registro", "registros")}, pero se encontraron ${formatInteger(detailLines)}.`);
  return details.length ? { id: "counts", label, status: "failed", details } : { id: "counts", label, status: "ok" };
}

function codeTypes({ groups }: UiafReport): UiafCheck {
  const label = "Códigos Tipo reconocidos";
  const unknown = groups.filter((g) => !g.known && g.records.length > 0);
  if (unknown.length === 0) return { id: "types", label, status: "ok" };
  return {
    id: "types",
    label,
    status: "failed",
    details: unknown.map((g) =>
      g.codeType === ""
        ? `${plural(g.records.length, "registro no tiene", "registros no tienen")} Código Tipo; se exportan en la hoja «${g.sheetName}».`
        : `Se encontró un Código Tipo no reconocido: ${g.codeType} (${plural(g.records.length, "registro", "registros")}); se exportan en la hoja «${g.sheetName}».`,
    ),
  };
}

/** N° Registro: sin vacíos, numérico, sin duplicados y consecutivo en el orden del archivo. */
function recordNumbers({ records }: UiafReport): UiafCheck {
  const label = "Numeración de registros (sin vacíos, duplicados ni saltos)";
  const details: string[] = [];
  const seen = new Map<string, number>();
  let previous: bigint | undefined;
  for (const r of records) {
    const raw = r.values[FIELD.recordNumber];
    const value = raw.trim();
    if (value === "") {
      details.push(`Línea ${r.line}: el N° Registro está vacío.`);
      continue;
    }
    if (!/^\d+$/.test(value)) {
      details.push(`Línea ${r.line}: el N° Registro «${raw}» no es un número.`);
      continue;
    }
    const first = seen.get(value);
    if (first !== undefined) details.push(`N° Registro ${value} duplicado (líneas ${first} y ${r.line}).`);
    else seen.set(value, r.line);
    const n = BigInt(value);
    if (previous !== undefined && first === undefined && n !== previous + 1n) {
      details.push(`Línea ${r.line}: después del N° Registro ${previous} sigue el ${n}.`);
    }
    previous = n;
  }
  return details.length ? { id: "numbers", label, status: "failed", details: listed(details) } : { id: "numbers", label, status: "ok" };
}
