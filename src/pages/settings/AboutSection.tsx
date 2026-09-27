import { CheckCircle2, Download, RefreshCw, RotateCw } from "lucide-react";
import { useUpdater } from "../../app/UpdateProvider";
import { changelogFor } from "../../app/changelog";
import { Alert, Badge, Button, Card } from "../../components/ui";

export function AboutSection({ version }: { version: string }) {
  const { status, update, progress, error, lastChecked, check, install, restart } = useUpdater();
  const notes = changelogFor(version);

  return (
    <Card title="Acerca de" description="Versión instalada y actualizaciones.">
      <div className="stack">
        <dl className="definition-list">
          <dt>Versión instalada</dt>
          <dd>
            <span className="row" style={{ gap: 8 }}>
              <strong style={{ fontFamily: "var(--font-display)" }}>{version}</strong>
              {status === "up-to-date" && <Badge tone="success">Actualizada</Badge>}
            </span>
          </dd>
          <dt>Actualizaciones</dt>
          <dd>
            {status === "checking" && "Buscando actualizaciones…"}
            {(status === "idle" || status === "error") && "La aplicación busca actualizaciones automáticamente al iniciar."}
            {status === "up-to-date" && (
              <span className="row" style={{ gap: 6 }}>
                <CheckCircle2 size={14} color="var(--color-success)" /> Tu aplicación está actualizada.
              </span>
            )}
            {(status === "available" || status === "downloading") && update && <>Nueva versión disponible: <strong>{update.version}</strong></>}
            {status === "ready" && "La actualización está instalada. Reinicia para usar la nueva versión."}
            {lastChecked && (
              <div className="field__hint">Última comprobación: {lastChecked.toLocaleTimeString("es-CO", { timeStyle: "short" })}</div>
            )}
          </dd>
        </dl>

        {status === "downloading" && (
          <div className="progress">
            <div className="progress__bar" style={{ width: `${Math.round((progress ?? 0.15) * 100)}%` }} />
          </div>
        )}
        {error && <Alert tone="warning">{error}</Alert>}
        {update?.notes && (status === "available" || status === "downloading") && (
          <Alert tone="info" title={`Novedades de la versión ${update.version}`}>
            <span style={{ whiteSpace: "pre-wrap" }}>{update.notes}</span>
          </Alert>
        )}

        <div className="row">
          {status === "available" && (
            <Button variant="primary" icon={<Download size={15} />} onClick={() => void install()}>
              Actualizar ahora
            </Button>
          )}
          {status === "ready" && (
            <Button variant="primary" icon={<RotateCw size={15} />} onClick={() => void restart()}>
              Reiniciar ahora
            </Button>
          )}
          {status !== "downloading" && status !== "ready" && (
            <Button icon={<RefreshCw size={15} />} onClick={() => void check()} loading={status === "checking"}>
              Buscar actualizaciones
            </Button>
          )}
        </div>

        {notes && (
          <div>
            <div className="field__label" style={{ marginBottom: 6 }}>
              Novedades de la versión {version}
            </div>
            <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {notes.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
