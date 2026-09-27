import { Building2, FileCheck2, Percent } from "lucide-react";
import { MODULES, readySubmodules } from "../app/modules";
import { navigate, paths } from "../app/router";
import { ModuleTile } from "../components/ModuleTile";
import { Button } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { companyService } from "../services/companyService";
import { conceptService } from "../services/conceptService";

export function HomePage() {
  const counts = useAsync(async () => {
    const [companies, concepts] = await Promise.all([companyService.list(), conceptService.list()]);
    return { companies: companies.length, concepts: concepts.length };
  }, []);

  return (
    <>
      <section className="hero">
        <div>
          <h1>
            AMD <span>Herramientas</span>
          </h1>
          <p>Centro de herramientas administrativas y contables. Elige un módulo para comenzar.</p>
        </div>
        <Button variant="primary" icon={<FileCheck2 size={15} />} onClick={() => navigate(paths.submodule("certificados", "retencion"))}>
          Nuevo certificado de retención
        </Button>
      </section>

      <div className="stat-row">
        <button className="card stat stat--link" onClick={() => navigate(paths.companies)}>
          <div className="tile__icon">
            <Building2 size={18} />
          </div>
          <div>
            <div className="stat__value">{counts.data?.companies ?? "—"}</div>
            <div className="stat__label">Empresas registradas</div>
          </div>
        </button>
        <button className="card stat stat--link" onClick={() => navigate(paths.concepts)}>
          <div className="tile__icon">
            <Percent size={18} />
          </div>
          <div>
            <div className="stat__value">{counts.data?.concepts ?? "—"}</div>
            <div className="stat__label">Conceptos de retención</div>
          </div>
        </button>
      </div>

      <div className="row row--between">
        <h2 style={{ fontSize: 16 }}>Herramientas</h2>
        <Button variant="ghost" size="sm" onClick={() => navigate(paths.tools)}>
          Ver todas
        </Button>
      </div>
      <div className="tile-grid">
        {MODULES.map((m) => {
          const ready = readySubmodules(m).length;
          return (
            <ModuleTile
              key={m.id}
              icon={m.icon}
              title={m.name}
              description={m.description}
              available={ready > 0}
              meta={ready > 0 ? `${ready} de ${m.submodules.length} disponibles` : undefined}
              onOpen={() => navigate(paths.module(m.id))}
            />
          );
        })}
      </div>
    </>
  );
}
