import { useLayoutEffect, useRef, type InputHTMLAttributes } from "react";
import { Input } from "../../../../components/ui";
import { formatCalcPesos, parsePesosInput } from "../services/contributions";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: number | null;
  onChange: (value: number | null) => void;
  invalid?: boolean;
};

/**
 * Valor en pesos: se escribe "1705905" y se ve "$ 1.705.905". Guarda un
 * número (o null si está vacío); letras, signos y decimales se descartan.
 * El cursor se conserva detrás del mismo dígito al reformatear.
 */
export function MoneyInput({ value, onChange, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const digitsBeforeCaret = useRef<number | null>(null);
  const text = value === null ? "" : formatCalcPesos(value);

  useLayoutEffect(() => {
    const input = ref.current;
    const target = digitsBeforeCaret.current;
    digitsBeforeCaret.current = null;
    if (!input || target === null || document.activeElement !== input) return;
    let pos = text.search(/\d/);
    if (pos < 0) pos = text.length;
    for (let seen = 0; seen < target && pos < text.length; pos++) if (/\d/.test(text[pos])) seen++;
    input.setSelectionRange(pos, pos);
  });

  return (
    <Input
      ref={ref}
      inputMode="numeric"
      autoComplete="off"
      placeholder="$ 0"
      {...rest}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        const caret = e.target.selectionStart ?? raw.length;
        digitsBeforeCaret.current = raw.slice(0, caret).replace(/\D/g, "").replace(/^0+(?=\d)/, "").length;
        onChange(parsePesosInput(raw));
      }}
    />
  );
}
