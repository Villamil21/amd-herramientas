import { Badge, Card } from "../../../../components/ui";
import { formatDateForDisplay } from "../../../../utils/dates";
import { formatInteger } from "../../../../utils/format";
import type { EeffSyncState } from "../eeffBatch";
import { formatExactCents } from "../../shared/money";
import type { CryptoModel } from "../domain/model";

export const effectiveText = (model: CryptoModel) =>
  model.eeff.effectiveFromCoverage ? `Efecto contable fechado al ${formatDateForDisplay(model.eeff.effectiveDate)}, según la última cobertura aceptada.` : `Efecto contable fechado al ${formatDateForDisplay(model.eeff.effectiveDate)}, la fecha de corte.`;

const money = (c: number | null) => (c === null ? "—" : formatExactCents(c));
const diff = (c: number | null) => (c === null ? <Badge tone="warning">Pendiente</Badge> : c === 0 ? <Badge tone="success">Conciliado</Badge> : <Badge tone="danger">{formatExactCents(c)}</Badge>);

/** Conciliación: Estados Financieros, 1007, 1647, archivos y pendientes. Cada diferencia se resuelve en su origen. */
const SYNC_LABEL: Record<EeffSyncState, string> = { none: "Aún no se ha enviado", in_sync: "Al día con el cálculo", update: "Se está actualizando", retire: "Se está retirando del cálculo", stale: "Retirado del cálculo: hay pendientes que impiden recalcular (se conserva para auditoría)" };

export function ReconciliationCard({ model, sync }: { model: CryptoModel; sync: EeffSyncState }) {
  const r = model.reconciliation;
  const rows = r.rows;
  const lines: { label: string; hint: string; b: { purchase: number; sale: number }; counts: boolean }[] = [
    { label: "Aceptadas", hint: "Alimentan Estados Financieros, 1007 y 1647.", b: rows.accepted, counts: true },
    { label: "Compras con fecha de otro año", hint: "Pendientes: no cuentan hasta excluirlas o corregir el archivo.", b: rows.outOfYear, counts: false },
    { label: "Fecha o valor ilegible o vacío", hint: "Pendientes: no cuentan hasta excluirlas o corregir el archivo.", b: rows.invalid, counts: false },
    { label: `Posibles duplicados sin decidir (${formatInteger(rows.duplicateGroups)} ${rows.duplicateGroups === 1 ? "grupo" : "grupos"})`, hint: "Pendientes: no cuentan hasta decidir cada grupo.", b: rows.duplicatesPending, counts: false },
    { label: "Excluidas por ti (fuera de año o ilegibles)", hint: "Conservadas para auditoría; no cuentan.", b: rows.excludedByUser, counts: false },
    { label: "Excluidas por ti como duplicado", hint: "Conservadas para auditoría; no cuentan.", b: rows.excludedAsDuplicate, counts: false },
  ];
  return (
    <Card flush title="Conciliación" description="Cada diferencia se corrige en su origen (archivo, decisión o cuenta PUC); nada se ajusta aquí.">
      <div className="table-wrap">
        <table className="table table--dense">
          <thead>
            <tr>
              <th>Filas de las cargas vigentes</th>
              <th className="num">Compras</th>
              <th className="num">Ventas</th>
              <th className="num">Total</th>
              <th>Efecto</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.label}>
                <td>{l.label}</td>
                <td className="num">{formatInteger(l.b.purchase)}</td>
                <td className="num">{formatInteger(l.b.sale)}</td>
                <td className="num">{formatInteger(l.b.purchase + l.b.sale)}</td>
                <td>{l.hint}</td>
              </tr>
            ))}
            <tr>
              <td>
                <strong>Filas guardadas (fuente)</strong>
              </td>
              <td className="num" colSpan={2} />
              <td className="num">
                <strong>{formatInteger(rows.total)}</strong>
              </td>
              <td>
                {rows.unexplained === 0 ? <Badge tone="success">Cuadra: 0 filas sin estado</Badge> : <Badge tone="danger">{formatInteger(rows.unexplained)} filas sin estado: bloquea todo resultado</Badge>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ padding: "8px 12px" }}>
        Solo las filas aceptadas entran en Estados Financieros, 1007 y 1647.
        {rows.retired > 0 ? ` Además hay ${formatInteger(rows.retired)} filas de cargas retiradas: se conservan y no cuentan.` : ""} Las filas vacías del Excel no se guardan: se cuentan al importar.
      </p>
      <div className="table-wrap">
        <table className="table table--dense">
          <thead>
            <tr>
              <th>Concepto</th>
              <th className="num">Origen</th>
              <th className="num">Calculado</th>
              <th className="num">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Estados Financieros · ingreso propio frente a componentes</td>
              <td className="num">{money(r.eeff.ownIncomeCents)}</td>
              <td className="num">{money(r.eeff.resultCents)}</td>
              <td className="num">{diff(r.eeff.differenceCents)}</td>
            </tr>
            <tr>
              <td>1007 · Ventas aceptadas frente a registros</td>
              <td className="num">{money(r.f1007.originCents)}</td>
              <td className="num">{money(r.f1007.proposedCents)}</td>
              <td className="num">{diff(r.f1007.differenceCents)}</td>
            </tr>
            <tr>
              <td>1647 · Compras aceptadas frente a terceros asignados</td>
              <td className="num">{money(r.f1647.originCents)}</td>
              <td className="num">{money(r.f1647.distributedCents)}</td>
              <td className="num">{diff(r.f1647.differenceCents)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ padding: "8px 12px" }}>
        Efecto en Estados Financieros: <strong>{SYNC_LABEL[sync]}</strong>. {effectiveText(model)}
      </p>
      <div className="table-wrap">
        <table className="table table--dense">
          <thead>
            <tr>
              <th>Archivo</th>
              <th>Versión</th>
              <th>Cobertura</th>
              <th className="num">Filas</th>
              <th className="num">Pendientes</th>
              <th className="num">Excluidas</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {r.uploads.map((u) => (
              <tr key={u.id}>
                <td>{u.fileName}</td>
                <td>{u.version}</td>
                <td>{u.coverage}</td>
                <td className="num">{formatInteger(u.rows)}</td>
                <td className="num">{formatInteger(u.pending)}</td>
                <td className="num">{formatInteger(u.excluded)}</td>
                <td>{u.status === "active" ? "Vigente" : "Retirada"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ padding: "8px 12px" }}>
        Pendientes: {r.pending.duplicates} duplicados · {r.pending.cities} ciudades · {r.pending.documentTypes} tipos de documento · {r.pending.puc} cuentas PUC · {r.pending.requiredFields} datos obligatorios.
      </p>
    </Card>
  );
}
