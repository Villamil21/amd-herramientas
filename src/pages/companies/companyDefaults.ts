import type { CompanyInput } from "../../types/models";

/** Datos registrales vacíos (empresas nuevas y anteriores a la migración 024) y domicilio de Exógena sin definir (migración 030). */
export const EMPTY_REGISTRAL = {
  entityNarrative: "",
  corporatePurpose: "",
  registryChamber: "",
  registryCity: "",
  constitutionDocType: "",
  constitutionDate: "",
  registryNumber: "",
  registryDate: "",
  registryBook: "",
  registralReview: [] as string[],
  countryCode: "",
  deptCode: "",
  muniCode: "",
};

export const EMPTY_COMPANY_INPUT: CompanyInput = {
  razonSocial: "",
  nit: "",
  direccion: "",
  ciudad: "",
  telefono: "",
  correo: "",
  infoAdicional: "",
  logoFile: null,
  dv: "",
  subscribedTotalShares: null,
  subscribedNominalValue: null,
  paidTotalShares: null,
  paidNominalValue: null,
  ciiuCode: "",
  legalRepName: "",
  legalRepDocument: "",
  legalRepAltName: "",
  legalRepAltDocument: "",
  legalRepManual: false,
  legalRepAltManual: false,
  ...EMPTY_REGISTRAL,
  shareholders: [],
  newDocuments: [],
};
