import { findModule } from "../app/modules";

/**
 * Actividad reciente de la pantalla Herramientas. Solo registra lo que ya
 * ocurrió (archivo analizado, Excel o PDF guardado); nunca el contenido de
 * los archivos. Vive en el almacenamiento local de la ventana: si no está
 * disponible, la app funciona igual y la lista queda vacía.
 */
export type ActivityStatus = "validated" | "processed" | "generated" | "warning" | "error";

export interface ActivityEntry {
  id: string;
  /** ISO 8601 */
  at: string;
  /** Módulo principal (ej. «Extractos bancarios»). */
  module: string;
  /** Herramienta dentro del módulo (ej. «Bancolombia»). */
  tool: string;
  fileName: string;
  /** Ruta del archivo guardado (solo resultados generados). */
  path?: string;
  company?: string;
  status: ActivityStatus;
}

const KEY = "activity.recent";
const MAX = 30;

const STATUSES: ActivityStatus[] = ["validated", "processed", "generated", "warning", "error"];

/** Descarta registros con otro formato (p. ej. de versiones de prueba anteriores). */
function isEntry(v: unknown): v is ActivityEntry {
  const e = v as Partial<ActivityEntry> | null;
  return (
    !!e &&
    typeof e.id === "string" &&
    typeof e.at === "string" &&
    typeof e.module === "string" &&
    typeof e.tool === "string" &&
    typeof e.fileName === "string" &&
    STATUSES.includes(e.status as ActivityStatus)
  );
}

function read(): ActivityEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

/** Módulo y herramienta a partir de la ruta actual (#/herramientas/…). */
function currentTool(): { module: string; tool: string } {
  const [section, moduleId, subId, providerId] = window.location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const mod = section === "herramientas" ? findModule(moduleId) : undefined;
  if (!mod) return { module: "—", tool: "—" };
  const sub = mod.submodules.find((s) => s.id === subId);
  const provider = sub?.providers?.find((p) => p.id === providerId);
  return { module: mod.name, tool: (provider ?? sub)?.name ?? mod.name };
}

/** Estado de un análisis según su validación (bancos, planillas, UIAF). */
export function analysisStatus(analysis: unknown): ActivityStatus {
  const v = (analysis as { validation?: { validated?: boolean; valid?: boolean } } | null)?.validation;
  if (!v) return "processed";
  return (v.validated ?? v.valid) ? "validated" : "warning";
}

export const activityService = {
  list: () => read(),

  record(fileName: string, status: ActivityStatus, extra: { path?: string; company?: string } = {}) {
    const entry: ActivityEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: new Date().toISOString(),
      ...currentTool(),
      fileName,
      status,
      ...extra,
    };
    try {
      localStorage.setItem(KEY, JSON.stringify([entry, ...read()].slice(0, MAX)));
    } catch {
      /* registro informativo: si no se puede guardar, no afecta el flujo */
    }
  },

  /** Archivo guardado por el usuario (Excel o PDF). */
  saved: (path: string, company?: string) => activityService.record(path.split("/").pop() ?? path, "generated", { path, company }),
};
