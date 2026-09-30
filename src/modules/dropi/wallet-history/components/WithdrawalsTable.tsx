import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge, Card } from "../../../../components/ui";
import { normalizeKey } from "../../../../utils/text";
import { SearchBox, SegmentedFilter } from "../../../bank-analysis/shared/components/tableControls";
import { formatCop } from "../../orders/services/format";
import { INCIDENT_LABEL, INCIDENTS } from "../services/analysis";
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

/**
 * Retiros del archivo: Fecha, Valor pagado, 4x1000, Concepto retiro y Estado.
 * Cada fila se despliega para ver ID, hora, TIPO, MONTO y DESCRIPCIÓN.
 * Los filtros y el buscador solo cambian la vista.
 */
export function WithdrawalsTable({ analysis, filter, onFilter }: { analysis: WalletAnalysis; filter: WithdrawalFilter; onFilter: (f: WithdrawalFilter) => void }) {
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
                    <td className="num">{money(m.gmfCents)}</td>
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
                          <Info label="Descripción encontrada" value={m.description || "(vacía)"} />
                          <Info label="Incidencias" value={m.incidents.length === 0 ? "Ninguna" : m.incidents.map((i) => (i === "invalid_amount" && m.amountProblem ? m.amountProblem : INCIDENT_LABEL[i])).join(" · ")} />
                        </div>
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
