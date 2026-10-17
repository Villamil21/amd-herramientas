import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, ConfirmDialog, DateInput, Field, Input, Select, useToast } from "../../components/ui";
import { purchasesService } from "../../services/purchasesService";
import { errorMessage } from "../../services/tauri";
import type { CompanyVatEntry } from "../../types/purchases";
import { formatDateText } from "../../utils/dates";
import type { RutData } from "./import/rutParser";

interface Props {
  companyId: number | null;
  /** RUT cargado en esta sesión (para proponer la responsabilidad 48). */
  rut: RutData | null;
}

/**
 * Historial de la responsabilidad frente al IVA (código 48 del RUT) con fecha efectiva. Cada factura usa la entrada vigente en
 * su fecha de expedición; un cambio nunca recalcula períodos anteriores. Nada se guarda sin confirmar y sin fecha efectiva.
 */
export function VatHistorySection({ companyId, rut }: Props) {
  const toast = useToast();
  const [entries, setEntries] = useState<CompanyVatEntry[] | null>(null);
  const [draft, setDraft] = useState<{ date: string; responsible: "yes" | "no"; note: string; source: "rut" | "manual"; editing: boolean } | null>(null);
  const [removing, setRemoving] = useState<CompanyVatEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (companyId === null) return setEntries([]);
    try {
      setEntries(await purchasesService.companyVatHistory(companyId));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [companyId, toast]);
  useEffect(() => void reload(), [reload]);

  const fromRut = rut && rut.vatResponsible !== undefined ? rut : null;

  const save = async () => {
    if (companyId === null || !draft || !draft.date) return;
    setBusy(true);
    try {
      await purchasesService.saveCompanyVat({ companyId, effectiveDate: draft.date, responsible: draft.responsible === "yes", source: draft.source, note: draft.note.trim() });
      setDraft(null);
      await reload();
      toast("Historial de IVA actualizado.");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (companyId === null || !removing) return;
    setBusy(true);
    try {
      await purchasesService.deleteCompanyVat(companyId, removing.effectiveDate);
      setRemoving(null);
      await reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack stack--sm span-all">
      <div className="row row--between">
        <strong className="form-section__subtitle">Historial de IVA (responsabilidad 48)</strong>
        {companyId !== null && !draft && (
          <Button size="sm" icon={<Plus size={13} />} onClick={() => setDraft({ date: "", responsible: "yes", note: "", source: "manual", editing: false })}>
            Agregar cambio
          </Button>
        )}
      </div>
      <p className="field__hint">
        Define desde qué fecha la empresa es (o deja de ser) responsable de IVA. Si no lo es, los formatos 1005 y 1006 quedan como «No aplica» y Obligaciones tributarias no importa declaraciones de IVA de ese período. Cada factura usa lo vigente en su fecha de expedición.
      </p>

      {companyId === null && <Alert tone="info">Guarda la empresa para registrar su historial de IVA.</Alert>}

      {companyId !== null && fromRut && !draft && (
        <Alert tone={fromRut.vatResponsible ? "success" : "warning"} title={fromRut.vatResponsible ? "El RUT cargado incluye la responsabilidad 48 (IVA)" : "El RUT cargado no incluye la responsabilidad 48 (IVA)"}>
          <div className="row">
            <span>{fromRut.responsibilityDate ? `Fecha del RUT: ${formatDateText(fromRut.responsibilityDate)}.` : "El RUT no trae una fecha legible: indica desde cuándo rige."}</span>
            <Button size="sm" onClick={() => setDraft({ date: fromRut.responsibilityDate ?? "", responsible: fromRut.vatResponsible ? "yes" : "no", note: "Leído del RUT", source: "rut", editing: false })}>
              Revisar y registrar
            </Button>
          </div>
        </Alert>
      )}
      {companyId !== null && rut && rut.vatResponsible === undefined && !draft && <Alert tone="info">No se encontró la sección de responsabilidades en el RUT: registra el perfil de IVA a mano.</Alert>}

      {draft && (
        <div className="form-grid form-grid--compact">
          <Field label="Fecha efectiva" hint="Desde este día rige la responsabilidad.">{(id) => <DateInput id={id} value={draft.date} onChange={(date) => setDraft({ ...draft, date })} />}</Field>
          <Field label="Responsable de IVA">
            {(id) => (
              <Select id={id} value={draft.responsible} onChange={(e) => setDraft({ ...draft, responsible: e.target.value as "yes" | "no" })}>
                <option value="yes">Sí, responsable de IVA</option>
                <option value="no">No responsable de IVA</option>
              </Select>
            )}
          </Field>
          <Field label="Nota" hint="Opcional.">{(id) => <Input id={id} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />}</Field>
          <div className="row">
            <Button variant="primary" size="sm" loading={busy} disabled={!draft.date} onClick={save}>
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
                <th>IVA</th>
                <th>Origen</th>
                <th>Nota</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.effectiveDate}>
                  <td>{formatDateText(e.effectiveDate)}</td>
                  <td>
                    <Badge tone={e.responsible ? "success" : undefined}>{e.responsible ? "Responsable" : "No responsable"}</Badge>
                  </td>
                  <td>{e.source === "rut" ? "RUT" : "Manual"}</td>
                  <td>{e.note}</td>
                  <td>
                    <Button variant="ghost" size="sm" iconOnly aria-label="Editar" onClick={() => setDraft({ date: e.effectiveDate, responsible: e.responsible ? "yes" : "no", note: e.note, source: e.source, editing: true })}>
                      Editar
                    </Button>
                    <Button variant="ghost" size="sm" iconOnly aria-label="Eliminar" icon={<Trash2 size={13} />} onClick={() => setRemoving(e)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        companyId !== null && entries && <p className="field__hint">Sin historial: Compras no podrá decidir si el IVA es descontable (1005/1006) o mayor valor del costo hasta que lo registres.</p>
      )}

      <ConfirmDialog open={!!removing} title="Eliminar cambio de IVA" message={removing ? `Se elimina el cambio con fecha efectiva ${formatDateText(removing.effectiveDate)}. Las facturas de ese período dejarán de tener perfil de IVA si no hay otra entrada anterior.` : ""} confirmLabel="Eliminar" danger loading={busy} onConfirm={remove} onCancel={() => setRemoving(null)} />
    </section>
  );
}
