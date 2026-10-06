import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Alert, Button, Modal, Select, useToast } from "../../../../components/ui";
import { pucService } from "../../../../services/pucService";
import type { DocumentTitleMapping } from "../../../../types/models";
import { DOC_CATEGORY_LABEL, type DocCategory } from "../types";

/** Clasificación guardada de los títulos de documento (Factura electrónica / Nota crédito): ver, cambiar o eliminar. */
export function TitleMappingsModal({ open, titles, onClose, onChanged }: { open: boolean; titles: DocumentTitleMapping[]; onClose: () => void; onChanged: () => void }) {
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
    <Modal open={open} size="lg" title="Tipos de documento" description="Cada título se clasifica una sola vez como Factura electrónica o Nota crédito; la decisión se aplica en todas las cargas." onClose={onClose}>
      {titles.length === 0 ? (
        <Alert tone="info">Aún no hay títulos clasificados.</Alert>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Clasificación</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {titles.map((t) => (
                <tr key={t.id}>
                  <td className="table__primary">{t.displayTitle}</td>
                  <td style={{ width: 200 }}>
                    <Select
                      aria-label={`Clasificación de ${t.displayTitle}`}
                      value={t.category}
                      disabled={busy !== null}
                      onChange={(e) => void run(t.id, () => pucService.updateTitle(t.id, e.target.value as DocCategory), "Clasificación actualizada.")}
                    >
                      {Object.entries(DOC_CATEGORY_LABEL).map(([k, label]) => (
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
                      onClick={() => void run(t.id, () => pucService.removeTitle(t.id), "Clasificación eliminada: el título se volverá a preguntar.")}
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
