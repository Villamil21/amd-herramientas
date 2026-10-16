import { FolderOpen } from "lucide-react";
import { Button, Card, PageHeader } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { appService } from "../services/appService";
import { AboutSection } from "./settings/AboutSection";
import { BackupSection } from "./settings/BackupSection";
import { DangerZoneSection } from "./settings/DangerZoneSection";

export function SettingsPage() {
  const info = useAsync(() => Promise.all([appService.startupInfo(), appService.dataLocation()]), []);
  const [startup, location] = info.data ?? [null, null];

  return (
    <>
      <PageHeader eyebrow="Configuración" title="Configuración" description="Actualizaciones, copias de seguridad y ubicación de los datos." />

      <AboutSection version={startup?.currentVersion ?? "—"} />
      <BackupSection />

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

      <DangerZoneSection />
    </>
  );
}
