import { Card, EmptyState } from "../../../../../components/ui";
import { formatExoCents } from "../../../../exogena/domain/numbers";
import { formatExactCents, periodLabel } from "../../../shared/money";
import { maskAccount } from "../../../generator/checks";
import { formatIsoDate } from "../../../shared/money";
import type { Audit1007Row, Audit1011, Audit1012Row } from "../model";
import { Landmark } from "lucide-react";

const dmy = (iso: string) => (iso ? formatIsoDate(iso) : "—");

/** 1012: el saldo de diciembre usado por banco y cuenta, con el extracto que lo originó (nunca el de otro mes). */
export function Audit1012({ rows, year }: { rows: Audit1012Row[]; year: number }) {
  return (
    <Card flush title="Auditoría del 1012 · saldo al 31 de diciembre" description={`Cada valor es el saldo final del extracto de diciembre de ${year} de la cuenta; ningún saldo de otro mes lo sustituye.`}>
      {rows.length === 0 ? (
        <EmptyState icon={<Landmark size={20} />} title="Sin saldos de diciembre" description="Aún no hay extractos de diciembre vigentes para informar." />
      ) : (
        <div className="table-wrap">
          <table className="table table--dense">
            <thead>
              <tr>
                <th>Banco</th>
                <th>NIT</th>
                <th>Cuenta</th>
                <th>Extracto</th>
                <th>Periodo</th>
                <th>Mes usado</th>
                <th className="num">Saldo final</th>
                <th>Decisión</th>
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((r) => [
                ...r.accounts.map((a, i) => (
                  <tr key={`${r.bank}-${a.accountNumber}`}>
                    <td>{i === 0 ? r.bank : ""}</td>
                    <td>{i === 0 ? r.nit : ""}</td>
                    <td className="mono">{maskAccount(a.accountNumber)}</td>
                    <td>
                      {a.fileName || "—"} <span className="muted">· lote #{a.batchId}</span>
                      {a.replacedBatchIds.length > 0 && <div className="table__secondary">Reemplazó {a.replacedBatchIds.map((b) => `#${b}`).join(", ")}</div>}
                    </td>
                    <td>{a.period.split(" a ").map(dmy).join(" a ")}</td>
                    <td>{periodLabel(a.month)}</td>
                    <td className="num">{formatExactCents(a.closingBalanceCents)}</td>
                    <td>{a.decision}</td>
                  </tr>
                )),
                <tr key={`${r.bank}-total`} className="fs-row--subtotal">
                  <td colSpan={6}>
                    <strong>
                      {r.bank} · total del 1012 <span className="muted">({r.accounts.length === 1 ? "1 cuenta" : `${r.accounts.length} cuentas`})</span>
                    </strong>
                  </td>
                  <td className="num">
                    <strong>{formatExoCents(r.totalCents)}</strong>
                  </td>
                  <td />
                </tr>,
              ])}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** 1007: los intereses por banco, mes y movimiento que componen cada total. */
export function Audit1007({ rows }: { rows: Audit1007Row[] }) {
  return (
    <Card flush title="Auditoría de intereses bancarios (1007 · concepto 4003)" description="Suma de los intereses generados de todos los meses importados del año, por banco. Los abonos, transferencias y consignaciones no se cuentan.">
      {rows.length === 0 ? (
        <EmptyState icon={<Landmark size={20} />} title="Sin intereses bancarios" description="No hay conceptos confirmados como interés generado en los extractos del año." />
      ) : (
        <div className="table-wrap">
          <table className="table table--dense">
            <thead>
              <tr>
                <th>Banco</th>
                <th>Mes</th>
                <th>Cuenta</th>
                <th>Extracto</th>
                <th>Concepto</th>
                <th>Fecha</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((r) => [
                ...r.months.flatMap((m) =>
                  m.items.map((it, i) => (
                    <tr key={`${r.bank}-${m.month}-${it.batchId}-${it.concept}-${i}`}>
                      <td>{r.bank}</td>
                      <td>{periodLabel(m.month)}</td>
                      <td className="mono">{maskAccount(it.account)}</td>
                      <td>
                        {it.fileName || "—"} <span className="muted">· lote #{it.batchId}</span>
                      </td>
                      <td>{it.concept}</td>
                      <td>{dmy(it.date)}</td>
                      <td className="num">{formatExactCents(it.cents)}</td>
                    </tr>
                  )),
                ),
                ...r.months.map((m) => (
                  <tr key={`${r.bank}-${m.month}-sub`} className="fs-row--subtotal">
                    <td colSpan={6}>
                      {r.bank} · intereses de {periodLabel(m.month).toLowerCase()}
                    </td>
                    <td className="num">{formatExactCents(m.cents)}</td>
                  </tr>
                )),
                <tr key={`${r.bank}-total`} className="fs-row--subtotal">
                  <td colSpan={6}>
                    <strong>
                      {r.bank} · total del 1007 (NIT {r.nit})
                    </strong>
                  </td>
                  <td className="num">
                    <strong>{formatExoCents(r.totalCents)}</strong>
                  </td>
                </tr>,
              ])}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** 1011 · 8211: GMF anual bruto, porcentaje deducible aplicado una sola vez y valor final, con el detalle por banco, mes y extracto. */
export function Audit1011Gmf({ audit }: { audit: Audit1011 }) {
  return (
    <Card flush title="Auditoría del 8211 · GMF (4x1000) deducible" description="Una sola fila para la empresa: el porcentaje deducible se aplica una única vez sobre el GMF anual de todos los bancos y cuentas.">
      <div className="row" style={{ gap: 24, flexWrap: "wrap", padding: "var(--space-3) var(--space-5)" }}>
        <span>
          GMF anual bruto: <strong>{formatExactCents(audit.grossCents)}</strong>
        </span>
        <span>
          Porcentaje deducible aplicado: <strong>{audit.percent} %</strong>
        </span>
        <span>
          Valor reportado: <strong>{formatExoCents(audit.reportedCents)}</strong>
        </span>
      </div>
      {audit.banks.length === 0 ? (
        <EmptyState icon={<Landmark size={20} />} title="Sin GMF confirmado" description="No hay conceptos confirmados como GMF en los extractos del año." />
      ) : (
        <div className="table-wrap">
          <table className="table table--dense">
            <thead>
              <tr>
                <th>Banco</th>
                <th>Mes</th>
                <th>Cuenta</th>
                <th>Extracto</th>
                <th>Concepto</th>
                <th className="num">Movs.</th>
                <th className="num">GMF neto</th>
              </tr>
            </thead>
            <tbody>
              {audit.banks.flatMap((b) => [
                ...b.months.flatMap((m) =>
                  m.statements.flatMap((s) =>
                    s.concepts.map((c, i) => (
                      <tr key={`${b.bank}-${m.month}-${s.batchId}-${i}`}>
                        <td>{b.bank}</td>
                        <td>{periodLabel(m.month)}</td>
                        <td className="mono">{maskAccount(s.account)}</td>
                        <td>
                          {s.fileName || "—"} <span className="muted">· lote #{s.batchId}</span>
                        </td>
                        <td>{c.description}</td>
                        <td className="num">{c.count}</td>
                        <td className="num">{formatExactCents(c.cents)}</td>
                      </tr>
                    )),
                  ),
                ),
                <tr key={`${b.bank}-total`} className="fs-row--subtotal">
                  <td colSpan={6}>
                    <strong>{b.bank} · GMF anual</strong>
                  </td>
                  <td className="num">
                    <strong>{formatExactCents(b.grossCents)}</strong>
                  </td>
                </tr>,
              ])}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
