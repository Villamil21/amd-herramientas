import { useEffect, useState } from "react";
import { Alert, Button, Modal } from "../../../../components/ui";
import { MONTHS_ES } from "../../../../utils/dates";
import { yearMonths, type UploadCoverage } from "../domain/coverage";

interface Props {
  coverage: UploadCoverage | null;
  year: number;
  onClose: () => void;
  onSave: (months: string[] | null) => Promise<void>;
}

/** Ajuste del período que cubre una carga: Ventas no trae fecha, así que su ingreso pertenece a los meses de esta cobertura. */
export function CoverageModal({ coverage, year, onClose, onSave }: Props) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => setChosen(coverage?.selected ?? []), [coverage]);
  const toggle = (m: string) => setChosen((c) => (c.includes(m) ? c.filter((x) => x !== m) : [...c, m].sort()));

  async function run(months: string[] | null) {
    setSaving(true);
    try {
      await onSave(months);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={coverage !== null}
      title="Período de cobertura de la carga"
      description={coverage?.fileName}
      size="md"
      onClose={onClose}
      locked={saving}
      footer={
        <>
          {coverage?.overridden && (
            <Button variant="ghost" onClick={() => void run(null)} disabled={saving}>
              Volver al período de Compras.Fecha
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} disabled={chosen.length === 0} onClick={() => void run(chosen)}>
            Guardar cobertura
          </Button>
        </>
      }
    >
      <div className="stack stack--sm">
        <Alert tone="info">
          Derivado de las fechas de Compras: {coverage?.derived.length ? coverage.derived.join(", ") : "ningún mes (sin compras con fecha válida)"}. Ajústalo solo si la carga contiene más o menos meses de los que muestran sus compras: las Ventas de esta carga se asociarán a los meses que elijas.
        </Alert>
        <div className="form-grid form-grid--compact" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          {yearMonths(year).map((m, i) => (
            <label key={m} className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={chosen.includes(m)} onChange={() => toggle(m)} />
              {MONTHS_ES[i].charAt(0) + MONTHS_ES[i].slice(1).toLowerCase()}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}
