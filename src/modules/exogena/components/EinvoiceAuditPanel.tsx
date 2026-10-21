import { Badge, Card } from "../../../components/ui";
import { formatExoCents } from "../domain/numbers";
import { EINVOICE_ORIGIN, isEinvoiceKey, type EinvoiceContribution, type EinvoiceFormat } from "../domain/einvoiceSales";
import { FORMAT_1005_COLUMNS, FORMAT_1006_COLUMNS, FORMAT_1007_COLUMNS } from "../domain/formats";

const COLUMNS = { "1007": FORMAT_1007_COLUMNS, "1005": FORMAT_1005_COLUMNS, "1006": FORMAT_1006_COLUMNS };

interface Props {
  format: EinvoiceFormat;
  sales: EinvoiceContribution;
}

/**
 * Auditoría de Facturación electrónica en un formato: cada registro propuesto con los documentos que lo forman (archivo, hoja,
 * fila, CUFE/CUDE, fecha, tipo, receptor, Total, IVA, columnas restadas) y lo que cada uno aporta a las columnas del formato.
 */
export function EinvoiceAuditPanel({ format, sales }: Props) {
  const proposals = sales.proposals[format];
  if (proposals.length === 0) return null;
  const header = (key: string) => COLUMNS[format].find((c) => c.key === key)?.header ?? key;
  return (
    <Card flush title={`Auditoría · ${EINVOICE_ORIGIN}`} description={`Cada registro del ${format} que sale de Facturación electrónica, con los documentos que lo forman.`}>
      <div className="stack stack--sm" style={{ padding: 12 }}>
        {proposals.map((p) => {
          const lines = sales.audit[p.sourceKey] ?? [];
          return (
            <details key={p.sourceKey}>
              <summary>
                <strong className="selectable">
                  {String(p.data.docNumber)} · {String(p.data.thirdName ?? "")}
                </strong>{" "}
                <span className="muted">
                  {p.originRef} {isEinvoiceKey(p.sourceKey) ? "" : ""}
                </span>
              </summary>
              <div className="table-wrap">
                <table className="table table--dense">
                  <thead>
                    <tr>
                      <th>Archivo · hoja · fila</th>
                      <th>CUFE/CUDE o ID</th>
                      <th>Fecha</th>
                      <th>Tipo original</th>
                      <th>Receptor</th>
                      <th className="num">Total</th>
                      <th className="num">IVA</th>
                      <th>Columnas restadas (base 1007)</th>
                      <th>Aporta al formato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.documentId}>
                        <td className="selectable">
                          {l.fileName} · {l.sheet} · {l.row}
                        </td>
                        <td className="selectable" title={l.documentId}>
                          {l.documentId.length > 18 ? `${l.documentId.slice(0, 18)}…` : l.documentId}
                        </td>
                        <td className="nowrap">{l.issueDate}</td>
                        <td>{l.docType}</td>
                        <td className="selectable">
                          {l.receiverName} <span className="muted">({l.receiverNitRaw})</span>
                        </td>
                        <td className="num">{formatExoCents(l.totalCents)}</td>
                        <td className="num">{formatExoCents(l.ivaCents)}</td>
                        <td>{l.subtractedColumns.length ? `${l.subtractedColumns[0]} … ${l.subtractedColumns[l.subtractedColumns.length - 1]}` : <Badge tone="warning">Sin definir</Badge>}</td>
                        <td>
                          {Object.entries(l.contributions)
                            .map(([k, v]) => `${header(k)}: ${formatExoCents(v)}`)
                            .join(" · ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </div>
    </Card>
  );
}
