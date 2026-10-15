import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, FolderSearch, Settings2 } from "lucide-react";
import { navigate, paths } from "../../../app/router";
import { Alert, Button, Card, PageHeader, Select, useToast } from "../../../components/ui";
import { saveExcelSheets } from "../../bank-analysis/shared/excelExportService";
import { Stat } from "../../bank-analysis/shared/components/Stat";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import { SALES_DOC_CATEGORY_LABEL, type BatchInput, type SalesDocCategory, type SalesDocType } from "../../../types/fs";
import { formatInteger } from "../../../utils/format";
import { findCompanyByNit, namesMatch } from "../shared/companyMatch";
import { PucSettingsModal } from "../shared/components/PucSettingsModal";
import { SendToFs } from "../shared/components/SendToFs";
import { formatExactCents, formatIsoDate, periodLabel } from "../shared/money";
import { useFsData } from "../shared/useFsData";
import { einvoiceDocumentId, readEInvoiceWorkbook } from "./readers";
import { useWorkbook } from "./useWorkbook";

const SALE_KEY = "sales.einvoice.sale";
const RETURN_KEY = "sales.einvoice.return";
const ITEMS = [
  { key: SALE_KEY, label: "Ventas por facturación electrónica" },
  { key: RETURN_KEY, label: "Devoluciones (notas crédito)" },
];

/**
 * Ventas → Facturación electrónica. Base = Total − (IVA … Rete ICA). La empresa
 * es la del NIT Emisor (el nombre solo valida). Venta suma; devolución resta.
 */
export default function EInvoiceSalesPage() {
  const toast = useToast();
  const data = useFsData();
  const book = useWorkbook(readEInvoiceWorkbook);
  const [types, setTypes] = useState<SalesDocType[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nameDecision, setNameDecision] = useState<"process" | null>(null);
  const [exporting, setExporting] = useState(false);

  const loadTypes = () => fsService.salesDocTypes().then(setTypes, (e) => toast(errorMessage(e), "error"));
  useEffect(() => {
    void loadTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => setNameDecision(null), [book.result]);

  const rows = useMemo(() => book.result?.data.rows ?? [], [book.result]);
  const category = useMemo(() => new Map(types.map((t) => [t.normalizedLabel, t.category])), [types]);
  const unknownTypes = [...new Map(rows.filter((r) => r.docType && !category.has(r.docTypeKey)).map((r) => [r.docTypeKey, r.docType])).entries()];
  const issuers = [...new Set(rows.map((r) => r.issuerNit))];
  const company = issuers.length === 1 ? findCompanyByNit(data.companies ?? [], issuers[0]) : undefined;
  const issuerName = rows[0]?.issuerName;
  const nameMismatch = company && !namesMatch(issuerName, company.razonSocial);
  const issues = rows.filter((r) => r.issue);
  const counted = rows.filter((r) => !r.issue && category.get(r.docTypeKey) && category.get(r.docTypeKey) !== "ignore");
  const totals = { sale: 0, return: 0, saleCount: 0, returnCount: 0, ignored: rows.filter((r) => category.get(r.docTypeKey) === "ignore").length };
  const byMonth = new Map<string, { count: number; cents: number }>();
  for (const r of counted) {
    const sign = category.get(r.docTypeKey) === "return" ? -1 : 1;
    const value = sign * Math.abs(r.baseCents);
    if (sign > 0) {
      totals.sale += value;
      totals.saleCount++;
    } else {
      totals.return += value;
      totals.returnCount++;
    }
    const m = byMonth.get(r.issueDate!.slice(0, 7)) ?? { count: 0, cents: 0 };
    m.count++;
    m.cents += value;
    byMonth.set(r.issueDate!.slice(0, 7), m);
  }
  const missingKeys = [totals.saleCount && !data.settingsMap.get(SALE_KEY) && SALE_KEY, totals.returnCount && !data.settingsMap.get(RETURN_KEY) && RETURN_KEY].filter(Boolean) as string[];

  const blocked = !book.result
    ? "Selecciona el archivo"
    : issuers.length > 1
      ? "El archivo tiene documentos de varios emisores"
      : !company
        ? `No hay una empresa registrada con NIT ${issuers[0] ?? ""}`
        : nameMismatch && nameDecision !== "process"
          ? "El nombre del emisor no coincide con la empresa"
          : issues.length
            ? `${issues.length} filas con datos ilegibles`
            : unknownTypes.length
              ? `${unknownTypes.length} tipos de documento sin clasificar`
              : missingKeys.length
                ? "Faltan cuentas PUC de ventas"
                : counted.length === 0
                  ? "No hay documentos para enviar"
                  : null;

  function build(): BatchInput | null {
    if (!company || !book.result) return null;
    const dates = counted.map((r) => r.issueDate!).sort();
    return {
      companyId: company.id,
      source: "sales_einvoice",
      fileName: book.result.fileName,
      periodLabel: `Facturación electrónica · ${book.result.fileName}`,
      periodStart: dates[0],
      periodEnd: dates[dates.length - 1],
      metadata: { sheets: book.result.data.sheets, taxColumns: book.result.data.taxColumns, ignoredDocuments: totals.ignored },
      movements: counted.map((r) => {
        const isReturn = category.get(r.docTypeKey) === "return";
        return {
          accountingDate: r.issueDate!,
          conceptKey: isReturn ? "sales.return" : "sales.sale",
          documentId: einvoiceDocumentId(r),
          documentNumber: r.number,
          documentType: r.docType,
          pucCode: data.settingsMap.get(isReturn ? RETURN_KEY : SALE_KEY)!,
          amountCents: (isReturn ? -1 : 1) * Math.abs(r.baseCents),
          description: `${r.docType} ${r.number}${r.receiverName ? ` — ${r.receiverName}` : ""}`,
          detail: { sheet: r.sheet, row: r.rowNumber, totalCents: r.totalCents, taxesCents: r.taxesCents, receiverNit: r.receiverNit, status: r.status },
        };
      }),
      decisions: nameMismatch && nameDecision === "process" ? [{ documentKey: book.result.fileName, decision: "Procesar de todas formas", detail: `NIT ${issuers[0]} de ${company.razonSocial}; el archivo dice «${issuerName}».` }] : [],
    };
  }

  async function exportExcel() {
    if (!book.result) return null;
    setExporting(true);
    try {
      const path = await saveExcelSheets(
        [
          {
            name: "Documentos",
            columns: ["Hoja", "Fila", "Tipo de documento", "Clasificación", "Número", "Fecha Emisión", "NIT Receptor", "Nombre Receptor", "Total", "Impuestos (IVA … Rete ICA)", "Base"].map((header, i) => ({ header, kind: i >= 8 ? ("money" as const) : i === 1 ? ("integer" as const) : ("text" as const) })),
            rows: rows.map((r) => [r.sheet, r.rowNumber, r.docType, category.get(r.docTypeKey) ? SALES_DOC_CATEGORY_LABEL[category.get(r.docTypeKey)!] : "Sin clasificar", r.number, r.issueDate ? formatIsoDate(r.issueDate) : "", r.receiverNit, r.receiverName, r.totalCents / 100, r.taxesCents / 100, r.baseCents / 100]),
          },
        ],
        `Ventas_EEFF_${book.result.fileName.replace(/\.xlsx?$/i, "")}`,
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

  async function classify(key: string, original: string, value: SalesDocCategory) {
    try {
      await fsService.saveSalesDocType(key, original, value);
      await loadTypes();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Estados Financieros · Ventas"
        title="Facturación electrónica"
        description="Importa el Excel de facturación electrónica. La base de cada documento es el Total menos las columnas desde IVA hasta Rete ICA."
        actions={
          <Button icon={<Settings2 size={15} />} onClick={() => setSettingsOpen(true)}>
            Cuentas PUC de ventas
          </Button>
        }
      />
      <Card>
        <div className="row row--between">
          <span className="muted">{book.result ? `${book.result.fileName} · Hojas: ${book.result.data.sheets.join(", ")}` : "El archivo se lee en este equipo; las hojas y columnas se ubican por sus encabezados."}</span>
          <Button variant="primary" icon={<FolderSearch size={15} />} onClick={() => void book.pick()} loading={book.picking}>
            {book.result ? "Seleccionar otro Excel" : "Seleccionar Excel"}
          </Button>
        </div>
      </Card>
      {book.error && <Alert tone="danger">{book.error}</Alert>}

      {book.result && (
        <>
          <SendToFs
            blocked={blocked}
            blockedStatus={unknownTypes.length || missingKeys.length ? "Pendiente de clasificación" : "Requiere revisión"}
            build={build}
            onExport={exportExcel}
            exporting={exporting}
            duplicateTitle="Algunos documentos ya fueron enviados."
          />
          {issuers.length > 1 && <Alert tone="danger">El archivo trae documentos de varios emisores ({issuers.join(", ")}): importa uno por empresa.</Alert>}
          {issuers.length === 1 && !company && (
            <Alert tone="danger" title={`No hay una empresa registrada con NIT ${issuers[0]}`}>
              La empresa se identifica por el NIT Emisor. <Button size="sm" onClick={() => navigate(paths.companies)}>Ir a Empresas</Button>
            </Alert>
          )}
          {company && <Alert tone="info">Empresa (por NIT Emisor): {company.razonSocial} — NIT {company.nit}</Alert>}
          {nameMismatch && nameDecision !== "process" && (
            <Alert tone="danger" title="El nombre del emisor no coincide">
              El NIT {issuers[0]} corresponde a {company!.razonSocial}, pero el archivo dice «{issuerName}».
              <div className="row" style={{ marginTop: 8 }}>
                <Button size="sm" onClick={book.clear}>
                  Ignorar
                </Button>
                <Button size="sm" variant="primary" onClick={() => setNameDecision("process")}>
                  Procesar de todas formas
                </Button>
              </div>
            </Alert>
          )}
          {unknownTypes.length > 0 && (
            <Card title="Tipos de documento sin clasificar" description="La decisión se guarda y se usará en próximas importaciones.">
              <div className="stack stack--sm">
                {unknownTypes.map(([key, label]) => (
                  <div key={key} className="row row--between">
                    <span>
                      «{label}» · {formatInteger(rows.filter((r) => r.docTypeKey === key).length)} documentos
                    </span>
                    <Select aria-label={`Clasificar ${label}`} value="" onChange={(e) => void classify(key, label, e.target.value as SalesDocCategory)} style={{ width: "auto" }}>
                      <option value="">Seleccionar…</option>
                      <option value="sale">Venta</option>
                      <option value="return">Devolución</option>
                      <option value="ignore">Ignorar</option>
                    </Select>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {issues.length > 0 && <Alert tone="danger" title="Filas con datos ilegibles" items={issues.slice(0, 8).map((r) => `Hoja ${r.sheet}, fila ${r.rowNumber}: ${r.issue}`)} />}
          {missingKeys.length > 0 && (
            <Alert tone="warning" title="Faltan cuentas PUC de ventas">
              <Button size="sm" onClick={() => setSettingsOpen(true)}>
                Configurar
              </Button>
            </Alert>
          )}

          <div className="stat-row">
            <Stat label="Ventas" value={formatInteger(totals.saleCount)} />
            <Stat label="Base ventas" value={formatExactCents(totals.sale)} />
            <Stat label="Devoluciones" value={formatInteger(totals.returnCount)} />
            <Stat label="Base devoluciones" value={formatExactCents(totals.return)} tone={totals.return ? "negative" : undefined} />
            <Stat label="Neto" value={formatExactCents(totals.sale + totals.return)} />
            <Stat label="Ignorados" value={formatInteger(totals.ignored)} />
          </div>

          <Card flush title="Por mes (fecha de emisión)">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th style={{ textAlign: "right" }}>Documentos</th>
                    <th style={{ textAlign: "right" }}>Base neta</th>
                  </tr>
                </thead>
                <tbody>
                  {[...byMonth.entries()].sort().map(([m, v]) => (
                    <tr key={m}>
                      <td>{periodLabel(m)}</td>
                      <td style={{ textAlign: "right" }}>{formatInteger(v.count)}</td>
                      <td className="nowrap" style={{ textAlign: "right" }}>
                        {formatExactCents(v.cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      <PucSettingsModal open={settingsOpen} title="Cuentas PUC de ventas" items={ITEMS} index={data.index} settings={data.settingsMap} mappings={data.mappingMap} required={missingKeys} onClose={() => setSettingsOpen(false)} onSaved={data.reloadSettings} onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])} />
      {!book.result && !book.error && (
        <Card>
          <div className="row">
            <FileSpreadsheet size={18} />
            <span className="muted">Columnas requeridas: Tipo de documento, CUFE/CUDE, Folio, Prefijo, Fecha Emisión, NIT Emisor, Nombre Emisor, IVA … Rete ICA, Total.</span>
          </div>
        </Card>
      )}
    </>
  );
}
