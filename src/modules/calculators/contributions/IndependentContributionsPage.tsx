import { useEffect, useMemo, useState } from "react";
import { Eraser, Settings2 } from "lucide-react";
import { navigate, paths } from "../../../app/router";
import { Alert, Button, Card, Field, Loader, PageHeader, Select } from "../../../components/ui";
import { useAsync } from "../../../hooks/useAsync";
import { minimumWageService } from "../../../services/minimumWageService";
import { ContributionsTable, ROUNDING_NOTE } from "./components/ContributionsTable";
import { MoneyInput } from "./components/MoneyInput";
import { calculateContributions, defaultSelection, formatCalcPesos, independentIbc, INDEPENDENT_LINES } from "./services/contributions";

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Calculadora de aportes para Independientes: IBC = MAX(ingresos × 40 %,
 * SMMLV del año), con el SMMLV de Datos → SMMLV por año. Nada se guarda.
 */
export default function IndependentContributionsPage() {
  const wages = useAsync(() => minimumWageService.list(), []);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [income, setIncome] = useState<number | null>(null);
  const [selection, setSelection] = useState(() => defaultSelection(INDEPENDENT_LINES));

  // Años configurados y, aunque falte, el año en curso (así se nota si aún no se registró su SMMLV).
  const years = useMemo(() => [...new Set([...(wages.data ?? []).map((w) => w.year), CURRENT_YEAR])].sort((a, b) => a - b), [wages.data]);
  // Si el año en curso no está configurado y hay un solo año registrado (ej. 2026), se usa ese.
  useEffect(() => {
    const list = wages.data ?? [];
    if (list.length === 1 && list[0].year !== CURRENT_YEAR) setYear(list[0].year);
  }, [wages.data]);

  const wage = wages.data?.find((w) => w.year === year);
  const ibc = useMemo(() => independentIbc(income, wage?.valuePesos), [income, wage]);
  const result = useMemo(
    () => (ibc.status === "missing-wage" || (!wage && ibc.status === "empty") ? null : calculateContributions(ibc.status === "ok" ? ibc.ibcPesos : 0, INDEPENDENT_LINES, selection)),
    [ibc, wage, selection],
  );

  const clear = () => {
    setIncome(null);
    setSelection(defaultSelection(INDEPENDENT_LINES));
  };

  return (
    <>
      <PageHeader
        eyebrow="Calculadoras"
        title="Calculadora de aportes para Independientes"
        actions={
          <Button variant="ghost" icon={<Eraser size={15} />} onClick={clear}>
            Limpiar
          </Button>
        }
      />
      {wages.error && <Alert tone="danger">{wages.error}</Alert>}
      {wages.loading && !wages.data ? (
        <Loader />
      ) : (
        <Card flush className="calc">
          <div className="calc__inputs calc__inputs--split">
            <Field label="Año">
              {(id) => (
                <Select id={id} value={year} onChange={(e) => setYear(Number(e.target.value))}>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Ingresos mensuales o valor mensual del contrato">
              {(id) => <MoneyInput id={id} className="calc__money" value={income} onChange={setIncome} autoFocus />}
            </Field>
          </div>

          {!wage ? (
            <div className="calc__alert">
              <Alert tone="warning" title="SMMLV no configurado para este año.">
                <div className="row row--between">
                  <span>Registra el SMMLV de {year} para calcular el IBC y los aportes.</span>
                  <Button size="sm" icon={<Settings2 size={14} />} onClick={() => navigate(paths.minimumWages)}>
                    Configurar SMMLV
                  </Button>
                </div>
              </Alert>
            </div>
          ) : (
            <dl className="calc__ibc">
              <div>
                <dt>40 % de los ingresos</dt>
                <dd>{formatCalcPesos(ibc.status === "ok" ? ibc.fortyPercentPesos : 0)}</dd>
              </div>
              <div>
                <dt>SMMLV {year}</dt>
                <dd>{formatCalcPesos(wage.valuePesos)}</dd>
              </div>
              <div className="calc__ibc-total">
                <dt>
                  Ingreso base cotización (IBC)
                  {ibc.status === "ok" && <span className="muted">{ibc.usesMinimumWage ? "Se usa el SMMLV: el 40 % de los ingresos es menor." : "Se usa el 40 % de los ingresos."}</span>}
                </dt>
                <dd>{formatCalcPesos(ibc.status === "ok" ? ibc.ibcPesos : 0)}</dd>
              </div>
            </dl>
          )}

          <ContributionsTable lines={INDEPENDENT_LINES} selection={selection} onSelect={(line, option) => setSelection((s) => ({ ...s, [line]: option }))} result={result} />
          <p className="calc__note muted">{ROUNDING_NOTE}</p>
        </Card>
      )}
    </>
  );
}
