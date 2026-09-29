import { Badge } from "../../../../components/ui";
import { CATEGORY_LABEL } from "../services/statuses";
import type { StatusCategory } from "../types";

const TONE: Partial<Record<StatusCategory, "gold" | "dark" | "success" | "warning" | "danger">> = {
  delivered: "success",
  cancelled_group: "danger",
  returned: "dark",
  claim: "gold",
  unclassified: "warning",
};

export function CategoryBadge({ category }: { category: StatusCategory }) {
  return <Badge tone={TONE[category]}>{CATEGORY_LABEL[category]}</Badge>;
}
