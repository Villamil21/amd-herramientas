import { Input } from "../../components/ui";
import { EXCLUDED_CODES, FISCAL_REGIMES } from "../../modules/taxes/withholding/services/fiscal";

/** «O-13;O-15» → ["O-13", "O-15"] (sin distinguir separadores ni mayúsculas). */
export const regimeCodes = (regime: string) =>
  regime
    .toUpperCase()
    .split(/[;,\s]+/)
    .map((c) => c.trim())
    .filter(Boolean);

export function toggleCode(regime: string, code: string): string {
  const codes = regimeCodes(regime);
  return (codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code]).join("; ");
}

/** Códigos O-15 / O-47 presentes en un régimen, con su nombre: no generan retención en la fuente. */
export const exemptCodesIn = (regime: string) => regimeCodes(regime).filter((c) => c in EXCLUDED_CODES).map((code) => ({ code, label: EXCLUDED_CODES[code] }));

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Id del campo de texto (para la etiqueta del Field que lo contiene). */
  id?: string;
}

/**
 * Régimen / responsabilidades fiscales del proveedor: botones para los códigos que reconoce la aplicación (O-13, O-15
 * autorretenedor, O-23, O-47 régimen simple, R-99-PN) y un campo de texto para escribir otros. Los botones son interruptores:
 * cada uno agrega o quita su código del texto.
 */
export function FiscalRegimeField({ value, onChange, id }: Props) {
  const codes = regimeCodes(value);
  const exempt = exemptCodesIn(value);
  return (
    <div className="stack stack--sm">
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Sin verificar" />
      <div className="fiscal-chips" role="group" aria-label="Responsabilidades fiscales">
        {FISCAL_REGIMES.map((c) => (
          <button key={c.code} type="button" className={`fiscal-chip ${codes.includes(c.code) ? "is-on" : ""}`} aria-pressed={codes.includes(c.code)} onClick={() => onChange(toggleCode(value, c.code))}>
            <strong>{c.code}</strong> {c.label}
          </button>
        ))}
      </div>
      {exempt.length > 0 && <span className="field__hint">{exempt.map((e) => `${e.code} ${e.label}`).join(" y ")}: no se le calcula ni se le propone retención en la fuente.</span>}
    </div>
  );
}
