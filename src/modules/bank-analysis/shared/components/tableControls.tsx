import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { Input } from "../../../../components/ui";

/**
 * Controles comunes de las tablas agrupadas de todos los bancos: buscador,
 * filtro segmentado y encabezado ordenable. Solo cambian la vista.
 */

export type SortDirection = "asc" | "desc";

export function SearchBox({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="search">
      <Search size={14} />
      <Input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function SegmentedFilter<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} className={value === o.id ? "is-active" : undefined} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SortableTh({ label, active, direction, numeric = false, onToggle }: { label: ReactNode; active: boolean; direction: SortDirection; numeric?: boolean; onToggle: () => void }) {
  const Arrow = direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={numeric ? "num" : undefined} aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <button className={`th-sort ${active ? "is-active" : ""}`} onClick={onToggle}>
        {label}
        {active && <Arrow size={12} />}
      </button>
    </th>
  );
}

/** Punto discreto + texto (● Positivo, ● Crédito…). "positive" verde, "negative" rojo, "zero" gris. */
export function DotLabel({ tone, children }: { tone: "positive" | "negative" | "zero"; children: ReactNode }) {
  return (
    <span className={`sign-label sign-label--${tone}`}>
      <span className="sign-label__dot" aria-hidden />
      {children}
    </span>
  );
}
