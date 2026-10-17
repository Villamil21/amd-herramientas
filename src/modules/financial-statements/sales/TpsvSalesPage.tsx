import { useEffect, useMemo, useState } from "react";
import { CalendarX2, FolderSearch, Settings2 } from "lucide-react";
import { Alert, Button, Card, ContextBar, MetricBar, PageHeader, useToast } from "../../../components/ui";
import { saveExcelSheets } from "../../bank-analysis/shared/excelExportService";
import { fromBase64 } from "../../bank-analysis/shared/statementService";
import { fileService } from "../../../services/fileService";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import { EmptyPeriodModal } from "../shared/components/EmptyPeriodModal";
import { SourceCoverage } from "../shared/components/SourceCoverage";
import type { BatchInput } from "../../../types/fs";
import { formatInteger } from "../../../utils/format";
import { CompanySelect } from "../shared/components/CompanySelect";
import { PucSettingsModal } from "../shared/components/PucSettingsModal";
import { SendToFs } from "../shared/components/SendToFs";
import { describeMonths, formatExactCents, formatIsoDate, periodLabel } from "../shared/money";
import { useFsData } from "../shared/useFsData";
import { readTpsvWorkbook, SalesFormatError, tpsvTextToWorkbook, type TpsvRead } from "./readers";

/** TXT del reporte: UTF-8 y, si no lo es, Latin-1 (los archivos de la entidad no siempre declaran su codificación). */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

const BUY_KEY = "tpsv.buy";
const SELL_KEY = "tpsv.sell";
const ITEMS = [
  { key: BUY_KEY, label: "Compra de cripto (Código Tipo 2)" },
  { key: SELL_KEY, label: "Venta de cripto (Código Tipo 3)" },
];

/**
 * Ventas → Reportes UIAF (TPSV). Suma TODAS las filas de «Monto
 * Acumulado» (nunca «Monto Acumulado 2»): Código Tipo 2 = compra, 3 = venta.
 * Fecha contable: «Fecha».
 */
export default function TpsvSalesPage() {
  const toast = useToast();
  const data = useFsData();
  const [book, setBook] = useState<{ result: { fileName: string; format: "Excel" | "TXT"; data: TpsvRead } | null; error: string | null; picking: boolean }>({ result: null, error: null, picking: false });
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [sentKey, setSentKey] = useState(0);
  /** Huellas ya enviadas (operaciones activas de la empresa) → importación: detecta el TXT y su Excel equivalente. */
  const [sent, setSent] = useState<Map<string, number>>(new Map());

  /** Importa el reporte en Excel (.xlsx / .xls) o TXT; ambos se normalizan a la misma estructura. */
  async function pick() {
    setBook((b) => ({ ...b, picking: true, error: null }));
    try {
      const picked = await fileService.pickExcelOrText("Importar reporte UIAF");
      if (!picked) return setBook((b) => ({ ...b, picking: false }));
      try {
        const result =
          picked.kind === "excel"
            ? { fileName: picked.workbook.fileName, format: "Excel" as const, data: readTpsvWorkbook(picked.workbook) }
            : { fileName: picked.fileName, format: "TXT" as const, data: readTpsvWorkbook(tpsvTextToWorkbook(picked.fileName, decodeText(fromBase64(picked.dataBase64)))) };
        setBook({ result, error: null, picking: false });
      } catch (e) {
        setBook({ result: null, picking: false, error: e instanceof SalesFormatError ? e.message : "No fue posible leer el archivo. Verifica que sea el reporte UIAF." });
      }
    } catch (e) {
      toast(errorMessage(e), "error");
      setBook((b) => ({ ...b, picking: false }));
    }
  }

  useEffect(() => {
    if (companyId === null) return setSent(new Map());
    fsService.movements(companyId).then(
      (list) => setSent(new Map(list.filter((m) => m.source === "sales_tpsv" && m.status === "active").map((m) => [m.documentId, m.batchId]))),
      () => setSent(new Map()),
    );
  }, [companyId, sentKey]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const rows = useMemo(() => book.result?.data.rows ?? [], [book.result]);
  const valid = rows.filter((r) => r.kind && !r.repeated && !r.issue);
  const issues = rows.filter((r) => r.kind && r.issue);
  const other = rows.filter((r) => !r.kind);
  const repeated = rows.filter((r) => r.repeated);
  const sum = (kind: "buy" | "sell") => valid.filter((r) => r.kind === kind).reduce((s, r) => s + r.amountCents, 0);
  const buys = sum("buy");
  const sells = sum("sell");
  const months = new Map<string, { buys: number; sells: number; count: number }>();
  for (const r of valid) {
    const m = months.get(r.date!.slice(0, 7)) ?? { buys: 0, sells: 0, count: 0 };
    if (r.kind === "buy") m.buys += r.amountCents;
    else m.sells += r.amountCents;
    m.count++;
    months.set(r.date!.slice(0, 7), m);
  }
  const alreadySent = valid.filter((r) => sent.has(r.fingerprint));
  const sentBatches = [...new Set(alreadySent.map((r) => sent.get(r.fingerprint)!))];
  const detected = describeMonths(valid.map((r) => r.date!.slice(0, 7)));
  const missingKeys = [valid.some((r) => r.kind === "buy") && !data.settingsMap.get(BUY_KEY) && BUY_KEY, valid.some((r) => r.kind === "sell") && !data.settingsMap.get(SELL_KEY) && SELL_KEY].filter(Boolean) as string[];
  const blocked = !book.result ? "Selecciona el archivo" : companyId === null ? "Selecciona la empresa" : issues.length ? `${issues.length} filas con datos ilegibles` : missingKeys.length ? "Faltan cuentas PUC de Reportes UIAF" : valid.length === 0 ? "No hay operaciones para enviar" : null;

  function build(): BatchInput | null {
    if (!book.result || companyId === null) return null;
    const dates = valid.map((r) => r.date!).sort();
    return {
      companyId,
      source: "sales_tpsv",
      fileName: book.result.fileName,
      periodLabel: `Reportes UIAF · ${book.result.fileName}`,
      periodStart: dates[0],
      periodEnd: dates[dates.length - 1],
      metadata: { format: book.result.format, sheets: book.result.data.sheets, otherTypes: other.length, repeated: repeated.length },
      movements: valid.map((r) => ({
        accountingDate: r.date!,
        conceptKey: `tpsv.${r.kind}`,
        documentId: r.fingerprint,
        documentNumber: r.registro,
        documentType: r.kind === "buy" ? "Compra de cripto" : "Venta de cripto",
        pucCode: data.settingsMap.get(r.kind === "buy" ? BUY_KEY : SELL_KEY)!,
        amountCents: r.amountCents,
        description: `N° Registro ${r.registro} · Código Tipo ${r.typeCode}`,
        detail: { sheet: r.sheet, row: r.rowNumber, fingerprint: r.fingerprint },
      })),
    };
  }

  async function exportExcel() {
    if (!book.result) return null;
    setExporting(true);
    try {
      const path = await saveExcelSheets(
        [
          {
            name: "Operaciones",
            columns: [
              { header: "Hoja", kind: "text" },
              { header: "N° Registro", kind: "text" },
              { header: "Fecha", kind: "text" },
              { header: "Código Tipo", kind: "text" },
              { header: "Operación", kind: "text" },
              { header: "Monto Acumulado", kind: "money" },
            ],
            rows: rows.map((r) => [r.sheet, r.registro, r.date ? formatIsoDate(r.date) : "", r.typeCode, r.repeated ? "Repetida (no suma)" : r.kind === "buy" ? "Compra" : r.kind === "sell" ? "Venta" : "Otro (no suma)", r.amountCents / 100]),
          },
          {
            name: "Por mes",
            columns: [
              { header: "Mes", kind: "text" },
              { header: "Compras", kind: "money" },
              { header: "Ventas", kind: "money" },
              { header: "Resultado propio", kind: "money" },
            ],
            rows: [...months.entries()].sort().map(([m, v]) => [periodLabel(m), v.buys / 100, v.sells / 100, (v.sells - v.buys) / 100]),
          },
        ],
        `Operaciones_EEFF_${book.result.fileName.replace(/\.(xlsx?|txt)$/i, "")}`,
      );
      if (path) toast("Excel exportado.");
      return path;
    } catch (e) {
      toast(errorMessage(e), "error");
      return null;
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Estados Financieros · Ventas"
        title="Reportes UIAF"
        description="Importa el reporte UIAF (TPSV) en Excel o TXT. Se revisan todas las hojas con la estructura válida y se suman todas las filas de «Monto Acumulado»."
        actions={
          <>
            <Button icon={<CalendarX2 size={15} />} onClick={() => setEmptyOpen(true)}>
              Registrar periodo sin operaciones
            </Button>
            <Button icon={<Settings2 size={15} />} onClick={() => setSettingsOpen(true)}>
              Cuentas PUC
            </Button>
          </>
        }
      />
      {!book.result ? (
        <Card>
          <div className="row row--between" style={{ flexWrap: "wrap" }}>
            <p className="muted">Acepta el reporte en Excel (.xlsx o .xls) o en TXT: ambos se leen con las mismas reglas.</p>
            <Button variant="primary" icon={<FolderSearch size={15} />} onClick={() => void pick()} loading={book.picking}>
              Importar reporte
            </Button>
          </div>
        </Card>
      ) : (
        <ContextBar
          items={[
            { label: "Periodo", value: detected || "—", hint: detected ? "Por la columna Fecha" : undefined },
            { label: "Archivo", value: book.result.fileName, selectable: true, hint: `${book.result.format}${book.result.format === "Excel" ? ` · Hojas: ${book.result.data.sheets.join(", ")}` : ""}` },
            { label: "Operaciones", value: formatInteger(valid.length) },
          ]}
          actions={
            <Button size="sm" icon={<FolderSearch size={14} />} onClick={() => void pick()} loading={book.picking}>
              Cambiar archivo
            </Button>
          }
        >
          <div className="bank-head__fields">
            <CompanySelect companies={data.companies} value={companyId} onChange={setCompanyId} />
          </div>
        </ContextBar>
      )}
      {book.error && <Alert tone="danger">{book.error}</Alert>}
      {book.result && (
        <>
          <SendToFs
            blocked={blocked}
            blockedStatus={missingKeys.length && blocked?.startsWith("Faltan cuentas") ? "Pendiente de clasificación" : "Requiere revisión"}
            build={build}
            onExport={exportExcel}
            exporting={exporting}
            duplicateTitle="Algunas operaciones ya fueron enviadas."
            onSent={() => setSentKey((k) => k + 1)}
          />
          <SourceCoverage companyId={companyId} source="sales_tpsv" year={valid.length ? Number(valid.map((r) => r.date!).sort().reverse()[0].slice(0, 4)) : new Date().getFullYear()} refreshKey={sentKey} />
          {alreadySent.length > 0 && (
            <Alert tone="warning" title="Posible duplicado">
              {alreadySent.length === valid.length ? "Todas las operaciones" : `${formatInteger(alreadySent.length)} de ${formatInteger(valid.length)} operaciones`} de este archivo ya fueron enviadas (importación {sentBatches.map((id) => `#${id}`).join(", ")}),
              posiblemente desde su {book.result.format === "TXT" ? "Excel" : "TXT"} equivalente. Al enviar se pedirá reemplazar; nunca se suman dos veces.
            </Alert>
          )}
          {issues.length > 0 && <Alert tone="danger" title="Filas con datos ilegibles" items={issues.slice(0, 8).map((r) => `Hoja ${r.sheet}, fila ${r.rowNumber}: ${r.issue}`)} />}
          {repeated.length > 0 && <Alert tone="warning">{formatInteger(repeated.length)} filas repetidas en el archivo (mismo N° Registro, Fecha, Código Tipo y Monto): no se suman dos veces.</Alert>}
          {other.length > 0 && <Alert tone="info">{formatInteger(other.length)} filas con otro Código Tipo (ni 2 ni 3): no se envían.</Alert>}
          {missingKeys.length > 0 && (
            <Alert tone="warning" title="Faltan cuentas PUC de Reportes UIAF">
              <Button size="sm" onClick={() => setSettingsOpen(true)}>
                Configurar
              </Button>
            </Alert>
          )}
          <MetricBar
            label="Resumen del reporte"
            metrics={[
              { key: "ops", label: valid.length === 1 ? "operación" : "operaciones", value: formatInteger(valid.length) },
              { key: "buys", label: "compras (Tipo 2)", value: formatExactCents(buys) },
              { key: "sells", label: "ventas (Tipo 3)", value: formatExactCents(sells) },
              { key: "result", label: "resultado propio", value: formatExactCents(sells - buys), tone: sells - buys < 0 ? "negative" : "positive" },
            ]}
          />
          <Card flush title="Resumen por tipo" description="Se usa siempre «Monto Acumulado» (nunca «Monto Acumulado 2»).">
            <div className="table-wrap">
              <table className="table table--dense">
                <thead>
                  <tr>
                    <th>Código Tipo</th>
                    <th>Operación</th>
                    <th className="num">Operaciones</th>
                    <th className="num">Monto Acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {(["buy", "sell"] as const).map((kind) => (
                    <tr key={kind}>
                      <td>{kind === "buy" ? "2" : "3"}</td>
                      <td>{kind === "buy" ? "Compra de cripto" : "Venta de cripto"}</td>
                      <td className="num">{formatInteger(valid.filter((r) => r.kind === kind).length)}</td>
                      <td className="num">{formatExactCents(sum(kind))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card flush title="Por mes (columna Fecha)" description="En el Generador, la presentación Banco u OTC decide cómo se muestran estas operaciones; el resultado es el mismo en ambas.">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th style={{ textAlign: "right" }}>Operaciones</th>
                    <th style={{ textAlign: "right" }}>Compras</th>
                    <th style={{ textAlign: "right" }}>Ventas</th>
                    <th style={{ textAlign: "right" }}>Resultado propio</th>
                  </tr>
                </thead>
                <tbody>
                  {[...months.entries()].sort().map(([m, v]) => (
                    <tr key={m}>
                      <td>{periodLabel(m)}</td>
                      <td style={{ textAlign: "right" }}>{formatInteger(v.count)}</td>
                      <td className="nowrap" style={{ textAlign: "right" }}>
                        {formatExactCents(v.buys)}
                      </td>
                      <td className="nowrap" style={{ textAlign: "right" }}>
                        {formatExactCents(v.sells)}
                      </td>
                      <td className="nowrap" style={{ textAlign: "right" }}>
                        {formatExactCents(v.sells - v.buys)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      <EmptyPeriodModal open={emptyOpen} source="sales_tpsv" companies={data.companies} companyId={companyId} defaultMonth={valid.length ? valid.map((r) => r.date!.slice(0, 7)).sort()[0] : null} onClose={() => setEmptyOpen(false)} onChanged={() => setSentKey((k) => k + 1)} />
      <PucSettingsModal open={settingsOpen} title="Cuentas PUC de Reportes UIAF" items={ITEMS} index={data.index} settings={data.settingsMap} mappings={data.mappingMap} required={missingKeys} onClose={() => setSettingsOpen(false)} onSaved={data.reloadSettings} onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])} />
    </>
  );
}
