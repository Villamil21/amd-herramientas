import { useEffect, useState } from "react";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { Alert, Button, Field, FormSection, Input, Modal, Select, Textarea, useToast } from "../../components/ui";
import { taxService } from "../../modules/financial-statements/tax-obligations/services/taxService";
import type { VatPeriodicity } from "../../modules/financial-statements/tax-obligations/types";
import { LogoThumb } from "../../components/LogoThumb";
import { companyService, getLogoDataUrl } from "../../services/companyService";
import type { Company, CompanyInput } from "../../types/models";

const EMPTY: CompanyInput = {
  razonSocial: "", nit: "", direccion: "", ciudad: "", telefono: "", correo: "", infoAdicional: "", logoFile: null, dv: "", subscribedTotalShares: null, subscribedNominalValue: null, paidTotalShares: null, paidNominalValue: null, ciiuCode: "", legalRepName: "", legalRepDocument: "", shareholders: [],
};

interface Props {
  open: boolean;
  company: Company | null; // null = nueva
  /** Valores sugeridos para una empresa nueva (ej. NIT y razón social leídos de un archivo). */
  initial?: Partial<CompanyInput>;
  onClose: () => void;
  onSaved: (company: Company) => void;
}

type Errors = Partial<Record<keyof CompanyInput, string>>;

function validate(v: CompanyInput): Errors {
  const e: Errors = {};
  if (!v.razonSocial.trim()) e.razonSocial = "La razón social es obligatoria.";
  if (!v.nit.trim()) e.nit = "El NIT es obligatorio.";
  else if (!/^[\d.\- ]+$/.test(v.nit.trim())) e.nit = "Solo números, puntos y guion.";
  if (v.ciiuCode.trim() && !/^\d{1,6}$/.test(v.ciiuCode.trim())) e.ciiuCode = "Solo números (ej. 6201 o 0111).";
  if (v.correo.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.correo.trim())) e.correo = "Correo no válido.";
  return e;
}

export function CompanyFormModal({ open, company, initial, onClose, onSaved }: Props) {
  const toast = useToast();
  const [values, setValues] = useState<CompanyInput>(EMPTY);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Configuración tributaria por empresa (Obligaciones tributarias): periodicidad de IVA. */
  const [vatPeriodicity, setVatPeriodicity] = useState<VatPeriodicity | "">("");
  const [savedPeriodicity, setSavedPeriodicity] = useState<VatPeriodicity | "">("");

  useEffect(() => {
    if (!open) return;
    const start = company ? { ...EMPTY, ...company } : { ...EMPTY, ...initial };
    setValues(start);
    setErrors({});
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
  const capitalGap = (values.subscribedTotalShares ?? 0) * (values.subscribedNominalValue ?? 0) - (values.paidTotalShares ?? 0) * (values.paidNominalValue ?? 0);
  const totalPct = values.shareholders.reduce((sum, s) => sum + (s.percentage || 0), 0);

  const set = (key: keyof CompanyInput) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

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

  async function save() {
    const errs = validate(values);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setError(null);
    try {
      const saved = company ? await companyService.update(company.id, values) : await companyService.create(values);
      if (vatPeriodicity !== savedPeriodicity && vatPeriodicity) await taxService.saveSettings({ companyId: saved.id, vatPeriodicity });
      toast(company ? "Empresa actualizada." : "Empresa creada.");
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      size="xl"
      title={company ? "Editar empresa" : "Nueva empresa"}
      description="Empresa que emite documentos y certificados."
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
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

        <FormSection step={1} title="Identificación">
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
              <Field label="Razón social" required error={errors.razonSocial} className="span-3">
                {(id) => <Input id={id} value={values.razonSocial} onChange={set("razonSocial")} invalid={!!errors.razonSocial} autoFocus />}
              </Field>
              <Field label="NIT" required error={errors.nit}>
                {(id) => <Input id={id} value={values.nit} onChange={set("nit")} invalid={!!errors.nit} placeholder="900123456" />}
              </Field>
              <Field label="DV">{(id) => <Input id={id} value={values.dv} onChange={set("dv")} placeholder="1" />}</Field>
              <Field label="Código CIIU" error={errors.ciiuCode} hint="Define la tarifa de autorretención.">
                {(id) => <Input id={id} value={values.ciiuCode} onChange={set("ciiuCode")} invalid={!!errors.ciiuCode} placeholder="6201" inputMode="numeric" />}
              </Field>
              <Field label="Ciudad" hint="«Consignado en» de los certificados.">
                {(id) => <Input id={id} value={values.ciudad} onChange={set("ciudad")} />}
              </Field>
              <Field label="Dirección" className="span-2">
                {(id) => <Input id={id} value={values.direccion} onChange={set("direccion")} />}
              </Field>
            </div>
          </div>
          <span className="field__hint">Logo PNG o JPG, máximo 5 MB; se usa en los documentos generados.</span>
        </FormSection>

        <FormSection step={2} title="Representación legal" hint="Firma los Estados Financieros como «Representante Legal».">
          <div className="form-grid form-grid--compact">
            <Field label="Representante legal">{(id) => <Input id={id} value={values.legalRepName} onChange={set("legalRepName")} />}</Field>
            <Field label="Documento" hint="Ej. CC 1.192.729.629">
              {(id) => <Input id={id} value={values.legalRepDocument} onChange={set("legalRepDocument")} />}
            </Field>
          </div>
        </FormSection>

        <FormSection step={3} title="Información societaria" hint="El Capital social del ESF es el suscrito; la diferencia con el pagado va a 132505 — A socios.">
          <div className="capital-grid">
            {(
              [
                ["Capital suscrito", "subscribedTotalShares", "subscribedNominalValue"],
                ["Capital pagado", "paidTotalShares", "paidNominalValue"],
              ] as const
            ).map(([label, sharesKey, nominalKey]) => {
              const shares = values[sharesKey];
              const nominal = values[nominalKey];
              return (
                <div key={label} className="capital-box">
                  <div className="capital-box__title">{label}</div>
                  <div className="form-grid form-grid--compact">
                    <Field label="Acciones">
                      {(id) => <Input id={id} type="number" min="1" value={shares ?? ""} onChange={(e) => setValues((v) => ({ ...v, [sharesKey]: e.target.value ? Number(e.target.value) : null }))} />}
                    </Field>
                    <Field label="Valor nominal">
                      {(id) => <Input id={id} type="number" min="1" value={nominal ?? ""} onChange={(e) => setValues((v) => ({ ...v, [nominalKey]: e.target.value ? Number(e.target.value) : null }))} />}
                    </Field>
                  </div>
                  <div className="capital-box__total">
                    <span>Valor total</span>
                    <strong>{shares && nominal ? cop(shares * nominal) : "—"}</strong>
                  </div>
                </div>
              );
            })}
          </div>
          {capitalGap > 0 && <div className="field__hint">Por pagar (132505 — A socios): {cop(capitalGap)}</div>}
          <div className="row row--between">
            <strong className="form-section__subtitle">Socios / accionistas</strong>
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus size={14} />}
              onClick={() => setValues((v) => ({ ...v, shareholders: [...v.shareholders, { name: "", identityDocument: "", percentage: 0, sortOrder: v.shareholders.length }] }))}
            >
              Agregar socio
            </Button>
          </div>
          {values.shareholders.length === 0 ? (
            <span className="muted">Sin socios registrados.</span>
          ) : (
            <div className="shareholder-table">
              <div className="shareholder-table__head">
                <span>Nombre</span>
                <span>Documento</span>
                <span className="num">%</span>
                <span />
              </div>
              {values.shareholders.map((s, index) => {
                const update = (patch: Partial<typeof s>) => setValues((v) => ({ ...v, shareholders: v.shareholders.map((x, i) => (i === index ? { ...x, ...patch } : x)) }));
                return (
                  <div className="shareholder-table__row" key={index}>
                    <Input aria-label={`Nombre del accionista ${index + 1}`} value={s.name} onChange={(e) => update({ name: e.target.value })} />
                    <Input aria-label={`Documento del accionista ${index + 1}`} value={s.identityDocument} onChange={(e) => update({ identityDocument: e.target.value })} />
                    <Input aria-label={`Porcentaje del accionista ${index + 1}`} className="input--right" type="number" value={s.percentage || ""} onChange={(e) => update({ percentage: Number(e.target.value) })} />
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      icon={<Trash2 size={14} />}
                      aria-label={`Quitar accionista ${index + 1}`}
                      onClick={() => setValues((v) => ({ ...v, shareholders: v.shareholders.filter((_, i) => i !== index).map((x, i) => ({ ...x, sortOrder: i })) }))}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div className={`field__hint ${values.shareholders.length && Math.abs(totalPct - 100) > 0.000001 ? "text-danger" : ""}`}>
            Participación total: {totalPct}%. Debe sumar 100% para generar el certificado.
          </div>
        </FormSection>

        <FormSection step={4} title="Configuración tributaria" hint="Parámetros por empresa que usan Obligaciones tributarias y los módulos de Impuestos.">
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

        <FormSection step={5} title="Información adicional">
          <div className="form-grid form-grid--compact">
            <Field label="Teléfono">{(id) => <Input id={id} value={values.telefono} onChange={set("telefono")} />}</Field>
            <Field label="Correo electrónico" error={errors.correo}>
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
