/**
 * Foco para abrir directamente un empleado desde un pendiente de Nómina o Exógena. El enrutador lo guarda al recibir
 * `/empleados/{empresa}~{tipo}~{número}` y la pantalla de Empleados lo consume una sola vez al abrir.
 */
export interface EmployeeFocus {
  companyId: number;
  docType: string;
  docNumber: string;
}

let pending: EmployeeFocus | null = null;

export const setEmployeeFocus = (focus: EmployeeFocus | null) => {
  pending = focus;
};

/** Lee y borra el foco. */
export function takeEmployeeFocus(): EmployeeFocus | null {
  const value = pending;
  pending = null;
  return value;
}

export function parseEmployeeFocus(segment: string): EmployeeFocus | null {
  const [company, docType, docNumber] = segment.split("~").map(decodeURIComponent);
  const companyId = Number(company);
  return Number.isInteger(companyId) && companyId > 0 && docType && docNumber ? { companyId, docType, docNumber } : null;
}
