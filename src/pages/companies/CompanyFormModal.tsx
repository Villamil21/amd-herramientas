import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Field, FormSection, Input, Modal, Select, Textarea, useToast } from "../../components/ui";
import { taxService } from "../../modules/financial-statements/tax-obligations/services/taxService";
import type { VatPeriodicity } from "../../modules/financial-statements/tax-obligations/types";
import { LogoThumb } from "../../components/LogoThumb";
import { companyService, getLogoDataUrl } from "../../services/companyService";
import type { Company, CompanyInput, LegalRole } from "../../types/models";
import { CamaraRepWarnings, CompanyDocumentsSection } from "./import/CompanyDocuments";
import { SOURCE_LABEL, type ImportField } from "./import/importPlan";
import { assignRole, selectedRep } from "./import/legalReps";
import { useCompanyImport } from "./import/useCompanyImport";
import { ShareholdersSection } from "./ShareholdersSection";
import { capitalTotal, normalizeDocument, normalizePhone, splitNitAndDv, sumsTo100, totalPercent, upperText } from "./normalize";

const EMPTY: CompanyInput = {
  razonSocial: "", nit: "", direccion: "", ciudad: "", telefono: "", correo: "", infoAdicional: "", logoFile: null, dv: "", subscribedTotalShares: null, subscribedNominalValue: null, paidTotalShares: null, paidNominalValue: null, ciiuCode: "",
  legalRepName: "", legalRepDocument: "", legalRepAltName: "", legalRepAltDocument: "", legalRepManual: false, legalRepAltManual: false, shareholders: [], newDocuments: [],
};

interface Props {
  open: boolean;
  company: Company | null; // null = nueva
  /** Valores sugeridos para una empresa nueva (ej. NIT y razón social leídos de un archivo). */
  initial?: Partial<CompanyInput>;
  onClose: () => void;
  onSaved: (company: Company) => void;
}

type Errors = Partial<Record<keyof CompanyInput, string>> & { shareholders?: string; representation?: string };

const ROLE_LABEL: Record<LegalRole, string> = { principal: "Principal", alternate: "Suplente" };

function validate(v: CompanyInput): Errors {
  const e: Errors = {};
  if (!v.razonSocial.trim()) e.razonSocial = "La razón social es obligatoria.";
  const nit = splitNitAndDv(v.nit, v.dv);
  if (!v.nit.trim()) e.nit = "El NIT es obligatorio.";
  else if (nit.error) e.nit = nit.error;
  else if (!/^\d+$/.test(nit.nit)) e.nit = "Solo números; el DV va en su propio campo.";
  if (v.dv.trim() && !/^\d+$/.test(v.dv.replace(/\s/g, ""))) e.dv = "Solo números.";
  if (v.ciiuCode.trim() && !/^\d{1,6}$/.test(v.ciiuCode.trim())) e.ciiuCode = "Solo números (ej. 6201 o 0111).";
  if (v.correo.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.correo.trim())) e.correo = "Correo no válido.";

  const people = v.shareholders;
  if (people.some((s) => !s.name.trim() || !s.identityDocument.trim() || !(s.percentage > 0) || s.percentage > 100)) {
    e.shareholders = "Cada accionista necesita nombre, documento y un porcentaje mayor que 0 y hasta 100.";
  } else if (people.some((s) => Math.abs(s.percentage * 100 - Math.round(s.percentage * 100)) > 1e-6)) {
    e.shareholders = "La participación admite hasta dos decimales (por ejemplo 50,20).";
  } else if (people.length && !sumsTo100(people)) {
    e.shareholders = `La participación debe sumar exactamente 100 % (hoy suma ${totalPercent(people)} %).`;
  }
  const principal = selectedRep(v, "principal");
  const alternate = selectedRep(v, "alternate");
  if (alternate && !principal) e.representation = "Define primero el representante legal principal; el suplente no lo reemplaza.";
  else if (principal?.kind === "manual" && !v.legalRepManual) e.representation = "El representante legal principal debe seleccionarse entre los socios.";
  else if (alternate?.kind === "manual" && !v.legalRepAltManual) e.representation = "El representante legal suplente debe seleccionarse entre los socios.";
  return e;
}

export function CompanyFormModal({ open, company, initial, onClose, onSaved }: Props) {
  const toast = useToast();
  const [values, setValues] = useState<CompanyInput>(EMPTY);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [blockers, setBlockers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Configuración tributaria por empresa (Obligaciones tributarias): periodicidad de IVA. */
  const [vatPeriodicity, setVatPeriodicity] = useState<VatPeriodicity | "">("");
  const [savedPeriodicity, setSavedPeriodicity] = useState<VatPeriodicity | "">("");
  const imports = useCompanyImport(values, setValues);

  useEffect(() => {
    if (!open) return;
    const { id: _id, createdAt: _c, updatedAt: _u, documents: _d, ...rest } = company ?? ({} as Company);
    const start: CompanyInput = company ? { ...EMPTY, ...rest, newDocuments: [] } : { ...EMPTY, ...initial };
    setValues(start);
    setErrors({});
    setBlockers([]);
    setError(null);
    setLogoPreview(null);
    void getLogoDataUrl(start.logoFile).then(setLogoPreview);
    setVatPeriodicity("");
    setSavedPeriodicity("");
    if (company)
      void taxService.settings(company.id).then(
        (t) => {
          setVatPeriodicity(t?.vatPeriodicity ?? "");
          setSavedPeriodicity(t?.vatPeriodicity ?? "");
        },
        () => undefined,
      );
    // `initial` solo se aplica al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, company]);

  const cop = (pesos: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(pesos);
  const subscribedTotal = capitalTotal(values.subscribedTotalShares, values.subscribedNominalValue);
  const paidTotal = capitalTotal(values.paidTotalShares, values.paidNominalValue);
  const capitalGap = (subscribedTotal ?? 0) - (paidTotal ?? 0);

  const set = (key: keyof CompanyInput) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  /** «Desde RUT» junto al campo mientras conserve el valor precargado; si se edita, deja de mostrarse. */
  const withOrigin = (field: ImportField, hint?: ReactNode): ReactNode => {
    const origin = imports.origins[field];
    if (!origin || String(values[field]) !== String(origin.value)) return hint;
    return (
      <>
        <Badge>{`Desde ${origin.sources.map((s) => SOURCE_LABEL[s]).join(" y ")}`}</Badge> {hint}
      </>
    );
  };

  async function pickLogo() {
    setPicking(true);
    setError(null);
    try {
      const result = await companyService.pickLogo();
      if (result) {
        setValues((v) => ({ ...v, logoFile: result.logoFile }));
        setLogoPreview(result.dataUrl);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPicking(false);
    }
  }

  async function close() {
    await imports.discardPending();
    // El RUT de un socio cargado y aún sin guardar tampoco debe quedar huérfano al cancelar.
    await Promise.allSettled(values.shareholders.flatMap((s) => (s.newDocuments ?? []).map((d) => companyService.discardDocument(d.storedFile))));
    onClose();
  }

  const updateShareholders = (update: (list: CompanyInput["shareholders"]) => CompanyInput["shareholders"]) =>
    setValues((v) => {
      let list = update(v.shareholders).map((s, i) => ({ ...s, sortOrder: i }));
      // Un único socio parte con el 100 %.
      if (list.length === 1 && !(list[0].percentage > 0)) list = [{ ...list[0], percentage: 100 }];
      return { ...v, shareholders: list };
    });

  function selectRep(role: LegalRole, value: string) {
    setValues((v) => {
      const clear = role === "principal" ? { legalRepName: "", legalRepDocument: "", legalRepManual: false } : { legalRepAltName: "", legalRepAltDocument: "", legalRepAltManual: false };
      return { ...v, ...clear, shareholders: assignRole(v.shareholders, role, value === "" ? null : Number(value)) };
    });
  }

  async function save() {
    const errs = validate(values);
    setErrors(errs);
    const blocking = [...imports.blockers];
    setBlockers(blocking);
    if (Object.keys(errs).length || blocking.length) return;
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
      const saved = company ? await companyService.update(company.id, payload) : await companyService.create(payload);
      imports.markSaved();
      if (vatPeriodicity !== savedPeriodicity && vatPeriodicity) await taxService.saveSettings({ companyId: saved.id, vatPeriodicity });
      toast(company ? "Empresa actualizada." : "Empresa creada.");
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const repOptions = useMemo(() => values.shareholders.map((s, i) => ({ index: i, label: s.name.trim() ? `${s.name.trim()}${s.identityDocument.trim() ? ` · ${s.identityDocument.trim()}` : ""}` : `Accionista ${i + 1} (sin nombre)`, role: s.legalRole ?? null })), [values.shareholders]);

  return (
    <Modal
      open={open}
      size="xl"
      title={company ? "Editar empresa" : "Nueva empresa"}
      description="Empresa que emite documentos y certificados."
      onClose={() => void close()}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={() => void close()} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            {company ? "Guardar cambios" : "Crear empresa"}
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        {blockers.length > 0 && <Alert tone="danger" title="Antes de guardar" items={blockers} />}

        <FormSection step={1} title="Documentos" hint="Carga el RUT y/o la Cámara de Comercio para precargar datos. Se leen en este equipo, nada se envía a servicios externos. Cada carga queda como una versión guardada con la empresa.">
          <CompanyDocumentsSection saved={company?.documents ?? []} values={values} imports={imports} />
        </FormSection>

        <FormSection step={2} title="Identificación">
          <div className="company-identity">
            <div className="company-identity__logo">
              <LogoThumb src={logoPreview} size="lg" />
              <div className="row" style={{ gap: 4 }}>
                <Button size="sm" icon={<ImagePlus size={14} />} onClick={() => void pickLogo()} loading={picking}>
                  {values.logoFile ? "Cambiar" : "Cargar logo"}
                </Button>
                {values.logoFile && (
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    icon={<Trash2 size={14} />}
                    aria-label="Quitar logo"
                    title="Quitar logo"
                    onClick={() => {
                      setValues((v) => ({ ...v, logoFile: null }));
                      setLogoPreview(null);
                    }}
                  />
                )}
              </div>
            </div>
            <div className="form-grid form-grid--3 form-grid--compact company-identity__fields">
              <Field label="Razón social" required error={errors.razonSocial} hint={withOrigin("razonSocial")} className="span-3">
                {(id) => <Input id={id} value={values.razonSocial} onChange={set("razonSocial")} invalid={!!errors.razonSocial} autoFocus />}
              </Field>
              <Field label="NIT" required error={errors.nit} hint={withOrigin("nit", "Sin puntos ni DV.")}>
                {(id) => (
                  <Input
                    id={id}
                    value={values.nit}
                    onChange={set("nit")}
                    onBlur={() => {
                      const split = splitNitAndDv(values.nit, values.dv);
                      if (!split.error) setValues((v) => ({ ...v, nit: split.nit, dv: split.dv }));
                    }}
                    invalid={!!errors.nit}
                    placeholder="900123456"
                  />
                )}
              </Field>
              <Field label="DV" error={errors.dv} hint={withOrigin("dv")}>
                {(id) => <Input id={id} value={values.dv} onChange={set("dv")} invalid={!!errors.dv} placeholder="1" />}
              </Field>
              <Field label="Código CIIU" error={errors.ciiuCode} hint={withOrigin("ciiuCode", "Define la tarifa de autorretención.")}>
                {(id) => <Input id={id} value={values.ciiuCode} onChange={set("ciiuCode")} invalid={!!errors.ciiuCode} placeholder="6201" inputMode="numeric" />}
              </Field>
              <Field label="Ciudad" hint={withOrigin("ciudad", "«Consignado en» de los certificados.")}>
                {(id) => <Input id={id} value={values.ciudad} onChange={set("ciudad")} />}
              </Field>
              <Field label="Dirección" className="span-2" hint={withOrigin("direccion")}>
                {(id) => <Input id={id} value={values.direccion} onChange={set("direccion")} />}
              </Field>
            </div>
          </div>
          <span className="field__hint">Logo PNG o JPG, máximo 5 MB; se usa en los documentos generados. Los textos se guardan en MAYÚSCULAS.</span>
        </FormSection>

        <FormSection step={3} title="Información societaria" hint="El Capital social del ESF es el suscrito; la diferencia con el pagado va a 132505 — A socios.">
          <div className="capital-grid">
            {(
              [
                ["Capital suscrito", "subscribedTotalShares", "subscribedNominalValue", subscribedTotal],
                ["Capital pagado", "paidTotalShares", "paidNominalValue", paidTotal],
              ] as const
            ).map(([label, sharesKey, nominalKey, total]) => {
              const shares = values[sharesKey];
              const nominal = values[nominalKey];
              return (
                <div key={label} className="capital-box">
                  <div className="capital-box__title">{label}</div>
                  <div className="form-grid form-grid--compact">
                    <Field label="Acciones" hint={withOrigin(sharesKey)}>
                      {(id) => <Input id={id} type="number" min="1" value={shares ?? ""} onChange={(e) => setValues((v) => ({ ...v, [sharesKey]: e.target.value ? Number(e.target.value) : null }))} />}
                    </Field>
                    <Field label="Valor nominal" hint={withOrigin(nominalKey)}>
                      {(id) => <Input id={id} type="number" min="1" value={nominal ?? ""} onChange={(e) => setValues((v) => ({ ...v, [nominalKey]: e.target.value ? Number(e.target.value) : null }))} />}
                    </Field>
                  </div>
                  <div className="capital-box__total">
                    <span>Valor total (acciones × valor nominal)</span>
                    <strong>{total !== null ? cop(total) : "—"}</strong>
                  </div>
                </div>
              );
            })}
          </div>
          {capitalGap > 0 && <div className="field__hint">Por pagar (132505 — A socios): {cop(capitalGap)}</div>}
          <ShareholdersSection values={values} company={company} update={updateShareholders} error={errors.shareholders} />
        </FormSection>

        <FormSection step={4} title="Representación legal" hint="El principal firma los Estados Financieros como «Representante Legal». El suplente es opcional y no lo reemplaza automáticamente. Se eligen entre los socios para no duplicar nombre y documento.">
          {errors.representation && <Alert tone="danger">{errors.representation}</Alert>}
          <div className="form-grid form-grid--compact">
            {(["principal", "alternate"] as LegalRole[]).map((role) => {
              const rep = selectedRep(values, role);
              const other: LegalRole = role === "principal" ? "alternate" : "principal";
              const current = repOptions.find((o) => o.role === role)?.index;
              return (
                <Field key={role} label={`Representante legal ${ROLE_LABEL[role].toLowerCase()}`} hint={rep?.kind === "manual" ? undefined : role === "alternate" && !selectedRep(values, "principal") ? "Define primero el principal." : undefined}>
                  {(id) => (
                    <Select id={id} value={rep?.kind === "manual" ? "manual" : current === undefined ? "" : String(current)} onChange={(e) => e.target.value !== "manual" && selectRep(role, e.target.value)} disabled={role === "alternate" && !selectedRep(values, "principal")}>
                      <option value="">{role === "principal" ? "Sin seleccionar" : "Sin suplente"}</option>
                      {rep?.kind === "manual" && <option value="manual">{rep.name} (excepción: no es socio)</option>}
                      {repOptions.map((o) => (
                        <option key={o.index} value={o.index} disabled={o.role === other}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              );
            })}
          </div>
          {values.shareholders.length === 0 && <span className="muted">Agrega primero a los socios para elegir al representante legal.</span>}
          {(["principal", "alternate"] as LegalRole[]).map((role) => {
            const rep = selectedRep(values, role);
            return rep?.kind === "manual" ? (
              <Alert key={role} tone="warning" title={`Representante ${ROLE_LABEL[role].toLowerCase()} fuera de los socios (excepción confirmada)`}>
                {rep.name} · {rep.document || "sin documento"}.{" "}
                <Button size="sm" variant="ghost" onClick={() => selectRep(role, "")}>
                  Quitar excepción
                </Button>
              </Alert>
            ) : null;
          })}
          <CamaraRepWarnings values={values} imports={imports} />
        </FormSection>

        <FormSection step={5} title="Configuración tributaria" hint="Parámetros por empresa que usan Obligaciones tributarias y los módulos de Impuestos.">
          <div className="form-grid form-grid--compact">
            <Field label="Periodicidad de IVA" hint="Bimestral o cuatrimestral. Se compara con la que trae cada declaración.">
              {(id) => (
                <Select id={id} value={vatPeriodicity} onChange={(e) => setVatPeriodicity(e.target.value as VatPeriodicity | "")}>
                  <option value="">Sin configurar</option>
                  <option value="bimonthly">Bimestral</option>
                  <option value="four_monthly">Cuatrimestral</option>
                </Select>
              )}
            </Field>
            <Field label="Código CIIU (autorretención)" hint="Se edita en Identificación.">
              {(id) => <Input id={id} value={values.ciiuCode || "Sin configurar"} readOnly disabled />}
            </Field>
          </div>
        </FormSection>

        <FormSection step={6} title="Información adicional">
          <div className="form-grid form-grid--compact">
            <Field label="Teléfono" hint={withOrigin("telefono", "Sin espacios ni separadores.")}>
              {(id) => <Input id={id} value={values.telefono} onChange={set("telefono")} />}
            </Field>
            <Field label="Correo electrónico" error={errors.correo} hint={withOrigin("correo")}>
              {(id) => <Input id={id} type="email" value={values.correo} onChange={set("correo")} invalid={!!errors.correo} />}
            </Field>
            <Field label="Información adicional" className="span-2">
              {(id) => <Textarea id={id} value={values.infoAdicional} onChange={set("infoAdicional")} rows={2} />}
            </Field>
          </div>
        </FormSection>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
