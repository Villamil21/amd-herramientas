import { useState } from "react";
import { Download, RotateCw } from "lucide-react";
import { Button } from "../components/ui";
import { useUpdater } from "./UpdateProvider";

/** Aviso discreto (esquina inferior) cuando hay una versión nueva. */
export function UpdateNotice() {
  const { status, update, progress, error, noticeDismissed, install, restart, dismissNotice } = useUpdater();
  const [showNotes, setShowNotes] = useState(false);

  const visible = update && !noticeDismissed && (status === "available" || status === "downloading" || status === "ready");
  if (!visible) return null;

  return (
    <aside className="update-notice" role="status">
      <h3>{status === "ready" ? "Actualización lista" : "Nueva versión disponible"}</h3>
      <dl>
        <dt>Versión instalada</dt>
        <dd>{update.currentVersion}</dd>
        <dt>Nueva versión</dt>
        <dd>{update.version}</dd>
      </dl>

      {showNotes && update.notes && <div className="update-notice__notes">{update.notes}</div>}
      {status === "downloading" && (
        <div className="progress" aria-label="Progreso de descarga">
          <div className="progress__bar" style={{ width: `${Math.round((progress ?? 0.15) * 100)}%` }} />
        </div>
      )}
      {error && <div style={{ fontSize: 12.5, color: "var(--color-danger-ink)" }}>{error}</div>}
      {status === "ready" && <div style={{ fontSize: 12.5, color: "var(--color-muted)" }}>Reinicia la aplicación para terminar. Tus datos se conservan.</div>}

      <div className="update-notice__actions">
        {update.notes && status !== "ready" && (
          <Button variant="ghost" size="sm" onClick={() => setShowNotes((v) => !v)}>
            {showNotes ? "Ocultar novedades" : "Novedades"}
          </Button>
        )}
        {status === "available" && (
          <>
            <Button variant="ghost" size="sm" onClick={dismissNotice}>
              Más tarde
            </Button>
            <Button variant="primary" size="sm" icon={<Download size={14} />} onClick={() => void install()}>
              Actualizar ahora
            </Button>
          </>
        )}
        {status === "downloading" && (
          <Button variant="primary" size="sm" loading>
            Descargando…
          </Button>
        )}
        {status === "ready" && (
          <Button variant="primary" size="sm" icon={<RotateCw size={14} />} onClick={() => void restart()}>
            Reiniciar ahora
          </Button>
        )}
      </div>
    </aside>
  );
}
