import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { FileSpreadsheet, ListChecks, Sheet as SheetIcon } from "lucide-react";
import { Alert, Button, Card, PageHeader, useToast } from "../../../components/ui";
import { navigate, paths } from "../../../app/router";
import { useAsync } from "../../../hooks/useAsync";
import { useShortcut } from "../../../hooks/useShortcut";
import { companyService } from "../../../services/companyService";
import { fileService } from "../../../services/fileService";
import { selfWithholdingService } from "../../../services/selfWithholdingService";
import { errorMessage } from "../../../services/tauri";
import type { Workbook } from "../../../types/excel";
import type { Company } from "../../../types/models";
import { formatInteger } from "../../../utils/format";
import { StatementFileCard } from "../../bank-analysis/shared/components/StatementFileCard";
import type { ImportState } from "../../bank-analysis/shared/useStatementImport";
import { CompanyFormModal } from "../../../pages/companies/CompanyFormModal";
import { formatRateBp } from "../withholding/services/money";
import { DocumentTypesModal } from "./components/DocumentTypesModal";
import { formatCents, formatMicro } from "./components/format";
import { NewTypesPanel } from "./components/NewTypesPanel";
import { PendingList } from "./components/PendingList";
import { SALES_DOCUMENTS_ANCHOR, SalesDocumentsTable, type SalesFilter } from "./components/SalesDocumentsTable";
import { analyzeSales, type TypeRules } from "./services/analysis";
import { normalizeCiiu } from "./services/ciiu";
import { exportSalesExcel } from "./services/excelExport";
import { readSalesWorkbook } from "./services/workbookReader";
import { SalesWithholdingError, type IssuerNit, type ReadResult, type SalesAnalysis } from "./types";
import { TaxSection } from "../shared/TaxSection";

const LABELS = { pick: "Seleccionar Excel", pickAnother: "Seleccionar otro Excel", analyzing: "Leyendo ventas…" };

type Loaded = ReadResult & { workbook: Workbook };

/**
 * Último archivo leído. Sobrevive a la navegación dentro de la app: al volver
 * desde Empresas o la Tabla de Autorretenciones el cálculo se rehace con los
 * datos guardados (ej. una tarifa editada) sin volver a elegir el Excel.
 */
let session: { workbook: Workbook; sheetName?: string; issuerNit?: string } | null = null;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", formatInteger(n)));
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));
const toInput = ({ id: _id, createdAt: _c, updatedAt: _u, ...input }: Company) => input;

export default function SalesWithholdingPage() {
  const toast = useToast();
  const [state, setState] = useState<ImportState<Loaded>>({ status: "idle" });
  const [picking, setPicking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [filter, setFilter] = useState<SalesFilter>("all");
  const [typesOpen, setTypesOpen] = useState(false);
  /** undefined = cerrado; null = nueva empresa; Company = editar. */
  const [companyModal, setCompanyModal] = useState<Company | null | undefined>(undefined);
  /** NIT Emisor sin empresa con el que se abre «Crear empresa». */
  const [createFor, setCreateFor] = useState<IssuerNit | undefined>();
  /** Archivo con varias empresas: NIT Emisor cuyas filas se procesan (una empresa por lote). */
  const [issuerNit, setIssuerNit] = useState<string | undefined>();
  const busy = picking || state.status === "analyzing";

  const companies = useAsync(() => companyService.list(), []);
  const rates = useAsync(() => selfWithholdingService.listRates(), []);
  const types = useAsync(() => selfWithholdingService.listDocumentTypes(), []);
  const masterError = companies.error ?? rates.error ?? types.error;
  const masterReady = companies.data !== null && rates.data !== null && types.data !== null;

  const read = useCallback(async (workbook: Workbook, sheetName?: string, keepIssuer?: string) => {
    const { fileName } = workbook;
    setExportedPath(null);
    setFilter("all");
    setIssuerNit(keepIssuer);
    setState({ status: "analyzing", fileName });
    await nextFrame();
    try {
      const result = readSalesWorkbook(workbook, sheetName);
      session = { workbook, sheetName: result.kind === "ok" ? result.file.sheetName : undefined, issuerNit: keepIssuer };
      setState({ status: "done", fileName, pageCount: 0, analysis: { ...result, workbook } });
    } catch (e) {
      session = null;
      if (!(e instanceof SalesWithholdingError) && import.meta.env.DEV) console.error("[retencion-ventas]", e);
      setState({ status: "error", fileName, message: e instanceof SalesWithholdingError ? e.message : "No fue posible leer el archivo. Verifica que sea el Excel de facturación exportado desde DIAN." });
    }
  }, []);

  // Al volver al módulo se rehace el cálculo del último archivo.
  useEffect(() => {
    if (session) void read(session.workbook, session.sheetName, session.issuerNit);
  }, [read]);

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
  const rules: TypeRules = useMemo(() => new Map((types.data ?? []).map((t) => [t.normalizedLabel, t.category])), [types.data]);
  const rows = useMemo(() => (file && issuerNit ? file.rows.filter((r) => r.nit === issuerNit) : file?.rows), [file, issuerNit]);
  const analysis = useMemo(
    () => (rows && masterReady ? analyzeSales(rows, { rules, companies: companies.data!, rates: rates.data! }) : undefined),
    [rows, masterReady, rules, companies.data, rates.data],
  );

  const selectIssuer = (nit: string | undefined) => {
    setIssuerNit(nit);
    setExportedPath(null);
    setFilter("all");
    if (session) session.issuerNit = nit;
  };

  const cancelImport = () => {
    session = null;
    setIssuerNit(undefined);
    setExportedPath(null);
    setState({ status: "idle" });
  };

  const showReview = () => {
    setFilter("review");
    requestAnimationFrame(() => document.getElementById(SALES_DOCUMENTS_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  async function saveCiiu(code: string) {
    const company = analysis?.company;
    if (!company) return;
    try {
      await companyService.update(company.id, { ...toInput(company), ciiuCode: code });
      toast(`Código CIIU ${code} guardado en ${company.razonSocial}.`);
      await companies.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function exportExcel() {
    if (!file || !analysis?.complete || exporting) return;
    setExporting(true);
    try {
      const path = await exportSalesExcel(file, analysis);
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

  const blocking = analysis?.pending.filter((p) => p.blocking).length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Impuestos"
        title="Retención en la fuente ventas"
        description="Importa el Excel de facturación DIAN para calcular la autorretención en la fuente sobre las ventas."
        actions={
          <>
            <Button icon={<ListChecks size={15} />} onClick={() => setTypesOpen(true)}>
              Tipos de documento
            </Button>
            {analysis && (
              <Button
                variant="primary"
                icon={<FileSpreadsheet size={15} />}
                onClick={() => void exportExcel()}
                loading={exporting}
                disabled={!analysis.complete}
                title={analysis.complete ? undefined : "Resuelve primero los pendientes bloqueantes."}
              >
                Exportar Excel
              </Button>
            )}
          </>
        }
      />

      {masterError && <Alert tone="danger">{masterError}</Alert>}

      <TaxSection letter="B" title="Archivo fuente">
      <StatementFileCard
        state={state}
        details={
          file && (
            <>
              <span>Hoja «{file.sheetName}»</span>
              <span>· {plural(file.rows.length, "1 documento", "# documentos")}</span>
              {file.ignoredSheets.length > 0 && <span>· No usadas: {file.ignoredSheets.join(", ")}</span>}
            </>
          )
        }
        picking={picking}
        busy={busy}
        exportedPath={exportedPath}
        onPick={() => void pick()}
        labels={LABELS}
      />
      </TaxSection>

      {loaded?.kind === "choose-sheet" && (
        <Card title="Elige la hoja de ventas" description="Varias hojas del archivo tienen los encabezados de facturación DIAN. Selecciona la que corresponde; no se elige una automáticamente.">
          <div className="row">
            {loaded.candidates.map((c) => (
              <Button key={c.name} icon={<SheetIcon size={15} />} onClick={() => void read(loaded.workbook, c.name)}>
                «{c.name}» · {plural(c.rows, "1 fila", "# filas")}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {file && analysis && (
        <>
          <TaxSection letter="C" title="Estado y pendientes">
          <LotStatus blocking={blocking} />
          {issuerNit && rows && (
            <Alert tone="info" title={`Lote de ${analysis.company?.razonSocial ?? `NIT ${issuerNit}`}`}>
              Se procesan solo sus {plural(rows.length, "1 fila", "# filas")} de {formatInteger(file.rows.length)} del archivo. Las demás empresas se procesan por separado.
              <div className="row" style={{ marginTop: "var(--space-2)" }}>
                <Button size="sm" onClick={() => selectIssuer(undefined)}>
                  Cambiar empresa
                </Button>
              </div>
            </Alert>
          )}

          <PendingList
            pending={analysis.pending.filter((p) => p.kind !== "new_type")}
            onCreateCompany={(issuer) => {
              setCreateFor(issuer);
              setCompanyModal(null);
            }}
            onSelectIssuer={selectIssuer}
            onCancelImport={cancelImport}
            onEditCompany={() => analysis.company && setCompanyModal(analysis.company)}
            onSaveCiiu={saveCiiu}
            onOpenTable={() => navigate(paths.selfWithholdingCode(normalizeCiiu(analysis.company?.ciiuCode ?? "")))}
            onShowReview={showReview}
          />
          {analysis.newTypes.length > 0 && <NewTypesPanel key={file.fileName} types={analysis.newTypes} onSaved={types.reload} />}
          </TaxSection>

          <TaxSection letter="D" title="Resumen">
            <CompanyCard analysis={analysis} />
          </TaxSection>

          <TaxSection letter="E" title="Documentos">
            <SalesDocumentsTable key={`${file.fileName}:${file.sheetName}`} rows={analysis.rows} filter={filter} onFilterChange={setFilter} />
          </TaxSection>

          <TaxSection letter="F" title="Resumen para declaración">
            <Totals analysis={analysis} />
          </TaxSection>
        </>
      )}

      <DocumentTypesModal open={typesOpen} types={types.data ?? []} onClose={() => setTypesOpen(false)} onChanged={() => void types.reload()} />
      <CompanyFormModal
        open={companyModal !== undefined}
        company={companyModal ?? null}
        initial={createFor ? { nit: createFor.nit, razonSocial: createFor.name } : undefined}
        onClose={() => setCompanyModal(undefined)}
        onSaved={() => {
          setCompanyModal(undefined);
          void companies.reload();
        }}
      />
    </>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="summary-item">
      <span className="summary-item__label">{label}</span>
      <span className="summary-item__value selectable">{value}</span>
    </div>
  );
}

/** Estado del lote: listo para declaración o requiere atención (mismo indicador que IVA y Retefuente compras). */
function LotStatus({ blocking }: { blocking: number }) {
  return blocking === 0 ? (
    <div className="lot-status lot-status--ready" role="status">
      <span className="lot-status__dot" aria-hidden /> Listo para declaración
    </div>
  ) : (
    <div className="lot-status lot-status--attention" role="status">
      <span className="lot-status__dot" aria-hidden /> Requiere atención — {blocking === 1 ? "1 pendiente" : `${blocking} pendientes`}
    </div>
  );
}

/** Empresa → CIIU → Tarifa y conteo de documentos. */
function CompanyCard({ analysis: a }: { analysis: SalesAnalysis }) {
  return (
    <Card title="Empresa y tarifa">
      <div className="summary-grid">
        <Info label="Empresa" value={a.company?.razonSocial ?? (a.issuer ? `${a.issuer.name || "—"} (no registrada)` : a.nits.length > 1 ? "Varios NIT Emisor" : "—")} />
        <Info label="NIT Emisor" value={a.issuer?.nit ?? (a.nits.length > 1 ? a.nits.map((n) => n.nit).join(", ") : "—")} />
        <Info label="Código CIIU" value={a.company?.ciiuCode || "—"} />
        <Info label="Tarifa" value={a.rate ? formatRateBp(a.rate.rateBp, true) : "—"} />
        <Info label="Facturas" value={formatInteger(a.invoices.count)} />
        <Info label="Notas crédito" value={formatInteger(a.creditNotes.count)} />
      </div>
      {a.rate?.economicActivity && (
        <p className="muted" style={{ fontSize: "var(--text-sm)", marginBottom: 0 }}>
          {a.rate.normalizedCode} · {a.rate.economicActivity}
        </p>
      )}
    </Card>
  );
}

function Metric({ label, value, primary }: { label: string; value: string; primary?: boolean }) {
  return (
    <div className={`dropi-metric ${primary ? "dropi-metric--primary" : ""}`}>
      <span className="dropi-metric__label">{label}</span>
      <span className="dropi-metric__value selectable">{value}</span>
    </div>
  );
}

/** Facturas, Notas Crédito y Autorretención neta (Facturas − Notas Crédito). */
function Totals({ analysis: a }: { analysis: SalesAnalysis }) {
  const withholding = (cents?: number) => (cents === undefined ? "—" : formatCents(cents));
  return (
    <>
      <Card flush className="dropi-block sales-block" title="Facturas">
        <div className="dropi-metrics">
          <Metric label="Documentos" value={formatInteger(a.invoices.count)} />
          <Metric label="Base total" value={formatMicro(a.invoices.base)} />
          <Metric label="Autorretención" value={withholding(a.invoices.withholdingCents)} primary />
        </div>
      </Card>
      <Card flush className="dropi-block sales-block sales-block--notes" title="Notas Crédito">
        <div className="dropi-metrics">
          <Metric label="Documentos" value={formatInteger(a.creditNotes.count)} />
          <Metric label="Base total" value={formatMicro(a.creditNotes.base)} />
          <Metric label="Autorretención (se resta)" value={withholding(a.creditNotes.withholdingCents)} primary />
        </div>
      </Card>
      <Card
        flush
        className="dropi-block sales-block sales-block--net"
        title="Autorretención neta"
        description={a.totals ? "Autorretención Facturas − Autorretención Notas Crédito." : "Se calcula cuando la empresa tiene un Código CIIU con tarifa en la Tabla de Autorretenciones."}
        footer={a.totals && <span className="muted">Redondeada a miles para la declaración: {formatCents(a.totals.netRoundedCents)}</span>}
      >
        <div className="dropi-metrics">
          <Metric label="Autorretención Facturas" value={withholding(a.invoices.withholdingCents)} />
          <Metric label="− Autorretención Notas Crédito" value={withholding(a.creditNotes.withholdingCents)} />
          <Metric label="Autorretención neta" value={withholding(a.totals?.netCents)} primary />
        </div>
      </Card>
    </>
  );
}
