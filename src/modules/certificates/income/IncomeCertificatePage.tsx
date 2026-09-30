import { useEffect, useMemo, useState } from "react";
import { Check, Eye, FileDown, FileText, FolderOpen, Plus, Settings2 } from "lucide-react";
import { Alert, Button, Card, Field, Input, Loader, PageHeader, Select, useToast } from "../../../components/ui";
import { useAsync } from "../../../hooks/useAsync";
import { fileService } from "../../../services/fileService";
import { identityDocumentService } from "../../../services/identityDocumentService";
import { signerService } from "../../../services/signerService";
import { errorMessage } from "../../../services/tauri";
import { BACKGROUNDS } from "./backgrounds";
import { DocumentTypesModal } from "./DocumentTypesModal";
import { build, currencyCode, CURRENCIES, EMPTY_FORM, spanishDate, validate, type Background, type IncomeCertificateForm } from "./model";
import { PdfPagePreview } from "./PdfPagePreview";
import { renderIncomePdf } from "./pdf";

const OTHER_CURRENCY = "__other";
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Certificados → Certificado de ingresos. Siempre empieza vacío (sin firmante, fondo ni titular). */
export default function IncomeCertificatePage() {
  const toast = useToast();
  const signers = useAsync(() => signerService.list(), []);
  const types = useAsync(() => identityDocumentService.list(), []);
  const [form, setForm] = useState<IncomeCertificateForm>(EMPTY_FORM);
  const [otherCurrency, setOtherCurrency] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [signatureMissing, setSignatureMissing] = useState(false);
  const [typesModal, setTypesModal] = useState<"list" | "create" | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewBytes, setPreviewBytes] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const signer = signers.data?.find((s) => s.id === form.signerId) ?? null;
  const documentType = types.data?.find((t) => t.id === form.identityDocumentTypeId) ?? null;
  const set = <K extends keyof IncomeCertificateForm>(key: K, value: IncomeCertificateForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSavedPath(null);
  };

  // La firma se lee siempre del almacenamiento persistente de Firmas.
  useEffect(() => {
    let current = true;
    setSignature(null);
    setSignatureMissing(false);
    if (signer?.signatureAvailable) {
      signerService.dataUrl(signer.signatureFile).then(
        (url) => {
          if (!current) return;
          setSignature(url);
          setSignatureMissing(!url);
        },
        () => current && setSignatureMissing(true),
      );
    }
    return () => {
      current = false;
    };
  }, [signer?.signatureFile, signer?.signatureAvailable]);

  const errors = validate(form, signer, documentType, { data: signature, missing: signatureMissing });
  const valid = errors.length === 0;
  const touched = JSON.stringify(form) !== JSON.stringify(EMPTY_FORM);
  const isCop = currencyCode(form) === "COP";

  // Vista previa: el mismo PDF que se exporta, regenerado (con pausa) cuando cambian los datos.
  const doc = useMemo(() => (valid && signer && documentType && signature ? build(form, signer, documentType, signature) : null), [valid, form, signer, documentType, signature]);
  useEffect(() => {
    if (!showPreview || !doc) {
      setPreviewBytes(null);
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      renderIncomePdf(doc, { withBackground: false }).then(
        (bytes) => current && setPreviewBytes(bytes),
        (cause) => current && setError(errorMessage(cause)),
      );
    }, 350);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [showPreview, doc]);

  async function generate() {
    if (!signer || !documentType || !signature || !valid) return;
    setBusy(true);
    setError(null);
    try {
      // Fecha del momento en que se crea el PDF.
      const fresh = build(form, signer, documentType, signature, new Date());
      const path = await fileService.savePdf(await renderIncomePdf(fresh), fresh.fileName);
      if (path) {
        setSavedPath(path);
        toast("Certificado guardado.");
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function chooseCurrency(value: string) {
    const other = value === OTHER_CURRENCY;
    setOtherCurrency(other);
    setForm((f) => ({ ...f, currency: other ? "" : value, incomeMode: value === "COP" ? "direct" : f.incomeMode }));
    setSavedPath(null);
  }

  if (signers.loading && !signers.data) return <Loader />;
  const today = spanishDate(todayIso());

  return (
    <>
      <PageHeader eyebrow="Certificados" title="Certificado de ingresos" description="Certificado de una página con membrete AMD, firmante guardado y datos del titular." />
      {(signers.error || types.error) && <Alert tone="danger">{signers.error || types.error}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {savedPath && (
        <Alert tone="success" title="PDF guardado">
          <div className="stack stack--sm">
            <span>{savedPath}</span>
            <div className="row">
              <Button size="sm" variant="primary" icon={<FileText size={14} />} onClick={() => void fileService.openSaved(savedPath).catch((e: Error) => toast(e.message, "error"))}>
                Abrir PDF
              </Button>
              <Button size="sm" icon={<FolderOpen size={14} />} onClick={() => void fileService.revealSaved(savedPath).catch((e: Error) => toast(e.message, "error"))}>
                Mostrar en Finder
              </Button>
            </div>
          </div>
        </Alert>
      )}

      <Card title="Firmante y fondo">
        <div className="stack">
          <Field label="Firmante" required hint={signers.data?.length === 0 ? "No hay firmantes guardados: créalos en Datos → Firmas." : "Nombre, cargo, matrícula y firma se toman de Datos → Firmas."}>
            {(id) => (
              <Select id={id} value={form.signerId ?? ""} onChange={(e) => set("signerId", e.target.value ? Number(e.target.value) : null)}>
                <option value="">Seleccionar firmante…</option>
                {signers.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.role}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="field">
            <span className="field__label">
              Fondo del certificado<em>*</em>
            </span>
            <div className="row" role="radiogroup" aria-label="Fondo del certificado" style={{ alignItems: "stretch" }}>
              {(Object.keys(BACKGROUNDS) as Background[]).map((key) => {
                const active = form.background === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => set("background", key)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 8,
                      padding: 10,
                      width: 150,
                      cursor: "pointer",
                      font: "inherit",
                      color: "var(--color-text)",
                      background: "var(--color-surface)",
                      borderRadius: 12,
                      border: active ? "2px solid var(--color-primary)" : "1px solid var(--color-border)",
                      margin: active ? 0 : 1,
                    }}
                  >
                    <img src={BACKGROUNDS[key].url} alt="" style={{ width: 110, aspectRatio: "1055 / 1491", objectFit: "cover", borderRadius: 4, boxShadow: "var(--shadow-sm)" }} />
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                      {active && <Check size={14} />}
                      {BACKGROUNDS[key].label}
                    </span>
                  </button>
                );
              })}
            </div>
            <span className="field__hint">El membrete ya incluye el logo AMD y los datos de contacto del pie.</span>
          </div>
        </div>
      </Card>

      <Card title="Titular del certificado">
        <div className="form-grid">
          <div className="field">
            <span className="field__label">
              Tratamiento<em>*</em>
            </span>
            <div className="segmented" role="radiogroup" aria-label="Tratamiento" style={{ alignSelf: "flex-start" }}>
              {(
                [
                  ["mr", "Señor"],
                  ["mrs", "Señora"],
                ] as const
              ).map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={form.treatment === value} className={form.treatment === value ? "is-active" : undefined} onClick={() => set("treatment", value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Field label="Nombre completo" required hint="Se mostrará en MAYÚSCULAS.">
            {(id) => <Input id={id} maxLength={150} value={form.fullName} placeholder="Ej. Christian Cruz Escobar" onChange={(e) => set("fullName", e.target.value)} />}
          </Field>
          <Field label="Tipo de documento" required>
            {(id) => (
              <>
                <Select id={id} value={form.identityDocumentTypeId ?? ""} onChange={(e) => set("identityDocumentTypeId", e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Seleccionar tipo…</option>
                  {types.data?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                <div className="row" style={{ gap: 4 }}>
                  <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setTypesModal("create")}>
                    Nuevo tipo de documento
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Settings2 size={13} />} onClick={() => setTypesModal("list")}>
                    Administrar
                  </Button>
                </div>
              </>
            )}
          </Field>
          <Field label="Número de documento" required hint={documentType ? (documentType.isNumeric ? "Con o sin puntos: se mostrará 1.006.011.707." : "Se mostrará tal como se escribe.") : undefined}>
            {(id) => <Input id={id} maxLength={40} value={form.identityDocumentNumber} placeholder="Ej. 1006011707" onChange={(e) => set("identityDocumentNumber", e.target.value)} />}
          </Field>
          <Field label="Lugar de expedición" required>
            {(id) => <Input id={id} maxLength={80} value={form.identityDocumentIssuePlace} placeholder="Ej. Palmira" onChange={(e) => set("identityDocumentIssuePlace", e.target.value)} />}
          </Field>
          <Field label="Actividad independiente" required hint="«Ha trabajado de manera independiente, realizando actividades como …»">
            {(id) => <Input id={id} maxLength={160} value={form.activity} placeholder="Ej. Support Consultant" onChange={(e) => set("activity", e.target.value)} />}
          </Field>
        </div>
      </Card>

      <Card title="Ingresos">
        <div className="stack">
          <div className="segmented" role="radiogroup" aria-label="Forma de mostrar el valor" style={{ alignSelf: "flex-start" }}>
            <button type="button" role="radio" aria-checked={form.incomeMode === "direct"} className={form.incomeMode === "direct" ? "is-active" : undefined} onClick={() => set("incomeMode", "direct")}>
              Valor directo
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={form.incomeMode === "with_cop_equivalent"}
              disabled={isCop}
              title={isCop ? "Solo para ingresos en otra moneda" : undefined}
              className={form.incomeMode === "with_cop_equivalent" ? "is-active" : undefined}
              onClick={() => set("incomeMode", "with_cop_equivalent")}
            >
              Valor con equivalencia a COP
            </button>
          </div>
          <div className="form-grid">
            <Field label="Moneda" required>
              {(id) => (
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <Select id={id} value={otherCurrency ? OTHER_CURRENCY : form.currency} onChange={(e) => chooseCurrency(e.target.value)}>
                    <option value="">Seleccionar…</option>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    <option value={OTHER_CURRENCY}>Otra…</option>
                  </Select>
                  {otherCurrency && <Input aria-label="Código de moneda" maxLength={3} placeholder="Ej. GBP" style={{ width: 96 }} value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} />}
                </div>
              )}
            </Field>
            <Field label={form.incomeMode === "with_cop_equivalent" ? "Valor original (promedio mensual)" : "Valor de ingreso promedio mensual"} required hint="Ej. 3.500.000 o 1000,50">
              {(id) => <Input id={id} inputMode="decimal" maxLength={24} value={form.monthlyIncome} onChange={(e) => set("monthlyIncome", e.target.value)} />}
            </Field>
            {form.incomeMode === "with_cop_equivalent" && (
              <>
                <Field label="Valor equivalente en COP" required hint="Tasa consultada por ti: la app no consulta Internet.">
                  {(id) => <Input id={id} inputMode="decimal" maxLength={24} value={form.copEquivalent} placeholder="Ej. 3.302.018" onChange={(e) => set("copEquivalent", e.target.value)} />}
                </Field>
                <Field label="Fecha de referencia de la tasa" required>
                  {(id) => <Input id={id} type="date" value={form.exchangeRateReferenceDate} onChange={(e) => set("exchangeRateReferenceDate", e.target.value)} />}
                </Field>
              </>
            )}
          </div>
        </div>
      </Card>

      <Card title="Expedición">
        <div className="form-grid">
          <Field label="Ciudad de expedición del certificado" required>
            {(id) => <Input id={id} maxLength={80} value={form.issueCity} onChange={(e) => set("issueCity", e.target.value)} />}
          </Field>
          <Field label="Fecha" hint="Automática: la fecha del día en que se genera el PDF.">
            {(id) => <Input id={id} value={today ?? ""} readOnly disabled />}
          </Field>
        </div>
      </Card>

      <Card>
        <div className="stack">
          {touched && !valid && <Alert tone="warning" title="Para generar el certificado falta:" items={errors} />}
          <div className="row">
            <Button icon={<Eye size={15} />} disabled={!valid} onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? "Ocultar vista previa" : "Vista previa"}
            </Button>
            <Button variant="primary" icon={<FileDown size={15} />} disabled={!valid} loading={busy} onClick={() => void generate()}>
              Generar PDF
            </Button>
          </div>
        </div>
      </Card>

      {showPreview && valid && (
        <Card title="Vista previa del certificado" description="Es el mismo PDF que se exporta; se actualiza al cambiar los datos.">
          <PdfPagePreview bytes={previewBytes} background={BACKGROUNDS[doc?.background ?? "personal"].url} />
        </Card>
      )}

      <DocumentTypesModal
        open={typesModal !== null}
        startCreating={typesModal === "create"}
        types={types.data ?? []}
        onClose={() => setTypesModal(null)}
        onChanged={({ created, deletedId }) => {
          void types.reload();
          if (created) {
            set("identityDocumentTypeId", created.id);
            setTypesModal(null);
          }
          if (deletedId !== undefined && deletedId === form.identityDocumentTypeId) set("identityDocumentTypeId", null);
        }}
      />
    </>
  );
}
