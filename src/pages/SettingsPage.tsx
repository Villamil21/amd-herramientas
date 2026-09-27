import { FolderOpen } from "lucide-react";
import { navigate, paths } from "../app/router";
import { ModuleTile } from "../components/ModuleTile";
import { Button, Card, PageHeader } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { appService } from "../services/appService";
import { AboutSection } from "./settings/AboutSection";
import { BackupSection } from "./settings/BackupSection";

export function SettingsPage() {
  const info = useAsync(() => Promise.all([appService.startupInfo(), appService.dataLocation()]), []);
  const [startup, location] = info.data ?? [null, null];

  return (
    <>
      <PageHeader eyebrow="Configuración" title="Configuración" description="Datos compartidos, copias de seguridad y actualizaciones." />

      <div className="tile-grid">
        <ModuleTile title="Empresas" description="Empresas emisoras, sus datos y logos." available hideStatus meta="Administrar" onOpen={() => navigate(paths.companies)} />
        <ModuleTile title="Conceptos de retención" description="Conceptos, tipos y tarifas predeterminadas." available hideStatus meta="Administrar" onOpen={() => navigate(paths.concepts)} />
      </div>

      <BackupSection />
      <AboutSection version={startup?.currentVersion ?? "—"} />

      <Card title="Ubicación de los datos" description="Carpeta de datos de la aplicación, separada del programa. Actualizar o reemplazar la aplicación no la modifica.">
        <div className="row row--between">
          <code className="mono selectable muted" style={{ overflowWrap: "anywhere" }}>
            {location ?? "…"}
          </code>
          <Button size="sm" icon={<FolderOpen size={14} />} onClick={() => void appService.revealDataFolder()}>
            Mostrar en Finder
          </Button>
        </div>
      </Card>
    </>
  );
}
