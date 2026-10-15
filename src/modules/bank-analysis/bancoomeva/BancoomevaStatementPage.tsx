import { PageHeader } from "../../../components/ui";
import { TypedBankAccounting } from "../../financial-statements/bank/BankAccountingPanel";
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
      <PageHeader eyebrow="Extractos bancarios" title="Bancoomeva" description="Importa un extracto bancario en PDF para analizar sus movimientos." />

      <StatementFileCard
        state={state}
        details={state.status === "done" && <AccountDetails {...state.analysis.statement} />}
        picking={picking}
        busy={busy}
        exportedPath={exportedPath}
        onPick={() => void pick()}
      />

      {state.status === "done" && (
        <TypedBankAccounting
          statement={state.analysis.statement}
          closingBalanceCents={state.analysis.statement.totals.closingBalanceCents}
          openingBalanceCents={state.analysis.statement.totals.openingBalanceCents}
          groups={state.analysis.groups}
          fileName={state.fileName}
          onExport={exportExcel}
          exporting={exporting}
        >
          <BancoomevaValidationPanel statement={state.analysis.statement} validation={state.analysis.validation} />
          <DebitCreditSummaryCards summary={state.analysis.summary} finalBalanceCents={state.analysis.statement.totals.closingBalanceCents} />
          <BancoomevaGroupsTable groups={state.analysis.groups} />
        </TypedBankAccounting>
      )}
    </>
  );
}
