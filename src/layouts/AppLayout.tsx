import { useEffect, useState, type ReactNode } from "react";
import { Building2, Download, Home, LayoutGrid, PanelLeftClose, PanelLeftOpen, Percent, Settings } from "lucide-react";
import { navigate, paths } from "../app/router";
import { useUpdater } from "../app/UpdateProvider";
import { Breadcrumbs, type Crumb } from "../components/ui";

const NAV = [
  { key: "home", label: "Inicio", icon: Home, path: paths.home },
  { key: "tools", label: "Herramientas", icon: LayoutGrid, path: paths.tools },
];
const DATA_NAV = [
  { key: "companies", label: "Empresas", icon: Building2, path: paths.companies },
  { key: "concepts", label: "Conceptos", icon: Percent, path: paths.concepts },
  { key: "settings", label: "Configuración", icon: Settings, path: paths.settings },
];

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

  const item = (n: (typeof NAV)[number]) => (
    <button
      key={n.key}
      className={`nav-item ${active === n.key ? "is-active" : ""}`}
      onClick={() => navigate(n.path)}
      title={collapsed ? n.label : undefined}
    >
      <n.icon size={17} strokeWidth={1.8} />
      <span className="nav-item__label">{n.label}</span>
    </button>
  );

  return (
    <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar__drag" data-tauri-drag-region />
        <div className="sidebar__brand" data-tauri-drag-region>
          <div className="brand-mark">A</div>
          <div className="brand-text">
            AMD <span>Módulos</span>
          </div>
        </div>
        <nav className="sidebar__nav">
          {NAV.map(item)}
          <div className="sidebar__section">Datos</div>
          {DATA_NAV.map(item)}
        </nav>
        <div className="sidebar__footer">
          <span className="sidebar__version">Versión {version}</span>
          <button className="icon-button" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Expandir menú" : "Contraer menú"}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar" data-tauri-drag-region>
          <Breadcrumbs items={crumbs} />
          <div className="topbar__actions">
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
