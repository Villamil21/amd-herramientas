import { PageHeader } from "../../../components/ui";
import { TypedBankAccounting } from "../../financial-statements/bank/BankAccountingPanel";
import { BbvaGroupDetailModal } from "./components/BbvaGroupDetailModal";
import { AccountDetails, StatementFileActions, StatementFileCard } from "../shared/components/StatementFileCard";
import { useStatementImport } from "../shared/useStatementImport";
import { BbvaValidationPanel } from "./components/BbvaValidationPanel";
import { BBVA_TYPE_LABEL } from "./types";
import { analyzeBbva, type BbvaAnalysis } from "./services/analysis";
import { exportBbvaExcel } from "./services/excelExport";

const exportAnalysis = (a: BbvaAnalysis, fileName: string) => exportBbvaExcel(a.statement, a.groups, fileName);

export default function BbvaStatementPage() {
  const { state, picking, busy, exporting, exportedPath, pick, exportExcel } = useStatementImport({
    analyze: analyzeBbva,
    exportExcel: exportAnalysis,
    fallbackError: "No fue posible analizar el extracto. Verifica que sea un extracto de BBVA en PDF.",
    logTag: "bbva",
  });

  return (
    <>
      <PageHeader eyebrow="Extractos bancarios" title="BBVA" description="Importa un extracto bancario en PDF para analizar sus movimientos." />

      <StatementFileCard
        hideWhenDone
        state={state}
        details={
          state.status === "done" && (
            <>
              <AccountDetails {...state.analysis.statement} />
              {state.analysis.statement.clientName && <span>· {state.analysis.statement.clientName}</span>}
            </>
          )
        }
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
          typeLabels={{ C: BBVA_TYPE_LABEL.credit, D: BBVA_TYPE_LABEL.debit }}
          fileDetail={state.analysis.statement.clientName}
          validated={state.analysis.validation.validated}
          validation={<BbvaValidationPanel statement={state.analysis.statement} validation={state.analysis.validation} />}
          fileActions={<StatementFileActions picking={picking} busy={busy} exportedPath={exportedPath} onPick={() => void pick()} />}
          renderDetail={(key, close) => <BbvaGroupDetailModal group={state.analysis.groups.find((g) => g.key === key) ?? null} onClose={close} />}
        />
      )}
    </>
  );
}
