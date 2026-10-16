import { Calculator } from "lucide-react";
import { useMemo } from "react";
import { Button, Field, Input, Select } from "../../../components/ui";
import type { ExoCatalogs } from "../../../types/exogena";
import type { PersonType } from "../../../types/models";
import { COLOMBIA, computeNitDv, DOC_NIT } from "../domain/thirdParty";

/** Identificación de un tercero tal como se edita en pantalla (proveedor, socio o registro de un formato). */
export interface IdentityValue {
  personType: PersonType | "";
  docTypeCode: string;
  docNumber: string;
  dv: string;
  firstSurname: string;
  secondSurname: string;
  firstName: string;
  otherNames: string;
  /** Razón social (persona jurídica). */
  legalName: string;
}

export interface LocationValue {
  address: string;
  countryCode: string;
  deptCode: string;
  muniCode: string;
}

type Errors = Partial<Record<keyof IdentityValue | keyof LocationValue, string>>;

interface IdentityProps {
  value: IdentityValue;
  onChange: (patch: Partial<IdentityValue>) => void;
  catalogs: ExoCatalogs | null;
  errors?: Errors;
  /** Texto de la etiqueta del número («NIT», «Número de documento»…). */
  numberLabel?: string;
  numberHint?: string;
  /** El número lo define otro dato (por ejemplo el NIT que reconoce las facturas): no se edita aquí. */
  numberReadOnly?: boolean;
  /** Razón social cuando la persona es jurídica; se oculta si el host la gestiona aparte. */
  hideLegalName?: boolean;
  legalNameHint?: string;
}

/** Opciones activas del catálogo más el valor ya seleccionado (aunque se haya desactivado después). */
function options<T extends { code: string; isActive: boolean }>(list: T[], selected: string): T[] {
  return list.filter((x) => x.isActive || x.code === selected);
}

/**
 * Bloque «Identificación»: tipo de persona, tipo y número de documento (+ DV del NIT) y nombres o razón social. Una
 * persona jurídica usa siempre el NIT (31); un tipo de documento que falta se deja SIN elegir (nunca se inventa el 13).
 */
export function IdentityFields({ value, onChange, catalogs, errors = {}, numberLabel = "Número de documento", numberHint, numberReadOnly, hideLegalName, legalNameHint }: IdentityProps) {
  const docTypes = useMemo(() => options(catalogs?.documentTypes ?? [], value.docTypeCode), [catalogs, value.docTypeCode]);
  const legal = value.personType === "PJ";
  const natural = value.personType === "PN";
  return (
    <div className="stack stack--sm">
      <div className="form-grid form-grid--compact">
        <Field label="Persona" required error={errors.personType}>
          {(id) => (
            <Select
              id={id}
              value={value.personType}
              invalid={!!errors.personType}
              onChange={(e) => {
                const personType = e.target.value as PersonType | "";
                // La persona jurídica siempre usa NIT; al cambiar de tipo se limpian los campos que ya no aplican.
                onChange(personType === "PJ" ? { personType, docTypeCode: DOC_NIT, firstSurname: "", secondSurname: "", firstName: "", otherNames: "" } : { personType, ...(value.docTypeCode === DOC_NIT && value.personType === "PJ" ? { docTypeCode: "" } : {}) });
              }}
            >
              <option value="">Sin definir</option>
              <option value="PN">Persona natural</option>
              <option value="PJ">Persona jurídica</option>
            </Select>
          )}
        </Field>
        <Field label="Tipo de documento" required error={errors.docTypeCode} hint={legal ? "La persona jurídica usa NIT." : !value.docTypeCode ? "Elígelo: no se supone." : undefined}>
          {(id) => (
            <Select id={id} value={value.docTypeCode} invalid={!!errors.docTypeCode} disabled={legal} onChange={(e) => onChange({ docTypeCode: e.target.value, ...(e.target.value !== DOC_NIT ? { dv: "" } : {}) })}>
              <option value="">Sin definir</option>
              {docTypes.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.code} — {t.description}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={numberLabel} required error={errors.docNumber} hint={numberHint}>
          {(id) => <Input id={id} value={value.docNumber} invalid={!!errors.docNumber} readOnly={numberReadOnly} onChange={(e) => onChange({ docNumber: e.target.value })} inputMode="text" />}
        </Field>
        {value.docTypeCode === DOC_NIT && (
          <Field label="DV" required error={errors.dv} hint="Dígito de verificación.">
            {(id) => (
              <div className="row" style={{ gap: 4 }}>
                <Input id={id} value={value.dv} invalid={!!errors.dv} maxLength={1} inputMode="numeric" style={{ width: 64 }} onChange={(e) => onChange({ dv: e.target.value.replace(/\D/g, "").slice(0, 1) })} />
                <Button size="sm" variant="ghost" iconOnly icon={<Calculator size={14} />} aria-label="Calcular el DV" title="Calcular el DV con el NIT" disabled={!value.docNumber.replace(/\D/g, "")} onClick={() => onChange({ dv: computeNitDv(value.docNumber) })} />
              </div>
            )}
          </Field>
        )}
      </div>
      {legal && !hideLegalName && (
        <div className="form-grid form-grid--compact">
          <Field label="Razón social" required error={errors.legalName} hint={legalNameHint} className="span-2">
            {(id) => <Input id={id} value={value.legalName} invalid={!!errors.legalName} onChange={(e) => onChange({ legalName: e.target.value })} />}
          </Field>
        </div>
      )}
      {natural && (
        <div className="form-grid form-grid--compact">
          <Field label="Primer apellido" required error={errors.firstSurname}>
            {(id) => <Input id={id} value={value.firstSurname} invalid={!!errors.firstSurname} onChange={(e) => onChange({ firstSurname: e.target.value })} />}
          </Field>
          <Field label="Segundo apellido">{(id) => <Input id={id} value={value.secondSurname} onChange={(e) => onChange({ secondSurname: e.target.value })} />}</Field>
          <Field label="Primer nombre" required error={errors.firstName}>
            {(id) => <Input id={id} value={value.firstName} invalid={!!errors.firstName} onChange={(e) => onChange({ firstName: e.target.value })} />}
          </Field>
          <Field label="Otros nombres">{(id) => <Input id={id} value={value.otherNames} onChange={(e) => onChange({ otherNames: e.target.value })} />}</Field>
        </div>
      )}
    </div>
  );
}

interface LocationProps {
  value: LocationValue;
  onChange: (patch: Partial<LocationValue>) => void;
  catalogs: ExoCatalogs | null;
  errors?: Errors;
}

/** Bloque «Ubicación»: dirección, país y, en Colombia, departamento y municipio con códigos que conservan sus ceros. */
export function LocationFields({ value, onChange, catalogs, errors = {} }: LocationProps) {
  const countries = useMemo(() => options(catalogs?.countries ?? [], value.countryCode), [catalogs, value.countryCode]);
  const departments = useMemo(() => options(catalogs?.departments ?? [], value.deptCode), [catalogs, value.deptCode]);
  const municipalities = useMemo(() => options((catalogs?.municipalities ?? []).filter((m) => m.deptCode === value.deptCode), value.muniCode), [catalogs, value.deptCode, value.muniCode]);
  const colombia = value.countryCode === COLOMBIA;
  return (
    <div className="form-grid form-grid--compact">
      <Field label="Dirección" required error={errors.address} className="span-2">
        {(id) => <Input id={id} value={value.address} invalid={!!errors.address} onChange={(e) => onChange({ address: e.target.value })} />}
      </Field>
      <Field label="País" required error={errors.countryCode}>
        {(id) => (
          <Select id={id} value={value.countryCode} invalid={!!errors.countryCode} onChange={(e) => onChange({ countryCode: e.target.value, ...(e.target.value !== COLOMBIA ? { deptCode: "", muniCode: "" } : {}) })}>
            <option value="">Sin definir</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {colombia && (
        <>
          <Field label="Departamento" required error={errors.deptCode}>
            {(id) => (
              <Select id={id} value={value.deptCode} invalid={!!errors.deptCode} onChange={(e) => onChange({ deptCode: e.target.value, muniCode: "" })}>
                <option value="">Sin definir</option>
                {departments.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code} — {d.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Municipio" required error={errors.muniCode} hint={value.deptCode && value.muniCode ? `Código ${value.deptCode}${value.muniCode}` : undefined}>
            {(id) => (
              <Select id={id} value={value.muniCode} invalid={!!errors.muniCode} disabled={!value.deptCode} onChange={(e) => onChange({ muniCode: e.target.value })}>
                <option value="">{value.deptCode ? "Sin definir" : "Elige el departamento"}</option>
                {municipalities.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.code} — {m.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </>
      )}
    </div>
  );
}
