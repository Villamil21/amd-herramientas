import { useMemo, useState } from "react";
import { Eraser } from "lucide-react";
import { Button, Card, Field, PageHeader } from "../../../components/ui";
import { ContributionsTable, ROUNDING_NOTE } from "./components/ContributionsTable";
import { MoneyInput } from "./components/MoneyInput";
import { calculateContributions, defaultSelection, DEPENDENT_LINES } from "./services/contributions";

/** Calculadora de aportes para Dependientes: IBC escrito × porcentaje de cada concepto. Nada se guarda. */
export default function DependentContributionsPage() {
  const [ibc, setIbc] = useState<number | null>(null);
  const [selection, setSelection] = useState(() => defaultSelection(DEPENDENT_LINES));
  const result = useMemo(() => calculateContributions(ibc, DEPENDENT_LINES, selection), [ibc, selection]);

  const clear = () => {
    setIbc(null);
    setSelection(defaultSelection(DEPENDENT_LINES));
  };

  return (
    <>
      <PageHeader
        eyebrow="Calculadoras"
        title="Calculadora de aportes para Dependientes"
        actions={
          <Button variant="ghost" icon={<Eraser size={15} />} onClick={clear}>
            Limpiar
          </Button>
        }
      />
      <Card flush className="calc">
        <div className="calc__inputs">
          <Field label="Salario mensual o ingreso base cotización (IBC)">
            {(id) => <MoneyInput id={id} className="calc__money" value={ibc} onChange={setIbc} autoFocus />}
          </Field>
        </div>
        <ContributionsTable lines={DEPENDENT_LINES} selection={selection} onSelect={(line, option) => setSelection((s) => ({ ...s, [line]: option }))} result={result} />
        <p className="calc__note muted">{ROUNDING_NOTE}</p>
      </Card>
    </>
  );
}
