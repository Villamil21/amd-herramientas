import { Fragment, useMemo, useState } from "react";
import { Card } from "../../../../../components/ui";
import { formatInteger, formatPesos } from "../../../../../utils/format";
import { SearchBox, SortableTh, type SortDirection } from "../../../../bank-analysis/shared/components/tableControls";
import type { PayrollEmployee, PayrollSummary } from "../types";

type SortKey = "name" | "identification" | "totalContribution" | "pensionIbc";

const MONEY_COLUMNS: { key: keyof PayrollEmployee; label: string; sortable?: SortKey }[] = [
  { key: "pensionIbc", label: "Pensión IBC", sortable: "pensionIbc" },
  { key: "pensionContribution", label: "Pensión Aporte" },
  { key: "healthContribution", label: "Salud Aporte" },
  { key: "ccfContribution", label: "CCF Aporte" },
  { key: "riskContribution", label: "Riesgos Aporte" },
  { key: "totalContribution", label: "Total Aportes", sortable: "totalContribution" },
];

const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

function sortEmployees(list: PayrollEmployee[], key: SortKey, direction: SortDirection) {
  const factor = direction === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const r = key === "name" || key === "identification" ? collator.compare(a[key], b[key]) : a[key] - b[key];
    return r * factor || a.rowNumber - b.rowNumber;
  });
}

/** Tabla del detalle por empleado. Buscar y ordenar solo cambian la vista; por defecto, el orden de la planilla. */
export function EmployeesTable({ summary }: { summary: PayrollSummary }) {
  const { employees } = summary;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLocaleUpperCase("es");
    const filtered = q ? employees.filter((e) => e.identification.toLocaleUpperCase("es").includes(q) || e.name.toLocaleUpperCase("es").includes(q)) : employees;
    return sort ? sortEmployees(filtered, sort.key, sort.direction) : filtered;
  }, [employees, query, sort]);

  // Ascendente → descendente → orden original de la planilla.
  const toggleSort = (key: SortKey) =>
    setSort((s) => {
      const first: SortDirection = key === "name" || key === "identification" ? "asc" : "desc";
      if (!s || s.key !== key) return { key, direction: first };
      return s.direction === first ? { key, direction: first === "asc" ? "desc" : "asc" } : null;
    });

  const header = (key: SortKey, label: string, numeric = false) => (
    <SortableTh label={label} active={sort?.key === key} direction={sort?.direction ?? "asc"} numeric={numeric} onToggle={() => toggleSort(key)} />
  );
  const sumOf = (key: keyof PayrollEmployee) => employees.reduce((acc, e) => acc + (e[key] as number), 0);

  return (
    <Card
      flush
      title="Detalle por empleado"
      description="Valores tomados de la Liquidación detallada de aportes. Haz clic en un encabezado para ordenar."
      actions={<SearchBox placeholder="Buscar empleado..." value={query} onChange={setQuery} />}
    >
      <div className="table-wrap">
        <table className="table payroll-table">
          <thead>
            <tr>
              {header("identification", "Empleado")}
              {header("name", "Nombre")}
              <th className="num">Pensión Días</th>
              {MONEY_COLUMNS.map((c) =>
                c.sortable ? (
                  <Fragment key={c.key}>{header(c.sortable, c.label, true)}</Fragment>
                ) : (
                  <th key={c.key} className="num">
                    {c.label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => (
              <tr key={`${e.page}-${e.rowNumber}`}>
                <td className="selectable payroll-table__id">{e.identification}</td>
                <td className="table__primary selectable">{e.name}</td>
                <td className="num">{formatInteger(e.pensionDays)}</td>
                {MONEY_COLUMNS.map((c) => (
                  <td key={c.key} className={c.key === "totalContribution" ? "num table__primary" : "num"}>
                    {formatPesos(e[c.key] as number)}
                  </td>
                ))}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={3 + MONEY_COLUMNS.length} className="muted" style={{ textAlign: "center", padding: "var(--space-6)" }}>
                  Ningún empleado coincide con la búsqueda.
                </td>
              </tr>
            )}
          </tbody>
          {!query.trim() && (
            <tfoot>
              <tr>
                <td colSpan={3} className="table__primary">
                  Total ({formatInteger(employees.length)} {employees.length === 1 ? "empleado" : "empleados"})
                </td>
                {MONEY_COLUMNS.map((c) => (
                  <td key={c.key} className="num table__primary">
                    {formatPesos(sumOf(c.key))}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}
