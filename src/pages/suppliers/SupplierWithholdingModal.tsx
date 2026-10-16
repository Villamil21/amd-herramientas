import { useEffect, useState } from "react";
import { Alert, Button, Field, Input, Modal, Select, useToast } from "../../components/ui";
import { withholdingService } from "../../services/withholdingService";
import { PERSON_TYPE_LABEL, VAT_TYPE_LABEL, type PersonType, type Supplier, type VatType, type WithholdingRate } from "../../types/models";
import { completeRules, rulesFromSupplier, WithholdingRulesEditor, type RuleDraft } from "./WithholdingRulesEditor";

/** Datos leídos del PDF para crear un proveedor nuevo desde Retención en la fuente. */
export interface SupplierDraft {
  nit: string;
  name: string;
  taxpayerType?: string;
  fiscalRegime?: string;
  fiscalText?: string;
  suggestedPersonType?: PersonType;
}

interface Props {
  open: boolean;
  /** Proveedor registrado a completar o editar. */
  supplier?: Supplier | null;
  /** Proveedor nuevo (datos de la factura). */
  draft?: SupplierDraft | null;
  rates: WithholdingRate[];
  onClose: () => void;
  onSaved: () => void;
}


/**
 * PJ / PN y reglas de retención (tipo → subtipo → modo de base) de un
 * proveedor. Un proveedor puede tener varias reglas; si tiene más de una se
 * puede marcar la predeterminada (si no hay, se pregunta en cada factura).
 */
export function SupplierWithholdingModal({ open, supplier, draft, rates, onClose, onSaved }: Props) {
  const toast = useToast();
  const isNew = !supplier;
  const [name, setName] = useState("");
  const [personType, setPersonType] = useState<PersonType | "">("");
  const [vatType, setVatType] = useState<VatType | "">("");
  const [vatTouched, setVatTouched] = useState(false);
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);


  useEffect(() => {
    if (!open) return;
    setName(supplier?.businessName ?? draft?.name ?? "");
    setPersonType(supplier?.personType ?? draft?.suggestedPersonType ?? "");
    setVatType(supplier?.vatType ?? "");
    setVatTouched(false);
    setRules(rulesFromSupplier(supplier, rates));
    setError(null);
  }, [open, supplier, draft, rates]);

  // Proveedor nuevo: el tipo IVA (para Análisis de IVA) se propone según la primera regla hasta que el usuario lo cambie.
  useEffect(() => {
    if (!isNew || vatTouched) return;
    const first = rules.find((r) => r.retentionType)?.retentionType;
    if (first) setVatType(first === "purchases" ? "purchase" : "service");
  }, [isNew, vatTouched, rules]);


  async function save() {
    const checked = completeRules(rules);
    if (!personType) return setError("Selecciona si el proveedor es PJ (persona jurídica) o PN (persona natural).");
    if (checked.error) return setError(checked.error);
    if (checked.rules.length === 0) return setError("Agrega al menos una regla de retención.");
    if (isNew && !name.trim()) return setError("La razón social es obligatoria.");
    if (isNew && !vatType) return setError("Selecciona el tipo IVA del proveedor.");

    const profile = { personType, rules: checked.rules };
    setSaving(true);
    setError(null);
    try {
      if (supplier) await withholdingService.saveSupplierProfile(supplier.id, profile);
      else await withholdingService.createSupplier({ nit: draft!.nit, businessName: name.trim(), vatType: vatType as VatType }, profile, draft?.fiscalRegime ?? null);
      toast(supplier ? "Configuración de retención guardada." : "Proveedor creado con su configuración de retención.");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const nit = supplier?.nit ?? draft?.nit ?? "";

  return (
    <Modal
      open={open}
      size="lg"
      title={isNew ? "Nuevo proveedor — retención en la fuente" : "Retención en la fuente del proveedor"}
      description={isNew ? "El NIT, la razón social y el régimen vienen de la factura. Completa PJ / PN y las reglas de retención." : undefined}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            {isNew ? "Crear proveedor" : "Guardar"}
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="summary-grid">
          <div className="summary-item">
            <span className="summary-item__label">NIT</span>
            <span className="summary-item__value selectable">{nit}</span>
          </div>
          {!isNew && (
            <div className="summary-item" style={{ gridColumn: "span 2" }}>
              <span className="summary-item__label">Razón social</span>
              <span className="summary-item__value">{supplier?.businessName}</span>
            </div>
          )}
          <div className="summary-item">
            <span className="summary-item__label">Tipo contribuyente (factura)</span>
            <span className="summary-item__value">{draft?.taxpayerType ?? "—"}</span>
          </div>
          <div className="summary-item">
            <span className="summary-item__label">Régimen / responsabilidad</span>
            <span className="summary-item__value selectable">{draft?.fiscalRegime || supplier?.fiscalRegime || "—"}</span>
          </div>
        </div>

        <div className="form-grid">
          {isNew && (
            <Field label="Razón social" required>
              {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
          )}
          <Field label="Tipo de persona" required hint={draft?.suggestedPersonType ? `Sugerido por la factura: ${draft.taxpayerType}.` : undefined}>
            {(id) => (
              <Select id={id} value={personType} onChange={(e) => setPersonType(e.target.value as PersonType)}>
                <option value="" disabled>
                  Selecciona…
                </option>
                {(Object.keys(PERSON_TYPE_LABEL) as PersonType[]).map((p) => (
                  <option key={p} value={p}>
                    {p} — {PERSON_TYPE_LABEL[p]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {isNew && (
            <Field label="Tipo IVA" required hint="Se usa en Impuestos → IVA.">
              {(id) => (
                <Select
                  id={id}
                  value={vatType}
                  onChange={(e) => {
                    setVatType(e.target.value as VatType);
                    setVatTouched(true);
                  }}
                >
                  <option value="" disabled>
                    Selecciona…
                  </option>
                  {Object.entries(VAT_TYPE_LABEL).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>

        <div className="stack stack--sm">
          <strong>Reglas de retención</strong>
          <WithholdingRulesEditor rules={rules} onChange={setRules} rates={rates} />
        </div>
      </div>
    </Modal>
  );
}
