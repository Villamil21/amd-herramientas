import { Card } from "../../../../components/ui";
import { PERSON_TYPE_LABEL, RETENTION_TYPE_LABEL, TITLE_CATEGORY_LABEL } from "../../../../types/models";
import { formatCop } from "../../invoice-vat/parser/amounts";
import { Stat } from "../../../bank-analysis/shared/components/Stat";
import { ignoredGroup, STATUS_LABEL } from "../services/labels";
import { formatDate, formatRateBp } from "../services/money";
import type { DocRow, WithholdingReport } from "../types";
import { StatusBadge } from "./StatusBadge";

const money = (cents?: number) => (cents === undefined ? "—" : formatCop(cents));
const empty = (cols: number, text: string) => (
  <tr>
    <td colSpan={cols} className="muted" style={{ textAlign: "center", padding: "var(--space-5)" }}>
      {text}
    </td>
  </tr>
);

/** Resumen PJ / PN por tipo: solo Facturas válidas que efectivamente generaron retención. */
export function DeclarationSummary({ report }: { report: WithholdingReport }) {
  const sum = (pick: (l: WithholdingReport["summary"][number]) => number) => report.summary.reduce((s, l) => s + pick(l), 0);
  return (
    <Card flush title="Resumen para declaración" description="Solo facturas válidas que generaron retención. Las bases que no superaron el tope y las notas no se suman aquí.">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Concepto</th>
              <th className="num">PJ Base</th>
              <th className="num">PJ Retención</th>
              <th className="num">PN Base</th>
              <th className="num">PN Retención</th>
            </tr>
          </thead>
          <tbody>
            {report.summary.map((l) => (
              <tr key={l.retentionType}>
                <td className="table__primary">{RETENTION_TYPE_LABEL[l.retentionType]}</td>
                <td className="num">{money(l.pj.baseCents)}</td>
                <td className="num">{money(l.pj.retentionCents)}</td>
                <td className="num">{money(l.pn.baseCents)}</td>
                <td className="num">{money(l.pn.retentionCents)}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 600 }}>
              <td>Total</td>
              <td className="num">{money(sum((l) => l.pj.baseCents))}</td>
              <td className="num">{money(sum((l) => l.pj.retentionCents))}</td>
              <td className="num">{money(sum((l) => l.pn.baseCents))}</td>
              <td className="num">{money(sum((l) => l.pn.retentionCents))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * Notas crédito válidas que generaron retención, sin discriminar PJ / PN ni
 * tipo. La retención es el mismo valor de «Total retenciones notas» que se
 * resta en el total neto; la base es informativa y no se resta del resumen.
 */
export function NotesSummary({ notes }: { notes: WithholdingReport["notesSummary"] }) {
  return (
    <Card flush title="Notas crédito" description="Solo notas válidas que generaron retención. No se restan en el cuadro anterior: la retención se descuenta en el total neto.">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Concepto</th>
              <th className="num">Base</th>
              <th className="num">Retención</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ fontWeight: 600 }}>
              <td>Notas{notes.documentCount > 0 && <span className="muted" style={{ fontWeight: 400 }}> ({notes.documentCount === 1 ? "1 documento" : `${notes.documentCount} documentos`})</span>}</td>
              <td className="num">{money(notes.baseCents)}</td>
              <td className="num">{money(notes.retentionCents)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Vista de auditoría por subtipo (solo documentos que generaron retención). */
export function SubtypeDetailTable({ report }: { report: WithholdingReport }) {
  return (
    <Card flush title="Detalle por subtipo" description="Soporte de la declaración: documentos válidos que generaron retención.">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Tipo</th>
              <th>Subtipo</th>
              <th>PJ / PN</th>
              <th className="num">Base</th>
              <th className="num">Tarifa</th>
              <th className="num">Retención</th>
              <th className="num">Documentos</th>
            </tr>
          </thead>
          <tbody>
            {report.detail.length === 0 && empty(8, "Aún no hay documentos válidos con retención.")}
            {report.detail.map((d) => (
              <tr key={`${d.category}|${d.subtypeName}|${d.personType}|${d.rateBp}`}>
                <td>{TITLE_CATEGORY_LABEL[d.category]}</td>
                <td>{RETENTION_TYPE_LABEL[d.retentionType]}</td>
                <td className="table__primary">{d.subtypeName}</td>
                <td title={PERSON_TYPE_LABEL[d.personType]}>{d.personType}</td>
                <td className="num">{money(d.baseCents)}</td>
                <td className="num">{formatRateBp(d.rateBp)}</td>
                <td className="num">{money(d.retentionCents)}</td>
                <td className="num">{d.documentCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Documentos válidos cuya base no superó la base mínima: sin base ni retención en la declaración. */
export function BelowMinimumTable({ rows, onOpen }: { rows: DocRow[]; onOpen: (r: DocRow) => void }) {
  return (
    <Card flush title="No aplicó retención por base mínima" description="Documentos válidos que no superan el tope: se conservan para auditoría pero no suman base ni retención.">
      <div className="table-wrap table-wrap--scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Proveedor</th>
              <th>NIT</th>
              <th>Documento</th>
              <th>PJ / PN</th>
              <th>Tipo</th>
              <th>Subtipo</th>
              <th className="num">Base</th>
              <th className="num">Base mínima</th>
              <th className="num">Tarifa</th>
              <th className="num">Diferencia frente al tope</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.fileName} className="is-clickable" onClick={() => onOpen(r)}>
                <td>{r.category ? TITLE_CATEGORY_LABEL[r.category] : "—"}</td>
                <td className="table__primary">{r.supplierName || "—"}</td>
                <td className="selectable">{r.nit}</td>
                <td className="selectable" style={{ whiteSpace: "nowrap" }}>{r.number ?? r.fileName}</td>
                <td>{r.personType ?? "—"}</td>
                <td>{r.rule ? RETENTION_TYPE_LABEL[r.rule.retentionType] : "—"}</td>
                <td style={{ minWidth: 180 }}>{r.rule?.subtypeName ?? "—"}</td>
                <td className="num">{money(r.baseCents)}</td>
                <td className="num">{money(r.minBaseCents)}</td>
                <td className="num">{r.rateBp !== undefined ? formatRateBp(r.rateBp) : "—"}</td>
                <td className="num">{money(r.minBaseCents! - r.baseCents!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Notas: separadas de las facturas, con su total y detalle por documento. */
export function NotesSection({ rows, totalCents, onOpen }: { rows: DocRow[]; totalCents: number; onOpen: (r: DocRow) => void }) {
  return (
    <Card flush title="Notas / devoluciones" description={`Total retenciones de notas: ${formatCop(totalCents)}. Solo suman las notas válidas que generaron retención.`}>
      <div className="table-wrap table-wrap--scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Documento</th>
              <th>Proveedor</th>
              <th>NIT</th>
              <th>Tipo</th>
              <th>Subtipo</th>
              <th className="num">Base</th>
              <th className="num">Retención</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.fileName} className="is-clickable" onClick={() => onOpen(r)}>
                <td className="table__primary" style={{ whiteSpace: "nowrap" }}>{r.number ?? r.fileName}</td>
                <td>{r.supplierName || "—"}</td>
                <td className="selectable">{r.nit}</td>
                <td>{r.rule ? RETENTION_TYPE_LABEL[r.rule.retentionType] : "—"}</td>
                <td style={{ minWidth: 180 }}>{r.rule?.subtypeName ?? "—"}</td>
                <td className="num">{money(r.baseCents)}</td>
                <td className="num">{r.counts ? money(r.retentionCents) : "—"}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Ignorados: régimen excluido, fuera del periodo, duplicados y no compatibles. No suman. */
export function IgnoredSection({ rows, onOpen }: { rows: DocRow[]; onOpen: (r: DocRow) => void }) {
  const groups = ["Régimen/responsabilidad excluida", "Fuera del periodo", "Duplicados", "No compatibles"]
    .map((g) => ({ group: g, list: rows.filter((r) => ignoredGroup(r.status) === g) }))
    .filter((g) => g.list.length > 0);
  return (
    <Card flush title="Documentos ignorados" description="No suman en ningún total.">
      <div className="table-wrap table-wrap--scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Archivo</th>
              <th>Número</th>
              <th>Proveedor</th>
              <th>NIT</th>
              <th>Fecha</th>
              <th>Código fiscal</th>
              <th>Motivo</th>
            </tr>
          </thead>
          {groups.map(({ group, list }) => (
            <tbody key={group}>
              <tr>
                <th colSpan={7} style={{ background: "var(--color-surface-alt)" }}>
                  {group} ({list.length})
                </th>
              </tr>
              {list.map((r) => (
                <tr key={r.fileName} className="is-clickable" onClick={() => onOpen(r)}>
                  <td className="table__primary" style={{ minWidth: 200, maxWidth: 280, overflowWrap: "break-word" }}>
                    {r.fileName}
                  </td>
                  <td className="selectable" style={{ whiteSpace: "nowrap" }}>{r.number ?? "—"}</td>
                  <td>{r.supplierName || "—"}</td>
                  <td className="selectable">{r.nit ?? "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatDate(r.issueDate)}</td>
                  <td>{r.excludedCode ?? (r.fiscalCodes.join(";") || "—")}</td>
                  <td style={{ minWidth: 220 }}>{r.issues[0] ?? STATUS_LABEL[r.status]}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </Card>
  );
}

export function TotalsCard({ totals }: { totals: WithholdingReport["totals"] }) {
  return (
    <div className="stat-row">
      <Stat label="Total retenciones facturas" value={formatCop(totals.invoicesCents)} />
      <Stat label="Total retenciones notas" value={formatCop(totals.notesCents)} />
      <Stat label="Total neto" value={formatCop(totals.netCents)} />
      <Stat label="Total neto redondeado" value={formatCop(totals.netRoundedCents)} tone="positive" />
    </div>
  );
}
