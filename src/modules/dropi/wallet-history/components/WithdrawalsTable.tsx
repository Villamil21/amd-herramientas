import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge, Button, Card, Input } from "../../../../components/ui";
import { normalizeKey } from "../../../../utils/text";
import { SearchBox, SegmentedFilter } from "../../../bank-analysis/shared/components/tableControls";
import { formatCop } from "../../orders/services/format";
import { INCIDENT_LABEL, INCIDENTS, manualSplit, METHOD_LABEL } from "../services/analysis";
import type { AnalyzedMovement, Incident, WalletAnalysis } from "../types";

export type WithdrawalFilter = "all" | "validated" | "review" | Incident;

const money = (cents: number | null) => (cents === null ? "—" : formatCop(cents));

/** Texto de búsqueda por fila (concepto, fecha e ID), calculado una vez. */
const searchIndex = new WeakMap<AnalyzedMovement, string>();
const searchable = (m: AnalyzedMovement) => {
  let s = searchIndex.get(m);
  if (s === undefined) searchIndex.set(m, (s = normalizeKey([m.concept, m.date, m.dateKey, m.id].filter(Boolean).join(" "))));
  return s;
};

function matches(m: AnalyzedMovement, filter: WithdrawalFilter) {
  if (filter === "all") return true;
  if (filter === "validated") return m.incidents.length === 0;
  if (filter === "review") return m.incidents.length > 0;
  return m.incidents.includes(filter);
}

export function StatusBadges({ movement }: { movement: AnalyzedMovement }) {
  if (movement.incidents.length === 0) return <Badge tone="success">Validado</Badge>;
  return (
    <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
      {movement.incidents.map((i) => (
        <Badge key={i} tone={i === "invalid_amount" ? "danger" : "warning"}>
          {INCIDENT_LABEL[i]}
        </Badge>
      ))}
    </span>
  );
}

/** «4.000.000» / «4000000,50» → centavos (null si no es un número). */
function parsePesos(text: string): number | null {
  const clean = text.replace(/[$\s.]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** Edición manual del valor pagado: el 4x1000 se calcula como MONTO − valor pagado (siempre suman el MONTO). */
function ManualSplitForm({ movement, onSave }: { movement: AnalyzedMovement; onSave: (paidCents: number | null) => void }) {
  const [text, setText] = useState(movement.paidCents === null ? "" : String(movement.paidCents / 100).replace(".", ","));
  const paid = parsePesos(text);
  const result = paid === null ? null : manualSplit(movement.amountCents!, paid);
  const error = text && (paid === null ? "Escribe un valor en pesos." : typeof result === "string" ? result : null);
  return (
    <div className="wallet-manual" onClick={(e) => e.stopPropagation()}>
      <label className="field__label" htmlFor={`paid-${movement.rowNumber}`}>
        Valor pagado
      </label>
      <Input id={`paid-${movement.rowNumber}`} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} style={{ width: 160 }} />
      <span className="muted">
        4x1000: {result && typeof result !== "string" ? formatCop(result.gmfCents) : "—"} · MONTO: {formatCop(movement.amountCents!)}
      </span>
      <Button size="sm" variant="primary" disabled={!result || typeof result === "string"} onClick={() => paid !== null && onSave(paid)}>
        Guardar
      </Button>
      {movement.method === "manual" && (
        <Button size="sm" variant="ghost" onClick={() => onSave(null)}>
          Volver al cálculo
        </Button>
      )}
      {error && <span className="field__error">{error}</span>}
    </div>
  );
}

/**
 * Retiros del archivo: Fecha, Valor pagado, 4x1000, Concepto retiro y Estado.
 * Cada fila se despliega para ver ID, hora, TIPO, MONTO y DESCRIPCIÓN.
 * Los filtros y el buscador solo cambian la vista.
 */
export function WithdrawalsTable({
  analysis,
  filter,
  onFilter,
  onEditPaid,
}: {
  analysis: WalletAnalysis;
  filter: WithdrawalFilter;
  onFilter: (f: WithdrawalFilter) => void;
  onEditPaid: (rowNumber: number, paidCents: number | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());

  const options = useMemo(
    () => [
      { id: "all" as WithdrawalFilter, label: "Todos" },
      { id: "validated" as WithdrawalFilter, label: "Validados" },
      { id: "review" as WithdrawalFilter, label: "Requiere revisión" },
      // Cada incidencia presente también es un filtro (las alertas lo usan).
      ...INCIDENTS.filter((i) => analysis.incidentCounts[i] > 0).map((i) => ({ id: i as WithdrawalFilter, label: INCIDENT_LABEL[i] })),
    ],
    [analysis],
  );

  const visible = useMemo(() => {
    const q = normalizeKey(query);
    return analysis.movements.filter((m) => matches(m, filter) && (!q || searchable(m).includes(q)));
  }, [analysis, filter, query]);

  const toggle = (rowNumber: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(rowNumber)) next.add(rowNumber);
      return next;
    });

  return (
    <Card flush title="Detalle" description="Pulsa una fila para ver ID, hora, tipo, MONTO y descripción. Busca por concepto de retiro, fecha o ID.">
      <div className="toolbar row--between">
        <SegmentedFilter label="Filtrar retiros" options={options} value={filter} onChange={onFilter} />
        <SearchBox placeholder="Concepto, fecha o ID" value={query} onChange={setQuery} />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th aria-label="Ver detalle" style={{ width: 36 }} />
              <th>Fecha</th>
              <th className="num">Valor pagado</th>
              <th className="num">4x1000</th>
              <th>Concepto retiro</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: "center", padding: "var(--space-6)" }}>
                  Ningún movimiento coincide con la búsqueda o el filtro.
                </td>
              </tr>
            )}
            {visible.map((m) => {
              const expanded = open.has(m.rowNumber);
              const Chevron = expanded ? ChevronDown : ChevronRight;
              return (
                <Fragment key={m.rowNumber}>
                  <tr className={`wallet-row ${m.incidents.length ? "wallet-row--review" : ""}`} onClick={() => toggle(m.rowNumber)} aria-expanded={expanded}>
                    <td className="muted">
                      <Chevron size={15} />
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{m.date || "—"}</td>
                    <td className="num" title={m.amountCents === null ? undefined : `MONTO (incluye 4x1000): ${formatCop(m.amountCents)}`}>
                      {money(m.paidCents)}
                    </td>
                    <td className="num">
                      {money(m.gmfCents)}
                      {m.method === "manual" && (
                        <span className="wallet-row__manual">
                          <Badge tone="gold">Manual</Badge>
                        </span>
                      )}
                    </td>
                    <td className="table__primary selectable" style={{ minWidth: 220 }}>
                      {m.concept || "—"}
                    </td>
                    <td>
                      <StatusBadges movement={m} />
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="wallet-detail">
                      <td />
                      <td colSpan={5}>
                        <div className="summary-grid">
                          <Info label="ID" value={m.id || "—"} />
                          <Info label="Fecha y hora" value={[m.date, m.time].filter(Boolean).join(" ") || "—"} />
                          <Info label="Fila en el Excel" value={String(m.rowNumber)} />
                          <Info label="Tipo" value={m.type || "—"} />
                          <Info label="Monto (incluye 4x1000)" value={m.amountCents === null ? m.amountText || "(vacío)" : formatCop(m.amountCents)} />
                          <Info label="Valor pagado + 4x1000" value={m.paidCents === null ? "—" : `${formatCop(m.paidCents)} + ${formatCop(m.gmfCents!)}`} />
                          <Info label="Método" value={m.method ? METHOD_LABEL[m.method] : "Sin solución: requiere revisión"} />
                          {m.method === "manual" && <Info label="Valor pagado calculado" value={m.calculatedPaidCents === null ? "Sin solución" : formatCop(m.calculatedPaidCents)} />}
                          <Info label="Descripción encontrada" value={m.description || "(vacía)"} />
                          <Info label="Incidencias" value={m.incidents.length === 0 ? "Ninguna" : m.incidents.map((i) => (i === "invalid_amount" && m.amountProblem ? m.amountProblem : INCIDENT_LABEL[i])).join(" · ")} />
                        </div>
                        {m.amountCents !== null && !m.amountProblem && <ManualSplitForm key={`${m.rowNumber}:${m.paidCents}`} movement={m} onSave={(paid) => onEditPaid(m.rowNumber, paid)} />}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-item">
      <span className="summary-item__label">{label}</span>
      <span className="summary-item__value selectable">{value}</span>
    </div>
  );
}
