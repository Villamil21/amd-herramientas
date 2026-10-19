import { useState } from "react";
import { Button, DateInput, Field, useToast } from "../../../../components/ui";
import { FiscalRegimeField } from "../../../../pages/suppliers/FiscalRegimeField";
import { purchasesService } from "../../../../services/purchasesService";
import { errorMessage } from "../../../../services/tauri";
import { formatDateForDisplay } from "../../../../utils/dates";
import { cleanupSummary } from "../domain/history";
import type { DocView } from "../domain/model";
import type { PurchasesData } from "../usePurchasesData";

interface Props {
  data: PurchasesData;
  view: DocView;
}

/**
 * Régimen fiscal del proveedor en la fecha de la factura, editable sin salir de la clasificación. Un cambio se guarda en el
 * historial con su fecha efectiva (rige desde ahí; no recalcula facturas anteriores). Al pasar a O-15 / O-47 desaparece el
 * selector de retenciones; al volver a un régimen con retención, reaparece.
 */
export function RegimeInline({ data, view }: Props) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [regime, setRegime] = useState(view.regime.text);
  const [date, setDate] = useState(view.doc.issueDate ?? "");
  const [busy, setBusy] = useState(false);
  const { regime: current } = view;

  const origin =
    current.from === "history" ? `según el historial, desde ${current.since ? formatDateForDisplay(current.since) : "siempre"}` : current.from === "invoice" ? "según la factura (sin historial)" : "";

  const save = async () => {
    if (!regime.trim() || !date) return;
    setBusy(true);
    try {
      const cleanup = await purchasesService.saveSupplierFiscal({ supplierNit: view.supplierNit, effectiveDate: date, regime: regime.trim(), source: "manual", note: "Capturado al clasificar una línea" });
      await Promise.all([data.reloadSuppliers(), data.reloadRules(), data.reloadState()]);
      const summary = cleanupSummary(cleanup);
      toast(summary ? `Régimen guardado. ${summary}.` : "Régimen guardado.");
      setEditing(false);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack" style={{ gap: 6 }} aria-label="Régimen fiscal del proveedor">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <strong>Régimen fiscal del proveedor</strong>
        <span data-testid="line-regime">{current.text || "Sin identificar"}</span>
        {origin && <span className="field__hint">{origin}</span>}
        {!editing && (
          <Button size="sm" onClick={() => setEditing(true)}>
            Cambiar régimen
          </Button>
        )}
      </div>
      {editing && (
        <div className="stack" style={{ gap: 8 }}>
          <Field label="Régimen / responsabilidades" hint="O-15 (autorretenedor) y O-47 (régimen simple) no generan retención.">
            {(id) => <FiscalRegimeField id={id} value={regime} onChange={setRegime} />}
          </Field>
          <Field label="Rige desde" hint="Aplica a las facturas de esta fecha en adelante; las anteriores no cambian.">
            {(id) => <DateInput id={id} value={date} onChange={setDate} />}
          </Field>
          <div className="row" style={{ gap: 8 }}>
            <Button variant="primary" size="sm" loading={busy} disabled={!regime.trim() || !date} onClick={() => void save()}>
              Guardar régimen
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
