import { useEffect, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { Alert, Badge, Button, Field, FormSection, Input, Modal, Select, useToast } from "../../components/ui";
import { IdentityFields, LocationFields, type IdentityValue, type LocationValue } from "../../modules/exogena/components/ThirdPartyForm";
import { useCatalogs } from "../../modules/exogena/hooks";
import { COLOMBIA, DOC_NIT, documentNumber, missingFields, personName, thirdPartyOf } from "../../modules/exogena/domain/thirdParty";
import { pucService } from "../../services/pucService";
import { supplierService } from "../../services/supplierService";
import { errorMessage } from "../../services/tauri";
import { withholdingService } from "../../services/withholdingService";
import { PERSON_TYPE_LABEL, VAT_TYPE_LABEL, type Supplier, type SupplierTaxInput, type VatType, type WithholdingRate } from "../../types/models";
import { formatDateForDisplay } from "../../utils/dates";
import { formatDateTimeForDisplay } from "../../utils/dates";
import { completeRules, rulesFromSupplier, WithholdingRulesEditor, type RuleDraft } from "./WithholdingRulesEditor";

interface Props {
  open: boolean;
  supplier: Supplier | null;
  /**
   * Proveedor nuevo con los datos leídos de una factura: el NIT queda fijo (es
   * el que la reconoce) y la razón social se puede corregir. Si el NIT ya está
   * registrado no se crea otro: se usa el existente.
   */
  draft?: { nit: string; businessName: string; /** Datos tributarios leídos de la factura (para revisar antes de guardar). */ tax?: Partial<IdentityValue & LocationValue>; origin?: SupplierTaxInput["dataOrigin"] };
  /** Subtipos de retención (Tabla de retenciones). */
  rates?: WithholdingRate[];
  onClose: () => void;
  onSaved: () => void;
}

/** NIT solo con dígitos y sin dígito de verificación: "900.319.753-1" → "900319753". */
export function normalizeNit(value: string): string {
  return (value.split("-")[0] ?? "").replace(/\D/g, "");
}

/** Responsabilidades fiscales que la aplicación reconoce en las facturas. */
export const FISCAL_CODES: { code: string; label: string; ignoresWithholding?: boolean }[] = [
  { code: "O-13", label: "Gran contribuyente" },
  { code: "O-15", label: "Autorretenedor", ignoresWithholding: true },
  { code: "O-23", label: "Agente de retención IVA" },
  { code: "O-47", label: "Régimen simple", ignoresWithholding: true },
  { code: "R-99-PN", label: "No aplica / otros" },
];

/** «O-13;O-15» → ["O-13", "O-15"] (sin distinguir separadores ni mayúsculas). */
export const regimeCodes = (regime: string) =>
  regime
    .toUpperCase()
    .split(/[;,\s]+/)
    .map((c) => c.trim())
    .filter(Boolean);

function toggleCode(regime: string, code: string): string {
  const codes = regimeCodes(regime);
  return (codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code]).join("; ");
}

const EMPTY_IDENTITY: IdentityValue = { personType: "", docTypeCode: "", docNumber: "", dv: "", firstSurname: "", secondSurname: "", firstName: "", otherNames: "", legalName: "" };
const EMPTY_LOCATION: LocationValue = { address: "", countryCode: "", deptCode: "", muniCode: "" };

/** Solo los campos de ubicación de unos datos tributarios parciales. */
const pickLocation = (tax?: Partial<IdentityValue & LocationValue>): Partial<LocationValue> => (tax ? { address: tax.address ?? "", countryCode: tax.countryCode ?? "", deptCode: tax.deptCode ?? "", muniCode: tax.muniCode ?? "" } : {});

/**
 * Proveedor completo. Nuevo: NIT, razón social y Tipo IVA. Existente:
 * Identificación, IVA, Clasificación fiscal, Retención e Historial de
 * decisiones, con un solo «Guardar» (nada se resetea: se guarda lo que cambió).
 */
export function SupplierFormModal({ open, supplier, draft, rates = [], onClose, onSaved }: Props) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [vatType, setVatType] = useState<VatType | "">("");
  const { catalogs } = useCatalogs();
  const [identity, setIdentity] = useState<IdentityValue>(EMPTY_IDENTITY);
  const [location, setLocation] = useState<LocationValue>(EMPTY_LOCATION);
  const [regime, setRegime] = useState("");
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [errors, setErrors] = useState<{ nit?: string; name?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(supplier?.businessName ?? draft?.businessName ?? "");
    setVatType(supplier?.vatType ?? "");
    const t = thirdPartyOf(supplier ?? {});
    setIdentity({
      ...EMPTY_IDENTITY,
      personType: t.personType ?? "",
      docTypeCode: t.docTypeCode ?? "",
      docNumber: supplier?.nit ?? draft?.nit ?? "",
      dv: t.dv,
      firstSurname: t.firstSurname,
      secondSurname: t.secondSurname,
      firstName: t.firstName,
      otherNames: t.otherNames,
      ...(supplier ? {} : draft?.tax),
    });
    setLocation({ address: t.address, countryCode: t.countryCode, deptCode: t.deptCode, muniCode: t.muniCode, ...(supplier ? {} : pickLocation(draft?.tax)) });
    setRegime(supplier?.fiscalRegime ?? "");
    setRules(rulesFromSupplier(supplier, rates));
    setErrors({});
    setError(null);
    // Solo al abrir: después manda lo que escribe el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier]);

  /** Datos tributarios tal como se guardan: el tipo de documento solo se define si el usuario (o la factura) lo trae. */
  function taxInput(): SupplierTaxInput {
    const legal = identity.personType === "PJ";
    return {
      data: {
        docTypeCode: legal ? DOC_NIT : identity.docTypeCode || null,
        dv: identity.docTypeCode === DOC_NIT || legal ? identity.dv : "",
        personType: identity.personType || null,
        firstSurname: legal ? "" : identity.firstSurname,
        secondSurname: legal ? "" : identity.secondSurname,
        firstName: legal ? "" : identity.firstName,
        otherNames: legal ? "" : identity.otherNames,
        address: location.address,
        countryCode: location.countryCode,
        deptCode: location.countryCode === COLOMBIA ? location.deptCode : "",
        muniCode: location.countryCode === COLOMBIA ? location.muniCode : "",
      },
      dataOrigin: draft?.origin ?? "manual",
    };
  }

  async function save() {
    const errs: typeof errors = {};
    const docType = identity.personType === "PJ" ? DOC_NIT : identity.docTypeCode || null;
    const cleanNit = docType && documentNumber(identity.docNumber, docType) ? documentNumber(identity.docNumber, docType) : normalizeNit(identity.docNumber);
    // Una persona natural sin razón social toma su nombre completo de los apellidos y nombres.
    const displayName = name.trim() || (identity.personType === "PN" ? personName(identity) : "");
    if (!cleanNit) errs.nit = "Escribe el NIT o documento (solo números, sin dígito de verificación).";
    if (!displayName) errs.name = "La razón social o el nombre es obligatorio.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const checked = completeRules(rules);
    if (supplier && checked.error) return setError(checked.error);

    setSaving(true);
    setError(null);
    // NIT y razón social bastan: el Tipo IVA y los datos de Exógena pueden quedar sin configurar, nunca se inventan.
    const input = { nit: cleanNit, businessName: displayName, vatType: vatType || null };
    try {
      if (supplier) {
        await supplierService.saveWithTax(supplier.id, input, taxInput());
        if (regime.trim() !== (supplier.fiscalRegime ?? "")) await withholdingService.setFiscalRegime(supplier.id, regime.trim());
        const before = JSON.stringify({ p: supplier.personType ?? null, r: completeRules(rulesFromSupplier(supplier, rates)).rules });
        const after = JSON.stringify({ p: identity.personType || null, r: checked.rules });
        if (before !== after) await withholdingService.saveSupplierProfile(supplier.id, { personType: identity.personType || null, rules: checked.rules });
        toast("Proveedor actualizado.");
      } else {
        const existing = draft ? (await supplierService.list(cleanNit)).find((s) => s.nit === cleanNit) : undefined;
        if (!existing) await supplierService.saveWithTax(null, input, taxInput());
        toast(existing ? `El NIT ${cleanNit} ya estaba registrado: se usa el proveedor existente.` : "Proveedor creado.");
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const codes = regimeCodes(regime);
  const ignored = FISCAL_CODES.filter((c) => c.ignoresWithholding && codes.includes(c.code));

  return (
    <Modal
      open={open}
      size="xl"
      title={supplier ? "Editar proveedor" : "Nuevo proveedor"}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            {supplier ? "Guardar cambios" : "Crear proveedor"}
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
        <div className="supplier-form">
          <FormSection step={1} title="Identificación" className="span-full" hint="El NIT o documento reconoce las facturas del proveedor; los datos de persona y documento alimentan Información Exógena.">
            <div className="form-grid form-grid--compact form-grid--3">
              <Field label="Razón social o nombre" required error={errors.name} className="span-2">
                {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} placeholder="PRICESMART COLOMBIA S.A.S." autoFocus={!!draft} />}
              </Field>
              <Field label="Tipo IVA" hint="Opcional. IVA de compras lo pide cuando lo necesita.">
                {(id) => (
                  <Select id={id} value={vatType} onChange={(e) => setVatType(e.target.value as VatType | "")}>
                    <option value="">Sin configurar</option>
                    {Object.entries(VAT_TYPE_LABEL).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <IdentityFields
              value={identity}
              onChange={(p) => setIdentity((v) => ({ ...v, ...p }))}
              catalogs={catalogs}
              errors={{ docNumber: errors.nit }}
              numberLabel="NIT o documento"
              numberHint="Sin puntos ni DV. Reconoce las facturas."
              numberReadOnly={!!draft}
              hideLegalName
            />
          </FormSection>

          <FormSection step={2} title="Ubicación" className="span-full">
            <LocationFields value={location} onChange={(p) => setLocation((v) => ({ ...v, ...p }))} catalogs={catalogs} />
            <ExogenaStatus {...exogenaStatus(identity, location, name)} verifiedAt={supplier?.dataVerifiedAt} origin={supplier?.dataOrigin} />
          </FormSection>

          {supplier && (
            <>
              <FormSection step={3} title="Datos fiscales" className="span-full">
                <div className="form-grid form-grid--compact">
                  <Field label="Régimen / responsabilidades fiscales" hint="Como aparece en la factura. Usa los botones o escribe otros códigos.">
                    {(id) => <Input id={id} value={regime} onChange={(e) => setRegime(e.target.value)} placeholder="Sin verificar" />}
                  </Field>
                </div>
                <div className="fiscal-chips" role="group" aria-label="Responsabilidades fiscales">
                  {FISCAL_CODES.map((c) => (
                    <button key={c.code} type="button" className={`fiscal-chip ${codes.includes(c.code) ? "is-on" : ""}`} aria-pressed={codes.includes(c.code)} onClick={() => setRegime((r) => toggleCode(r, c.code))}>
                      <strong>{c.code}</strong> {c.label}
                    </button>
                  ))}
                </div>
                {ignored.length > 0 && <Alert tone="info">{ignored.map((c) => `${c.code} ${c.label.toLowerCase()}`).join(" y ")}: Retención en la fuente compras ignora a este proveedor (no se le practica retención).</Alert>}
              </FormSection>

              <FormSection step={4} title="Retención" className="span-full" hint="Se reutiliza en cada factura del proveedor en Retención en la fuente compras.">
                <WithholdingRulesEditor rules={rules} onChange={setRules} rates={rates} />
              </FormSection>

              <FormSection step={5} title="Códigos PUC utilizados" className="span-full" hint="Solo sugieren la clasificación de compras futuras; ninguna compra se clasifica sin tu confirmación.">
                <PucCodesSection supplierId={supplier.id} />
              </FormSection>

              <FormSection step={6} title="Historial de decisiones" className="span-full">
                <DecisionHistory supplier={supplier} rates={rates} />
              </FormSection>
            </>
          )}
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Qué falta para Información Exógena con lo que hay hoy en el formulario. */
function exogenaStatus(identity: IdentityValue, location: LocationValue, name: string): { missing: string[] } {
  const t = {
    docTypeCode: identity.personType === "PJ" ? DOC_NIT : identity.docTypeCode || null,
    dv: identity.dv,
    personType: identity.personType || null,
    firstSurname: identity.firstSurname,
    secondSurname: identity.secondSurname,
    firstName: identity.firstName,
    otherNames: identity.otherNames,
    address: location.address,
    countryCode: location.countryCode,
    countryName: "",
    deptCode: location.deptCode,
    deptName: "",
    muniCode: location.muniCode,
    muniName: "",
  };
  const number = documentNumber(identity.docNumber, t.docTypeCode) || identity.docNumber.replace(/\D/g, "");
  return { missing: missingFields(t, number, name) };
}

function ExogenaStatus({ missing, verifiedAt, origin }: { missing: string[]; verifiedAt?: string | null; origin?: string }) {
  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <strong>Datos para Exógena</strong>
      {missing.length === 0 ? <Badge tone="success">Completo</Badge> : <Badge tone="warning">Requiere datos</Badge>}
      {missing.length > 0 && <span className="muted">Falta: {missing.join(", ")}.</span>}
      {verifiedAt && (
        <span className="muted">
          Verificado {formatDateTimeForDisplay(verifiedAt)}
          {origin ? ` · origen: ${origin}` : ""}
        </span>
      )}
    </div>
  );
}

/** Decisiones que la aplicación reutiliza para el proveedor, agrupadas por el módulo que las usa. */
function DecisionHistory({ supplier: s, rates }: { supplier: Supplier; rates: WithholdingRate[] }) {
  const rules = s.withholdingRules ?? [];
  const [codes, setCodes] = useState<string[] | null>(null);
  useEffect(() => {
    void pucService.listSupplierCodes(s.id).then(setCodes, () => setCodes([]));
  }, [s.id]);
  const groups: { module: string; items: string[] }[] = [
    { module: "IVA de compras", items: [s.vatType ? `Tipo IVA «${VAT_TYPE_LABEL[s.vatType]}»: clasifica sus facturas sin volver a preguntar.` : "Tipo IVA sin configurar: se pedirá en la próxima factura."] },
    {
      module: "Retención en la fuente compras",
      items: [
        s.personType ? `Clasificado como ${PERSON_TYPE_LABEL[s.personType].toLowerCase()} (${s.personType}) en el resumen de la declaración.` : "Sin PJ / PN: se pedirá en la próxima factura.",
        s.fiscalRegime ? `Régimen «${s.fiscalRegime}» verificado${s.fiscalCheckedAt ? ` el ${formatDateForDisplay(s.fiscalCheckedAt.slice(0, 10))}` : ""}; si una factura trae otro, se pregunta antes de actualizarlo.` : "Régimen aún no verificado en una factura.",
        rules.length === 0
          ? "Sin reglas de retención: se preguntan en la próxima factura."
          : `${rules.length === 1 ? "Regla reutilizada" : "Reglas reutilizadas"}: ${rules
              .map((r) => `${rates.find((x) => x.id === r.rateId)?.name ?? "subtipo eliminado"}${r.isDefault && rules.length > 1 ? " (predeterminada)" : ""}`)
              .join(", ")}.`,
      ],
    },
    {
      module: "Clasificación contable de compras",
      items: [codes === null ? "Cargando…" : codes.length === 0 ? "Sin códigos PUC sugeridos todavía." : `Sugiere ${codes.length === 1 ? "el código" : "los códigos"} ${codes.join(", ")} (siempre con tu confirmación).`],
    },
  ];
  return (
    <div className="decision-groups">
      {groups.map((g) => (
        <div key={g.module} className="decision-group">
          <strong>{g.module}</strong>
          <ul className="decision-list">
            {g.items.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * «Códigos PUC utilizados»: asociaciones que solo SUGIEREN la clasificación de
 * compras futuras (nunca clasifican sin confirmación). Ver, cambiar y quitar.
 */
function PucCodesSection({ supplierId }: { supplierId: number }) {
  const toast = useToast();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [concepts, setConcepts] = useState<Map<string, string>>(new Map());
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([pucService.listSupplierCodes(supplierId), pucService.listCodes()]).then(
      ([list, all]) => {
        if (!alive) return;
        setCodes(list);
        setConcepts(new Map(all.map((c) => [c.code, c.concept])));
      },
      (e) => toast(errorMessage(e), "error"),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  async function run(action: () => Promise<string[]>, message: string) {
    try {
      setCodes(await action());
      setEditing(null);
      toast(message);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <div className="stack stack--sm">
      {codes === null ? (
        <span className="muted">Cargando…</span>
      ) : codes.length === 0 ? (
        <span className="muted">Aún no hay códigos asociados.</span>
      ) : (
        <table className="table">
          <tbody>
            {codes.map((code) => (
              <tr key={code}>
                <td className="mono" style={{ width: 110 }}>
                  {editing?.from === code ? <Input aria-label="Código PUC nuevo" value={editing.to} onChange={(e) => setEditing({ from: code, to: e.target.value.replace(/\D/g, "") })} inputMode="numeric" autoFocus /> : code}
                </td>
                <td>{concepts.get(editing?.from === code ? editing.to : code) ?? <span className="muted">Código no encontrado</span>}</td>
                <td className="actions">
                  {editing?.from === code ? (
                    <>
                      <Button size="sm" variant="ghost" iconOnly icon={<Check size={14} />} aria-label="Guardar código" disabled={!editing.to} onClick={() => void run(() => pucService.replaceSupplierCode(supplierId, code, editing.to), "Código actualizado.")} />
                      <Button size="sm" variant="ghost" iconOnly icon={<X size={14} />} aria-label="Cancelar" onClick={() => setEditing(null)} />
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" iconOnly icon={<Pencil size={14} />} aria-label={`Cambiar ${code}`} onClick={() => setEditing({ from: code, to: code })} />
                      <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} aria-label={`Quitar ${code}`} onClick={() => void run(() => pucService.deleteSupplierCode(supplierId, code), `Asociación con ${code} eliminada.`)} />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
