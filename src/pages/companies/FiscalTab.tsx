import { RefreshCw } from "lucide-react";
import { Alert, Badge, Button, DateInput, Field, Input, Select, Textarea } from "../../components/ui";
import type { VatPeriodicity } from "../../modules/financial-statements/tax-obligations/types";
import { originMark } from "./OriginMark";
import { composeEntityNarrative, REGISTRAL_LABEL, type RegistralField } from "./import/registral";
import type { TabProps } from "./tabs";

interface Props extends TabProps {
  vatPeriodicity: VatPeriodicity | "";
  setVatPeriodicity: (v: VatPeriodicity | "") => void;
}

const DOC_TYPES = ["Documento privado", "Escritura pública", "Acta", "Certificación", "Formulario", "Sentencia", "Resolución"];

/**
 * Fiscal y registral: CIIU (único lugar donde se edita), periodicidad de IVA y datos registrales que alimentan las Notas
 * Financieras. Un dato que la Cámara no permitió confirmar queda marcado «Revisar» hasta que el usuario lo edita o lo confirma.
 */
export function FiscalTab({ values, setValues, errors, imports, vatPeriodicity, setVatPeriodicity }: Props) {
  const flagged = (f: RegistralField) => values.registralReview.includes(f);
  const reviewMark = (f: RegistralField) => (flagged(f) ? <span className="review-mark"><Badge tone="warning">Revisar</Badge></span> : undefined);
  const mark = (f: RegistralField) => originMark(f, values, imports);
  const adornment = (f: RegistralField) => (
    <>
      {mark(f)}
      {reviewMark(f)}
    </>
  );
  /** Editar un dato registral lo da por revisado. */
  const setR = (f: RegistralField, value: string) => setValues((v) => ({ ...v, [f]: value, registralReview: v.registralReview.filter((x) => x !== f) }));
  const confirm = (f: RegistralField) => setValues((v) => ({ ...v, registralReview: v.registralReview.filter((x) => x !== f) }));
  const pending = values.registralReview.filter((f) => (f as RegistralField) in REGISTRAL_LABEL) as RegistralField[];

  const regenerate = () => {
    const text = composeEntityNarrative({ name: values.razonSocial, domicileCity: values.ciudad, chamber: values.registryChamber, constitutionDate: values.constitutionDate, registryNumber: values.registryNumber, registryBook: values.registryBook });
    setValues((v) => ({ ...v, entityNarrative: text, registralReview: v.registralReview.filter((x) => x !== "entityNarrative") }));
  };
  const canRegenerate = !!(values.razonSocial.trim() && values.registryChamber.trim() && values.constitutionDate);

  return (
    <div className="stack">
      {pending.length > 0 && (
        <Alert tone="warning" title={`${pending.length} ${pending.length === 1 ? "dato registral por revisar" : "datos registrales por revisar"}`}>
          La Cámara de Comercio no permitió confirmarlos con certeza ({pending.map((f) => REGISTRAL_LABEL[f]).join(", ")}). Complétalos o corrígelos; al editar un campo deja de aparecer «Revisar», o confírmalo tal cual está.
        </Alert>
      )}
      <div className="tab-grid">
        <section className="stack stack--sm">
          <strong className="form-section__subtitle">Fiscal</strong>
          <div className="form-grid form-grid--compact">
            <Field label="Código CIIU" labelAdornment={originMark("ciiuCode", values, imports)} error={errors.ciiuCode} hint="Define la tarifa de autorretención.">
              {(id) => <Input id={id} value={values.ciiuCode} onChange={(e) => setValues((v) => ({ ...v, ciiuCode: e.target.value }))} invalid={!!errors.ciiuCode} placeholder="6201" inputMode="numeric" />}
            </Field>
            <Field label="Periodicidad de IVA" hint="Se compara con la que trae cada declaración.">
              {(id) => (
                <Select id={id} value={vatPeriodicity} onChange={(e) => setVatPeriodicity(e.target.value as VatPeriodicity | "")}>
                  <option value="">Sin configurar</option>
                  <option value="bimonthly">Bimestral</option>
                  <option value="four_monthly">Cuatrimestral</option>
                </Select>
              )}
            </Field>
          </div>
        </section>

        <section className="stack stack--sm">
          <strong className="form-section__subtitle">Registro mercantil</strong>
          <div className="form-grid form-grid--compact">
            <Field label={REGISTRAL_LABEL.registryChamber} labelAdornment={adornment("registryChamber")}>
              {(id) => <Input id={id} value={values.registryChamber} onChange={(e) => setR("registryChamber", e.target.value)} placeholder="Cámara de Comercio de …" />}
            </Field>
            <Field label={REGISTRAL_LABEL.registryCity} labelAdornment={adornment("registryCity")}>
              {(id) => <Input id={id} value={values.registryCity} onChange={(e) => setR("registryCity", e.target.value)} />}
            </Field>
            <Field label={REGISTRAL_LABEL.constitutionDocType} labelAdornment={adornment("constitutionDocType")}>
              {(id) => (
                <>
                  <Input id={id} list={`${id}-types`} value={values.constitutionDocType} onChange={(e) => setR("constitutionDocType", e.target.value)} />
                  <datalist id={`${id}-types`}>
                    {DOC_TYPES.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field label={REGISTRAL_LABEL.constitutionDate} labelAdornment={adornment("constitutionDate")}>
              {(id) => <DateInput id={id} value={values.constitutionDate} onChange={(iso) => setR("constitutionDate", iso)} />}
            </Field>
            <Field label={REGISTRAL_LABEL.registryNumber} labelAdornment={adornment("registryNumber")}>
              {(id) => <Input id={id} value={values.registryNumber} onChange={(e) => setR("registryNumber", e.target.value.replace(/\D/g, ""))} inputMode="numeric" />}
            </Field>
            <Field label={REGISTRAL_LABEL.registryBook} labelAdornment={adornment("registryBook")}>
              {(id) => <Input id={id} value={values.registryBook} onChange={(e) => setR("registryBook", e.target.value.toUpperCase())} placeholder="IX" />}
            </Field>
            <Field label={REGISTRAL_LABEL.registryDate} labelAdornment={adornment("registryDate")} hint="Fecha de inscripción en esta Cámara.">
              {(id) => <DateInput id={id} value={values.registryDate} onChange={(iso) => setR("registryDate", iso)} />}
            </Field>
          </div>
        </section>

        <section className="stack stack--sm span-all">
          <div className="row row--between">
            <strong className="form-section__subtitle">Ente económico y objeto social</strong>
            <span className="field__hint">Se usan en las Notas Financieras; ahí también se pueden ajustar para cada período.</span>
          </div>
          <Field label={REGISTRAL_LABEL.entityNarrative} labelAdornment={adornment("entityNarrative")}>
            {(id) => <Textarea id={id} rows={3} value={values.entityNarrative} onChange={(e) => setR("entityNarrative", e.target.value)} placeholder="Ej.: La sociedad … con domicilio en …, es una entidad privada, constituida ante …" />}
          </Field>
          <div className="row">
            <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={regenerate} disabled={!canRegenerate} title={canRegenerate ? "Redacta el texto con los datos registrales de arriba" : "Faltan razón social, Cámara o fecha de constitución"}>
              Redactar con los datos de arriba
            </Button>
            {flagged("entityNarrative") && values.entityNarrative && (
              <Button size="sm" variant="ghost" onClick={() => confirm("entityNarrative")}>
                Confirmar texto
              </Button>
            )}
          </div>
          <Field label={REGISTRAL_LABEL.corporatePurpose} labelAdornment={adornment("corporatePurpose")}>
            {(id) => <Textarea id={id} rows={7} value={values.corporatePurpose} onChange={(e) => setR("corporatePurpose", e.target.value)} />}
          </Field>
          {flagged("corporatePurpose") && values.corporatePurpose && (
            <div>
              <Button size="sm" variant="ghost" onClick={() => confirm("corporatePurpose")}>
                Confirmar objeto social
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
