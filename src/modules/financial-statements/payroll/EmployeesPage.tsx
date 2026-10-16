import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, UsersRound } from "lucide-react";
import { Badge, Button, Card, EmptyState, MetricBar, Modal, PageHeader, useToast } from "../../../components/ui";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import { AREA_LABEL, type Employee, type PayrollRow } from "../../../types/fs";
import { formatDateForDisplay } from "../../../utils/dates";
import { formatInteger } from "../../../utils/format";
import { normalizeKey } from "../../../utils/text";
import { SearchBox, SegmentedFilter } from "../../bank-analysis/shared/components/tableControls";
import { CompanySelect } from "../shared/components/CompanySelect";
import { describeMonths, formatExactCents, periodLabel, todayIso } from "../shared/money";
import { useFsData } from "../shared/useFsData";
import { areaFor } from "./calc";
import { EmployeeEditModal } from "./PayrollModals";

type StatusFilter = "all" | "active" | "retired";

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "active", label: "Activos" },
  { id: "retired", label: "Retirados" },
];

interface EmployeeView {
  employee: Employee;
  area: string;
  hireDate: string | null;
  active: boolean;
  lastPeriod: string | null;
  periods: string[];
  rows: PayrollRow[];
}

/** Resumen por empleado a partir de la ficha y de las planillas enviadas (lotes activos). Función pura. */
export function employeeViews(employees: Employee[], rows: PayrollRow[], today = todayIso().slice(0, 7)): EmployeeView[] {
  return employees
    .map((employee) => {
      const own = rows.filter((r) => r.employeeId === employee.id);
      const periods = [...new Set(own.map((r) => r.period))].sort();
      const last = employee.employments[employee.employments.length - 1];
      const area = areaFor(employee, periods[periods.length - 1] ?? today) ?? areaFor(employee, today);
      return {
        employee,
        area: area ? AREA_LABEL[area] : "—",
        hireDate: last?.hireDate ?? null,
        active: Boolean(last && !last.endDate),
        lastPeriod: periods[periods.length - 1] ?? null,
        periods,
        rows: own,
      };
    })
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name, "es"));
}

/**
 * Estados Financieros → Empleados: historial de empleados por empresa
 * (nombre, documento, área actual, ingreso, estado, último periodo, historial
 * de áreas y periodos procesados). Desde aquí solo se editan los datos
 * maestros de la ficha; los valores de planillas ya enviadas no se editan.
 */
export default function EmployeesPage() {
  const toast = useToast();
  const data = useFsData();
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<Employee | null>(null);

  const load = useCallback(async () => {
    if (companyId === null) return;
    try {
      const [e, r] = await Promise.all([fsService.employees(companyId), fsService.payrollRows(companyId)]);
      setEmployees(e);
      setRows(r);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }, [companyId, toast]);

  useEffect(() => {
    setEmployees([]);
    setRows([]);
    void load();
  }, [load]);

  const views = useMemo(() => employeeViews(employees, rows), [employees, rows]);
  const visible = views.filter((v) => (filter === "all" || (filter === "active") === v.active) && (!query || normalizeKey(`${v.employee.name} ${v.employee.docNumber}`).includes(normalizeKey(query))));
  const current = views.find((v) => v.employee.id === open) ?? null;

  return (
    <>
      <PageHeader eyebrow="Estados Financieros · Nómina" title="Empleados" description="Historial de empleados por empresa: ficha, áreas, vinculaciones y planillas procesadas." />
      <Card>
        <CompanySelect companies={data.companies} value={companyId} onChange={setCompanyId} />
      </Card>

      {companyId !== null && (
        <>
          <MetricBar
            label="Resumen de empleados"
            metrics={[
              { key: "all", label: views.length === 1 ? "empleado" : "empleados", value: formatInteger(views.length), onClick: () => setFilter("all"), active: filter === "all" },
              { key: "active", label: "activos", value: formatInteger(views.filter((v) => v.active).length), tone: "positive", onClick: () => setFilter("active"), active: filter === "active" },
              { key: "retired", label: "retirados", value: formatInteger(views.filter((v) => !v.active).length), onClick: () => setFilter("retired"), active: filter === "retired" },
              { key: "periods", label: "periodos procesados", value: formatInteger(new Set(rows.map((r) => r.period)).size) },
            ]}
          />
          <Card flush title="Empleados" description="Abre un empleado para ver su historial. Los valores de planillas enviadas no se editan desde aquí.">
            <div className="toolbar row--between">
              <SegmentedFilter label="Estado" options={FILTERS} value={filter} onChange={setFilter} />
              <SearchBox placeholder="Nombre o documento" value={query} onChange={setQuery} />
            </div>
            {visible.length === 0 ? (
              <EmptyState icon={<UsersRound size={20} />} title={views.length ? "Sin resultados" : "Sin empleados"} description={views.length ? "Ningún empleado coincide con el filtro." : "Los empleados se crean al procesar la primera planilla de la empresa."} />
            ) : (
              <div className="table-wrap table-wrap--scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Documento</th>
                      <th>Área actual</th>
                      <th>Fecha de ingreso</th>
                      <th>Estado</th>
                      <th>Último periodo</th>
                      <th className="num">Periodos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((v) => (
                      <tr key={v.employee.id} className="is-clickable" onClick={() => setOpen(v.employee.id)}>
                        <td className="table__primary">{v.employee.name}</td>
                        <td className="nowrap selectable">
                          {v.employee.docType} {v.employee.docNumber}
                        </td>
                        <td>{v.area}</td>
                        <td className="nowrap">{formatDateForDisplay(v.hireDate)}</td>
                        <td>{v.active ? <Badge tone="success">Activo</Badge> : <Badge>Retirado</Badge>}</td>
                        <td className="nowrap">{v.lastPeriod ? periodLabel(v.lastPeriod) : "—"}</td>
                        <td className="num">{formatInteger(v.periods.length)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <Modal
        open={current !== null && editing === null}
        size="lg"
        title={current?.employee.name ?? ""}
        description={current ? `${current.employee.docType} ${current.employee.docNumber} · ${current.active ? "Activo" : "Retirado"}` : undefined}
        onClose={() => setOpen(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              Cerrar
            </Button>
            <Button variant="primary" icon={<Pencil size={14} />} onClick={() => current && setEditing(current.employee)}>
              Editar datos maestros
            </Button>
          </>
        }
      >
        {current && (
          <div className="stack">
            <div className="stack stack--sm">
              <strong>Historial de áreas</strong>
              {current.employee.areas.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>Sin área registrada.</p>
              ) : (
                <ul className="history-list">
                  {[...current.employee.areas]
                    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
                    .map((a) => (
                      <li key={a.effectiveFrom}>
                        {AREA_LABEL[a.area]} <span className="muted">desde {periodLabel(a.effectiveFrom).toLowerCase()}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
            <div className="stack stack--sm">
              <strong>Vinculaciones</strong>
              <ul className="history-list">
                {current.employee.employments.map((j) => {
                  const liq = current.employee.liquidations.find((l) => l.employmentId === j.id);
                  return (
                    <li key={j.id}>
                      #{j.number} · ingreso {formatDateForDisplay(j.hireDate)}
                      {j.endDate ? ` · retiro ${formatDateForDisplay(j.endDate)}` : " · vigente"}
                      {liq && <span className="muted"> · liquidación registrada el {formatDateForDisplay(liq.liquidationDate)}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="stack stack--sm">
              <strong>Periodos procesados {current.periods.length > 0 && <span className="muted">· {describeMonths(current.periods)}</span>}</strong>
              {current.rows.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>Sin planillas enviadas a Estados Financieros.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table table--dense">
                    <thead>
                      <tr>
                        <th>Periodo</th>
                        <th>Fecha de pago</th>
                        <th>Área</th>
                        <th className="num">Días</th>
                        <th className="num">Sueldo del mes</th>
                        <th className="num">Auxilio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.rows.map((r) => {
                        const d = (r.detail ?? {}) as { days?: number; ibcCents?: number; transportCents?: number; area?: keyof typeof AREA_LABEL };
                        return (
                          <tr key={r.id}>
                            <td className="nowrap">{periodLabel(r.period)}</td>
                            <td className="nowrap">{formatDateForDisplay(r.paymentDate)}</td>
                            <td>{d.area ? AREA_LABEL[d.area] : "—"}</td>
                            <td className="num">{d.days ?? "—"}</td>
                            <td className="num">{d.ibcCents !== undefined ? formatExactCents(d.ibcCents) : "—"}</td>
                            <td className="num">{d.transportCents !== undefined ? formatExactCents(d.transportCents) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <span className="field__hint">Valores de solo lectura: para corregir una planilla, reemplázala o usa Movimientos contables (con motivo).</span>
            </div>
            {current.employee.events.length > 0 && (
              <div className="stack stack--sm">
                <strong>Ediciones de la ficha</strong>
                <ul className="history-list">
                  {current.employee.events.map((e, i) => (
                    <li key={i}>
                      {formatDateForDisplay(e.createdAt)} · {e.action}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>
      <EmployeeEditModal
        employee={editing}
        period=""
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />
    </>
  );
}
