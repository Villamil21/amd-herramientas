import { FileSpreadsheet } from "lucide-react";
import { Button, PageHeader } from "../../../components/ui";
import type { GroupLabels } from "../shared/components/groupLabels";
import { GroupsTable } from "../shared/components/GroupsTable";
import { AccountDetails, StatementFileCard } from "../shared/components/StatementFileCard";
import { SummaryCards } from "../shared/components/SummaryCards";
import { ValidationPanel } from "../shared/components/ValidationPanel";
import { useStatementImport } from "../shared/useStatementImport";
import { analyzeDavivienda, type DaviviendaAnalysis } from "./services/analysis";
import { exportDaviviendaExcel } from "./services/excelExport";

const LABELS: GroupLabels = {
  description: "Clase de Movimiento",
  searchPlaceholder: "Buscar clase de movimiento...",
  tableDescription: "Agrupados por clase de movimiento exacta y signo del valor. Haz clic en un grupo para ver sus movimientos.",
  branch: "Oficina",
  document: "Doc.",
  sortableType: true,
};

const VALIDATED = "Los movimientos coinciden con Más Créditos y Menos Débitos, y Saldo Anterior + neto coincide con el Nuevo Saldo.";

const exportAnalysis = (a: DaviviendaAnalysis, fileName: string) => exportDaviviendaExcel(a.statement, a.groups, fileName);

export default function DaviviendaStatementPage() {
  const { state, picking, busy, exporting, exportedPath, pick, exportExcel } = useStatementImport({
    analyze: analyzeDavivienda,
    exportExcel: exportAnalysis,
    fallbackError: "No fue posible analizar el extracto. Verifica que sea un extracto de Davivienda en PDF.",
    logTag: "davivienda",
  });

  return (
    <>
      <PageHeader
        eyebrow="Extractos bancarios"
        title="Davivienda"
        description="Importa un extracto bancario en PDF para analizar sus movimientos."
        actions={
          state.status === "done" && (
            <Button variant="primary" icon={<FileSpreadsheet size={15} />} onClick={() => void exportExcel()} loading={exporting}>
              Exportar Excel
            </Button>
          )
        }
      />

      <StatementFileCard
        state={state}
        details={state.status === "done" && <AccountDetails {...state.analysis.statement} />}
        picking={picking}
        busy={busy}
        exportedPath={exportedPath}
        onPick={() => void pick()}
      />

      {state.status === "done" && (
        <>
          <ValidationPanel statement={state.analysis.statement} validation={state.analysis.validation} validatedMessage={VALIDATED} />
          <SummaryCards summary={state.analysis.summary} finalBalanceCents={state.analysis.statement.totals.currentBalanceCents} />
          <GroupsTable groups={state.analysis.groups} labels={LABELS} />
        </>
      )}
    </>
  );
}
