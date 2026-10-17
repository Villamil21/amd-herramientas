import { useMemo } from "react";
import { Alert, Badge, Card } from "../../../../components/ui";
import { formatExactCents, periodLabel } from "../../shared/money";
import { SendToFs } from "../../shared/components/SendToFs";
import type { CryptoModel } from "../domain/model";
import { PRESENTATION_LABEL } from "../domain/types";
import { blocking } from "../domain/problems";
import type { CryptoData } from "../useCryptoData";
import { buildEeffBatch, type EeffSyncState } from "../eeffBatch";

const money = (c: number | null) => (c === null ? "—" : formatExactCents(c));

interface Props {
  data: CryptoData;
  model: CryptoModel;
  companyId: number;
  year: number;
  onSent: () => void;
  onPuc: () => void;
  sync: { state: EeffSyncState; updating: boolean };
}

/** Estados Financieros: cálculo del ingreso propio y valor de referencia, componentes con su PUC y envío al motor. */
export function EeffTab({ model, companyId, onSent, onPuc, sync }: Props) {
  const { eeff, settings, components } = model;
  const problems = model.problems.eeff;
  const blockers = blocking(problems);
  const monthCols = useMemo(() => eeff.reference.months, [eeff]);

  const build = () => buildEeffBatch(companyId, model);

  return (
    <div className="stack">
      <SendToFs
        build={build}
        blocked={blockers[0]?.message ?? null}
        reasons={blockers.map((b) => b.message.replace(/\.$/, ""))}
        blockedStatus="Requiere revisión"
        duplicateTitle="Estados Financieros ya recibió el cálculo de este año."
        replaceLabel="Reemplazar con el cálculo actual"
        onSent={onSent}
      />
      {sync.state === "in_sync" && <Alert tone="success">Estados Financieros está al día con este cálculo. Los cambios de cargas, decisiones, corte, presentación o cuentas PUC lo actualizan automáticamente.</Alert>}
      {sync.state === "update" && <Alert tone="info">{sync.updating ? "Actualizando Estados Financieros…" : "Estados Financieros se actualizará con el cálculo vigente."}</Alert>}
      {(sync.state === "stale" || sync.state === "retire") && (
        <Alert tone="danger" title="Estados Financieros no incluye Transacciones Cripto mientras no se pueda recalcular">
          {sync.state === "retire" ? "Se está retirando el envío anterior del cálculo vigente. " : "El envío anterior se retiró del cálculo vigente y se conserva para auditoría. "}
          Con los pendientes de arriba no se puede generar, marcar como listo ni cerrar ningún estado financiero de este año; al resolverlos, se envía el cálculo actualizado automáticamente.
        </Alert>
      )}
      {problems.filter((p) => p.level === "warning").map((p) => (
        <Alert key={p.message} tone="warning">
          {p.message}
        </Alert>
      ))}
      {blockers.some((b) => b.kind === "puc") && (
        <Alert tone="warning" title="Cuentas PUC">
          <button type="button" className="btn btn--sm" onClick={onPuc}>
            Configurar cuentas PUC
          </button>
        </Alert>
      )}

      <Card flush title="Ingreso propio" description="Ventas aplicables − compras aplicables hasta el corte.">
        <div className="table-wrap">
          <table className="table table--dense">
            <tbody>
              <tr>
                <td>Compras aceptadas hasta el corte</td>
                <td className="num">{money(eeff.purchasesCents)}</td>
              </tr>
              <tr>
                <td>Ventas aplicables</td>
                <td className="num">{money(eeff.salesCents)}</td>
              </tr>
              <tr className="fs-row--subtotal">
                <td>Ingreso propio</td>
                <td className="num">{money(eeff.ownIncomeCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {eeff.uploadSales.length > 0 && (
          <div className="table-wrap">
            <table className="table table--dense">
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th className="num">Ventas</th>
                  <th>Tratamiento frente al corte</th>
                </tr>
              </thead>
              <tbody>
                {eeff.uploadSales.map((u) => (
                  <tr key={u.uploadId}>
                    <td>{u.fileName}</td>
                    <td className="num">{money(u.salesCents)}</td>
                    <td>{u.scope.status === "included" ? "Incluidas" : u.scope.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card flush title="Valor de referencia para terceros" description="Promedio acumulado mensual de compras; se toma el máximo y se suman $50.000.000 si ese tramo termina antes del mes de corte.">
        {monthCols.length === 0 ? (
          <p className="muted" style={{ padding: 12 }}>{eeff.reference.note ?? "Sin compras aplicables."}</p>
        ) : (
          <div className="table-wrap">
            <table className="table table--dense">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th className="num">Compras</th>
                  <th className="num">Acumulado</th>
                  <th className="num">Promedio acumulado</th>
                </tr>
              </thead>
              <tbody>
                {monthCols.map((m, i) => (
                  <tr key={m.month} className={i === eeff.reference.winnerIndex ? "fs-row--subtotal" : undefined}>
                    <td>
                      {periodLabel(m.month)} {i === eeff.reference.winnerIndex && <Badge tone="gold">Máximo</Badge>}
                    </td>
                    <td className="num">{money(m.purchasesCents)}</td>
                    <td className="num">{money(m.cumulativeCents)}</td>
                    <td className="num">{money(m.averageCents)}</td>
                  </tr>
                ))}
                <tr>
                  <td>Ajuste por tramo anterior al corte</td>
                  <td colSpan={3} className="num">{money(eeff.reference.adjustmentCents)}</td>
                </tr>
                <tr className="fs-row--subtotal">
                  <td>Valor de referencia</td>
                  <td colSpan={3} className="num">{money(eeff.reference.referenceCents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card flush title={`Componentes · ${PRESENTATION_LABEL[settings.presentation]}`} description="Lo que se envía a Estados Financieros, con su cuenta PUC y dónde aparece.">
        <div className="table-wrap">
          <table className="table table--dense">
            <thead>
              <tr>
                <th>Componente</th>
                <th>Fórmula</th>
                <th className="num">Valor</th>
                <th>PUC</th>
                <th>Ubicación</th>
              </tr>
            </thead>
            <tbody>
              {components.map((c) => (
                <tr key={c.key}>
                  <td>{c.label}</td>
                  <td className="muted">{c.formula}</td>
                  <td className="num">{money(c.cents)}</td>
                  <td>{c.puc.code ? <span className="puc-chip">{c.puc.code}</span> : <Badge tone="warning">Sin cuenta</Badge>}</td>
                  <td>{c.issue ?? c.puc.location ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
