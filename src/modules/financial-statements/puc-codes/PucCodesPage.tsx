import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, FileSpreadsheet, FolderOpen, FolderSearch, Play, Tags } from "lucide-react";
import { Alert, Button, Card, ConfirmDialog, PageHeader, useToast } from "../../../components/ui";
import { fileService } from "../../../services/fileService";
import { pucService } from "../../../services/pucService";
import { errorMessage } from "../../../services/tauri";
import type { DocumentTitleMapping, PucCode } from "../../../types/models";
import { formatInteger } from "../../../utils/format";
import { Stat } from "../../bank-analysis/shared/components/Stat";
import { DocumentDetailModal } from "./components/DocumentDetailModal";
import { DOCUMENTS_ANCHOR, DocumentsTable, type DocumentFilter } from "./components/DocumentsTable";
import { LotStatusIndicator, PendingPanel, pendingItemId } from "./components/PendingPanel";
import { PucCatalogModal } from "./components/PucCatalog";
import { PucSummary } from "./components/PucSummary";
import { TitleMappingsModal } from "./components/TitleMappingsModal";
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

const codesOf = (a: DocAssignment | undefined) => [a?.documentCode, ...Object.values(a?.lineCodes ?? {})].filter((c): c is string => Boolean(c));

/** Accesos rápidos del buscador: los últimos códigos confirmados en este análisis. */
const MAX_RECENT = 6;

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
  const [titles, setTitles] = useState<DocumentTitleMapping[]>([]);
  const [titlesOpen, setTitlesOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  /** Asignaciones del usuario por archivo. Se conservan mientras dure el análisis en pantalla. */
  const [assignments, setAssignments] = useState<Assignments>(restored?.assignments ?? {});
  const [recent, setRecent] = useState<string[]>(restored?.recent ?? []);
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ fileName: string; products: boolean } | null>(null);
  const [filter, setFilter] = useState<DocumentFilter>("all");
  const [pendingExpanded, setPendingExpanded] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
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

  useEffect(() => {
    void loadTitles();
    pucService.listCodes().then(setCodes, (e) => toast(errorMessage(e), "error"));
    // Al salir de la pantalla se detiene un análisis en curso.
    return () => {
      cancelled.current = true;
    };
  }, [loadTitles, toast]);

  const index = useMemo(() => buildPucIndex(codes), [codes]);

  useEffect(() => {
    saveSession(folder && phase.status === "done" ? { folder, results: phase.results, assignments, recent } : null);
  }, [folder, phase, assignments, recent]);

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
  const suggestions = useMemo(() => recent.map((code) => ({ code, concept: leafConcept(index, code) ?? "" })).filter((s) => s.concept), [recent, index]);

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

  function assign(fileName: string, next: DocAssignment) {
    const before = new Set(codesOf(assignments[fileName]));
    const added = [...new Set(codesOf(next))].filter((c) => !before.has(c));
    if (added.length) setRecent((prev) => [...added, ...prev.filter((c) => !added.includes(c))].slice(0, MAX_RECENT));
    setAssignments((prev) => ({ ...prev, [fileName]: next }));
    setExportedPath(null);
    if (resolving) setAdvance(true);
  }

  function showDocuments(f: DocumentFilter) {
    setFilter(f);
    scrollToId(DOCUMENTS_ANCHOR);
  }

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

  const link = (f: DocumentFilter) => ({ onClick: () => showDocuments(f), active: filter === f, title: "Ver en la tabla de facturas" });

  return (
    <>
      <PageHeader
        eyebrow="Estados Financieros"
        title="Códigos PUC por factura"
        description="Selecciona una carpeta con facturas electrónicas en PDF, asigna el código PUC de cada una (a toda la factura o por producto) y consolida los valores por código."
        actions={
          <>
            <Button icon={<BookOpenText size={15} />} onClick={() => setCatalogOpen(true)}>
              Ver tabla PUC
            </Button>
            <Button icon={<Tags size={15} />} onClick={() => setTitlesOpen(true)}>
              Tipos de documento
            </Button>
            {report && (
              <Button variant="primary" icon={<FileSpreadsheet size={15} />} onClick={() => void exportExcel()} loading={exporting} disabled={blocked !== null} title={blocked ? `${blocked} Resuélvelos para exportar.` : undefined}>
                Exportar Excel
              </Button>
            )}
          </>
        }
      />

      <Card>
        {!folder ? (
          <div className="row row--between">
            <p className="muted">Las facturas se leen en este equipo y no se modifican, mueven ni envían a ningún servicio.</p>
            <Button variant="primary" icon={<FolderSearch size={15} />} onClick={() => void pick()} loading={picking}>
              Seleccionar carpeta de facturas
            </Button>
          </div>
        ) : (
          <div className="stack stack--sm">
            <div className="file-chip">
              <div className="file-chip__icon">
                <FolderOpen size={17} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="file-chip__name selectable">{folder.folderName}</div>
                <div className="muted row" style={{ fontSize: "var(--text-sm)" }}>
                  <span>{plural(folder.files.length, "1 PDF encontrado", "# PDF encontrados")}</span>
                  <span>· Solo esta carpeta (sin subcarpetas)</span>
                  {processing && (
                    <span className="row">
                      <span className="spinner" aria-hidden /> Procesando facturas… {phase.done} de {phase.total}
                    </span>
                  )}
                </div>
              </div>
              {exportedPath && (
                <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />} onClick={() => void fileService.revealSaved(exportedPath).catch((e: Error) => toast(e.message, "error"))}>
                  Ver Excel en Finder
                </Button>
              )}
              <Button icon={<FolderSearch size={15} />} onClick={() => (assignedDocs ? setConfirmReset("pick") : void pick())} loading={picking} disabled={processing}>
                Cambiar carpeta
              </Button>
              <Button
                variant={phase.status === "ready" ? "primary" : "secondary"}
                icon={<Play size={15} />}
                onClick={() => (assignedDocs ? setConfirmReset("analyze") : void analyze())}
                disabled={processing || folder.files.length === 0 || !folderFresh}
                title={folderFresh ? undefined : "Vuelve a seleccionar la carpeta para analizarla de nuevo."}
              >
                {phase.status === "done" ? "Analizar de nuevo" : "Analizar facturas"}
              </Button>
            </div>
            {processing && (
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={phase.total} aria-valuenow={phase.done}>
                <div className="progress__bar" style={{ width: `${(phase.done / Math.max(1, phase.total)) * 100}%` }} />
              </div>
            )}
            {folder.files.length === 0 && <Alert tone="warning">La carpeta no contiene archivos PDF.</Alert>}
            {phase.status === "done" && <span className="field__hint">Los códigos asignados se conservan mientras la app esté abierta, aunque salgas de esta pantalla. Analizar de nuevo o cambiar de carpeta los reinicia.</span>}
          </div>
        )}
      </Card>

      {processing && <LotStatusIndicator processing />}

      {report && (
        <>
          <LotStatusIndicator pending={actions.length} />
          <PendingPanel
            actions={actions}
            expanded={pendingExpanded}
            onExpandedChange={setPendingExpanded}
            focusId={focusId}
            onNext={() => resolveNext()}
            onOpenDocument={(fileName) => setSelected({ fileName, products: false })}
            onExclude={(fileName) => assign(fileName, { ...assignments[fileName], excluded: true })}
            onChanged={reloadAndAdvance}
            exportBlock={blocked}
            exporting={exporting}
            onExport={() => void exportExcel()}
          />

          <div className="stat-row">
            <Stat label="PDF encontrados" value={formatInteger(report.stats.files)} {...link("all")} active={false} />
            <Stat label="Pendientes" value={formatInteger(report.stats.pending)} tone={report.stats.pending ? "negative" : undefined} {...link("pending")} />
            <Stat label="Parciales" value={formatInteger(report.stats.partial)} tone={report.stats.partial ? "negative" : undefined} {...link("partial")} />
            <Stat label="Clasificados" value={formatInteger(report.stats.classified)} tone={report.stats.classified ? "positive" : undefined} {...link("classified")} />
            <Stat label="Facturas" value={formatInteger(report.stats.invoices)} {...link("invoice")} />
            <Stat label="Notas crédito" value={formatInteger(report.stats.notes)} {...link("credit_note")} />
            <Stat label="Excluidos" value={formatInteger(report.stats.excluded)} />
          </div>

          {report.stats.duplicates > 0 && (
            <Alert tone="warning" title="Facturas repetidas en la carpeta">
              {plural(report.stats.duplicates, "1 documento ya está en el lote", "# documentos ya están en el lote")} (mismo CUFE / CUDE o mismo NIT emisor y número). Un duplicado no se suma dos veces.
            </Alert>
          )}

          <DocumentsTable rows={report.rows} attention={attention} filter={filter} onFilterChange={setFilter} onOpen={(r, products = false) => setSelected({ fileName: r.fileName, products })} onAction={runAction} />
          <PucSummary report={report} partial={actions.length > 0} />
        </>
      )}

      <DocumentDetailModal
        row={selectedRow}
        index={index}
        openProducts={selected?.products ?? false}
        assignment={selected ? assignments[selected.fileName] : undefined}
        unknownTitle={selectedRow && !selectedRow.category ? report?.unknownTitles.find((t) => t.normalizedTitle === selectedRow.titleKey) : undefined}
        suggestions={suggestions}
        onAssign={assign}
        onChanged={reloadAndAdvance}
        onClose={() => {
          setSelected(null);
          setResolving(false);
        }}
        remainingPending={actions.filter((a) => a.id !== selectedActionId).length}
        onNextPending={() => resolveNext(selectedActionId)}
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
      <TitleMappingsModal open={titlesOpen} titles={titles} onClose={() => setTitlesOpen(false)} onChanged={() => void loadTitles()} />
      <PucCatalogModal open={catalogOpen} index={index} onClose={() => setCatalogOpen(false)} />
    </>
  );
}
