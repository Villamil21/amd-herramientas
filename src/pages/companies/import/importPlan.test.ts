import { describe, expect, it } from "vitest";
import type { CamaraData } from "./camaraParser";
import { planImport, type ImportableValues } from "./importPlan";
import type { RutData } from "./rutParser";

const EMPTY: ImportableValues = { razonSocial: "", nit: "", dv: "", ciiuCode: "", ciudad: "", direccion: "", correo: "", telefono: "", subscribedTotalShares: null, subscribedNominalValue: null, paidTotalShares: null, paidNominalValue: null };

const rut = (extra: Partial<RutData> = {}): RutData => ({ nit: "901679752", dv: "3", razonSocial: "NFES SOLUTIONS S.A.S.", ciiu: "6201", ciudad: "Sincelejo", direccion: "DG 35 34 29 CA 2", correo: "info@nfessolutions.com", telefono: "3108072906", isNaturalPerson: false, representatives: [], notes: [], ...extra });
const camara = (extra: Partial<CamaraData> = {}): CamaraData => ({ razonSocial: "NFES SOLUTIONS S.A.S.", nit: "901679752", dv: "3", subscribed: { shares: 50_000, nominal: 1000 }, paid: { shares: 10_000, nominal: 1000 }, principals: [], alternates: [], notes: [], ...extra });

describe("prellenado desde el RUT y la Cámara", () => {
  it("rellena lo vacío con su origen y sin discrepancias cuando ambos documentos coinciden", () => {
    const plan = planImport(EMPTY, rut(), camara());
    expect(plan.conflicts).toEqual([]);
    expect(plan.apply).toMatchObject({ razonSocial: "NFES SOLUTIONS S.A.S.", nit: "901679752", ciiuCode: "6201", ciudad: "Sincelejo", subscribedTotalShares: 50_000, paidTotalShares: 10_000, paidNominalValue: 1000 });
    expect(plan.origin.razonSocial).toEqual(["rut", "camara"]);
    expect(plan.origin.ciiuCode).toEqual(["rut"]);
    expect(plan.origin.subscribedTotalShares).toEqual(["camara"]);
  });

  it("si RUT y Cámara difieren en una propiedad, no aplica ninguno y exige elegir", () => {
    const plan = planImport(EMPTY, rut({ razonSocial: "NFES SOLUTIONS SAS" }), camara({ razonSocial: "NFES SOLUCIONES S.A.S." }));
    const conflict = plan.conflicts.find((c) => c.field === "razonSocial")!;
    expect(conflict.options.map((o) => [o.source, o.value])).toEqual([["rut", "NFES SOLUTIONS SAS"], ["camara", "NFES SOLUCIONES S.A.S."]]);
    expect(plan.apply.razonSocial).toBeUndefined();
    // El resto sigue sin conflicto.
    expect(plan.conflicts).toHaveLength(1);
  });

  it("diferencias solo de mayúsculas, tildes o puntuación del NIT no son discrepancias", () => {
    const plan = planImport(EMPTY, rut({ razonSocial: "Nfes   Solutions S.A.S.", nit: "901.679.752" }), camara());
    expect(plan.conflicts).toEqual([]);
  });

  it("no pisa en silencio lo que el usuario ya escribió: lo presenta como discrepancia con el valor actual", () => {
    const plan = planImport({ ...EMPTY, ciudad: "BARRANQUILLA", direccion: "DG 35 34 29 CA 2", subscribedTotalShares: 40_000, subscribedNominalValue: 1000 }, rut(), camara());
    const fields = plan.conflicts.map((c) => c.field).sort();
    expect(fields).toEqual(["ciudad", "subscribedTotalShares"]);
    const city = plan.conflicts.find((c) => c.field === "ciudad")!;
    expect(city.options.map((o) => o.source)).toEqual(["current", "rut"]);
    // Lo que coincide con lo actual no se pregunta ni se vuelve a aplicar.
    expect(plan.apply.direccion).toBeUndefined();
    expect(plan.apply.subscribedNominalValue).toBeUndefined();
  });

  it("con tres valores distintos ofrece actual, RUT y Cámara", () => {
    const plan = planImport({ ...EMPTY, nit: "800000001" }, rut(), camara({ nit: "901679753" }));
    expect(plan.conflicts.find((c) => c.field === "nit")!.options.map((o) => o.source)).toEqual(["current", "rut", "camara"]);
  });

  it("no inventa lo que el documento no trae", () => {
    const plan = planImport(EMPTY, rut({ ciiu: undefined, telefono: undefined }), null);
    expect(plan.apply.ciiuCode).toBeUndefined();
    expect(plan.apply.telefono).toBeUndefined();
    expect(plan.apply.subscribedTotalShares).toBeUndefined();
  });
});
