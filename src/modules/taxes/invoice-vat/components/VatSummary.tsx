import { Alert, Card } from "../../../../components/ui";
import { formatCop as formatMoneyCents, formatRateBp } from "../parser/amounts";
import { SUMMARY_CATEGORIES } from "../services/labels";
import type { DocumentTypeSummary } from "../types";

/** Un bloque independiente por cada título de documento encontrado (sin netear entre ellos). */
export function VatSummary({ summaries }: { summaries: DocumentTypeSummary[] }) {
  return (
    <>
      {summaries.map((s) => {
        const hasServices5 = s.services5.baseCents !== 0 || s.services5.vatCents !== 0;
        return (
          <Card key={s.documentTypeKey} flush title={s.documentType} description={s.invoiceCount === 1 ? "1 documento" : `${s.invoiceCount} documentos`}>
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
                      <td className="num">{formatMoneyCents(c.value(s).baseCents)}</td>
                      <td className="num">{formatMoneyCents(c.value(s).vatCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(hasServices5 || s.otherRates.length > 0) && (
              <div className="card__body">
                <Alert tone="warning" title="Valores que requieren clasificación (no incluidos arriba)">
                  <ul>
                    {hasServices5 && (
                      <li>
                        Servicios al 5% detectados: base {formatMoneyCents(s.services5.baseCents)} · IVA {formatMoneyCents(s.services5.vatCents)}.
                      </li>
                    )}
                    {s.otherRates.map((o) => (
                      <li key={o.rateBp}>
                        Tarifa no configurada {formatRateBp(o.rateBp)}: base {formatMoneyCents(o.baseCents)} · IVA {formatMoneyCents(o.vatCents)}.
                      </li>
                    ))}
                  </ul>
                </Alert>
              </div>
            )}
          </Card>
        );
      })}
    </>
  );
}
