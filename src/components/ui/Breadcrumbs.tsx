import { Fragment } from "react";
import { ChevronRight } from "lucide-react";

export interface Crumb {
  label: string;
  onClick?: () => void;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Ruta">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <Fragment key={i}>
            {last || !item.onClick ? (
              <span className={last ? "breadcrumbs__current" : undefined}>{item.label}</span>
            ) : (
              <button onClick={item.onClick}>{item.label}</button>
            )}
            {!last && <ChevronRight size={13} className="breadcrumbs__sep" />}
          </Fragment>
        );
      })}
    </nav>
  );
}
