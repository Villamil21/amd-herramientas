import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

type Tone = "danger" | "warning" | "success" | "info";

const ICONS = { danger: XCircle, warning: AlertTriangle, success: CheckCircle2, info: Info };

interface Props {
  tone?: Tone;
  title?: ReactNode;
  items?: ReactNode[];
  children?: ReactNode;
}

export function Alert({ tone = "info", title, items, children }: Props) {
  const Icon = ICONS[tone];
  return (
    <div className={`alert alert--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon size={16} />
      <div className="alert__body">
        {title && <div className="alert__title">{title}</div>}
        {children}
        {items && items.length > 0 && (
          <ul>
            {items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
