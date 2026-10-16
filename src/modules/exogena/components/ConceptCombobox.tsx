import { useMemo, useState } from "react";
import { Alert, Button, Input } from "../../../components/ui";

export interface ConceptItem {
  code: string;
  description: string;
  isActive: boolean;
}

interface Props {
  id?: string;
  value: string;
  /** Descripción guardada en la fila (se conserva aunque el concepto ya no exista o esté inactivo). */
  savedDescription?: string;
  concepts: ConceptItem[];
  onChange: (code: string, description: string) => void;
  /** Alta explícita de un concepto desconocido (nunca se acepta en silencio). */
  onCreate: (code: string, description: string) => Promise<void>;
  /** Texto bajo el campo: por ejemplo «Sugerido por el cálculo». */
  origin?: string;
}

/**
 * Combobox buscable «código — descripción». Escribe un código o parte de la descripción y elige; un código desconocido ofrece
 * crear el concepto (con su descripción) en lugar de aceptarlo callado. Los conceptos inactivos no se ofrecen, pero una fila que ya
 * los usa los conserva.
 */
export function ConceptCombobox({ id, value, savedDescription, concepts, onChange, onCreate, origin }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<{ code: string; description: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = concepts.find((c) => c.code === value);
  const label = value ? `${value} — ${current?.description ?? savedDescription ?? "(concepto no registrado)"}` : "";
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return concepts.filter((c) => c.isActive && (!q || c.code.includes(q) || c.description.toLowerCase().includes(q))).slice(0, 30);
  }, [concepts, query]);
  const typed = query.trim();
  const unknownCode = /^\d{2,8}$/.test(typed) && !concepts.some((c) => c.code === typed);

  async function create() {
    if (!creating) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(creating.code, creating.description.trim());
      onChange(creating.code, creating.description.trim());
      setCreating(null);
      setQuery("");
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="combobox">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={id ? `${id}-list` : undefined}
        autoComplete="off"
        value={open ? query : label}
        placeholder="Busca por código o descripción"
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && open) {
            e.preventDefault();
            if (matches.length === 1) {
              onChange(matches[0].code, matches[0].description);
              setOpen(false);
            } else if (unknownCode) setCreating({ code: typed, description: "" });
          }
        }}
      />
      {origin && <span className="field__hint">{origin}</span>}
      {open && (
        <ul className="combobox__list" role="listbox" id={id ? `${id}-list` : undefined}>
          {matches.map((c) => (
            <li key={c.code}>
              <button
                type="button"
                role="option"
                aria-selected={c.code === value}
                className="combobox__option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(c.code, c.description);
                  setOpen(false);
                }}
              >
                <strong>{c.code}</strong> — {c.description}
              </button>
            </li>
          ))}
          {matches.length === 0 && !unknownCode && <li className="combobox__empty muted">Sin coincidencias.</li>}
          {unknownCode && (
            <li>
              <button type="button" className="combobox__option" onMouseDown={(e) => e.preventDefault()} onClick={() => setCreating({ code: typed, description: "" })}>
                El concepto <strong>{typed}</strong> no existe en este formato: crear…
              </button>
            </li>
          )}
        </ul>
      )}
      {creating && (
        <Alert tone="warning" title={`Crear el concepto ${creating.code}`}>
          <div className="stack stack--sm">
            <Input aria-label="Descripción del concepto" autoFocus placeholder="Descripción oficial del concepto" value={creating.description} onChange={(e) => setCreating({ ...creating, description: e.target.value })} />
            {error && <span className="field__error">{error}</span>}
            <div className="row" style={{ gap: 6 }}>
              <Button size="sm" variant="primary" loading={busy} disabled={!creating.description.trim()} onClick={() => void create()}>
                Crear y usar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreating(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        </Alert>
      )}
    </div>
  );
}
