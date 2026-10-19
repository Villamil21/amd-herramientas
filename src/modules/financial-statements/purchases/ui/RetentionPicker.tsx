import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Input } from "../../../../components/ui";
import type { RateVersion, RetentionPick } from "../../../../types/purchases";
import type { UvtValue, WithholdingRate } from "../../../../types/models";
import { formatDateForDisplay } from "../../../../utils/dates";
import { formatMoneyCents } from "../../../../utils/format";
import { formatRateBp } from "../../../taxes/withholding/services/money";
import { addRetention, chosenRates, moveActive, removeRetention, retentionOptions, type RetentionOption, type RetentionPreview } from "../domain/lineDraft";

interface Props {
  /** Todos los conceptos de la Tabla de retenciones. */
  rates: readonly WithholdingRate[];
  picks: readonly RetentionPick[];
  /** Vigencias de tarifa y UVT: las opciones muestran lo que rige en la fecha de la factura. */
  versions: readonly RateVersion[];
  uvts: readonly UvtValue[];
  /** Fecha de expedición de la factura. */
  date: string | null | undefined;
  onChange: (picks: RetentionPick[]) => void;
  /** Base, cuantía mínima, tarifa vigente y valor de un concepto sobre esta línea. */
  preview: (rate: WithholdingRate) => RetentionPreview;
  /** Conceptos que vienen sugeridos (regla del proveedor o del producto) y aún no se confirman. */
  suggested?: readonly number[];
  /** Lista abierta al montar (pruebas). */
  defaultOpen?: boolean;
}

/**
 * Retenciones de una línea. Las elegidas se ven como etiquetas removibles con su cálculo. Para añadir otras hay un selector
 * desplegable con búsqueda (combobox de selección múltiple): al abrirlo muestra la Tabla de retenciones completa agrupada por tipo,
 * con desplazamiento propio; escribir filtra por nombre, tipo o porcentaje (sin mayúsculas, tildes ni espacios) y lo ya elegido no
 * se ofrece. Teclado: ↓ ↑ recorren, Enter elige, Esc cierra. Se puede asignar varias o ninguna.
 */
export function RetentionPicker({ rates, picks, versions, uvts, date, onChange, preview, suggested = [], defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const chosen = chosenRates(rates, picks);
  const groups = useMemo(() => retentionOptions(rates, picks, versions, date, uvts, query), [rates, picks, versions, date, uvts, query]);
  const flat = groups.flatMap((g) => g.options);
  const activeIndex = flat.length ? Math.min(active, flat.length - 1) : -1;
  const optionId = (rateId: number) => `${listId}-opt-${rateId}`;
  const activeOption = activeIndex >= 0 ? flat[activeIndex] : undefined;

  useEffect(() => {
    if (open && activeOption) document.getElementById(optionId(activeOption.rate.id))?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeOption?.rate.id]);

  // La lista queda abierta al elegir: se pueden marcar varias seguidas. Lo elegido sale de las opciones.
  const add = (rateId: number) => {
    onChange(addRetention(picks, rateId));
    setQuery("");
    input.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && open) {
      // Cierra solo la lista, no el panel de clasificación que la contiene.
      e.preventDefault();
      e.nativeEvent.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive(moveActive(activeIndex, e.key, flat.length));
    } else if (e.key === "Enter" && open && activeOption) {
      e.preventDefault();
      add(activeOption.rate.id);
    }
  };

  const optionMeta = (o: RetentionOption) => (
    <span className="retention-option__meta">
      <span>{formatRateBp(o.rateBp, true)}</span>
      <span>{o.missingUvt ? "Mín.: sin UVT del año" : o.minCents > 0 ? `Mín. ${formatMoneyCents(o.minCents)}` : "Sin cuantía mínima"}</span>
      <span>{o.appliedFrom ? `Vigente desde ${formatDateForDisplay(o.appliedFrom)}` : "Regla base de la tabla"}</span>
    </span>
  );

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
      <div
        ref={root}
        className="retention-combo"
        onBlur={(e) => {
          if (!root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
      >
        <div className="retention-combo__field">
          <Input
            ref={input}
            role="combobox"
            aria-label="Buscar concepto de retención"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && activeOption ? optionId(activeOption.rate.id) : undefined}
            placeholder="Buscar concepto de retención…"
            autoComplete="off"
            value={query}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="icon-button retention-combo__toggle" aria-label={open ? "Cerrar la lista de retenciones" : "Abrir la lista de retenciones"} aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => (open ? setOpen(false) : (input.current?.focus(), setOpen(true)))}>
            <ChevronDown size={16} />
          </button>
        </div>
        {open && (
          // El mousedown no debe quitar el foco del buscador: así el clic en una opción llega antes de que se cierre la lista.
          <div id={listId} className="retention-list" role="listbox" aria-multiselectable="true" aria-label="Conceptos de retención disponibles" onMouseDown={(e) => e.preventDefault()}>
            {rates.length === 0 && <div className="field__hint retention-list__empty">No hay conceptos en la Tabla de retenciones.</div>}
            {rates.length > 0 && flat.length === 0 && <div className="field__hint retention-list__empty">{query ? `Ningún concepto coincide con «${query}».` : "Ya elegiste todos los conceptos de la tabla."}</div>}
            {groups.map((g) => (
              <div key={g.type} role="group" aria-label={g.label}>
                <div className="retention-list__group">{g.label}</div>
                {g.options.map((o) => (
                  <div key={o.rate.id} id={optionId(o.rate.id)} role="option" aria-selected={false} className={`retention-option${flat[activeIndex] === o ? " is-active" : ""}`} onMouseMove={() => setActive(flat.indexOf(o))} onClick={() => add(o.rate.id)}>
                    <span className="retention-option__name">{o.rate.name}</span>
                    {optionMeta(o)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
