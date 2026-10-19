import { Badge, Card } from "../../../../components/ui";
import { formatInteger } from "../../../../utils/format";
import { MONTH_NAMES } from "../../shared/money";
import { monthName, type Form1011 } from "./exo1011";
import type { Form2276 } from "./exo2276";
import { isCovered, type MonthCoverage, type MonthState } from "./year";

const pesos = (cents: number) => formatInteger(Math.round(cents / 100));

const STATE_TEXT: Record<MonthState, string> = { planilla: "✓", empty: "✓ Sin nómina", legacy: "⚠ Sin detalle", missing: "—" };
const STATE_TITLE: Record<MonthState, string> = {
  planilla: "con planilla válida",
  empty: "periodo sin nómina registrado",
  legacy: "lote anterior sin detalle de seguridad social: vuelve a importar la planilla",
  missing: "sin planilla ni «Periodo sin nómina»",
};

/** Cobertura mensual por periodo de pensión: ✓ planilla, ✓ Sin nómina, ⚠ lote sin detalle o — falta. */
export function CoverageStrip({ coverage, year }: { coverage: MonthCoverage[]; year: number }) {
  return (
    <div className="card source-coverage" role="group" aria-label={`Cobertura de nómina ${year}`}>
      <span className="source-coverage__title">Cobertura {year}</span>
      <ol className="source-coverage__months">
        {coverage.map((c) => {
          const label = MONTH_NAMES[Number(c.month.slice(5, 7)) - 1];
          return (
            <li key={c.month} className={isCovered(c.state) ? "is-loaded" : undefined} title={`${label} ${year}: ${STATE_TITLE[c.state]}`}>
              <span>{label.slice(0, 3)}</span>
              <strong>{STATE_TEXT[c.state]}</strong>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const STATE_BADGE = { value: { tone: "success" as const, text: "Con valor" }, zero: { tone: "neutral" as const, text: "Cero real" }, unidentified: { tone: "warning" as const, text: "Sin valor identificable" } };

/** Auditoría del 1011: cada concepto con su regla, su estado y los términos (periodo, persona, planilla, cálculo) que lo componen. */
export function Audit1011({ form }: { form: Form1011 }) {
  return (
    <Card title="Auditoría del 1011" description="Cada total anual con la regla aplicada y los valores por periodo y empleado que lo componen.">
      <div className="stack">
        {form.lines.map((l) => (
          <details key={l.code} className="audit-item">
            <summary>
              <strong>{l.code}</strong> · {l.label} — <strong>{pesos(l.cents)}</strong> <Badge tone={STATE_BADGE[l.state].tone}>{STATE_BADGE[l.state].text}</Badge>
            </summary>
            <p className="muted">{l.rule}</p>
            {l.terms.length === 0 ? (
              <p className="muted">{l.state === "unidentified" ? "La planilla no separa este valor: no se reporta ni se inventa." : "Sin valores en el año: es un cero real, no se genera registro."}</p>
            ) : (
              <div className="table-wrap table-wrap--scroll" style={{ maxHeight: 280 }}>
                <table className="table table--dense">
                  <thead>
                    <tr>
                      <th>Periodo</th>
                      <th>Empleado</th>
                      <th>Planilla</th>
                      <th>Cálculo</th>
                      <th className="num">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {l.terms.map((t, i) => (
                      <tr key={i}>
                        <td>{monthName(t.period)} {t.period.slice(0, 4)}</td>
                        <td>{t.name} <span className="muted">{t.person}</span></td>
                        <td className="muted">#{t.batchId} · {t.fileName}</td>
                        <td className="muted">{t.calc}</td>
                        <td className="num">{pesos(t.cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        ))}
      </div>
    </Card>
  );
}

/** Auditoría del 2276: un empleado por fila con sus acumulados y, al abrirlo, el detalle mensual que los compone. */
export function Audit2276({ form }: { form: Form2276 }) {
  return (
    <Card flush title={`Auditoría del 2276 (${form.employees.length})`} description="Acumulados anuales por empleado. Abre uno para ver el detalle mensual de cada valor.">
      {form.employees.length === 0 ? (
        <p className="muted" style={{ padding: 16 }}>Aún no hay planillas con detalle para este año.</p>
      ) : (
        <div className="table-wrap table-wrap--scroll">
          <table className="table table--dense">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Nombre</th>
                <th>Nombre separado</th>
                <th className="num">Salarios</th>
                <th className="num">Prestaciones</th>
                <th className="num">Otros pagos</th>
                <th className="num">Cesantías e int.</th>
                <th className="num">Total bruto</th>
                <th className="num">Salud 4 %</th>
                <th className="num">Pensión 4 %</th>
                <th className="num">Prom. 6 meses</th>
              </tr>
            </thead>
            <tbody>
              {form.employees.map((e) => (
                <EmployeeRows key={e.key} e={e} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function EmployeeRows({ e }: { e: Form2276["employees"][number] }) {
  const a = e.amountsCents;
  return (
    <>
      <tr>
        <td>{e.docType} {e.docNumber}</td>
        <td>{e.name}</td>
        <td>{e.confirmed ? <Badge tone="success">Confirmado</Badge> : <Badge tone="info">Pendiente de confirmar</Badge>}</td>
        <td className="num">{pesos(a.salaries)}</td>
        <td className="num">{pesos(a.benefits)}</td>
        <td className="num">{pesos(a.otherPayments)}</td>
        <td className="num">{pesos(a.severanceAndInterest)}</td>
        <td className="num">{pesos(a.grossTotal)}</td>
        <td className="num">{pesos(a.healthContribution)}</td>
        <td className="num">{pesos(a.pensionContribution)}</td>
        <td className="num">{pesos(a.avgIncome6m)}</td>
      </tr>
      <tr>
        <td colSpan={11} style={{ padding: 0 }}>
          <details className="audit-item" style={{ margin: "0 12px" }}>
            <summary className="muted">Detalle mensual de {e.name}</summary>
            <table className="table table--dense">
              <thead>
                <tr>
                  <th>Periodo</th>
                  <th>Planilla</th>
                  <th className="num">Días</th>
                  <th className="num">IBC pensión</th>
                  <th className="num">IBC salud</th>
                  <th className="num">Salario causado</th>
                  <th className="num">Base mensual</th>
                  <th className="num">Vacaciones</th>
                  <th className="num">Prima</th>
                  <th className="num">Auxilio</th>
                  <th className="num">Cesantías</th>
                  <th className="num">Intereses</th>
                </tr>
              </thead>
              <tbody>
                {e.lines.map((l) => (
                  <tr key={l.period}>
                    <td>{monthName(l.period)}</td>
                    <td className="muted">#{l.batchId} · {l.operatorLabel}</td>
                    <td className="num">{l.calc.days}</td>
                    <td className="num">{formatInteger(l.person.pension.ibc ?? 0)}</td>
                    <td className="num">{formatInteger(l.person.health.ibc ?? 0)}</td>
                    <td className="num">{pesos(l.calc.salaryCents)}</td>
                    <td className="num">{pesos(l.calc.baseSalaryCents)}</td>
                    <td className="num">{pesos(l.calc.vacacionesCents)}</td>
                    <td className="num">{pesos(l.calc.primaCents)}</td>
                    <td className="num">{pesos(l.calc.transportCents)}</td>
                    <td className="num">{pesos(l.calc.cesantiasCents)}</td>
                    <td className="num">{pesos(l.calc.interesesCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </td>
      </tr>
    </>
  );
}
