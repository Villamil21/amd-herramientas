import { isAvailable } from "../app/modules";
import { navigate, paths } from "../app/router";
import { BankCard } from "../components/BankCard";
import { PageHeader } from "../components/ui";
import type { ModuleDef, SubmoduleDef } from "../types/modules";

/** Selección de proveedor dentro de un submódulo (ej. Resumen de planilla → Aportes en Línea). */
export function ProviderSelectPage({ module, submodule }: { module: ModuleDef; submodule: SubmoduleDef }) {
  return (
    <>
      <PageHeader eyebrow={module.name} title={submodule.name} description={submodule.providersDescription ?? "Selecciona el proveedor de la planilla."} />
      <div className="tile-grid">
        {(submodule.providers ?? []).map((p) => (
          <BankCard
            key={p.id}
            name={p.name}
            logo={p.logo}
            description={p.description}
            available={isAvailable(p)}
            onOpen={() => navigate(paths.provider(module.id, submodule.id, p.id))}
          />
        ))}
      </div>
    </>
  );
}
