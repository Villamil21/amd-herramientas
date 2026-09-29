import { useState } from "react";
import { Clock, Search } from "lucide-react";
import { isAvailable } from "../app/modules";
import { navigate, paths } from "../app/router";
import { BankCard } from "../components/BankCard";
import { ModuleTile } from "../components/ModuleTile";
import { Button, Card, EmptyState, Input, PageHeader } from "../components/ui";
import type { ModuleDef } from "../types/modules";
import { normalizeKey } from "../utils/text";

export function ModulePage({ module }: { module: ModuleDef }) {
  const [query, setQuery] = useState("");
  const logoCards = module.submoduleCards === "logo";
  // Filtra la misma colección del módulo (ya ordenada): sin listas paralelas.
  const q = normalizeKey(query);
  const visible = logoCards && q ? module.submodules.filter((s) => normalizeKey(s.name).includes(q)) : module.submodules;

  return (
    <>
      <PageHeader
        eyebrow="Herramientas"
        title={module.name}
        description={module.description}
        actions={
          logoCards && module.submodules.length > 0 ? (
            <div className="search">
              <Search size={14} aria-hidden />
              <Input type="search" placeholder="Buscar banco…" aria-label="Buscar banco" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          ) : undefined
        }
      />
      {module.submodules.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Clock size={20} />}
            title="Próximamente"
            description="Este módulo está en preparación y estará disponible en una próxima versión."
            action={<Button onClick={() => navigate(paths.tools)}>Volver a herramientas</Button>}
          />
        </Card>
      ) : logoCards ? (
        visible.length === 0 ? (
          <p className="muted">No se encontraron bancos.</p>
        ) : (
          <div className="bank-grid">
            {visible.map((s) => (
              <BankCard key={s.id} name={s.name} logo={s.logo} available={isAvailable(s)} onOpen={() => navigate(paths.submodule(module.id, s.id))} />
            ))}
          </div>
        )
      ) : (
        <div className="tile-grid">
          {module.submodules.map((s) => (
            <ModuleTile
              key={s.id}
              title={s.name}
              description={s.description}
              available={isAvailable(s)}
              onOpen={() => navigate(paths.submodule(module.id, s.id))}
            />
          ))}
        </div>
      )}
    </>
  );
}
