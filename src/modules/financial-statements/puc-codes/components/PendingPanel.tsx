import { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, FileSpreadsheet, XCircle } from "lucide-react";
import { Button, useToast } from "../../../../components/ui";
import { pucService } from "../../../../services/pucService";
import { groupLabel, groupSummary, PENDING_CATEGORIES, type PendingAction } from "../services/pending";
import { DOC_CATEGORY_LABEL, type DocCategory, type UnknownTitle } from "../types";

export const pendingItemId = (id: string) => `puc-pending-${id}`;

/** ● Listo para exportar / ● Análisis incompleto — N pendientes / ● Procesando. */
export function LotStatusIndicator({ pending, processing }: { pending?: number; processing?: boolean }) {
  if (processing || pending === undefined) {
    return (
      <div className="lot-status lot-status--processing" role="status">
        <span className="lot-status__dot" aria-hidden /> Procesando
      </div>
    );
  }
  if (pending === 0) {
    return (
      <div className="lot-status lot-status--ready" role="status">
        <span className="lot-status__dot" aria-hidden /> Todo clasificado — 0 pendientes
      </div>
    );
  }
  return (
    <div className="lot-status lot-status--attention" role="status">
      <span className="lot-status__dot" aria-hidden /> Análisis incompleto — {pending === 1 ? "1 pendiente" : `${pending} pendientes`}
    </div>
  );
}

/** «¿Dónde deseas clasificarlo?»: guarda la decisión para este y los próximos análisis. */
export function TitleClassifyButtons({ title, onSaved }: { title: UnknownTitle; onSaved: () => Promise<void> | void }) {
  const toast = useToast();
  const [saving, setSaving] = useState<DocCategory | null>(null);

  async function classify(category: DocCategory) {
    setSaving(category);
    try {
      await pucService.saveTitles([{ normalizedTitle: title.normalizedTitle, displayTitle: title.displayTitle, category }]);
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
        <Button key={c} size="sm" variant={c === "invoice" ? "primary" : "secondary"} loading={saving === c} disabled={saving !== null} onClick={() => void classify(c)}>
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
  /** Pendiente resaltado (al llegar desde «Siguiente pendiente» o una fila). */
  focusId: string | null;
  onNext: () => void;
  onOpenDocument: (fileName: string) => void;
  /** Quita del análisis un archivo que no se pudo leer. */
  onExclude: (fileName: string) => void;
  /** Se guardó la clasificación de un título: recargar y recalcular. */
  onChanged: () => Promise<void> | void;
  /** Motivo por el que no se puede exportar (null: se puede). */
  exportBlock: string | null;
  exporting: boolean;
  onExport: () => void;
}

/**
 * Estado del análisis, siempre arriba y a la vista. Con pendientes: cuántos
 * quedan, qué falta y en qué factura, y el acceso al siguiente. Sin
 * pendientes: «Todo clasificado» y la exportación habilitada.
 */
export function PendingPanel({ actions, expanded, onExpandedChange, focusId, onNext, onOpenDocument, onExclude, onChanged, exportBlock, exporting, onExport }: Props) {
  if (actions.length === 0) {
    return (
      <section className="card pending-panel pending-panel--ready" aria-label="Estado del análisis">
        <header className="pending-panel__header">
          <CheckCircle2 size={20} className="pending-panel__icon" aria-hidden />
          <div className="pending-panel__heading">
            <h2>
              Todo clasificado
              <span className="pending-panel__count">0</span>
            </h2>
            <p>0 pendientes. {exportBlock ?? "Listo para exportar."}</p>
          </div>
          <Button variant="primary" icon={<FileSpreadsheet size={15} />} onClick={onExport} loading={exporting} disabled={exportBlock !== null}>
            Exportar Excel
          </Button>
        </header>
      </section>
    );
  }

  const summary = groupSummary(actions);
  return (
    <section className="card pending-panel pending-panel--blocking" aria-label="Pendientes por resolver">
      <header className="pending-panel__header">
        <AlertTriangle size={20} className="pending-panel__icon" aria-hidden />
        <div className="pending-panel__heading">
          <h2>
            Análisis incompleto · Pendientes por resolver
            <span className="pending-panel__count">{actions.length}</span>
          </h2>
          <p>
            {exportBlock} Debes completar todos los códigos PUC y clasificaciones antes de exportar: «Exportar Excel» está deshabilitado hasta entonces. El resumen se recalcula al resolver cada
            uno, sin volver a importar la carpeta.
          </p>
        </div>
        <div className="row">
          <Button size="sm" variant="ghost" icon={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} onClick={() => onExpandedChange(!expanded)}>
            {expanded ? "Ocultar detalles" : "Ver pendientes"}
          </Button>
          <Button variant="primary" icon={<ArrowRight size={15} />} onClick={onNext}>
            Revisar siguiente pendiente
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
                      <XCircle size={15} className="pending-item__icon" aria-label="Bloquea la exportación" />
                      <div className="pending-item__text">
                        <strong className="selectable">
                          {a.what} · {a.where}
                        </strong>
                        <span>{a.detail}</span>
                      </div>
                      <div className="pending-item__actions">
                        {a.target.kind === "title" ? (
                          <TitleClassifyButtons title={a.target.title} onSaved={onChanged} />
                        ) : (
                          <>
                            <Button size="sm" variant="primary" onClick={() => onOpenDocument(a.fileNames[0])}>
                              {a.actionLabel}
                            </Button>
                            {a.group === "failed" && (
                              <Button size="sm" onClick={() => onExclude(a.fileNames[0])} title="El archivo no se suma y deja de bloquear la exportación.">
                                Excluir documento
                              </Button>
                            )}
                          </>
                        )}
                      </div>
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
