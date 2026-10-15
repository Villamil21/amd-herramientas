import { useMemo } from "react";
import { navigate, paths } from "../../../../app/router";
import { Alert, Button, Card } from "../../../../components/ui";
import type { Company, Supplier } from "../../../../types/models";
import { formatInteger } from "../../../../utils/format";
import { SendToFs } from "../../shared/components/SendToFs";
import { buildPurchasesBatch, companyCheck, PROBLEM_TEXT, sendBlock } from "../services/accounting";
import type { Assignments, PucReport } from "../types";

interface Props {
  report: PucReport;
  pendingActions: number;
  companies: Company[];
  suppliers: Supplier[];
  assignments: Assignments;
  folderName: string;
  onDecide: (fileName: string, decision: "ignore" | "process") => void;
  onOpen: (fileName: string) => void;
  onExport: () => Promise<string | null | void>;
  exporting?: boolean;
}

/** Envío a Estados Financieros: empresa por NIT del adquiriente, alertas NIT / nombre y bloqueo por pendientes. */
export function PurchasesFsCard({ report, pendingActions, companies, suppliers, assignments, folderName, onDecide, onOpen, onExport, exporting }: Props) {
  const docs = useMemo(() => companyCheck(report, companies, assignments), [report, companies, assignments]);
  const blocked = sendBlock(pendingActions, docs);
  const problems = docs.filter((d) => d.problem);
  const sendable = docs.filter((d) => !d.problem && d.decision !== "ignore");
  const company = sendable[0]?.company;

  return (
    <Card title="Estados Financieros" description={company ? `Empresa (por NIT del adquiriente): ${company.razonSocial} — NIT ${company.nit} · ${formatInteger(sendable.length)} facturas para enviar` : "La empresa de cada factura se identifica por el NIT del adquiriente."}>
      <div className="stack">
        {pendingActions > 0 && <Alert tone="warning">{pendingActions === 1 ? "1 pendiente" : `${formatInteger(pendingActions)} pendientes`}: resuélvelos para enviar a Estados Financieros.</Alert>}
        {problems.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Factura</th>
                  <th>Alerta</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {problems.map((d) => (
                  <tr key={d.row.fileName} className="row-attention--blocking">
                    <td>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => onOpen(d.row.fileName)}>
                        {d.row.number ?? d.row.fileName}
                      </button>
                      <div className="table__secondary">{d.row.issuerName}</div>
                    </td>
                    <td>{PROBLEM_TEXT[d.problem!](d)}</td>
                    <td className="actions">
                      {d.problem === "name-mismatch" && (
                        <div className="row">
                          <Button size="sm" onClick={() => onDecide(d.row.fileName, "ignore")}>
                            Ignorar factura
                          </Button>
                          <Button size="sm" variant="primary" onClick={() => onDecide(d.row.fileName, "process")}>
                            Procesar de todas formas
                          </Button>
                        </div>
                      )}
                      {d.problem === "unknown-company" && (
                        <Button size="sm" onClick={() => navigate(paths.companies)}>
                          Ir a Empresas
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {docs.some((d) => d.decision === "ignore") && <span className="field__hint">{formatInteger(docs.filter((d) => d.decision === "ignore").length)} facturas ignoradas por diferencia de nombre: no se envían (la decisión queda registrada).</span>}
        <SendToFs blocked={blocked} build={() => buildPurchasesBatch(docs, suppliers, folderName)} onExport={onExport} exporting={exporting} duplicateTitle="Algunas facturas ya fueron enviadas." />
      </div>
    </Card>
  );
}
