import { useCallback, useState } from "react";
import { PayrollFlow } from "./PayrollFlow";
import { NominaStatus } from "./social/NominaStatus";
import { PLANILLA_IMPORT } from "./social/operator";

/**
 * Nómina y seguridad social: una sola importación de planilla PDF para cualquier operador (se detecta del PDF) y, debajo,
 * la cobertura anual y el estado de Estados Financieros, 1001, 1011 y 2276.
 */
export default function NominaPage() {
  const [context, setContext] = useState<{ companyId: number | null; year: number | null }>({ companyId: null, year: null });
  const [refreshKey, setRefreshKey] = useState(0);
  const onSent = useCallback(() => setRefreshKey((k) => k + 1), []);
  return (
    <>
      <PayrollFlow operator={PLANILLA_IMPORT} onContext={setContext} onSent={onSent} />
      <NominaStatus context={context} refreshKey={refreshKey} />
    </>
  );
}
