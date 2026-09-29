import { useEffect, useState } from "react";
import { Alert, Button, Field, Input, Modal, Select, useToast } from "../../components/ui";
import { supplierService } from "../../services/supplierService";
import { VAT_TYPE_LABEL, type Supplier, type VatType } from "../../types/models";

interface Props {
  open: boolean;
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}

/** NIT solo con dígitos y sin dígito de verificación: "900.319.753-1" → "900319753". */
export function normalizeNit(value: string): string {
  return (value.split("-")[0] ?? "").replace(/\D/g, "");
}

export function SupplierFormModal({ open, supplier, onClose, onSaved }: Props) {
  const toast = useToast();
  const [nit, setNit] = useState("");
  const [name, setName] = useState("");
  const [vatType, setVatType] = useState<VatType | "">("");
  const [errors, setErrors] = useState<{ nit?: string; name?: string; vatType?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNit(supplier?.nit ?? "");
    setName(supplier?.businessName ?? "");
    setVatType(supplier?.vatType ?? "");
    setErrors({});
    setError(null);
  }, [open, supplier]);

  async function save() {
    const errs: typeof errors = {};
    const cleanNit = normalizeNit(nit);
    if (!cleanNit) errs.nit = "Escribe el NIT (solo números, sin dígito de verificación).";
    if (!name.trim()) errs.name = "La razón social es obligatoria.";
    if (!vatType) errs.vatType = "Selecciona Compras o Servicios.";
    setErrors(errs);
    if (Object.keys(errs).length || !vatType) return;

    setSaving(true);
    setError(null);
    const input = { nit: cleanNit, businessName: name.trim(), vatType };
    try {
      if (supplier) await supplierService.update(supplier.id, input);
      else await supplierService.create(input);
      toast(supplier ? "Proveedor actualizado." : "Proveedor creado.");
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
            {(id) => <Input id={id} value={nit} onChange={(e) => setNit(e.target.value)} invalid={!!errors.nit} placeholder="900319753" inputMode="numeric" autoFocus />}
          </Field>
          <Field label="Tipo IVA" required error={errors.vatType}>
            {(id) => (
              <Select id={id} value={vatType} onChange={(e) => setVatType(e.target.value as VatType)} invalid={!!errors.vatType}>
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
        </div>
        <Field label="Razón social" required error={errors.name}>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} placeholder="PRICESMART COLOMBIA S.A.S." />}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
