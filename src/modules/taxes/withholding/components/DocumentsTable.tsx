import { useMemo, useState } from "react";
import { AlertTriangle, XCircle } from "lucide-react";
import { Badge, Button, Card } from "../../../../components/ui";
import { TITLE_CATEGORY_LABEL } from "../../../../types/models";
import { normalizeKey } from "../../../../utils/text";
import { SearchBox, SegmentedFilter } from "../../../bank-analysis/shared/components/tableControls";
import { formatCop } from "../../invoice-vat/parser/amounts";
import { ignoredGroup, rateText, ruleSubtypeText, ruleTypeText } from "../services/labels";
import { formatDate } from "../services/money";
import type { PendingAction } from "../services/pending";
import type { DocRow } from "../types";
import { StatusBadge } from "./StatusBadge";

export type DocFilter = "all" | "pending" | "validated" | "below" | "ignored" | "invoice" | "credit_note";

const FILTERS: { id: DocFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "pending", label: "Pendientes" },
  { id: "validated", label: "Validados" },
  { id: "below", label: "No aplica por tope" },
  { id: "ignored", label: "Ignorados" },
  { id: "invoice", label: "Facturas" },
  { id: "credit_note", label: "Notas" },
];

function matches(r: DocRow, f: DocFilter, attention: Map<string, PendingAction>): boolean {
  switch (f) {
    case "pending":
      return attention.has(r.fileName);
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

interface Props {
  rows: DocRow[];
  /** Pendiente más grave de cada archivo (services/pending). */
  attention: Map<string, PendingAction>;
  filter: DocFilter;
  onFilterChange: (f: DocFilter) => void;
  onOpen: (r: DocRow) => void;
  onAction: (a: PendingAction) => void;
}

/** Ancla para llevar la vista a la tabla (contadores y «Ver pendientes»). */
export const DOCUMENTS_ANCHOR = "withholding-documents";

export function DocumentsTable({ rows, attention, filter, onFilterChange, onOpen, onAction }: Props) {
  const [query, setQuery] = useState("");
  const pendingCount = rows.filter((r) => attention.has(r.fileName)).length;
  const options = FILTERS.map((f) => (f.id === "pending" && pendingCount ? { ...f, label: `Pendientes (${pendingCount})` } : f));

  const visible = useMemo(() => {
    const q = normalizeKey(query);
    return rows.filter((r) => matches(r, filter, attention) && (!q || normalizeKey([r.fileName, r.number, r.nit, r.supplierName].filter(Boolean).join(" ")).includes(q)));
  }, [rows, query, filter, attention]);

  return (
    <Card id={DOCUMENTS_ANCHOR} flush title="Documentos" description="Haz clic en un documento para ver sus datos, la configuración de retención, los productos y las validaciones.">
      <div className="toolbar row--between">
        <SegmentedFilter label="Filtrar documentos" options={options} value={filter} onChange={onFilterChange} />
        <SearchBox placeholder="Archivo, número, NIT o proveedor" value={query} onChange={setQuery} />
      </div>
      <div className="table-wrap table-wrap--scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Archivo</th>
              <th>Estado</th>
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
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={17} className="muted" style={{ textAlign: "center", padding: "var(--space-6)" }}>
                  {filter === "pending" ? "No hay documentos pendientes." : "Ningún documento coincide con el filtro."}
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const a = attention.get(r.fileName);
              const Icon = a?.severity === "blocking" ? XCircle : AlertTriangle;
              return (
                <tr key={r.fileName} className={["is-clickable", a && `row-attention row-attention--${a.severity}`].filter(Boolean).join(" ")} onClick={() => onOpen(r)}>
                  <td className="table__primary" style={{ minWidth: 200, maxWidth: 280, overflowWrap: "break-word" }}>
                    {a && <Icon size={14} className="row-attention__icon" aria-label={a.severity === "blocking" ? "Pendiente bloqueante" : "Advertencia"} />}
                    {r.fileName}
                  </td>
                  <td>
                    <span className="row" style={{ flexWrap: "nowrap" }}>
                      <StatusBadge status={r.status} />
                      {a && (
                        <Button
                          size="sm"
                          variant={a.severity === "blocking" ? "primary" : "secondary"}
                          onClick={(e) => {
                            e.stopPropagation();
                            onAction(a);
                          }}
                        >
                          {a.actionLabel}
                        </Button>
                      )}
                    </span>
                  </td>
                  <td>{r.category ? <Badge tone={r.category === "credit_note" ? "gold" : "dark"}>{TITLE_CATEGORY_LABEL[r.category]}</Badge> : "—"}</td>
                  <td style={{ minWidth: 160 }}>{r.title ?? "—"}</td>
                  <td className="selectable" style={{ whiteSpace: "nowrap" }}>{r.number ?? "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatDate(r.issueDate)}</td>
                  <td className="selectable">{r.nit ?? "—"}</td>
                  <td style={{ minWidth: 160 }}>{r.supplierName || "—"}</td>
                  <td>{r.personType ?? "—"}</td>
                  <td className="selectable" style={{ whiteSpace: "nowrap" }}>{r.fiscalCodes.join(";") || "—"}</td>
                  <td>{ruleTypeText(r) ?? "—"}</td>
                  <td style={{ minWidth: 180 }}>{ruleSubtypeText(r) ?? "—"}</td>
                  <td className="num">{money(r.baseCents)}</td>
                  <td className="num">{money(r.minBaseCents)}</td>
                  <td className="num">{rateText(r) ?? "—"}</td>
                  <td className="num">{money(r.calculatedCents)}</td>
                  <td className="num">{money(r.informedCents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
