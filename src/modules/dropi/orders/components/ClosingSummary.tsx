import type { ReactNode } from "react";
import { Coins, PackageCheck, ShoppingBag } from "lucide-react";
import { Alert, Badge, Card } from "../../../../components/ui";
import { formatInteger } from "../../../../utils/format";
import { closingConcepts, orderCounts } from "../services/excelExport";
import { formatCop } from "../services/format";
import type { DropiOrdersAnalysis } from "../types";

function Metric({ label, value, note, primary }: { label: string; value: string; note?: ReactNode; primary?: boolean }) {
  return (
    <div className={`dropi-metric ${primary ? "dropi-metric--primary" : ""}`}>
      <span className="dropi-metric__label">
        {label} {note}
      </span>
      <span className="dropi-metric__value selectable">{value}</span>
    </div>
  );
}

const Title = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
  <span className="row dropi-block__title">
    {icon}
    {children}
  </span>
);

/** Los tres bloques del cierre: Ventas Dropi, Costos Dropi y Pedidos. */
export function ClosingSummary({ analysis }: { analysis: DropiOrdersAnalysis }) {
  const { summary: s, complete } = analysis;
  const concepts = closingConcepts(analysis);
  const sales = concepts.filter((c) => c.section === "Ventas Dropi");
  const costs = concepts.filter((c) => c.section === "Costos Dropi");
  // En proceso y Siniestro dependen de la clasificación del usuario.
  const partial = (concept: string) =>
    !complete && (concept === "En proceso" || concept === "Siniestro") ? <Badge tone="warning">Parcial</Badge> : undefined;

  return (
    <>
      {!complete && (
        <Alert tone="warning" title="El cierre aún no está completamente clasificado">
          Los totales de En proceso y Siniestro se actualizan automáticamente al clasificar los estados pendientes. La exportación se habilita cuando
          todos los estados tengan destino.
        </Alert>
      )}

      <Card
        flush
        className="dropi-block dropi-block--sales"
        title={<Title icon={<ShoppingBag size={17} />}>Ventas Dropi</Title>}
        description="Suma de «VALOR DE COMPRA EN PRODUCTOS» por clasificación del estado."
        footer={
          <span className="muted">
            Entregado: {formatCop(s.deliveredCents)}
            {s.unclassifiedCents !== 0 && <> · Sin clasificar: {formatCop(s.unclassifiedCents)}</>}
          </span>
        }
      >
        <div className="dropi-metrics">
          {sales.map((c, i) => (
            <Metric key={c.concept} label={c.concept} value={formatCop(c.cents)} note={partial(c.concept)} primary={i === 0} />
          ))}
        </div>
      </Card>

      <Card flush className="dropi-block dropi-block--costs" title={<Title icon={<Coins size={17} />}>Costos Dropi</Title>} description="Costos de pedidos entregados y fletes de devolución.">
        <div className="dropi-metrics">
          {costs.map((c) => (
            <Metric key={c.concept} label={c.concept} value={formatCop(c.cents)} />
          ))}
        </div>
      </Card>

      <Card flush className="dropi-block dropi-block--orders" title={<Title icon={<PackageCheck size={17} />}>Pedidos</Title>} description="Pedidos únicos por ID (un ID repetido cuenta una sola vez).">
        <div className="dropi-metrics">
          {orderCounts(analysis).map((c) => (
            <Metric key={c.concept} label={c.concept} value={formatInteger(c.count)} />
          ))}
        </div>
      </Card>
    </>
  );
}
