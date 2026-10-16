import { CheckCircle2, Download, RefreshCw, RotateCw } from "lucide-react";
import { useUpdater } from "../../app/UpdateProvider";
import { changelogFor } from "../../app/changelog";
import { Alert, Button, Card } from "../../components/ui";
import { formatDateTimeForDisplay } from "../../utils/dates";

/** Primera sección de Configuración: versión instalada, estado y búsqueda de actualizaciones. */
export function AboutSection({ version }: { version: string }) {
  const { status, update, progress, error, lastChecked, check, install, restart } = useUpdater();
  const notes = changelogFor(version);
  const hasUpdate = (status === "available" || status === "downloading") && !!update;

  const state = hasUpdate ? "available" : status === "up-to-date" ? "ok" : status === "ready" ? "ready" : status === "checking" ? "checking" : "unknown";
  const stateLabel = { available: "Actualización disponible", ok: "Actualizada", ready: "Lista para reiniciar", checking: "Buscando…", unknown: "Sin comprobar en esta sesión" }[state];

  return (
    <Card className="update-card">
      <div className="update-hero">
        <div className="update-hero__info">
          <span className="update-hero__eyebrow">Actualizaciones</span>
          <div className="update-hero__version">
            Versión <strong>{version}</strong>
            <span className={`update-state update-state--${state}`}>
              {state === "ok" && <CheckCircle2 size={14} />}
              {stateLabel}
            </span>
          </div>
          <span className="update-hero__meta">
            Última comprobación: {lastChecked ? formatDateTimeForDisplay(lastChecked) : "—"} · La aplicación también busca actualizaciones al iniciar.
          </span>
        </div>
        <div className="update-hero__actions">
          {status === "available" && (
            <Button variant="primary" className="btn--lg" icon={<Download size={17} />} onClick={() => void install()}>
              Actualizar a {update?.version}
            </Button>
          )}
          {status === "ready" && (
            <Button variant="primary" className="btn--lg" icon={<RotateCw size={17} />} onClick={() => void restart()}>
              Reiniciar ahora
            </Button>
          )}
          {status !== "downloading" && status !== "ready" && (
            <Button variant={status === "available" ? "secondary" : "primary"} className="btn--lg" icon={<RefreshCw size={17} />} onClick={() => void check()} loading={status === "checking"}>
              Buscar actualizaciones
            </Button>
          )}
        </div>
      </div>

      {status === "downloading" && (
        <div className="progress">
          <div className="progress__bar" style={{ width: `${Math.round((progress ?? 0.15) * 100)}%` }} />
        </div>
      )}
      {error && <Alert tone="warning">{error}</Alert>}
      {update?.notes && hasUpdate && (
        <Alert tone="info" title={`Novedades de la versión ${update.version}`}>
          <span style={{ whiteSpace: "pre-wrap" }}>{update.notes}</span>
        </Alert>
      )}

      {notes && (
        <details className="update-notes">
          <summary>Novedades de la versión instalada ({version})</summary>
          <ul>
            {notes.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
