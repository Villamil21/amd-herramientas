import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, Field, Input, Modal, Select, useToast } from "../../components/ui";
import { withholdingService } from "../../services/withholdingService";
import {
  BASE_MODE_LABEL,
  PERSON_TYPE_LABEL,
  RETENTION_TYPE_LABEL,
  RETENTION_TYPES,
  VAT_TYPE_LABEL,
  type BaseMode,
  type PersonType,
  type RetentionType,
  type Supplier,
  type VatType,
  type WithholdingRate,
} from "../../types/models";

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

interface RuleDraft {
  key: number;
  retentionType: RetentionType | "";
  rateId: number | "";
  baseMode: BaseMode | "";
  isDefault: boolean;
}

let nextKey = 1;
const emptyRule = (): RuleDraft => ({ key: nextKey++, retentionType: "", rateId: "", baseMode: "", isDefault: false });

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

  const rateById = useMemo(() => new Map(rates.map((r) => [r.id, r])), [rates]);

  useEffect(() => {
    if (!open) return;
    setName(supplier?.businessName ?? draft?.name ?? "");
    setPersonType(supplier?.personType ?? draft?.suggestedPersonType ?? "");
    setVatType(supplier?.vatType ?? "");
    setVatTouched(false);
    const saved = (supplier?.withholdingRules ?? []).map((r) => ({
      key: nextKey++,
      retentionType: rateById.get(r.rateId)?.retentionType ?? ("" as const),
      rateId: rateById.has(r.rateId) ? r.rateId : ("" as const),
      baseMode: r.baseMode,
      isDefault: r.isDefault,
    }));
    setRules(saved.length ? saved : [emptyRule()]);
    setError(null);
  }, [open, supplier, draft, rateById]);

  // Proveedor nuevo: el tipo IVA (para Análisis de IVA) se propone según la primera regla hasta que el usuario lo cambie.
  useEffect(() => {
    if (!isNew || vatTouched) return;
    const first = rules.find((r) => r.retentionType)?.retentionType;
    if (first) setVatType(first === "purchases" ? "purchase" : "service");
  }, [isNew, vatTouched, rules]);

  const update = (key: number, patch: Partial<RuleDraft>) => setRules((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setDefault = (key: number) => setRules((list) => list.map((r) => ({ ...r, isDefault: r.key === key ? !r.isDefault : false })));

  async function save() {
    const complete = rules.filter((r) => r.retentionType || r.rateId || r.baseMode);
    if (!personType) return setError("Selecciona si el proveedor es PJ (persona jurídica) o PN (persona natural).");
    if (complete.length === 0) return setError("Agrega al menos una regla de retención.");
    if (complete.some((r) => !r.retentionType || !r.rateId || !r.baseMode)) return setError("Cada regla debe tener tipo, subtipo y modo de base.");
    if (new Set(complete.map((r) => r.rateId)).size !== complete.length) return setError("Hay un subtipo repetido.");
    if (isNew && !name.trim()) return setError("La razón social es obligatoria.");
    if (isNew && !vatType) return setError("Selecciona el tipo IVA del proveedor.");

    const profile = {
      personType,
      rules: complete.map((r) => ({ rateId: r.rateId as number, baseMode: r.baseMode as BaseMode, isDefault: complete.length === 1 || r.isDefault })),
    };
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
  const filled = rules.filter((r) => r.rateId).length;

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
            <Field label="Tipo IVA" required hint="Se usa en Análisis de IVA de facturas.">
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
          <div className="row row--between">
            <strong>Reglas de retención</strong>
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setRules((l) => [...l, emptyRule()])}>
              Agregar regla
            </Button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Subtipo</th>
                  <th>¿Cómo se obtiene la base?</th>
                  {filled > 1 && <th>Predeterminada</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.key}>
                    <td style={{ width: 170 }}>
                      <Select aria-label="Tipo de retención" value={r.retentionType} onChange={(e) => update(r.key, { retentionType: e.target.value as RetentionType, rateId: "" })}>
                        <option value="" disabled>
                          Selecciona…
                        </option>
                        {RETENTION_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {RETENTION_TYPE_LABEL[t]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td>
                      <Select aria-label="Subtipo" value={r.rateId} disabled={!r.retentionType} onChange={(e) => update(r.key, { rateId: Number(e.target.value) })}>
                        <option value="" disabled>
                          {r.retentionType ? "Selecciona…" : "Elige primero el tipo"}
                        </option>
                        {rates
                          .filter((x) => x.retentionType === r.retentionType)
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                      </Select>
                    </td>
                    <td style={{ width: 210 }}>
                      <Select aria-label="Modo de base" value={r.baseMode} onChange={(e) => update(r.key, { baseMode: e.target.value as BaseMode })}>
                        <option value="" disabled>
                          Selecciona…
                        </option>
                        {(Object.keys(BASE_MODE_LABEL) as BaseMode[]).map((m) => (
                          <option key={m} value={m}>
                            {BASE_MODE_LABEL[m]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    {filled > 1 && (
                      <td style={{ textAlign: "center" }}>
                        <input type="checkbox" aria-label="Regla predeterminada" checked={r.isDefault} onChange={() => setDefault(r.key)} />
                      </td>
                    )}
                    <td className="actions">
                      <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} aria-label="Quitar regla" disabled={rules.length === 1} onClick={() => setRules((l) => l.filter((x) => x.key !== r.key))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: "var(--text-sm)", margin: 0 }}>
            «Base diferente / manual» no guarda un valor: en cada factura se pide la base de retención (con los productos a la vista).
            {filled > 1 && " Sin regla predeterminada, se preguntará cuál aplicar en cada factura."}
          </p>
        </div>
      </div>
    </Modal>
  );
}
