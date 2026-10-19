import type { RetentionCell } from "../domain/retentionSummary";

/** Celda «Rete»: texto compacto; el «$ 0» por cuantía mínima lleva su explicación en texto secundario y ayuda emergente. */
export function ReteCell({ cell }: { cell: RetentionCell }) {
  if (cell.kind === "empty") return <span>—</span>;
  if (cell.kind === "exempt" || cell.kind === "none") return <span className={cell.kind === "none" ? "field__hint" : undefined}>{cell.text}</span>;
  return (
    <span title={cell.hint} data-testid="rete-cell">
      {cell.text}
      {cell.informed && <small style={{ display: "block", color: "var(--color-warning-ink)", fontWeight: 600 }} data-testid="rete-informed">{cell.informed.text}</small>}
      {cell.hint && <small className="field__hint" style={{ display: "block" }}>{cell.hint}</small>}
    </span>
  );
}
