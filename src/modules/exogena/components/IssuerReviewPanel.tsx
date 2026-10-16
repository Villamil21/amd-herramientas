import { IdCard } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, Badge, Button, Modal, useToast } from "../../../components/ui";
import { supplierService } from "../../../services/supplierService";
import { errorMessage } from "../../../services/tauri";
import type { Supplier } from "../../../types/models";
import { applyProposal, proposeFromInvoices, type ChangeKey, type IssuerInvoice, type SupplierProposal } from "../domain/issuerProposal";
import { useCatalogs } from "../hooks";

interface Props {
  /** Facturas leídas en el análisis (cualquier módulo: IVA, retención o clasificación contable). */
  invoices: IssuerInvoice[];
  suppliers: Supplier[];
  /** Vuelve a cargar los proveedores tras guardar. */
  onApplied: () => void | Promise<void>;
}

/**
 * «Datos del Emisor / Vendedor» de las facturas → ficha del proveedor para Información Exógena, de forma revisable: lo que el
 * proveedor no tenía se propone para completar y lo que ya tiene y la factura contradice se muestra como diferencia sin marcar.
 * Una persona natural cuyo tipo de documento no se conoce queda como tarea «Tipo de documento pendiente» (no se inventa el 13).
 */
export function IssuerReviewPanel({ invoices, suppliers, onApplied }: Props) {
  const { catalogs } = useCatalogs();
  const proposals = useMemo(() => (catalogs ? proposeFromInvoices(invoices, suppliers, catalogs) : []), [invoices, suppliers, catalogs]);
  const [open, setOpen] = useState(false);
  if (proposals.length === 0) return null;
  const withChanges = proposals.filter((p) => p.changes.length > 0).length;
  const pendingType = proposals.filter((p) => p.needsDocType).length;
  return (
    <>
      <Alert tone="info" title="Datos de proveedores en las facturas">
        <div className="row row--between" style={{ gap: 12, flexWrap: "wrap" }}>
          <span>
            {withChanges > 0 && (
              <>
                Las facturas traen datos de {withChanges} {withChanges === 1 ? "proveedor" : "proveedores"} para su ficha de Información Exógena (tipo de persona, dirección y ubicación).
              </>
            )}
            {pendingType > 0 && <> {pendingType} persona{pendingType === 1 ? "" : "s"} natural{pendingType === 1 ? "" : "es"} necesita{pendingType === 1 ? "" : "n"} que elijas su tipo de documento en Proveedores.</>}
          </span>
          <Button size="sm" icon={<IdCard size={14} />} onClick={() => setOpen(true)}>
            Revisar
          </Button>
        </div>
      </Alert>
      <ReviewModal open={open} proposals={proposals} onClose={() => setOpen(false)} onApplied={onApplied} />
    </>
  );
}

function ReviewModal({ open, proposals, onClose, onApplied }: { open: boolean; proposals: SupplierProposal[]; onClose: () => void; onApplied: Props["onApplied"] }) {
  const toast = useToast();
  // Por defecto se aceptan los datos que el proveedor no tenía; las diferencias con lo que ya tiene quedan sin marcar.
  const initial = useMemo(() => new Map(proposals.map((p) => [p.supplier.id, new Set<ChangeKey>(p.changes.filter((c) => c.kind === "fill").map((c) => c.key))])), [proposals]);
  const [accepted, setAccepted] = useState<Map<number, Set<ChangeKey>> | null>(null);
  const [saving, setSaving] = useState(false);
  const current = accepted ?? initial;

  function toggle(id: number, key: ChangeKey, on: boolean) {
    setAccepted(() => {
      const next = new Map([...current].map(([k, v]) => [k, new Set(v)]));
      const set = next.get(id) ?? new Set<ChangeKey>();
      if (on) set.add(key);
      else set.delete(key);
      next.set(id, set);
      return next;
    });
  }

  async function apply() {
    setSaving(true);
    try {
      let saved = 0;
      for (const p of proposals) {
        const keys = current.get(p.supplier.id) ?? new Set<ChangeKey>();
        if (keys.size === 0) continue;
        await supplierService.saveTaxData(p.supplier.id, applyProposal(p, keys));
        saved += 1;
      }
      toast(saved ? `Datos aplicados a ${saved} ${saved === 1 ? "proveedor" : "proveedores"}.` : "No se aplicó ningún cambio.");
      setAccepted(null);
      onClose();
      await onApplied();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      size="xl"
      title="Datos del emisor en las facturas"
      description="Revisa qué datos pasan a la ficha de cada proveedor. Nada se guarda hasta que confirmes."
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void apply()} loading={saving}>
            Aplicar lo seleccionado
          </Button>
        </>
      }
    >
      <div className="stack">
        {proposals.map((p) => (
          <div key={p.supplier.id} className="stack stack--sm">
            <strong>
              {p.supplier.businessName} <span className="muted">· NIT {p.supplier.nit}</span>
            </strong>
            {p.needsDocType && <Badge tone="warning">Tipo de documento pendiente: elígelo en Proveedores (la factura no lo dice)</Badge>}
            {p.warnings.length > 0 && <span className="muted">{p.warnings.join(" ")}</span>}
            {p.changes.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }} />
                      <th>Dato</th>
                      <th>Ficha actual</th>
                      <th>En la factura</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {p.changes.map((c) => (
                      <tr key={c.key} className={c.kind === "conflict" ? "row--warning" : undefined}>
                        <td>
                          <input type="checkbox" aria-label={`Aplicar ${c.label}`} checked={current.get(p.supplier.id)?.has(c.key) ?? false} onChange={(e) => toggle(p.supplier.id, c.key, e.target.checked)} />
                        </td>
                        <td>{c.label}</td>
                        <td className="selectable">{c.currentLabel || <span className="muted">—</span>}</td>
                        <td className="selectable">{c.proposedLabel}</td>
                        <td>{c.kind === "conflict" ? <Badge tone="warning">Difiere</Badge> : <Badge tone="gold">Completa un dato</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
