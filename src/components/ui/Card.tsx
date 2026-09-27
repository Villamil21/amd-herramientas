import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  flush?: boolean; // sin padding en el cuerpo (tablas)
}

export function Card({ title, description, actions, footer, flush, children, className, ...rest }: CardProps) {
  return (
    <section className={["card", className].filter(Boolean).join(" ")} {...rest}>
      {(title || actions) && (
        <header className="card__header">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      {flush ? children : <div className="card__body">{children}</div>}
      {footer && <footer className="card__footer">{footer}</footer>}
    </section>
  );
}
