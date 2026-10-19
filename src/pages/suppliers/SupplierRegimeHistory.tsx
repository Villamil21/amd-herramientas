import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, DateInput, Field, Input, useToast } from "../../components/ui";
import { purchasesService } from "../../services/purchasesService";
import { errorMessage } from "../../services/tauri";
import type { SupplierFiscalEntry } from "../../types/purchases";
import { formatDateText } from "../../utils/dates";
import { cleanupSummary } from "../../modules/financial-statements/purchases/domain/history";
import { FiscalRegimeField } from "./FiscalRegimeField";

const SOURCE_LABEL: Record<SupplierFiscalEntry["source"], string> = { factura: "Factura", manual: "Manual", proveedor: "Ficha del proveedor" };

/**
 * Historial del régimen fiscal del proveedor con fecha efectiva. Cada factura usa el régimen vigente en su fecha de expedición:
 * un cambio posterior no recalcula las facturas anteriores. O-15 (autorretenedor) y O-47 (régimen simple) no generan retención
 * automática; si una factura de esos proveedores trae retención, Compras lo alerta y se decide allí.
 */
export function SupplierRegimeHistory({ supplierNit, currentRegime, onChanged }: { supplierNit: string; currentRegime: string; onChanged?: () => void }) {
  const toast = useToast();
  const [entries, setEntries] = useState<SupplierFiscalEntry[] | null>(null);
  const [draft, setDraft] = useState<{ date: string; regime: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setEntries(await purchasesService.supplierFiscalHistory(supplierNit));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [supplierNit, toast]);
  useEffect(() => void reload(), [reload]);

  const save = async () => {
    if (!draft || !draft.date || !draft.regime.trim()) return;
    setBusy(true);
    try {
      const cleanup = await purchasesService.saveSupplierFiscal({ supplierNit, effectiveDate: draft.date, regime: draft.regime.trim(), source: "manual", note: draft.note.trim() });
      setDraft(null);
      await reload();
      onChanged?.();
      if (cleanup && cleanupSummary(cleanup)) toast(`Se aplicó el régimen: ${cleanupSummary(cleanup)}.`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (e: SupplierFiscalEntry) => {
    try {
      await purchasesService.deleteSupplierFiscal(supplierNit, e.effectiveDate);
      await reload();
      onChanged?.();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  return (
    <div className="stack stack--sm">
      <div className="row row--between">
        <strong className="form-section__subtitle">Historial de régimen</strong>
        {!draft && (
          <Button size="sm" icon={<Plus size={13} />} onClick={() => setDraft({ date: "", regime: currentRegime, note: "" })}>
            Agregar cambio
          </Button>
        )}
      </div>
      {draft && (
        <div className="form-grid form-grid--compact">
          <Field label="Fecha efectiva">{(id) => <DateInput id={id} value={draft.date} onChange={(date) => setDraft({ ...draft, date })} />}</Field>
          <Field label="Régimen / responsabilidades" hint="Ej.: O-13; O-23. O-15 y O-47 no generan retención." className="span-full">{(id) => <FiscalRegimeField id={id} value={draft.regime} onChange={(regime) => setDraft({ ...draft, regime })} />}</Field>
          <Field label="Nota">{(id) => <Input id={id} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />}</Field>
          <div className="row">
            <Button variant="primary" size="sm" loading={busy} disabled={!draft.date || !draft.regime.trim()} onClick={save}>
              Guardar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {entries && entries.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Desde</th>
                <th>Régimen</th>
                <th>Origen</th>
                <th>Nota</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.effectiveDate}>
                  <td>{formatDateText(e.effectiveDate)}</td>
                  <td>{e.regime}</td>
                  <td>{SOURCE_LABEL[e.source]}</td>
                  <td>{e.note}</td>
                  <td>
                    <Button variant="ghost" size="sm" iconOnly aria-label="Eliminar" icon={<Trash2 size={13} />} onClick={() => remove(e)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        entries && <p className="field__hint">Sin historial: se usa el régimen que traiga cada factura.</p>
      )}
    </div>
  );
}
