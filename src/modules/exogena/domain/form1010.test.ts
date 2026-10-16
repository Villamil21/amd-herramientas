import { describe, expect, it } from "vitest";
import { FORMAT_1010_COLUMNS } from "./formats";
import { buildProposals1010, check1010, checkRecord1010, pendingChanges, shareholderRow, sourceKey1010 } from "./form1010";
import { CATALOG_INDEX, company, shareholder, stored } from "./fixtures";

const problems = (data: Record<string, unknown>) => checkRecord1010({ sourceKey: "shareholder:1", data }, CATALOG_INDEX).map((p) => p.field);

describe("1010 — encabezados", () => {
  it("las 16 columnas, en el orden pactado", () => {
    expect(FORMAT_1010_COLUMNS.map((c) => c.header)).toEqual([
      "Tipo de documento",
      "Número identificación del socio o accionista",
      "DV",
      "Primer apellido del accionista",
      "Segundo apellido del accionista",
      "Primer nombre del accionista",
      "Otros nombres del accionista",
      "Razón social del accionista",
      "Dirección",
      "Código departamento",
      "Código municipio",
      "País residencia o domicilio",
      "Valor nominal de la acción, aporte o derecho social a 31 diciembre",
      "Valor prima en colocación de acciones a 31 diciembre",
      "Porcentaje de participación",
      "Porcentaje de participación (posición decimal)",
    ]);
  });
});

describe("1010 — persona natural y jurídica", () => {
  it("persona natural: tipo del RUT/ficha, nombres separados, DV y razón social vacíos", () => {
    const row = shareholderRow(shareholder(), 100_000_000);
    expect(row).toMatchObject({ docTypeCode: "13", docNumber: "1192816998", dv: "", firstSurname: "ANGARITA", secondSurname: "LOPEZ", firstName: "RONALDO", businessName: "", deptCode: "76", muniCode: "001", countryCode: "169", nominalValue: 100_000_000, premium: 0 });
  });

  it("persona jurídica: tipo 31, NIT con DV, nombres vacíos y razón social", () => {
    const row = shareholderRow(shareholder({ name: "INVERSIONES DYP SAS", personType: "PJ", docTypeCode: "13", identityDocument: "NIT 900.123.456", dv: "7", firstName: "X", firstSurname: "Y" }), 1);
    expect(row).toMatchObject({ docTypeCode: "31", docNumber: "900123456", dv: "7", firstSurname: "", firstName: "", businessName: "INVERSIONES DYP SAS" });
  });

  it("un socio anterior a la ficha toma el tipo del prefijo conocido («CC» → 13), pero no inventa lo demás", () => {
    const legacy = shareholder({ docTypeCode: null, personType: null, firstName: "", firstSurname: "", address: "", countryCode: "", deptCode: "", muniCode: "" });
    const row = shareholderRow(legacy, 1);
    expect(row.docTypeCode).toBe("13");
    const fields = problems(row);
    expect(fields).toContain("personType");
    expect(fields).toContain("address");
    expect(fields).toContain("countryCode");
  });

  it("fuera de Colombia no se reportan departamento ni municipio", () => {
    const row = shareholderRow(shareholder({ countryCode: "249", deptCode: "76", muniCode: "001" }), 1);
    expect([row.deptCode, row.muniCode]).toEqual(["", ""]);
    expect(problems(row)).toEqual([]);
  });
});

describe("1010 — porcentaje y capital", () => {
  it("50,20 % se separa en 50 y 20; 50 % en 50 y 0", () => {
    const a = shareholder({ id: 1, percentage: 50.2 });
    const b = shareholder({ id: 2, name: "OTRA", identityDocument: "CC 22517821", percentage: 49.8 });
    const proposals = buildProposals1010(company([a, b]));
    expect(proposals.map((p) => [p.data.pctInteger, p.data.pctDecimal])).toEqual([[50, 20], [49, 80]]);
    const half = buildProposals1010(company([shareholder({ id: 1, percentage: 50 }), shareholder({ id: 2, percentage: 50 })]));
    expect(half.map((p) => [p.data.pctInteger, p.data.pctDecimal])).toEqual([[50, 0], [50, 0]]);
  });

  it("el valor nominal es el capital suscrito asignado al socio (no el valor unitario de la acción) y suma el total", () => {
    const shareholders = [shareholder({ id: 1, percentage: 33.33 }), shareholder({ id: 2, percentage: 33.33 }), shareholder({ id: 3, percentage: 33.34 })];
    const proposals = buildProposals1010(company(shareholders, { subscribedTotalShares: 10, subscribedNominalValue: 10 }));
    const values = proposals.map((p) => p.data.nominalValue as number);
    expect(values).toEqual([33, 33, 34]);
    expect(values.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("sin capital suscrito configurado el valor nominal queda pendiente", () => {
    const proposals = buildProposals1010(company([shareholder()], { subscribedTotalShares: null, subscribedNominalValue: null }));
    expect(proposals[0].data.nominalValue).toBeNull();
    expect(problems(proposals[0].data)).toContain("nominalValue");
  });

  it("la clave de origen es estable por socio y los socios sin guardar no se proponen", () => {
    const proposals = buildProposals1010(company([shareholder({ id: 7 }), shareholder({ id: undefined })]));
    expect(proposals.map((p) => p.sourceKey)).toEqual([sourceKey1010(7)]);
  });
});

describe("1010 — validación y estado «listo»", () => {
  const good = (overrides: Record<string, unknown> = {}) => ({ ...shareholderRow(shareholder(), 100_000_000), ...overrides });

  it("un registro completo no tiene pendientes", () => expect(problems(good())).toEqual([]));

  it("detecta datos territoriales inválidos (municipio de otro departamento, país o tipo fuera de catálogo)", () => {
    expect(problems(good({ deptCode: "05", muniCode: "999" }))).toEqual(["muniCode"]);
    expect(problems(good({ deptCode: "99" }))).toContain("deptCode");
    expect(problems(good({ countryCode: "999" }))).toContain("countryCode");
    expect(problems(good({ docTypeCode: "99" }))).toContain("docTypeCode");
  });

  it("PJ exige 31, DV y razón social; PN no admite razón social", () => {
    const pj = good({ personType: "PJ", docTypeCode: "13", dv: "", businessName: "", firstSurname: "", firstName: "" });
    expect(problems(pj)).toEqual(expect.arrayContaining(["docTypeCode", "businessName"]));
    expect(problems(good({ businessName: "ALGO" }))).toContain("businessName");
    expect(problems(good({ docTypeCode: "31" }))).toContain("dv");
    expect(problems(good({ dv: "5" }))).toContain("dv");
  });

  it("porcentaje inválido o columnas que no coinciden bloquean", () => {
    expect(problems(good({ percentage: 50.123 }))).toContain("percentage");
    expect(problems(good({ percentage: 50.2, pctInteger: 50, pctDecimal: 2 }))).toContain("pctInteger");
    expect(problems(good({ premium: 5 }))).toContain("premium");
  });

  it("una advertencia de RUT por resolver bloquea", () => expect(problems(good({ rutStatus: "revisar" }))).toContain("rutStatus"));

  it("el conjunto debe sumar 100,00 % y el capital asignado coincidir con el suscrito", () => {
    const base = company([shareholder({ id: 1, percentage: 60 }), shareholder({ id: 2, percentage: 40, name: "B", identityDocument: "CC 5" })]);
    const ok = buildProposals1010(base).map((p) => ({ sourceKey: p.sourceKey, data: p.data }));
    expect(check1010(ok, base, CATALOG_INDEX)).toEqual([]);
    const wrongPct = ok.map((r, i) => (i === 0 ? { ...r, data: { ...r.data, percentage: 50, pctInteger: 50, pctDecimal: 0 } } : r));
    expect(check1010(wrongPct, base, CATALOG_INDEX).map((p) => p.message).join(" ")).toContain("90,00 %");
    const wrongCapital = ok.map((r, i) => (i === 0 ? { ...r, data: { ...r.data, nominalValue: 1 } } : r));
    expect(check1010(wrongCapital, base, CATALOG_INDEX).map((p) => p.message).join(" ")).toContain("capital suscrito");
    expect(check1010([], base, CATALOG_INDEX)[0].message).toContain("No aplica");
  });
});

describe("1010 — cambios pendientes desde Empresas", () => {
  it("detecta nuevos, cambiados y retirados; ignora lo corregido a mano", () => {
    const base = company([shareholder({ id: 1, percentage: 60 }), shareholder({ id: 2, percentage: 40, name: "B", identityDocument: "CC 5" })]);
    const proposals = buildProposals1010(base);
    const saved = proposals.map((p, i) => stored(p, { id: i + 1 }));
    expect(pendingChanges(saved, proposals)).toEqual([]);

    const edited = company([shareholder({ id: 1, percentage: 60, address: "CL NUEVA 9" }), shareholder({ id: 3, percentage: 40, name: "C", identityDocument: "CC 7" })]);
    const changes = pendingChanges(saved, buildProposals1010(edited));
    expect(changes).toEqual([
      { sourceKey: "shareholder:1", kind: "changed", fields: ["address"] },
      { sourceKey: "shareholder:3", kind: "new", fields: [] },
      { sourceKey: "shareholder:2", kind: "removed", fields: [] },
    ]);

    // Si la dirección fue corregida a mano en Exógena, ese cambio de Empresas no se cuenta como pendiente.
    const manual = saved.map((r) => (r.sourceKey === "shareholder:1" ? { ...r, manualFields: ["address"], data: { ...r.data, address: "MI CORRECCION" } } : r));
    expect(pendingChanges(manual, buildProposals1010(edited)).find((c) => c.sourceKey === "shareholder:1")).toBeUndefined();
  });
});
