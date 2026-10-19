import { useEffect, useMemo, useState } from "react";
import { navigate } from "../../../../app/router";
import { Button, Card, EmptyState, Field, Select } from "../../../../components/ui";
import { UsersRound } from "lucide-react";
import { companyService } from "../../../../services/companyService";
import type { Company } from "../../../../types/models";
import { StatusChip, statusCount } from "../../purchases/ui/StatusStrip";
import { SEVERITY_LABEL } from "../../purchases/domain/status";
import { PAYROLL_DEST_LABEL, PAYROLL_DESTS, type PayrollAlert, type PayrollDest } from "./alerts";
import { CoverageStrip } from "./AuditViews";
import { usePayrollOverview } from "./usePayrollOverview";

interface Props {
  /** Empresa y año de la planilla recién abierta (por el NIT del aportante); si no hay, el usuario elige. */
  context: { companyId: number | null; year: number | null };
  refreshKey: unknown;
}

const CHIP = { block: "state-chip--block", pending: "state-chip--pending", review: "state-chip--review", info: "state-chip--na" } as const;

const years = () => {
  const y = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, i) => y - i);
};

/**
 * Estado de Nómina y seguridad social de una empresa y un año: cobertura mensual y, por destino (Estados Financieros, 1001,
 * 1011 y 2276), su estado unificado con icono, texto, cantidad y las alertas que explican qué falta y abren el dato que lo
 * resuelve. Las de un destino no detienen a los demás.
 */
export function NominaStatus({ context, refreshKey }: Props) {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [dest, setDest] = useState<PayrollDest | null>(null);

  useEffect(() => {
    void companyService.list().then(setCompanies, () => setCompanies([]));
  }, [refreshKey]);
  // Al abrir una planilla, el panel sigue a su empresa y su año.
  useEffect(() => {
    if (context.companyId !== null) setCompanyId(context.companyId);
    if (context.year !== null) setYear(context.year);
  }, [context.companyId, context.year]);

  const { overview } = usePayrollOverview(companyId, year, refreshKey);
  const shown = useMemo(() => (overview ? (dest ? overview.alerts.filter((a) => a.dests.includes(dest)) : overview.alerts) : []), [overview, dest]);

  return (
    <div className="stack">
      <Card title="Estado de Nómina y seguridad social" description="Cobertura mensual por periodo de pensión y estado de cada destino. Un pendiente de un destino no detiene a los demás.">
        <div className="form-grid form-grid--compact" style={{ alignItems: "end" }}>
          <Field label="Empresa">
            {(id) => (
              <Select id={id} value={companyId ?? ""} disabled={!companies} onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : null)} style={{ minWidth: 260 }}>
                <option value="">Seleccionar empresa…</option>
                {(companies ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.razonSocial} — NIT {c.nit}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Año (periodo de pensión)">
            {(id) => (
              <Select id={id} value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {[...new Set([...years(), year])].sort((a, b) => b - a).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Card>
      {companyId === null ? (
        <Card>
          <EmptyState icon={<UsersRound size={20} />} title="Selecciona una empresa" description="Importa una planilla (la empresa se identifica por el NIT del aportante) o elige la empresa para ver su cobertura y estado." />
        </Card>
      ) : !overview ? null : (
        <>
          <CoverageStrip coverage={overview.data.coverage} year={year} />
          <div className="state-strip" role="group" aria-label="Estado por destino">
            {PAYROLL_DESTS.map((d) => (
              <button key={d} type="button" className="state-strip__item state-strip__item--action" aria-pressed={dest === d} onClick={() => setDest(dest === d ? null : d)}>
                <span className="state-strip__dest">{PAYROLL_DEST_LABEL[d]}</span>
                <StatusChip status={overview.status[d]} count={statusCount(overview.status[d], overview.counts[d])} dest={PAYROLL_DEST_LABEL[d]} />
                <span className="state-strip__detail">
                  {overview.status[d] === "ready" ? "Sin pendientes." : `${overview.counts[d].block} bloquean · ${overview.counts[d].pending} por confirmar · ${overview.counts[d].review} por revisar`}
                </span>
                <span className="state-strip__cta">{dest === d ? "Ver todos" : "Ver pendientes"} →</span>
              </button>
            ))}
          </div>
          <Card title={dest ? `Pendientes de ${PAYROLL_DEST_LABEL[dest]}` : "Pendientes"} description={shown.length === 0 ? "Sin pendientes." : `${shown.length} ${shown.length === 1 ? "alerta" : "alertas"}.`}>
            {shown.slice(0, 100).map((a) => (
              <AlertRow key={a.id} alert={a} />
            ))}
            {shown.length > 100 && <span className="muted">Se muestran las primeras 100 de {shown.length}.</span>}
          </Card>
        </>
      )}
    </div>
  );
}

function AlertRow({ alert }: { alert: PayrollAlert }) {
  return (
    <div className="alert-row">
      <span className={`state-chip ${CHIP[alert.severity]}`}>{SEVERITY_LABEL[alert.severity]}</span>
      <div>
        <div className="alert-row__title">{alert.title}</div>
        <div className="alert-row__text">
          <strong>Qué pasa: </strong>
          {alert.why}
        </div>
        <div className="alert-row__text">
          <strong>Cómo resolverlo: </strong>
          {alert.how}
        </div>
        <div className="alert-row__dests">
          {alert.dests.map((d) => (
            <span key={d} className="state-chip state-chip--na">
              {PAYROLL_DEST_LABEL[d]}
            </span>
          ))}
        </div>
      </div>
      {alert.action && (
        <Button size="sm" onClick={() => navigate(alert.action!.path)}>
          {alert.action.label}
        </Button>
      )}
    </div>
  );
}
