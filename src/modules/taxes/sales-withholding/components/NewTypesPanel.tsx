import { useState } from "react";
import { Save } from "lucide-react";
import { Button, Card, useToast } from "../../../../components/ui";
import { selfWithholdingService } from "../../../../services/selfWithholdingService";
import { errorMessage } from "../../../../services/tauri";
import { SALES_CATEGORY_LABEL, type SalesCategory } from "../../../../types/models";
import { formatInteger } from "../../../../utils/format";
import type { SalesAnalysis } from "../types";

const CATEGORIES = Object.keys(SALES_CATEGORY_LABEL) as SalesCategory[];

/**
 * Tipos de documento sin clasificación guardada: una pregunta por tipo (no por
 * fila). Nada se asigna sin la decisión del usuario; lo elegido se guarda en
 * SQLite y no se vuelve a preguntar en los próximos archivos.
 */
export function NewTypesPanel({ types, onSaved }: { types: SalesAnalysis["newTypes"]; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [choice, setChoice] = useState<Record<string, SalesCategory>>({});
  const [saving, setSaving] = useState(false);
  const chosen = types.filter((t) => choice[t.key]);

  async function save() {
    if (chosen.length === 0 || saving) return;
    setSaving(true);
    try {
      await selfWithholdingService.saveDocumentTypes(chosen.map((t) => ({ normalizedLabel: t.key, originalLabel: t.label, category: choice[t.key] })));
      await onSaved();
      toast(chosen.length === 1 ? "Clasificación guardada." : `${chosen.length} clasificaciones guardadas.`);
      setChoice({});
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      flush
      title={types.length === 1 ? "Se encontró un nuevo tipo de documento" : `Se encontraron ${types.length} tipos de documento nuevos`}
      description="¿Dónde deseas clasificarlo? La decisión se guarda y se aplica automáticamente en los próximos archivos."
      footer={
        <div className="row row--between">
          <span className="muted">{chosen.length === 0 ? "Elige Facturas o Notas Crédito para guardar." : `${chosen.length} de ${types.length} con clasificación elegida.`}</span>
          <Button variant="primary" icon={<Save size={15} />} disabled={chosen.length === 0} loading={saving} onClick={() => void save()}>
            Guardar clasificación
          </Button>
        </div>
      }
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Tipo de documento</th>
              <th className="num">Filas</th>
              <th>Clasificación</th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.key}>
                <td className="table__primary selectable">"{t.label}"</td>
                <td className="num">{formatInteger(t.rows)}</td>
                <td>
                  <div className="segmented" role="radiogroup" aria-label={`Clasificación de ${t.label}`}>
                    {CATEGORIES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={choice[t.key] === c}
                        className={choice[t.key] === c ? "is-active" : undefined}
                        disabled={saving}
                        onClick={() => setChoice((prev) => ({ ...prev, [t.key]: c }))}
                      >
                        {SALES_CATEGORY_LABEL[c]}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
