import { useEffect, useState, type ReactNode } from "react";
import { BadgePercent, BookOpenText, Building2, CalendarRange, Database, Download, LayoutGrid, ListTree, PanelLeftClose, PanelLeftOpen, Percent, Settings, Store, UserRound } from "lucide-react";
import { navigate, paths } from "../app/router";
import { useUpdater } from "../app/UpdateProvider";
import { GlobalSearch } from "../components/GlobalSearch";
import { Breadcrumbs, type Crumb } from "../components/ui";
import { sortByLabel } from "../utils/text";

interface NavItem {
  key: string;
  label: string;
  icon: typeof LayoutGrid;
  path: string;
}

/**
 * Menú por grupos: cada grupo con su encabezado (contraído queda un separador y
 * el tooltip de cada ícono). Dentro de cada grupo el orden es alfabético y
 * automático (no el orden en que se declaran).
 */
const NAV_GROUPS: { title: string; items: NavItem[] }[] = ([
  { title: "Inicio", items: [{ key: "tools", label: "Herramientas", icon: LayoutGrid, path: paths.tools }] },
  {
    title: "Datos maestros",
    items: [
      { key: "companies", label: "Empresas", icon: Building2, path: paths.companies },
      { key: "suppliers", label: "Proveedores", icon: Store, path: paths.suppliers },
      { key: "signers", label: "Firmas", icon: UserRound, path: paths.signers },
      { key: "concepts", label: "Conceptos", icon: Database, path: paths.concepts },
    ],
  },
  {
    title: "Contabilidad y EEFF",
    items: [
      { key: "puc-table", label: "Tabla de Códigos PUC", icon: BookOpenText, path: paths.pucTable },
      { key: "fs-catalog", label: "Catálogo de cuentas EEFF", icon: ListTree, path: paths.fsCatalog },
      { key: "minimum-wages", label: "SMMLV por año", icon: CalendarRange, path: paths.minimumWages },
    ],
  },
  {
    title: "Impuestos",
    items: [
      { key: "withholding-table", label: "Tabla de retenciones", icon: Percent, path: paths.withholdingTable },
      { key: "self-withholding-table", label: "Tabla de Autorretenciones", icon: BadgePercent, path: paths.selfWithholdingTable },
    ],
  },
  { title: "Sistema", items: [{ key: "settings", label: "Configuración", icon: Settings, path: paths.settings }] },
] satisfies { title: string; items: NavItem[] }[]).map((g) => ({ ...g, items: sortByLabel(g.items) }));

const COLLAPSE_KEY = "ui.sidebarCollapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

interface Props {
  active: string;
  crumbs: Crumb[];
  version: string;
  children: ReactNode;
}

export function AppLayout({ active, crumbs, version, children }: Props) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { status, update, dismissNotice, noticeDismissed } = useUpdater();

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* preferencia visual: si no se puede guardar, no pasa nada */
    }
  }, [collapsed]);

  const item = (n: NavItem) => (
    <button
      key={n.key}
      className={`nav-item ${active === n.key ? "is-active" : ""}`}
      onClick={() => navigate(n.path)}
      title={n.label}
      aria-label={collapsed ? n.label : undefined}
      aria-current={active === n.key ? "page" : undefined}
    >
      <n.icon size={18} strokeWidth={1.8} aria-hidden />
      <span className="nav-item__label">{n.label}</span>
    </button>
  );

  return (
    <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar__drag" data-tauri-drag-region />
        <div className="sidebar__brand" data-tauri-drag-region>
          {/* Contraído solo queda la marca «A». */}
          <div className="brand-mark" aria-hidden>
            A
          </div>
          <div className="brand-text">
            <div className="brand-text__name">
              AMD <span>Módulos</span>
            </div>
          </div>
        </div>
        <nav className="sidebar__nav" aria-label="Navegación principal">
          {NAV_GROUPS.map((g) => (
            <div key={g.title} className="sidebar__group" role="group" aria-label={g.title}>
              <div className="sidebar__section" title={g.title}>
                {g.title}
              </div>
              {g.items.map(item)}
            </div>
          ))}
        </nav>
        <div className="sidebar__footer">
          {/* La versión queda visible siempre; contraído se abrevia (v1.9.0) y el texto completo va en el tooltip. */}
          <span className="sidebar__version" title={`Versión ${version}`}>
            <span className="sr-only">Versión {version}</span>
            <span className="sidebar__version-full" aria-hidden>
              Versión {version}
            </span>
            <span className="sidebar__version-short" aria-hidden>
              v{version}
            </span>
          </span>
          <button
            className="icon-button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
            title={collapsed ? "Expandir menú" : "Contraer menú"}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar" data-tauri-drag-region>
          <Breadcrumbs items={crumbs} />
          <div className="topbar__actions">
            <GlobalSearch />
            {update && noticeDismissed && (status === "available" || status === "ready") && (
              <button
                className="pill-button"
                onClick={() => {
                  dismissNotice();
                  navigate(paths.settings);
                }}
              >
                <Download size={13} /> Versión {update.version} disponible
              </button>
            )}
          </div>
        </header>
        <main className="content">
          <div className="content__inner">{children}</div>
        </main>
      </div>
    </div>
  );
}
