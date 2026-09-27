import { MODULES, readySubmodules } from "../app/modules";
import { navigate, paths } from "../app/router";
import { ModuleTile } from "../components/ModuleTile";
import { PageHeader } from "../components/ui";

export function ToolsPage() {
  return (
    <>
      <PageHeader eyebrow="Herramientas" title="Módulos" description="Selecciona el módulo con el que quieres trabajar." />
      <div className="tile-grid">
        {MODULES.map((m) => {
          const ready = readySubmodules(m).length;
          return (
            <ModuleTile
              key={m.id}
              title={m.name}
              description={m.description}
              available={ready > 0}
              meta={m.submodules.length ? `${m.submodules.length} ${m.submodules.length === 1 ? "herramienta" : "herramientas"}` : undefined}
              onOpen={() => navigate(paths.module(m.id))}
            />
          );
        })}
      </div>
    </>
  );
}
