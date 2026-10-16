import type { ReactNode } from "react";
import { ClipboardCopy, Coins, FileSpreadsheet, PackageCheck, ShoppingBag, Table2 } from "lucide-react";
import { Alert, Badge, Button, Card, useToast } from "../../../../components/ui";
import { formatInteger } from "../../../../utils/format";
import { copyText, pastePesos } from "../../../../utils/clipboard";
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

/** Las tres tablas en orden (Ventas Dropi, Pedidos, Costos Dropi), una fila «Concepto⇥Valor» por línea. */
export function summaryText(analysis: DropiOrdersAnalysis): string {
  const concepts = closingConcepts(analysis);
  const lines = (section: string) => concepts.filter((c) => c.section === section).map((c) => `${c.concept}\t${pastePesos(c.cents)}`);
  // Ventas Dropi termina con Entregado (en pantalla va al pie del bloque).
  const delivered = `Entregado\t${pastePesos(analysis.summary.deliveredCents)}`;
  return [...lines("Ventas Dropi"), delivered, ...orderCounts(analysis).map((c) => `${c.concept}\t${c.count}`), ...lines("Costos Dropi")].join("\n");
}

/** Igual que summaryText pero con encabezado y la sección de cada fila (Sección⇥Concepto⇥Valor). */
export function summaryTable(analysis: DropiOrdersAnalysis): string {
  const concepts = closingConcepts(analysis);
  const rows = [
    ...concepts.filter((c) => c.section === "Ventas Dropi").map((c) => ["Ventas Dropi", c.concept, pastePesos(c.cents)]),
    ["Ventas Dropi", "Entregado", pastePesos(analysis.summary.deliveredCents)],
    ...orderCounts(analysis).map((c) => ["Pedidos", c.concept, String(c.count)]),
    ...concepts.filter((c) => c.section === "Costos Dropi").map((c) => ["Costos Dropi", c.concept, pastePesos(c.cents)]),
  ];
  return [["Sección", "Concepto", "Valor"], ...rows].map((r) => r.join("\t")).join("\n");
}

/**
 * «Resumen para informe mensual»: los tres bloques del cierre, siempre juntos y
 * consecutivos (Ventas Dropi, Pedidos y Costos Dropi), y «Copiar resumen».
 */
export function ClosingSummary({ analysis, onExport, exporting }: { analysis: DropiOrdersAnalysis; onExport?: () => void; exporting?: boolean }) {
  const toast = useToast();
  const { summary: s, complete } = analysis;
  const concepts = closingConcepts(analysis);
  const sales = concepts.filter((c) => c.section === "Ventas Dropi");
  const costs = concepts.filter((c) => c.section === "Costos Dropi");
  // En proceso, Siniestro e Indemnizada dependen (también) de la clasificación del usuario.
  const userClassified = ["En proceso", "Siniestro", "Indemnizada / En proceso indemnización"];
  const partial = (concept: string) => (!complete && userClassified.includes(concept) ? <Badge tone="warning">Parcial</Badge> : undefined);

  const copy = (text: string, message: string) =>
    copyText(text).then(
      () => toast(message),
      (e: Error) => toast(e.message, "error"),
    );

  return (
    <section className="dropi-report" aria-label="Resumen para informe mensual">
      <div className="row row--between dropi-report__head">
        <h2 className="dropi-report__title">Resumen para informe mensual</h2>
        <span className="row" style={{ gap: 6 }}>
          <Button size="sm" icon={<ClipboardCopy size={14} />} onClick={() => void copy(summaryText(analysis), "Resumen copiado: pégalo en Excel.")} title="Concepto y valor de los tres bloques, en orden">
            Copiar resumen
          </Button>
          <Button size="sm" icon={<Table2 size={14} />} onClick={() => void copy(summaryTable(analysis), "Tabla copiada con encabezados: pégala en Excel.")} title="Sección, concepto y valor, con encabezados">
            Copiar como tabla
          </Button>
          {onExport && (
            <Button size="sm" icon={<FileSpreadsheet size={14} />} onClick={onExport} loading={exporting} disabled={!complete} title={complete ? undefined : "Clasifica primero los estados pendientes."}>
              Exportar Excel
            </Button>
          )}
        </span>
      </div>
      {!complete && (
        <Alert tone="warning" title="El cierre aún no está completamente clasificado">
          Los totales de En proceso, Siniestro e Indemnizada / En proceso indemnización se actualizan automáticamente al clasificar los estados pendientes. La exportación se habilita cuando
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

      <Card flush className="dropi-block dropi-block--orders" title={<Title icon={<PackageCheck size={17} />}>Pedidos</Title>} description="Pedidos únicos por ID (un ID repetido cuenta una sola vez).">
        <div className="dropi-metrics">
          {orderCounts(analysis).map((c) => (
            <Metric key={c.concept} label={c.concept} value={formatInteger(c.count)} />
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
    </section>
  );
}
