import { formatInteger } from "../../../../utils/format";
import { Stat } from "../../../bank-analysis/shared/components/Stat";
import type { InvoiceReport } from "../types";

export function InvoiceStats({ stats }: { stats: InvoiceReport["stats"] }) {
  return (
    <div className="stat-row">
      <Stat label="PDF encontrados" value={formatInteger(stats.files)} />
      <Stat label="Procesados correctamente" value={formatInteger(stats.processed)} tone={stats.processed ? "positive" : undefined} />
      <Stat label="Por revisar" value={formatInteger(stats.review)} />
      <Stat label="No procesados" value={formatInteger(stats.failed)} tone={stats.failed ? "negative" : undefined} />
      <Stat label="Proveedores" value={formatInteger(stats.suppliers)} />
      <Stat label="Proveedores nuevos" value={formatInteger(stats.newSuppliers)} />
      <Stat label="Tipos de documento" value={formatInteger(stats.documentTypes)} />
    </div>
  );
}
