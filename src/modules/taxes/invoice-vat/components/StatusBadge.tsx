import { Badge } from "../../../../components/ui";
import { STATUS_LABEL } from "../services/labels";
import type { InvoiceStatus } from "../types";

const TONE = { processed: "success", "pending-supplier": "gold", review: "warning", incompatible: "danger", error: "danger" } as const;

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge tone={TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
