import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface Props {
  /** Nombre accesible del botón («Acciones de EMPRESA SAS»). */
  label: string;
  items: MenuItem[];
  /** Ícono del botón (por defecto «···»). */
  trigger?: ReactNode;
}

/**
 * Menú contextual de acciones secundarias. Se abre con clic, Enter o Espacio; flechas ↑ ↓ navegan, Esc cierra y devuelve el
 * foco al botón. Se dibuja en un portal para no recortarse dentro de tablas con desplazamiento.
 */
export function Menu({ label, items, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !button.current?.contains(t)) close(false);
    };
    const dismiss = () => close(false);
    document.addEventListener("mousedown", away);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open, close]);

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      return close();
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus();
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className="icon-button menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {trigger ?? <MoreHorizontal size={16} />}
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={list} className="menu" role="menu" aria-label={label} style={{ top: pos.top, right: pos.right }} onKeyDown={onKey} onClick={(e) => e.stopPropagation()}>
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`menu__item${item.danger ? " menu__item--danger" : ""}`}
                disabled={item.disabled}
                onClick={() => {
                  close(false);
                  item.onSelect();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
