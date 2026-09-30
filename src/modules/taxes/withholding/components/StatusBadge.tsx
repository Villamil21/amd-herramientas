import { Badge } from "../../../../components/ui";
import { STATUS_LABEL, STATUS_TONE } from "../services/labels";
import type { DocStatus } from "../types";

export function StatusBadge({ status }: { status: DocStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
