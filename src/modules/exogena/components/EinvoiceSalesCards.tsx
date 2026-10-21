import { Badge, Card } from "../../../components/ui";
import { EINVOICE_ORIGIN, type EinvoiceContribution } from "../domain/einvoiceSales";
import { formatExoCents } from "../domain/numbers";

/** 1007: la base de Estados Financieros y la del 1007 son distintas a propósito; se muestran las dos. */
export function Einvoice1007Bases({ sales }: { sales: EinvoiceContribution }) {
  if (sales.documents === 0) return null;
  const { bases } = sales;
  return (
    <Card title={`${EINVOICE_ORIGIN} · bases`} description="Estados Financieros conserva su fórmula Total − (IVA … Rete ICA). El 1007 usa Total − (IVA … ICUI), por eso las cifras pueden diferir.">
      <div className="table-wrap">
        <table className="table table--dense">
          <thead>
            <tr>
              <th>Destino</th>
              <th>Fórmula</th>
              <th className="num">Facturas</th>
              <th className="num">Notas crédito</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Estados Financieros</td>
              <td>Total − (IVA … Rete ICA)</td>
              <td className="num">{formatExoCents(bases.eeffSale)}</td>
              <td className="num">{formatExoCents(bases.eeffReturn)}</td>
            </tr>
            <tr>
              <td>Exógena 1007</td>
              <td>Total − (IVA … ICUI)</td>
              <td className="num">{formatExoCents(bases.exoSale)}</td>
              <td className="num">{formatExoCents(bases.exoReturn)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** 1005 / 1006: conciliación de ventas, independiente de la de compras y sin restar una cifra de la otra. */
export function EinvoiceSalesReconciliation({ sales }: { sales: EinvoiceContribution }) {
  const r = sales.reconciliation;
  if (r.invoiceIvaCents === 0 && r.creditNoteIvaCents === 0 && r.generatedCents === 0 && r.salesReturnsCents === 0) return null;
  const badge = (diff: number) => (diff === 0 ? <Badge tone="success">Conciliado</Badge> : <Badge tone="danger">Diferencia {formatExoCents(diff)}</Badge>);
  return (
    <Card title="Conciliación de ventas (Facturación electrónica)" description="Independiente de la conciliación de compras. Cada componente va a su propia columna; no se restan entre sí.">
      <div className="stack stack--sm">
        <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
          <span>
            IVA de Facturas electrónicas: <strong>{formatExoCents(r.invoiceIvaCents)}</strong> → 1006 / Impuesto generado: <strong>{formatExoCents(r.generatedCents)}</strong>
          </span>
          {badge(r.invoiceIvaCents - r.generatedCents)}
        </div>
        <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
          <span>
            IVA de Notas de crédito electrónicas: <strong>{formatExoCents(r.creditNoteIvaCents)}</strong> → 1005 / IVA resultante por devoluciones en ventas: <strong>{formatExoCents(r.salesReturnsCents)}</strong>
          </span>
          {badge(r.creditNoteIvaCents - r.salesReturnsCents)}
        </div>
      </div>
    </Card>
  );
}
