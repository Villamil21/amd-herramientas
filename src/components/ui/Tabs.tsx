import type { KeyboardEvent, ReactNode } from "react";

export interface TabDef<T extends string> {
  id: T;
  label: string;
  /** Cambios sin guardar en esta pestaña: se señala con un punto. */
  dirty?: boolean;
  /** Texto breve a la derecha del título (conteo, aviso). */
  badge?: ReactNode;
}

interface Props<T extends string> {
  tabs: TabDef<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}

/** Pestañas accesibles (flechas ← → y Inicio / Fin). El contenido lo pinta quien las usa, con `role="tabpanel"`. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: Props<T>) {
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const at = tabs.findIndex((t) => t.id === value);
    const next = e.key === "ArrowRight" ? (at + 1) % tabs.length : e.key === "ArrowLeft" ? (at - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    (e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus();
  }
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={t.id === value} aria-controls={`panel-${t.id}`} tabIndex={t.id === value ? 0 : -1} className={`tabs__tab${t.id === value ? " is-active" : ""}`} onClick={() => onChange(t.id)}>
          {t.label}
          {t.dirty && <span className="tabs__dirty" role="img" aria-label="Cambios sin guardar" title="Cambios sin guardar" />}
          {t.badge !== undefined && <span className="tabs__badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}
