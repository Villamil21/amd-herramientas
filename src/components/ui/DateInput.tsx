import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type Ref } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { formatDateForInput, formatDateText, fromIsoDate, MONTHS_ES, parseDisplayDate, toIsoDate } from "../../utils/dates";

interface DateInputProps {
  id?: string;
  /** Valor interno «AAAA-MM-DD» ("" = vacío). */
  value: string;
  /** Recibe «AAAA-MM-DD», o "" mientras el texto esté vacío o no sea una fecha válida. */
  onChange: (iso: string) => void;
  /** Lectura del texto escrito; por defecto «DD/MM/AAAA» (ver `parseTaxPaymentDate` para la excepción de impuestos). */
  parse?: (text: string) => string | null;
  placeholder?: string;
  /** Mensaje cuando el texto no es una fecha válida. */
  errorText?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  autoFocus?: boolean;
}

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];
const monthName = (m: number) => MONTHS_ES[m - 1].charAt(0) + MONTHS_ES[m - 1].slice(1).toLowerCase();

/**
 * Campo de fecha de la aplicación: se escribe y se muestra «DD/MM/AAAA» sin depender del
 * idioma del sistema (el `<input type="date">` nativo de macOS muestra MM/DD/AAAA), con un
 * calendario en español. El valor que entra y sale siempre es ISO «AAAA-MM-DD».
 */
export function DateInput({ id, value, onChange, parse = parseDisplayDate, placeholder = "DD/MM/AAAA", errorText = "Fecha inválida. Usa DD/MM/AAAA.", disabled, invalid, className, autoFocus }: DateInputProps) {
  const [text, setText] = useState(() => formatDateForInput(value));
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cambios de valor desde afuera (reiniciar el formulario, elegir otro registro…).
  useEffect(() => {
    if ((parse(text) ?? "") !== value) setText(formatDateForInput(value));
  }, [value]);

  useLayoutEffect(() => {
    if (!open) return;
    // En portal y con posición fija: el cuerpo de los modales tiene scroll y lo recortaría.
    const place = () => {
      const r = wrapRef.current?.querySelector(".date-input__control")?.getBoundingClientRect();
      if (!r) return;
      const height = popRef.current?.offsetHeight ?? 320;
      const below = r.bottom + 6 + height <= window.innerHeight;
      setPos({ position: "fixed", left: Math.max(8, Math.min(r.left, window.innerWidth - 272)), top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - height) });
    };
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  function type(next: string) {
    setText(next);
    const iso = parse(next) ?? "";
    if (iso !== value) onChange(iso);
  }

  function blur() {
    setTouched(true);
    const iso = parse(text);
    if (iso) setText(formatDateForInput(iso));
  }

  function pick(iso: string) {
    setText(formatDateForInput(iso));
    setTouched(true);
    setOpen(false);
    if (iso !== value) onChange(iso);
    inputRef.current?.focus();
  }

  const bad = invalid || (touched && text.trim() !== "" && !parse(text));
  return (
    <div className={["date-input", className].filter(Boolean).join(" ")} ref={wrapRef}>
      <div className="date-input__control">
        <input
          ref={inputRef}
          id={id}
          className={["input", bad && "has-error"].filter(Boolean).join(" ")}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={placeholder}
          value={text}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-invalid={bad || undefined}
          onChange={(e) => type(e.target.value)}
          onBlur={blur}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && e.altKey) setOpen(true);
          }}
        />
        <button type="button" className="date-input__toggle" onClick={() => setOpen((o) => !o)} disabled={disabled} aria-label="Abrir calendario" aria-expanded={open}>
          <CalendarDays size={15} />
        </button>
      </div>
      {bad && !invalid && <span className="field__error">{errorText}</span>}
      {open &&
        createPortal(
          <Calendar ref={popRef} style={pos} value={value} onPick={pick} onClose={() => { setOpen(false); inputRef.current?.focus(); }} />,
          document.body,
        )}
    </div>
  );
}

function Calendar({ ref, style, value, onPick, onClose }: { ref: Ref<HTMLDivElement>; style: CSSProperties; value: string; onPick: (iso: string) => void; onClose: () => void }) {
  const today = new Date();
  const todayIso = toIsoDate({ year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() });
  const start = fromIsoDate(value) ?? fromIsoDate(todayIso)!;
  const [view, setView] = useState({ year: start.year, month: start.month });
  const [focus, setFocus] = useState(toIsoDate(start));
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focus}"]`)?.focus();
  }, [focus, view]);

  const shift = (months: number) =>
    setView((v) => {
      const n = v.year * 12 + (v.month - 1) + months;
      return { year: Math.floor(n / 12), month: (n % 12) + 1 };
    });

  const daysIn = new Date(Date.UTC(view.year, view.month, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(view.year, view.month - 1, 1)).getUTCDay() + 6) % 7; // lunes primero
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => toIsoDate({ year: view.year, month: view.month, day: i + 1 }))];

  function key(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      // Que el modal que lo contiene no se cierre también.
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      onClose();
      return;
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const d = fromIsoDate(focus)!;
    const next = new Date(Date.UTC(d.year, d.month - 1, d.day + step));
    const iso = toIsoDate({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() });
    setView({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 });
    setFocus(iso);
  }

  return (
    <div ref={ref} style={style} className="date-input__popover" role="dialog" aria-label="Elegir fecha" onKeyDown={key}>
      <div className="date-input__header">
        <button type="button" className="icon-button" onClick={() => shift(-1)} aria-label="Mes anterior">
          <ChevronLeft size={15} />
        </button>
        <span aria-live="polite">
          {monthName(view.month)} {view.year}
        </span>
        <button type="button" className="icon-button" onClick={() => shift(1)} aria-label="Mes siguiente">
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="date-input__grid" role="grid" ref={gridRef}>
        {WEEKDAYS.map((w) => (
          <span key={w} className="date-input__weekday" aria-hidden="true">
            {w}
          </span>
        ))}
        {cells.map((iso, i) =>
          iso ? (
            <button
              key={iso}
              type="button"
              data-iso={iso}
              tabIndex={iso === focus ? 0 : -1}
              className={["date-input__day", iso === value && "is-selected", iso === todayIso && "is-today"].filter(Boolean).join(" ")}
              aria-label={formatDateText(iso)}
              aria-pressed={iso === value}
              onClick={() => onPick(iso)}
            >
              {Number(iso.slice(8))}
            </button>
          ) : (
            <span key={`x${i}`} />
          ),
        )}
      </div>
      <div className="date-input__footer">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onPick(todayIso)}>
          Hoy
        </button>
      </div>
    </div>
  );
}
