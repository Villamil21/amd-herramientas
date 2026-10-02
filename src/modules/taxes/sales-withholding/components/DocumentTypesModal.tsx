import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Alert, Button, Modal, Select, useToast } from "../../../../components/ui";
import { selfWithholdingService } from "../../../../services/selfWithholdingService";
import { SALES_CATEGORY_LABEL, type SalesCategory, type SalesDocumentTypeMapping } from "../../../../types/models";

/** Clasificación guardada de tipos de documento de Ventas: ver, cambiar o eliminar. */
export function DocumentTypesModal({ open, types, onClose, onChanged }: { open: boolean; types: SalesDocumentTypeMapping[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);

  async function run(id: number, action: () => Promise<void>, message: string) {
    setBusy(id);
    try {
      await action();
      toast(message);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={open} size="lg" title="Tipos de documento" description="Cada tipo de documento se clasifica una sola vez como Facturas o Notas Crédito." onClose={onClose}>
      {types.length === 0 ? (
        <Alert tone="info">Aún no hay tipos de documento clasificados.</Alert>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tipo de documento</th>
                <th>Clasificación</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id}>
                  <td className="table__primary">{t.originalLabel}</td>
                  <td style={{ width: 180 }}>
                    <Select
                      aria-label={`Clasificación de ${t.originalLabel}`}
                      value={t.category}
                      disabled={busy !== null}
                      onChange={(e) => void run(t.id, () => selfWithholdingService.updateDocumentType(t.id, e.target.value as SalesCategory), "Clasificación actualizada.")}
                    >
                      {Object.entries(SALES_CATEGORY_LABEL).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      icon={<Trash2 size={14} />}
                      aria-label="Eliminar"
                      loading={busy === t.id}
                      disabled={busy !== null}
                      onClick={() => void run(t.id, () => selfWithholdingService.removeDocumentType(t.id), "Clasificación eliminada: el tipo se volverá a preguntar.")}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
