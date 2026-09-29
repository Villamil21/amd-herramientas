import { FileSpreadsheet } from "lucide-react";
import { Button, PageHeader } from "../../../components/ui";
import { DebitCreditSummaryCards } from "../shared/components/DebitCreditSummaryCards";
import { AccountDetails, StatementFileCard } from "../shared/components/StatementFileCard";
import { useStatementImport } from "../shared/useStatementImport";
import { CoopcentralGroupsTable } from "./components/CoopcentralGroupsTable";
import { CoopcentralValidationPanel } from "./components/CoopcentralValidationPanel";
import { analyzeCoopcentral, type CoopcentralAnalysis } from "./services/analysis";
import { exportCoopcentralExcel } from "./services/excelExport";

const exportAnalysis = (a: CoopcentralAnalysis, fileName: string) => exportCoopcentralExcel(a.statement, a.groups, fileName);

export default function CoopcentralStatementPage() {
  const { state, picking, busy, exporting, exportedPath, pick, exportExcel } = useStatementImport({
    analyze: analyzeCoopcentral,
    exportExcel: exportAnalysis,
    fallbackError: "No fue posible analizar el extracto. Verifica que sea un extracto de Coopcentral en PDF.",
    logTag: "coopcentral",
  });

  return (
    <>
      <PageHeader
        eyebrow="Extractos bancarios"
        title="Coopcentral"
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
          <CoopcentralValidationPanel statement={state.analysis.statement} validation={state.analysis.validation} />
          <DebitCreditSummaryCards summary={state.analysis.summary} />
          <CoopcentralGroupsTable groups={state.analysis.groups} />
        </>
      )}
    </>
  );
}
