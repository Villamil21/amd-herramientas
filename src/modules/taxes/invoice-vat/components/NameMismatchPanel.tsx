import { useState } from "react";
import { Alert, Button, useToast } from "../../../../components/ui";
import { supplierService } from "../../../../services/supplierService";
import type { NameMismatch } from "../types";

/** NIT registrado con otra razón social: mantener la actual o actualizarla (el tipo IVA se conserva). */
export function NameMismatchPanel({ mismatches, onKeep, onUpdated }: { mismatches: NameMismatch[]; onKeep: (m: NameMismatch) => void; onUpdated: () => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState<string | null>(null);

  async function update(m: NameMismatch) {
    const key = `${m.nit}|${m.invoiceName}`;
    setSaving(key);
    try {
      await supplierService.update(m.supplierId, { nit: m.nit, businessName: m.invoiceName, vatType: m.vatType });
      toast("Razón social actualizada.");
      onUpdated();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Alert tone="info" title="Razón social diferente a la registrada">
      <div className="stack stack--sm" style={{ marginTop: 6 }}>
        {mismatches.map((m) => {
          const key = `${m.nit}|${m.invoiceName}`;
          return (
            <div key={key} className="row row--between">
              <span>
                El NIT <strong className="selectable">{m.nit}</strong> ya existe como <strong>{m.storedName}</strong>. {m.invoiceCount === 1 ? "La factura muestra" : `${m.invoiceCount} facturas muestran`}{" "}
                <strong>{m.invoiceName}</strong>.
              </span>
              <span className="row">
                <Button size="sm" variant="ghost" onClick={() => onKeep(m)} disabled={saving !== null}>
                  Mantener información actual
                </Button>
                <Button size="sm" onClick={() => void update(m)} loading={saving === key} disabled={saving !== null && saving !== key}>
                  Actualizar razón social
                </Button>
              </span>
            </div>
          );
        })}
      </div>
    </Alert>
  );
}
