import { useState } from "react";
import { Save } from "lucide-react";
import { Button, Card, Select, useToast } from "../../../../components/ui";
import { dropiService } from "../../../../services/dropiService";
import { errorMessage } from "../../../../services/tauri";
import { formatInteger } from "../../../../utils/format";
import { CONFIGURABLE_CATEGORIES, CONFIGURABLE_LABEL } from "../services/statuses";
import { formatCop } from "../services/format";
import type { ConfigurableCategory, StatusDetail } from "../types";

/**
 * Estados que no tienen regla fija ni clasificación guardada: una sola
 * pregunta por estado (no por fila). Nada se asigna sin la decisión del
 * usuario; lo elegido se guarda en SQLite y se aplica en los próximos archivos.
 */
export function PendingStatusesPanel({ pending, onSaved }: { pending: StatusDetail[]; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [choice, setChoice] = useState<Record<string, ConfigurableCategory>>({});
  const [saving, setSaving] = useState(false);
  const chosen = pending.filter((p) => choice[p.key]);

  async function save() {
    if (chosen.length === 0 || saving) return;
    setSaving(true);
    try {
      await dropiService.saveStatusMappings(chosen.map((p) => ({ normalizedStatus: p.key, displayStatus: p.display, category: choice[p.key] })));
      await onSaved();
      toast(chosen.length === 1 ? "Clasificación guardada." : `${chosen.length} clasificaciones guardadas.`);
      setChoice({});
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  const n = pending.length;
  return (
    <Card
      flush
      title="Estados nuevos encontrados"
      description={
        <>
          {n === 1 ? "Hay 1 estado pendiente por clasificar." : `Hay ${n} estados pendientes por clasificar.`} La clasificación se guarda y se aplica
          automáticamente en los próximos archivos de cualquier empresa.
        </>
      }
      footer={
        <div className="row row--between">
          <span className="muted">
            {chosen.length === 0 ? "Elige una clasificación para guardar." : `${chosen.length} de ${n} con clasificación elegida.`}
          </span>
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
              <th>Estado detectado</th>
              <th className="num">Filas</th>
              <th className="num">Pedidos únicos</th>
              <th className="num">Valor de compra en productos</th>
              <th>¿Dónde deseas clasificarlo?</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((p) => (
              <tr key={p.key}>
                <td className="table__primary selectable">{p.display}</td>
                <td className="num">{formatInteger(p.rows)}</td>
                <td className="num">{formatInteger(p.uniqueOrders)}</td>
                <td className="num">{formatCop(p.purchaseCents)}</td>
                <td style={{ width: 200 }}>
                  <Select
                    aria-label={`Clasificación de ${p.display}`}
                    value={choice[p.key] ?? ""}
                    disabled={saving}
                    onChange={(e) => setChoice((c) => ({ ...c, [p.key]: e.target.value as ConfigurableCategory }))}
                  >
                    <option value="" disabled>
                      Seleccionar…
                    </option>
                    {CONFIGURABLE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CONFIGURABLE_LABEL[c]}
                      </option>
                    ))}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
