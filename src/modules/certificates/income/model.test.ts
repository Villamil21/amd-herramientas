import { describe, expect, it } from "vitest";
import type { CertificateSigner, IdentityDocumentType } from "../../../types/models";
import { build, closingText, EMPTY_FORM, formatAmount, formatIdentityNumber, parseAmount, personalDocumentLine, spanishDate, validate, type IncomeCertificateForm, type Run } from "./model";

const signer: CertificateSigner = {
  id: 1,
  name: "Leidy Yurani Villamil Caicedo",
  role: "Contadora Pública",
  professionalDocument: "TP-290048",
  personalDocument: "1192729629",
  signatureFile: "firma.png",
  createdAt: "x",
  updatedAt: "x",
  signatureAvailable: true,
};
const cc: IdentityDocumentType = { id: 1, name: "Cédula de Ciudadanía", isNumeric: true, isSystem: true, createdAt: "x", updatedAt: "x" };
const passport: IdentityDocumentType = { id: 3, name: "Pasaporte", isNumeric: false, isSystem: false, createdAt: "x", updatedAt: "x" };

/** Caso del PDF de referencia (Christian). */
const christian: IncomeCertificateForm = {
  ...EMPTY_FORM,
  signerId: 1,
  background: "personal",
  treatment: "mr",
  fullName: "Christian Cruz Escobar",
  identityDocumentTypeId: 1,
  identityDocumentNumber: "1006011707",
  identityDocumentIssuePlace: "Palmira",
  activity: "Support Consultant",
  incomeMode: "with_cop_equivalent",
  currency: "USD",
  monthlyIncome: "1.000",
  copEquivalent: "3.302.018",
  exchangeRateReferenceDate: "2026-09-28",
  issueCity: "Cali",
};
const text = (runs: Run[]) => runs.map((r) => r.text).join("").replace(/\u00a0/g, " ");
const ok = { data: "data:image/png;base64,x", missing: false };

describe("certificado de ingresos", () => {
  it("genera los textos del caso de referencia", () => {
    expect(validate(christian, signer, cc, ok)).toEqual([]);
    const doc = build(christian, signer, cc, ok.data, new Date(2026, 8, 30, 10));
    expect(text(doc.intro)).toBe(
      "Mediante el presente documento y obrando en mi calidad de Contadora Pública titulada mediante resolución expedida por el Ministerio de Educación Nacional a través de la Junta Central de Contadores bajo la Matrícula T-290048.",
    );
    expect(text(doc.holder)).toBe("Que el señor CHRISTIAN CRUZ ESCOBAR, identificado con Cédula de Ciudadanía No. 1.006.011.707, expedida en Palmira.");
    expect(doc.holder.filter((r) => r.bold).map((r) => r.text)).toEqual(["CHRISTIAN CRUZ ESCOBAR", "1.006.011.707"]);
    expect(text(doc.activity)).toBe("Ha trabajado de manera independiente, realizando actividades como Support Consultant.");
    expect(text(doc.concept)).toBe("Servicios como\nSupport Consultant");
    expect(text(doc.value)).toBe("USD 1.000 – Equivalentes aproximadamente a $3.302.018 COP, tomando como referencia la tasa de cambio del 28 de septiembre de 2026.");
    expect(doc.value.filter((r) => r.bold).map((r) => r.text)).toEqual(["USD 1.000", "$3.302.018 COP"]);
    expect(text(doc.closing)).toBe("Para constancia se firma en la ciudad de Cali, a los 30 días del mes de septiembre del año 2026.");
    expect(doc.signerLines).toEqual(["LEIDY YURANI VILLAMIL CAICEDO", "CC 1.192.729.629", "TP. T-290048 JUNTA CENTRAL DE CONTADORES"]);
    expect(doc.fileName).toBe("Certificado de Ingresos - CHRISTIAN CRUZ ESCOBAR.pdf");
  });

  it("nombre en minúsculas y documento con o sin puntos", () => {
    const doc = build({ ...christian, fullName: "  christian   cruz escobar ", identityDocumentNumber: "1.006.011.707" }, signer, cc, ok.data);
    expect(doc.holder[1].text).toBe("CHRISTIAN CRUZ ESCOBAR");
    expect(doc.holder[3].text).toBe("1.006.011.707");
    expect(formatIdentityNumber("1006011707", true)).toBe("1.006.011.707");
    expect(formatIdentityNumber("1 006 011 707", true)).toBe("1.006.011.707");
    expect(formatIdentityNumber("AB12345", true)).toBeNull();
    expect(formatIdentityNumber("  AB 123456 ", false)).toBe("AB 123456");
  });

  it("señora, pasaporte y firmante masculino", () => {
    const doc = build(
      { ...christian, treatment: "mrs", identityDocumentTypeId: 3, identityDocumentNumber: "PE1234567" },
      { ...signer, name: "Juan Pérez", role: "Contador Público", professionalDocument: "T-12345", personalDocument: "" },
      passport,
      ok.data,
    );
    expect(text(doc.intro)).toContain("en mi calidad de Contador Público titulado mediante");
    expect(text(doc.intro)).toContain("Matrícula T-12345.");
    expect(text(doc.holder)).toBe("Que la señora CHRISTIAN CRUZ ESCOBAR, identificada con Pasaporte No. PE1234567, expedido en Palmira.");
    expect(doc.signerLines).toEqual(["JUAN PÉREZ", "TP. T-12345 JUNTA CENTRAL DE CONTADORES"]);
  });

  it("valor directo", () => {
    const cop = build({ ...christian, incomeMode: "direct", currency: "COP", monthlyIncome: "3500000" }, signer, cc, ok.data);
    expect(cop.value).toEqual([{ text: "$3.500.000 COP", bold: true }]);
    const usd = build({ ...christian, incomeMode: "direct", currency: "usd", monthlyIncome: "1000.50" }, signer, cc, ok.data);
    expect(usd.value).toEqual([{ text: "USD 1.000,50", bold: true }]);
  });

  it("interpreta y formatea valores", () => {
    expect(parseAmount("3302018")).toBe(330201800);
    expect(parseAmount("3.302.018")).toBe(330201800);
    expect(parseAmount("1.000")).toBe(100000);
    expect(parseAmount("1000.50")).toBe(100050);
    expect(parseAmount("1.000,50")).toBe(100050);
    expect(parseAmount("$ 1.000")).toBe(100000);
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("1.00.0")).toBeNull();
    expect(formatAmount(330201800, "COP")).toBe("$3.302.018");
    expect(formatAmount(100000, "USD")).toBe("USD 1.000");
    expect(formatAmount(100050, "USD")).toBe("USD 1.000,50");
    expect(formatAmount(99900, "EUR")).toBe("EUR 999");
  });

  it("fechas en español", () => {
    expect(spanishDate("2026-09-28")).toBe("28 de septiembre de 2026");
    expect(spanishDate("2026-02-30")).toBeNull();
    expect(closingText("Cali", new Date(2026, 0, 1))).toBe("Para constancia se firma en la ciudad de Cali, al primer día del mes de enero del año 2026.");
    expect(closingText("Palmira", new Date(2026, 11, 15))).toContain("a los 15 días del mes de diciembre del año 2026.");
  });

  it("identificación del firmante", () => {
    expect(personalDocumentLine("1.192.729.629")).toBe("CC 1.192.729.629");
    expect(personalDocumentLine("cc 1192729629")).toBe("CC 1.192.729.629");
    expect(personalDocumentLine("CE 123456")).toBe("CE 123.456");
    expect(personalDocumentLine("  ")).toBeNull();
  });

  it("valida los campos obligatorios", () => {
    const errors = validate(EMPTY_FORM, null, null, { data: null, missing: false });
    expect(errors).toContain("Selecciona un firmante.");
    expect(errors).toContain("Selecciona el fondo del certificado.");
    expect(errors).toContain("Selecciona el tratamiento (Señor / Señora).");
    expect(errors).toContain("Selecciona la moneda.");
    expect(errors.some((e) => e.includes("COP"))).toBe(false);
    const withoutRate = validate({ ...christian, copEquivalent: "", exchangeRateReferenceDate: "" }, signer, cc, ok);
    expect(withoutRate).toEqual(["Escribe el valor equivalente en COP.", "Indica la fecha de referencia de la tasa de cambio."]);
    expect(validate({ ...christian, currency: "COP" }, signer, cc, ok)).toEqual(["La equivalencia a COP solo aplica cuando el ingreso está en otra moneda."]);
    expect(validate({ ...christian, identityDocumentNumber: "12A" }, signer, cc, ok)).toEqual(["El número de Cédula de Ciudadanía solo puede tener dígitos (y puntos)."]);
    expect(validate(christian, { ...signer, signatureAvailable: false }, cc, ok)[0]).toContain("firma");
  });
});
