import { useEffect, useState } from "react";
import { Alert, Button, DateInput, Field, Input, Modal, useToast } from "../../../../components/ui";
import { purchasesService } from "../../../../services/purchasesService";
import { supplierService } from "../../../../services/supplierService";
import { errorMessage } from "../../../../services/tauri";
import type { PersonType } from "../../../../types/models";
import { IdentityFields, LocationFields, type IdentityValue, type LocationValue } from "../../../exogena/components/ThirdPartyForm";
import type { SupplierView } from "../domain/model";
import type { PurchasesData } from "../usePurchasesData";

interface Props {
  data: PurchasesData;
  /** Proveedor que se edita (NIT, nombre y datos que ya salen de ficha + factura). */
  supplier: SupplierView | null;
  onClose: () => void;
}

/**
 * Edición del proveedor sin salir de Compras: completa los datos de tercero que exigen 1001, 1005 y 1006 (se guardan en
 * Proveedores) y el régimen fiscal con su fecha efectiva (historial: un cambio rige hacia adelante y no recalcula facturas
 * anteriores). Lo que la factura ya trae viene prellenado; nada se inventa.
 */
export function SupplierEditorModal({ data, supplier, onClose }: Props) {
  const toast = useToast();
  const [identity, setIdentity] = useState<IdentityValue | null>(null);
  const [location, setLocation] = useState<LocationValue | null>(null);
  const [regime, setRegime] = useState("");
  const [regimeDate, setRegimeDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supplier) return;
    const f = supplier.third.fields;
    setIdentity({
      personType: (f.personType ?? "") as PersonType | "",
      docTypeCode: f.docTypeCode,
      docNumber: f.docNumber,
      dv: f.dv,
      firstSurname: f.firstSurname,
      secondSurname: f.secondSurname,
      firstName: f.firstName,
      otherNames: f.otherNames,
      legalName: f.businessName || supplier.name,
    });
    setLocation({ address: f.address, countryCode: f.countryCode, deptCode: f.deptCode, muniCode: f.muniCode });
    setRegime(supplier.regimeText);
    setRegimeDate(data.selection.year ? `${data.selection.year}-01-01` : "");
  }, [supplier, data.selection.year]);

  if (!supplier || !identity || !location) return null;
  const regimeChanged = regime.trim() !== supplier.regimeText.trim();

  async function save() {
    if (!supplier || !identity || !location) return;
    setSaving(true);
    try {
      const existing = supplier.supplier;
      await supplierService.saveWithTax(
        existing?.id ?? null,
        { nit: supplier.nit, businessName: existing?.businessName || identity.legalName || supplier.name, vatType: existing?.vatType ?? null },
        {
          data: {
            docTypeCode: identity.docTypeCode || null,
            dv: identity.dv,
            personType: identity.personType || null,
            firstSurname: identity.firstSurname,
            secondSurname: identity.secondSurname,
            firstName: identity.firstName,
            otherNames: identity.otherNames,
            address: location.address,
            countryCode: location.countryCode,
            deptCode: location.deptCode,
            muniCode: location.muniCode,
          },
          dataOrigin: "manual",
        },
      );
      if (regime.trim() && regimeChanged && regimeDate) {
        await purchasesService.saveSupplierFiscal({ supplierNit: supplier.nit, effectiveDate: regimeDate, regime: regime.trim(), source: "manual", note: "Capturado en Compras, costos y exógena" });
      }
      await data.reloadSuppliers();
      toast("Proveedor actualizado.");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={supplier.name}
      description={`NIT ${supplier.nit}`}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            Guardar proveedor
          </Button>
        </>
      }
    >
      <div className="stack">
        {supplier.third.missing.length > 0 && (
          <Alert tone="danger" title="Datos que faltan para 1001, 1005 y 1006">
            {supplier.third.missing.join("; ")}.
          </Alert>
        )}
        <IdentityFields value={identity} onChange={(p) => setIdentity((cur) => (cur ? { ...cur, ...p } : cur))} catalogs={data.catalogs} numberLabel="NIT" numberReadOnly />
        <LocationFields value={location} onChange={(p) => setLocation((cur) => (cur ? { ...cur, ...p } : cur))} catalogs={data.catalogs} />
        <div className="form-grid form-grid--compact">
          <Field label="Régimen / responsabilidad fiscal" hint="Códigos como O-13, O-15 (autorretenedor), O-47 (régimen simple). Vacío: sin identificar.">
            {(id) => <Input id={id} value={regime} onChange={(e) => setRegime(e.target.value)} />}
          </Field>
          <Field label="Rige desde" hint="Un cambio de régimen no recalcula facturas anteriores a esta fecha.">
            {(id) => <DateInput id={id} value={regimeDate} onChange={setRegimeDate} disabled={!regimeChanged} />}
          </Field>
        </div>
        {supplier.history.length > 0 && (
          <div>
            <strong>Historial de régimen</strong>
            <ul>
              {supplier.history.map((h) => (
                <li key={h.effectiveDate}>
                  Desde {h.effectiveDate}: {h.regime} <span className="field__hint">({h.source})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
