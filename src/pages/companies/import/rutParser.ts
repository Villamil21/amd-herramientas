import type { PdfDocumentText, PdfPageText, PdfTextItem } from "../../../modules/bank-analysis/shared/pdf/pdfTypes";

export interface RutPerson {
  /** «REPRS LEGAL PRIN», «REPRS LEGAL SUPL»… tal como lo escribe el formulario. */
  role: string;
  isAlternate: boolean;
  /** Nombres y apellidos en el orden «nombres apellidos». */
  name: string;
  documentType: string;
  /** Solo dígitos. */
  documentNumber: string;
}

export interface RutData {
  nit?: string;
  dv?: string;
  razonSocial?: string;
  ciiu?: string;
  ciudad?: string;
  departamento?: string;
  direccion?: string;
  correo?: string;
  telefono?: string;
  /** Persona natural: el nombre sale de los campos de nombres y apellidos. */
  isNaturalPerson: boolean;
  representatives: RutPerson[];
  /** Códigos de «Responsabilidades, Calidades y Atributos» (casilla 53), p. ej. «05», «48». Vacío si no se pudo leer la sección. */
  responsibilities?: string[];
  /** Se leyó la sección de responsabilidades (si no, no se sabe si es responsable de IVA: nunca se supone). */
  responsibilitiesRead?: boolean;
  /** Responsabilidad 48 (Impuesto sobre las ventas - IVA); undefined = la sección no se pudo leer. */
  vatResponsible?: boolean;
  /** AAAA-MM-DD de la casilla 61 (fecha desde la que rige), si el formulario la trae. */
  responsibilityDate?: string;
  notes: string[];
}

/**
 * El RUT es un formulario de la DIAN con casillas numeradas («35. Razón social»). Cada valor se lee
 * por posición respecto a su rótulo: en la misma fila a la derecha o en la fila de abajo, dentro de
 * la columna del rótulo y sin cruzar otro rótulo. Así no depende del orden interno del PDF ni de
 * que el dígito de verificación o los códigos vengan pegados al texto.
 */
const LABEL_LIKE = /^\s*\d{1,3}\.\s*\S/;
const isLabel = (item: PdfTextItem) => LABEL_LIKE.test(item.text);
/** Dígito suelto de una casilla (código de país, de ciudad, fechas…). */
const isBoxDigit = (item: PdfTextItem) => /^\d$/.test(item.text.trim());

const sameRow = (a: PdfTextItem, b: PdfTextItem) => Math.abs(a.y - b.y) <= 2.5;

export interface ReadOptions {
  /** `digits` junta las casillas numéricas; `text` ignora los dígitos sueltos de códigos. */
  mode: "text" | "digits";
  /** Hasta dónde puede estar el valor debajo del rótulo (puntos del PDF). */
  maxDrop?: number;
  /** Cuánto antes del rótulo puede empezar la columna del valor. */
  leftSlack?: number;
}

function column(items: PdfTextItem[], label: PdfTextItem, leftSlack: number): { left: number; right: number } {
  const next = items
    .filter((i) => i !== label && sameRow(i, label) && i.x > label.x + 5 && isLabel(i))
    .map((i) => i.x)
    .sort((a, b) => a - b)[0];
  // El valor de la columna vecina empieza casi pegado a su rótulo: se deja un margen para no tomarlo.
  return { left: label.x - leftSlack, right: next === undefined ? Infinity : next - 4 };
}

function valueOf(items: PdfTextItem[], label: PdfTextItem, options: ReadOptions): string | undefined {
  const { left, right } = column(items, label, options.leftSlack ?? 6);
  const usable = (i: PdfTextItem) => !isLabel(i) && (options.mode === "digits" ? /^[\d\s]+$/.test(i.text) : !isBoxDigit(i));
  const join = (list: PdfTextItem[]) => {
    const sorted = [...list].sort((a, b) => a.x - b.x);
    const text = options.mode === "digits" ? sorted.map((i) => i.text.replace(/\s/g, "")).join("") : sorted.map((i) => i.text.trim()).join(" ");
    return text.replace(/\s+/g, " ").trim() || undefined;
  };

  // 1) En la misma fila, a la derecha del rótulo (correo, teléfonos).
  const beside = items.filter((i) => i !== label && sameRow(i, label) && i.x >= label.x + label.width - 2 && i.x < right && usable(i));
  if (beside.length && options.mode === "text") return join(beside);

  // 2) En las filas de abajo, dentro de la columna. Si antes aparece otro rótulo en la columna, la casilla está vacía.
  const below = items.filter((i) => i.y < label.y - 3 && i.y > label.y - (options.maxDrop ?? 40) && i.x + i.width > left && i.x < right);
  const rows = [...new Set(below.map((i) => Math.round(i.y)))].sort((a, b) => b - a);
  for (const y of rows) {
    const row = below.filter((i) => Math.abs(i.y - y) <= 2.5);
    const inColumn = row.filter((i) => i.x >= left && i.x < right);
    if (inColumn.some(isLabel)) return undefined;
    const values = inColumn.filter(usable);
    if (values.length) return join(values);
  }
  return options.mode === "digits" && beside.length ? join(beside) : undefined;
}

export const pick = (items: PdfTextItem[], re: RegExp): PdfTextItem | undefined => items.find((i) => re.test(i.text));

export function readField(items: PdfTextItem[], re: RegExp, options: ReadOptions): string | undefined {
  const label = pick(items, re);
  return label ? valueOf(items, label, options) : undefined;
}

const DOC_TYPE: Record<string, string> = {
  "cedula de ciudadania": "CC",
  "cedula de extranjeria": "CE",
  "nit": "NIT",
  "pasaporte": "PA",
  "tarjeta de identidad": "TI",
  "registro civil": "RC",
  "permiso especial": "PEP",
  "permiso por proteccion": "PPT",
};

function documentType(raw: string | undefined): string {
  const t = (raw ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const hit = Object.entries(DOC_TYPE).find(([k]) => t.startsWith(k.slice(0, Math.min(k.length, 14))));
  return hit ? hit[1] : (raw ?? "").trim().toUpperCase();
}

function readRepresentatives(pages: PdfPageText[]): RutPerson[] {
  const out: RutPerson[] = [];
  for (const page of pages) {
    const marks = page.items.filter((i) => /^98\.\s*Representaci/i.test(i.text)).sort((a, b) => b.y - a.y);
    marks.forEach((mark, idx) => {
      const lower = marks[idx + 1]?.y ?? -Infinity;
      // Los elementos de este bloque: desde su rótulo «98.» hasta el siguiente.
      const block = page.items.filter((i) => i.y <= mark.y + 1 && i.y > lower + 1);
      const role = readField(block, /^98\.\s*Representaci/i, { mode: "text", maxDrop: 22, leftSlack: 4 });
      const number = readField(block, /^101\.\s*N[úu]mero de identificaci/i, { mode: "digits", maxDrop: 30 });
      const type = readField(block, /^100\.\s*Tipo de documento/i, { mode: "text", maxDrop: 30, leftSlack: 4 });
      const surname1 = readField(block, /^104\.\s*Primer apellido/i, { mode: "text", maxDrop: 25 });
      const surname2 = readField(block, /^105\.\s*Segundo apellido/i, { mode: "text", maxDrop: 25 });
      const name1 = readField(block, /^106\.\s*Primer nombre/i, { mode: "text", maxDrop: 25 });
      const name2 = readField(block, /^107\.\s*Otros nombres/i, { mode: "text", maxDrop: 25 });
      const name = [name1, name2, surname1, surname2].filter(Boolean).join(" ").trim();
      if (!name && !number) return;
      const r = (role ?? "").toUpperCase();
      // Solo representantes legales: apoderados, revisores fiscales, etc. no firman por la empresa.
      if (!/REPR|REPRESENT/.test(r) || !/LEGAL|LEG\b/.test(r)) return;
      out.push({ role: r, isAlternate: /SUPL/.test(r), name, documentType: documentType(type), documentNumber: (number ?? "").replace(/\D/g, "") });
    });
  }
  return out;
}

/**
 * Responsabilidades del RUT: líneas «NN - descripción» entre el rótulo de la sección y la siguiente (usuarios/obligados
 * aduaneros o casilla 54). Se leen por posición vertical en cada página; sin el rótulo de la sección no se supone nada.
 */
export function readResponsibilities(pages: PdfPageText[]): { codes: string[]; read: boolean } {
  const codes = new Set<string>();
  let read = false;
  for (const page of pages) {
    const heading = page.items.find((i) => /Responsabilidades,?\s*Calidades\s*y\s*Atributos/i.test(i.text) || /^53\.\s*C[óo]digo/i.test(i.text));
    if (!heading) continue;
    read = true;
    const end = page.items.filter((i) => i.y < heading.y - 3 && /Usuarios aduaneros|Obligados aduaneros|^54\.\s*C[óo]digo|^55\.|Exportadores/i.test(i.text)).sort((a, b) => b.y - a.y)[0];
    const lower = end ? end.y : -Infinity;
    const rows = page.items.filter((i) => i.y < heading.y - 1 && i.y > lower + 1);
    for (const item of rows) for (const m of item.text.matchAll(/(?:^|\s)(\d{1,2})\s*[-–]\s*[A-Za-zÁ-úÑñ]/g)) codes.add(m[1].padStart(2, "0"));
  }
  return { codes: [...codes].sort(), read };
}

/** Casilla 61 en formato AAAAMMDD (dígitos sueltos o juntos). */
function readResponsibilityDate(items: PdfTextItem[]): string | undefined {
  const raw = readField(items, /^61\.\s*Fecha/i, { mode: "digits", maxDrop: 20 });
  const m = raw && /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function parseRut(doc: PdfDocumentText): RutData {
  const notes: string[] = [];
  const first = doc.pages[0]?.items ?? [];
  if (!first.some((i) => /Registro [ÚU]nico Tributario|Formulario del Registro|N[úu]mero de formulario/i.test(i.text)) && !first.some((i) => /^5\.\s*N[úu]mero de Identificaci/i.test(i.text))) {
    notes.push("El PDF no parece un RUT de la DIAN: no se encontraron las casillas del formulario.");
  }

  const nitLabel = pick(first, /^5\.\s*N[úu]mero de Identificaci[óo]n Tributaria/i);
  let nit: string | undefined;
  let dv: string | undefined;
  if (nitLabel) {
    const dvLabel = pick(first, /^6\.\s*DV/i);
    const rowDigits = (from: number, to: number) =>
      first
        .filter((i) => i.y < nitLabel.y - 3 && i.y > nitLabel.y - 22 && isBoxDigit(i) && i.x >= from && i.x < to)
        .sort((a, b) => a.x - b.x)
        .map((i) => i.text.trim())
        .join("");
    const dvStart = dvLabel ? dvLabel.x - 6 : Infinity;
    const dvEnd = dvLabel ? column(first, dvLabel, 6).right : Infinity;
    nit = rowDigits(nitLabel.x - 6, dvStart) || undefined;
    dv = dvLabel ? rowDigits(dvStart, dvEnd) || undefined : undefined;
  }
  if (!nit) notes.push("No se pudo leer el NIT del RUT.");

  const natural = [readField(first, /^31\.\s*Primer apellido/i, { mode: "text", maxDrop: 20 }), readField(first, /^32\.\s*Segundo apellido/i, { mode: "text", maxDrop: 20 }), readField(first, /^33\.\s*Primer nombre/i, { mode: "text", maxDrop: 20 }), readField(first, /^34\.\s*Otros nombres/i, { mode: "text", maxDrop: 20 })];
  const legalName = readField(first, /^35\.\s*Raz[óo]n social/i, { mode: "text", maxDrop: 20 });
  const isNaturalPerson = !legalName && natural.some(Boolean);
  const razonSocial = legalName ?? (isNaturalPerson ? [natural[2], natural[3], natural[0], natural[1]].filter(Boolean).join(" ") : undefined);
  if (!razonSocial) notes.push("No se pudo leer la razón social del RUT.");

  const ciiu = readField(first, /^46\.\s*C[óo]digo/i, { mode: "digits", maxDrop: 20, leftSlack: 8 });
  const direccion = readField(first, /^41\.\s*Direcci[óo]n principal/i, { mode: "text", maxDrop: 20 });
  const correo = readField(first, /^42\.\s*Correo electr[óo]nico/i, { mode: "text", maxDrop: 20 });
  const telefono = readField(first, /^44\.\s*Tel[ée]fono\s*1/i, { mode: "digits", maxDrop: 14 });
  const ciudad = readField(first, /^40\.\s*Ciudad\/Municipio/i, { mode: "text", maxDrop: 20 });
  const departamento = readField(first, /^39\.\s*Departamento/i, { mode: "text", maxDrop: 20 });
  const cleanCiiu = ciiu && /^\d{4}$/.test(ciiu) ? ciiu : undefined;
  if (ciiu && !cleanCiiu) notes.push("El código CIIU del RUT no tiene el formato esperado de 4 dígitos.");
  if (!cleanCiiu && !ciiu) notes.push("No se pudo leer el código CIIU de la actividad principal.");

  const { codes: responsibilities, read: responsibilitiesRead } = readResponsibilities(doc.pages);

  return {
    nit,
    dv,
    razonSocial: razonSocial ? razonSocial.replace(/\s+/g, " ").trim() : undefined,
    ciiu: cleanCiiu,
    ciudad,
    departamento,
    direccion: direccion?.replace(/\s+/g, " ").trim(),
    correo: correo && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo.replace(/\s/g, "")) ? correo.replace(/\s/g, "").toLowerCase() : undefined,
    telefono: telefono && /^\d{7,12}$/.test(telefono) ? telefono : undefined,
    isNaturalPerson,
    representatives: readRepresentatives(doc.pages),
    responsibilities,
    responsibilitiesRead,
    vatResponsible: responsibilitiesRead ? responsibilities.includes("48") : undefined,
    responsibilityDate: responsibilitiesRead ? readResponsibilityDate(first) : undefined,
    notes,
  };
}
