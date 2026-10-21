import { AlertTriangle, CheckCircle2, CircleDot, Landmark, MinusCircle, RefreshCcw, UsersRound, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { navigate } from "../../../app/router";
import { Alert, Badge, Button, Card, EmptyState, Loader, PageHeader, useToast } from "../../../components/ui";
import { exogenaService } from "../../../services/exogenaService";
import { errorMessage } from "../../../services/tauri";
import { reopenReadyBankFormats } from "../../financial-statements/bank/exogena/load";
import { bankExoPath } from "../../financial-statements/bank/exogena/paths";
import { BankExoStatusCard } from "../../financial-statements/bank/exogena/ui/BankExoAlerts";
import { Audit1011Gmf } from "../../financial-statements/bank/exogena/ui/BankExoAudit";
import { Audit1011, Audit2276, CoverageStrip } from "../../financial-statements/payroll/social/AuditViews";
import { NOMINA_PATH, PAYROLL_DEST_LABEL } from "../../financial-statements/payroll/social/alerts";
import { STATUS_LABEL, STATUS_TONE, type DestStatus } from "../../financial-statements/purchases/domain/status";
import { ExogenaContextBar } from "../components/ExogenaContextBar";
import { ProblemsPanel } from "../components/ProblemsPanel";
import { StatusPanel } from "../components/StatusPanel";
import { findFormat } from "../domain/formats";
import { PAYROLL_EXO_SOURCE, type PayrollExoFormat } from "../domain/payrollFormat";
import { shouldReopenPurchases } from "../domain/purchasesFormat";
import { useExogenaSelection } from "../state";
import { usePayrollFormat } from "../usePayrollFormat";

const DESCRIPTION: Record<PayrollExoFormat, string> = {
  "1011": "Cifras anuales de la declaración de renta, sin terceros: las de la nómina —salarios (8207), ICBF, CCF, SENA, pensión, cesantías y aportes a EPS y ARL— y el 50 % del GMF anual (8211) desde Extractos bancarios.",
  "2276": "Un registro anual por empleado con sus ingresos laborales y aportes. El nombre separado debe estar confirmado en la ficha del empleado y el domicilio es el de la empresa.",
};

const ICON: Record<DestStatus, typeof XCircle> = { block: XCircle, pending: CircleDot, review: AlertTriangle, ready: CheckCircle2, na: MinusCircle };

/**
 * Pantalla de 1011 y 2276. Los registros salen de Nómina y seguridad social (solo lectura): los pendientes se resuelven allá, en
 * Empleados, Empresas o Proveedores, y aquí se actualiza el formato. Nunca queda «listo» con pendientes o desactualizado, y no se
 * exporta hasta cubrir todos los meses del año.
 */
export default function PayrollFormatPage({ code }: { code: PayrollExoFormat }) {
  const toast = useToast();
  const [selection] = useExogenaSelection();
  const m = usePayrollFormat(selection.companyId, selection.year, code);
  const def = findFormat(code)!;
  const [syncing, setSyncing] = useState(false);
  const { format, state, overview } = m;

  useEffect(() => {
    if (state && shouldReopenPurchases(format.status.status, state.problems)) void format.setStatus("requiere_actualizacion");
  }, [format, state]);

  async function sync() {
    if (!m.company || !state || !overview) return;
    setSyncing(true);
    try {
      const outcome = await exogenaService.applySync({
        companyId: m.company.id,
        year: selection.year,
        formatCode: code,
        source: PAYROLL_EXO_SOURCE,
        proposals: state.proposals,
        removeMissing: true,
        summary: {
          sources: code === "1011" ? ["Nómina y seguridad social", "Extractos bancarios"] : ["Nómina y seguridad social"],
          planillas: overview.data.planillas.length,
          months: overview.data.coverage.filter((c) => c.state === "planilla").length,
          ...(code === "1011" ? { gmfRecords: m.bank.contribution?.proposals["1011"].length ?? 0 } : {}),
        },
      });
      await Promise.all([format.reload(), m.bank.reload()]);
      m.refresh();
      toast(`${outcome.created} nuevos · ${outcome.updated} actualizados · ${outcome.unchanged} sin cambios · ${outcome.removed} retirados.`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSyncing(false);
    }
  }

  const records = format.records;
  const status = overview?.status[code];
  const counts = overview?.counts[code];
  const Icon = status ? ICON[status] : CircleDot;

  return (
    <>
      <PageHeader
        eyebrow={`Información Exógena · ${selection.year}`}
        title={`${code} · ${def.name}`}
        description={DESCRIPTION[code]}
        actions={
          <>
            <Button icon={<UsersRound size={15} />} onClick={() => navigate(NOMINA_PATH)}>
              Abrir Nómina y seguridad social
            </Button>
            {code === "1011" && (
              <Button icon={<Landmark size={15} />} onClick={() => navigate(bankExoPath())}>
                Abrir Extractos bancarios
              </Button>
            )}
            <Button variant="primary" icon={<RefreshCcw size={15} />} loading={syncing} disabled={!m.ready} onClick={() => void sync()}>
              {code === "1011" ? "Actualizar desde Nómina y Bancos" : "Actualizar desde Nómina"}
            </Button>
          </>
        }
      />
      <ExogenaContextBar companies={m.companies} />
      {!selection.companyId || (m.companies && !m.company) ? (
        <Card>
          <EmptyState icon={<UsersRound size={20} />} title="Selecciona una empresa" description={`Elige la empresa y el año a informar para preparar el formato ${code}.`} />
        </Card>
      ) : !m.ready || !state || !records || !overview || !m.company ? (
        <Loader />
      ) : (
        <>
          {status && counts && (
            <Card>
              <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Icon size={18} aria-hidden />
                <strong>{PAYROLL_DEST_LABEL[code]}</strong>
                <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                <span className="muted">{counts.block} bloquean · {counts.pending} por confirmar · {counts.review} por revisar</span>
              </div>
            </Card>
          )}
          <CoverageStrip coverage={overview.data.coverage} year={selection.year} />
          <StatusPanel row={format.status} problems={state.problems} onSetStatus={format.setStatus} />
          {state.changes.length > 0 && (
            <Alert tone="warning" title="Hay cambios sin sincronizar">
              {code === "1011" ? "Nómina o Extractos bancarios cambió desde la última sincronización. Usa «Actualizar desde Nómina y Bancos»." : "Nómina cambió desde la última sincronización. Usa «Actualizar desde Nómina»."}
            </Alert>
          )}
          <ProblemsPanel problems={state.problems} okText={`Sin pendientes: el ${code} se puede marcar como listo.`} />
          {code === "1011" ? <Audit1011 form={overview.f1011} /> : <Audit2276 form={overview.f2276} />}
          {code === "1011" && m.bank.contribution && (
            <>
              <BankExoStatusCard
                result={m.bank.contribution.result}
                companyId={m.company.id}
                formats={["1011"]}
                title="Estado del GMF de Extractos bancarios (8211)"
                onChanged={async () => {
                  await m.bank.reload();
                  void reopenReadyBankFormats(m.company!.id, [selection.year]).catch(() => undefined);
                }}
              />
              <Audit1011Gmf audit={m.bank.contribution.result.audit.f1011} />
            </>
          )}
          <Card flush title={`Registros sincronizados (${records.length})`}>
            {records.length === 0 ? (
              <EmptyState icon={<UsersRound size={20} />} title="Aún no hay registros" description="Actualiza desde Nómina cuando no queden pendientes, o marca el formato «No aplica» con su justificación." />
            ) : (
              <div className="table-wrap table-wrap--scroll">
                <table className="table table--dense">
                  <thead>
                    <tr>
                      {def.columns!.filter((c) => code === "1011" || c.kind === "integer" || ["docTypeCode", "docNumber", "firstSurname", "secondSurname", "firstName", "otherNames"].includes(c.key)).map((c) => (
                        <th key={c.key} className={c.kind === "integer" ? "num" : undefined}>
                          {c.header}
                        </th>
                      ))}
                      <th>Origen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id}>
                        {def.columns!.filter((c) => code === "1011" || c.kind === "integer" || ["docTypeCode", "docNumber", "firstSurname", "secondSurname", "firstName", "otherNames"].includes(c.key)).map((c) => (
                          <td key={c.key} className={c.kind === "integer" ? "num" : undefined}>
                            {String(r.data[c.key] ?? "")}
                          </td>
                        ))}
                        <td className="muted">{r.originRef}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
