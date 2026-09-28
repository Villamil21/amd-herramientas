import { Suspense, useEffect, useState } from "react";
import { DatabaseZap } from "lucide-react";
import { AppLayout } from "../layouts/AppLayout";
import { Button, Card, EmptyState, Loader, type Crumb } from "../components/ui";
import { appService } from "../services/appService";
import type { StartupInfo } from "../types/models";
import { useShortcut } from "../hooks/useShortcut";
import { findModule } from "./modules";
import { navigate, paths, useRoute } from "./router";
import { UpdateNotice } from "./UpdateNotice";
import { WhatsNewModal } from "./WhatsNewModal";
import { HomePage } from "../pages/HomePage";
import { ToolsPage } from "../pages/ToolsPage";
import { ModulePage } from "../pages/ModulePage";
import { ProviderSelectPage } from "../pages/ProviderSelectPage";
import { ComingSoonPage } from "../pages/ComingSoonPage";
import { CompaniesPage } from "../pages/CompaniesPage";
import { ConceptsPage } from "../pages/ConceptsPage";
import { SettingsPage } from "../pages/SettingsPage";
import { NotFoundPage } from "../pages/NotFoundPage";

const home: Crumb = { label: "Inicio", onClick: () => navigate(paths.home) };
const tools: Crumb = { label: "Herramientas", onClick: () => navigate(paths.tools) };

function resolve(segments: string[]) {
  const [section, moduleId, subId, providerId] = segments;
  switch (section) {
    case undefined:
      return { active: "home", crumbs: [{ label: "Inicio" }], page: <HomePage /> };
    case "herramientas": {
      if (!moduleId) return { active: "tools", crumbs: [home, { label: "Herramientas" }], page: <ToolsPage /> };
      const mod = findModule(moduleId);
      if (!mod) break;
      const modCrumb: Crumb = { label: mod.name, onClick: () => navigate(paths.module(mod.id)) };
      if (!subId) return { active: "tools", crumbs: [home, tools, { label: mod.name }], page: <ModulePage module={mod} /> };
      const sub = mod.submodules.find((s) => s.id === subId);
      if (!sub) break;
      if (sub.providers && !providerId) {
        return { active: "tools", crumbs: [home, tools, modCrumb, { label: sub.name }], page: <ProviderSelectPage module={mod} submodule={sub} /> };
      }
      const provider = providerId ? sub.providers?.find((p) => p.id === providerId) : undefined;
      if (providerId && !provider) break;
      const target = provider ?? sub;
      const subCrumbs: Crumb[] = provider
        ? [{ label: sub.name, onClick: () => navigate(paths.submodule(mod.id, sub.id)) }, { label: provider.name }]
        : [{ label: sub.name }];
      const Page = target.component;
      return {
        active: "tools",
        crumbs: [home, tools, modCrumb, ...subCrumbs],
        page: Page ? (
          <Suspense fallback={<Loader />}>
            <Page />
          </Suspense>
        ) : (
          <ComingSoonPage title={target.name} backTo={provider ? paths.submodule(mod.id, sub.id) : paths.module(mod.id)} />
        ),
      };
    }
    case "empresas":
      return { active: "companies", crumbs: [home, { label: "Empresas" }], page: <CompaniesPage /> };
    case "conceptos":
      return { active: "concepts", crumbs: [home, { label: "Conceptos de retención" }], page: <ConceptsPage /> };
    case "configuracion":
      return { active: "settings", crumbs: [home, { label: "Configuración" }], page: <SettingsPage /> };
  }
  return { active: "", crumbs: [home, { label: "No encontrado" }], page: <NotFoundPage /> };
}

export function App() {
  const route = useRoute();
  const [startup, setStartup] = useState<StartupInfo | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    appService.startupInfo().then(setStartup, (e: Error) => setStartupError(e.message));
  }, []);

  useShortcut(",", () => navigate(paths.settings));

  const { active, crumbs, page } = resolve(route);
  const dbError = startup?.databaseError ?? startupError;

  return (
    <AppLayout active={active} crumbs={crumbs} version={startup?.currentVersion ?? "—"}>
      {dbError ? (
        <Card>
          <EmptyState
            icon={<DatabaseZap size={20} />}
            title="No se pudo abrir la base de datos"
            description={
              <>
                {dbError} Si el problema continúa después de reiniciar, en la carpeta de datos (subcarpeta «backups») hay copias
                automáticas de tu información.
              </>
            }
            action={
              <Button variant="secondary" onClick={() => void appService.revealDataFolder()}>
                Abrir carpeta de datos
              </Button>
            }
          />
        </Card>
      ) : (
        page
      )}
      {startup && <WhatsNewModal info={startup} />}
      <UpdateNotice />
    </AppLayout>
  );
}
