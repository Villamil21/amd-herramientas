import { useEffect, useState } from "react";
import { Check, HandCoins, Pencil, Save, Trash2, X } from "lucide-react";
import { Alert, Badge, Button, Field, Input, Modal, Select, useToast } from "../../components/ui";
import { pucService } from "../../services/pucService";
import { supplierService } from "../../services/supplierService";
import { errorMessage } from "../../services/tauri";
import { withholdingService } from "../../services/withholdingService";
import { BASE_MODE_LABEL, PERSON_TYPE_LABEL, RETENTION_TYPE_LABEL, VAT_TYPE_LABEL, type Supplier, type VatType, type WithholdingRate } from "../../types/models";

interface Props {
  open: boolean;
  supplier: Supplier | null;
  /**
   * Proveedor nuevo con los datos leídos de una factura: el NIT queda fijo (es
   * el que la reconoce) y la razón social se puede corregir. Si el NIT ya está
   * registrado no se crea otro: se usa el existente.
   */
  draft?: { nit: string; businessName: string };
  /** Subtipos de retención (para mostrar las reglas del proveedor). */
  rates?: WithholdingRate[];
  /** Abre PJ / PN y reglas de retención del proveedor. */
  onEditWithholding?: (supplier: Supplier) => void;
  onClose: () => void;
  onSaved: () => void;
}

/** NIT solo con dígitos y sin dígito de verificación: "900.319.753-1" → "900319753". */
export function normalizeNit(value: string): string {
  return (value.split("-")[0] ?? "").replace(/\D/g, "");
}

export function SupplierFormModal({ open, supplier, draft, rates = [], onEditWithholding, onClose, onSaved }: Props) {
  const toast = useToast();
  const [nit, setNit] = useState("");
  const [name, setName] = useState("");
  const [vatType, setVatType] = useState<VatType | "">("");
  const [errors, setErrors] = useState<{ nit?: string; name?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNit(supplier?.nit ?? draft?.nit ?? "");
    setName(supplier?.businessName ?? draft?.businessName ?? "");
    setVatType(supplier?.vatType ?? "");
    setErrors({});
    setError(null);
    // Solo al abrir: después manda lo que escribe el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier]);

  async function save() {
    const errs: typeof errors = {};
    const cleanNit = normalizeNit(nit);
    if (!cleanNit) errs.nit = "Escribe el NIT (solo números, sin dígito de verificación).";
    if (!name.trim()) errs.name = "La razón social es obligatoria.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    setError(null);
    // NIT y razón social bastan: el Tipo IVA puede quedar sin configurar, nunca se inventa.
    const input = { nit: cleanNit, businessName: name.trim(), vatType: vatType || null };
    try {
      const existing = draft && !supplier ? (await supplierService.list(cleanNit)).find((s) => s.nit === cleanNit) : undefined;
      if (supplier) await supplierService.update(supplier.id, input);
      else if (!existing) await supplierService.create(input);
      toast(supplier ? "Proveedor actualizado." : existing ? `El NIT ${cleanNit} ya estaba registrado: se usa el proveedor existente.` : "Proveedor creado.");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      size={supplier ? "lg" : undefined}
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
        <div className="form-grid">
          <Field label="NIT" required hint="Sin dígito de verificación. Es la clave para reconocer las facturas." error={errors.nit}>
            {(id) => <Input id={id} value={nit} onChange={(e) => setNit(e.target.value)} invalid={!!errors.nit} placeholder="900319753" inputMode="numeric" autoFocus={!draft} readOnly={!!draft} />}
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
        <Field label="Razón social" required error={errors.name}>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} placeholder="PRICESMART COLOMBIA S.A.S." autoFocus={!!draft} />}
        </Field>
        <button type="submit" hidden />
      </form>
      {supplier && open && (
        <>
          <FiscalSection supplier={supplier} rates={rates} onEditWithholding={onEditWithholding} onChanged={onSaved} />
          <PucCodesSection supplierId={supplier.id} />
        </>
      )}
    </Modal>
  );
}

/** Información fiscal que ya usa la aplicación (Retención en la fuente): PJ / PN, régimen y reglas de retención. */
function FiscalSection({ supplier: s, rates, onEditWithholding, onChanged }: { supplier: Supplier; rates: WithholdingRate[]; onEditWithholding?: (s: Supplier) => void; onChanged: () => void }) {
  const toast = useToast();
  const [regime, setRegime] = useState(s.fiscalRegime ?? "");
  const [saving, setSaving] = useState(false);
  const rules = s.withholdingRules ?? [];
  async function saveRegime() {
    setSaving(true);
    try {
      await withholdingService.setFiscalRegime(s.id, regime.trim());
      toast("Régimen guardado.");
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="supplier-section">
      <div className="row row--between">
        <strong>Información fiscal</strong>
        {onEditWithholding && (
          <Button size="sm" icon={<HandCoins size={14} />} onClick={() => onEditWithholding(s)}>
            Editar PJ / PN y retenciones
          </Button>
        )}
      </div>
      <div className="summary-grid">
        <div className="summary-item">
          <span className="summary-item__label">Persona</span>
          <span className="summary-item__value">{s.personType ? PERSON_TYPE_LABEL[s.personType] : "Sin configurar"}</span>
        </div>
        <div className="summary-item">
          <span className="summary-item__label">Verificado en factura</span>
          <span className="summary-item__value">{s.fiscalCheckedAt ? s.fiscalCheckedAt.slice(0, 10).split("-").reverse().join("/") : "—"}</span>
        </div>
      </div>
      <Field label="Régimen / responsabilidades fiscales" hint="Como aparece en la factura (ej. O-13, O-15 autorretenedor, O-47 régimen simple, R-99-PN).">
        {(id) => (
          <span className="row" style={{ flexWrap: "nowrap" }}>
            <Input id={id} value={regime} onChange={(e) => setRegime(e.target.value)} placeholder="Sin verificar" />
            <Button size="sm" icon={<Save size={14} />} loading={saving} disabled={regime.trim() === (s.fiscalRegime ?? "")} onClick={() => void saveRegime()}>
              Guardar
            </Button>
          </span>
        )}
      </Field>
      <div>
        <div className="field__label">Retenciones configuradas</div>
        {rules.length === 0 ? (
          <span className="muted">Sin configurar</span>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Subtipo</th>
                <th>Base usada</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const rate = rates.find((x) => x.id === r.rateId);
                return (
                  <tr key={r.id}>
                    <td>{rate ? RETENTION_TYPE_LABEL[rate.retentionType] : "—"}</td>
                    <td>{rate?.name ?? "Subtipo eliminado"}</td>
                    <td>{BASE_MODE_LABEL[r.baseMode]}</td>
                    <td>{r.isDefault && rules.length > 1 && <Badge>Predeterminada</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
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
    <div className="supplier-section">
      <strong>Códigos PUC utilizados</strong>
      <span className="field__hint">Solo sugieren la clasificación de compras futuras; ninguna compra se clasifica sin tu confirmación.</span>
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
