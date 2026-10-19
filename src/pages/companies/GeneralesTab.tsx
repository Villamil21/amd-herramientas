import { useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Alert, Button, Field, Input, Textarea } from "../../components/ui";
import { LogoThumb } from "../../components/LogoThumb";
import { companyService } from "../../services/companyService";
import { LocationFields } from "../../modules/exogena/components/ThirdPartyForm";
import { useCatalogs } from "../../modules/exogena/hooks";
import { originMark } from "./OriginMark";
import { splitNitAndDv } from "./normalize";
import type { TabProps } from "./tabs";

interface Props extends TabProps {
  logoPreview: string | null;
  setLogoPreview: (url: string | null) => void;
}

/** Datos generales: logo, identificación, ubicación y contacto. El CIIU no se edita aquí (vive en Fiscal y registral). */
export function GeneralesTab({ values, setValues, errors, imports, logoPreview, setLogoPreview }: Props) {
  const { catalogs } = useCatalogs();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: "razonSocial" | "nit" | "dv" | "ciudad" | "direccion" | "telefono" | "correo" | "infoAdicional") => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const mark = (f: Parameters<typeof originMark>[0]) => originMark(f, values, imports);

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

  return (
    <div className="stack">
      {error && <Alert tone="danger">{error}</Alert>}
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
          <span className="field__hint">PNG o JPG, máx. 5 MB</span>
        </div>
        <div className="form-grid form-grid--3 form-grid--compact company-identity__fields">
          <Field label="Razón social" labelAdornment={mark("razonSocial")} required error={errors.razonSocial} className="span-3">
            {(id) => <Input id={id} value={values.razonSocial} onChange={set("razonSocial")} invalid={!!errors.razonSocial} autoFocus={!values.razonSocial} />}
          </Field>
          <Field label="NIT" labelAdornment={mark("nit")} required error={errors.nit} hint="Sin puntos ni DV.">
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
          <Field label="DV" labelAdornment={mark("dv")} error={errors.dv}>
            {(id) => <Input id={id} value={values.dv} onChange={set("dv")} invalid={!!errors.dv} placeholder="1" />}
          </Field>
          <Field label="Ciudad" labelAdornment={mark("ciudad")} hint="«Consignado en» de los certificados.">
            {(id) => <Input id={id} value={values.ciudad} onChange={set("ciudad")} />}
          </Field>
          <Field label="Teléfono" labelAdornment={mark("telefono")} hint="Sin espacios ni separadores.">
            {(id) => <Input id={id} value={values.telefono} onChange={set("telefono")} />}
          </Field>
          <Field label="Correo electrónico" labelAdornment={mark("correo")} error={errors.correo} className="span-2">
            {(id) => <Input id={id} type="email" value={values.correo} onChange={set("correo")} invalid={!!errors.correo} />}
          </Field>
          <Field label="Información adicional" className="span-3">
            {(id) => <Textarea id={id} value={values.infoAdicional} onChange={set("infoAdicional")} rows={2} />}
          </Field>
        </div>
      </div>
      <div className="stack stack--sm">
        <strong>Domicilio {mark("direccion")}</strong>
        <span className="field__hint">Es el domicilio que Información Exógena copia al beneficiario del formato 2276. Los códigos de país, departamento y municipio son los del catálogo de la DIAN.</span>
        <LocationFields
          value={{ address: values.direccion, countryCode: values.countryCode, deptCode: values.deptCode, muniCode: values.muniCode }}
          onChange={(p) => setValues((v) => ({ ...v, ...(p.address !== undefined ? { direccion: p.address } : {}), ...(p.countryCode !== undefined ? { countryCode: p.countryCode } : {}), ...(p.deptCode !== undefined ? { deptCode: p.deptCode } : {}), ...(p.muniCode !== undefined ? { muniCode: p.muniCode } : {}) }))}
          catalogs={catalogs}
        />
      </div>
      <span className="field__hint">Los textos se guardan en MAYÚSCULAS; NIT, documentos y teléfonos, sin separadores.</span>
    </div>
  );
}
