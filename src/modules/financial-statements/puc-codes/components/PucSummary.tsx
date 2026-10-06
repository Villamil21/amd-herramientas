import { useState } from "react";
import { Badge, Card } from "../../../../components/ui";
import { SegmentedFilter } from "../../../bank-analysis/shared/components/tableControls";
import { formatCop } from "../services/labels";
import { documentLabel } from "../services/pending";
import { DOC_CATEGORY_LABEL, type PucReport } from "../types";

type View = "code" | "document";

const VIEWS: { id: View; label: string }[] = [
  { id: "code", label: "Por código PUC" },
  { id: "document", label: "Por documento" },
];

/**
 * Resumen final. «Por código PUC»: todas las líneas y facturas con el mismo
 * código en un renglón (Facturas suman, Notas crédito restan). «Por
 * documento»: un renglón por cada código que usa cada factura.
 */
export function PucSummary({ report, partial }: { report: PucReport; partial: boolean }) {
  const [view, setView] = useState<View>("code");
  const empty = report.summary.length === 0;

  return (
    <Card
      flush
      title="Resumen por código PUC"
      description={partial ? "Resumen parcial: solo incluye lo que ya tiene código. Se recalcula con cada cambio." : "Valores consolidados: Factura electrónica suma, Nota crédito resta."}
      actions={<SegmentedFilter label="Vista del resumen" options={VIEWS} value={view} onChange={setView} />}
    >
      {empty ? (
        <p className="muted" style={{ padding: "var(--space-5)" }}>
          Aún no hay valores asignados. Elige el código PUC de una factura para ver aquí el consolidado.
        </p>
      ) : view === "code" ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Concepto</th>
                <th className="num">Facturas</th>
                <th className="num">Notas crédito</th>
                <th className="num">Total neto</th>
              </tr>
            </thead>
            <tbody>
              {report.summary.map((s) => (
                <tr key={s.code}>
                  <td className="table__primary selectable">{s.code}</td>
                  <td className="selectable">{s.concept}</td>
                  <td className="num">{formatCop(s.invoicesCents)}</td>
                  <td className="num">{formatCop(s.notesCents)}</td>
                  <td className="num table__primary">{formatCop(s.netCents)}</td>
                </tr>
              ))}
              <tr className="table__total">
                <td colSpan={2}>Total</td>
                <td className="num">{formatCop(report.totals.invoicesCents)}</td>
                <td className="num">{formatCop(report.totals.notesCents)}</td>
                <td className="num">{formatCop(report.totals.netCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-wrap table-wrap--scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Factura</th>
                <th>Proveedor</th>
                <th>Tipo</th>
                <th>Código PUC</th>
                <th>Concepto</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {report.byDocument.map((d) => (
                <tr key={`${d.fileName}|${d.code}`}>
                  <td className="table__primary selectable" title={d.fileName}>
                    {d.number ?? documentLabel(d)}
                  </td>
                  <td>{d.issuerName || "—"}</td>
                  <td>
                    <Badge tone={d.category === "credit_note" ? "gold" : "dark"}>{DOC_CATEGORY_LABEL[d.category]}</Badge>
                  </td>
                  <td className="selectable">{d.code}</td>
                  <td className="selectable">{d.concept}</td>
                  <td className="num">{formatCop(d.valueCents)}</td>
                </tr>
              ))}
              <tr className="table__total">
                <td colSpan={5}>Total neto</td>
                <td className="num">{formatCop(report.totals.netCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
