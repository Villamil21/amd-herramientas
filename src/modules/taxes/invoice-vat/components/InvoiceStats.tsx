import { formatInteger } from "../../../../utils/format";
import { Stat } from "../../../bank-analysis/shared/components/Stat";
import type { InvoiceReport } from "../types";
import type { InvoiceFilter } from "./InvoicesTable";

/** Conciliación del lote. Las tarjetas con filtro llevan a la tabla de documentos. */
export function InvoiceStats({ stats, filter, onFilter }: { stats: InvoiceReport["stats"]; filter: InvoiceFilter; onFilter: (f: InvoiceFilter) => void }) {
  const link = (f: InvoiceFilter) => ({ onClick: () => onFilter(f), active: filter === f, title: "Ver en la tabla de documentos" });
  return (
    <div className="stat-row">
      <Stat label="PDF encontrados" value={formatInteger(stats.files)} {...link("all")} active={false} />
      <Stat label="Pendientes" value={formatInteger(stats.pending)} tone={stats.pending ? "negative" : undefined} {...link("pending")} />
      <Stat label="Validados" value={formatInteger(stats.validated)} tone={stats.validated ? "positive" : undefined} {...link("validated")} />
      <Stat label="Facturas" value={formatInteger(stats.invoices)} {...link("invoice")} />
      <Stat label="Notas crédito" value={formatInteger(stats.notes)} {...link("credit_note")} />
      <Stat label="Excluidos" value={formatInteger(stats.excluded)} />
      <Stat label="Proveedores" value={formatInteger(stats.suppliers)} />
    </div>
  );
}
