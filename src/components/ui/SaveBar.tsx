import { RotateCcw, Save } from "lucide-react";
import { Button } from "./Button";

/** Barra fija al pie de una tabla editable: aparece con cambios sin guardar y mantiene «Guardar cambios» a la vista. */
export function SaveBar({ count, saving, disabled, onSave, onDiscard }: { count: number; saving?: boolean; disabled?: boolean; onSave: () => void; onDiscard: () => void }) {
  if (count === 0) return null;
  return (
    <div className="save-bar" role="status">
      <span>
        <strong>{count}</strong> {count === 1 ? "cambio sin guardar" : "cambios sin guardar"}
      </span>
      <span className="row" style={{ gap: 6 }}>
        <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={onDiscard} disabled={saving}>
          Descartar
        </Button>
        <Button size="sm" variant="primary" icon={<Save size={14} />} onClick={onSave} loading={saving} disabled={disabled}>
          Guardar cambios
        </Button>
      </span>
    </div>
  );
}
