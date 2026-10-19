import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, Input } from "../../../../components/ui";
import type { RetentionPick } from "../../../../types/purchases";
import type { WithholdingRate } from "../../../../types/models";
import { formatDateForDisplay } from "../../../../utils/dates";
import { formatMoneyCents } from "../../../../utils/format";
import { formatRateBp } from "../../../taxes/withholding/services/money";
import { addRetention, chosenRates, removeRetention, searchRates, type RetentionPreview } from "../domain/lineDraft";

interface Props {
  /** Todos los conceptos de la Tabla de retenciones. */
  rates: readonly WithholdingRate[];
  picks: readonly RetentionPick[];
  onChange: (picks: RetentionPick[]) => void;
  /** Base, cuantía mínima, tarifa vigente y valor de un concepto sobre esta línea. */
  preview: (rate: WithholdingRate) => RetentionPreview;
  /** Conceptos que vienen sugeridos (regla del proveedor o del producto) y aún no se confirman. */
  suggested?: readonly number[];
}

/**
 * Retenciones de una línea: solo las elegidas (sugeridas o ya asignadas) se ven como etiquetas removibles con su cálculo; el resto
 * de la tabla queda detrás de un selector buscable («Añadir otra retención»). Se puede asignar varias, o ninguna.
 */
export function RetentionPicker({ rates, picks, onChange, preview, suggested = [] }: Props) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const chosen = chosenRates(rates, picks);
  const open = adding || picks.length === 0;
  const matches = open ? searchRates(rates, picks, query) : [];

  const add = (rateId: number) => {
    onChange(addRetention(picks, rateId));
    setQuery("");
    setAdding(false);
  };

  return (
    <div className="stack retention-picker" style={{ gap: 8 }}>
      {chosen.length === 0 && <div className="field__hint">Sin retención: la línea se confirma sin conceptos de retención.</div>}
      {chosen.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }} aria-label="Retenciones elegidas">
          {chosen.map(({ rate, rateId }) => (
            <span key={rateId} className="badge badge--info retention-tag" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {rate?.name ?? `Concepto #${rateId} (ya no existe)`}
              {suggested.includes(rateId) && <em>sugerida</em>}
              <button type="button" className="icon-button" aria-label={`Quitar ${rate?.name ?? rateId}`} onClick={() => onChange(removeRetention(picks, rateId))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {chosen.some((c) => c.rate) && (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th>Concepto</th>
                <th className="num">Base</th>
                <th className="num">Cuantía mínima</th>
                <th className="num">% vigente</th>
                <th>Vigencia</th>
                <th className="num">Valor calculado</th>
              </tr>
            </thead>
            <tbody>
              {chosen.flatMap(({ rate }) => {
                if (!rate) return [];
                const p = preview(rate);
                return [
                  <tr key={rate.id}>
                    <td>{rate.name}</td>
                    <td className="num">{formatMoneyCents(p.baseCents)}</td>
                    <td className="num">{p.missingUvt ? "Sin UVT del año" : formatMoneyCents(p.minCents)}</td>
                    <td className="num">{formatRateBp(p.rateBp, true)}</td>
                    <td>{p.appliedFrom ? `Desde ${formatDateForDisplay(p.appliedFrom)}` : "Regla base de la tabla"}</td>
                    <td className="num">
                      {formatMoneyCents(p.valueCents)}
                      {p.invoiceLevel && !p.belowMinimum && (
                        <div className="field__hint">Retención común de la factura: {formatMoneyCents(p.invoiceValueCents)} sobre el subtotal {formatMoneyCents(p.conceptBaseCents)}, contada una sola vez; esta línea participa con su parte.</div>
                      )}
                      {p.belowMinimum && !p.missingUvt && <div className="field__hint">No supera la cuantía mínima ({formatMoneyCents(p.conceptBaseCents)} en la factura)</div>}
                    </td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {!open && (
        <div>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
            Añadir otra retención
          </Button>
        </div>
      )}
      {open && (
        <div className="stack" style={{ gap: 4 }}>
          <Input autoFocus={adding} placeholder="Buscar concepto de retención…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar concepto de retención" />
          {rates.length === 0 && <div className="field__hint">No hay conceptos en la Tabla de retenciones.</div>}
          {rates.length > 0 && matches.length === 0 && <div className="field__hint">Ningún concepto coincide{query ? ` con «${query}»` : ""}.</div>}
          <div role="listbox" aria-label="Conceptos disponibles" style={{ maxHeight: 160, overflowY: "auto" }}>
            {matches.map((r) => (
              <button key={r.id} type="button" role="option" aria-selected={false} className="menu__item" style={{ display: "block", width: "100%", textAlign: "left" }} onClick={() => add(r.id)}>
                {r.name}
              </button>
            ))}
          </div>
          {adding && picks.length > 0 && (
            <div>
              <Button size="sm" onClick={() => setAdding(false)}>
                Cancelar
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
