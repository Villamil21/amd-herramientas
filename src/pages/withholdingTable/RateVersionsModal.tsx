import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, DateInput, Field, Input, Modal, useToast } from "../../components/ui";
import { formatCop } from "../../modules/taxes/invoice-vat/parser/amounts";
import { formatRateBp, formatUvt, minBaseCents, parseHundredths } from "../../modules/taxes/withholding/services/money";
import { catalogExtrasService } from "../../services/purchasesService";
import { errorMessage } from "../../services/tauri";
import type { UvtValue, WithholdingRate } from "../../types/models";
import type { RateVersion } from "../../types/purchases";

interface Props {
  rate: WithholdingRate | null;
  versions: RateVersion[];
  uvts: UvtValue[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}

/**
 * Vigencias de un concepto: porcentaje y base en UVT que rigen desde una fecha. Una factura usa lo vigente en SU fecha de
 * expedición; agregar una vigencia nueva no recalcula facturas anteriores. La tarifa de la tabla es la regla base y rige hasta
 * la primera vigencia.
 */
export function RateVersionsModal({ rate, versions, uvts, onClose, onChanged }: Props) {
  const toast = useToast();
  const [date, setDate] = useState("");
  const [base, setBase] = useState("");
  const [pct, setPct] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  if (!rate) return null;
  const own = versions.filter((v) => v.rateId === rate.id).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const baseCenti = parseHundredths(base);
  const rateBp = parseHundredths(pct);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && baseCenti !== null && rateBp !== null && rateBp > 0 && rateBp <= 10_000;
  const uvtOf = (isoDate: string) => uvts.find((u) => u.year === Number(isoDate.slice(0, 4)));
  const minText = (centi: number, from: string) => {
    const u = uvtOf(from);
    return u ? formatCop(minBaseCents(centi, u.valuePesos)) : "UVT del año sin registrar";
  };

  async function run(action: () => Promise<void>, ok: string) {
    setSaving(true);
    try {
      await action();
      await onChanged();
      toast(ok);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Vigencias · ${rate.name}`} size="lg" onClose={onClose} locked={saving} footer={<Button onClick={onClose}>Cerrar</Button>}>
      <div className="stack">
        <Alert tone="info">
          Cada factura usa el porcentaje, la base en UVT y el UVT del año vigentes en su fecha de expedición. Una vigencia nueva rige desde su fecha hacia adelante y no recalcula las facturas anteriores.
        </Alert>
        <div className="table-wrap">
          <table className="table table--dense">
            <thead>
              <tr>
                <th>Rige desde</th>
                <th className="num">Base UVT</th>
                <th className="num">Base mínima</th>
                <th className="num">Tarifa</th>
                <th>Nota</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Regla base (hasta la primera vigencia)</td>
                <td className="num">{formatUvt(rate.baseUvtCenti)}</td>
                <td className="num">—</td>
                <td className="num">{formatRateBp(rate.rateBp)}</td>
                <td>Fila de la Tabla de retenciones</td>
                <td />
              </tr>
              {own.map((v) => (
                <tr key={v.effectiveFrom}>
                  <td>{v.effectiveFrom}</td>
                  <td className="num">{formatUvt(v.baseUvtCenti)}</td>
                  <td className="num">{minText(v.baseUvtCenti, v.effectiveFrom)}</td>
                  <td className="num">{formatRateBp(v.rateBp)}</td>
                  <td>{v.note}</td>
                  <td className="actions">
                    <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} aria-label="Eliminar vigencia" disabled={saving} onClick={() => void run(() => catalogExtrasService.deleteRateVersion(rate.id, v.effectiveFrom), "Vigencia eliminada.")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="form-grid form-grid--compact">
          <Field label="Rige desde" required>
            {(id) => <DateInput id={id} value={date} onChange={setDate} />}
          </Field>
          <Field label="Base UVT" required>
            {(id) => <Input id={id} value={base} onChange={(e) => setBase(e.target.value)} inputMode="decimal" placeholder={formatUvt(rate.baseUvtCenti)} />}
          </Field>
          <Field label="Tarifa (%)" required>
            {(id) => <Input id={id} value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" placeholder={formatRateBp(rate.rateBp).replace(/\s*%$/, "")} />}
          </Field>
          <Field label="Nota">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Decreto, resolución…" />}</Field>
        </div>
        <div>
          <Button variant="primary" icon={<Plus size={14} />} loading={saving} disabled={!valid} onClick={() => void run(async () => { await catalogExtrasService.saveRateVersion(rate.id, date, baseCenti!, rateBp!, note); setDate(""); setBase(""); setPct(""); setNote(""); }, "Vigencia guardada.")}>
            Agregar vigencia
          </Button>
        </div>
      </div>
    </Modal>
  );
}
