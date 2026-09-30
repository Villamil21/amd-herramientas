import type { CertificateSigner, IdentityDocumentType } from "../../../types/models";

export type Background = "personal" | "corporate";
export type Treatment = "mr" | "mrs";
export type IncomeMode = "direct" | "with_cop_equivalent";

/** Formulario tal como lo escribe el usuario: los valores se interpretan al construir el certificado. */
export type IncomeCertificateForm = {
  signerId: number | null;
  background: Background | null;
  treatment: Treatment | null;
  fullName: string;
  identityDocumentTypeId: number | null;
  identityDocumentNumber: string;
  identityDocumentIssuePlace: string;
  activity: string;
  incomeMode: IncomeMode;
  /** Código de moneda (COP, USD, EUR u otro de 3 letras). */
  currency: string;
  monthlyIncome: string;
  copEquivalent: string;
  /** yyyy-mm-dd (input type="date"). */
  exchangeRateReferenceDate: string;
  issueCity: string;
};

export const EMPTY_FORM: IncomeCertificateForm = {
  signerId: null,
  background: null,
  treatment: null,
  fullName: "",
  identityDocumentTypeId: null,
  identityDocumentNumber: "",
  identityDocumentIssuePlace: "",
  activity: "",
  incomeMode: "direct",
  currency: "",
  monthlyIncome: "",
  copEquivalent: "",
  exchangeRateReferenceDate: "",
  issueCity: "Cali",
};

export const CURRENCIES = ["COP", "USD", "EUR"] as const;

/** Texto con partes en negrita (ej. el nombre del titular dentro del párrafo). */
export type Run = { text: string; bold?: boolean };

export type IncomeDocument = {
  background: Background;
  signature: string;
  intro: Run[];
  holder: Run[];
  activity: Run[];
  incomeIntro: Run[];
  /** Celda CONCEPTO: "Servicios como" + actividad (el "\n" es un salto de línea forzado). */
  concept: Run[];
  value: Run[];
  supports: Run[];
  closing: Run[];
  /** Nombre, identificación (si existe) y matrícula del firmante. */
  signerLines: string[];
  fileName: string;
};

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const collapse = (value: string) => value.trim().replace(/\s+/g, " ");

/** "christian  cruz escobar" → "CHRISTIAN CRUZ ESCOBAR". */
export const normalizeName = (value: string) => collapse(value).toLocaleUpperCase("es-CO");

/** "1006011707" → "1.006.011.707". Solo dígitos. */
export function groupThousands(digits: string): string {
  const clean = digits.replace(/^0+(?=\d)/, "");
  return clean.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Documentos numéricos: se quitan puntos y espacios y se vuelve a agrupar
 * (1006011707 y 1.006.011.707 → 1.006.011.707). Alfanuméricos: tal cual,
 * solo sin espacios sobrantes. `null` si un tipo numérico trae letras.
 */
export function formatIdentityNumber(value: string, isNumeric: boolean): string | null {
  if (!isNumeric) return collapse(value);
  const digits = value.replace(/[.\s]/g, "");
  return /^\d+$/.test(digits) ? groupThousands(digits) : null;
}

/**
 * Interpreta un valor escrito a mano y lo devuelve en centavos.
 * - Con coma: la coma es decimal y los puntos son miles (1.000,50).
 * - Sin coma: varios puntos o un punto seguido de 3 dígitos son miles (3.302.018, 1.000);
 *   un punto con 1–2 decimales es decimal (1000.50).
 */
export function parseAmount(text: string): number | null {
  let value = text.replace(/[\s$]/g, "");
  if (!value) return null;
  if (value.includes(",")) {
    if (!/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(value)) return null;
    value = value.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(value)) {
    value = value.replace(/\./g, "");
  } else if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    return null;
  }
  const [int, dec = ""] = value.split(".");
  const cents = Number(int) * 100 + Number(dec.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

/** 100050 → "1.000,50"; 100000 → "1.000". */
function formatCents(cents: number): string {
  const int = groupThousands(String(Math.floor(cents / 100)));
  const dec = cents % 100;
  return dec ? `${int},${String(dec).padStart(2, "0")}` : int;
}

/** COP → "$3.302.018"; otras monedas → "USD 1.000" / "USD 1.000,50". */
export function formatAmount(cents: number, currency: string): string {
  return currency === "COP" ? `$${formatCents(cents)}` : `${currency} ${formatCents(cents)}`;
}

/** "2026-09-28" → "28 de septiembre de 2026" (sin zona horaria: la fecha escrita es la que se muestra). */
export function spanishDate(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate()) return null;
  return `${day} de ${MONTHS[month - 1]} de ${year}`;
}

/** "Para constancia se firma en la ciudad de Cali, a los 30 días del mes de septiembre del año 2026." */
export function closingText(city: string, at: Date): string {
  const day = at.getDate();
  const when = day === 1 ? "al primer día" : `a los ${day} días`;
  return `Para constancia se firma en la ciudad de ${collapse(city)}, ${when} del mes de ${MONTHS[at.getMonth()]} del año ${at.getFullYear()}.`;
}

/** El cargo define la concordancia: "Contadora Pública" → titulada; "Contador Público" → titulado. */
export function titledFor(role: string): string {
  const first = collapse(role).split(" ")[0]?.toLocaleLowerCase("es-CO") ?? "";
  return first.endsWith("a") ? "titulada" : "titulado";
}

/** Concordancia con el tipo de documento: "Cédula …" → expedida; "Pasaporte", "NIT" → expedido. */
export function issuedFor(documentTypeName: string): string {
  const first = collapse(documentTypeName).split(" ")[0]?.toLocaleLowerCase("es-CO") ?? "";
  return first.endsWith("a") ? "expedida" : "expedido";
}

/** Igual que en Composición Accionaria: "TP-290048" → "290048". */
export const professionalNumber = (signer: CertificateSigner) => signer.professionalDocument.replace(/\D/g, "");

/**
 * Identificación personal del firmante para el bloque de firma.
 * "1192729629" → "CC 1.192.729.629"; "CE 12345" → "CE 12.345"; otros formatos, tal cual.
 */
export function personalDocumentLine(value: string): string | null {
  const text = collapse(value);
  if (!text) return null;
  if (/^[\d.\s]+$/.test(text)) return `CC ${groupThousands(text.replace(/\D/g, ""))}`;
  const match = /^([A-Za-zÁÉÍÓÚáéíóúÑñ.]{1,6})\s*([\d.\s]+)$/.exec(text);
  return match ? `${match[1].toLocaleUpperCase("es-CO")} ${groupThousands(match[2].replace(/\D/g, ""))}` : text;
}

/** "Certificado de Ingresos - CHRISTIAN CRUZ ESCOBAR.pdf" (sin caracteres no válidos en nombres de archivo). */
export const fileNameFor = (fullName: string) => `Certificado de Ingresos - ${normalizeName(fullName).replace(/[\\/:*?"<>|]/g, "")}.pdf`;

const withoutFinalPeriod = (value: string) => collapse(value).replace(/\.+$/, "");

export function currencyCode(form: IncomeCertificateForm): string {
  return form.currency.trim().toUpperCase();
}

/** Mensajes de lo que falta o no es válido. Vacío = se puede generar. */
export function validate(
  form: IncomeCertificateForm,
  signer: CertificateSigner | null,
  documentType: IdentityDocumentType | null,
  signature: { data: string | null; missing: boolean },
): string[] {
  const errors: string[] = [];
  if (!signer) errors.push("Selecciona un firmante.");
  else if (signature.missing || !signer.signatureAvailable) errors.push("La imagen de firma de este firmante no está disponible. Edita el firmante y vuelve a cargar su firma.");
  else if (!signature.data) errors.push("Cargando la firma del firmante…");
  if (!form.background) errors.push("Selecciona el fondo del certificado.");
  if (!form.treatment) errors.push("Selecciona el tratamiento (Señor / Señora).");
  if (!collapse(form.fullName)) errors.push("Escribe el nombre completo del titular.");
  if (!documentType) errors.push("Selecciona el tipo de documento.");
  if (!collapse(form.identityDocumentNumber)) errors.push("Escribe el número de documento.");
  else if (documentType && formatIdentityNumber(form.identityDocumentNumber, documentType.isNumeric) === null)
    errors.push(`El número de ${documentType.name} solo puede tener dígitos (y puntos).`);
  if (!collapse(form.identityDocumentIssuePlace)) errors.push("Escribe el lugar de expedición del documento.");
  if (!withoutFinalPeriod(form.activity)) errors.push("Escribe la actividad independiente.");
  const currency = currencyCode(form);
  if (!currency) errors.push("Selecciona la moneda.");
  else if (!/^[A-Z]{3}$/.test(currency)) errors.push("La moneda debe ser un código de 3 letras (ej. USD).");
  if (!form.monthlyIncome.trim()) errors.push("Escribe el valor de ingreso promedio mensual.");
  else if (parseAmount(form.monthlyIncome) === null) errors.push("El valor de ingreso no es válido (ej. 3.500.000 o 1000,50).");
  if (form.incomeMode === "with_cop_equivalent") {
    if (currency === "COP") errors.push("La equivalencia a COP solo aplica cuando el ingreso está en otra moneda.");
    if (!form.copEquivalent.trim()) errors.push("Escribe el valor equivalente en COP.");
    else if (parseAmount(form.copEquivalent) === null) errors.push("El valor equivalente en COP no es válido.");
    if (!form.exchangeRateReferenceDate) errors.push("Indica la fecha de referencia de la tasa de cambio.");
    else if (!spanishDate(form.exchangeRateReferenceDate)) errors.push("La fecha de la tasa de cambio no es válida.");
  }
  if (!collapse(form.issueCity)) errors.push("Escribe la ciudad de expedición del certificado.");
  return errors;
}

/** Construye todos los textos del certificado. Llamar solo cuando `validate` no devuelve errores. */
export function build(form: IncomeCertificateForm, signer: CertificateSigner, documentType: IdentityDocumentType, signature: string, generatedAt = new Date()): IncomeDocument {
  const name = normalizeName(form.fullName);
  const number = formatIdentityNumber(form.identityDocumentNumber, documentType.isNumeric) ?? collapse(form.identityDocumentNumber);
  const activity = withoutFinalPeriod(form.activity);
  const currency = currencyCode(form);
  const income = formatAmount(parseAmount(form.monthlyIncome) ?? 0, currency);
  const mrs = form.treatment === "mrs";
  const tp = professionalNumber(signer);

  const value: Run[] =
    form.incomeMode === "with_cop_equivalent"
      ? [
          { text: income, bold: true },
          { text: " – Equivalentes aproximadamente a " },
          { text: `${formatAmount(parseAmount(form.copEquivalent) ?? 0, "COP")} COP`, bold: true },
          { text: `, tomando como referencia la tasa de cambio del ${spanishDate(form.exchangeRateReferenceDate)}.` },
        ]
      : [{ text: currency === "COP" ? `${income} COP` : income, bold: true }];

  return {
    background: form.background ?? "personal",
    signature,
    intro: [
      {
        text: `Mediante el presente documento y obrando en mi calidad de ${collapse(signer.role)} ${titledFor(signer.role)} mediante resolución expedida por el Ministerio de Educación Nacional a través de la Junta Central de Contadores bajo la Matrícula T-${tp}.`,
      },
    ],
    holder: [
      { text: `Que ${mrs ? "la señora" : "el señor"} ` },
      { text: name, bold: true },
      // Espacio no separable: "No." nunca queda al final de una línea sin su número.
      { text: `, ${mrs ? "identificada" : "identificado"} con ${collapse(documentType.name)} No.\u00a0` },
      { text: number, bold: true },
      { text: `, ${issuedFor(documentType.name)} en ${collapse(form.identityDocumentIssuePlace)}.` },
    ],
    activity: [{ text: `Ha trabajado de manera independiente, realizando actividades como ${activity}.` }],
    incomeIntro: [{ text: "Percibe ingresos promedio mensuales derivados de su actividad independiente, los cuales se detallan a continuación:" }],
    concept: [{ text: `Servicios como\n${activity}` }],
    value,
    supports: [
      {
        text: "La documentación revisada comprende los soportes correspondientes, los cuales fueron verificados y permiten certificar que los ingresos aquí declarados reflejan los ingresos percibidos por el titular.",
      },
    ],
    closing: [{ text: closingText(form.issueCity, generatedAt) }],
    signerLines: [normalizeName(signer.name), personalDocumentLine(signer.personalDocument), `TP. T-${tp} JUNTA CENTRAL DE CONTADORES`].filter((line): line is string => !!line),
    fileName: fileNameFor(form.fullName),
  };
}
