import { Card } from "../../../../components/ui";
import { formatCop as formatMoneyCents } from "../parser/amounts";
import { NOTES_CATEGORY, SUMMARY_CATEGORIES, summaryTotal } from "../services/labels";
import type { VatSummaryData } from "../types";

const docs = (n: number) => (n === 1 ? "1 documento validado" : `${n} documentos validados`);

/**
 * Resumen para la declaración: las Facturas electrónicas por renglón y, en su
 * propia sección, las Notas crédito en una sola fila (sin netear entre ellas).
 * Solo suman los documentos validados.
 */
export function VatSummary({ summary }: { summary: VatSummaryData }) {
  const { invoices, notes } = summary;
  const total = summaryTotal(invoices);
  return (
    <>
      <Card flush title="Factura electrónica" description={docs(invoices.documentCount)}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Categoría</th>
                <th className="num">Base</th>
                <th className="num">IVA</th>
              </tr>
            </thead>
            <tbody>
              {SUMMARY_CATEGORIES.map((c) => (
                <tr key={c.label}>
                  <td className="table__primary">{c.label}</td>
                  <td className="num">{formatMoneyCents(c.value(invoices).baseCents)}</td>
                  <td className="num">{formatMoneyCents(c.value(invoices).vatCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="table__total">
                <td>Total</td>
                <td className="num">{formatMoneyCents(total.baseCents)}</td>
                <td className="num">{formatMoneyCents(total.vatCents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
      <Card flush title="Notas crédito" description={docs(notes.documentCount)}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Categoría</th>
                <th className="num">Base</th>
                <th className="num">IVA</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="table__primary">{NOTES_CATEGORY}</td>
                <td className="num">{formatMoneyCents(notes.baseCents)}</td>
                <td className="num">{formatMoneyCents(notes.vatCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
