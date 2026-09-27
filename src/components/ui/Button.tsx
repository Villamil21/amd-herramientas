import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dark";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "md" | "sm";
  icon?: ReactNode;
  loading?: boolean;
  iconOnly?: boolean;
}

export function Button({ variant = "secondary", size = "md", icon, loading, iconOnly, className, children, disabled, type = "button", ...rest }: Props) {
  const cls = ["btn", `btn--${variant}`, size === "sm" && "btn--sm", iconOnly && "btn--icon", className].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
}
