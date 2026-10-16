import type { ReactNode } from "react";
import { Card, DateInput, Field } from "../../../../components/ui";
import type { Company } from "../../../../types/models";
import { CompanySelect } from "../../shared/components/CompanySelect";

interface Props {
  companies: Company[] | null;
  companyId: number | null;
  onCompany: (id: number | null) => void;
  cut: string;
  onCut: (value: string) => void;
  /** Datos de la empresa (cobertura, periodicidad…): debajo de los parámetros. */
  context?: ReactNode;
  /** Botones de acción (Configuración PUC, Registrar sin obligación, Importar): fila propia debajo de los parámetros. */
  actions?: ReactNode;
}

/**
 * Parámetros comunes de Retefuente, IVA y Renta: Empresa y Fecha de corte son parámetros de primer nivel, en la misma
 * grilla, con la misma línea de etiquetas y campos y la ayuda debajo de cada uno. Las acciones van en una fila aparte.
 */
export function TaxParamsBar({ companies, companyId, onCompany, cut, onCut, context, actions }: Props) {
  return (
    <Card className="tax-params">
      <div className="tax-params__grid">
        <CompanySelect companies={companies} value={companyId} onChange={onCompany} hint="Las declaraciones y su efecto contable pertenecen a esta empresa." />
        <Field label="Fecha de corte" required hint="Pagos hasta esta fecha reducen el saldo.">
          {(id) => <DateInput id={id} value={cut} onChange={onCut} />}
        </Field>
      </div>
      {context}
      {actions && <div className="tax-params__actions">{actions}</div>}
    </Card>
  );
}
