import { navigate, paths } from "../../../../app/router";
import { Button, Card } from "../../../../components/ui";
import { formatInteger } from "../../../../utils/format";
import { type DocCompany, PROBLEM_TEXT } from "../services/accounting";

interface Props {
  docs: DocCompany[];
  onDecide: (fileName: string, decision: "ignore" | "process") => void;
  onOpen: (fileName: string) => void;
}

/**
 * Alertas de empresa del envío a Estados Financieros (NIT del adquiriente
 * desconocido, nombre distinto…), junto al estado y las acciones de EEFF. La
 * empresa y la cantidad de documentos están en la cabecera; sin alertas ni
 * decisiones no se muestra nada.
 */
export function PurchasesFsCard({ docs, onDecide, onOpen }: Props) {
  const problems = docs.filter((d) => d.problem);
  const ignored = docs.filter((d) => d.decision === "ignore").length;
  if (problems.length === 0 && ignored === 0) return null;

  return (
    <Card flush title="Alertas de empresa" description="La empresa de cada factura se identifica por el NIT del adquiriente.">
      <div className="stack stack--sm">
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
        {ignored > 0 && (
          <span className="field__hint" style={{ padding: "0 var(--space-5) var(--space-3)" }}>
            {formatInteger(ignored)} facturas ignoradas por diferencia de nombre: no se envían (la decisión queda registrada).
          </span>
        )}
      </div>
    </Card>
  );
}
