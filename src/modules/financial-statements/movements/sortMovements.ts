import { MOVEMENT_STATUS_LABEL, SOURCE_LABEL, type Movement } from "../../../types/fs";
import type { SortDirection } from "../../bank-analysis/shared/components/tableControls";

export type MovementSortKey = "date" | "source" | "document" | "puc" | "value" | "status";

/** Orden de la tabla (función pura): fecha, origen, documento, PUC, valor o estado; a igual valor, por fecha e id. */
export function sortMovements(list: Movement[], key: MovementSortKey, direction: SortDirection): Movement[] {
  const text = (m: Movement): string | number => {
    switch (key) {
      case "source":
        return SOURCE_LABEL[m.source];
      case "document":
        return `${m.documentNumber || m.documentId}`;
      case "puc":
        return m.pucCode;
      case "value":
        return m.amountCents;
      case "status":
        return MOVEMENT_STATUS_LABEL[m.status];
      default:
        return m.accountingDate;
    }
  };
  const sign = direction === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const x = text(a);
    const y = text(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es", { numeric: true });
    return c !== 0 ? sign * c : a.accountingDate.localeCompare(b.accountingDate) || a.id - b.id;
  });
}

