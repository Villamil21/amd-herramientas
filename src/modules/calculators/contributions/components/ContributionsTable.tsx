import { Select } from "../../../../components/ui";
import { formatCalcPesos, type ContributionLine, type ContributionResult } from "../services/contributions";

interface Props {
  lines: ContributionLine[];
  selection: Record<string, string>;
  onSelect: (lineId: string, optionId: string) => void;
  /** null: no se puede calcular (ej. falta el SMMLV del año); los valores se muestran como «—». */
  result: ContributionResult | null;
}

const money = (pesos: number | undefined) => (pesos === undefined ? "—" : formatCalcPesos(pesos));

export const ROUNDING_NOTE = "Cada aporte se aproxima al múltiplo de $ 100 superior, como en la PILA.";

/** Concepto · Porcentaje · Valor calculado, con el Total aporte al pie. */
export function ContributionsTable({ lines, selection, onSelect, result }: Props) {
  return (
    <div className="table-wrap">
      <table className="table calc-table">
        <thead>
          <tr>
            <th style={{ width: "34%" }}>Concepto</th>
            <th style={{ width: "36%" }}>Porcentaje</th>
            <th className="num">Valor calculado</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const value = result?.lines.find((l) => l.id === line.id)?.valuePesos;
            return (
              <tr key={line.id}>
                <td className="table__primary">{line.label}</td>
                <td>
                  <Select aria-label={`Porcentaje de ${line.label}`} className="calc-table__select" value={selection[line.id]} onChange={(e) => onSelect(line.id, e.target.value)}>
                    {line.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className={`num calc-table__value${value ? " is-filled" : ""}`}>{money(value)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Total aporte</td>
            <td className={`num${result?.totalPesos ? " is-filled" : ""}`}>{money(result?.totalPesos)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
