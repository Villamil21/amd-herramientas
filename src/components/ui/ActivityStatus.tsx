import type { ActivityStatus as Status } from "../../services/activityService";

const LABEL: Record<Status, string> = {
  validated: "Validado",
  processed: "Procesado",
  generated: "Generado",
  warning: "Advertencia",
  error: "Error",
};

/** Estado en píldora: punto de color + texto (nunca solo color). */
export function ActivityStatus({ status }: { status: Status }) {
  return (
    <span className={`status-pill status-pill--${status in LABEL ? status : "processed"}`}>
      <span className="status-pill__dot" aria-hidden />
      {LABEL[status] ?? LABEL.processed}
    </span>
  );
}
