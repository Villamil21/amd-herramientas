import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button, Modal } from "../components/ui";
import type { StartupInfo } from "../types/models";
import { changelogFor } from "./changelog";

/** Se muestra una sola vez: en el primer arranque después de actualizar. */
export function WhatsNewModal({ info }: { info: StartupInfo }) {
  const entry = changelogFor(info.currentVersion);
  const [open, setOpen] = useState(info.updated);
  if (!open) return null;
  return (
    <Modal
      open
      size="sm"
      title={`Novedades de la versión ${info.currentVersion}`}
      description={info.previousVersion ? `Actualizada desde la versión ${info.previousVersion}. Tus datos se conservaron.` : undefined}
      onClose={() => setOpen(false)}
      footer={
        <Button variant="primary" onClick={() => setOpen(false)}>
          Continuar
        </Button>
      }
    >
      <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
        <div className="tile__icon" style={{ flexShrink: 0 }}>
          <Sparkles size={18} />
        </div>
        {entry ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {entry.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">La aplicación se actualizó correctamente.</p>
        )}
      </div>
    </Modal>
  );
}
