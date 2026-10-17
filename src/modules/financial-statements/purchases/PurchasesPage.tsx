import { useEffect, useMemo, useRef, useState } from "react";
import { FolderSearch, ShoppingBag } from "lucide-react";
import { Alert, Button, Card, ConfirmDialog, ContextBar, EmptyState, Field, Input, Loader, MetricBar, PageHeader, Select, Tabs, useToast } from "../../../components/ui";
import { navigate, paths } from "../../../app/router";
import { purchasesService } from "../../../services/purchasesService";
import { errorMessage } from "../../../services/tauri";
import { formatInteger, formatMoneyCents } from "../../../utils/format";
import { findCompanyByNit } from "../shared/companyMatch";
import { panelVisible } from "./domain/pending";
import { getPendingReturn, setPendingReturn, takePendingReturn } from "./pendingReturn";
import { DEST_LABEL, stopsDest, type Alert as AlertItem, type Dest } from "./domain/status";
import { monthName, type DocView, type PurchasesModel, type SupplierView } from "./domain/model";
import { pickInvoiceFolder, readFolder } from "./import";
import { usePurchasesData, type PurchasesData } from "./usePurchasesData";
import { useExoPurchasesGuard } from "./useExoPurchasesGuard";
import { AlertsPanel } from "./ui/AlertsPanel";
import { DocDetailModal } from "./ui/DocDetailModal";
import { ImportModal, type PendingImport } from "./ui/ImportModal";
import { PendingPanel, type PanelMemo } from "./ui/PendingPanel";
import { TitleClassifyModal } from "./ui/TitleClassifyModal";
import { StatusChip, StatusStrip } from "./ui/StatusStrip";
import { SupplierEditorModal } from "./ui/SupplierEditorModal";

type TabId = "summary" | "docs" | "suppliers" | "uploads" | "rules" | "results";
type DocFilter = "all" | "purchase" | "return" | "pending" | "blocked" | "evidence" | "excluded";

const FILTER_LABEL: Record<DocFilter, string> = { all: "Todas", purchase: "Compras", return: "Devoluciones", pending: "Por confirmar", blocked: "Con bloqueos", evidence: "Duplicadas", excluded: "Excluidas" };

const scopeKey = (nit: string, year: number | null) => `${nit}|${year ?? ""}`;

/**
 * Estados Financieros → Compras, costos y exógena. Importa carpetas de facturas y notas crédito electrónicas (la empresa sale del
 * NIT del adquiriente y el año de la fecha de expedición), clasifica cada línea (PUC, concepto 1001, retención) y de ahí salen,
 * sin guardar resultados, Estados Financieros y los formatos 1001, 1005 y 1006.
 */
export default function PurchasesPage() {
  const toast = useToast();
  const data = usePurchasesData();
  const { model, selection, scopes, fs } = data;
  useExoPurchasesGuard(data.company?.id ?? null, model);
  const [tab, setTab] = useState<TabId>("summary");
  const [picking, setPicking] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [detail, setDetail] = useState<{ docId: number; line: number | null } | null>(null);
  const [supplierNit, setSupplierNit] = useState<string | null>(null);
  const [panelDest, setPanelDest] = useState<Dest | null>(null);
  const [titleAsk, setTitleAsk] = useState<{ titleKey: string; title: string } | null>(null);
  const panelMemo = useRef<PanelMemo>({ expanded: [], scroll: 0 });
  const [filter, setFilter] = useState<DocFilter>("all");
  const [search, setSearch] = useState("");
  const cancelled = useRef(false);

  // Regreso desde otro módulo (franja «Volver a pendientes»): reabre el panel en el mismo destino y posición.
  useEffect(() => {
    const ctx = getPendingReturn();
    if (!ctx) return;
    takePendingReturn();
    if (!ctx.returning) return;
    panelMemo.current = { expanded: ctx.expanded, scroll: ctx.scroll };
    setPanelDest(ctx.dest);
  }, []);

  const detailView = useMemo(() => model?.docs.find((d) => d.doc.id === detail?.docId) ?? null, [model, detail]);
  const supplierView = useMemo(() => model?.suppliers.find((s) => s.nit === supplierNit) ?? null, [model, supplierNit]);

  async function pick() {
    setPicking(true);
    cancelled.current = false;
    try {
      const folder = await pickInvoiceFolder();
      if (!folder) return;
      if (folder.files.length === 0) return toast("La carpeta no tiene archivos PDF.", "error");
      setProgress({ done: 0, total: folder.files.length });
      const results = await readFolder(folder.files.map((f) => f.name), (done, total) => setProgress({ done, total }), () => cancelled.current);
      setPending({ folder, results });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPicking(false);
      setProgress(null);
    }
  }

  /**
   * Abre el dato que causa la alerta. `fromPanel`: el panel se oculta mientras se edita y reaparece al cerrar el editor (no se
   * cambia de pestaña); si el dato vive en otro módulo, se guarda la ruta de regreso al panel.
   */
  function resolve(alert: AlertItem, fromPanel = false) {
    const t = alert.target;
    const leave = (extra: { openCompanyNit?: string; companyTab?: "fiscal" } = {}) => {
      if (fromPanel && panelDest && model) {
        setPendingReturn({ dest: panelDest, buyerNit: model.buyerNit, year: model.year, companyName: data.company?.razonSocial ?? `NIT ${model.buyerNit}`, scroll: panelMemo.current.scroll, expanded: panelMemo.current.expanded, ...extra });
        setPanelDest(null);
      }
    };
    if (t.kind === "document") setDetail({ docId: t.docId, line: null });
    else if (t.kind === "line") setDetail({ docId: t.docId, line: t.lineIndex });
    else if (t.kind === "supplier") {
      if (!fromPanel) setTab("suppliers");
      setSupplierNit(t.nit);
    } else if (t.kind === "company") {
      leave({ openCompanyNit: t.nit, companyTab: "fiscal" });
      navigate(paths.companies);
    } else if (t.kind === "title") {
      if (fromPanel) setTitleAsk({ titleKey: t.titleKey, title: t.title });
      else setTab("docs");
    } else if (t.kind === "concept") {
      leave();
      navigate(paths.exogenaCatalogs);
    } else if (t.kind === "upload") setTab("uploads");
  }

  const openPanel = (d: Dest) => {
    panelMemo.current = { expanded: [], scroll: 0 };
    setPanelDest(d);
  };

  const scopeOptions = (scopes ?? []).map((s) => ({ key: scopeKey(s.buyerNit, s.year), s, label: `${(fs.companies && findCompanyByNit(fs.companies, s.buyerNit)?.razonSocial) || `NIT ${s.buyerNit}`} · ${s.year ?? "Sin fecha"} (${s.current} ${s.current === 1 ? "factura" : "facturas"})` }));
  const current = scopeKey(selection.buyerNit ?? "", selection.year);
  const hasScope = scopeOptions.some((o) => o.key === current);

  return (
    <>
      <PageHeader
        eyebrow="Estados Financieros"
        title="Compras, costos y exógena"
        description="Importa carpetas de facturas y notas crédito electrónicas, clasifica cada línea y prepara Estados Financieros y los formatos 1001, 1005 y 1006 de Exógena."
        actions={
          <Button variant="primary" icon={<FolderSearch size={15} />} loading={picking} onClick={() => void pick()}>
            {progress ? `Leyendo ${progress.done}/${progress.total}…` : "Importar carpeta"}
          </Button>
        }
      />
      <ContextBar items={[{ label: "Empresa", value: data.company?.razonSocial ?? (selection.buyerNit ? `NIT ${selection.buyerNit}` : "—") }, { label: "Año", value: selection.year === null ? "Sin fecha" : String(selection.year) }]}>
        <div className="bank-head__fields">
          <Field label="Empresa y año" hint="Las cargas se ubican solas por el NIT del adquiriente y la fecha de expedición">
            {(id) => (
              <Select
                id={id}
                value={hasScope ? current : ""}
                disabled={scopeOptions.length === 0}
                onChange={(e) => {
                  const o = scopeOptions.find((x) => x.key === e.target.value);
                  if (o) data.select({ buyerNit: o.s.buyerNit, year: o.s.year });
                }}
              >
                {!hasScope && <option value="">{scopeOptions.length ? "Selecciona…" : "Sin cargas todavía"}</option>}
                {scopeOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </ContextBar>

      {scopes !== null && scopes.length === 0 ? (
        <Card>
          <EmptyState icon={<ShoppingBag size={20} />} title="Aún no hay compras importadas" description="Importa una carpeta con facturas y notas crédito electrónicas en PDF. No hace falta indicar la empresa ni el año: salen de las propias facturas." />
        </Card>
      ) : !selection.buyerNit || !hasScope ? (
        <Card>
          <EmptyState icon={<ShoppingBag size={20} />} title="Selecciona una empresa y un año" description="Elige arriba una de las cargas ya importadas." />
        </Card>
      ) : !model ? (
        <Loader />
      ) : (
        <Body data={data} model={model} tab={tab} setTab={setTab} onSelectDest={openPanel} filter={filter} setFilter={setFilter} search={search} setSearch={setSearch} onResolve={resolve} onOpen={(docId) => setDetail({ docId, line: null })} onSupplier={setSupplierNit} />
      )}

      <ImportModal data={data} pending={pending} onClose={() => setPending(null)} />
      <DocDetailModal data={data} view={detailView} focusLine={detail?.line} onClose={() => setDetail(null)} />
      <SupplierEditorModal data={data} supplier={supplierView} onClose={() => setSupplierNit(null)} />
      {titleAsk && <TitleClassifyModal data={data} titleKey={titleAsk.titleKey} title={titleAsk.title} onClose={() => setTitleAsk(null)} />}
      {model && panelDest && panelVisible({ panelDest, editing: detail !== null || supplierNit !== null || titleAsk !== null }) && (
        <PendingPanel model={model} dest={panelDest} companyName={data.company?.razonSocial ?? `NIT ${model.buyerNit}`} memo={panelMemo} onClose={() => setPanelDest(null)} onResolve={(a) => resolve(a, true)} />
      )}
    </>
  );
}

function Body({ data, model, tab, setTab, onSelectDest, filter, setFilter, search, setSearch, onResolve, onOpen, onSupplier }: {
  data: PurchasesData;
  model: PurchasesModel;
  tab: TabId;
  setTab: (t: TabId) => void;
  onSelectDest: (d: Dest) => void;
  filter: DocFilter;
  setFilter: (f: DocFilter) => void;
  search: string;
  setSearch: (s: string) => void;
  onResolve: (a: AlertItem) => void;
  onOpen: (docId: number) => void;
  onSupplier: (nit: string) => void;
}) {
  const t = model.totals;
  const blocking = model.alerts.filter((a) => (a.severity === "block" || a.severity === "pending") && a.dests.length).length;
  return (
    <>
      <StatusStrip counts={model.counts} status={model.status} notApplicable={model.notApplicable} onSelect={onSelectDest} />
      <MetricBar
        label="Resumen de compras"
        metrics={[
          { key: "docs", label: t.documents === 1 ? "factura vigente" : "facturas vigentes", value: formatInteger(t.documents) },
          { key: "lines", label: "líneas", value: formatInteger(t.lines) },
          { key: "pending", label: t.pendingLines === 1 ? "línea por confirmar" : "líneas por confirmar", value: formatInteger(t.pendingLines), tone: t.pendingLines ? "attention" : undefined },
          { key: "purchases", label: "compras (base)", value: formatMoneyCents(t.purchaseCents) },
          { key: "returns", label: "devoluciones (base)", value: formatMoneyCents(t.returnCents) },
          { key: "vat", label: "IVA neto", value: formatMoneyCents(t.purchaseVatCents - t.returnVatCents) },
        ]}
      />
      <SyncNotice data={data} model={model} />
      {model.company === undefined && model.docs.length > 0 && (
        <Alert tone="warning" title="Empresa no registrada">
          El NIT {model.buyerNit} no está en Empresas: las facturas se conservan, pero no se envían a Estados Financieros ni a Exógena.
        </Alert>
      )}
      <Tabs
        label="Compras, costos y exógena"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "summary", label: "Resumen", badge: blocking || undefined },
          { id: "docs", label: "Facturas", badge: model.docs.length },
          { id: "suppliers", label: "Proveedores", badge: model.suppliers.filter((s) => s.third.missing.length).length || undefined },
          { id: "uploads", label: "Cargas", badge: data.state?.uploads.length },
          { id: "rules", label: "Reglas" },
          { id: "results", label: "Resultados" },
        ]}
      />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "summary" && (
          <div className="stack">
            <CoverageCard model={model} />
            <AlertsPanel alerts={model.alerts} onResolve={onResolve} />
            {model.alerts.length === 0 && <Alert tone="success">Sin pendientes para esta empresa y año.</Alert>}
          </div>
        )}
        {tab === "docs" && <DocsTab model={model} filter={filter} setFilter={setFilter} search={search} setSearch={setSearch} onOpen={onOpen} />}
        {tab === "suppliers" && <SuppliersTab model={model} onEdit={onSupplier} />}
        {tab === "uploads" && <UploadsTab data={data} model={model} onOpen={onOpen} />}
        {tab === "rules" && <RulesTab data={data} model={model} />}
        {tab === "results" && <ResultsTab model={model} />}
      </div>
    </>
  );
}

function SyncNotice({ data, model }: { data: PurchasesData; model: PurchasesModel }) {
  const { sync } = data;
  if (!data.company || model.year === null) return null;
  if (sync.error)
    return (
      <Alert tone="danger" title="Estados Financieros no se actualizó">
        {sync.error} El último envío puede estar desactualizado.{" "}
        <Button size="sm" onClick={sync.retry}>
          Reintentar
        </Button>
      </Alert>
    );
  if (sync.state === "empty")
    return (
      <Alert tone="warning" title="Estados Financieros conserva un envío anterior">
        Ya no queda ninguna factura lista para enviar, pero el lote anterior sigue vigente en Estados Financieros. Resuelve los pendientes para reemplazarlo.
      </Alert>
    );
  if (model.eeff.pendingDocs > 0)
    return (
      <Alert tone="info">
        {model.eeff.readyDocs} {model.eeff.readyDocs === 1 ? "factura está" : "facturas están"} en Estados Financieros; {model.eeff.pendingDocs} no {model.eeff.pendingDocs === 1 ? "puede" : "pueden"} enviarse todavía (meses: {model.eeff.pendingMonths.join(", ")}).
      </Alert>
    );
  return null;
}

function CoverageCard({ model }: { model: PurchasesModel }) {
  return (
    <Card title="Cobertura mensual" description="Por fecha de expedición. Los meses sin facturas no se asumen vacíos: confírmalo en Estados Financieros.">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Mes</th>
              <th className="num">Compras</th>
              <th className="num">Devoluciones</th>
              <th className="num">Base compras</th>
              <th className="num">Base devoluciones</th>
              <th className="num">Por confirmar</th>
              <th className="num">Con bloqueos</th>
              <th className="num">Duplicadas</th>
            </tr>
          </thead>
          <tbody>
            {model.coverage.map((c) => (
              <tr key={c.month}>
                <td>{monthName(c.month)}</td>
                <td className="num">{c.purchases || "—"}</td>
                <td className="num">{c.returns || "—"}</td>
                <td className="num">{c.purchaseCents ? formatMoneyCents(c.purchaseCents) : "—"}</td>
                <td className="num">{c.returnCents ? formatMoneyCents(c.returnCents) : "—"}</td>
                <td className="num">{c.pending || "—"}</td>
                <td className="num">{c.blocked || "—"}</td>
                <td className="num">{c.duplicates || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function docFlags(d: DocView) {
  const blocked = d.alerts.some((a) => a.severity === "block");
  const pending = d.alerts.some((a) => a.severity === "pending");
  return { blocked, pending };
}

function DocsTab({ model, filter, setFilter, search, setSearch, onOpen }: { model: PurchasesModel; filter: DocFilter; setFilter: (f: DocFilter) => void; search: string; setSearch: (s: string) => void; onOpen: (id: number) => void }) {
  const q = search.trim().toLowerCase();
  const rows = model.docs.filter((d) => {
    const f = docFlags(d);
    if (filter === "purchase" && !(d.counts && d.kind === "purchase")) return false;
    if (filter === "return" && !(d.counts && d.kind === "return")) return false;
    if (filter === "pending" && !f.pending) return false;
    if (filter === "blocked" && !f.blocked) return false;
    if (filter === "evidence" && d.doc.status !== "evidence") return false;
    if (filter === "excluded" && !d.excluded) return false;
    return !q || `${d.doc.issuerName} ${d.doc.issuerNit} ${d.data.number ?? ""} ${d.doc.fileName}`.toLowerCase().includes(q);
  });
  return (
    <Card
      title="Facturas y notas crédito"
      actions={
        <div className="row" style={{ gap: 8 }}>
          <Select aria-label="Filtro" value={filter} onChange={(e) => setFilter(e.target.value as DocFilter)}>
            {(Object.keys(FILTER_LABEL) as DocFilter[]).map((k) => (
              <option key={k} value={k}>
                {FILTER_LABEL[k]}
              </option>
            ))}
          </Select>
          <Input aria-label="Buscar" placeholder="Proveedor, NIT o número" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      }
      flush
    >
      <div className="table-wrap table-wrap--scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Número</th>
              <th>Proveedor</th>
              <th className="num">Base</th>
              <th className="num">IVA</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const f = docFlags(d);
              const status = d.doc.status === "evidence" ? "review" : d.excluded ? "na" : f.blocked ? "block" : f.pending ? "pending" : "ready";
              const text = d.doc.status === "evidence" ? "Duplicada (evidencia)" : d.doc.status === "superseded" ? "Sustituida" : d.excluded ? "Excluida" : f.blocked ? `Bloquea · ${d.alerts.filter((a) => a.severity === "block").length}` : f.pending ? `Por confirmar · ${d.alerts.filter((a) => a.severity === "pending").length}` : "Lista";
              return (
                <tr key={d.doc.id} className="is-clickable" onClick={() => onOpen(d.doc.id)}>
                  <td>{d.doc.issueDate ?? "—"}</td>
                  <td>{d.kind === "return" ? "Devolución" : d.kind === "purchase" ? "Compra" : d.data.title}</td>
                  <td>{d.data.number ?? d.doc.fileName}</td>
                  <td>{d.doc.issuerName}</td>
                  <td className="num">{formatMoneyCents(d.baseCents)}</td>
                  <td className="num">{formatMoneyCents(d.vatCents)}</td>
                  <td>
                    <StatusChip status={status} label={text} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7}>No hay facturas con este filtro.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SuppliersTab({ model, onEdit }: { model: PurchasesModel; onEdit: (nit: string) => void }) {
  return (
    <Card title="Proveedores de esta empresa y año" description="Los datos de tercero que exigen 1001, 1005 y 1006 se completan aquí y se guardan en Proveedores." flush>
      <div className="table-wrap table-wrap--scroll">
        <table className="table">
          <thead>
            <tr>
              <th>NIT</th>
              <th>Proveedor</th>
              <th className="num">Facturas</th>
              <th>Régimen</th>
              <th>Datos de tercero</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {model.suppliers.map((s: SupplierView) => (
              <tr key={s.nit}>
                <td>{s.nit}</td>
                <td>{s.name}</td>
                <td className="num">{s.documents}</td>
                <td>{s.regimeText || "Sin identificar"}</td>
                <td>{s.third.missing.length ? <StatusChip status="block" label={`Bloquea · ${s.third.missing.length}`} /> : <StatusChip status="ready" label="Completos" />}</td>
                <td>
                  <Button size="sm" onClick={() => onEdit(s.nit)}>
                    Editar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function UploadsTab({ data, model, onOpen }: { data: PurchasesData; model: PurchasesModel; onOpen: (id: number) => void }) {
  const toast = useToast();
  const [substitute, setSubstitute] = useState<DocView | null>(null);
  const uploads = data.state?.uploads ?? [];
  const evidence = model.docs.filter((d) => d.doc.status === "evidence");
  async function doSubstitute(d: DocView) {
    try {
      await purchasesService.substitute(d.doc.id);
      await purchasesService.audit(model.buyerNit, model.year, "Factura sustituida", { documentId: d.doc.id, number: d.data.number });
      toast("La versión vigente quedó como evidencia y la nueva ocupa su lugar. Debes clasificar sus líneas de nuevo.");
      await data.reloadAll();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  return (
    <div className="stack">
      <Card title="Cargas" description="Cada importación de una carpeta queda registrada." flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Carpeta</th>
                <th className="num">Archivos</th>
                <th className="num">Facturas</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id}>
                  <td>{u.importedAt.slice(0, 10)}</td>
                  <td>{u.folderName}</td>
                  <td className="num">{u.fileCount}</td>
                  <td className="num">{u.documentCount}</td>
                  <td>
                    {[
                      u.summary.unreadable?.length ? `${u.summary.unreadable.length} ilegibles` : "",
                      u.summary.exceptions?.length ? `${u.summary.exceptions.length} de otro NIT` : "",
                      u.summary.byScope?.map((s) => `${s.year ?? "Sin fecha"}: ${s.count}`).join(" · "),
                    ]
                      .filter(Boolean)
                      .join(" — ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {evidence.length > 0 && (
        <Card title="Facturas duplicadas" description="La versión ya importada sigue vigente; la nueva es evidencia y no afecta resultados salvo que autorices sustituirla." flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Proveedor</th>
                  <th>Diferencias frente a la vigente</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {evidence.map((d) => (
                  <tr key={d.doc.id}>
                    <td>{d.data.number ?? d.doc.fileName}</td>
                    <td>{d.doc.issuerName}</td>
                    <td>{d.differences.length ? d.differences.join("; ") : "Idéntica"}</td>
                    <td>
                      <Button size="sm" onClick={() => onOpen(d.doc.id)}>
                        Ver
                      </Button>{" "}
                      {d.differences.length > 0 && (
                        <Button size="sm" variant="danger" onClick={() => setSubstitute(d)}>
                          Sustituir vigente
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <ConfirmDialog
        open={substitute !== null}
        title="Sustituir la factura vigente"
        message="La versión vigente pasa a evidencia y esta ocupa su lugar. Las clasificaciones de la anterior no se trasladan: tendrás que confirmar las líneas de nuevo. Queda registrado en la auditoría."
        confirmLabel="Sustituir"
        danger
        onCancel={() => setSubstitute(null)}
        onConfirm={() => {
          const d = substitute;
          setSubstitute(null);
          if (d) void doSubstitute(d);
        }}
      />
    </div>
  );
}

function RulesTab({ data, model }: { data: PurchasesData; model: PurchasesModel }) {
  const nits = new Set(model.suppliers.map((s) => s.nit));
  const rules = data.rules.filter((r) => nits.has(r.supplierNit));
  const nameOf = (nit: string) => model.suppliers.find((s) => s.nit === nit)?.name ?? nit;
  return (
    <Card title="Reglas de clasificación" description="Una regla recuerda el PUC, concepto 1001 y retención de un producto de un proveedor. Se edita en Datos → Catálogos Exógena; cambiar una sola factura no la modifica." flush>
      <div className="table-wrap table-wrap--scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Proveedor</th>
              <th>Producto</th>
              <th>PUC</th>
              <th>Concepto 1001</th>
              <th>Retención</th>
              <th className="num">Usos</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{nameOf(r.supplierNit)}</td>
                <td>{r.productLabel}</td>
                <td>{r.pucCode}</td>
                <td>{r.concept1001}</td>
                <td>{r.retention.map((x) => data.rates.find((rt) => rt.id === x.rateId)?.name ?? `#${x.rateId}`).join(", ") || "—"}</td>
                <td className="num">{r.uses}</td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr>
                <td colSpan={6}>Aún no hay reglas: se crean al confirmar una línea con «Guardar como regla».</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ResultsTab({ model }: { model: PurchasesModel }) {
  const byPuc = new Map<string, number>();
  for (const m of model.eeff.movements) byPuc.set(m.pucCode, (byPuc.get(m.pucCode) ?? 0) + m.amountCents);
  const rec = model.reconciliation;
  return (
    <div className="stack">
      <Card title="Estados Financieros" description="Solo costo, gasto o activo, por PUC confirmado. No se crean saldos por pagar." flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>PUC</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {[...byPuc.entries()].sort().map(([puc, cents]) => (
                <tr key={puc}>
                  <td>{puc}</td>
                  <td className="num">{formatMoneyCents(cents)}</td>
                </tr>
              ))}
              {byPuc.size === 0 && (
                <tr>
                  <td colSpan={2}>Nada para enviar todavía.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {(["1001", "1005", "1006"] as const).map((f) => (
        <Card key={f} title={DEST_LABEL[f]} description={model.notApplicable[f] ?? `${model.proposals[f].length} ${model.proposals[f].length === 1 ? "registro propuesto" : "registros propuestos"}`}>
          {stopsDest(model.status[f]) && !model.notApplicable[f] && <Alert tone="warning">Faltan datos para completar este formato: revisa los pendientes en Resumen.</Alert>}
        </Card>
      ))}
      <Card title="Conciliación de IVA" description="IVA descontable 1005 − IVA recuperado 1006 = IVA deducible 1001">
        {rec.applicable ? (
          <div className="stack stack--sm">
            <div>1005: {formatMoneyCents(rec.discountableCents)}</div>
            <div>1006: {formatMoneyCents(rec.recoveredCents)}</div>
            <div>Neto: {formatMoneyCents(rec.netVatCents)}</div>
            <div>1001 (IVA deducible): {formatMoneyCents(rec.vat1001Cents)}</div>
            <StatusChip status={rec.differenceCents === 0 ? "ready" : "block"} label={rec.differenceCents === 0 ? "Concilia" : `Bloquea · diferencia ${formatMoneyCents(rec.differenceCents)}`} />
          </div>
        ) : (
          <span>No aplica: la empresa no fue responsable de IVA o no hay valores.</span>
        )}
      </Card>
    </div>
  );
}
