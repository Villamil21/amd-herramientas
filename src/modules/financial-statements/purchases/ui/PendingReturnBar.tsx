import { ArrowLeft, X } from "lucide-react";
import { navigate, paths, useRoute } from "../../../../app/router";
import { Button } from "../../../../components/ui";
import { DEST_LABEL } from "../domain/status";
import { patchPendingReturn, setPendingReturn, usePendingReturn } from "../pendingReturn";
import { setPurchasesSelection } from "../selection";

export const PURCHASES_PATH = paths.submodule("estados-financieros", "codigos-puc-por-factura");

/**
 * Franja de regreso: aparece fuera de Compras mientras el usuario resuelve en otro módulo (Empresas, Catálogos…) un pendiente que
 * abrió desde el panel. «Volver a pendientes» restablece empresa, año, destino y la posición del panel.
 */
export function PendingReturnBar() {
  const ctx = usePendingReturn();
  const route = useRoute();
  if (!ctx || `/${route.join("/")}` === PURCHASES_PATH) return null;
  return (
    <div className="pending-return" role="region" aria-label="Regreso a pendientes de Compras">
      <span>
        Resolviendo un pendiente de <strong>{DEST_LABEL[ctx.dest]}</strong> · {ctx.companyName} · {ctx.year ?? "Sin fecha"}
      </span>
      <span className="pending-return__actions">
        <Button
          size="sm"
          variant="primary"
          icon={<ArrowLeft size={14} />}
          onClick={() => {
            setPurchasesSelection({ buyerNit: ctx.buyerNit, year: ctx.year });
            patchPendingReturn({ returning: true });
            navigate(PURCHASES_PATH);
          }}
        >
          Volver a pendientes
        </Button>
        <Button size="sm" icon={<X size={14} />} onClick={() => setPendingReturn(null)} aria-label="Descartar el regreso a pendientes">
          Descartar
        </Button>
      </span>
    </div>
  );
}
