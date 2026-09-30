import { Alert, Button, Card } from "../../../../components/ui";
import { formatInteger } from "../../../../utils/format";
import type { WithholdingReport } from "../types";

const docs = (n: number) => (n === 1 ? "1 documento" : `${formatInteger(n)} documentos`);

/** Periodo detectado (mes predominante) o selector cuando hay empate. */
export function PeriodPanel({ period, onChoose }: { period: WithholdingReport["period"]; onChoose: (key: string) => void }) {
  if (period.months.length === 0) return null;
  if (period.tie.length > 0 && !period.key) {
    return (
      <Alert tone="warning" title="Hay el mismo número de documentos en varios meses. ¿Qué periodo deseas procesar?">
        <div className="row" style={{ marginTop: 6 }}>
          {period.tie.map((m) => (
            <Button key={m.key} size="sm" onClick={() => onChoose(m.key)}>
              {m.label} ({docs(m.count)})
            </Button>
          ))}
        </div>
      </Alert>
    );
  }
  const others = period.months.filter((m) => m.key !== period.key);
  return (
    <Card>
      <div className="row row--between">
        <div>
          <div className="muted" style={{ fontSize: "var(--text-sm)" }}>
            Periodo detectado
          </div>
          <div style={{ fontSize: "var(--text-xl)", fontWeight: 600 }}>{period.label}</div>
        </div>
        {others.length > 0 && (
          <span className="muted" style={{ fontSize: "var(--text-sm)" }}>
            Excluidos por fecha: {others.map((m) => `${m.label} (${docs(m.count)})`).join(" · ")}
          </span>
        )}
        {period.tie.length > 0 && (
          <div className="row">
            {period.tie.map((m) => (
              <Button key={m.key} size="sm" variant={m.key === period.key ? "primary" : "secondary"} onClick={() => onChoose(m.key)}>
                {m.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
