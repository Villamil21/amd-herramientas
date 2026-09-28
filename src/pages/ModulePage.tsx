import { Clock } from "lucide-react";
import { navigate, paths } from "../app/router";
import { BankCard } from "../components/BankCard";
import { ModuleTile } from "../components/ModuleTile";
import { Button, Card, EmptyState, PageHeader } from "../components/ui";
import type { ModuleDef } from "../types/modules";

export function ModulePage({ module }: { module: ModuleDef }) {
  return (
    <>
      <PageHeader eyebrow="Herramientas" title={module.name} description={module.description} />
      {module.submodules.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Clock size={20} />}
            title="Próximamente"
            description="Este módulo está en preparación y estará disponible en una próxima versión."
            action={<Button onClick={() => navigate(paths.tools)}>Volver a herramientas</Button>}
          />
        </Card>
      ) : (
        <div className="tile-grid">
          {module.submodules.map((s) =>
            module.submoduleCards === "logo" ? (
              <BankCard
                key={s.id}
                name={s.name}
                logo={s.logo}
                description={s.description}
                available={Boolean(s.component)}
                onOpen={() => navigate(paths.submodule(module.id, s.id))}
              />
            ) : (
              <ModuleTile
                key={s.id}
                title={s.name}
                description={s.description}
                available={Boolean(s.component)}
                onOpen={() => navigate(paths.submodule(module.id, s.id))}
              />
            ),
          )}
        </div>
      )}
    </>
  );
}
