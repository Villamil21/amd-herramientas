import type { ReactNode } from "react";
import { ClipboardCopy } from "lucide-react";
import { Button, useToast } from "../../../components/ui";
import { copyText } from "../../../utils/clipboard";

/**
 * Estructura visual común de Impuestos (IVA de compras, Retención en la fuente
 * compras y ventas): A Encabezado · B Archivo fuente · C Estado y pendientes ·
 * D Resumen · E Documentos · F Resumen para declaración. Cada bloque lleva el
 * mismo encabezado con su letra, aunque el contenido sea propio de cada módulo.
 */
export function TaxSection({ letter, title, actions, children }: { letter: string; title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="tax-section" aria-label={title}>
      <header className="tax-section__head">
        <h3>
          <span className="tax-section__letter">{letter}</span>
          {title}
        </h3>
        {actions && <div className="tax-section__actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** «Copiar tabla»: texto tabulado listo para pegar en Excel o en el formulario. */
export function CopyTableButton({ text, label = "Copiar tabla" }: { text: () => string; label?: string }) {
  const toast = useToast();
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<ClipboardCopy size={14} />}
      onClick={() =>
        void copyText(text()).then(
          () => toast("Tabla copiada: pégala en Excel."),
          (e: Error) => toast(e.message, "error"),
        )
      }
    >
      {label}
    </Button>
  );
}
