import { Landmark, Pencil, Plus, RefreshCcw, Trash2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { navigate } from "../../../app/router";
import { SupplierFormModal } from "../../../pages/suppliers/SupplierFormModal";
import { withholdingService } from "../../../services/withholdingService";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Loader, Modal, PageHeader, useToast } from "../../../components/ui";
import { exogenaService } from "../../../services/exogenaService";
import { errorMessage } from "../../../services/tauri";
import type { ExoRecord, RecordData, SyncOutcome } from "../../../types/exogena";
import type { WithholdingRate } from "../../../types/models";
import { formatMoneyCents } from "../../../utils/format";
import { ExogenaContextBar } from "../components/ExogenaContextBar";
import { ProblemsPanel } from "../components/ProblemsPanel";
import { RecordEditor } from "../components/RecordEditor";
import { StatusPanel } from "../components/StatusPanel";
import { CONCEPTS_1009, FORMAT_1009, type Data1009 } from "../domain/form1009";
import { formatPesosPlain } from "../domain/numbers";
import { blocking } from "../domain/problems";
import { personName } from "../domain/thirdParty";
import { use1009 } from "../use1009";
import { useExogenaSelection } from "../state";

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const SOURCE_LABEL: Record<string, string> = { compras: "Compras y movimientos", tributaria: "Obligaciones tributarias", seguridad_social: "Seguridad social", manual: "Manual" };

/** Plantilla de un registro manual (no sale de ninguna fuente: el usuario lo digita completo). */
const BLANK: Data1009 = {
  concept: "2201", thirdKey: "manual", supplierId: null, thirdName: "", sources: ["manual"], personType: null, docTypeCode: "", docNumber: "", dv: "", firstSurname: "", secondSurname: "", firstName: "", otherNames: "", businessName: "", address: "", deptCode: "", muniCode: "", countryCode: "", balanceCents: 0, balance: 0,
};
const BLANK_RECORD = (companyId: number, year: number): ExoRecord => ({ id: -1, companyId, year, formatCode: FORMAT_1009, sourceKey: "manual:nuevo", origin: "manual", originRef: "Registro manual", data: BLANK, manualFields: [], manuallyModifiedAt: null, syncedAt: null, createdAt: "", updatedAt: "" });

/**
 * Formato 1009 — Saldo de cuentas por pagar al 31 de diciembre. Es un estado por tercero al cierre anual, alimentado por
 * Estados Financieros (solo lectura), y siempre conciliado con el total de pasivos del Estado de Situación Financiera.
 */
export default function Format1009Page() {
  const toast = useToast();
  const [selection] = useExogenaSelection();
  const m = use1009(selection.companyId, selection.year);
  const { company, model, format, catalogs } = m;
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<ExoRecord | null>(null);
  const [conflicts, setConflicts] = useState<SyncOutcome["conflicts"] | null>(null);
  const [report, setReport] = useState<{ outcome: SyncOutcome; sources: string[]; needData: string[] } | null>(null);
  const [restoring, setRestoring] = useState<ExoRecord | null>(null);
  const [deleting, setDeleting] = useState<ExoRecord | null>(null);
  const [ficha, setFicha] = useState<ExoRecord | null>(null);
  const [rates, setRates] = useState<WithholdingRate[]>([]);

  useEffect(() => {
    void withholdingService.listRates().then(setRates, () => undefined);
  }, []);

  // Un 1009 «listo» deja de estarlo si cambió su origen, un tercero o la conciliación: se reabre, nunca se reescribe en silencio.
  useEffect(() => {
    if (format.status.status === "listo" && model && blocking(model.problems).length > 0) void format.setStatus("requiere_actualizacion");
  }, [format, model]);

  async function sync(overwrite: string[] = []) {
    if (!company || !model) return;
    setSyncing(true);
    try {
      const outcome = await exogenaService.applySync({
        companyId: company.id,
        year: selection.year,
        formatCode: FORMAT_1009,
        source: "Estados Financieros",
        proposals: model.built.proposals,
        removeMissing: true,
        overwriteManual: overwrite,
        summary: model.built.summary,
      });
      await m.reloadAll();
      if (outcome.conflicts.length && overwrite.length === 0) setConflicts(outcome.conflicts);
      const needData = model.built.proposals.filter((p) => p.data.supplierId === null).map((p) => str(p.data.thirdName));
      setReport({ outcome, sources: model.built.summary.sources, needData });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSyncing(false);
    }
  }

  async function saveRecord(record: ExoRecord, patch: RecordData) {
    if (record.id < 0) {
      // Registro manual nuevo: se guarda completo con lo que digitó el usuario.
      const data = { ...BLANK, ...patch } as Data1009;
      data.thirdName = data.businessName || personName({ firstSurname: str(data.firstSurname), secondSurname: str(data.secondSurname), firstName: str(data.firstName), otherNames: str(data.otherNames) });
      await exogenaService.createRecord(record.companyId, record.year, FORMAT_1009, data);
      toast("Registro manual agregado.");
    } else {
      await exogenaService.updateRecord(record.id, patch);
      toast("Corrección guardada.");
    }
    setEditing(null);
    await m.reloadAll();
  }

  async function removeManual(record: ExoRecord) {
    try {
      await exogenaService.deleteRecord(record.id);
      toast("Registro eliminado.");
      setDeleting(null);
      await m.reloadAll();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const records = format.records;
  const rec = model?.reconciliation;
  const balanced = rec?.differenceCents === 0;
  const problemCount = (key: string) => model?.problems.filter((p) => p.recordKey === key).length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow={`Información Exógena · ${selection.year}`}
        title="1009 · Saldos de cuentas por pagar al 31 de diciembre"
        description="Saldo pendiente por tercero al cierre anual: proveedores, impuestos (DIAN) y seguridad social. Se concilia con los pasivos del Estado de Situación Financiera."
        actions={
          <>
            <Button icon={<Plus size={15} />} disabled={!company} onClick={() => setEditing(BLANK_RECORD(company!.id, selection.year))}>
              Registro manual
            </Button>
            <Button variant="primary" icon={<RefreshCcw size={15} />} loading={syncing} disabled={!model} onClick={() => void sync()}>
              Actualizar desde Estados Financieros
            </Button>
          </>
        }
      />
      <ExogenaContextBar companies={m.companies} />
      {!selection.companyId || (m.companies && !company) ? (
        <Card>
          <EmptyState icon={<Landmark size={20} />} title="Selecciona una empresa" description="Elige la empresa y el año a informar para preparar el formato 1009." />
        </Card>
      ) : !m.ready || !model || !records ? (
        <Loader />
      ) : (
        <>
          <StatusPanel row={format.status} problems={model.problems} onSetStatus={format.setStatus} />

          <Card title="Conciliación con el Estado de Situación Financiera" description={`Corte al 31/12/${selection.year}. El 1009 solo puede quedar «listo» con diferencia cero y sin pendientes. Exógena no ajusta Estados Financieros: cada diferencia se resuelve en su origen.`}>
            <div className="fs-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
              <div className="fs-kpi">
                <span className="muted">Suma de registros 1009</span>
                <strong>{formatMoneyCents(rec!.recordsCents)}</strong>
              </div>
              <div className="fs-kpi">
                <span className="muted">Total pasivos del ESF al 31/12</span>
                <strong>{formatMoneyCents(rec!.liabilitiesCents)}</strong>
              </div>
              <div className="fs-kpi">
                <span className="muted">Diferencia</span>
                <strong className={balanced ? "amount--positive" : "amount--negative"}>{formatMoneyCents(rec!.differenceCents)}</strong>
                <Badge tone={balanced ? "success" : "danger"}>{balanced ? "Conciliado" : "No cuadra"}</Badge>
              </div>
            </div>
            {rec!.items.length > 0 && (
              <div className="stack stack--sm" style={{ marginTop: 12 }}>
                <strong>Sin tercero o sin correspondencia ({rec!.items.length})</strong>
                <ul className="pending-list">
                  {rec!.items.map((item, i) => (
                    <li key={i} className="pending-item pending-item--blocking">
                      <div className="pending-item__text">
                        <strong>{item.label}</strong>
                        <span>
                          {formatMoneyCents(item.cents)}
                          {item.detail ? ` · ${item.detail}` : ""}
                        </span>
                      </div>
                      {item.action && (
                        <div className="pending-item__actions">
                          <Button size="sm" onClick={() => navigate(item.action!.path)}>
                            {item.action.label}
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {model.changes.length > 0 && (
            <Alert tone="warning" title="Hay cambios sin sincronizar">
              Estados Financieros o los terceros cambiaron desde la última sincronización ({model.changes.length} {model.changes.length === 1 ? "registro" : "registros"}). Usa «Actualizar desde Estados Financieros».
            </Alert>
          )}
          <ProblemsPanel problems={model.problems} okText="Sin pendientes y conciliado: el 1009 se puede marcar como listo." />

          <Card flush title={`Registros (${records.length})`} description="Una fila por tercero y concepto. El conteo no incluye encabezados ni filas decorativas.">
            {records.length === 0 ? (
              <EmptyState
                icon={<Landmark size={20} />}
                title="Aún no hay saldos en este formato"
                description={`Usa «Actualizar desde Estados Financieros» para traer los saldos pendientes al 31/12/${selection.year}, o marca el formato como «No aplica» si la empresa no tuvo cuentas por pagar.`}
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Tercero</th>
                      <th>Documento</th>
                      <th>Concepto</th>
                      <th className="num">Saldo al 31/12</th>
                      <th>Fuente</th>
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => {
                      const d = r.data;
                      const pending = problemCount(r.sourceKey);
                      return (
                        <tr key={r.id} className="is-clickable" onClick={() => setEditing(r)}>
                          <td className="table__primary">
                            {str(d.thirdName) || str(d.businessName) || r.sourceKey}
                            {d.supplierId === null && r.origin !== "manual" && <div className="muted">Sin ficha de proveedor</div>}
                          </td>
                          <td className="selectable">
                            {str(d.docTypeCode) || "—"} · {str(d.docNumber)}
                            {str(d.dv) ? `-${str(d.dv)}` : ""}
                          </td>
                          <td>
                            <span title={CONCEPTS_1009.find((c) => c.code === d.concept)?.label}>{str(d.concept)}</span>
                          </td>
                          <td className="num">{typeof d.balance === "number" ? formatPesosPlain(d.balance) : "—"}</td>
                          <td>
                            {((d.sources as string[] | undefined) ?? []).map((s) => SOURCE_LABEL[s] ?? s).join(", ")}
                            {r.manualFields.length > 0 && <Badge tone="warning">Corregido ({r.manualFields.length})</Badge>}
                          </td>
                          <td>{pending ? <Badge tone="danger">{pending} {pending === 1 ? "pendiente" : "pendientes"}</Badge> : <Badge tone="success">Completo</Badge>}</td>
                          <td className="actions" onClick={(e) => e.stopPropagation()}>
                            {d.supplierId === null && r.origin !== "manual" && (
                              <Button variant="ghost" size="sm" iconOnly icon={<UserPlus size={14} />} aria-label="Crear ficha del tercero" title="Crear ficha del tercero" onClick={() => setFicha(r)} />
                            )}
                            <Button variant="ghost" size="sm" iconOnly icon={<Pencil size={14} />} aria-label="Editar registro" onClick={() => setEditing(r)} />
                            {r.origin === "manual" && <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} aria-label="Eliminar registro manual" onClick={() => setDeleting(r)} />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <RecordEditor open={!!editing} record={editing} format="1009" catalogs={catalogs} onClose={() => setEditing(null)} onSave={saveRecord} onRestore={async (r) => setRestoring(r)} />
      <SupplierFormModal
        open={!!ficha}
        supplier={ficha ? (m.suppliers?.find((s) => s.nit === str(ficha.data.docNumber)) ?? null) : null}
        draft={ficha ? { nit: str(ficha.data.docNumber), businessName: str(ficha.data.thirdName), origin: "empresas", tax: { personType: ficha.data.personType === "PN" ? "PN" : ficha.data.personType === "PJ" ? "PJ" : "", docTypeCode: str(ficha.data.docTypeCode), dv: str(ficha.data.dv) } } : undefined}
        rates={rates}
        onClose={() => setFicha(null)}
        onSaved={() => {
          setFicha(null);
          void m.loadSuppliers();
          toast("Ficha guardada. Actualiza desde Estados Financieros para traer sus datos.");
        }}
      />
      <ConfirmDialog
        open={!!restoring}
        title="Volver a los valores de origen"
        confirmLabel="Reemplazar mis correcciones"
        message="Se descartarán las correcciones manuales de este registro y se usarán los datos actuales de Estados Financieros y de la ficha del tercero."
        onCancel={() => setRestoring(null)}
        onConfirm={() => {
          const key = restoring!.sourceKey;
          setRestoring(null);
          setEditing(null);
          void sync([key]);
        }}
      />
      <ConfirmDialog open={!!deleting} danger title="Eliminar registro manual" confirmLabel="Eliminar" message="Se eliminará este registro manual del 1009." onCancel={() => setDeleting(null)} onConfirm={() => deleting && void removeManual(deleting)} />
      <ConfirmDialog
        open={!!conflicts}
        title="Correcciones manuales distintas al origen"
        confirmLabel="Reemplazar con el origen"
        message={
          <>
            Estos registros tienen campos corregidos a mano que difieren de Estados Financieros / la ficha del tercero. Se conservaron tus correcciones.
            <ul>
              {(conflicts ?? []).map((c) => (
                <li key={c.sourceKey}>
                  {c.sourceKey}: {c.fields.join(", ")}
                </li>
              ))}
            </ul>
            ¿Quieres reemplazarlas?
          </>
        }
        onCancel={() => setConflicts(null)}
        onConfirm={() => {
          const keys = (conflicts ?? []).map((c) => c.sourceKey);
          setConflicts(null);
          void sync(keys);
        }}
      />
      <Modal open={!!report} size="md" title="Sincronización con Estados Financieros" onClose={() => setReport(null)} footer={<Button variant="primary" onClick={() => setReport(null)}>Entendido</Button>}>
        {report && (
          <div className="stack">
            <span>
              {report.outcome.created} nuevos · {report.outcome.updated} actualizados · {report.outcome.unchanged} sin cambios · {report.outcome.removed} retirados.
            </span>
            <div>
              <strong>Fuentes leídas</strong>
              <ul>
                {report.sources.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <span className="muted">Solo lectura: Estados Financieros no se modificó.</span>
            </div>
            {report.needData.length > 0 && (
              <Alert tone="warning" title="Terceros sin ficha">
                Estos terceros necesitan datos (crea su ficha en Proveedores): {report.needData.join(", ")}.
              </Alert>
            )}
            {report.outcome.keptManualOrphans.length > 0 && <Alert tone="info">Se conservaron registros con correcciones manuales que la fuente ya no propone: {report.outcome.keptManualOrphans.join(", ")}.</Alert>}
          </div>
        )}
      </Modal>
    </>
  );
}

