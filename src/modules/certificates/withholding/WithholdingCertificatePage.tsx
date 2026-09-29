import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Loader, PageHeader, Stepper } from "../../../components/ui";
import { useAsync } from "../../../hooks/useAsync";
import { useLogo } from "../../../hooks/useLogo";
import { useShortcut } from "../../../hooks/useShortcut";
import { companyService } from "../../../services/companyService";
import { conceptService } from "../../../services/conceptService";
import { activityService } from "../../../services/activityService";
import { fileService } from "../../../services/fileService";
import { errorMessage, isTauri } from "../../../services/tauri";
import type { Workbook } from "../../../types/excel";
import { emptyDraft, newLineKey, readDraft, saveDraft, STEPS, type WithholdingDraft } from "./draft";
import { analyzeWorkbook } from "./logic/excelAnalysis";
import { buildCertificateDocument, validateCertificate } from "./logic/certificateModel";
import { renderWithholdingPdf } from "./pdf/withholdingPdf";
import { CompanyStep } from "./steps/CompanyStep";
import { ImportStep } from "./steps/ImportStep";
import { ReviewStep } from "./steps/ReviewStep";
import { ConceptsStep } from "./steps/ConceptsStep";
import { PreviewStep } from "./steps/PreviewStep";
import { DoneStep } from "./steps/DoneStep";

const STEP = { company: 0, import: 1, review: 2, concepts: 3, preview: 4, done: 5 } as const;

export default function WithholdingCertificatePage() {
  const [draft, setDraft] = useState<WithholdingDraft>(readDraft);
  const patch = useCallback((p: Partial<WithholdingDraft>) => setDraft((d) => ({ ...d, ...p })), []);
  useEffect(() => saveDraft(draft), [draft]);

  const companies = useAsync(() => companyService.list(), []);
  const concepts = useAsync(() => conceptService.list(), []);
  const company = companies.data?.find((c) => c.id === draft.companyId) ?? null;
  const logoDataUrl = useLogo(company?.logoFile);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Si la empresa seleccionada fue eliminada en otra sección, se deselecciona.
  useEffect(() => {
    if (companies.data && draft.companyId && !company) patch({ companyId: null, step: STEP.company });
  }, [companies.data, draft.companyId, company, patch]);

  // "Consignado en" toma la ciudad de la empresa mientras el usuario no lo edite.
  useEffect(() => {
    if (company && !draft.consignadoTouched) patch({ consignadoEn: company.ciudad });
  }, [company, draft.consignadoTouched, patch]);

  const { analysis, lines } = draft;
  const analysisReady = !!analysis && analysis.errors.length === 0 && (analysis.priorRetentions.length === 0 || draft.priorAck);
  const validation = useMemo(
    () => validateCertificate({ company, logoDataUrl, analysis, lines, consignadoEn: draft.consignadoEn }),
    [company, logoDataUrl, analysis, lines, draft.consignadoEn],
  );
  const canGoTo = (i: number) => {
    if (i <= STEP.company) return true;
    if (i === STEP.import) return !!company;
    if (i === STEP.review) return !!company && !!analysis;
    if (i === STEP.concepts) return !!company && analysisReady;
    if (i === STEP.preview) return !!company && analysisReady && validation.length === 0;
    return !!draft.result;
  };
  const go = (step: number) => canGoTo(step) && patch({ step });

  // Documento para la vista previa: se reconstruye con la hora actual en cada visita.
  const previewDoc = useMemo(() => {
    if (draft.step !== STEP.preview || validation.length > 0) return null;
    return buildCertificateDocument({ company, logoDataUrl, analysis, lines, consignadoEn: draft.consignadoEn, generatedAt: new Date() });
  }, [draft.step, validation, company, logoDataUrl, analysis, lines, draft.consignadoEn]);

  // ---------- Importación ----------

  const applyWorkbook = useCallback(
    (book: Workbook) => {
      const result = analyzeWorkbook(book);
      patch({ analysis: result, priorAck: false, result: null, step: STEP.review });
    },
    [patch],
  );

  const pickExcel = useCallback(async () => {
    if (!company) return;
    setImporting(true);
    setImportError(null);
    try {
      const book = await fileService.pickExcel();
      if (book) applyWorkbook(book);
    } catch (e) {
      setImportError(errorMessage(e));
    } finally {
      setImporting(false);
    }
  }, [company, applyWorkbook]);

  // Arrastrar y soltar sobre la ventana (solo en el paso de importación).
  useEffect(() => {
    if (draft.step !== STEP.import || !isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .onDragDropEvent(async (event) => {
          const p = event.payload;
          if (p.type === "enter" || p.type === "over") setDragOver(true);
          else if (p.type === "leave") setDragOver(false);
          else if (p.type === "drop") {
            setDragOver(false);
            const path = p.paths[0];
            if (!path) return;
            setImporting(true);
            setImportError(null);
            try {
              applyWorkbook(await fileService.loadDroppedExcel(path));
            } catch (e) {
              setImportError(errorMessage(e));
            } finally {
              setImporting(false);
            }
          }
        })
        .then((fn) => (disposed ? fn() : (unlisten = fn))),
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [draft.step, applyWorkbook]);

  // ---------- Generación ----------

  const generate = useCallback(async () => {
    if (validation.length > 0 || generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      // La fecha y hora corresponden al momento exacto de presionar "Generar PDF".
      const doc = buildCertificateDocument({ company, logoDataUrl, analysis, lines, consignadoEn: draft.consignadoEn, generatedAt: new Date() });
      const bytes = await renderWithholdingPdf(doc);
      const path = await fileService.savePdf(bytes, doc.fileName);
      if (path) {
        activityService.saved(path, company?.razonSocial);
        patch({ result: { path, fileName: path.split("/").pop() ?? doc.fileName }, step: STEP.done });
      }
    } catch (e) {
      setGenerateError(errorMessage(e));
    } finally {
      setGenerating(false);
    }
  }, [validation, generating, company, logoDataUrl, analysis, lines, draft.consignadoEn, patch]);

  useShortcut("o", () => {
    if (!company) return;
    patch({ step: STEP.import });
    void pickExcel();
  });
  useShortcut("s", () => void generate(), draft.step === STEP.preview);

  // ---------- Render ----------

  if ((companies.loading && !companies.data) || (concepts.loading && !concepts.data)) return <Loader />;
  const loadError = companies.error ?? concepts.error;

  return (
    <>
      <PageHeader
        eyebrow="Certificados"
        title="Certificado de retención"
        description="Genera certificados de retención en la fuente e ICA a partir del reporte de documentos electrónicos."
      />
      <Stepper steps={STEPS} current={draft.step} canGoTo={canGoTo} onChange={go} />
      {loadError && <Alert tone="danger">{loadError}</Alert>}

      {draft.step === STEP.company && (
        <CompanyStep
          companies={companies.data ?? []}
          company={company}
          onSelect={(id) => patch({ companyId: id, consignadoTouched: false })}
          onCreated={(c) => {
            void companies.reload();
            patch({ companyId: c.id, consignadoTouched: false });
          }}
          onNext={() => go(STEP.import)}
        />
      )}

      {draft.step === STEP.import && (
        <ImportStep
          analysis={analysis}
          loading={importing}
          error={importError}
          dragOver={dragOver}
          onPick={() => void pickExcel()}
          onBack={() => go(STEP.company)}
          onNext={() => go(STEP.review)}
        />
      )}

      {draft.step === STEP.review && analysis && (
        <ReviewStep
          analysis={analysis}
          priorAck={draft.priorAck}
          onPriorAck={(v) => patch({ priorAck: v })}
          canContinue={analysisReady}
          onBack={() => go(STEP.import)}
          onNext={() => {
            if (lines.length === 0) patch({ lines: [{ key: newLineKey(), conceptId: null, nombre: "", tipo: null, unidad: null, rateText: "" }] });
            go(STEP.concepts);
          }}
        />
      )}

      {draft.step === STEP.concepts && analysis && (
        <ConceptsStep
          concepts={concepts.data ?? []}
          baseCents={analysis.baseCents}
          lines={lines}
          onLines={(l) => patch({ lines: l })}
          consignadoEn={draft.consignadoEn}
          onConsignadoEn={(v) => patch({ consignadoEn: v, consignadoTouched: true })}
          errors={validation}
          onConceptsChanged={() => void concepts.reload()}
          onBack={() => go(STEP.review)}
          onNext={() => patch({ step: STEP.preview })}
        />
      )}

      {draft.step === STEP.preview && previewDoc && (
        <PreviewStep
          doc={previewDoc}
          generating={generating}
          error={generateError}
          onBack={() => go(STEP.concepts)}
          onEdit={() => go(STEP.company)}
          onGenerate={() => void generate()}
        />
      )}

      {draft.step === STEP.done && draft.result && (
        <DoneStep
          result={draft.result}
          onBackToPreview={() => go(STEP.preview)}
          onNew={() => setDraft({ ...emptyDraft(), companyId: draft.companyId })}
        />
      )}
    </>
  );
}
