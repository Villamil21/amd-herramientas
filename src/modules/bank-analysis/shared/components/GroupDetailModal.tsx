import { Modal } from "../../../../components/ui";
import { formatMoneyCents } from "../../../../utils/format";
import type { MovementGroup } from "../types";
import { DEFAULT_GROUP_LABELS, type GroupLabels } from "./groupLabels";
import { SignLabel } from "./SignLabel";

export function GroupDetailModal({ group, labels = DEFAULT_GROUP_LABELS, onClose }: { group: MovementGroup | null; labels?: GroupLabels; onClose: () => void }) {
  if (!group) return null;
  const { movements } = group;
  const showBalance = movements.every((m) => m.balanceCents !== undefined);
  const showBranch = movements.some((m) => m.branch);
  const showDocument = movements.some((m) => m.document);

  return (
    <Modal
      open
      size="lg"
      title={group.description}
      description={
        <span className="row">
          <SignLabel sign={group.sign} />
          <span>·</span>
          <span>
            {group.count} {group.count === 1 ? "movimiento" : "movimientos"}
          </span>
          <span>·</span>
          <strong className={`amount--${group.sign}`}>{formatMoneyCents(group.totalCents)}</strong>
        </span>
      }
      onClose={onClose}
    >
      <div className="table-wrap group-detail">
        <table className="table">
          <thead>
            <tr>
              <th>{labels.date ?? "Fecha"}</th>
              <th>{labels.description}</th>
              {showBranch && <th>{labels.branch}</th>}
              {showDocument && <th>{labels.document}</th>}
              <th className="num">{labels.value ?? "Valor"}</th>
              {showBalance && <th className="num">Saldo</th>}
              <th className="num">Página</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.index}>
                <td>{m.fullDate ?? m.date}</td>
                <td className="selectable">{m.description}</td>
                {showBranch && <td>{m.branch ?? ""}</td>}
                {showDocument && <td>{m.document ?? ""}</td>}
                <td className={`num amount--${m.sign}`}>{formatMoneyCents(m.valueCents)}</td>
                {showBalance && <td className="num muted">{formatMoneyCents(m.balanceCents!)}</td>}
                <td className="num muted">{m.page}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
