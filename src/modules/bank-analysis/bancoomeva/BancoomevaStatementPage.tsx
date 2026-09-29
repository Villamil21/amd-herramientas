import { FileSpreadsheet } from "lucide-react";
import { Button, PageHeader } from "../../../components/ui";
import { DebitCreditSummaryCards } from "../shared/components/DebitCreditSummaryCards";
import { AccountDetails, StatementFileCard } from "../shared/components/StatementFileCard";
import { useStatementImport } from "../shared/useStatementImport";
import { BancoomevaGroupsTable } from "./components/BancoomevaGroupsTable";
import { BancoomevaValidationPanel } from "./components/BancoomevaValidationPanel";
import { analyzeBancoomeva, type BancoomevaAnalysis } from "./services/analysis";
import { exportBancoomevaExcel } from "./services/excelExport";

const exportAnalysis = (a: BancoomevaAnalysis, fileName: string) => exportBancoomevaExcel(a.statement, a.groups, fileName);

export default function BancoomevaStatementPage() {
  const { state, picking, busy, exporting, exportedPath, pick, exportExcel } = useStatementImport({
    analyze: analyzeBancoomeva,
    exportExcel: exportAnalysis,
    fallbackError: "No fue posible analizar el extracto. Verifica que sea un extracto de Bancoomeva en PDF.",
    logTag: "bancoomeva",
  });

  return (
    <>
      <PageHeader
        eyebrow="Extractos bancarios"
        title="Bancoomeva"
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
          <BancoomevaValidationPanel statement={state.analysis.statement} validation={state.analysis.validation} />
          <DebitCreditSummaryCards summary={state.analysis.summary} />
          <BancoomevaGroupsTable groups={state.analysis.groups} />
        </>
      )}
    </>
  );
}
