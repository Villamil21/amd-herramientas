import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  children?: ReactNode;
  /** Evita cerrar con Esc o clic afuera mientras se procesa algo. */
  locked?: boolean;
}

export function Modal({ open, title, description, onClose, footer, size = "md", children, locked }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, locked, onClose]);

  if (!open) return null;
  // Portal a <body>: dentro de una tarjeta (backdrop-filter) el fondo «fixed» quedaría limitado
  // a la tarjeta y un modal más alto que ella se cortaría sin poder desplazarse.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !locked && onClose()}>
      <div className={`modal ${size !== "md" ? `modal--${size}` : ""}`} role="dialog" aria-modal="true">
        <div className="modal__header">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-button" onClick={onClose} disabled={locked} aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>
        {children && <div className="modal__body">{children}</div>}
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
