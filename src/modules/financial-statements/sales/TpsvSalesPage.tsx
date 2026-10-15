import { useMemo, useState } from "react";
import { FolderSearch, Settings2 } from "lucide-react";
import { Alert, Button, Card, PageHeader, useToast } from "../../../components/ui";
import { saveExcelSheets } from "../../bank-analysis/shared/excelExportService";
import { Stat } from "../../bank-analysis/shared/components/Stat";
import { errorMessage } from "../../../services/tauri";
import type { BatchInput } from "../../../types/fs";
import { formatInteger } from "../../../utils/format";
import { CompanySelect } from "../shared/components/CompanySelect";
import { PucSettingsModal } from "../shared/components/PucSettingsModal";
import { SendToFs } from "../shared/components/SendToFs";
import { formatExactCents, formatIsoDate, periodLabel } from "../shared/money";
import { useFsData } from "../shared/useFsData";
import { readTpsvWorkbook } from "./readers";
import { useWorkbook } from "./useWorkbook";

const BUY_KEY = "tpsv.buy";
const SELL_KEY = "tpsv.sell";
const ITEMS = [
  { key: BUY_KEY, label: "Compra de cripto (Código Tipo 2)" },
  { key: SELL_KEY, label: "Venta de cripto (Código Tipo 3)" },
];

/**
 * Ventas → Reporte de operaciones (TPSV). Suma TODAS las filas de «Monto
 * Acumulado» (nunca «Monto Acumulado 2»): Código Tipo 2 = compra, 3 = venta.
 * Fecha contable: «Fecha».
 */
export default function TpsvSalesPage() {
  const toast = useToast();
  const data = useFsData();
  const book = useWorkbook(readTpsvWorkbook);
  const [companyId, setCompanyId] = useState<number | null>(null);
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
  const missingKeys = [valid.some((r) => r.kind === "buy") && !data.settingsMap.get(BUY_KEY) && BUY_KEY, valid.some((r) => r.kind === "sell") && !data.settingsMap.get(SELL_KEY) && SELL_KEY].filter(Boolean) as string[];
  const blocked = !book.result ? "Selecciona el archivo" : companyId === null ? "Selecciona la empresa" : issues.length ? `${issues.length} filas con datos ilegibles` : missingKeys.length ? "Faltan cuentas PUC del reporte de operaciones" : valid.length === 0 ? "No hay operaciones para enviar" : null;

  function build(): BatchInput | null {
    if (!book.result || companyId === null) return null;
    const dates = valid.map((r) => r.date!).sort();
    return {
      companyId,
      source: "sales_tpsv",
      fileName: book.result.fileName,
      periodLabel: `Reporte de operaciones · ${book.result.fileName}`,
      periodStart: dates[0],
      periodEnd: dates[dates.length - 1],
      metadata: { sheets: book.result.data.sheets, otherTypes: other.length, repeated: repeated.length },
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
        `Operaciones_EEFF_${book.result.fileName.replace(/\.xlsx?$/i, "")}`,
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
        title="Reporte de operaciones"
        description="Importa el reporte de operaciones (TPSV). Se revisan todas las hojas con la estructura válida y se suman todas las filas de «Monto Acumulado»."
        actions={
          <Button icon={<Settings2 size={15} />} onClick={() => setSettingsOpen(true)}>
            Cuentas PUC
          </Button>
        }
      />
      <Card>
        <div className="row row--between" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
          <CompanySelect companies={data.companies} value={companyId} onChange={setCompanyId} />
          <div className="row">
            {book.result && <span className="muted">{book.result.fileName} · Hojas: {book.result.data.sheets.join(", ")}</span>}
            <Button variant="primary" icon={<FolderSearch size={15} />} onClick={() => void book.pick()} loading={book.picking}>
              {book.result ? "Seleccionar otro Excel" : "Seleccionar Excel"}
            </Button>
          </div>
        </div>
      </Card>
      {book.error && <Alert tone="danger">{book.error}</Alert>}
      {book.result && (
        <>
          {issues.length > 0 && <Alert tone="danger" title="Filas con datos ilegibles" items={issues.slice(0, 8).map((r) => `Hoja ${r.sheet}, fila ${r.rowNumber}: ${r.issue}`)} />}
          {repeated.length > 0 && <Alert tone="warning">{formatInteger(repeated.length)} filas repetidas en el archivo (mismo N° Registro, Fecha, Código Tipo y Monto): no se suman dos veces.</Alert>}
          {other.length > 0 && <Alert tone="info">{formatInteger(other.length)} filas con otro Código Tipo (ni 2 ni 3): no se envían.</Alert>}
          {missingKeys.length > 0 && (
            <Alert tone="warning" title="Faltan cuentas PUC del reporte de operaciones">
              <Button size="sm" onClick={() => setSettingsOpen(true)}>
                Configurar
              </Button>
            </Alert>
          )}
          <div className="stat-row">
            <Stat label="Compras de cripto" value={formatExactCents(buys)} />
            <Stat label="Ventas de cripto" value={formatExactCents(sells)} />
            <Stat label="Resultado propio" value={formatExactCents(sells - buys)} tone={sells - buys < 0 ? "negative" : "positive"} />
            <Stat label="Operaciones" value={formatInteger(valid.length)} />
          </div>
          <Card flush title="Por mes (columna Fecha)">
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
                      <td style={{ textAlign: "right" }}>{formatExactCents(v.buys)}</td>
                      <td style={{ textAlign: "right" }}>{formatExactCents(v.sells)}</td>
                      <td style={{ textAlign: "right" }}>{formatExactCents(v.sells - v.buys)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Estados Financieros" description="En el Generador, la presentación Banco u OTC decide cómo se muestran estas operaciones; el resultado es el mismo en ambas.">
            <SendToFs blocked={blocked} build={build} onExport={exportExcel} exporting={exporting} duplicateTitle="Algunas operaciones ya fueron enviadas." />
          </Card>
        </>
      )}
      <PucSettingsModal open={settingsOpen} title="Cuentas PUC del reporte de operaciones" items={ITEMS} index={data.index} settings={data.settingsMap} mappings={data.mappingMap} required={missingKeys} onClose={() => setSettingsOpen(false)} onSaved={data.reloadSettings} onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])} />
    </>
  );
}
