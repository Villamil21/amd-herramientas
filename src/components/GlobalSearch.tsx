import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Building2, Database, Search, Settings, UserRound } from "lucide-react";
import { isAvailable, MODULES } from "../app/modules";
import { navigate, paths } from "../app/router";
import { useShortcut } from "../hooks/useShortcut";
import { companyService } from "../services/companyService";
import type { Company } from "../types/models";
import { normalizeKey } from "../utils/text";

interface Result {
  key: string;
  label: string;
  hint: string;
  icon: typeof Search;
  path: string;
}

/** Destinos fijos: herramientas disponibles (módulo → submódulo → proveedor) y secciones de datos. */
function staticResults(): Result[] {
  const out: Result[] = [];
  for (const m of MODULES) {
    if (m.submodules.length === 0) continue;
    out.push({ key: m.id, label: m.name, hint: "Módulo", icon: m.icon, path: paths.module(m.id) });
    for (const s of m.submodules.filter(isAvailable)) {
      out.push({ key: `${m.id}/${s.id}`, label: s.name, hint: m.name, icon: s.icon, path: paths.submodule(m.id, s.id) });
      for (const p of (s.providers ?? []).filter(isAvailable)) {
        out.push({ key: `${m.id}/${s.id}/${p.id}`, label: p.name, hint: `${m.name} · ${s.name}`, icon: p.icon, path: paths.provider(m.id, s.id, p.id) });
      }
    }
  }
  out.push(
    { key: "companies", label: "Empresas", hint: "Datos", icon: Building2, path: paths.companies },
    { key: "signers", label: "Firmas", hint: "Datos", icon: UserRound, path: paths.signers },
    { key: "concepts", label: "Conceptos", hint: "Datos", icon: Database, path: paths.concepts },
    { key: "settings", label: "Configuración", hint: "Sistema", icon: Settings, path: paths.settings },
  );
  return out;
}

const MAX_RESULTS = 8;

/** Buscador de la barra superior: salta a una herramienta, sección o empresa. ⌘K lo enfoca. */
export function GlobalSearch() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [companies, setCompanies] = useState<Company[]>([]);
  const fixed = useMemo(staticResults, []);

  useShortcut("k", () => inputRef.current?.focus());

  const results = useMemo(() => {
    const q = normalizeKey(query);
    if (!q) return [];
    const companyResults: Result[] = companies.map((c) => ({
      key: `company-${c.id}`,
      label: c.razonSocial,
      hint: c.nit ? `Empresa · NIT ${c.nit}` : "Empresa",
      icon: Building2,
      path: paths.companies,
    }));
    return [...fixed, ...companyResults].filter((r) => normalizeKey(`${r.label} ${r.hint}`).includes(q)).slice(0, MAX_RESULTS);
  }, [query, fixed, companies]);

  const go = (r: Result) => {
    navigate(r.path);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      go(results[active]);
    } else if (e.key === "Escape") {
      setQuery("");
      inputRef.current?.blur();
    }
  };

  const showList = open && query.trim().length > 0;

  return (
    <div className="global-search">
      <Search size={16} className="global-search__icon" aria-hidden />
      <input
        ref={inputRef}
        className="global-search__input"
        type="search"
        placeholder="Buscar herramientas o empresas…"
        aria-label="Buscar"
        role="combobox"
        aria-expanded={showList}
        aria-controls="global-search-list"
        aria-activedescendant={showList && results[active] ? `gs-${results[active].key}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          companyService.list().then(setCompanies, () => setCompanies([]));
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <kbd className="global-search__kbd" aria-hidden>
        ⌘K
      </kbd>
      {showList && (
        <ul className="global-search__list" id="global-search-list" role="listbox">
          {results.length === 0 ? (
            <li className="global-search__empty">Sin resultados para «{query.trim()}»</li>
          ) : (
            results.map((r, i) => (
              <li
                key={r.key}
                id={`gs-${r.key}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "is-active" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault(); // evita el blur antes de navegar
                  go(r);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <r.icon size={16} aria-hidden />
                <span className="global-search__label">{r.label}</span>
                <span className="global-search__hint">{r.hint}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
