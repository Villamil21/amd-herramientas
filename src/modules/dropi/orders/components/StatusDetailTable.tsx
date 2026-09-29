import { Card } from "../../../../components/ui";
import { formatInteger } from "../../../../utils/format";
import { formatCop } from "../services/format";
import type { DropiOrdersAnalysis } from "../types";
import { CategoryBadge } from "./CategoryBadge";

/** Auditoría: qué estados trajo el archivo, cómo se clasificó cada uno y cuánto suma. */
export function StatusDetailTable({ analysis }: { analysis: DropiOrdersAnalysis }) {
  const { statuses, summary } = analysis;
  const total = statuses.reduce(
    (t, s) => ({
      supplier: t.supplier + s.supplierCents,
      freight: t.freight + s.freightCents,
      returnFreight: t.returnFreight + s.returnFreightCents,
    }),
    { supplier: 0, freight: 0, returnFreight: 0 },
  );

  return (
    <Card flush title="Detalle por estado" description={`${statuses.length === 1 ? "1 estado encontrado" : `${statuses.length} estados encontrados`} en el archivo.`}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Estado</th>
              <th>Clasificación</th>
              <th className="num">Cantidad de filas</th>
              <th className="num">Pedidos únicos</th>
              <th className="num">Valor de compra en productos</th>
              <th className="num">Total precios proveedor</th>
              <th className="num">Precio flete</th>
              <th className="num">Costo devolución flete</th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((s) => (
              <tr key={s.key}>
                <td className="table__primary selectable">{s.display || <span className="muted">(sin estatus)</span>}</td>
                <td>
                  <CategoryBadge category={s.category} />
                </td>
                <td className="num">{formatInteger(s.rows)}</td>
                <td className="num">{formatInteger(s.uniqueOrders)}</td>
                <td className="num">{formatCop(s.purchaseCents)}</td>
                <td className="num">{formatCop(s.supplierCents)}</td>
                <td className="num">{formatCop(s.freightCents)}</td>
                <td className="num">{formatCop(s.returnFreightCents)}</td>
              </tr>
            ))}
            <tr className="dropi-total-row">
              <td className="table__primary">Total</td>
              <td />
              <td className="num">{formatInteger(summary.totalRows)}</td>
              <td className="num">{formatInteger(summary.uniqueOrders)}</td>
              <td className="num">{formatCop(summary.billedCents)}</td>
              <td className="num">{formatCop(total.supplier)}</td>
              <td className="num">{formatCop(total.freight)}</td>
              <td className="num">{formatCop(total.returnFreight)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
