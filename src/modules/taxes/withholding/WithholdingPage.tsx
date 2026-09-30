import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, FolderOpen, FolderSearch, Play, Tags } from "lucide-react";
import { Alert, Button, Card, PageHeader, useToast } from "../../../components/ui";
import { navigate, paths } from "../../../app/router";
import { fileService } from "../../../services/fileService";
import { supplierService } from "../../../services/supplierService";
import { errorMessage } from "../../../services/tauri";
import { withholdingService } from "../../../services/withholdingService";
import type { DocumentTitleMapping, Supplier, UvtValue, WithholdingRate } from "../../../types/models";
import { formatInteger } from "../../../utils/format";
import { SupplierWithholdingModal, type SupplierDraft } from "../../../pages/suppliers/SupplierWithholdingModal";
import { pickInvoiceFolder, type InvoiceFolder } from "../invoice-vat/services/invoiceFolderService";
import { DocumentDetailModal } from "./components/DocumentDetailModal";
import { DOCUMENTS_ANCHOR, DocumentsTable, type DocFilter } from "./components/DocumentsTable";
import { LotStatusIndicator, PendingPanel, pendingItemId } from "./components/PendingPanel";
import { BelowMinimumTable, DeclarationSummary, IgnoredSection, NotesSection, NotesSummary, SubtypeDetailTable, TotalsCard } from "./components/ReportSections";
import { PeriodPanel } from "./components/SetupPanels";
import { TitleMappingsModal } from "./components/TitleMappingsModal";
import { WithholdingStats } from "./components/WithholdingStats";
import { buildWithholdingReport, fiscalDismissKey, suggestPersonType } from "./services/analysis";
import { exportWithholdingExcel } from "./services/excelExport";
import { processWithholdingFolder } from "./services/folder";
import { ignoredGroup } from "./services/labels";
import { actionable, actionsByFile, buildPendingActions, lotStatus, nextPending, type PendingAction } from "./services/pending";
import type { DocDecision, DocRow, FileResult, PendingSupplier } from "./types";

type Phase = { status: "idle" } | { status: "ready" } | { status: "processing"; done: number; total: number } | { status: "done"; results: FileResult[] };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", formatInteger(n)));

type SupplierModal = { supplier: Supplier | null; draft: SupplierDraft | null } | null;

const PERIOD_ANCHOR = "withholding-period";
const scrollToId = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }));

export default function WithholdingPage() {
  const toast = useToast();
  const [folder, setFolder] = useState<InvoiceFolder | null>(null);
  const [phase, setPhase] = useState<Phase>({ status: "idle" });
  const [picking, setPicking] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [rates, setRates] = useState<WithholdingRate[]>([]);
  const [uvts, setUvts] = useState<UvtValue[]>([]);
  const [titles, setTitles] = useState<DocumentTitleMapping[]>([]);
  const [periodChoice, setPeriodChoice] = useState<string | undefined>();
  const [decisions, setDecisions] = useState<Record<string, DocDecision>>({});
  const [dismissedFiscal, setDismissedFiscal] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [supplierModal, setSupplierModal] = useState<SupplierModal>(null);
  const [titlesOpen, setTitlesOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [filter, setFilter] = useState<DocFilter>("all");
  const [pendingExpanded, setPendingExpanded] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  /** «Resolver pendientes» en curso: al resolver uno se pasa al siguiente. */
  const [resolving, setResolving] = useState(false);
  const [advance, setAdvance] = useState(false);
  const [justAnalyzed, setJustAnalyzed] = useState(false);
  const [resolvedConflicts, setResolvedConflicts] = useState<Set<string>>(() => new Set());
  const cancelled = useRef(false);
  const processing = phase.status === "processing";

  const loadData = useCallback(async () => {
    try {
      const [s, r, u, t] = await Promise.all([supplierService.list(), withholdingService.listRates(), withholdingService.listUvt(), withholdingService.listTitles()]);
      setSuppliers(s);
      setRates(r);
      setUvts(u);
      setTitles(t);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [toast]);

  useEffect(() => {
    void loadData();
    return () => {
      cancelled.current = true;
    };
  }, [loadData]);

  async function pick() {
    if (processing) return;
    setPicking(true);
    try {
      const picked = await pickInvoiceFolder();
      if (!picked) return;
      setFolder(picked);
      setPhase({ status: "ready" });
      setExportedPath(null);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPicking(false);
    }
  }

  async function analyze() {
    if (!folder || processing || folder.files.length === 0) return;
    cancelled.current = false;
    setExportedPath(null);
    setPeriodChoice(undefined);
    setDecisions({});
    setDismissedFiscal(new Set());
    setResolvedConflicts(new Set());
    setResolving(false);
    setFocusId(null);
    setPhase({ status: "processing", done: 0, total: folder.files.length });
    await loadData();
    const results = await processWithholdingFolder(
      folder.files.map((f) => f.name),
      (done, total) => setPhase({ status: "processing", done, total }),
      () => cancelled.current,
    );
    if (!cancelled.current) {
      setPhase({ status: "done", results });
      setJustAnalyzed(true);
    }
  }

  const report = useMemo(
    () => (phase.status === "done" ? buildWithholdingReport(phase.results, { suppliers, rates, uvts, titles, periodChoice, decisions, dismissedFiscal }) : null),
    [phase, suppliers, rates, uvts, titles, periodChoice, decisions, dismissedFiscal],
  );
  const selectedRow = report?.rows.find((r) => r.fileName === selected) ?? null;
  const actions = useMemo(() => (report ? buildPendingActions(report, resolvedConflicts) : []), [report, resolvedConflicts]);
  const attention = useMemo(() => actionsByFile(actions), [actions]);
  const selectedActionId = selected ? attention.get(selected)?.id : undefined;
  /** Con pendientes bloqueantes no se exporta: el Excel sería una declaración incompleta. */
  const exportBlocked = lotStatus(actions).kind === "attention";

  // Tras analizar: con pendientes, la tabla abre filtrada y el detalle abierto si son pocos.
  useEffect(() => {
    if (!justAnalyzed) return;
    setJustAnalyzed(false);
    setFilter(attention.size ? "pending" : "all");
    setPendingExpanded(actions.length <= 6);
  }, [justAnalyzed, attention, actions]);

  function runAction(a: PendingAction) {
    setFocusId(a.id);
    switch (a.target.kind) {
      case "supplier":
        return configure(a.target.supplier);
      case "document":
        return setSelected(a.target.fileName);
      case "period":
        return scrollToId(PERIOD_ANCHOR);
      default:
        setPendingExpanded(true);
        scrollToId(pendingItemId(a.id));
    }
  }

  /** Lleva al primer pendiente (bloqueantes primero) y deja activo el recorrido. */
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

  // Al guardar algo durante el recorrido, pasar al siguiente con los datos ya recalculados.
  useEffect(() => {
    if (!advance) return;
    setAdvance(false);
    resolveNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advance]);

  async function reloadAndAdvance() {
    await loadData();
    if (resolving) setAdvance(true);
  }

  function showDocuments(f: DocFilter) {
    setFilter(f);
    scrollToId(DOCUMENTS_ANCHOR);
  }

  async function exportExcel() {
    if (!report || !folder || exporting || exportBlocked) return;
    setExporting(true);
    try {
      const path = await exportWithholdingExcel(report, rates, folder.folderName);
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

  function configure(p: PendingSupplier) {
    const existing = p.supplierId ? suppliers.find((s) => s.id === p.supplierId) : undefined;
    setSupplierModal({
      supplier: existing ?? null,
      draft: { nit: p.nit, name: p.name, taxpayerType: p.taxpayerType, fiscalRegime: p.fiscalRegime, fiscalText: p.fiscalText, suggestedPersonType: suggestPersonType(p.taxpayerType) },
    });
  }

  function editSupplier(row: DocRow) {
    const existing = suppliers.find((s) => s.nit === row.nit);
    const pending = report?.pendingSuppliers.find((p) => p.nit === row.nit);
    if (pending && !existing) return configure(pending);
    setSupplierModal({
      supplier: existing ?? null,
      draft: {
        nit: row.nit!,
        name: row.supplierName ?? "",
        taxpayerType: row.taxpayerType,
        fiscalRegime: row.fiscalCodes.join(";") || row.fiscalText,
        fiscalText: row.fiscalText,
        suggestedPersonType: suggestPersonType(row.taxpayerType),
      },
    });
  }

  const failed = report?.rows.filter((r) => r.status === "incompatible" || r.status === "error") ?? [];
  const belowRows = report?.rows.filter((r) => r.status === "below-minimum") ?? [];
  const noteRows = report?.rows.filter((r) => r.category === "credit_note" && !ignoredGroup(r.status)) ?? [];
  const ignoredRows = report?.rows.filter((r) => ignoredGroup(r.status)) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Impuestos"
        title="Retención en la fuente"
        description="Selecciona una carpeta con facturas electrónicas en PDF para preparar, validar y resumir la información de la declaración de retención en la fuente."
        actions={
          <>
            <Button icon={<Tags size={15} />} onClick={() => setTitlesOpen(true)}>
              Títulos Factura / Nota
            </Button>
            <Button onClick={() => navigate(paths.withholdingTable)}>Tabla de retenciones</Button>
            {report && (
              <Button
                variant="primary"
                icon={<FileSpreadsheet size={15} />}
                onClick={() => void exportExcel()}
                loading={exporting}
                disabled={exportBlocked}
                title={exportBlocked ? "Resuelve primero los pendientes bloqueantes." : undefined}
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
            <p className="muted">Los documentos se leen en este equipo y no se modifican, mueven ni envían a ningún servicio.</p>
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
                      <span className="spinner" aria-hidden /> Procesando {phase.done} de {phase.total}…
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
                {phase.status === "done" ? "Analizar de nuevo" : "Analizar documentos"}
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
          <div id={PERIOD_ANCHOR}>
            <PeriodPanel period={report.period} onChoose={setPeriodChoice} />
          </div>
          <LotStatusIndicator actions={actions} />
          <PendingPanel
            actions={actions}
            expanded={pendingExpanded}
            onExpandedChange={setPendingExpanded}
            focusId={focusId}
            onResolveAll={() => resolveNext()}
            onAction={runAction}
            supplierIdFor={(nit) => suppliers.find((s) => s.nit === nit)?.id}
            onFiscalDismiss={(nit, detected) => {
              setDismissedFiscal((prev) => new Set(prev).add(fiscalDismissKey(nit, detected)));
              if (resolving) setAdvance(true);
            }}
            onConflictResolved={(nit) => {
              setResolvedConflicts((prev) => new Set(prev).add(nit));
              if (resolving) setAdvance(true);
            }}
            onChanged={reloadAndAdvance}
          />

          {failed.length > 0 && (
            <Alert
              tone="danger"
              title={plural(failed.length, "1 archivo no pudo procesarse.", "# archivos no pudieron procesarse.")}
              items={failed.map((r) => `${r.fileName}: ${r.issues[0]}`)}
            />
          )}
          <WithholdingStats stats={report.stats} filter={filter} onFilter={showDocuments} />

          <DocumentsTable rows={report.rows} attention={attention} filter={filter} onFilterChange={setFilter} onOpen={(r) => setSelected(r.fileName)} onAction={runAction} />

          {report.stats.pending > 0 && (
            <Alert tone="warning" title={plural(report.stats.pending, "1 documento pendiente no está incluido en el resumen.", "# documentos pendientes no están incluidos en el resumen.")}>
              <div className="row row--between" style={{ marginTop: 2 }}>
                <span>El resumen se actualiza al resolverlos, sin volver a importar la carpeta.</span>
                <Button size="sm" onClick={() => showDocuments("pending")}>
                  Ver pendientes
                </Button>
              </div>
            </Alert>
          )}
          <DeclarationSummary report={report} />
          <NotesSummary notes={report.notesSummary} />
          <SubtypeDetailTable report={report} />
          {belowRows.length > 0 && <BelowMinimumTable rows={belowRows} onOpen={(r) => setSelected(r.fileName)} />}
          {noteRows.length > 0 && <NotesSection rows={noteRows} totalCents={report.totals.notesCents} onOpen={(r) => setSelected(r.fileName)} />}
          {ignoredRows.length > 0 && <IgnoredSection rows={ignoredRows} onOpen={(r) => setSelected(r.fileName)} />}
          <TotalsCard totals={report.totals} />
        </>
      )}

      <DocumentDetailModal
        row={selectedRow}
        decision={selected ? decisions[selected] : undefined}
        onDecision={(fileName, d) => setDecisions((prev) => ({ ...prev, [fileName]: d }))}
        onEditSupplier={editSupplier}
        onClose={() => {
          setSelected(null);
          setResolving(false);
        }}
        remainingPending={actionable(actions).filter((a) => a.id !== selectedActionId).length}
        onNextPending={() => resolveNext(selectedActionId)}
      />
      <SupplierWithholdingModal
        open={supplierModal !== null}
        supplier={supplierModal?.supplier}
        draft={supplierModal?.draft}
        rates={rates}
        onClose={() => {
          setSupplierModal(null);
          setResolving(false);
        }}
        onSaved={() => {
          setSupplierModal(null);
          void reloadAndAdvance();
        }}
      />
      <TitleMappingsModal open={titlesOpen} titles={titles} onClose={() => setTitlesOpen(false)} onChanged={() => void loadData()} />
    </>
  );
}
