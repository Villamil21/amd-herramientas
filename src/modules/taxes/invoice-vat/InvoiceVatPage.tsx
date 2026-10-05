import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, FolderOpen, FolderSearch, Play, Tags } from "lucide-react";
import { Alert, Button, Card, PageHeader, useToast } from "../../../components/ui";
import { fileService } from "../../../services/fileService";
import { supplierService } from "../../../services/supplierService";
import { errorMessage } from "../../../services/tauri";
import { vatTitleService } from "../../../services/vatTitleService";
import type { DocumentTitleMapping, Supplier } from "../../../types/models";
import { formatInteger } from "../../../utils/format";
import { InvoiceDetailModal } from "./components/InvoiceDetailModal";
import { INVOICES_ANCHOR, InvoicesTable, type InvoiceFilter } from "./components/InvoicesTable";
import { InvoiceStats } from "./components/InvoiceStats";
import { NameMismatchPanel } from "./components/NameMismatchPanel";
import { LotStatusIndicator, PendingPanel, pendingItemId } from "./components/PendingPanel";
import { TitleMappingsModal } from "./components/TitleMappingsModal";
import { VatSummary } from "./components/VatSummary";
import { buildReport, nameKey } from "./services/analysis";
import { exportInvoiceVatExcel } from "./services/excelExport";
import { pickInvoiceFolder, processInvoiceFolder, type InvoiceFolder } from "./services/invoiceFolderService";
import { actionsByFile, buildPendingActions, nextPending, type PendingAction } from "./services/pending";
import type { Decisions, DocDecision, FileResult } from "./types";

type Phase = { status: "idle" } | { status: "ready" } | { status: "processing"; done: number; total: number } | { status: "done"; results: FileResult[] };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", formatInteger(n)));

const scrollToId = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }));

export default function InvoiceVatPage() {
  const toast = useToast();
  const [folder, setFolder] = useState<InvoiceFolder | null>(null);
  const [phase, setPhase] = useState<Phase>({ status: "idle" });
  const [picking, setPicking] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [titles, setTitles] = useState<DocumentTitleMapping[]>([]);
  const [titlesOpen, setTitlesOpen] = useState(false);
  const [keptNames, setKeptNames] = useState<Set<string>>(() => new Set());
  /** Decisiones del usuario por archivo (tarifa de una fila, confirmar, excluir, incluir duplicado). */
  const [decisions, setDecisions] = useState<Decisions>({});
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ fileName: string; products: boolean } | null>(null);
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const [pendingExpanded, setPendingExpanded] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  /** «Resolver pendientes» en curso: al resolver uno se pasa al siguiente. */
  const [resolving, setResolving] = useState(false);
  const [advance, setAdvance] = useState(false);
  const [justAnalyzed, setJustAnalyzed] = useState(false);
  const cancelled = useRef(false);
  const processing = phase.status === "processing";

  const loadData = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([supplierService.list(), vatTitleService.list()]);
      setSuppliers(s);
      setTitles(t);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [toast]);

  useEffect(() => {
    void loadData();
    // Al salir de la pantalla se detiene un análisis en curso.
    return () => {
      cancelled.current = true;
    };
  }, [loadData]);

  function resetLot() {
    setExportedPath(null);
    setKeptNames(new Set());
    setDecisions({});
    setSelected(null);
    setResolving(false);
    setFocusId(null);
  }

  async function pick() {
    if (processing) return;
    setPicking(true);
    try {
      const picked = await pickInvoiceFolder();
      if (!picked) return;
      setFolder(picked);
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
    await loadData();
    const results = await processInvoiceFolder(
      folder.files.map((f) => f.name),
      (done, total) => setPhase({ status: "processing", done, total }),
      () => cancelled.current,
    );
    if (!cancelled.current) {
      setPhase({ status: "done", results });
      setJustAnalyzed(true);
    }
  }

  const report = useMemo(() => (phase.status === "done" ? buildReport(phase.results, suppliers, titles, { decisions, keptNames }) : null), [phase, suppliers, titles, decisions, keptNames]);
  const actions = useMemo(() => (report ? buildPendingActions(report) : []), [report]);
  const attention = useMemo(() => actionsByFile(actions), [actions]);
  const selectedRow = report?.rows.find((r) => r.fileName === selected?.fileName) ?? null;
  const selectedActionId = selected ? attention.get(selected.fileName)?.id : undefined;
  /** Con pendientes no se exporta: el Excel sería una declaración incompleta. */
  const exportBlocked = actions.length > 0;

  // Tras analizar: con pendientes, la tabla abre filtrada y el detalle abierto si son pocos.
  useEffect(() => {
    if (!justAnalyzed) return;
    setJustAnalyzed(false);
    setFilter(attention.size ? "pending" : "all");
    setPendingExpanded(actions.length > 0 && actions.length <= 6);
  }, [justAnalyzed, attention, actions]);

  function runAction(a: PendingAction) {
    setFocusId(a.id);
    if (a.target.kind === "document") return setSelected({ fileName: a.target.fileName, products: a.group === "product" });
    setPendingExpanded(true);
    scrollToId(pendingItemId(a.id));
  }

  /** Lleva al siguiente pendiente y deja activo el recorrido. */
  function resolveNext(skipId?: string) {
    const next = nextPending(actions, skipId);
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
    // El documento abierto todavía tiene algo propio por resolver: se sigue en él.
    if (selected && actions.some((a) => a.target.kind === "document" && a.target.fileName === selected.fileName)) return;
    resolveNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advance]);

  async function reloadAndAdvance() {
    await loadData();
    if (resolving) setAdvance(true);
  }

  function decide(fileName: string, decision: DocDecision) {
    setDecisions((prev) => ({ ...prev, [fileName]: decision }));
    if (resolving) setAdvance(true);
  }

  function showDocuments(f: InvoiceFilter) {
    setFilter(f);
    scrollToId(INVOICES_ANCHOR);
  }

  async function exportExcel() {
    if (!report || !folder || exporting || exportBlocked) return;
    setExporting(true);
    try {
      const path = await exportInvoiceVatExcel(report, suppliers, folder.folderName);
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

  return (
    <>
      <PageHeader
        eyebrow="Impuestos"
        title="IVA de compras"
        description="Selecciona una carpeta con facturas electrónicas en PDF para preparar y revisar la información de la declaración de IVA de compras."
        actions={
          <>
            <Button icon={<Tags size={15} />} onClick={() => setTitlesOpen(true)}>
              Tipos de documento
            </Button>
            {report && (
              <Button
                variant="primary"
                icon={<FileSpreadsheet size={15} />}
                onClick={() => void exportExcel()}
                loading={exporting}
                disabled={exportBlocked}
                title={exportBlocked ? "Resuelve primero los pendientes." : undefined}
              >
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
              <Button icon={<FolderSearch size={15} />} onClick={() => void pick()} loading={picking} disabled={processing}>
                Cambiar carpeta
              </Button>
              <Button variant={phase.status === "ready" ? "primary" : "secondary"} icon={<Play size={15} />} onClick={() => void analyze()} disabled={processing || folder.files.length === 0}>
                {phase.status === "done" ? "Analizar de nuevo" : "Analizar facturas"}
              </Button>
            </div>
            {processing && (
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={phase.total} aria-valuenow={phase.done}>
                <div className="progress__bar" style={{ width: `${(phase.done / Math.max(1, phase.total)) * 100}%` }} />
              </div>
            )}
            {folder.files.length === 0 && <Alert tone="warning">La carpeta no contiene archivos PDF.</Alert>}
          </div>
        )}
      </Card>

      {processing && <LotStatusIndicator processing />}

      {report && (
        <>
          <LotStatusIndicator actions={actions} />
          <PendingPanel
            actions={actions}
            expanded={pendingExpanded}
            onExpandedChange={setPendingExpanded}
            focusId={focusId}
            onResolveAll={() => resolveNext()}
            onOpenDocument={(fileName) => setSelected({ fileName, products: false })}
            onExclude={(fileName) => decide(fileName, { ...decisions[fileName], excluded: true })}
            onChanged={reloadAndAdvance}
          />

          {report.nameMismatches.length > 0 && (
            <NameMismatchPanel
              mismatches={report.nameMismatches}
              onKeep={(m) => setKeptNames((prev) => new Set(prev).add(nameKey(m.nit, m.invoiceName)))}
              onUpdated={() => void loadData()}
            />
          )}

          <InvoiceStats stats={report.stats} filter={filter} onFilter={showDocuments} />
          <InvoicesTable rows={report.rows} attention={attention} filter={filter} onFilterChange={setFilter} onOpen={(r, products = false) => setSelected({ fileName: r.fileName, products })} onAction={runAction} />

          {report.stats.pending > 0 && (
            <Alert tone="warning" title="Resumen parcial: NO está listo para declaración">
              <div className="row row--between" style={{ marginTop: 2 }}>
                <span>
                  {plural(report.stats.pending, "1 documento pendiente no está incluido en el resumen.", "# documentos pendientes no están incluidos en el resumen.")} Se actualiza al resolverlos, sin volver a importar la carpeta.
                </span>
                <Button size="sm" onClick={() => showDocuments("pending")}>
                  Ver pendientes
                </Button>
              </div>
            </Alert>
          )}
          <VatSummary summary={report.summary} />
        </>
      )}

      <InvoiceDetailModal
        row={selectedRow}
        openProducts={selected?.products ?? false}
        decision={selected ? decisions[selected.fileName] : undefined}
        supplier={selectedRow?.supplierNit ? suppliers.find((s) => s.nit === selectedRow.supplierNit) : undefined}
        unknownTitle={selectedRow && !selectedRow.category ? report?.unknownTitles.find((t) => t.normalizedTitle === selectedRow.documentTypeKey) : undefined}
        onDecision={decide}
        onChanged={reloadAndAdvance}
        onClose={() => {
          setSelected(null);
          setResolving(false);
        }}
        remainingPending={actions.filter((a) => a.id !== selectedActionId).length}
        onNextPending={() => resolveNext(selectedActionId)}
      />
      <TitleMappingsModal open={titlesOpen} titles={titles} onClose={() => setTitlesOpen(false)} onChanged={() => void loadData()} />
    </>
  );
}
