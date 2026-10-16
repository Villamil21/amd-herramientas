import type { Dispatch, SetStateAction } from "react";
import type { Company, CompanyInput } from "../../types/models";
import type { CompanyImport } from "./import/useCompanyImport";
import type { CompanyErrors } from "./companyValidation";

/** Propiedades comunes de las pestañas de la ficha: los valores viven en el espacio de trabajo y se conservan al cambiar de pestaña. */
export interface TabProps {
  values: CompanyInput;
  setValues: Dispatch<SetStateAction<CompanyInput>>;
  errors: CompanyErrors;
  imports: CompanyImport;
  /** Empresa ya guardada (null mientras se crea). */
  company: Company | null;
}
