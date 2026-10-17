import { useState } from "react";
import { Alert, Badge, Button, Card, useToast } from "../../../../components/ui";
import { formatExactCents } from "../../shared/money";
import { errorMessage } from "../../../../services/tauri";
import { formatInteger } from "../../../../utils/format";
import type { CryptoModel } from "../domain/model";
import { blocking, type CryptoProblem } from "../domain/problems";
import { syncCryptoFormat, type CryptoExoFormat } from "../exogenaSync";
import type { CryptoData } from "../useCryptoData";
import { ResolveModal } from "./ResolveModals";

const RESOLVABLE = new Set(["document_type", "city_unknown", "city_ambiguous", "city_multiple", "city_empty", "country", "assignment"]);

interface Props {
  data: CryptoData;
  model: CryptoModel;
  companyId: number;
}

function ProblemList({ problems, onResolve }: { problems: CryptoProblem[]; onResolve: (p: CryptoProblem) => void }) {
  if (problems.length === 0) return <Alert tone="success">Sin pendientes.</Alert>;
  return (
    <ul className="pending-list">
      {problems.map((p, i) => (
        <li key={i} className={`pending-item pending-item--${p.level}`}>
          <div className="pending-item__text">{p.message}</div>
          {RESOLVABLE.has(p.kind) && (
            <div className="pending-item__actions">
              <Button size="sm" onClick={() => onResolve(p)}>
                Resolver
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Exógena: 1007 (ingresos, concepto 4001) y 1647 (ingresos recibidos para terceros, concepto 4070) propuestos desde las operaciones aceptadas. */
export function ExogenaTab({ data, model, companyId }: Props) {
  const toast = useToast();
  const [resolving, setResolving] = useState<CryptoProblem | null>(null);
  const [syncing, setSyncing] = useState<CryptoExoFormat | null>(null);

  async function sync(format: CryptoExoFormat) {
    setSyncing(format);
    try {
      const o = await syncCryptoFormat({ companyId, year: model.year, model, format });
      toast(`${format}: ${o.created} nuevos · ${o.updated} actualizados · ${o.unchanged} sin cambios · ${o.removed} retirados.`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSyncing(null);
    }
  }

  const f7 = model.form1007;
  const f47 = model.form1647;
  const p7 = model.problems.f1007;
  const p47 = model.problems.f1647;

  return (
    <div className="stack">
      <Card
        title="1007 · Ingresos recibidos"
        description="Concepto 4001: una fila por cliente de Ventas, con su suma en pesos enteros."
        actions={
          <Button variant="primary" loading={syncing === "1007"} disabled={f7.records.length === 0} onClick={() => void sync("1007")}>
            Enviar a Exógena 1007
          </Button>
        }
      >
        <p className="muted">
          {formatInteger(f7.records.length)} registros · origen {formatExactCents(f7.originCents)} · propuesto {formatExactCents(f7.includedCents)} · sin proponer {formatExactCents(f7.unproposedCents)}
        </p>
        <ProblemList problems={p7} onResolve={setResolving} />
        {blocking(p7).length === 0 && <Badge tone="success">Listo para marcar</Badge>}
      </Card>

      <Card
        title="1647 · Ingresos recibidos para terceros"
        description="Concepto 4070: cada tercero de Compras se asigna completo a un pagador de Ventas con saldo (sin dividirlo); la ciudad sale del código municipal."
        actions={
          <Button variant="primary" loading={syncing === "1647"} disabled={f47.records.length === 0} onClick={() => void sync("1647")}>
            Enviar a Exógena 1647
          </Button>
        }
      >
        <p className="muted">
          {formatInteger(f47.records.length)} registros · origen {formatExactCents(f47.originCents)} · asignado {formatExactCents(f47.assignedCents)} · sin asignar {formatExactCents(f47.unassignedCents)} · saldo de Ventas sin usar {formatExactCents(f47.unusedSalesCents)}
        </p>
        <ProblemList problems={p47} onResolve={setResolving} />
      </Card>

      <Card flush title="Saldos de pagadores (Ventas)" description="Cada pagador cubre terceros completos; el saldo restante no se reparte.">
        <div className="table-wrap">
          <table className="table table--dense">
            <thead>
              <tr>
                <th>Pagador</th>
                <th className="num">Total Ventas</th>
                <th className="num">Asignado</th>
                <th className="num">Saldo</th>
                <th className="num">Terceros</th>
              </tr>
            </thead>
            <tbody>
              {f47.payers.map((p) => (
                <tr key={p.key}>
                  <td>{p.label}</td>
                  <td className="num">{formatExactCents(p.totalCents)}</td>
                  <td className="num">{formatExactCents(p.totalCents - p.remainingCents)}</td>
                  <td className="num">{formatExactCents(p.remainingCents)}</td>
                  <td className="num">{p.assigned.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {data.catalogs && <ResolveModal problem={resolving} data={data} model={model} catalogs={data.catalogs} onClose={() => setResolving(null)} />}
    </div>
  );
}
