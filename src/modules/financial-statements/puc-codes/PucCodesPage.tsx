import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, CalendarX2, FolderOpen, FolderSearch, Play, Tags } from "lucide-react";
import { Alert, Button, Card, ConfirmDialog, ContextBar, MetricBar, PageHeader, useToast } from "../../../components/ui";
import { fileService } from "../../../services/fileService";
import { companyService } from "../../../services/companyService";
import { pucService } from "../../../services/pucService";
import { supplierService } from "../../../services/supplierService";
import { errorMessage } from "../../../services/tauri";
import type { Company, DocumentTitleMapping, PucCode, Supplier } from "../../../types/models";
import { formatInteger } from "../../../utils/format";
import { DocumentDetailModal } from "./components/DocumentDetailModal";
import { DOCUMENTS_ANCHOR, DocumentsTable, type DocumentFilter } from "./components/DocumentsTable";
import { LotStatusIndicator, PendingPanel, pendingItemId } from "./components/PendingPanel";
import { PucCatalogModal } from "./components/PucCatalog";
import { PucSummary } from "./components/PucSummary";
import { PurchasesFsCard } from "./components/PurchasesFsCard";
import { TitleMappingsModal } from "./components/TitleMappingsModal";
import { SendToFs } from "../shared/components/SendToFs";
import { EmptyPeriodModal } from "../shared/components/EmptyPeriodModal";
import { SourceCoverage } from "../shared/components/SourceCoverage";
import { findCompanyByNit } from "../shared/companyMatch";
import { describeMonths } from "../shared/money";
import { buildPurchasesBatch, companyCheck, sendBlock } from "./services/accounting";
import { buildReport } from "./services/analysis";
import { exportPucExcel } from "./services/excelExport";
import { pickInvoiceFolder, processPucFolder, type InvoiceFolder } from "./services/folder";
import { actionsByFile, buildPendingActions, exportBlock, nextPending, type PendingAction } from "./services/pending";
import { buildPucIndex, leafConcept } from "./services/pucCatalog";
import { loadSession, saveSession } from "./services/session";
import type { Assignments, DocAssignment, FileResult } from "./types";

type Phase = { status: "idle" } | { status: "ready" } | { status: "processing"; done: number; total: number } | { status: "done"; results: FileResult[] };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", formatInteger(n)));

const scrollToId = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }));

export default function PucCodesPage() {
  const toast = useToast();
  // Un análisis ya hecho en esta sesión se retoma al volver a la pantalla.
  const [restored] = useState(loadSession);
  const [folder, setFolder] = useState<InvoiceFolder | null>(restored?.folder ?? null);
  const [phase, setPhase] = useState<Phase>(restored ? { status: "done", results: restored.results } : { status: "idle" });
  /** La carpeta se eligió en esta visita: solo entonces Rust sigue apuntando a ella y se puede releer. */
  const [folderFresh, setFolderFresh] = useState(false);
  /** Acción que descartaría códigos ya asignados, en espera de confirmación. */
  const [confirmReset, setConfirmReset] = useState<"pick" | "analyze" | null>(null);
  const [picking, setPicking] = useState(false);
  const [codes, setCodes] = useState<PucCode[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [titles, setTitles] = useState<DocumentTitleMapping[]>([]);
  const [titlesOpen, setTitlesOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  /** Asignaciones del usuario por archivo. Se conservan mientras dure el análisis en pantalla. */
  const [assignments, setAssignments] = useState<Assignments>(restored?.assignments ?? {});
  /** Datos → Proveedores. null mientras carga. El emisor de cada factura se busca aquí por NIT. */
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  /** Códigos confirmados con cada proveedor (id → códigos, el más reciente primero). Se guardan en SQLite. */
  const [supplierCodes, setSupplierCodes] = useState<Record<number, string[]>>({});
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ fileName: string; products: boolean } | null>(null);
  const [filter, setFilter] = useState<DocumentFilter>("all");
  const [pendingExpanded, setPendingExpanded] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [sentKey, setSentKey] = useState(0);
  /** Exclusión pedida desde Pendientes, en espera de confirmación. */
  const [excludeFile, setExcludeFile] = useState<string | null>(null);
  /** Recorrido de pendientes en curso: al resolver uno se pasa al siguiente. */
  const [resolving, setResolving] = useState(false);
  const [advance, setAdvance] = useState(false);
  const cancelled = useRef(false);
  const processing = phase.status === "processing";

  const loadTitles = useCallback(async () => {
    try {
      setTitles(await pucService.listTitles());
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [toast]);

  const loadSuppliers = useCallback(async () => {
    try {
      setSuppliers(await supplierService.list());
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [toast]);

  useEffect(() => {
    void loadTitles();
    void loadSuppliers();
    pucService.listCodes().then(setCodes, (e) => toast(errorMessage(e), "error"));
    companyService.list().then(setCompanies, (e) => toast(errorMessage(e), "error"));
    // Al salir de la pantalla se detiene un análisis en curso.
    return () => {
      cancelled.current = true;
    };
  }, [loadTitles, loadSuppliers, toast]);

  const index = useMemo(() => buildPucIndex(codes), [codes]);

  useEffect(() => {
    saveSession(folder && phase.status === "done" ? { folder, results: phase.results, assignments } : null);
  }, [folder, phase, assignments]);

  const assignedDocs = Object.values(assignments).filter((a) => a.mode || a.excluded).length;

  function resetLot() {
    setExportedPath(null);
    setAssignments({});
    setSelected(null);
    setResolving(false);
    setFocusId(null);
    setFilter("all");
  }

  async function pick() {
    if (processing) return;
    setPicking(true);
    try {
      const picked = await pickInvoiceFolder();
      if (!picked) return;
      setFolder(picked);
      setFolderFresh(true);
      setPhase({ status: "ready" });
      resetLot();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPicking(false);
    }
  }

  async function analyze() {
    if (!folder || processing || folder.files.length === 0) return;
    cancelled.current = false;
    resetLot();
    setPhase({ status: "processing", done: 0, total: folder.files.length });
    await loadTitles();
    const results = await processPucFolder(
      folder.files.map((f) => f.name),
      (done, total) => setPhase({ status: "processing", done, total }),
      () => cancelled.current,
    );
    if (!cancelled.current) {
      setPhase({ status: "done", results });
      setPendingExpanded(false);
    }
  }

  const report = useMemo(() => (phase.status === "done" ? buildReport(phase.results, index, titles, assignments) : null), [phase, index, titles, assignments]);
  const actions = useMemo(() => (report ? buildPendingActions(report) : []), [report]);
  const attention = useMemo(() => actionsByFile(actions), [actions]);
  const selectedRow = report?.rows.find((r) => r.fileName === selected?.fileName) ?? null;
  const selectedActionId = selected ? `doc:${selected.fileName}` : undefined;
  /** Con pendientes no se exporta: no hay forma de omitir esta validación. */
  const blocked = report ? exportBlock(report, actions) : null;
  /** Envío a Estados Financieros: empresa de cada factura por NIT del adquiriente. */
  const companyDocs = useMemo(() => (report ? companyCheck(report, companies, assignments) : []), [report, companies, assignments]);
  const sendBlocked = sendBlock(actions.length, companyDocs);
  const supplierByNit = useMemo(() => new Map((suppliers ?? []).map((s) => [s.nit, s])), [suppliers]);
  /** Proveedor de la factura abierta. null: su NIT no está en Proveedores. undefined: aún no se sabe. */
  const selectedSupplier = suppliers && selectedRow?.issuerNit ? (supplierByNit.get(selectedRow.issuerNit) ?? null) : undefined;
  const selectedSupplierId = selectedSupplier?.id;
  // Accesos rápidos del buscador: solo los códigos de 6 dígitos del proveedor de la factura abierta, con el concepto de la tabla PUC.
  const suggestions = useMemo(
    () => (selectedSupplierId !== undefined ? supplierCodes[selectedSupplierId] : undefined)?.map((code) => ({ code, concept: leafConcept(index, code) ?? "" })).filter((s) => s.concept),
    [supplierCodes, selectedSupplierId, index],
  );

  const storeSupplierCodes = useCallback((supplierId: number, list: string[]) => setSupplierCodes((prev) => ({ ...prev, [supplierId]: list })), []);

  useEffect(() => {
    if (selectedSupplierId === undefined) return;
    pucService.listSupplierCodes(selectedSupplierId).then((list) => storeSupplierCodes(selectedSupplierId, list), (e) => toast(errorMessage(e), "error"));
  }, [selectedSupplierId, storeSupplierCodes, toast]);

  function runAction(a: PendingAction) {
    setFocusId(a.id);
    if (a.target.kind === "document") return setSelected({ fileName: a.target.fileName, products: false });
    setPendingExpanded(true);
    scrollToId(pendingItemId(a.id));
  }

  /** Lleva al siguiente pendiente y deja activo el recorrido. */
  function resolveNext(afterId?: string) {
    const next = nextPending(actions, afterId);
    if (!next) {
      setResolving(false);
      setSelected(null);
      setFocusId(null);
      toast("No quedan pendientes por resolver.");
      return;
    }
    setResolving(true);
    if (next.target.kind !== "document") setSelected(null);
    runAction(next);
  }

  // Al resolver algo durante el recorrido, pasar al siguiente con los datos ya recalculados.
  useEffect(() => {
    if (!advance) return;
    setAdvance(false);
    // La factura abierta todavía tiene algo propio por resolver: se sigue en ella.
    if (selected && actions.some((a) => a.id === `doc:${selected.fileName}`)) return;
    resolveNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advance]);

  async function reloadAndAdvance() {
    await loadTitles();
    if (resolving) setAdvance(true);
  }

  function assign(fileName: string, next: DocAssignment, confirmedCode?: string) {
    // Un código confirmado queda asociado al proveedor registrado de la factura (se localiza por NIT), sin botón aparte.
    const nit = confirmedCode ? report?.rows.find((r) => r.fileName === fileName)?.issuerNit : undefined;
    const supplier = nit ? supplierByNit.get(nit) : undefined;
    if (supplier && confirmedCode) {
      pucService.recordSupplierCode(supplier.id, confirmedCode).then(
        (list) => storeSupplierCodes(supplier.id, list),
        (e) => toast(`La asignación se aplicó, pero no fue posible guardar el código para este proveedor. ${errorMessage(e)}`, "error"),
      );
    }
    setAssignments((prev) => ({ ...prev, [fileName]: next }));
    setExportedPath(null);
    if (resolving) setAdvance(true);
  }

  function showDocuments(f: DocumentFilter) {
    setFilter(f);
    scrollToId(DOCUMENTS_ANCHOR);
  }

  const reloadCodes = useCallback(() => pucService.listCodes().then(setCodes, (e) => toast(errorMessage(e), "error")), [toast]);

  async function exportExcel() {
    if (!report || !folder || exporting || blocked !== null) return;
    setExporting(true);
    try {
      const path = await exportPucExcel(report, folder.folderName);
      if (path) {
        setExportedPath(path);
        toast("Excel generado correctamente.");
      }
    } catch (e) {
      toast(errorMessage(e) || "No fue posible generar el archivo Excel.", "error");
    } finally {
      setExporting(false);
    }
  }

  const link = (f: DocumentFilter) => ({ onClick: () => showDocuments(f), active: filter === f, title: "Ver en la tabla de documentos" });

  /** Empresa destino (por NIT del adquiriente, la más frecuente) y periodo por fechas de emisión (nunca la fecha de importación). */
  const context = useMemo(() => {
    if (!report) return null;
    const docs = report.rows.filter((r) => !r.failure && !r.excluded);
    const counts = new Map<number, { company: Company; n: number }>();
    for (const r of docs) {
      const c = findCompanyByNit(companies, r.buyerNit);
      if (c) counts.set(c.id, { company: c, n: (counts.get(c.id)?.n ?? 0) + 1 });
    }
    const ranked = [...counts.values()].sort((a, b) => b.n - a.n);
    const months = docs.map((r) => r.issueDate?.slice(0, 7)).filter((m): m is string => Boolean(m && /^\d{4}-\d{2}$/.test(m)));
    return { company: ranked[0]?.company ?? null, several: ranked.length > 1, months, documents: docs.length };
  }, [report, companies]);

  return (
    <>
      <PageHeader
        eyebrow="Estados Financieros"
        title="Clasificación contable de compras"
        description="Selecciona una carpeta con facturas electrónicas en PDF, asigna el código PUC de cada una (a toda la factura o por producto), consolida los valores por código y envíalos a Estados Financieros."
        actions={
          <>
            <Button icon={<CalendarX2 size={15} />} onClick={() => setEmptyOpen(true)}>
              Registrar periodo sin compras
            </Button>
            <Button icon={<BookOpenText size={15} />} onClick={() => setCatalogOpen(true)}>
              Ver tabla PUC
            </Button>
            <Button icon={<Tags size={15} />} onClick={() => setTitlesOpen(true)}>
              Tipos de documento
            </Button>
          </>
        }
      />

      {!folder ? (
        <Card>
          <div className="row row--between">
            <p className="muted">Las facturas se leen en este equipo y no se modifican, mueven ni envían a ningún servicio.</p>
            <Button variant="primary" icon={<FolderSearch size={15} />} onClick={() => void pick()} loading={picking}>
              Seleccionar carpeta de facturas
            </Button>
          </div>
        </Card>
      ) : (
        <ContextBar
          items={[
            {
              label: "Empresa destino EEFF",
              value: context?.company ? context.company.razonSocial : report ? <span className="muted">Sin identificar</span> : <span className="muted">Se detecta al analizar</span>,
              hint: context?.several ? "Hay facturas de varias empresas" : undefined,
            },
            { label: "NIT", value: context?.company ? `${context.company.nit}${context.company.dv ? `-${context.company.dv}` : ""}` : "—", selectable: true },
            { label: "Periodo", value: context?.months.length ? describeMonths(context.months) : "—", hint: context?.months.length ? "Por fecha de emisión" : undefined },
            { label: "Documentos", value: report ? formatInteger(context?.documents ?? 0) : "—", hint: plural(folder.files.length, "1 PDF", "# PDF") },
            { label: "Carpeta", value: folder.folderName, selectable: true, hint: "Solo esta carpeta (sin subcarpetas)" },
          ]}
          actions={
            <>
              {exportedPath && (
                <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />} onClick={() => void fileService.revealSaved(exportedPath).catch((e: Error) => toast(e.message, "error"))}>
                  Ver Excel en Finder
                </Button>
              )}
              <Button size="sm" icon={<FolderSearch size={14} />} onClick={() => (assignedDocs ? setConfirmReset("pick") : void pick())} loading={picking} disabled={processing}>
                Cambiar carpeta
              </Button>
              <Button
                size="sm"
                variant={phase.status === "ready" ? "primary" : "secondary"}
                icon={<Play size={14} />}
                onClick={() => (assignedDocs ? setConfirmReset("analyze") : void analyze())}
                disabled={processing || folder.files.length === 0 || !folderFresh}
                title={folderFresh ? undefined : "Vuelve a seleccionar la carpeta para analizarla de nuevo."}
              >
                {phase.status === "done" ? "Analizar de nuevo" : "Analizar facturas"}
              </Button>
            </>
          }
        >
          {processing && (
            <>
              <span className="row muted" style={{ fontSize: "var(--text-sm)" }}>
                <span className="spinner" aria-hidden /> Procesando facturas… {phase.done} de {phase.total}
              </span>
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={phase.total} aria-valuenow={phase.done}>
                <div className="progress__bar" style={{ width: `${(phase.done / Math.max(1, phase.total)) * 100}%` }} />
              </div>
            </>
          )}
          {folder.files.length === 0 && <Alert tone="warning">La carpeta no contiene archivos PDF.</Alert>}
        </ContextBar>
      )}

      {processing && <LotStatusIndicator processing />}

      {report && (
        <>
          {folder && (
            <SendToFs
              blocked={sendBlocked}
              blockedStatus={actions.length > 0 ? "Pendiente de clasificación" : "Requiere revisión"}
              reasons={sendBlocked ? [actions.length > 0 ? `Análisis incompleto — ${sendBlocked}` : sendBlocked] : undefined}
              build={() => buildPurchasesBatch(companyDocs, suppliers ?? [], folder.folderName)}
              onExport={exportExcel}
              exporting={exporting}
              exportBlocked={blocked ? `${blocked} Resuélvelos para exportar.` : null}
              duplicateTitle="Algunas facturas ya fueron enviadas."
              onSent={() => setSentKey((k) => k + 1)}
            />
          )}
          {context?.company && <SourceCoverage companyId={context.company.id} source="purchases" year={context.months.length ? Number([...context.months].sort().reverse()[0].slice(0, 4)) : new Date().getFullYear()} refreshKey={sentKey} />}
          <PurchasesFsCard docs={companyDocs} onDecide={(fileName, decision) => assign(fileName, { ...assignments[fileName], companyDecision: decision })} onOpen={(fileName) => setSelected({ fileName, products: false })} />

          <MetricBar
            label="Resumen de documentos"
            metrics={[
              { key: "files", label: "PDF", value: formatInteger(report.stats.files), ...link("all"), active: false },
              { key: "invoices", label: report.stats.invoices === 1 ? "Factura" : "Facturas", value: formatInteger(report.stats.invoices), ...link("invoice") },
              { key: "notes", label: report.stats.notes === 1 ? "Nota crédito" : "Notas crédito", value: formatInteger(report.stats.notes), ...link("credit_note") },
              { key: "classified", label: report.stats.classified === 1 ? "Clasificada" : "Clasificadas", value: formatInteger(report.stats.classified), tone: report.stats.classified ? "positive" : undefined, ...link("classified") },
              { key: "pending", label: report.stats.pending === 1 ? "Pendiente" : "Pendientes", value: formatInteger(report.stats.pending), tone: report.stats.pending ? "attention" : undefined, ...link("pending") },
              ...(report.stats.partial ? [{ key: "partial", label: report.stats.partial === 1 ? "Parcial" : "Parciales", value: formatInteger(report.stats.partial), tone: "attention" as const, ...link("partial") }] : []),
              { key: "excluded", label: report.stats.excluded === 1 ? "Excluida" : "Excluidas", value: formatInteger(report.stats.excluded) },
            ]}
          />

          <PendingPanel
            actions={actions}
            expanded={pendingExpanded}
            onExpandedChange={setPendingExpanded}
            focusId={focusId}
            onNext={() => resolveNext()}
            onOpenDocument={(fileName) => setSelected({ fileName, products: false })}
            onExclude={setExcludeFile}
            onChanged={reloadAndAdvance}
            exportBlock={blocked}
          />

          {report.stats.duplicates > 0 && (
            <Alert tone="warning" title="Facturas repetidas en la carpeta">
              {plural(report.stats.duplicates, "1 documento ya está en el lote", "# documentos ya están en el lote")} (mismo CUFE / CUDE o mismo NIT emisor y número). Un duplicado no se suma dos veces.
            </Alert>
          )}

          <DocumentsTable rows={report.rows} attention={attention} filter={filter} onFilterChange={setFilter} onOpen={(r, products = false) => setSelected({ fileName: r.fileName, products })} onAction={runAction} />
          {phase.status === "done" && <span className="field__hint">Los códigos asignados se conservan mientras la app esté abierta, aunque salgas de esta pantalla. Analizar de nuevo o cambiar de carpeta los reinicia.</span>}
          <PucSummary report={report} partial={actions.length > 0} />
        </>
      )}

      <DocumentDetailModal
        row={selectedRow}
        index={index}
        openProducts={selected?.products ?? false}
        assignment={selected ? assignments[selected.fileName] : undefined}
        unknownTitle={selectedRow && !selectedRow.category ? report?.unknownTitles.find((t) => t.normalizedTitle === selectedRow.titleKey) : undefined}
        supplier={selectedSupplier}
        onSupplierCreated={loadSuppliers}
        suggestions={suggestions}
        onAssign={assign}
        onChanged={reloadAndAdvance}
        onClose={() => {
          setSelected(null);
          setResolving(false);
        }}
        remainingPending={actions.filter((a) => a.id !== selectedActionId).length}
        onNextPending={() => resolveNext(selectedActionId)}
        onCodesChanged={reloadCodes}
      />
      <ConfirmDialog
        open={confirmReset !== null}
        danger
        title={confirmReset === "pick" ? "Cambiar carpeta" : "Analizar de nuevo"}
        confirmLabel="Continuar"
        message={
          <>
            Este análisis tiene {plural(assignedDocs, "1 factura con decisiones tomadas", "# facturas con decisiones tomadas")} (códigos PUC o exclusiones). Al continuar se descartan y hay que asignarlas de nuevo.
          </>
        }
        onCancel={() => setConfirmReset(null)}
        onConfirm={() => {
          const action = confirmReset;
          setConfirmReset(null);
          void (action === "pick" ? pick() : analyze());
        }}
      />
      <ConfirmDialog
        open={excludeFile !== null}
        danger
        title="Excluir documento"
        confirmLabel="Excluir"
        message={<>«{excludeFile}» no se suma en el resumen ni se envía a Estados Financieros. Puedes volver a incluirlo desde su detalle.</>}
        onCancel={() => setExcludeFile(null)}
        onConfirm={() => {
          const fileName = excludeFile!;
          setExcludeFile(null);
          assign(fileName, { ...assignments[fileName], excluded: true });
        }}
      />
      <EmptyPeriodModal
        open={emptyOpen}
        source="purchases"
        companies={companies}
        companyId={context?.company?.id ?? null}
        defaultMonth={context?.months.length ? [...context.months].sort()[0] : null}
        onClose={() => setEmptyOpen(false)}
        onChanged={() => setSentKey((k) => k + 1)}
      />
      <TitleMappingsModal open={titlesOpen} titles={titles} onClose={() => setTitlesOpen(false)} onChanged={() => void loadTitles()} />
      <PucCatalogModal open={catalogOpen} index={index} onClose={() => setCatalogOpen(false)} />
    </>
  );
}
