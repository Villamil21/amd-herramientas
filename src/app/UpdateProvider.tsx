import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { checkForUpdate, downloadAndInstall, relaunchApp, type AvailableUpdate } from "../services/updateService";
import { isTauri } from "../services/tauri";

export type UpdateStatus = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";

interface UpdateState {
  status: UpdateStatus;
  update: AvailableUpdate | null;
  progress: number | null;
  error: string | null;
  lastChecked: Date | null;
  noticeDismissed: boolean;
  check: (opts?: { silent?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
  dismissNotice: () => void;
}

const Ctx = createContext<UpdateState | null>(null);

const CHECK_ERROR = "No se pudo comprobar si hay actualizaciones. Revisa tu conexión a internet e inténtalo más tarde.";
const INSTALL_ERROR =
  "No se pudo instalar la actualización. Tu versión actual continuará funcionando normalmente. Puedes intentarlo nuevamente más tarde.";

/** Retraso de la comprobación automática: no compite con el arranque. */
const STARTUP_CHECK_DELAY_MS = 5000;

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const busy = useRef(false);

  const check = useCallback(async ({ silent = false } = {}) => {
    if (busy.current || !isTauri()) return;
    busy.current = true;
    if (!silent) setStatus("checking");
    setError(null);
    try {
      const found = await checkForUpdate();
      setUpdate(found);
      setStatus(found ? "available" : "up-to-date");
      if (found) setNoticeDismissed(false);
    } catch (e) {
      console.warn("[updater] check", e);
      // En segundo plano, un fallo de red no debe molestar al usuario.
      setStatus(silent ? "idle" : "error");
      if (!silent) setError(CHECK_ERROR);
    } finally {
      setLastChecked(new Date());
      busy.current = false;
    }
  }, []);

  const install = useCallback(async () => {
    if (!update || busy.current) return;
    busy.current = true;
    setStatus("downloading");
    setProgress(0);
    setError(null);
    try {
      await downloadAndInstall(update, setProgress);
      setStatus("ready");
    } catch (e) {
      console.warn("[updater] install", e);
      // La versión instalada no se toca si la descarga o la verificación fallan.
      setStatus("available");
      setError(INSTALL_ERROR);
    } finally {
      busy.current = false;
    }
  }, [update]);

  const restart = useCallback(async () => {
    try {
      await relaunchApp();
    } catch {
      setError("La actualización quedó instalada. Cierra y vuelve a abrir la aplicación para usar la nueva versión.");
    }
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD) return; // en desarrollo no se consulta el servidor
    const t = window.setTimeout(() => void check({ silent: true }), STARTUP_CHECK_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [check]);

  return (
    <Ctx.Provider
      value={{ status, update, progress, error, lastChecked, noticeDismissed, check, install, restart, dismissNotice: () => setNoticeDismissed(true) }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useUpdater() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUpdater fuera de UpdateProvider");
  return ctx;
}
