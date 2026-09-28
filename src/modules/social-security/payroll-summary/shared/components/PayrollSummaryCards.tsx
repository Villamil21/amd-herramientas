import { formatInteger, formatPesos } from "../../../../../utils/format";
import { Stat } from "../../../../bank-analysis/shared/components/Stat";
import type { PayrollSummary } from "../types";

export function PayrollSummaryCards({ summary }: { summary: PayrollSummary }) {
  return (
    <div className="stack stack--sm">
      <div className="stat-row">
        <Stat label="Periodo" value={summary.period} />
        <Stat label="Fecha de pago" value={summary.paymentDate} />
        <Stat label="Pago" value={formatPesos(summary.paymentAmount)} />
      </div>
      <div className="stat-row">
        <Stat label="Total aportes" value={formatPesos(summary.totalContributions)} />
        <Stat label="Intereses de mora" value={formatPesos(summary.lateInterest)} />
        <Stat label="Empleados" value={formatInteger(summary.employeeCount)} />
      </div>
    </div>
  );
}
