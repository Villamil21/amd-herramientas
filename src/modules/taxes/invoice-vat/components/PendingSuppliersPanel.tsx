import { useState } from "react";
import { Store } from "lucide-react";
import { Button, Card, Select, useToast } from "../../../../components/ui";
import { supplierService } from "../../../../services/supplierService";
import { VAT_TYPE_LABEL, type VatType } from "../../../../types/models";
import type { PendingSupplier } from "../types";

/**
 * Proveedores de la carpeta que no están registrados: uno por NIT. El NIT
 * y la razón social vienen de la factura; el usuario solo elige el tipo
 * IVA. Nada se guarda sin su confirmación.
 */
export function PendingSuppliersPanel({ pending, onCreated }: { pending: PendingSupplier[]; onCreated: () => void }) {
  const toast = useToast();
  const [choice, setChoice] = useState<Record<string, VatType | "">>({});
  const [saving, setSaving] = useState<string | null>(null);

  async function create(p: PendingSupplier) {
    const vatType = choice[p.nit];
    if (!vatType) return;
    setSaving(p.nit);
    try {
      await supplierService.create({ nit: p.nit, businessName: p.name || `NIT ${p.nit}`, vatType });
      toast(`Proveedor ${p.name || p.nit} creado como ${VAT_TYPE_LABEL[vatType]}.`);
      onCreated();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(null);
    }
  }

  const n = pending.length;
  return (
    <Card
      flush
      title={n === 1 ? "1 proveedor requiere clasificación" : `${n} proveedores requieren clasificación`}
      description="Elige el tipo IVA de cada proveedor nuevo. Se guarda en Proveedores y se aplica a todas sus facturas, también en los próximos análisis."
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Proveedor</th>
              <th>NIT</th>
              <th className="num">Facturas</th>
              <th>Tipo IVA</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pending.map((p) => (
              <tr key={p.nit}>
                <td className="table__primary">
                  <span className="row">
                    <Store size={14} className="muted" aria-hidden />
                    {p.name || <span className="muted">Sin razón social en la factura</span>}
                  </span>
                </td>
                <td className="selectable">{p.nit}</td>
                <td className="num">{p.invoiceCount}</td>
                <td style={{ width: 180 }}>
                  <Select aria-label={`Tipo IVA de ${p.name || p.nit}`} value={choice[p.nit] ?? ""} onChange={(e) => setChoice((c) => ({ ...c, [p.nit]: e.target.value as VatType }))}>
                    <option value="" disabled>
                      Selecciona…
                    </option>
                    {Object.entries(VAT_TYPE_LABEL).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="actions">
                  <Button size="sm" variant="primary" disabled={!choice[p.nit] || (saving !== null && saving !== p.nit)} loading={saving === p.nit} onClick={() => void create(p)}>
                    Crear proveedor
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
