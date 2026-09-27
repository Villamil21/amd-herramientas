import { useEffect, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Alert, Button, Field, Input, Modal, Textarea, useToast } from "../../components/ui";
import { LogoThumb } from "../../components/LogoThumb";
import { companyService, getLogoDataUrl } from "../../services/companyService";
import type { Company, CompanyInput } from "../../types/models";

const EMPTY: CompanyInput = {
  razonSocial: "", nit: "", direccion: "", ciudad: "", telefono: "", correo: "", infoAdicional: "", logoFile: null,
};

interface Props {
  open: boolean;
  company: Company | null; // null = nueva
  onClose: () => void;
  onSaved: (company: Company) => void;
}

type Errors = Partial<Record<keyof CompanyInput, string>>;

function validate(v: CompanyInput): Errors {
  const e: Errors = {};
  if (!v.razonSocial.trim()) e.razonSocial = "La razón social es obligatoria.";
  if (!v.nit.trim()) e.nit = "El NIT es obligatorio.";
  else if (!/^[\d.\- ]+$/.test(v.nit.trim())) e.nit = "Solo números, puntos y guion.";
  if (v.correo.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.correo.trim())) e.correo = "Correo no válido.";
  return e;
}

export function CompanyFormModal({ open, company, onClose, onSaved }: Props) {
  const toast = useToast();
  const [values, setValues] = useState<CompanyInput>(EMPTY);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const initial = company ? { ...EMPTY, ...company } : EMPTY;
    setValues(initial);
    setErrors({});
    setError(null);
    setLogoPreview(null);
    void getLogoDataUrl(initial.logoFile).then(setLogoPreview);
  }, [open, company]);

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
      size="lg"
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
        <div className="row" style={{ gap: 16, flexWrap: "nowrap" }}>
          <LogoThumb src={logoPreview} size="lg" />
          <div className="stack stack--sm">
            <div className="field__label">Logo</div>
            <div className="row">
              <Button size="sm" icon={<ImagePlus size={14} />} onClick={() => void pickLogo()} loading={picking}>
                {values.logoFile ? "Cambiar logo" : "Cargar logo"}
              </Button>
              {values.logoFile && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 size={14} />}
                  onClick={() => {
                    setValues((v) => ({ ...v, logoFile: null }));
                    setLogoPreview(null);
                  }}
                >
                  Quitar
                </Button>
              )}
            </div>
            <span className="field__hint">PNG o JPG, máximo 5 MB. Se usará en los documentos generados.</span>
          </div>
        </div>

        <div className="form-grid">
          <Field label="Razón social" required error={errors.razonSocial} className="span-2">
            {(id) => <Input id={id} value={values.razonSocial} onChange={set("razonSocial")} invalid={!!errors.razonSocial} autoFocus />}
          </Field>
          <Field label="NIT" required error={errors.nit}>
            {(id) => <Input id={id} value={values.nit} onChange={set("nit")} invalid={!!errors.nit} placeholder="900123456" />}
          </Field>
          <Field label="Ciudad" hint="Se usa como «Consignado en» en los certificados.">
            {(id) => <Input id={id} value={values.ciudad} onChange={set("ciudad")} />}
          </Field>
          <Field label="Dirección" className="span-2">
            {(id) => <Input id={id} value={values.direccion} onChange={set("direccion")} />}
          </Field>
          <Field label="Teléfono">
            {(id) => <Input id={id} value={values.telefono} onChange={set("telefono")} />}
          </Field>
          <Field label="Correo electrónico" error={errors.correo}>
            {(id) => <Input id={id} type="email" value={values.correo} onChange={set("correo")} invalid={!!errors.correo} />}
          </Field>
          <Field label="Información adicional" className="span-2">
            {(id) => <Textarea id={id} value={values.infoAdicional} onChange={set("infoAdicional")} rows={3} />}
          </Field>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
