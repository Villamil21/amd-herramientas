import { useMemo, useState } from "react";
import { Badge, Card } from "../../../../components/ui";
import { RETENTION_TYPE_LABEL, TITLE_CATEGORY_LABEL } from "../../../../types/models";
import { normalizeKey } from "../../../../utils/text";
import { SearchBox, SegmentedFilter } from "../../../bank-analysis/shared/components/tableControls";
import { formatCop } from "../../invoice-vat/parser/amounts";
import { ignoredGroup, PENDING_STATUSES } from "../services/labels";
import { formatDate, formatRateBp } from "../services/money";
import type { DocRow } from "../types";
import { StatusBadge } from "./StatusBadge";

type Filter = "all" | "pending" | "validated" | "below" | "ignored" | "invoice" | "credit_note";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "pending", label: "Por revisar" },
  { id: "validated", label: "Validadas" },
  { id: "below", label: "No supera tope" },
  { id: "ignored", label: "Ignorados" },
  { id: "invoice", label: "Facturas" },
  { id: "credit_note", label: "Notas" },
];

function matches(r: DocRow, f: Filter): boolean {
  switch (f) {
    case "pending":
      return PENDING_STATUSES.includes(r.status);
    case "validated":
      return r.status === "validated";
    case "below":
      return r.status === "below-minimum";
    case "ignored":
      return Boolean(ignoredGroup(r.status));
    case "invoice":
    case "credit_note":
      return r.category === f;
    default:
      return true;
  }
}

const money = (cents?: number) => (cents === undefined ? "—" : formatCop(cents));

export function DocumentsTable({ rows, onOpen }: { rows: DocRow[]; onOpen: (r: DocRow) => void }) {
  const [query, setQuery] = useState("");
  const pendingCount = rows.filter((r) => PENDING_STATUSES.includes(r.status)).length;
  const [filter, setFilter] = useState<Filter>(pendingCount ? "pending" : "all");

  const visible = useMemo(() => {
    const q = normalizeKey(query);
    return rows.filter((r) => matches(r, filter) && (!q || normalizeKey([r.fileName, r.number, r.nit, r.supplierName].filter(Boolean).join(" ")).includes(q)));
  }, [rows, query, filter]);

  return (
    <Card flush title="Documentos" description="Haz clic en un documento para ver sus datos, la configuración de retención, los productos y las validaciones.">
      <div className="toolbar row--between">
        <SegmentedFilter label="Filtrar documentos" options={FILTERS} value={filter} onChange={setFilter} />
        <SearchBox placeholder="Archivo, número, NIT o proveedor" value={query} onChange={setQuery} />
      </div>
      <div className="table-wrap table-wrap--scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Archivo</th>
              <th>Categoría</th>
              <th>Título original</th>
              <th>Número</th>
              <th>Fecha</th>
              <th>NIT</th>
              <th>Proveedor</th>
              <th>PJ / PN</th>
              <th>Régimen</th>
              <th>Tipo</th>
              <th>Subtipo</th>
              <th className="num">Base</th>
              <th className="num">Base mínima</th>
              <th className="num">Tarifa</th>
              <th className="num">Retención calculada</th>
              <th className="num">Rete fuente PDF</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={17} className="muted" style={{ textAlign: "center", padding: "var(--space-6)" }}>
                  Ningún documento coincide con el filtro.
                </td>
              </tr>
            )}
            {visible.map((r) => (
              <tr key={r.fileName} className="is-clickable" onClick={() => onOpen(r)}>
                <td className="table__primary" style={{ minWidth: 200, maxWidth: 280, overflowWrap: "break-word" }}>
                  {r.fileName}
                </td>
                <td>{r.category ? <Badge tone={r.category === "credit_note" ? "gold" : "dark"}>{TITLE_CATEGORY_LABEL[r.category]}</Badge> : "—"}</td>
                <td style={{ minWidth: 160 }}>{r.title ?? "—"}</td>
                <td className="selectable" style={{ whiteSpace: "nowrap" }}>{r.number ?? "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>{formatDate(r.issueDate)}</td>
                <td className="selectable">{r.nit ?? "—"}</td>
                <td style={{ minWidth: 160 }}>{r.supplierName || "—"}</td>
                <td>{r.personType ?? "—"}</td>
                <td className="selectable" style={{ whiteSpace: "nowrap" }}>{r.fiscalCodes.join(";") || "—"}</td>
                <td>{r.rule ? RETENTION_TYPE_LABEL[r.rule.retentionType] : "—"}</td>
                <td style={{ minWidth: 180 }}>{r.rule?.subtypeName ?? "—"}</td>
                <td className="num">{money(r.baseCents)}</td>
                <td className="num">{money(r.minBaseCents)}</td>
                <td className="num">{r.rateBp !== undefined ? formatRateBp(r.rateBp) : "—"}</td>
                <td className="num">{money(r.calculatedCents)}</td>
                <td className="num">{money(r.informedCents)}</td>
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
