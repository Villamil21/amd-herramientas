import { Modal } from "../../../../components/ui";
import { formatMoneyCents } from "../../../../utils/format";
import type { CoopcentralGroup } from "../types";
import { amountClass, TypeLabel } from "../../shared/components/TypeLabel";

/** Movimientos de un grupo. Las columnas opcionales solo aparecen si se extrajeron; no se inventan datos. */
export function CoopcentralGroupDetailModal({ group, onClose }: { group: CoopcentralGroup | null; onClose: () => void }) {
  if (!group) return null;
  const { movements } = group;
  const show = {
    document: movements.some((m) => m.document),
    applicationDate: movements.some((m) => m.applicationDate),
    operationDate: movements.some((m) => m.operationDate),
    office: movements.some((m) => m.office),
    electronicTransfer: movements.some((m) => m.electronicTransfer),
    balance: movements.every((m) => m.balanceCents !== undefined),
  };

  return (
    <Modal
      open
      size="xl"
      title={group.concept}
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
      <div className="table-wrap table-wrap--scroll group-detail group-detail--nowrap">
        <table className="table">
          <thead>
            <tr>
              <th>Concepto</th>
              <th>Tipo</th>
              <th className="num">Valor</th>
              {show.balance && <th className="num">Saldo</th>}
              {show.applicationDate && <th>F. aplicación</th>}
              {show.operationDate && <th>F. operación</th>}
              {show.document && <th>Documento</th>}
              {show.office && <th>Oficina</th>}
              {show.electronicTransfer && <th>Trans. electrónica</th>}
              <th className="num">Página</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.index}>
                <td className="selectable">{m.concept}</td>
                <td>
                  <TypeLabel type={m.transactionType} />
                </td>
                <td className={`num ${amountClass(m.transactionType)}`}>{formatMoneyCents(m.amountCents)}</td>
                {show.balance && <td className="num muted">{formatMoneyCents(m.balanceCents!)}</td>}
                {show.applicationDate && <td>{m.applicationDate ?? ""}</td>}
                {show.operationDate && <td>{m.operationDate ?? ""}</td>}
                {show.document && <td className="selectable">{m.document ?? ""}</td>}
                {show.office && <td>{m.office ?? ""}</td>}
                {show.electronicTransfer && <td className="selectable">{m.electronicTransfer ?? ""}</td>}
                <td className="num muted">{m.page}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
