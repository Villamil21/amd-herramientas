import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Filter, FileSpreadsheet, Sheet as SheetIcon } from "lucide-react";
import { Alert, Button, Card, PageHeader, useToast } from "../../../components/ui";
import { useShortcut } from "../../../hooks/useShortcut";
import { fileService } from "../../../services/fileService";
import { errorMessage } from "../../../services/tauri";
import type { Workbook } from "../../../types/excel";
import { formatInteger } from "../../../utils/format";
import { Stat } from "../../bank-analysis/shared/components/Stat";
import { StatementFileCard } from "../../bank-analysis/shared/components/StatementFileCard";
import type { ImportState } from "../../bank-analysis/shared/useStatementImport";
import { formatCop } from "../orders/services/format";
import { WithdrawalsTable, type WithdrawalFilter } from "./components/WithdrawalsTable";
import { analyzeWallet, EXPECTED_DESCRIPTION, EXPECTED_TYPE } from "./services/analysis";
import { exportWalletExcel } from "./services/excelExport";
import { readWalletWorkbook } from "./services/workbookReader";
import { WalletHistoryError, type AnalyzedMovement, type Incident, type ReadResult } from "./types";

const LABELS = { pick: "Seleccionar Excel", pickAnother: "Seleccionar otro Excel", analyzing: "Leyendo historial…" };

type Loaded = ReadResult & { workbook: Workbook };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", formatInteger(n)));
/** Primeros elementos de una lista larga, para no saturar las alertas. */
const firstOf = (items: string[], max = 10) => (items.length > max ? [...items.slice(0, max), `… y ${formatInteger(items.length - max)} más`] : items);

/** Deja que la interfaz muestre «Leyendo historial…» antes de procesar. */
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

const describe = (m: AnalyzedMovement, extra: string) =>
  [m.date || "sin fecha", m.id ? `ID ${m.id}` : "sin ID", extra, m.amountCents === null ? "" : formatCop(m.amountCents), m.concept.trim() && `«${m.concept.trim()}»`].filter(Boolean).join(" · ");

export default function WalletHistoryPage() {
  const toast = useToast();
  const [state, setState] = useState<ImportState<Loaded>>({ status: "idle" });
  const [picking, setPicking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [filter, setFilter] = useState<WithdrawalFilter>("all");
  const tableRef = useRef<HTMLDivElement>(null);
  const busy = picking || state.status === "analyzing";

  /** Lee el historial; `sheetName` cuando el usuario eligió entre varias candidatas. */
  const read = useCallback(async (workbook: Workbook, sheetName?: string) => {
    const { fileName } = workbook;
    setExportedPath(null);
    setFilter("all");
    setState({ status: "analyzing", fileName });
    await nextFrame();
    try {
      setState({ status: "done", fileName, pageCount: 0, analysis: { ...readWalletWorkbook(workbook, sheetName), workbook } });
    } catch (e) {
      if (!(e instanceof WalletHistoryError) && import.meta.env.DEV) console.error("[dropi-cartera]", e);
      setState({ status: "error", fileName, message: e instanceof WalletHistoryError ? e.message : "No fue posible leer el archivo. Verifica que sea el historial de cartera exportado desde Dropi." });
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
  const analysis = useMemo(() => (file ? analyzeWallet(file.movements, { checkType: file.hasType }) : undefined), [file]);

  /** Filtra la tabla y la lleva a la vista (desde las alertas y las métricas). */
  const showOnly = (f: WithdrawalFilter) => {
    setFilter(f);
    requestAnimationFrame(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  async function exportExcel() {
    if (!file || !analysis || exporting) return;
    setExporting(true);
    try {
      const path = await exportWalletExcel(file, analysis);
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

  const flagged = (i: Incident) => analysis?.movements.filter((m) => m.incidents.includes(i)) ?? [];
  const filterButton = (f: WithdrawalFilter, label = "Ver solo estas filas") => (
    <div style={{ marginTop: "var(--space-2)" }}>
      <Button size="sm" icon={<Filter size={14} />} onClick={() => showOnly(f)}>
        {label}
      </Button>
    </div>
  );

  return (
    <>
      <PageHeader
        eyebrow="Dropi"
        title="Historial de carteras"
        description="Importa el historial de cartera exportado desde Dropi para resumir los retiros realizados."
        actions={
          analysis && (
            <Button variant="primary" icon={<FileSpreadsheet size={15} />} onClick={() => void exportExcel()} loading={exporting}>
              Exportar Excel
            </Button>
          )
        }
      />

      <StatementFileCard
        state={state}
        details={
          file && (
            <>
              <span>Hoja «{file.sheetName}»</span>
              <span>· {plural(file.movements.length, "1 movimiento", "# movimientos")}</span>
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
        <Card title="Elige la hoja del historial" description="Varias hojas tienen la estructura del historial de cartera de Dropi y la misma cantidad de movimientos. Selecciona la que corresponde.">
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
              <Info label="Archivo seleccionado" value={file.fileName} />
              <Info label="Hoja utilizada" value={file.sheetName} />
              <Info label="Movimientos" value={formatInteger(file.movements.length)} />
              <Info label="Periodo (columna FECHA)" value={file.period ?? "—"} />
              <Info label="Otras hojas (no usadas)" value={file.ignoredSheets.join(", ") || "—"} />
            </div>
          </Card>

          <div className="stat-row">
            <Stat label="Retiros encontrados" value={formatInteger(analysis.totals.count)} onClick={() => showOnly("validated")} active={filter === "validated"} title="Ver solo los retiros validados" />
            <Stat label="Valor total retirado" value={formatCop(analysis.totals.amountCents)} />
            <Stat label="Total valor pagado" value={formatCop(analysis.totals.paidCents)} />
            <Stat label="Total 4x1000" value={formatCop(analysis.totals.gmfCents)} />
            <Stat
              label="Movimientos por revisar"
              value={formatInteger(analysis.review.count)}
              tone={analysis.review.count > 0 ? "negative" : undefined}
              onClick={() => showOnly("review")}
              active={filter === "review"}
              title="Ver solo los movimientos que requieren revisión"
            />
          </div>
          <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
            Los totales incluyen solo los retiros validados. El MONTO de Dropi ya incluye el 4x1000: valor pagado = MONTO / 1,004 y 4x1000 = MONTO − valor pagado.
            Conciliación: {formatCop(analysis.totals.paidCents)} + {formatCop(analysis.totals.gmfCents)} = {formatCop(analysis.totals.paidCents + analysis.totals.gmfCents)}
            {analysis.totals.paidCents + analysis.totals.gmfCents === analysis.totals.amountCents ? " ✓" : " ✗ no coincide con el valor total retirado"}
            {analysis.review.count > 0 && <> · Por revisar (no incluido): {formatCop(analysis.review.amountCents)}</>}
          </p>

          <Alerts analysis={analysis} hasId={file.hasId} flagged={flagged} filterButton={filterButton} />

          <div ref={tableRef} style={{ scrollMarginTop: "var(--space-4)" }}>
            <WithdrawalsTable key={`${file.fileName}:${file.sheetName}`} analysis={analysis} filter={filter} onFilter={setFilter} />
          </div>
        </>
      )}
    </>
  );
}

function Alerts({
  analysis,
  hasId,
  flagged,
  filterButton,
}: {
  analysis: ReturnType<typeof analyzeWallet>;
  hasId: boolean;
  flagged: (i: Incident) => AnalyzedMovement[];
  filterButton: (f: WithdrawalFilter) => ReactNode;
}) {
  const c = analysis.incidentCounts;
  const description = flagged("description");
  const type = flagged("type");
  const duplicate = flagged("duplicate");
  const invalid = flagged("invalid_amount");

  return (
    <>
      {analysis.review.count === 0 && (
        <Alert tone="success" title="Archivo validado">
          Todos los movimientos tienen la descripción «{EXPECTED_DESCRIPTION}»{c.type === 0 ? ` y tipo ${EXPECTED_TYPE}` : ""}.
        </Alert>
      )}
      {c.description > 0 && (
        <Alert
          tone="warning"
          title={plural(c.description, "Se encontró 1 movimiento con una descripción diferente.", "Se encontraron # movimientos con una descripción diferente.")}
          items={firstOf(description.map((m) => describe(m, `«${m.description || "(vacía)"}»`)))}
        >
          Se encontraron movimientos con una descripción diferente a la esperada («{EXPECTED_DESCRIPTION}»). Requieren revisión y no se suman a los totales.
          {filterButton("description")}
        </Alert>
      )}
      {c.type > 0 && (
        <Alert
          tone="warning"
          title={plural(c.type, "Se encontró un movimiento cuyo tipo no es SALIDA.", "Se encontraron # movimientos cuyo tipo no es SALIDA.")}
          items={firstOf(type.map((m) => describe(m, `tipo «${m.type || "(vacío)"}»`)))}
        >
          No se asume que correspondan a un retiro: requieren revisión y no se suman a los totales.
          {filterButton("type")}
        </Alert>
      )}
      {c.duplicate > 0 && (
        <Alert tone="warning" title={plural(c.duplicate, "1 movimiento tiene un ID repetido.", "# movimientos tienen un ID repetido.")} items={firstOf(duplicate.map((m) => describe(m, `fila ${m.rowNumber}`)))}>
          Posibles duplicados: ninguna de las filas con el mismo ID se suma a los totales hasta revisarlas en el archivo original.
          {filterButton("duplicate")}
        </Alert>
      )}
      {c.invalid_amount > 0 && (
        <Alert tone="danger" title={plural(c.invalid_amount, "1 movimiento tiene un MONTO no válido.", "# movimientos tienen un MONTO no válido.")} items={firstOf(invalid.map((m) => describe(m, m.amountProblem ?? "")))}>
          No se calcularon valor pagado ni 4x1000 para esas filas y no se suman a los totales.
          {filterButton("invalid_amount")}
        </Alert>
      )}
      {!hasId && <Alert tone="info">El archivo no trae la columna ID: no fue posible detectar movimientos duplicados.</Alert>}
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
