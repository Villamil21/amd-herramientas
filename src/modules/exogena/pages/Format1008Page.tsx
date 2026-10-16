import { Building2, ListChecks, Pencil, Plus, RefreshCcw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { navigate, paths } from "../../../app/router";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Input, Loader, Menu, PageHeader, Select, useToast } from "../../../components/ui";
import { exogenaService } from "../../../services/exogenaService";
import { errorMessage } from "../../../services/tauri";
import type { ExoRecord, RecordData, SyncOutcome } from "../../../types/exogena";
import { ConceptsManager } from "../components/ConceptsManager";
import { ExogenaContextBar } from "../components/ExogenaContextBar";
import { ProblemsPanel } from "../components/ProblemsPanel";
import { RecordEditor } from "../components/RecordEditor";
import { StatusPanel } from "../components/StatusPanel";
import { CONCEPT_SOCIOS, DESCRIPTION_SOCIOS, FORMAT_1008, rowOrigin1008 } from "../domain/form1008";
import { formatPesosPlain } from "../domain/numbers";
import { blocking } from "../domain/problems";
import { useExogenaSelection } from "../state";
import { use1008 } from "../use1008";

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
type Filter = "all" | "pending" | "manual";

const nameOf = (d: RecordData) => (str(d.businessName) || [d.firstSurname, d.secondSurname, d.firstName, d.otherNames].map(str).filter(Boolean).join(" ") || str(d.shareholderName) || "—");

/**
 * Formato 1008 — Saldo de cuentas por cobrar al 31 de diciembre. Origen automático: CxC a socios de Empresas (suscrito − pagado)
 * repartida por participación. Los registros se corrigen en un modal compacto; la sincronización propone y nunca borra ajustes manuales.
 */
export default function Format1008Page() {
  const toast = useToast();
  const [selection] = useExogenaSelection();
  const { companies, company, catalogs, index, format, model, concepts, reloadConcepts } = use1008(selection.companyId, selection.year);
  const { records, status, reload, setStatus } = format;
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<ExoRecord | null>(null);
  const [conflicts, setConflicts] = useState<SyncOutcome["conflicts"] | null>(null);
  const [restoring, setRestoring] = useState<ExoRecord | null>(null);
  const [deleting, setDeleting] = useState<ExoRecord | null>(null);
  const [managing, setManaging] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const problems = model?.problems ?? [];
  const changes = model?.changes ?? [];
  const rec = model?.reconciliation;

  // Un 1008 «listo» deja de estarlo cuando sus datos o su origen cambian: se reabre, nunca se reescribe en silencio.
  useEffect(() => {
    if (status.status === "listo" && model && blocking(model.problems).length > 0) void setStatus("requiere_actualizacion");
  }, [status.status, model, setStatus]);

  async function sync(overwrite: string[] = []) {
    if (!company || !model) return;
    setSyncing(true);
    try {
      const overview = await exogenaService.overview(company.id, selection.year);
      const outcome = await exogenaService.applySync({
        companyId: company.id,
        year: selection.year,
        formatCode: FORMAT_1008,
        source: "Empresas",
        proposals: model.proposals,
        removeMissing: true,
        sourceFingerprint: overview.sourceFingerprint,
        overwriteManual: overwrite,
        summary: { shareholders: model.proposals.length, cxcSocios: rec?.companyReceivable ?? 0 },
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
    toast("Registro guardado.");
    setEditing(null);
    await reload();
  }

  async function addManual() {
    if (!company) return;
    try {
      const created = await exogenaService.createRecord(company.id, selection.year, FORMAT_1008, { concept: "", conceptDescription: "", personType: null, docTypeCode: "", docNumber: "", dv: "", firstSurname: "", secondSurname: "", firstName: "", otherNames: "", businessName: "", address: "", deptCode: "", muniCode: "", countryCode: "169", balance: 0, shareholderName: "" });
      await reload();
      setEditing(created);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await exogenaService.deleteRecord(deleting.id);
      toast("Registro eliminado.");
      setDeleting(null);
      await reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const problemCount = (key: string) => problems.filter((p) => p.recordKey === key).length;
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (records ?? []).filter((r) => {
      if (filter === "pending" && problemCount(r.sourceKey) === 0) return false;
      if (filter === "manual" && r.origin !== "manual" && r.manualFields.length === 0) return false;
      if (!q) return true;
      const d = r.data;
      return [nameOf(d), str(d.docNumber), str(d.concept), str(d.address)].some((t) => t.toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, search, filter, problems]);
  const empty = records !== null && records.length === 0;
  const conceptItems = (concepts ?? []).map((c) => ({ code: c.code, description: c.description, isActive: c.isActive }));
  const money = (n: number | null) => (n === null ? "—" : `$ ${formatPesosPlain(n)}`);

  return (
    <>
      <PageHeader
        eyebrow={`Información Exógena · ${selection.year}`}
        title="1008 · Saldo de cuentas por cobrar al 31 de diciembre"
        description="Cuentas por cobrar a socios (capital suscrito − pagado) repartidas por participación. El origen está en Empresas; cada fila se puede ajustar."
        actions={
          <>
            <Button icon={<ListChecks size={15} />} onClick={() => setManaging(true)}>
              Administrar conceptos
            </Button>
            <Button icon={<Plus size={15} />} disabled={!company} onClick={() => void addManual()}>
              Agregar registro
            </Button>
            <Button variant="primary" icon={<RefreshCcw size={15} />} loading={syncing} disabled={!company || !model} onClick={() => void sync()}>
              Actualizar desde Empresas
            </Button>
          </>
        }
      />
      <ExogenaContextBar companies={companies} />
      {!company ? (
        <Card>
          <EmptyState icon={<Building2 size={20} />} title="Selecciona una empresa" description="Elige la empresa y el año a informar para preparar el formato 1008." />
        </Card>
      ) : records === null || !index || !model ? (
        <Loader />
      ) : (
        <>
          <Card title={company.razonSocial} description={`NIT ${company.nit}${company.dv ? `-${company.dv}` : ""}`}>
            <div className="stat-row">
              <div className="stat">Año gravable<strong>{selection.year}</strong></div>
              <div className="stat">Corte<strong>31/12/{selection.year}</strong></div>
              <div className="stat">Registros<strong>{records.length}</strong></div>
              <div className="stat">CxC a socios en Empresas<strong>{money(rec!.companyReceivable)}</strong></div>
              <div className="stat">Total 1008 (concepto {CONCEPT_SOCIOS})<strong>{money(rec!.total)}</strong></div>
              <div className="stat">Diferencia<strong>{rec!.difference === 0 ? <Badge tone="success">Conciliado</Badge> : <Badge tone="danger">{money(rec!.difference)}</Badge>}</strong></div>
            </div>
          </Card>
          <StatusPanel row={status} problems={problems} onSetStatus={setStatus} />
          {changes.length > 0 && (
            <Alert tone="warning" title="Hay cambios en Empresas sin actualizar">
              La CxC a socios o los socios cambiaron desde la última sincronización ({changes.length} {changes.length === 1 ? "registro" : "registros"}). Usa «Actualizar desde Empresas»; tus ajustes manuales no se pierden.
            </Alert>
          )}
          <ProblemsPanel problems={problems} okText="Sin pendientes: el 1008 se puede marcar como listo." />
          <Card
            flush
            title={`Registros (${visible.length}${visible.length !== records.length ? ` de ${records.length}` : ""})`}
            description="Una fila por deudor. El conteo no incluye encabezados."
            actions={
              <div className="row" style={{ gap: 8 }}>
                <div className="search">
                  <Search size={14} />
                  <Input placeholder="Buscar deudor, documento o concepto" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Select aria-label="Filtrar registros" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                  <option value="all">Todos</option>
                  <option value="pending">Con datos faltantes</option>
                  <option value="manual">Manuales o modificados</option>
                </Select>
              </div>
            }
          >
            {empty ? (
              <EmptyState icon={<Building2 size={20} />} title="Aún no hay registros en este formato" description={rec!.companyReceivable && rec!.companyReceivable > 0 ? "Usa «Actualizar desde Empresas» para traer la CxC a socios, o agrega registros manuales." : "La empresa no tiene CxC a socios (suscrito − pagado). Agrega registros manuales o marca el formato como «No aplica» con su motivo."} />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Concepto</th>
                      <th>Documento</th>
                      <th>Deudor</th>
                      <th>Dirección</th>
                      <th>Ubicación</th>
                      <th className="num">Saldo al 31-12</th>
                      <th>Origen</th>
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => {
                      const d = r.data;
                      const pending = problemCount(r.sourceKey);
                      const muni = index.municipality(str(d.deptCode), str(d.muniCode));
                      const origin = rowOrigin1008(r);
                      const known = concepts?.find((c) => c.code === str(d.concept));
                      return (
                        <tr key={r.id} className="is-clickable" onClick={() => setEditing(r)}>
                          <td title={known?.description ?? str(d.conceptDescription)}>
                            <strong>{str(d.concept) || "—"}</strong>
                            {r.origin !== "manual" && str(d.concept) === CONCEPT_SOCIOS && <div className="muted">Sugerido</div>}
                          </td>
                          <td className="selectable">
                            {str(d.docTypeCode) || "—"} · {str(d.docNumber) || "—"}
                            {str(d.dv) ? `-${str(d.dv)}` : ""}
                          </td>
                          <td className="table__primary">
                            {nameOf(d)}
                            <div className="muted">{d.personType === "PJ" ? "Persona jurídica" : d.personType === "PN" ? "Persona natural" : "Tipo sin definir"}</div>
                          </td>
                          <td>{str(d.address) || <span className="muted">—</span>}</td>
                          <td>{muni ?? (str(d.countryCode) && str(d.countryCode) !== "169" ? (index.country(str(d.countryCode)) ?? str(d.countryCode)) : <span className="muted">Sin definir</span>)}</td>
                          <td className="num">{typeof d.balance === "number" ? formatPesosPlain(d.balance) : <span className="muted">—</span>}</td>
                          <td>
                            <Badge tone={origin === "Calculado desde capital" ? undefined : "warning"}>{origin}</Badge>
                          </td>
                          <td>{pending ? <Badge tone="danger">{pending} {pending === 1 ? "pendiente" : "pendientes"}</Badge> : <Badge tone="success">Completo</Badge>}</td>
                          <td className="actions" onClick={(e) => e.stopPropagation()}>
                            <Menu
                              label={`Acciones del registro ${nameOf(d)}`}
                              items={[
                                { label: "Editar", icon: <Pencil size={14} />, onSelect: () => setEditing(r) },
                                ...(r.origin === "manual" ? [{ label: "Eliminar", icon: <Trash2 size={14} />, danger: true, onSelect: () => setDeleting(r) }] : []),
                              ]}
                            />
                          </td>
                        </tr>
                      );
                    })}
                    {visible.length === 0 && (
                      <tr>
                        <td colSpan={9} className="muted">
                          Ningún registro coincide con la búsqueda o el filtro.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <div className="row">
            <Button variant="ghost" size="sm" onClick={() => navigate(paths.companies)}>
              Ir a Empresas
            </Button>
          </div>
        </>
      )}

      <RecordEditor
        open={!!editing}
        record={editing}
        format="1008"
        catalogs={catalogs}
        concepts={conceptItems}
        conceptOrigin={editing && editing.origin !== "manual" && str(editing.data.concept) === CONCEPT_SOCIOS ? `Sugerido por el cálculo (${DESCRIPTION_SOCIOS.slice(0, 40)}…). Puedes cambiarlo.` : undefined}
        onCreateConcept={async (code, description) => {
          await exogenaService.saveFormatConcept({ formatCode: FORMAT_1008, code, description, isActive: true });
          await reloadConcepts();
        }}
        onClose={() => setEditing(null)}
        onSave={saveEdit}
        onRestore={async (r) => setRestoring(r)}
      />
      <ConceptsManager open={managing} formatCode={FORMAT_1008} concepts={concepts ?? []} onClose={() => setManaging(false)} onChanged={() => void reloadConcepts()} />
      <ConfirmDialog
        open={!!restoring}
        title="Volver a los valores calculados"
        confirmLabel="Reemplazar mis ajustes"
        message="Se descartarán los ajustes manuales de este registro y se usará el cálculo actual desde Empresas."
        onCancel={() => setRestoring(null)}
        onConfirm={() => {
          const key = restoring!.sourceKey;
          setRestoring(null);
          setEditing(null);
          void sync([key]);
        }}
      />
      <ConfirmDialog open={!!deleting} danger title="Eliminar registro" confirmLabel="Eliminar" message="Se elimina este registro manual del formato 1008." onCancel={() => setDeleting(null)} onConfirm={() => void confirmDelete()} />
      <ConfirmDialog
        open={!!conflicts}
        title="Ajustes manuales distintos al cálculo"
        confirmLabel="Reemplazar con el cálculo"
        message={
          <>
            Estos registros tienen campos ajustados a mano que difieren del cálculo desde Empresas. Se conservaron tus ajustes.
            <ul>
              {(conflicts ?? []).map((c) => (
                <li key={c.sourceKey}>
                  {c.sourceKey}: {c.fields.join(", ")}
                </li>
              ))}
            </ul>
            ¿Quieres reemplazarlos con el cálculo?
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
