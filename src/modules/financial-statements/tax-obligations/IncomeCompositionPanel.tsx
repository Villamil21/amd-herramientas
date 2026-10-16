import { Alert, Badge, Button, Card } from "../../../components/ui";
import { formatExactCents } from "../shared/money";
import type { IncomeComposition } from "./services/incomeComposition";

const PucCell = ({ code }: { code?: string | null }) => (code ? <span className="mono">{code}</span> : <Badge tone="danger">Sin configurar</Badge>);

/** «Renta por pagar» abierta: impuesto liquidado, anticipo aplicable y autorretenciones del año, con fuente y PUC de cada parte. */
export function IncomeCompositionPanel({ composition: c, onConfigurePuc }: { composition: IncomeComposition; onConfigurePuc: () => void }) {
  return (
    <div className="stack">
      <Card flush title="Liquidación declarada" description="De qué se compone la Renta por pagar que muestran los Estados Financieros. Cada parte sale del Formulario 110 guardado.">
        {c.declarations.length === 0 ? (
          <p className="muted" style={{ padding: "var(--space-3) var(--space-5)", margin: 0 }}>
            No hay declaraciones de renta con saldo a pagar a esta fecha de corte.
          </p>
        ) : (
          c.declarations.map((d) => (
            <div key={d.returnId} className="table-wrap">
              <table className="table table--dense">
                <thead>
                  <tr>
                    <th>{d.title}</th>
                    <th>Fuente</th>
                    <th>PUC</th>
                    <th className="num">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {d.lines.map((l) => (
                    <tr key={l.key}>
                      <td>{l.label}</td>
                      <td className="muted">{l.source}</td>
                      <td>{l.pucKey ? <PucCell code={l.pucCode} /> : <span className="muted">—</span>}</td>
                      <td className={l.cents < 0 ? "num amount--negative" : "num"}>{formatExactCents(l.cents)}</td>
                    </tr>
                  ))}
                  <tr className="fs-row--subtotal">
                    <td colSpan={3}>Saldo a pagar declarado</td>
                    <td className="num">{formatExactCents(d.payableCents)}</td>
                  </tr>
                  <tr>
                    <td colSpan={3}>(−) Pagos hasta el corte</td>
                    <td className="num amount--negative">{formatExactCents(-d.paidCents)}</td>
                  </tr>
                  <tr className="fs-row--subtotal">
                    <td colSpan={3}>
                      Renta por pagar en EEFF {d.noncurrent && <Badge>No corriente</Badge>}
                    </td>
                    <td className="num">{formatExactCents(d.pendingCents)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))
        )}
      </Card>

      <Card flush title={`Descuentos del año fiscal ${c.cutYear}`} description="Para EEFF de este año solo cuenta el anticipo generado por la declaración del año anterior; las autorretenciones son las practicadas dentro del año.">
        <div className="table-wrap">
          <table className="table table--dense">
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Fuente</th>
                <th>PUC</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{c.advance?.label ?? `Anticipo de Renta ${c.cutYear}`}</td>
                <td className="muted">{c.advance?.source ?? "Sin anticipo aplicable (se consume el 31/12 o la declaración anterior no lo generó)"}</td>
                <td>{c.advance ? <PucCell code={c.advance.pucCode} /> : <span className="muted">—</span>}</td>
                <td className="num">{formatExactCents(c.advance?.cents ?? 0)}</td>
              </tr>
              <tr>
                <td>{c.selfWithholding.total.label}</td>
                <td className="muted">{c.selfWithholding.total.source}</td>
                <td>
                  <PucCell code={c.selfWithholding.total.pucCode} />
                </td>
                <td className="num">{formatExactCents(c.selfWithholding.total.cents)}</td>
              </tr>
              {c.selfWithholding.periods.map((p) => (
                <tr key={p.returnId}>
                  <td className="muted" style={{ paddingLeft: 24 }}>
                    {p.label}
                  </td>
                  <td />
                  <td />
                  <td className="num muted">{formatExactCents(p.cents)}</td>
                </tr>
              ))}
              <tr className="fs-row--subtotal">
                <td colSpan={3}>Descuentos explicables de la renta del año</td>
                <td className="num">{formatExactCents(c.discountsCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="row" style={{ padding: "var(--space-3) var(--space-5)", flexWrap: "wrap" }}>
          <Alert tone="info">El impuesto estimado del ejercicio (35 % de la utilidad) es solo una referencia del Generador: no se envía a EEFF. El patrimonio declarado tampoco.</Alert>
          <Button size="sm" onClick={onConfigurePuc}>
            Configurar PUC
          </Button>
        </div>
      </Card>
    </div>
  );
}
