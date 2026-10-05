import { useState } from "react";
import { ChevronDown, ChevronUp, ListChecks, XCircle } from "lucide-react";
import { Button, useToast } from "../../../../components/ui";
import { vatTitleService } from "../../../../services/vatTitleService";
import { DOC_CATEGORY_LABEL, type DocCategory, type UnknownTitle } from "../types";
import { groupLabel, groupSummary, lotStatus, PENDING_CATEGORIES, type PendingAction } from "../services/pending";
import { SupplierVatControl } from "./SupplierVatControl";

export const pendingItemId = (id: string) => `vat-pending-${id}`;

/** ● Listo para declaración / ● Requiere atención — N pendientes / ● Procesando. */
export function LotStatusIndicator({ actions, processing }: { actions?: PendingAction[]; processing?: boolean }) {
  if (processing || !actions) {
    return (
      <div className="lot-status lot-status--processing" role="status">
        <span className="lot-status__dot" aria-hidden /> Procesando
      </div>
    );
  }
  const s = lotStatus(actions);
  if (s.kind === "ready") {
    return (
      <div className="lot-status lot-status--ready" role="status">
        <span className="lot-status__dot" aria-hidden /> Listo para declaración
      </div>
    );
  }
  return (
    <div className="lot-status lot-status--attention" role="status">
      <span className="lot-status__dot" aria-hidden /> Requiere atención — {s.pending === 1 ? "1 pendiente" : `${s.pending} pendientes`}
    </div>
  );
}

/** «¿Dónde deseas clasificarlo?»: guarda la decisión para este y los próximos análisis. */
export function TitleClassifyButtons({ title, disabled, onSaved }: { title: UnknownTitle; disabled?: boolean; onSaved: () => Promise<void> | void }) {
  const toast = useToast();
  const [saving, setSaving] = useState<DocCategory | null>(null);

  async function classify(category: DocCategory) {
    setSaving(category);
    try {
      await vatTitleService.save([{ normalizedTitle: title.normalizedTitle, displayTitle: title.displayTitle, category }]);
      toast(`«${title.displayTitle}» se clasificó como ${DOC_CATEGORY_LABEL[category]}.`);
      await onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      {(Object.keys(DOC_CATEGORY_LABEL) as DocCategory[]).map((c) => (
        <Button key={c} size="sm" variant={c === "invoice" ? "primary" : "secondary"} loading={saving === c} disabled={disabled || saving !== null} onClick={() => void classify(c)}>
          {DOC_CATEGORY_LABEL[c]}
        </Button>
      ))}
    </>
  );
}

interface Props {
  actions: PendingAction[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Pendiente resaltado (al llegar desde «Resolver pendientes» o una fila). */
  focusId: string | null;
  onResolveAll: () => void;
  /** Abre el documento para resolverlo en su detalle. */
  onOpenDocument: (fileName: string) => void;
  /** Quita un documento del resumen (archivo que no se pudo leer). */
  onExclude: (fileName: string) => void;
  /** Se guardó un proveedor o un tipo de documento: recargar datos y recalcular. */
  onChanged: () => Promise<void> | void;
}

/**
 * «Pendientes por resolver»: contador, una frase por tipo de problema, acción
 * para recorrerlos y detalle por categoría con la acción de cada uno. El Tipo
 * IVA del proveedor y el tipo de documento se resuelven aquí mismo.
 */
export function PendingPanel({ actions, expanded, onExpandedChange, focusId, onResolveAll, onOpenDocument, onExclude, onChanged }: Props) {
  if (actions.length === 0) return null;
  const summary = groupSummary(actions);

  function inlineActions(a: PendingAction) {
    switch (a.target.kind) {
      case "supplier":
        return <SupplierVatControl nit={a.target.supplier.nit} name={a.target.supplier.name} onSaved={onChanged} />;
      case "title":
        return <TitleClassifyButtons title={a.target.title} onSaved={onChanged} />;
      default: {
        const { fileName } = a.target;
        return (
          <>
            <Button size="sm" variant="primary" onClick={() => onOpenDocument(fileName)}>
              {a.actionLabel}
            </Button>
            {a.group === "failed" && (
              <Button size="sm" onClick={() => onExclude(fileName)} title="El archivo no se suma y deja de bloquear la declaración.">
                Excluir documento
              </Button>
            )}
          </>
        );
      }
    }
  }

  return (
    <section className="card pending-panel pending-panel--blocking" aria-label="Pendientes por resolver">
      <header className="pending-panel__header">
        <XCircle size={20} className="pending-panel__icon" aria-hidden />
        <div className="pending-panel__heading">
          <h2>
            Pendientes por resolver
            <span className="pending-panel__count">{actions.length}</span>
          </h2>
          <p>Resuelve estos puntos para dejar el lote listo para la declaración. El resumen se recalcula al resolver cada uno, sin volver a importar la carpeta.</p>
        </div>
        <div className="row">
          <Button size="sm" variant="ghost" icon={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} onClick={() => onExpandedChange(!expanded)}>
            {expanded ? "Ocultar detalles" : "Ver pendientes"}
          </Button>
          <Button variant="primary" icon={<ListChecks size={15} />} onClick={onResolveAll}>
            Resolver pendientes
          </Button>
        </div>
      </header>

      <ul className="pending-summary">
        {summary.map((g) => (
          <li key={g.group}>
            <button
              type="button"
              className="pending-summary__item pending-summary__item--blocking"
              onClick={() => {
                onExpandedChange(true);
                requestAnimationFrame(() => document.getElementById(pendingItemId(g.firstId))?.scrollIntoView({ behavior: "smooth", block: "center" }));
              }}
            >
              <XCircle size={14} aria-hidden />
              {groupLabel(g.group, g.count)}
            </button>
          </li>
        ))}
      </ul>

      {expanded && (
        <div className="pending-panel__details">
          {PENDING_CATEGORIES.map((cat) => {
            const list = actions.filter((a) => a.category === cat.id);
            if (list.length === 0) return null;
            return (
              <div key={cat.id} className="pending-category">
                <div className="pending-category__title">
                  {cat.label} <span className="muted">({list.length})</span>
                </div>
                <ul className="pending-list">
                  {list.map((a) => (
                    <li key={a.id} id={pendingItemId(a.id)} className={["pending-item", "pending-item--blocking", focusId === a.id && "is-focused"].filter(Boolean).join(" ")}>
                      <XCircle size={15} className="pending-item__icon" aria-label="Bloquea la declaración" />
                      <div className="pending-item__text">
                        <strong className="selectable">{a.title}</strong>
                        <span>{a.detail}</span>
                      </div>
                      <div className="pending-item__actions">{inlineActions(a)}</div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
