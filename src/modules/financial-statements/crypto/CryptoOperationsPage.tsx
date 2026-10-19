import { useState } from "react";
import { Bitcoin, FolderSearch, Settings2 } from "lucide-react";
import { Alert, Button, Card, ContextBar, DateInput, EmptyState, Field, Loader, MetricBar, PageHeader, Select, Tabs, useToast } from "../../../components/ui";
import { fileService } from "../../../services/fileService";
import { cryptoService } from "../../../services/cryptoService";
import { errorMessage } from "../../../services/tauri";
import { formatInteger } from "../../../utils/format";
import { ACCOUNTING_LABEL, ACCOUNTING_PRESENTATIONS } from "../shared/accountingPresentation";
import { CompanySelect } from "../shared/components/CompanySelect";
import { PucSettingsModal } from "../shared/components/PucSettingsModal";
import { formatExactCents } from "../shared/money";
import type { CryptoModel } from "./domain/model";
import { COMPONENT_LABEL, PUC_KEYS, type ComponentKey } from "./domain/eeff";
import { CryptoFormatError, parseCryptoWorkbook, type ParsedCryptoWorkbook } from "./domain/parse";
import { blocking } from "./domain/problems";
import { selectableYears, useCryptoMonthFocus, useCryptoSelection } from "./selection";
import { CoverageModal } from "./ui/CoverageModal";
import { EeffTab } from "./ui/EeffTab";
import { ExogenaTab } from "./ui/ExogenaTab";
import { ImportModal } from "./ui/ImportModal";
import { OperationsTab } from "./ui/OperationsTab";
import { ReconciliationCard } from "./ui/ReconciliationCard";
import { UploadDetailModal } from "./ui/UploadDetailModal";
import type { CryptoUpload } from "./domain/types";
import { useCryptoData } from "./useCryptoData";
import { useEeffAutoSync } from "./useEeffAutoSync";
import { useExoFormatGuard } from "./useExoFormatGuard";

type TabId = "operations" | "eeff" | "exogena";

const PUC_ITEMS = (Object.keys(PUC_KEYS) as ComponentKey[]).map((k) => ({ key: PUC_KEYS[k], label: COMPONENT_LABEL[k] }));

/**
 * Estados Financieros → Transacciones Cripto → Reporte de operaciones. Cargas acumulativas de Excel por empresa y año; de ellas
 * se derivan, sin guardar resultados, los componentes de Estados Financieros y los formatos 1007 y 1647 de Exógena.
 */
const pendingRowsOf = (model: CryptoModel, key: "duplicatesPending" | "outOfYear" | "invalid") => model.reconciliation.rows[key].purchase + model.reconciliation.rows[key].sale;

export default function CryptoOperationsPage() {
  const toast = useToast();
  const [selection, select] = useCryptoSelection();
  const [focusMonth, clearFocus] = useCryptoMonthFocus();
  // El filtro mensual solo vale para la empresa y el año con que se abrió.
  const month = focusMonth && Number(focusMonth.slice(0, 4)) === selection.year ? focusMonth : null;
  const data = useCryptoData(selection.companyId, selection.year);
  const { fs, company, state, model } = data;
  useExoFormatGuard(selection.companyId, model);
  const eeffSync = useEeffAutoSync(selection.companyId, model);
  const [tab, setTab] = useState<TabId>("operations");
  const [picking, setPicking] = useState(false);
  const [parsed, setParsed] = useState<ParsedCryptoWorkbook | null>(null);
  const [detail, setDetail] = useState<CryptoUpload | null>(null);
  const [coverageFor, setCoverageFor] = useState<number | null>(null);
  const [pucOpen, setPucOpen] = useState(false);
  const [sentKey, setSentKey] = useState(0);

  const ready = selection.companyId !== null;

  async function pick() {
    setPicking(true);
    try {
      const book = await fileService.pickExcel();
      if (!book) return;
      try {
        setParsed(parseCryptoWorkbook(book));
      } catch (e) {
        toast(e instanceof CryptoFormatError ? e.message : "No fue posible leer el archivo. Verifica que tenga las hojas «Compras» y «Ventas».", "error");
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPicking(false);
    }
  }

  const coverage = model?.coverages.find((c) => c.uploadId === coverageFor) ?? null;
  const pendingCount = model ? blocking([...model.problems.f1007, ...model.problems.f1647, ...model.problems.eeff]).length : 0;

  return (
    <>
      <PageHeader
        eyebrow="Estados Financieros · Transacciones Cripto"
        title="Reporte de operaciones"
        description="Importa los Excel de Compras y Ventas (acumulativos por empresa y año) para calcular Estados Financieros y preparar los formatos 1007 y 1647 de Exógena."
        actions={
          <>
            <Button icon={<Settings2 size={15} />} onClick={() => setPucOpen(true)}>
              Cuentas PUC
            </Button>
            <Button variant="primary" icon={<FolderSearch size={15} />} loading={picking} disabled={!ready} onClick={() => void pick()} title={ready ? undefined : "Selecciona la empresa y el año"}>
              Importar Excel
            </Button>
          </>
        }
      />
      <ContextBar items={[{ label: "Empresa", value: company?.razonSocial ?? "—" }, { label: "Año", value: String(selection.year) }, { label: "Corte", value: model?.settings.cutoff ?? "—" }]}>
        <div className="bank-head__fields">
          <CompanySelect companies={fs.companies} value={selection.companyId} onChange={(id) => (clearFocus(), select({ companyId: id }))} />
          <Field label="Año del reporte" required>
            {(id) => (
              <Select id={id} value={selection.year} onChange={(e) => (clearFocus(), select({ year: Number(e.target.value) }))}>
                {selectableYears().map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Fecha de corte" hint="Dentro del año">
            {(id) => <DateInput id={id} value={model?.settings.cutoff ?? ""} disabled={!model} onChange={(v) => v && void data.decide("setting", "cutoff", v)} />}
          </Field>
          <Field label="Presentación" hint="La misma del Generador">
            {(id) => (
              <Select id={id} value={model?.settings.presentation ?? "otc"} disabled={!model} onChange={(e) => void data.decide("setting", "presentation", e.target.value)}>
                {ACCOUNTING_PRESENTATIONS.map((p) => (
                  <option key={p} value={p}>
                    {ACCOUNTING_LABEL[p]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </ContextBar>

      {!ready ? (
        <Card>
          <EmptyState icon={<Bitcoin size={20} />} title="Selecciona una empresa" description="La empresa y el año son obligatorios para importar y calcular." />
        </Card>
      ) : !state || !model ? (
        <Loader />
      ) : (
        <>
          <MetricBar
            label="Resumen de operaciones"
            metrics={[
              { key: "files", label: model.counts.files === 1 ? "archivo vigente" : "archivos vigentes", value: formatInteger(model.counts.files) },
              { key: "accepted", label: "operaciones aceptadas", value: formatInteger(model.counts.accepted) },
              { key: "dups", label: model.counts.pendingDuplicateGroups === 1 ? "grupo de duplicados pendiente" : "grupos de duplicados pendientes", value: formatInteger(model.counts.pendingDuplicateGroups), tone: model.counts.pendingDuplicateGroups ? "attention" : undefined },
              { key: "months", label: "meses cubiertos", value: `${model.counts.coveredMonths}/12` },
              { key: "purchases", label: "compras", value: formatExactCents(model.counts.purchasesCents) },
              { key: "sales", label: "ventas", value: formatExactCents(model.counts.salesCents) },
            ]}
          />
          {model.counts.pending > 0 && (
            <Alert tone="warning">
              {formatInteger(model.counts.pending)} {model.counts.pending === 1 ? "fila está pendiente" : "filas están pendientes"} y no cuentan hasta que se resuelvan: {formatInteger(pendingRowsOf(model, "duplicatesPending"))} de {formatInteger(model.counts.pendingDuplicateGroups)} {model.counts.pendingDuplicateGroups === 1 ? "grupo" : "grupos"} de posibles duplicados, {formatInteger(pendingRowsOf(model, "outOfYear"))} compras de otro año y {formatInteger(pendingRowsOf(model, "invalid"))} con fecha o valor ilegible. {pendingCount} pendientes bloquean envíos o formatos.
            </Alert>
          )}
          <Tabs
            label="Reporte de operaciones"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "operations", label: "Operaciones" },
              { id: "eeff", label: "Estados Financieros", badge: blocking(model.problems.eeff).length || undefined },
              { id: "exogena", label: "Exógena", badge: blocking([...model.problems.f1007, ...model.problems.f1647]).length || undefined },
            ]}
          />
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} key={`${tab}-${sentKey}`}>
            {tab === "operations" && <OperationsTab data={data} model={model} onDetail={setDetail} onCoverage={setCoverageFor} month={month} onClearMonth={clearFocus} />}
            {tab === "eeff" && <EeffTab data={data} model={model} companyId={selection.companyId!} year={selection.year} sync={eeffSync} onSent={() => { void eeffSync.reload(); setSentKey((k) => k + 1); }} onPuc={() => setPucOpen(true)} />}
            {tab === "exogena" && <ExogenaTab data={data} model={model} companyId={selection.companyId!} />}
          </div>
          <ReconciliationCard model={model} sync={eeffSync.state} />
        </>
      )}

      <ImportModal
        parsed={parsed}
        companyId={selection.companyId ?? 0}
        companyName={company?.razonSocial ?? ""}
        year={selection.year}
        state={state ?? { uploads: [], rows: [], decisions: [], versions: [], audit: [] }}
        onClose={() => setParsed(null)}
        onImported={(message) => {
          setParsed(null);
          toast(message);
          void data.reloadState();
        }}
      />
      {model && <UploadDetailModal upload={detail} model={model} state={state!} onClose={() => setDetail(null)} />}
      <CoverageModal
        coverage={coverage}
        year={selection.year}
        onClose={() => setCoverageFor(null)}
        onSave={async (months) => {
          if (coverageFor === null) return;
          await cryptoService.setCoverage(coverageFor, months);
          setCoverageFor(null);
          await data.reloadState();
        }}
      />
      <PucSettingsModal
        open={pucOpen}
        title="Cuentas PUC de Transacciones Cripto"
        items={PUC_ITEMS}
        index={fs.index}
        settings={fs.settingsMap}
        mappings={fs.mappingMap}
        required={PUC_ITEMS.map((i) => i.key).filter((k) => !fs.settingsMap.get(k))}
        onClose={() => setPucOpen(false)}
        onSaved={fs.reloadSettings}
        onCodesChanged={() => Promise.all([fs.reloadCodes(), fs.reloadMappings()])}
      />
    </>
  );
}
