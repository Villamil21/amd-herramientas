import type { ReactNode } from "react";

export function Badge({ tone, children }: { tone?: "gold" | "dark" | "success" | "warning" | "danger"; children: ReactNode }) {
  return <span className={`badge ${tone ? `badge--${tone}` : ""}`}>{children}</span>;
}
