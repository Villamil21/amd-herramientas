import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Settings2, Sheet as SheetIcon } from "lucide-react";
import { Alert, Button, Card, PageHeader, useToast } from "../../../components/ui";
import { useShortcut } from "../../../hooks/useShortcut";
import { dropiService } from "../../../services/dropiService";
import { fileService } from "../../../services/fileService";
import { errorMessage } from "../../../services/tauri";
import type { Workbook } from "../../../types/excel";
import type { DropiStatusMapping } from "../../../types/models";
import { formatInteger } from "../../../utils/format";
import { StatementFileCard } from "../../bank-analysis/shared/components/StatementFileCard";
import type { ImportState } from "../../bank-analysis/shared/useStatementImport";
import { ClosingSummary } from "./components/ClosingSummary";
import { OrdersTable } from "./components/OrdersTable";
import { PendingStatusesPanel } from "./components/PendingStatusesPanel";
import { StatusDetailTable } from "./components/StatusDetailTable";
import { StatusRulesModal } from "./components/StatusRulesModal";
import { analyzeOrders } from "./services/analysis";
import { exportDropiExcel } from "./services/excelExport";
import { readOrdersWorkbook } from "./services/workbookReader";
import { DropiError, type ReadResult, type StatusRules } from "./types";

const LABELS = { pick: "Seleccionar Excel", pickAnother: "Seleccionar otro Excel", analyzing: "Leyendo órdenes…" };

type Loaded = ReadResult & { workbook: Workbook };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", formatInteger(n)));
/** Primeros elementos de una lista larga, para no saturar las alertas. */
const firstOf = (items: string[], max = 10) => (items.length > max ? [...items.slice(0, max), `… y ${formatInteger(items.length - max)} más`] : items);

/** Deja que la interfaz muestre «Leyendo órdenes…» antes de procesar un archivo grande. */
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

export default function DropiOrdersPage() {
  const toast = useToast();
  const [state, setState] = useState<ImportState<Loaded>>({ status: "idle" });
  const [picking, setPicking] = useState(false);
  const [mappings, setMappings] = useState<DropiStatusMapping[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const busy = picking || state.status === "analyzing";

  const loadMappings = useCallback(async () => {
    try {
      setMappings(await dropiService.listStatusMappings());
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [toast]);

  useEffect(() => {
    void loadMappings();
  }, [loadMappings]);

  const rules: StatusRules = useMemo(() => new Map(mappings.map((m) => [m.normalizedStatus, m.category])), [mappings]);

  /** Lee la hoja de órdenes; `sheetName` cuando el usuario eligió entre varias candidatas. */
  const read = useCallback(async (workbook: Workbook, sheetName?: string) => {
    const { fileName } = workbook;
    setExportedPath(null);
    setState({ status: "analyzing", fileName });
    await nextFrame();
    try {
      setState({ status: "done", fileName, pageCount: 0, analysis: { ...readOrdersWorkbook(workbook, sheetName), workbook } });
    } catch (e) {
      if (!(e instanceof DropiError) && import.meta.env.DEV) console.error("[dropi]", e);
      setState({ status: "error", fileName, message: e instanceof DropiError ? e.message : "No fue posible leer el archivo. Verifica que sea el reporte de órdenes exportado desde Dropi." });
    }
  }, []);

  const pick = useCallback(async () => {
    if (busy) return;
    setPicking(true);
    try {
      const workbook = await fileService.pickExcel();
      if (workbook) await read(workbook);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPicking(false);
    }
  }, [busy, read, toast]);

  useShortcut("o", () => void pick());

  const loaded = state.status === "done" ? state.analysis : undefined;
  const file = loaded?.kind === "ok" ? loaded.file : undefined;
  // Se recalcula al guardar, reasignar o eliminar una clasificación.
  const analysis = useMemo(() => (file ? analyzeOrders(file.rows, rules) : undefined), [file, rules]);

  async function exportExcel() {
    if (!file || !analysis?.complete || exporting) return;
    setExporting(true);
    try {
      const path = await exportDropiExcel(file, analysis, rules);
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
        eyebrow="Dropi"
        title="Órdenes"
        description="Importa el reporte de órdenes exportado desde Dropi para generar el cierre."
        actions={
          <>
            <Button icon={<Settings2 size={15} />} onClick={() => setRulesOpen(true)}>
              Clasificación de estados
            </Button>
            {analysis && (
              <Button
                variant="primary"
                icon={<FileSpreadsheet size={15} />}
                onClick={() => void exportExcel()}
                loading={exporting}
                disabled={!analysis.complete}
                title={analysis.complete ? undefined : "Clasifica primero los estados pendientes."}
              >
                Exportar Excel
              </Button>
            )}
          </>
        }
      />

      <StatementFileCard
        state={state}
        details={
          file && (
            <>
              <span>Hoja «{file.sheetName}»</span>
              <span>· {plural(file.rows.length, "1 registro", "# registros")}</span>
              {file.company && <span>· {file.company}</span>}
              {file.period && <span>· {file.period}</span>}
            </>
          )
        }
        picking={picking}
        busy={busy}
        exportedPath={exportedPath}
        onPick={() => void pick()}
        labels={LABELS}
      />

      {loaded?.kind === "choose-sheet" && (
        <Card title="Elige la hoja de órdenes" description="Varias hojas tienen la estructura del reporte de órdenes de Dropi y la misma cantidad de filas. Selecciona la que corresponde al cierre.">
          <div className="row">
            {loaded.candidates.map((c) => (
              <Button key={c.name} icon={<SheetIcon size={15} />} onClick={() => void read(loaded.workbook, c.name)}>
                {c.name} · {plural(c.rows, "1 fila", "# filas")}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {file && analysis && (
        <>
          <Card title="Archivo" description={file.sheetReason}>
            <div className="summary-grid">
              <Info label="Hoja utilizada" value={file.sheetName} />
              <Info label="Registros" value={formatInteger(analysis.summary.totalRows)} />
              <Info label="Pedidos únicos" value={formatInteger(analysis.summary.uniqueOrders)} />
              <Info label="Estados encontrados" value={formatInteger(analysis.statuses.length)} />
              <Info label="Estados pendientes de clasificar" value={formatInteger(analysis.pending.length)} />
              <Info label="Empresa (según el archivo)" value={file.company ?? "—"} />
              <Info label="Periodo (columna FECHA)" value={file.period ?? "—"} />
              <Info label="Otras hojas (no usadas)" value={file.ignoredSheets.join(", ") || "—"} />
            </div>
          </Card>

          {file.invalidMoney.length > 0 && (
            <Alert
              tone="danger"
              title="Algunas filas contienen valores monetarios no válidos."
              items={firstOf(file.invalidMoney.map((i) => `Fila ${i.rowNumber}, ${i.column}: «${i.text}»`))}
            >
              Esos valores se sumaron como 0. Revisa el archivo original; el Excel exportado los lista en la hoja «Incidencias».
            </Alert>
          )}
          {file.rowsWithoutStatus.length > 0 && (
            <Alert tone="warning" title={plural(file.rowsWithoutStatus.length, "1 fila no tiene ESTATUS.", "# filas no tienen ESTATUS.")}>
              No se pueden clasificar, por eso el cierre queda incompleto. Filas: {firstOf(file.rowsWithoutStatus.map(String), 20).join(", ")}.
            </Alert>
          )}
          {file.rowsWithoutId.length > 0 && (
            <Alert tone="warning" title={plural(file.rowsWithoutId.length, "1 fila no tiene ID.", "# filas no tienen ID.")}>
              Sus valores se suman, pero no cuentan como pedidos. Filas: {firstOf(file.rowsWithoutId.map(String), 20).join(", ")}.
            </Alert>
          )}
          {analysis.conflictingIds.length > 0 && (
            <Alert
              tone="warning"
              title="Se encontraron IDs con más de un estado diferente."
              items={firstOf(analysis.conflictingIds.map((c) => `ID ${c.id}: ${c.statuses.join(" · ")}`))}
            >
              Cada ID cuenta una sola vez en cada indicador de pedidos, según los estados en que aparece. No se eligió un «último estado» porque el
              reporte no trae una columna fiable de cronología.
            </Alert>
          )}
          {analysis.repeatedIds.length > 0 && (
            <Alert
              tone="warning"
              title={plural(analysis.repeatedIds.length, "1 ID aparece en varias filas.", "# IDs aparecen en varias filas.")}
              items={firstOf(analysis.repeatedIds.map((r) => `ID ${r.id}: ${r.rows} filas`))}
            >
              En los pedidos cuentan una sola vez; los valores se suman por fila tal como vienen en el archivo. Revisa si hay doble conteo.
            </Alert>
          )}

          {analysis.pending.length > 0 && <PendingStatusesPanel key={file.fileName} pending={analysis.pending} onSaved={loadMappings} />}

          <ClosingSummary analysis={analysis} />
          <StatusDetailTable analysis={analysis} />
          <OrdersTable key={`${file.fileName}:${file.sheetName}`} rows={file.rows} rules={rules} />
        </>
      )}

      <StatusRulesModal open={rulesOpen} mappings={mappings} onClose={() => setRulesOpen(false)} onChanged={loadMappings} />
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-item">
      <span className="summary-item__label">{label}</span>
      <span className="summary-item__value selectable">{value}</span>
    </div>
  );
}
