import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, CircleDot, Info, XCircle } from "lucide-react";
import { Button, Card } from "../../../../components/ui";
import { groupAlerts } from "../domain/model";
import { DEST_LABEL, SEVERITY_LABEL, type Alert, type Dest, type Severity } from "../domain/status";

const ICON: Record<Severity, typeof XCircle> = { block: XCircle, pending: CircleDot, review: AlertTriangle, info: Info };
const CHIP: Record<Severity, string> = { block: "state-chip--block", pending: "state-chip--pending", review: "state-chip--review", info: "state-chip--na" };

function Row({ alert, onResolve }: { alert: Alert; onResolve: (a: Alert) => void }) {
  const Icon = ICON[alert.severity];
  return (
    <div className="alert-row">
      <span className={`state-chip ${CHIP[alert.severity]}`}>
        <Icon size={13} aria-hidden="true" />
        {SEVERITY_LABEL[alert.severity]}
      </span>
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
        {alert.dests.length > 0 && (
          <div className="alert-row__dests">
            {alert.dests.map((d) => (
              <span key={d} className="state-chip state-chip--na">
                {DEST_LABEL[d]}
              </span>
            ))}
          </div>
        )}
      </div>
      {alert.target.kind !== "none" && (
        <Button size="sm" onClick={() => onResolve(alert)}>
          {alert.action ?? "Resolver"}
        </Button>
      )}
    </div>
  );
}

/**
 * Panel global de alertas por empresa y año. Las repetidas del mismo tipo se agrupan («38 líneas por confirmar») y se pueden
 * abrir una a una; cada alerta lleva al dato que la causa y explica qué, por qué y cómo.
 */
export function AlertsPanel({ alerts, dest, onResolve }: { alerts: Alert[]; dest?: Dest | null; onResolve: (a: Alert) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const shown = useMemo(() => (dest ? alerts.filter((a) => a.dests.includes(dest)) : alerts), [alerts, dest]);
  const groups = useMemo(() => groupAlerts(shown), [shown]);
  if (shown.length === 0) return null;
  return (
    <Card title={dest ? `Pendientes de ${DEST_LABEL[dest]}` : "Pendientes"} description={`${shown.length} ${shown.length === 1 ? "alerta" : "alertas"} para esta empresa y año.`}>
      {groups.map((g) => {
        const key = `${g.severity}|${g.code}|${g.dests.join(",")}`;
        if (g.items.length <= 2) return g.items.map((a) => <Row key={a.id} alert={a} onResolve={onResolve} />);
        const expanded = open.has(key);
        const Chevron = expanded ? ChevronDown : ChevronRight;
        const first = g.items[0];
        return (
          <div key={key}>
            <div className="alert-row">
              <span className={`state-chip ${CHIP[g.severity]}`}>
                {(() => {
                  const Icon = ICON[g.severity];
                  return <Icon size={13} aria-hidden="true" />;
                })()}
                {SEVERITY_LABEL[g.severity]} · {g.items.length}
              </span>
              <div>
                <div className="alert-row__title">
                  {g.items.length} alertas del mismo tipo — {first.why.split(".")[0]}.
                </div>
                <div className="alert-row__text">
                  <strong>Cómo resolverlo: </strong>
                  {first.how}
                </div>
                <div className="alert-row__dests">
                  {g.dests.map((d) => (
                    <span key={d} className="state-chip state-chip--na">
                      {DEST_LABEL[d]}
                    </span>
                  ))}
                </div>
              </div>
              <Button
                size="sm"
                icon={<Chevron size={14} />}
                onClick={() =>
                  setOpen((s) => {
                    const n = new Set(s);
                    if (n.has(key)) n.delete(key);
                    else n.add(key);
                    return n;
                  })
                }
              >
                {expanded ? "Ocultar" : "Ver todas"}
              </Button>
            </div>
            {expanded && g.items.map((a) => <Row key={a.id} alert={a} onResolve={onResolve} />)}
          </div>
        );
      })}
    </Card>
  );
}
