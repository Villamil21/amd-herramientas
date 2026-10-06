import { useState } from "react";
import { Button, Select, useToast } from "../../../../components/ui";
import { supplierService } from "../../../../services/supplierService";
import { VAT_TYPE_LABEL, type Supplier, type VatType } from "../../../../types/models";

interface Props {
  nit: string;
  /** Razón social de la factura (para un proveedor nuevo). */
  name: string;
  /** Proveedor ya registrado: se cambia (o se completa) su Tipo IVA. Sin él, se crea. */
  supplier?: Supplier;
  onSaved: () => Promise<void> | void;
}

/**
 * Tipo IVA de un proveedor (Compras / Servicios) en una sola línea: lo crea
 * con el NIT y la razón social de la factura, o cambia el del ya registrado.
 * Se guarda en Proveedores y aplica a todas sus facturas, también en los
 * próximos análisis. Nada se guarda sin que el usuario lo confirme.
 */
export function SupplierVatControl({ nit, name, supplier, onSaved }: Props) {
  const toast = useToast();
  const [choice, setChoice] = useState<VatType | "">(supplier?.vatType ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!choice || saving) return;
    setSaving(true);
    try {
      if (supplier) await supplierService.update(supplier.id, { nit: supplier.nit, businessName: supplier.businessName, vatType: choice });
      else await supplierService.create({ nit, businessName: name || `NIT ${nit}`, vatType: choice });
      toast(`Proveedor ${supplier?.businessName || name || nit} ${supplier ? "actualizado" : "creado"} como ${VAT_TYPE_LABEL[choice]}.`);
      await onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="row" style={{ flexWrap: "nowrap" }}>
      <Select aria-label={`Tipo IVA de ${name || nit}`} value={choice} onChange={(e) => setChoice(e.target.value as VatType)} disabled={saving} style={{ width: 150 }}>
        <option value="" disabled>
          Tipo IVA…
        </option>
        {Object.entries(VAT_TYPE_LABEL).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </Select>
      <Button size="sm" variant="primary" disabled={!choice || choice === supplier?.vatType} loading={saving} onClick={() => void save()}>
        {supplier?.vatType ? "Guardar" : "Configurar"}
      </Button>
    </span>
  );
}
