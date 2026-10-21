import { useMemo, useState } from "react";
import { Badge, Button, Card, Field, Input, Select, useToast } from "../../../components/ui";
import { einvoiceService } from "../../../services/einvoiceService";
import { errorMessage } from "../../../services/tauri";
import type { EinvoiceCustomer } from "../../../types/einvoice";
import type { ExoCatalogs } from "../../../types/exogena";
import type { PendingCustomer } from "../domain/einvoiceSales";
import { reopenReadyEinvoiceFormats } from "../einvoiceReopen";
import { computeNitDv, DOC_NIT } from "../domain/thirdParty";

interface Props {
  companyId: number;
  year: number;
  pending: PendingCustomer[];
  catalogs: ExoCatalogs | null;
  /** Se llama cuando se confirmó una ficha (para recalcular). */
  onChanged: () => void | Promise<void>;
}

const EMPTY = { docTypeCode: "", firstSurname: "", secondSurname: "", firstName: "", otherNames: "", businessName: "" };

/**
 * Clientes de Facturación electrónica sin identidad confirmada (NIT que no empieza por 90 o con otro formato). Se confirma una vez
 * el tipo de documento y la división del nombre; esa ficha sirve para 1007, 1005 y 1006 y para las próximas importaciones.
 * Nada se propone en silencio: sin confirmar, los documentos del cliente no entran al formato.
 */
export function EinvoiceCustomersPanel({ companyId, year, pending, catalogs, onChanged }: Props) {
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, typeof EMPTY>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const docTypes = useMemo(() => (catalogs?.documentTypes ?? []).filter((d) => d.isActive), [catalogs]);
  if (pending.length === 0) return null;

  const draft = (c: PendingCustomer) => drafts[c.number] ?? EMPTY;
  const patch = (c: PendingCustomer, p: Partial<typeof EMPTY>) => setDrafts((all) => ({ ...all, [c.number]: { ...draft(c), ...p } }));

  async function confirm(c: PendingCustomer) {
    const d = draft(c);
    const juridical = d.docTypeCode === DOC_NIT;
    const customer: EinvoiceCustomer = {
      companyId,
      docNumber: c.number,
      docTypeCode: d.docTypeCode,
      dv: juridical ? computeNitDv(c.number) : "",
      firstSurname: juridical ? "" : d.firstSurname,
      secondSurname: juridical ? "" : d.secondSurname,
      firstName: juridical ? "" : d.firstName,
      otherNames: juridical ? "" : d.otherNames,
      businessName: juridical ? d.businessName : "",
    };
    setSaving(c.number);
    try {
      await einvoiceService.saveCustomer(customer);
      // La identidad cambió: un formato «listo» de este año vuelve a revisión (nunca se reescribe en silencio).
      await reopenReadyEinvoiceFormats(companyId, [year]);
      toast(`Cliente ${c.number} confirmado.`);
      await onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card title={`Clientes por confirmar (${pending.length})`} description="Facturación electrónica: confirma el tipo de documento y los nombres. Se guarda una vez y vale para 1007, 1005 y 1006. Hasta entonces los documentos del cliente no entran al formato.">
      <div className="stack">
        {pending.map((c) => {
          const d = draft(c);
          const juridical = d.docTypeCode === DOC_NIT;
          const ready = d.docTypeCode && (juridical ? d.businessName.trim() : d.firstSurname.trim() && d.firstName.trim());
          return (
            <div key={c.number} className="card" style={{ padding: 12 }}>
              <div className="row row--between" style={{ gap: 8, flexWrap: "wrap" }}>
                <div>
                  <strong className="selectable">{c.number}</strong> · <span className="selectable">{c.names.join(" / ") || "Sin nombre"}</span>
                  <div className="muted">
                    Excel: {c.rawNits.join(", ")} · {c.documents} {c.documents === 1 ? "documento" : "documentos"}
                  </div>
                </div>
                <span className="row" style={{ gap: 4 }}>
                  {c.formats.map((f) => (
                    <Badge key={f} tone="warning">
                      Detiene {f}
                    </Badge>
                  ))}
                </span>
              </div>
              <div className="form-grid form-grid--compact" style={{ marginTop: 8 }}>
                <Field label="Tipo de documento" required hint="Elígelo: no se supone.">
                  {(id) => (
                    <Select id={id} value={d.docTypeCode} onChange={(e) => patch(c, { docTypeCode: e.target.value })}>
                      <option value="">Sin definir</option>
                      {docTypes.map((t) => (
                        <option key={t.code} value={t.code}>
                          {t.code} · {t.description}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {juridical ? (
                  <>
                    <Field label="DV (calculado)">{(id) => <Input id={id} value={computeNitDv(c.number)} readOnly />}</Field>
                    <Field label="Razón social" required hint={c.names[0] ? `Nombre receptor: ${c.names[0]}` : undefined}>
                      {(id) => <Input id={id} value={d.businessName} onChange={(e) => patch(c, { businessName: e.target.value })} />}
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Primer apellido" required>
                      {(id) => <Input id={id} value={d.firstSurname} onChange={(e) => patch(c, { firstSurname: e.target.value })} />}
                    </Field>
                    <Field label="Segundo apellido">{(id) => <Input id={id} value={d.secondSurname} onChange={(e) => patch(c, { secondSurname: e.target.value })} />}</Field>
                    <Field label="Primer nombre" required>
                      {(id) => <Input id={id} value={d.firstName} onChange={(e) => patch(c, { firstName: e.target.value })} />}
                    </Field>
                    <Field label="Otros nombres">{(id) => <Input id={id} value={d.otherNames} onChange={(e) => patch(c, { otherNames: e.target.value })} />}</Field>
                  </>
                )}
              </div>
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
                <Button variant="primary" size="sm" disabled={!ready} loading={saving === c.number} onClick={() => void confirm(c)}>
                  Confirmar cliente
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
