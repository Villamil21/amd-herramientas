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
import { DocumentsTable } from "./components/DocumentsTable";
import { BelowMinimumTable, DeclarationSummary, IgnoredSection, NotesSection, SubtypeDetailTable, TotalsCard } from "./components/ReportSections";
import { FiscalPanels, PendingSuppliersPanel, PeriodPanel, UnknownTitlesPanel } from "./components/SetupPanels";
import { TitleMappingsModal } from "./components/TitleMappingsModal";
import { WithholdingStats } from "./components/WithholdingStats";
import { buildWithholdingReport, fiscalDismissKey, suggestPersonType } from "./services/analysis";
import { exportWithholdingExcel } from "./services/excelExport";
import { processWithholdingFolder } from "./services/folder";
import { ignoredGroup } from "./services/labels";
import type { DocDecision, DocRow, FileResult, PendingSupplier } from "./types";

type Phase = { status: "idle" } | { status: "ready" } | { status: "processing"; done: number; total: number } | { status: "done"; results: FileResult[] };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", formatInteger(n)));

type SupplierModal = { supplier: Supplier | null; draft: SupplierDraft | null } | null;

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
    setPhase({ status: "processing", done: 0, total: folder.files.length });
    await loadData();
    const results = await processWithholdingFolder(
      folder.files.map((f) => f.name),
      (done, total) => setPhase({ status: "processing", done, total }),
      () => cancelled.current,
    );
    if (!cancelled.current) setPhase({ status: "done", results });
  }

  const report = useMemo(
    () => (phase.status === "done" ? buildWithholdingReport(phase.results, { suppliers, rates, uvts, titles, periodChoice, decisions, dismissedFiscal }) : null),
    [phase, suppliers, rates, uvts, titles, periodChoice, decisions, dismissedFiscal],
  );
  const selectedRow = report?.rows.find((r) => r.fileName === selected) ?? null;

  async function exportExcel() {
    if (!report || !folder || exporting) return;
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
              <Button variant="primary" icon={<FileSpreadsheet size={15} />} onClick={() => void exportExcel()} loading={exporting}>
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

      {report && (
        <>
          <PeriodPanel period={report.period} onChoose={setPeriodChoice} />
          <WithholdingStats stats={report.stats} />

          {failed.length > 0 && (
            <Alert
              tone="danger"
              title={plural(failed.length, "1 archivo no pudo procesarse.", "# archivos no pudieron procesarse.")}
              items={failed.map((r) => `${r.fileName}: ${r.issues[0]}`)}
            />
          )}
          <FiscalPanels
            changes={report.fiscalChanges}
            missing={report.fiscalMissing}
            conflicts={report.fiscalConflicts}
            onDismiss={(c) => setDismissedFiscal((prev) => new Set(prev).add(fiscalDismissKey(c.nit, c.detected)))}
            onUpdated={() => void loadData()}
          />
          {report.unknownTitles.length > 0 && <UnknownTitlesPanel titles={report.unknownTitles} onSaved={() => void loadData()} />}
          {report.pendingSuppliers.length > 0 && <PendingSuppliersPanel pending={report.pendingSuppliers} onConfigure={configure} />}

          <DocumentsTable rows={report.rows} onOpen={(r) => setSelected(r.fileName)} />

          {report.stats.pending > 0 && (
            <Alert tone="info" title={plural(report.stats.pending, "1 documento pendiente no está incluido en el resumen.", "# documentos pendientes no están incluidos en el resumen.")}>
              Usa el filtro «Por revisar» en la tabla de documentos. El resumen se actualiza al resolverlos.
            </Alert>
          )}
          <DeclarationSummary report={report} />
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
        onClose={() => setSelected(null)}
      />
      <SupplierWithholdingModal
        open={supplierModal !== null}
        supplier={supplierModal?.supplier}
        draft={supplierModal?.draft}
        rates={rates}
        onClose={() => setSupplierModal(null)}
        onSaved={() => {
          setSupplierModal(null);
          void loadData();
        }}
      />
      <TitleMappingsModal open={titlesOpen} titles={titles} onClose={() => setTitlesOpen(false)} onChanged={() => void loadData()} />
    </>
  );
}
