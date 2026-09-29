import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, FolderOpen, FolderSearch, Play } from "lucide-react";
import { Alert, Button, Card, PageHeader, useToast } from "../../../components/ui";
import { fileService } from "../../../services/fileService";
import { supplierService } from "../../../services/supplierService";
import { errorMessage } from "../../../services/tauri";
import type { Supplier } from "../../../types/models";
import { formatInteger } from "../../../utils/format";
import { InvoicesTable } from "./components/InvoicesTable";
import { InvoiceStats } from "./components/InvoiceStats";
import { NameMismatchPanel } from "./components/NameMismatchPanel";
import { PendingSuppliersPanel } from "./components/PendingSuppliersPanel";
import { VatSummary } from "./components/VatSummary";
import { buildReport, nameKey } from "./services/analysis";
import { exportInvoiceVatExcel } from "./services/excelExport";
import { pickInvoiceFolder, processInvoiceFolder, type InvoiceFolder } from "./services/invoiceFolderService";
import type { FileResult } from "./types";

type Phase = { status: "idle" } | { status: "ready" } | { status: "processing"; done: number; total: number } | { status: "done"; results: FileResult[] };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", formatInteger(n)));

export default function InvoiceVatPage() {
  const toast = useToast();
  const [folder, setFolder] = useState<InvoiceFolder | null>(null);
  const [phase, setPhase] = useState<Phase>({ status: "idle" });
  const [picking, setPicking] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [keptNames, setKeptNames] = useState<Set<string>>(() => new Set());
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const cancelled = useRef(false);
  const processing = phase.status === "processing";

  const loadSuppliers = useCallback(async () => {
    try {
      setSuppliers(await supplierService.list());
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [toast]);

  useEffect(() => {
    void loadSuppliers();
    // Al salir de la pantalla se detiene un análisis en curso.
    return () => {
      cancelled.current = true;
    };
  }, [loadSuppliers]);

  async function pick() {
    if (processing) return;
    setPicking(true);
    try {
      const picked = await pickInvoiceFolder();
      if (!picked) return;
      setFolder(picked);
      setPhase({ status: "ready" });
      setExportedPath(null);
      setKeptNames(new Set());
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
    setPhase({ status: "processing", done: 0, total: folder.files.length });
    await loadSuppliers();
    const results = await processInvoiceFolder(
      folder.files.map((f) => f.name),
      (done, total) => setPhase({ status: "processing", done, total }),
      () => cancelled.current,
    );
    if (!cancelled.current) setPhase({ status: "done", results });
  }

  const report = useMemo(
    () => (phase.status === "done" ? buildReport(phase.results, suppliers, { includeDuplicates, keptNames }) : null),
    [phase, suppliers, includeDuplicates, keptNames],
  );

  async function exportExcel() {
    if (!report || !folder || exporting) return;
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

  const failed = report?.rows.filter((r) => r.status === "incompatible" || r.status === "error") ?? [];
  const pendingCount = report?.pendingSuppliers.length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Impuestos"
        title="Análisis de IVA de facturas"
        description="Selecciona una carpeta con facturas electrónicas en PDF para resumir bases e IVA por tarifa, tipo de proveedor y tipo de documento."
        actions={
          report && (
            <Button
              variant="primary"
              icon={<FileSpreadsheet size={15} />}
              onClick={() => void exportExcel()}
              loading={exporting}
              disabled={pendingCount > 0}
              title={pendingCount > 0 ? "Clasifica primero los proveedores pendientes." : undefined}
            >
              Exportar Excel
            </Button>
          )
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

      {report && (
        <>
          <InvoiceStats stats={report.stats} />

          {failed.length > 0 && (
            <Alert
              tone="danger"
              title={plural(failed.length, "1 archivo no pudo procesarse.", "# archivos no pudieron procesarse.")}
              items={failed.map((r) => `${r.fileName}: ${r.issues[0]}`)}
            />
          )}
          {report.stats.review > 0 && (
            <Alert tone="warning" title={plural(report.stats.review, "1 factura requiere revisión.", "# facturas requieren revisión.")}>
              Usa el filtro «Requiere revisión» en la tabla y haz clic en cada factura para ver el motivo.
            </Alert>
          )}
          {report.stats.duplicates > 0 && (
            <Alert tone="warning" title={plural(report.stats.duplicates, "1 posible factura duplicada (mismo NIT y número).", "# posibles facturas duplicadas (mismo NIT y número).")}>
              <label className="checkbox" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} />
                Incluir los posibles duplicados en el resumen (por defecto se suma solo el primer archivo).
              </label>
            </Alert>
          )}

          {report.pendingSuppliers.length > 0 && <PendingSuppliersPanel pending={report.pendingSuppliers} onCreated={() => void loadSuppliers()} />}
          {report.nameMismatches.length > 0 && (
            <NameMismatchPanel
              mismatches={report.nameMismatches}
              onKeep={(m) => setKeptNames((prev) => new Set(prev).add(nameKey(m.nit, m.invoiceName)))}
              onUpdated={() => void loadSuppliers()}
            />
          )}

          <InvoicesTable rows={report.rows} />

          {pendingCount > 0 ? (
            <Alert tone="info" title="Resumen pendiente">
              {plural(pendingCount, "Falta 1 proveedor por clasificar.", "Faltan # proveedores por clasificar.")} El resumen se genera automáticamente al terminar.
            </Alert>
          ) : report.summaries.length > 0 ? (
            <VatSummary summaries={report.summaries} />
          ) : null}
        </>
      )}
    </>
  );
}
