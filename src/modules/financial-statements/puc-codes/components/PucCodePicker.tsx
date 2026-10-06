import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, Search } from "lucide-react";
import { Button, Input } from "../../../../components/ui";
import type { PucCode } from "../../../../types/models";
import { formatInteger } from "../../../../utils/format";
import { leafConcept, leafContext, searchLeaves, type PucIndex } from "../services/pucCatalog";

interface Props {
  index: PucIndex;
  /** El usuario confirmó el código (siempre uno de 6 dígitos que existe en la tabla). */
  onConfirm: (code: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  /**
   * Códigos confirmados antes para el proveedor de la factura: accesos rápidos
   * (también pasan por la confirmación). Sin definir: no se muestra la sección.
   */
  suggestions?: PucCode[];
  confirmLabel?: string;
}

/**
 * Campo «Código PUC»: busca por código (completo o parte) o por concepto,
 * muestra el concepto exacto de la tabla y pide confirmación. Nunca aplica un
 * código en silencio y solo ofrece códigos finales de 6 dígitos.
 */
export function PucCodePicker({ index, onConfirm, onCancel, autoFocus, suggestions, confirmLabel = "Confirmar código" }: Props) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<PucCode | null>(null);
  const [active, setActive] = useState(0);
  const confirmRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [focusConfirm, setFocusConfirm] = useState(false);
  const [rejected, setRejected] = useState(false);

  const search = useMemo(() => searchLeaves(index, query), [index, query]);
  // Un código de 6 dígitos existente se muestra directamente para confirmar.
  const candidate = picked ?? search.exact ?? null;
  const typed = query.trim().length > 0;

  useEffect(() => {
    if (!focusConfirm) return;
    setFocusConfirm(false);
    confirmRef.current?.querySelector("button")?.focus();
  }, [focusConfirm]);

  function pick(code: PucCode) {
    setPicked(code);
    setRejected(false);
    setFocusConfirm(true);
  }

  /** Última barrera: solo se confirma una subcuenta de 6 dígitos que exista en la tabla, nunca un nivel superior. */
  function confirm(code: string) {
    if (leafConcept(index, code) === undefined) return setRejected(true);
    onConfirm(code);
  }

  function reset() {
    setPicked(null);
    setRejected(false);
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, search.results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Enter elige; la confirmación es un segundo paso explícito.
      if (candidate) setFocusConfirm(true);
      else if (search.results[active]) pick(search.results[active]);
    } else if (e.key === "Escape" && onCancel) {
      e.stopPropagation();
      onCancel();
    }
  }

  return (
    <div className="puc-picker">
      <div className="puc-picker__field">
        <div className="search puc-picker__search">
          <Search size={14} aria-hidden />
          <Input
            ref={inputRef}
            placeholder="Código o concepto: 5105, arrendamientos, bancos…"
            aria-label="Código PUC"
            autoFocus={autoFocus}
            value={query}
            invalid={typed && !candidate && search.total === 0}
            onChange={(e) => {
              setQuery(e.target.value);
              setPicked(null);
              setRejected(false);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>

      {candidate ? (
        <div className="puc-confirm" role="group" aria-label="Confirmar código PUC">
          <dl className="puc-confirm__data">
            <div>
              <dt>Código</dt>
              <dd className="selectable">{candidate.code}</dd>
            </div>
            <div>
              <dt>Concepto</dt>
              <dd className="selectable">
                {candidate.concept}
                <span className="puc-confirm__context">{leafContext(index, candidate.code)}</span>
              </dd>
            </div>
          </dl>
          <div className="row" ref={confirmRef}>
            <Button variant="primary" size="sm" icon={<Check size={14} />} onClick={() => confirm(candidate.code)}>
              {confirmLabel}
            </Button>
            <Button size="sm" onClick={reset}>
              Elegir otro
            </Button>
          </div>
          {rejected && (
            <div className="field__error" role="alert">
              No se puede asignar este nivel del PUC. Selecciona un código de 6 dígitos.
            </div>
          )}
        </div>
      ) : typed ? (
        search.total === 0 ? (
          <div className="field__error" role="alert">
            Código PUC no encontrado{search.note ? `: ${search.note}` : "."}
          </div>
        ) : (
          <>
            <ul className="puc-results" role="listbox" aria-label="Códigos PUC que coinciden">
              {search.results.map((r, i) => {
                const account = r.code.slice(0, 4);
                return (
                  <Fragment key={r.code}>
                    {/* La cuenta de 4 dígitos y su grupo son solo el encabezado: no se pueden elegir. */}
                    {search.results[i - 1]?.code.slice(0, 4) !== account && (
                      <li role="presentation" className="puc-results__group" onMouseDown={(e) => e.preventDefault()}>
                        {leafContext(index, r.code) || account}
                      </li>
                    )}
                    <li
                      role="option"
                      aria-selected={i === active}
                      className={i === active ? "is-active" : undefined}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => {
                        e.preventDefault(); // conserva el foco hasta pasar al botón de confirmar
                        pick(r);
                      }}
                    >
                      <span className="puc-results__code">{r.code}</span>
                      <span className="puc-results__concept">{r.concept}</span>
                    </li>
                  </Fragment>
                );
              })}
            </ul>
            {search.total > search.results.length && (
              <span className="field__hint">
                Se muestran {search.results.length} de {formatInteger(search.total)} códigos. Escribe más para acotar.
              </span>
            )}
          </>
        )
      ) : (
        suggestions && (
          <div className="puc-suggestions">
            <span className="field__hint">Usados con este proveedor:</span>
            {suggestions.length === 0 && <span className="field__hint">Aún no hay códigos guardados para este proveedor.</span>}
            {suggestions.map((s) => (
              <button key={s.code} type="button" className="puc-chip" title={`${s.code} — ${s.concept}`} onClick={() => pick(s)}>
                <strong>{s.code}</strong> — {s.concept}
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}
