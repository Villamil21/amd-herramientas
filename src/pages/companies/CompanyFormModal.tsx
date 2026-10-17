import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileCheck2, X } from "lucide-react";
import { Alert, Badge, Button, ConfirmDialog, Tabs, useToast } from "../../components/ui";
import { LogoThumb } from "../../components/LogoThumb";
import { taxService } from "../../modules/financial-statements/tax-obligations/services/taxService";
import type { VatPeriodicity } from "../../modules/financial-statements/tax-obligations/types";
import { companyService, getLogoDataUrl } from "../../services/companyService";
import type { Company, CompanyInput } from "../../types/models";
import { COMPANY_TABS, dirtyTabs, type CompanyTab } from "./companyTabs";
import { EMPTY_COMPANY_INPUT } from "./companyDefaults";
import { firstErrorTab, validateCompany, type CompanyErrors } from "./companyValidation";
import { companyStatus } from "./companyStatus";
import { FiscalTab } from "./FiscalTab";
import { GeneralesTab } from "./GeneralesTab";
import { selectedRep } from "./import/legalReps";
import { useCompanyImport } from "./import/useCompanyImport";
import { ResumenTab } from "./ResumenTab";
import { SocietariaTab } from "./SocietariaTab";
import { normalizeDocument, normalizePhone, splitNitAndDv, upperText } from "./normalize";

interface Props {
  open: boolean;
  company: Company | null; // null = nueva
  /** Valores sugeridos para una empresa nueva (ej. NIT y razón social leídos de un archivo). */
  initial?: Partial<CompanyInput>;
  /** Tras crear, la ficha sigue abierta (para agregar socios) en vez de cerrarse. */
  keepOpenOnCreate?: boolean;
  /** Pestaña con la que abre una empresa existente (por defecto «Resumen y documentos»). */
  initialTab?: CompanyTab;
  onClose: () => void;
  onSaved: (company: Company) => void;
}

const toInput = (company: Company): CompanyInput => {
  const { id: _id, createdAt: _c, updatedAt: _u, documents: _d, ...rest } = company;
  return { ...EMPTY_COMPANY_INPUT, ...rest, newDocuments: [] };
};

/**
 * Ficha de empresa como espacio de trabajo: encabezado fijo (identidad, estado de guardado, documentos, Guardar / Cerrar) y
 * cuatro pestañas que comparten un único borrador, así que cambiar de pestaña no pierde nada. Una empresa nueva empieza en
 * «Resumen y documentos»; los socios se habilitan tras el primer guardado.
 */
export function CompanyFormModal({ open, company: companyProp, initial, keepOpenOnCreate, initialTab, onClose, onSaved }: Props) {
  const toast = useToast();
  const [company, setCompany] = useState<Company | null>(companyProp);
  const [values, setValues] = useState<CompanyInput>(EMPTY_COMPANY_INPUT);
  const [baseline, setBaseline] = useState<CompanyInput>(EMPTY_COMPANY_INPUT);
  const [tab, setTab] = useState<CompanyTab>("resumen");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<CompanyErrors>({});
  const [blockers, setBlockers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  /** Configuración tributaria por empresa (Obligaciones tributarias): periodicidad de IVA. */
  const [vatPeriodicity, setVatPeriodicity] = useState<VatPeriodicity | "">("");
  const [savedPeriodicity, setSavedPeriodicity] = useState<VatPeriodicity | "">("");
  const imports = useCompanyImport(values, setValues);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const start: CompanyInput = companyProp ? toInput(companyProp) : { ...EMPTY_COMPANY_INPUT, ...initial };
    setCompany(companyProp);
    setValues(start);
    setBaseline(start);
    setTab(companyProp && initialTab ? initialTab : "resumen");
    setErrors({});
    setBlockers([]);
    setError(null);
    setLogoPreview(null);
    void getLogoDataUrl(start.logoFile).then(setLogoPreview);
    setVatPeriodicity("");
    setSavedPeriodicity("");
    if (companyProp)
      void taxService.settings(companyProp.id).then(
        (t) => {
          setVatPeriodicity(t?.vatPeriodicity ?? "");
          setSavedPeriodicity(t?.vatPeriodicity ?? "");
        },
        () => undefined,
      );
    // `initial` solo se aplica al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, companyProp]);

  const dirty = useMemo(() => {
    const tabs = dirtyTabs(baseline, values, imports.pending.length > 0);
    if (vatPeriodicity !== savedPeriodicity && !tabs.includes("fiscal")) tabs.push("fiscal");
    return tabs;
  }, [baseline, values, imports.pending.length, vatPeriodicity, savedPeriodicity]);
  const hasChanges = dirty.length > 0 || (!company && !!values.razonSocial);

  // Cerrar la ventana con cambios sin guardar pide confirmación.
  useEffect(() => {
    if (!open || !hasChanges) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [open, hasChanges]);

  const discardAndClose = useCallback(async () => {
    await imports.discardPending();
    // El RUT de un socio cargado y aún sin guardar tampoco debe quedar huérfano al cancelar.
    await Promise.allSettled(values.shareholders.flatMap((s) => (s.newDocuments ?? []).map((d) => companyService.discardDocument(d.storedFile))));
    setConfirmClose(false);
    onClose();
  }, [imports, values.shareholders, onClose]);

  const requestClose = useCallback(() => {
    if (saving) return;
    if (hasChanges) setConfirmClose(true);
    else void discardAndClose();
  }, [saving, hasChanges, discardAndClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirmClose && !document.querySelector(".modal-backdrop,.menu")) requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, confirmClose, requestClose]);

  async function save(): Promise<boolean> {
    const errs = validateCompany(values);
    setErrors(errs);
    const blocking = [...imports.blockers];
    setBlockers(blocking);
    if (Object.keys(errs).length || blocking.length) {
      const where = firstErrorTab(errs);
      if (where) setTab(where);
      else if (blocking.length) setTab(imports.conflicts.length ? "resumen" : "societaria");
      return false;
    }
    // Lo que se envía ya va normalizado igual que lo normaliza el backend.
    const { nit, dv } = splitNitAndDv(values.nit, values.dv);
    const principal = selectedRep(values, "principal");
    const alternate = selectedRep(values, "alternate");
    const payload: CompanyInput = {
      ...values,
      razonSocial: upperText(values.razonSocial),
      nit,
      dv,
      direccion: upperText(values.direccion),
      ciudad: upperText(values.ciudad),
      telefono: normalizePhone(values.telefono),
      correo: values.correo.trim().toLowerCase(),
      infoAdicional: upperText(values.infoAdicional),
      legalRepName: principal ? upperText(principal.name) : "",
      legalRepDocument: principal ? normalizeDocument(principal.document) : "",
      legalRepManual: principal?.kind === "manual",
      legalRepAltName: alternate ? upperText(alternate.name) : "",
      legalRepAltDocument: alternate ? normalizeDocument(alternate.document) : "",
      legalRepAltManual: alternate?.kind === "manual",
      shareholders: values.shareholders.map((s, i) => ({ ...s, name: upperText(s.name), identityDocument: normalizeDocument(s.identityDocument), sortOrder: i })),
      newDocuments: imports.pending.map((d) => ({ kind: d.kind, fileName: d.fileName, storedFile: d.storedFile })),
    };
    setSaving(true);
    setError(null);
    try {
      const created = !company;
      const saved = company ? await companyService.update(company.id, payload) : await companyService.create(payload);
      imports.markSaved();
      if (vatPeriodicity !== savedPeriodicity && vatPeriodicity) await taxService.saveSettings({ companyId: saved.id, vatPeriodicity });
      toast(created ? "Empresa creada." : "Empresa actualizada.");
      const fresh = toInput(saved);
      setCompany(saved);
      setValues(fresh);
      setBaseline(fresh);
      setSavedPeriodicity(vatPeriodicity);
      setBlockers([]);
      onSaved(saved);
      if (created && keepOpenOnCreate) setTab("societaria");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const status = company ? companyStatus({ ...company, ...values, documents: company.documents }) : null;
  const dv = values.dv ? `-${values.dv}` : "";
  const tabs = COMPANY_TABS.map((t) => ({ ...t, dirty: dirty.includes(t.id) }));
  const common = { values, setValues, errors, imports, company };
  const docsCount = status?.documents.count ?? 0;

  return createPortal(
    <div className="workspace-backdrop" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="workspace" role="dialog" aria-modal="true" aria-label={company ? "Ficha de empresa" : "Nueva empresa"}>
        <header className="workspace__header">
          <LogoThumb src={logoPreview} />
          <div className="workspace__identity">
            <strong>{values.razonSocial || (company ? company.razonSocial : "Nueva empresa")}</strong>
            <div className="workspace__meta">
              <span className="selectable">{values.nit ? `NIT ${values.nit}${dv}` : "NIT sin definir"}</span>
              {values.ciudad && <span>{values.ciudad}</span>}
              <span title="Documentos vigentes cargados (RUT y Cámara de Comercio)" className="row" style={{ gap: 4 }}>
                <FileCheck2 size={12} /> {docsCount} de 2 documentos{imports.pending.length > 0 ? ` (+${imports.pending.length} sin guardar)` : ""}
              </span>
            </div>
          </div>
          <span className={`save-state ${hasChanges ? "save-state--dirty" : "save-state--ok"}`} role="status">
            {saving ? "Guardando…" : hasChanges ? "Cambios sin guardar" : company ? "Guardado" : "Sin guardar"}
          </span>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={company !== null && !hasChanges}>
            {company ? "Guardar" : "Crear empresa"}
          </Button>
          <Button variant="ghost" iconOnly icon={<X size={16} />} aria-label="Cerrar" title="Cerrar" onClick={requestClose} disabled={saving} />
        </header>
        <div className="workspace__tabs">
          <Tabs label="Secciones de la empresa" tabs={tabs} value={tab} onChange={setTab} />
        </div>
        <div className="workspace__body" ref={body} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          <div className="stack">
            {error && <Alert tone="danger">{error}</Alert>}
            {blockers.length > 0 && <Alert tone="danger" title="Antes de guardar" items={blockers} />}
            {Object.keys(errors).length > 0 && (
              <Alert tone="danger" title="Corrige estos campos para guardar">
                {Object.values(errors).join(" ")}
              </Alert>
            )}
            {tab === "resumen" && <ResumenTab {...common} goTo={setTab} />}
            {tab === "generales" && <GeneralesTab {...common} logoPreview={logoPreview} setLogoPreview={setLogoPreview} />}
            {tab === "societaria" && <SocietariaTab {...common} onSaveFirst={() => void save()} saving={saving} />}
            {tab === "fiscal" && <FiscalTab {...common} vatPeriodicity={vatPeriodicity} setVatPeriodicity={setVatPeriodicity} />}
          </div>
        </div>
        <footer className="workspace__footer">
          <span>
            {status ? (
              <>
                Estado: <Badge tone={status.state === "lista" ? "success" : status.state === "revision" ? "warning" : "danger"}>{status.state === "lista" ? "Lista" : status.state === "revision" ? "Requiere revisión" : "Faltan datos"}</Badge> {status.detail}
              </>
            ) : (
              "Empresa nueva: se guarda con el botón «Crear empresa»."
            )}
          </span>
          {hasChanges && dirty.length > 0 && <span>Cambios en: {COMPANY_TABS.filter((t) => dirty.includes(t.id)).map((t) => t.label).join(", ")}</span>}
        </footer>
      </div>
      <ConfirmDialog open={confirmClose} danger title="Hay cambios sin guardar" confirmLabel="Descartar y cerrar" message="Si cierras ahora se pierden los cambios y los documentos cargados que no se han guardado." onCancel={() => setConfirmClose(false)} onConfirm={() => void discardAndClose()} />
    </div>,
    document.body,
  );
}
