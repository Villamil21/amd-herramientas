import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Filter, FileSpreadsheet, Sheet as SheetIcon, XCircle } from "lucide-react";
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
import { analyzeWallet } from "./services/analysis";
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
  /** Valor pagado editado a mano por fila de Excel (solo esta sesión; el MONTO original no cambia). */
  const [manual, setManual] = useState<ReadonlyMap<number, number>>(new Map());
  const tableRef = useRef<HTMLDivElement>(null);
  const busy = picking || state.status === "analyzing";

  /** Lee el historial; `sheetName` cuando el usuario eligió entre varias candidatas. */
  const read = useCallback(async (workbook: Workbook, sheetName?: string) => {
    const { fileName } = workbook;
    setExportedPath(null);
    setFilter("all");
    setManual(new Map());
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
  const analysis = useMemo(() => (file ? analyzeWallet(file.movements, { checkType: file.hasType, manual }) : undefined), [file, manual]);
  const editPaid = (rowNumber: number, paidCents: number | null) =>
    setManual((prev) => {
      const next = new Map(prev);
      if (paidCents === null) next.delete(rowNumber);
      else next.set(rowNumber, paidCents);
      return next;
    });
  /** El archivo puede no traer ningún retiro de saldo: los demás conceptos se ignoran. */
  const hasWithdrawals = !!analysis && analysis.movements.length > 0;

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
        title="Historial de cartera"
        description="Importa el historial de cartera exportado desde Dropi para resumir los retiros realizados."
        actions={
          hasWithdrawals && (
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

          {!hasWithdrawals && <Alert tone="info">No se encontraron retiros de saldo en cartera en este archivo.</Alert>}
        </>
      )}

      {file && analysis && hasWithdrawals && (
        <>
          <WalletBand analysis={analysis} filter={filter} onReview={() => showOnly("review")} onValidated={() => showOnly("validated")} />

          <Alerts analysis={analysis} hasId={file.hasId} flagged={flagged} filterButton={filterButton} />

          <div ref={tableRef} style={{ scrollMarginTop: "var(--space-4)" }}>
            <WithdrawalsTable key={`${file.fileName}:${file.sheetName}`} analysis={analysis} filter={filter} onFilter={setFilter} onEditPaid={editPaid} />
          </div>
        </>
      )}
    </>
  );
}

/** Banda superior: Retiros · Valor pagado · 4x1000 · Total retirado, y la conciliación de los tres. */
function WalletBand({ analysis, filter, onReview, onValidated }: { analysis: ReturnType<typeof analyzeWallet>; filter: WithdrawalFilter; onReview: () => void; onValidated: () => void }) {
  const t = analysis.totals;
  const reconciled = t.paidCents + t.gmfCents === t.amountCents;
  return (
    <div className="wallet-band">
      <div className="stat-row">
        <Stat label="Retiros" value={formatInteger(t.count)} onClick={onValidated} active={filter === "validated"} title="Ver solo los retiros validados" />
        <Stat label="Valor pagado" value={formatCop(t.paidCents)} />
        <Stat label="4x1000" value={formatCop(t.gmfCents)} />
        <Stat label="Total retirado" value={formatCop(t.amountCents)} />
        {analysis.review.count > 0 && <Stat label="Por revisar" value={formatInteger(analysis.review.count)} tone="negative" onClick={onReview} active={filter === "review"} title="Ver solo los retiros que requieren revisión (no se suman)" />}
      </div>
      <div className={`wallet-band__check ${reconciled ? "is-ok" : "is-bad"}`}>
        {reconciled ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
        Valor pagado + 4x1000 = Total retirado: {formatCop(t.paidCents)} + {formatCop(t.gmfCents)} = {formatCop(t.paidCents + t.gmfCents)}
        {analysis.review.count > 0 && <span className="muted"> · Por revisar (no incluido): {formatCop(analysis.review.amountCents)}</span>}
      </div>
    </div>
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
  const type = flagged("type");
  const duplicate = flagged("duplicate");
  const invalid = flagged("invalid_amount");
  const gmf = flagged("gmf_review");

  return (
    <>
      {analysis.review.count === 0 && (
        <Alert tone="success" title="Archivo validado">
          {plural(analysis.totals.count, "El retiro de saldo en cartera encontrado quedó validado.", "Los # retiros de saldo en cartera encontrados quedaron validados.")}
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
      {c.gmf_review > 0 && (
        <Alert
          tone="warning"
          title={plural(c.gmf_review, "1 retiro requiere revisar el 4x1000.", "# retiros requieren revisar el 4x1000.")}
          items={firstOf(gmf.map((m) => describe(m, `fila ${m.rowNumber}`)))}
        >
          Ningún valor pagado entero produce ese MONTO con la regla de Dropi (MONTO = valor pagado / 0,996). Despliega la fila y escribe el valor pagado: el 4x1000 es la diferencia con el MONTO.
          {filterButton("gmf_review")}
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
