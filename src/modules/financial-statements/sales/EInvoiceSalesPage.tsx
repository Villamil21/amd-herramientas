import { useEffect, useMemo, useState } from "react";
import { CalendarX2, FileSpreadsheet, FolderSearch, Settings2 } from "lucide-react";
import { navigate, paths } from "../../../app/router";
import { Alert, Badge, Button, Card, ContextBar, MetricBar, PageHeader, Select, useToast } from "../../../components/ui";
import { saveExcelSheets } from "../../bank-analysis/shared/excelExportService";
import { SearchBox, SegmentedFilter } from "../../bank-analysis/shared/components/tableControls";
import { EmptyPeriodModal } from "../shared/components/EmptyPeriodModal";
import { SourceCoverage } from "../shared/components/SourceCoverage";
import { normalizeKey } from "../../../utils/text";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import { SALES_DOC_CATEGORY_LABEL, type BatchInput, type SalesDocCategory, type SalesDocType } from "../../../types/fs";
import { formatInteger } from "../../../utils/format";
import { findCompanyByNit, namesMatch } from "../shared/companyMatch";
import { PucSettingsModal } from "../shared/components/PucSettingsModal";
import { SendToFs } from "../shared/components/SendToFs";
import { describeMonths, formatExactCents, formatIsoDate, periodLabel } from "../shared/money";
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
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [sentKey, setSentKey] = useState(0);
  const [docFilter, setDocFilter] = useState<"all" | SalesDocCategory | "unclassified" | "issues">("all");
  const [query, setQuery] = useState("");

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
  const byMonth = new Map<string, { count: number; cents: number; sales: number; returns: number; saleCount: number; returnCount: number }>();
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
    const m = byMonth.get(r.issueDate!.slice(0, 7)) ?? { count: 0, cents: 0, sales: 0, returns: 0, saleCount: 0, returnCount: 0 };
    m.count++;
    m.cents += value;
    if (sign > 0) {
      m.sales += value;
      m.saleCount++;
    } else {
      m.returns += value;
      m.returnCount++;
    }
    byMonth.set(r.issueDate!.slice(0, 7), m);
  }
  const detectedMonths = rows.filter((r) => r.issueDate).map((r) => r.issueDate!.slice(0, 7));
  const coverageYear = detectedMonths.length ? Number([...detectedMonths].sort().reverse()[0].slice(0, 4)) : new Date().getFullYear();
  const visibleDocs = rows.filter((r) => {
    const cat = category.get(r.docTypeKey);
    if (docFilter === "issues" && !r.issue) return false;
    if (docFilter === "unclassified" && cat) return false;
    if ((docFilter === "sale" || docFilter === "return" || docFilter === "ignore") && cat !== docFilter) return false;
    return !query || normalizeKey(`${r.number} ${r.receiverNit} ${r.receiverName} ${r.cufe} ${r.docType}`).includes(normalizeKey(query));
  });
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
          <>
            <Button icon={<CalendarX2 size={15} />} onClick={() => setEmptyOpen(true)}>
              Registrar periodo sin ventas
            </Button>
            <Button icon={<Settings2 size={15} />} onClick={() => setSettingsOpen(true)}>
              Cuentas PUC de ventas
            </Button>
          </>
        }
      />
      {!book.result ? (
        <Card>
          <div className="row row--between">
            <span className="muted">El archivo se lee en este equipo; las hojas y columnas se ubican por sus encabezados.</span>
            <Button variant="primary" icon={<FolderSearch size={15} />} onClick={() => void book.pick()} loading={book.picking}>
              Seleccionar Excel
            </Button>
          </div>
        </Card>
      ) : (
        <ContextBar
          items={[
            { label: "Empresa", value: company ? company.razonSocial : <span className="muted">Sin identificar</span>, hint: "Por NIT Emisor" },
            { label: "NIT", value: issuers.length === 1 ? issuers[0] : issuers.length > 1 ? "Varios emisores" : "—", selectable: true },
            { label: "Periodo", value: describeMonths(detectedMonths) || "—", hint: detectedMonths.length ? "Por fecha de emisión" : undefined },
            { label: "Documentos", value: formatInteger(rows.length) },
            { label: "Archivo", value: book.result.fileName, selectable: true, hint: `Hojas: ${book.result.data.sheets.join(", ")}` },
          ]}
          actions={
            <Button size="sm" icon={<FolderSearch size={14} />} onClick={() => void book.pick()} loading={book.picking}>
              Cambiar archivo
            </Button>
          }
        />
      )}
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
            onSent={() => setSentKey((k) => k + 1)}
          />
          <SourceCoverage companyId={company?.id ?? null} source="sales_einvoice" year={coverageYear} refreshKey={sentKey} />
          {issuers.length > 1 && <Alert tone="danger">El archivo trae documentos de varios emisores ({issuers.join(", ")}): importa uno por empresa.</Alert>}
          {issuers.length === 1 && !company && (
            <Alert tone="danger" title={`No hay una empresa registrada con NIT ${issuers[0]}`}>
              La empresa se identifica por el NIT Emisor. <Button size="sm" onClick={() => navigate(paths.companies)}>Ir a Empresas</Button>
            </Alert>
          )}
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

          <MetricBar
            label="Resumen de ventas"
            metrics={[
              { key: "sales", label: totals.saleCount === 1 ? "venta" : "ventas", value: formatInteger(totals.saleCount), onClick: () => setDocFilter("sale"), active: docFilter === "sale" },
              { key: "returns", label: totals.returnCount === 1 ? "devolución" : "devoluciones", value: formatInteger(totals.returnCount), onClick: () => setDocFilter("return"), active: docFilter === "return" },
              { key: "base", label: "base ventas", value: formatExactCents(totals.sale) },
              { key: "rbase", label: "base devoluciones", value: formatExactCents(totals.return), tone: totals.return ? "negative" : undefined },
              { key: "net", label: "neto", value: formatExactCents(totals.sale + totals.return) },
              ...(totals.ignored ? [{ key: "ignored", label: "ignorados", value: formatInteger(totals.ignored), onClick: () => setDocFilter("ignore"), active: docFilter === "ignore" }] : []),
            ]}
          />

          <Card flush title="Por mes (fecha de emisión)">
            <div className="table-wrap">
              <table className="table table--dense">
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th className="num">Ventas</th>
                    <th className="num">Base ventas</th>
                    <th className="num">Devoluciones</th>
                    <th className="num">Base devoluciones</th>
                    <th className="num">Neto</th>
                  </tr>
                </thead>
                <tbody>
                  {[...byMonth.entries()].sort().map(([m, v]) => (
                    <tr key={m}>
                      <td>{periodLabel(m)}</td>
                      <td className="num">{formatInteger(v.saleCount)}</td>
                      <td className="num">{formatExactCents(v.sales)}</td>
                      <td className="num">{formatInteger(v.returnCount)}</td>
                      <td className="num">{formatExactCents(v.returns)}</td>
                      <td className="num table__primary">{formatExactCents(v.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card flush title="Documentos" description="NIT Emisor, CUFE/CUDE y número de cada documento; los duplicados se detectan al enviar.">
            <div className="toolbar row--between">
              <SegmentedFilter
                label="Filtrar documentos"
                options={[
                  { id: "all", label: "Todos" },
                  { id: "sale", label: "Ventas" },
                  { id: "return", label: "Devoluciones" },
                  { id: "ignore", label: "Ignorados" },
                  { id: "unclassified", label: "Sin clasificar" },
                  { id: "issues", label: "Con errores" },
                ]}
                value={docFilter}
                onChange={setDocFilter}
              />
              <SearchBox placeholder="Número, receptor o CUFE" value={query} onChange={setQuery} />
            </div>
            <div className="table-wrap table-wrap--scroll">
              <table className="table table--dense">
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Fecha</th>
                    <th>Receptor</th>
                    <th>Clasificación</th>
                    <th className="num">Total</th>
                    <th className="num">Impuestos</th>
                    <th className="num">Base</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDocs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted" style={{ textAlign: "center", padding: "var(--space-5)" }}>
                        Ningún documento coincide con el filtro.
                      </td>
                    </tr>
                  )}
                  {visibleDocs.map((r) => {
                    const cat = category.get(r.docTypeKey);
                    return (
                      <tr key={`${r.sheet}|${r.rowNumber}`} className={r.issue ? "row-attention--blocking" : undefined}>
                        <td>
                          <div className="table__primary selectable">{r.number || "—"}</div>
                          <div className="table__secondary cell-ellipsis selectable" title={r.cufe}>
                            {r.docType}
                            {r.cufe ? ` · CUFE ${r.cufe.slice(0, 12)}…` : ""}
                          </div>
                        </td>
                        <td className="nowrap">{r.issueDate ? formatIsoDate(r.issueDate) : "—"}</td>
                        <td>
                          {r.receiverName || "—"}
                          {r.receiverNit && <div className="table__secondary selectable">NIT {r.receiverNit}</div>}
                        </td>
                        <td>{r.issue ? <Badge tone="danger">{r.issue}</Badge> : cat ? <Badge tone={cat === "return" ? "gold" : cat === "ignore" ? undefined : "dark"}>{SALES_DOC_CATEGORY_LABEL[cat]}</Badge> : <Badge tone="warning">Sin clasificar</Badge>}</td>
                        <td className="num">{formatExactCents(r.totalCents)}</td>
                        <td className="num">{formatExactCents(r.taxesCents)}</td>
                        <td className="num">{formatExactCents(r.baseCents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      <EmptyPeriodModal open={emptyOpen} source="sales_einvoice" companies={data.companies} companyId={company?.id ?? null} defaultMonth={detectedMonths.length ? [...detectedMonths].sort()[0] : null} onClose={() => setEmptyOpen(false)} onChanged={() => setSentKey((k) => k + 1)} />
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
