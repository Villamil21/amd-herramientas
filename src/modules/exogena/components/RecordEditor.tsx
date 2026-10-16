import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Field, FormSection, Input, Modal, Select } from "../../../components/ui";
import type { ExoCatalogs, ExoRecord, RecordData } from "../../../types/exogena";
import { RECORD_ORIGIN_LABEL } from "../../../types/exogena";
import { COLOMBIA, DOC_NIT } from "../domain/thirdParty";
import { isValidPercentage, roundPesos, splitPercentage } from "../domain/numbers";
import { CONCEPTS_1009 } from "../domain/form1009";
import { IdentityFields, LocationFields, type IdentityValue, type LocationValue } from "./ThirdPartyForm";

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Campos de un registro tal como se muestran en el formulario. */
function identityOf(d: RecordData): IdentityValue {
  return {
    personType: (d.personType as IdentityValue["personType"]) ?? "",
    docTypeCode: str(d.docTypeCode),
    docNumber: str(d.docNumber),
    dv: str(d.dv),
    firstSurname: str(d.firstSurname),
    secondSurname: str(d.secondSurname),
    firstName: str(d.firstName),
    otherNames: str(d.otherNames),
    legalName: str(d.businessName),
  };
}

function locationOf(d: RecordData): LocationValue {
  return { address: str(d.address), countryCode: str(d.countryCode), deptCode: str(d.deptCode), muniCode: str(d.muniCode) };
}

/** Número con coma decimal («50,2» o «50.20») → número; NaN si no se entiende. */
const parseDecimal = (text: string) => Number(text.replace(/\s/g, "").replace(",", "."));

interface Props {
  open: boolean;
  record: ExoRecord | null;
  format: "1010" | "1009";
  catalogs: ExoCatalogs | null;
  onClose: () => void;
  /** Guarda solo los campos que cambiaron (el backend los marca como corregidos a mano). */
  onSave: (record: ExoRecord, patch: RecordData) => Promise<void>;
  /** Vuelve a los valores de la fuente (pide confirmación al usuario antes). */
  onRestore?: (record: ExoRecord) => Promise<void>;
}

/** Edición de un registro de Exógena. Cada corrección queda marcada como manual y no se pierde al sincronizar. */
export function RecordEditor({ open, record, format, catalogs, onClose, onSave, onRestore }: Props) {
  const [identity, setIdentity] = useState<IdentityValue | null>(null);
  const [location, setLocation] = useState<LocationValue | null>(null);
  const [percentage, setPercentage] = useState("");
  const [nominal, setNominal] = useState("");
  const [concept, setConcept] = useState("");
  const [balance, setBalance] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !record) return;
    const d = record.data;
    setIdentity(identityOf(d));
    setLocation(locationOf(d));
    setPercentage(typeof d.percentage === "number" ? String(d.percentage).replace(".", ",") : "");
    setNominal(typeof d.nominalValue === "number" ? String(d.nominalValue) : "");
    setConcept(str(d.concept));
    setBalance(typeof d.balance === "number" ? String(d.balance) : "");
    setError(null);
  }, [open, record]);

  const patch = useMemo<RecordData | { error: string }>(() => {
    if (!record || !identity || !location) return {};
    const d = record.data;
    const legal = identity.personType === "PJ";
    const colombia = location.countryCode === COLOMBIA;
    const next: RecordData = {
      personType: identity.personType || null,
      docTypeCode: legal ? DOC_NIT : identity.docTypeCode,
      docNumber: identity.docNumber.replace(/[\s.]/g, "").toUpperCase(),
      dv: identity.docTypeCode === DOC_NIT || legal ? identity.dv : "",
      firstSurname: legal ? "" : identity.firstSurname.trim().toUpperCase(),
      secondSurname: legal ? "" : identity.secondSurname.trim().toUpperCase(),
      firstName: legal ? "" : identity.firstName.trim().toUpperCase(),
      otherNames: legal ? "" : identity.otherNames.trim().toUpperCase(),
      businessName: legal ? identity.legalName.trim().toUpperCase() : "",
      address: location.address.trim().toUpperCase(),
      countryCode: location.countryCode,
      deptCode: colombia ? location.deptCode : "",
      muniCode: colombia ? location.muniCode : "",
    };
    if (format === "1010") {
      const pct = parseDecimal(percentage);
      if (!isValidPercentage(pct)) return { error: "La participación debe estar entre 0 y 100 con a lo sumo dos decimales." };
      const split = splitPercentage(pct);
      next.percentage = pct;
      next.pctInteger = split.integer;
      next.pctDecimal = split.decimal;
      if (nominal.trim() !== "") {
        const value = Number(nominal.replace(/[.\s]/g, ""));
        if (!Number.isFinite(value) || value < 0) return { error: "El valor nominal debe ser un número entero de pesos." };
        next.nominalValue = roundPesos(value);
      }
    } else {
      next.concept = concept;
      const value = parseDecimal(balance.replace(/\./g, ""));
      if (!Number.isFinite(value)) return { error: "El saldo debe ser un número." };
      const pesos = roundPesos(value);
      // El saldo exacto en centavos acompaña al valor en pesos que se exporta (la conciliación usa los centavos).
      if (pesos !== d.balance) {
        next.balance = pesos;
        next.balanceCents = pesos * 100;
      }
    }
    return Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(d[k]) && !(v === "" && (d[k] === undefined || d[k] === null))));
  }, [record, identity, location, percentage, nominal, concept, balance, format]);

  if (!record || !identity || !location) return null;
  const hasError = "error" in patch;
  const changes = hasError ? 0 : Object.keys(patch).length;

  async function save() {
    if (!record) return;
    if (hasError) return setError((patch as { error: string }).error);
    setSaving(true);
    setError(null);
    try {
      await onSave(record, patch as RecordData);
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
      title={`Editar registro ${format}`}
      description={`${str(record.data.shareholderName) || str(record.data.thirdName) || record.sourceKey} · ${RECORD_ORIGIN_LABEL[record.origin]}${record.originRef ? ` · ${record.originRef}` : ""}`}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          {record.manualFields.length > 0 && onRestore && (
            <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={() => void onRestore(record)} disabled={saving} style={{ marginRight: "auto" }}>
              Volver a los valores de origen
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={changes === 0}>
            Guardar corrección
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        {record.manualFields.length > 0 && (
          <Alert tone="info" title="Campos corregidos a mano">
            {record.manualFields.join(", ")}. Una nueva sincronización no los reemplaza sin tu confirmación.
          </Alert>
        )}
        <FormSection step={1} title="Identificación" hint="Lo que corrijas aquí solo afecta este formato; la ficha de origen no cambia.">
          <IdentityFields value={identity} onChange={(p) => setIdentity((v) => ({ ...v!, ...p }))} catalogs={catalogs} numberLabel="Número de identificación" />
        </FormSection>
        <FormSection step={2} title="Ubicación">
          <LocationFields value={location} onChange={(p) => setLocation((v) => ({ ...v!, ...p }))} catalogs={catalogs} />
        </FormSection>
        <FormSection step={3} title={format === "1010" ? "Participación y valores" : "Concepto y saldo"}>
          {format === "1010" ? (
            <div className="form-grid form-grid--compact">
              <Field label="Participación (%)" hint="Hasta dos decimales. Ej.: 50,20 → columnas 50 y 20.">
                {(id) => <Input id={id} value={percentage} inputMode="decimal" onChange={(e) => setPercentage(e.target.value)} />}
              </Field>
              <Field label="Valor nominal del derecho social a 31/12 (pesos)" hint="Capital suscrito asignado a este socio.">
                {(id) => <Input id={id} value={nominal} inputMode="numeric" onChange={(e) => setNominal(e.target.value)} />}
              </Field>
              <Field label="Prima en colocación" hint="Siempre 0 en esta fase.">
                {(id) => <Input id={id} value="0" readOnly disabled />}
              </Field>
            </div>
          ) : (
            <div className="form-grid form-grid--compact">
              <Field label="Concepto" required>
                {(id) => (
                  <Select id={id} value={concept} onChange={(e) => setConcept(e.target.value)}>
                    {CONCEPTS_1009.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} — {c.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Saldo al 31/12 (pesos)" hint="Entero de pesos; se exporta sin separadores.">
                {(id) => <Input id={id} value={balance} inputMode="numeric" onChange={(e) => setBalance(e.target.value)} />}
              </Field>
            </div>
          )}
        </FormSection>
        {changes > 0 && <Badge tone="gold">{changes} {changes === 1 ? "campo cambiado" : "campos cambiados"}</Badge>}
      </div>
    </Modal>
  );
}
