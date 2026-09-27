import { Alert, Button, Card } from "../../../../components/ui";
import { formatDateShort } from "../../../../utils/dates";
import { formatInteger, formatMoneyCents } from "../../../../utils/format";
import type { ExcelAnalysis } from "../logic/excelAnalysis";

interface Props {
  analysis: ExcelAnalysis;
  priorAck: boolean;
  onPriorAck: (value: boolean) => void;
  onBack: () => void;
  onNext: () => void;
  canContinue: boolean;
}

function Item({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`summary-item ${highlight ? "summary-item--highlight" : ""}`}>
      <span className="summary-item__label">{label}</span>
      <span className="summary-item__value selectable">{value}</span>
    </div>
  );
}

export function ReviewStep({ analysis: a, priorAck, onPriorAck, onBack, onNext, canContinue }: Props) {
  const blocked = a.errors.length > 0;
  const alerts = a.errors.length + a.warnings.length + (a.priorRetentions.length > 0 ? 1 : 0);

  return (
    <Card
      title="Revisar información"
      description="Verifica el resumen del archivo antes de continuar."
      footer={
        <div className="wizard-actions" style={{ width: "100%" }}>
          <Button variant="ghost" onClick={onBack}>
            Volver
          </Button>
          <Button variant="primary" onClick={onNext} disabled={!canContinue}>
            Continuar
          </Button>
        </div>
      }
    >
      <div className="stack">
        {blocked && (
          <Alert tone="danger" title="No se puede generar el certificado">
            Corrige el archivo Excel y vuelve a importarlo.
          </Alert>
        )}
        {a.errors.map((e, i) => (
          <Alert key={`e${i}`} tone="danger" title={e.message} items={e.details} />
        ))}

        {a.priorRetentions.length > 0 && (
          <Alert tone="warning" title="Se detectaron valores de retención previamente registrados en el archivo.">
            <div className="table-wrap" style={{ margin: "6px 0" }}>
              <table className="table" style={{ background: "transparent" }}>
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>Tipo de retención</th>
                    <th className="num">Valor encontrado</th>
                  </tr>
                </thead>
                <tbody>
                  {a.priorRetentions.map((r, i) => (
                    <tr key={i}>
                      <td>{r.row}</td>
                      <td>{r.column}</td>
                      <td className="num">{formatMoneyCents(r.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={priorAck} onChange={(e) => onPriorAck(e.target.checked)} disabled={blocked} />
              Revisé estos valores y deseo continuar con la generación del certificado.
            </label>
          </Alert>
        )}

        {a.warnings.map((w, i) => (
          <Alert key={`w${i}`} tone="info" title={w.message} items={w.details} />
        ))}

        <div className="summary-grid">
          <Item label="Archivo importado" value={a.fileName} />
          <Item label="Documentos" value={formatInteger(a.documents.length)} />
          <Item label="Facturas electrónicas" value={formatInteger(a.invoiceCount)} />
          <Item label="Notas crédito" value={formatInteger(a.creditNoteCount)} />
          <Item label="Retenido a" value={a.retenido?.nombre ?? "—"} />
          <Item label="NIT del retenido" value={a.nits.length > 1 ? a.nits.map((n) => n.nit).join(" · ") : a.retenido?.nit ?? "—"} />
          <Item label="Fecha mínima" value={a.dateMin ? formatDateShort(a.dateMin) : "—"} />
          <Item label="Fecha máxima" value={a.dateMax ? formatDateShort(a.dateMax) : "—"} />
          <Item label="Periodo gravable" value={a.period?.label ?? "—"} />
          <Item label="Alertas" value={alerts === 0 ? "Ninguna" : formatInteger(alerts)} />
          <Item label="Base de retención" value={formatMoneyCents(a.baseCents)} highlight />
        </div>

        {a.documents.length > 0 && (
          <details>
            <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
              Ver detalle por documento ({a.documents.length})
            </summary>
            <div className="table-wrap card" style={{ marginTop: 10 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>Tipo</th>
                    <th>Fecha</th>
                    <th className="num">Total</th>
                    <th className="num">Impuestos</th>
                    <th className="num">Base ajustada</th>
                  </tr>
                </thead>
                <tbody>
                  {a.documents.map((d) => (
                    <tr key={d.row}>
                      <td>{d.row}</td>
                      <td>{d.tipo}</td>
                      <td>{formatDateShort(d.fecha)}</td>
                      <td className="num">{formatMoneyCents(d.totalCents)}</td>
                      <td className="num">{formatMoneyCents(d.taxesCents)}</td>
                      <td className="num" style={{ color: d.sign < 0 ? "var(--color-danger)" : undefined }}>
                        {formatMoneyCents(d.adjustedBaseCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}
