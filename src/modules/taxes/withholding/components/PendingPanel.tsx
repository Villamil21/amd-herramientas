import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Info, ListChecks, XCircle } from "lucide-react";
import { Button, Input, useToast } from "../../../../components/ui";
import { withholdingService } from "../../../../services/withholdingService";
import type { TitleCategory } from "../../../../types/models";
import { fiscalCodes } from "../services/fiscal";
import { actionable, groupLabel, groupSummary, lotStatus, PENDING_CATEGORIES, type PendingAction, type PendingSeverity } from "../services/pending";

export const PENDING_ANCHOR = "withholding-pending";
export const pendingItemId = (id: string) => `pending-${id}`;

const SEVERITY_ICON = { blocking: XCircle, warning: AlertTriangle, info: Info };
const SEVERITY_LABEL: Record<PendingSeverity, string> = { blocking: "Bloqueante", warning: "Advertencia", info: "Información" };

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
        {s.warnings > 0 && <span className="lot-status__note">· {s.warnings === 1 ? "1 advertencia" : `${s.warnings} advertencias`}</span>}
      </div>
    );
  }
  return (
    <div className="lot-status lot-status--attention" role="status">
      <span className="lot-status__dot" aria-hidden /> Requiere atención — {s.pending === 1 ? "1 pendiente" : `${s.pending} pendientes`}
    </div>
  );
}

/** Régimen escrito a mano cuando ni el proveedor ni la factura lo traen (ej. R-99-PN, O-13;O-23). */
function RegimeInput({ busy, loading, onSave }: { busy: boolean; loading: boolean; onSave: (regime: string) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState(false);
  const save = () => {
    const codes = fiscalCodes(text);
    if (codes.length === 0) return setError(true);
    setError(false);
    onSave(codes.join(";"));
  };
  return (
    <span className="row" style={{ flexWrap: "nowrap" }}>
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(false);
        }}
        onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder="R-99-PN, O-13, O-15…"
        aria-label="Régimen / responsabilidad fiscal"
        invalid={error}
        title={error ? "Escribe al menos un código (ej. R-99-PN, O-13, O-15, O-47)." : undefined}
        style={{ width: 190 }}
      />
      <Button size="sm" variant="primary" loading={loading} disabled={busy} onClick={save}>
        Guardar
      </Button>
    </span>
  );
}

interface Props {
  actions: PendingAction[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Pendiente resaltado (al llegar desde «Resolver pendientes» o una fila). */
  focusId: string | null;
  onResolveAll: () => void;
  /** Pendientes que se resuelven en un modal o en otra parte de la página (proveedor, documento, periodo). */
  onAction: (a: PendingAction) => void;
  supplierIdFor: (nit: string) => number | undefined;
  onFiscalDismiss: (nit: string, detected: string) => void;
  onConflictResolved: (nit: string) => void;
  /** Se guardó algo (título, régimen): recargar datos y recalcular. */
  onChanged: () => Promise<void> | void;
}

/**
 * «Pendientes por resolver»: resumen agrupado (una frase por tipo de
 * problema), acción para recorrerlos y detalle por categoría con la acción
 * de cada uno. Los títulos y el régimen fiscal se resuelven aquí mismo.
 */
export function PendingPanel({ actions, expanded, onExpandedChange, focusId, onResolveAll, onAction, supplierIdFor, onFiscalDismiss, onConflictResolved, onChanged }: Props) {
  const toast = useToast();
  const [saving, setSaving] = useState<string | null>(null);
  if (actions.length === 0) return null;

  const pending = actionable(actions);
  const status = lotStatus(actions);
  const tone = status.kind === "attention" ? "blocking" : pending.length ? "warning" : "info";
  const HeadIcon = SEVERITY_ICON[tone];

  async function run(key: string, work: () => Promise<unknown>, message: string): Promise<boolean> {
    setSaving(key);
    try {
      await work();
      toast(message);
      await onChanged();
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setSaving(null);
    }
  }

  const classify = (a: PendingAction, category: TitleCategory) => {
    if (a.target.kind !== "title") return;
    const t = a.target.title;
    void run(a.id, () => withholdingService.saveTitles([{ normalizedTitle: t.normalizedTitle, displayTitle: t.displayTitle, category }]), `«${t.displayTitle}» se clasificó como ${category === "invoice" ? "Factura" : "Nota"}.`);
  };

  function inlineActions(a: PendingAction) {
    const busy = saving !== null;
    switch (a.target.kind) {
      case "title":
        return (
          <>
            <Button size="sm" variant="primary" onClick={() => classify(a, "invoice")} loading={saving === a.id} disabled={busy}>
              Factura
            </Button>
            <Button size="sm" onClick={() => classify(a, "credit_note")} disabled={busy}>
              Nota
            </Button>
          </>
        );
      case "fiscal-change": {
        const c = a.target.change;
        return (
          <>
            <Button size="sm" variant="primary" loading={saving === a.id} disabled={busy} onClick={() => void run(a.id, () => withholdingService.setFiscalRegime(c.supplierId, c.detected), "Proveedor actualizado.")}>
              Actualizar proveedor
            </Button>
            <Button size="sm" disabled={busy} onClick={() => onFiscalDismiss(c.nit, c.detected)}>
              Mantener guardado
            </Button>
          </>
        );
      }
      case "fiscal-conflict": {
        const c = a.target.conflict;
        const id = supplierIdFor(c.nit);
        return c.variants.map((v) => (
          <Button
            key={v.regime}
            size="sm"
            disabled={busy}
            loading={saving === `${a.id}|${v.regime}`}
            title={`Presente en: ${v.files.join(", ")}`}
            onClick={() =>
              id
                ? void run(`${a.id}|${v.regime}`, () => withholdingService.setFiscalRegime(id, v.regime), `Régimen ${v.regime} confirmado.`).then((ok) => ok && onConflictResolved(c.nit))
                : onConflictResolved(c.nit)
            }
          >
            Confirmar {v.regime}
          </Button>
        ));
      }
      case "fiscal-missing": {
        const m = a.target.item;
        return (
          <Button size="sm" variant="primary" loading={saving === a.id} disabled={busy} onClick={() => void run(a.id, () => withholdingService.setFiscalRegime(m.supplierId, m.detected), "Régimen fiscal asignado al proveedor.")}>
            Asignar {m.detected}
          </Button>
        );
      }
      case "fiscal-unknown": {
        const u = a.target.item;
        return <RegimeInput busy={busy} loading={saving === a.id} onSave={(regime) => void run(a.id, () => withholdingService.setFiscalRegime(u.supplierId, regime), `Régimen ${regime} asignado al proveedor.`)} />;
      }
      default:
        return (
          <Button size="sm" variant={a.severity === "blocking" ? "primary" : "secondary"} onClick={() => onAction(a)}>
            {a.actionLabel}
          </Button>
        );
    }
  }

  const missingAll = actions.flatMap((a) => (a.target.kind === "fiscal-missing" ? [a.target.item] : []));
  const summary = groupSummary(actions);

  return (
    <section id={PENDING_ANCHOR} className={`card pending-panel pending-panel--${tone}`} aria-label="Pendientes por resolver">
      <header className="pending-panel__header">
        <HeadIcon size={20} className="pending-panel__icon" aria-hidden />
        <div className="pending-panel__heading">
          <h2>
            {pending.length ? "Pendientes por resolver" : "Información para revisar"}
            {pending.length > 0 && <span className="pending-panel__count">{pending.length}</span>}
          </h2>
          <p>
            {status.kind === "attention"
              ? "Resuelve estos puntos para incluir todos los documentos en el resumen de retención. «Exportar Excel» se habilita cuando no quedan pendientes bloqueantes."
              : pending.length
                ? "No afectan el cálculo, pero conviene confirmarlos."
                : "No afecta el cálculo."}
          </p>
        </div>
        <div className="row">
          <Button size="sm" variant="ghost" icon={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} onClick={() => onExpandedChange(!expanded)}>
            {expanded ? "Ocultar detalles" : "Ver detalles"}
          </Button>
          {pending.length > 0 && (
            <Button variant="primary" icon={<ListChecks size={15} />} onClick={onResolveAll}>
              Resolver pendientes
            </Button>
          )}
        </div>
      </header>

      <ul className="pending-summary">
        {summary.map((g) => {
          const Icon = SEVERITY_ICON[g.severity];
          return (
            <li key={g.group}>
              <button
                type="button"
                className={`pending-summary__item pending-summary__item--${g.severity}`}
                onClick={() => {
                  onExpandedChange(true);
                  requestAnimationFrame(() => document.getElementById(pendingItemId(g.firstId))?.scrollIntoView({ behavior: "smooth", block: "center" }));
                }}
              >
                <Icon size={14} aria-hidden />
                {groupLabel(g.group, g.count)}
              </button>
            </li>
          );
        })}
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
                  {cat.id === "fiscal" && missingAll.length > 1 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={saving === "missing-all"}
                      disabled={saving !== null}
                      onClick={() =>
                        void run(
                          "missing-all",
                          async () => {
                            for (const m of missingAll) await withholdingService.setFiscalRegime(m.supplierId, m.detected);
                          },
                          "Régimen fiscal guardado en los proveedores.",
                        )
                      }
                    >
                      Asignar todos los detectados
                    </Button>
                  )}
                </div>
                <ul className="pending-list">
                  {list.map((a) => {
                    const Icon = SEVERITY_ICON[a.severity];
                    return (
                      <li key={a.id} id={pendingItemId(a.id)} className={["pending-item", `pending-item--${a.severity}`, focusId === a.id && "is-focused"].filter(Boolean).join(" ")}>
                        <Icon size={15} className="pending-item__icon" aria-label={SEVERITY_LABEL[a.severity]} />
                        <div className="pending-item__text">
                          <strong className="selectable">{a.title}</strong>
                          <span>{a.detail}</span>
                        </div>
                        <div className="pending-item__actions">{inlineActions(a)}</div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
