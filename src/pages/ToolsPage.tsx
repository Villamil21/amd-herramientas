import { useState } from "react";
import { ArrowRight, Clock, FileSpreadsheet, FileText, FileType, FolderOpen } from "lucide-react";
import { MODULES } from "../app/modules";
import { navigate, paths } from "../app/router";
import { ModuleCard } from "../components/ModuleCard";
import { ActivityStatus } from "../components/ui/ActivityStatus";
import { Button, useToast } from "../components/ui";
import { activityService } from "../services/activityService";
import { fileService } from "../services/fileService";

const PREVIEW_ROWS = 5;

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const pad = (n: number) => String(n).padStart(2, "0");

/** «28 sept 2026 21:21» */
function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return <FileText size={18} className="file-icon file-icon--pdf" aria-hidden />;
  if (ext === "xlsx" || ext === "xls") return <FileSpreadsheet size={18} className="file-icon file-icon--xlsx" aria-hidden />;
  return <FileType size={18} className="file-icon" aria-hidden />;
}

export function ToolsPage() {
  const toast = useToast();
  // Solo módulos con herramientas; los que aún no tienen ninguna no se muestran.
  const modules = MODULES.filter((m) => m.submodules.length > 0);
  const [activity] = useState(() => activityService.list());
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? activity : activity.slice(0, PREVIEW_ROWS);

  return (
    <>
      <header className="tools-hero">
        <h1>Herramientas</h1>
        <p>Elige una tarea para comenzar</p>
      </header>

      <div className="module-grid">
        {modules.map((m) => (
          <ModuleCard key={m.id} title={m.name} description={m.description} icon={m.icon} accent={m.accent} onOpen={() => navigate(paths.module(m.id))} />
        ))}
      </div>

      <section className="card activity" aria-labelledby="recent-activity">
        <header className="activity__header">
          <h2 id="recent-activity">
            <Clock size={20} aria-hidden /> Actividad reciente
          </h2>
          {activity.length > PREVIEW_ROWS && (
            <button className="pill-link" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Ver menos" : "Ver todo"} <ArrowRight size={14} aria-hidden />
            </button>
          )}
        </header>
        {activity.length === 0 ? (
          <p className="activity__empty">Aún no hay actividad. Aquí aparecerán los archivos que analices y los Excel o PDF que generes.</p>
        ) : (
          <div className="table-wrap">
            <table className="table activity-table">
              <thead>
                <tr>
                  <th scope="col">Archivo</th>
                  <th scope="col">Herramienta</th>
                  <th scope="col">Empresa</th>
                  <th scope="col">Fecha</th>
                  <th scope="col">Estado</th>
                  <th scope="col">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span className="activity-table__file" title={a.fileName}>
                        <FileIcon name={a.fileName} />
                        <span>{a.fileName}</span>
                      </span>
                    </td>
                    <td>
                      <div>{a.tool}</div>
                      {a.tool !== a.module && <div className="table__secondary">{a.module}</div>}
                    </td>
                    <td className={a.company ? undefined : "muted"}>{a.company ?? "—"}</td>
                    <td className="activity-table__date">{formatWhen(a.at)}</td>
                    <td>
                      <ActivityStatus status={a.status} />
                    </td>
                    <td className="actions">
                      {a.path && (
                        <Button
                          variant="ghost"
                          iconOnly
                          icon={<FolderOpen size={16} />}
                          aria-label={`Mostrar ${a.fileName} en Finder`}
                          title="Mostrar en Finder"
                          onClick={() => void fileService.revealSaved(a.path!).catch(() => toast("No se encontró el archivo. Puede haberse movido o eliminado.", "error"))}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
