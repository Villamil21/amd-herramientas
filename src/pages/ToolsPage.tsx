import { MODULES } from "../app/modules";
import { navigate, paths } from "../app/router";
import { ModuleCard } from "../components/ModuleCard";

export function ToolsPage() {
  // Solo módulos con herramientas; los que aún no tienen ninguna no se muestran.
  const modules = MODULES.filter((m) => m.submodules.length > 0);

  return (
    <>
      <header className="tools-hero">
        <h1>Herramientas</h1>
      </header>
      <div className="module-grid">
        {modules.map((m) => (
          <ModuleCard key={m.id} title={m.name} description={m.description} icon={m.icon} accent={m.accent} onOpen={() => navigate(paths.module(m.id))} />
        ))}
      </div>
    </>
  );
}
