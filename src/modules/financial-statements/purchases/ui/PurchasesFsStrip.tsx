import { useEffect, useRef } from "react";
import { ShoppingBag } from "lucide-react";
import { navigate, paths } from "../../../../app/router";
import { Button, Card } from "../../../../components/ui";
import { nitDigits } from "../../../exogena/domain/text";
import { usePurchasesSelection } from "../selection";
import { usePurchasesData } from "../usePurchasesData";
import { StatusStrip } from "./StatusStrip";

function YearStrip({ nit, year, onSynced }: { nit: string; year: number; onSynced?: () => void }) {
  const data = usePurchasesData({ buyerNit: nit, year });
  const [, select] = usePurchasesSelection();
  const { model, sync } = data;
  const last = useRef(0);
  useEffect(() => {
    if (sync.sent !== last.current) {
      last.current = sync.sent;
      if (sync.sent > 0) onSynced?.();
    }
  }, [sync.sent, onSynced]);
  if (!model || model.docs.length === 0) return null;
  return (
    <Card
      title={`Compras, costos y exógena · ${year}`}
      description="Las facturas sin clasificar no llegan a Estados Financieros hasta confirmarse."
      actions={
        <Button
          size="sm"
          icon={<ShoppingBag size={14} />}
          onClick={() => {
            select({ buyerNit: nit, year });
            navigate(paths.submodule("estados-financieros", "codigos-puc-por-factura"));
          }}
        >
          Abrir Compras
        </Button>
      }
    >
      <StatusStrip counts={model.counts} status={model.status} notApplicable={model.notApplicable} dests={["EEFF"]} />
    </Card>
  );
}

/** Franja de estado de Compras, costos y exógena para el rango del Generador (un bloque por año con facturas). */
export function PurchasesFsStrip({ nit, start, end, onSynced }: { nit: string; start: string; end: string; onSynced?: () => void }) {
  const digits = nitDigits(nit);
  const years: number[] = [];
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)) && years.length < 6; y++) years.push(y);
  return (
    <>
      {years.map((y) => (
        <YearStrip key={y} nit={digits} year={y} onSynced={onSynced} />
      ))}
    </>
  );
}
