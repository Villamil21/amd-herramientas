import { Building2, Pencil, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { navigate, paths } from "../../../app/router";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Loader, PageHeader, useToast } from "../../../components/ui";
import { exogenaService } from "../../../services/exogenaService";
import { errorMessage } from "../../../services/tauri";
import type { ExoRecord, RecordData, SyncOutcome } from "../../../types/exogena";
import { ExogenaContextBar } from "../components/ExogenaContextBar";
import { ProblemsPanel } from "../components/ProblemsPanel";
import { RecordEditor } from "../components/RecordEditor";
import { StatusPanel } from "../components/StatusPanel";
import { FORMAT_1010 } from "../domain/form1010";
import { formatPesosPlain } from "../domain/numbers";
import { blocking } from "../domain/problems";
import { use1010 } from "../use1010";
import { useExogenaSelection } from "../state";

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const percentLabel = (d: RecordData) => (typeof d.percentage === "number" ? `${d.percentage.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %` : "—");

/**
 * Formato 1010 — Socios, accionistas y similares. La base es la información de socios de Empresas (fuente de verdad):
 * «Actualizar desde Empresas» trae los cambios y los campos se pueden corregir aquí conservando su origen.
 */
export default function Format1010Page() {
  const toast = useToast();
  const [selection] = useExogenaSelection();
  const { companies, company, catalogs, index, format, model } = use1010(selection.companyId, selection.year);
  const { records, status, reload, setStatus } = format;
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<ExoRecord | null>(null);
  const [conflicts, setConflicts] = useState<SyncOutcome["conflicts"] | null>(null);
  const [restoring, setRestoring] = useState<ExoRecord | null>(null);
  const proposals = model?.proposals ?? [];
  const changes = model?.changes ?? [];
  const problems = model?.problems ?? [];

  // Un 1010 «listo» deja de estarlo cuando sus datos o su origen cambian: se reabre, nunca se reescribe en silencio.
  useEffect(() => {
    if (status.status === "listo" && model && blocking(model.problems).length > 0) void setStatus("requiere_actualizacion");
  }, [status.status, model, setStatus]);

  async function sync(overwrite: string[] = []) {
    if (!company) return;
    setSyncing(true);
    try {
      const overview = await exogenaService.overview(company.id, selection.year);
      const outcome = await exogenaService.applySync({
        companyId: company.id,
        year: selection.year,
        formatCode: FORMAT_1010,
        source: "Empresas",
        proposals,
        removeMissing: true,
        sourceFingerprint: overview.sourceFingerprint,
        overwriteManual: overwrite,
        summary: { shareholders: proposals.length },
      });
      const parts = [outcome.created && `${outcome.created} nuevos`, outcome.updated && `${outcome.updated} actualizados`, outcome.removed && `${outcome.removed} retirados`].filter(Boolean);
      toast(parts.length ? `Actualizado desde Empresas: ${parts.join(", ")}.` : "Sin cambios: el formato ya coincide con Empresas.");
      if (outcome.conflicts.length && overwrite.length === 0) setConflicts(outcome.conflicts);
      await reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSyncing(false);
    }
  }

  async function saveEdit(record: ExoRecord, patch: RecordData) {
    await exogenaService.updateRecord(record.id, patch);
    toast("Corrección guardada.");
    setEditing(null);
    await reload();
  }

  const problemCount = (key: string) => problems.filter((p) => p.recordKey === key).length;
  const empty = records !== null && records.length === 0;

  return (
    <>
      <PageHeader
        eyebrow={`Información Exógena · ${selection.year}`}
        title="1010 · Socios, accionistas y similares"
        description="Socios o accionistas con su participación y el capital suscrito asignado a 31 de diciembre. La información de origen está en Empresas."
        actions={
          <>
            <Button icon={<Building2 size={15} />} onClick={() => navigate(paths.companies)}>
              Ir a Empresas
            </Button>
            <Button variant="primary" icon={<RefreshCcw size={15} />} loading={syncing} disabled={!company} onClick={() => void sync()}>
              Actualizar desde Empresas
            </Button>
          </>
        }
      />
      <ExogenaContextBar companies={companies} />
      {!company ? (
        <Card>
          <EmptyState icon={<Building2 size={20} />} title="Selecciona una empresa" description="Elige la empresa y el año a informar para preparar el formato 1010." />
        </Card>
      ) : records === null || !index ? (
        <Loader />
      ) : (
        <>
          <StatusPanel row={status} problems={problems} onSetStatus={setStatus} />
          {changes.length > 0 && (
            <Alert tone="warning" title="Hay cambios en Empresas sin actualizar">
              {changes.map((c) => `${c.kind === "new" ? "Nuevo socio" : c.kind === "removed" ? "Socio retirado" : "Cambió"}: ${c.sourceKey.replace("shareholder:", "socio ")}${c.fields.length ? ` (${c.fields.join(", ")})` : ""}`).join(" · ")}
            </Alert>
          )}
          <ProblemsPanel problems={problems} okText="Sin pendientes: el 1010 se puede marcar como listo." />
          <Card flush title={`Registros (${records.length})`} description="Una fila por socio. El conteo no incluye encabezados ni filas decorativas.">
            {empty ? (
              <EmptyState icon={<Building2 size={20} />} title="Aún no hay socios en este formato" description="Usa «Actualizar desde Empresas» para traer los socios registrados, o marca el formato como «No aplica» si la empresa no tiene socios que reportar." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Socio</th>
                      <th>Documento</th>
                      <th className="num">Participación</th>
                      <th className="num">Valor nominal</th>
                      <th>Ubicación</th>
                      <th>Origen</th>
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => {
                      const d = r.data;
                      const pending = problemCount(r.sourceKey);
                      const dept = index.department(str(d.deptCode));
                      const muni = index.municipality(str(d.deptCode), str(d.muniCode));
                      return (
                        <tr key={r.id} className="is-clickable" onClick={() => setEditing(r)}>
                          <td className="table__primary">
                            {str(d.shareholderName)}
                            <div className="muted">{d.personType === "PJ" ? "Persona jurídica" : d.personType === "PN" ? "Persona natural" : "Tipo de persona sin definir"}</div>
                          </td>
                          <td className="selectable">
                            {str(d.docTypeCode) || "—"} · {str(d.docNumber) || "—"}
                            {str(d.dv) ? `-${str(d.dv)}` : ""}
                          </td>
                          <td className="num">{percentLabel(d)}</td>
                          <td className="num">{typeof d.nominalValue === "number" ? formatPesosPlain(d.nominalValue) : <span className="muted">Pendiente</span>}</td>
                          <td>{muni ? `${muni}${dept ? `, ${dept}` : ""}` : <span className="muted">{str(d.countryCode) && str(d.countryCode) !== "169" ? (index.country(str(d.countryCode)) ?? str(d.countryCode)) : "Sin definir"}</span>}</td>
                          <td>
                            <Badge tone={r.manualFields.length ? "warning" : undefined}>{r.manualFields.length ? `Corregido (${r.manualFields.length})` : "Empresas"}</Badge>
                          </td>
                          <td>{pending ? <Badge tone="danger">{pending} {pending === 1 ? "pendiente" : "pendientes"}</Badge> : <Badge tone="success">Completo</Badge>}</td>
                          <td className="actions" onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" iconOnly icon={<Pencil size={14} />} aria-label="Editar registro" onClick={() => setEditing(r)} />
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

      <RecordEditor open={!!editing} record={editing} format="1010" catalogs={catalogs} onClose={() => setEditing(null)} onSave={saveEdit} onRestore={async (r) => setRestoring(r)} />
      <ConfirmDialog
        open={!!restoring}
        title="Volver a los valores de Empresas"
        confirmLabel="Reemplazar mis correcciones"
        message="Se descartarán las correcciones manuales de este socio y se usarán los datos actuales de Empresas."
        onCancel={() => setRestoring(null)}
        onConfirm={() => {
          const key = restoring!.sourceKey;
          setRestoring(null);
          setEditing(null);
          void sync([key]);
        }}
      />
      <ConfirmDialog
        open={!!conflicts}
        title="Correcciones manuales distintas a Empresas"
        confirmLabel="Reemplazar con Empresas"
        message={
          <>
            Estos registros tienen campos corregidos a mano que difieren de Empresas. Se conservaron tus correcciones.
            <ul>
              {(conflicts ?? []).map((c) => (
                <li key={c.sourceKey}>
                  {c.sourceKey.replace("shareholder:", "Socio ")}: {c.fields.join(", ")}
                </li>
              ))}
            </ul>
            ¿Quieres reemplazarlas con los valores de Empresas?
          </>
        }
        onCancel={() => setConflicts(null)}
        onConfirm={() => {
          const keys = (conflicts ?? []).map((c) => c.sourceKey);
          setConflicts(null);
          void sync(keys);
        }}
      />
    </>
  );
}
