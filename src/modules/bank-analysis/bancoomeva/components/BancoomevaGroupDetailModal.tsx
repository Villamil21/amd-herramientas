import { Modal } from "../../../../components/ui";
import { formatMoneyCents } from "../../../../utils/format";
import { amountClass, TypeLabel } from "../../shared/components/TypeLabel";
import type { BancoomevaGroup } from "../types";

/** Movimientos de un grupo. Oficina y Saldo solo aparecen si se extrajeron; no se inventan datos. */
export function BancoomevaGroupDetailModal({ group, onClose }: { group: BancoomevaGroup | null; onClose: () => void }) {
  if (!group) return null;
  const { movements } = group;
  const show = {
    office: movements.some((m) => m.office),
    balance: movements.every((m) => m.balanceCents !== undefined),
  };

  return (
    <Modal
      open
      size="xl"
      title={group.description}
      description={
        <span className="row">
          <TypeLabel type={group.transactionType} />
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
      <div className="table-wrap group-detail group-detail--nowrap">
        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th>
              {show.office && <th>Oficina</th>}
              <th>Descripción</th>
              <th>Tipo</th>
              <th className="num">Valor</th>
              {show.balance && <th className="num">Saldo</th>}
              <th className="num">Página</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.index}>
                <td>{m.date}</td>
                {show.office && <td>{m.office ?? ""}</td>}
                <td className="selectable">{m.description}</td>
                <td>
                  <TypeLabel type={m.transactionType} />
                </td>
                <td className={`num ${amountClass(m.transactionType)}`}>{formatMoneyCents(m.amountCents)}</td>
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
