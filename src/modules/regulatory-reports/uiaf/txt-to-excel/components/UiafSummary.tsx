import { formatInteger } from "../../../../../utils/format";
import { Stat } from "../../../../bank-analysis/shared/components/Stat";
import type { UiafReport } from "../types";

export function UiafSummary({ report }: { report: UiafReport }) {
  return (
    <div className="stat-row">
      <Stat label="Registros totales" value={formatInteger(report.records.length + report.invalid.length)} />
      {report.groups
        .filter((g) => g.known || g.records.length > 0)
        .map((g) => (
          <Stat key={g.codeType} label={g.label} value={formatInteger(g.records.length)} />
        ))}
      <Stat label="Filas inválidas" value={formatInteger(report.invalid.length)} tone={report.invalid.length > 0 ? "negative" : undefined} />
    </div>
  );
}
