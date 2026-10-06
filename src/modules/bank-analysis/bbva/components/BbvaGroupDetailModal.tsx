import { Modal } from "../../../../components/ui";
import { formatMoneyCents } from "../../../../utils/format";
import { amountClass } from "../../shared/components/TypeLabel";
import type { BbvaGroup } from "../types";
import { BbvaTypeLabel } from "./BbvaTypeLabel";

/** Movimientos de un grupo, con Cargo y Abono en columnas separadas como en el extracto. */
export function BbvaGroupDetailModal({ group, onClose }: { group: BbvaGroup | null; onClose: () => void }) {
  if (!group) return null;
  const { movements } = group;
  const show = {
    number: movements.some((m) => m.movementNumber),
    balance: movements.every((m) => m.balanceCents !== undefined),
  };

  return (
    <Modal
      open
      size="xl"
      title={group.concept}
      description={
        <span className="row">
          <BbvaTypeLabel type={group.transactionType} />
          <span>·</span>
          <span>
            {group.count} {group.count === 1 ? "movimiento" : "movimientos"}
          </span>
          <span>·</span>
          <strong className={amountClass(group.transactionType)}>{formatMoneyCents(group.totalCents)}</strong>
        </span>
      }
      onClose={onClose}
    >
      <div className="table-wrap table-wrap--scroll group-detail group-detail--nowrap">
        <table className="table">
          <thead>
            <tr>
              {show.number && <th>Movimiento</th>}
              <th>Fecha operación</th>
              <th>Fecha valor</th>
              <th>Concepto</th>
              <th className="num">Cargo</th>
              <th className="num">Abono</th>
              {show.balance && <th className="num">Saldo</th>}
              <th className="num">Página</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.index}>
                {show.number && <td className="muted">{m.movementNumber ?? ""}</td>}
                <td>{m.operationDate}</td>
                <td>{m.valueDate}</td>
                <td className="selectable">{m.concept}</td>
                <td className="num amount--negative">{m.transactionType === "debit" ? formatMoneyCents(m.chargeCents) : ""}</td>
                <td className="num amount--positive">{m.transactionType === "credit" ? formatMoneyCents(m.creditCents) : ""}</td>
                {show.balance && <td className="num muted">{formatMoneyCents(m.balanceCents!)}</td>}
                <td className="num muted">{m.page}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
