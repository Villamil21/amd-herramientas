/**
 * Actualizaciones con el plugin oficial de Tauri (tauri-plugin-updater).
 * La firma de cada paquete se verifica con la clave pública configurada en
 * tauri.conf.json antes de instalar; un paquete manipulado se rechaza.
 */
import type { Update } from "@tauri-apps/plugin-updater";

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
  handle: Update;
}

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: 20_000 });
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body?.trim() || null,
    date: update.date ?? null,
    handle: update,
  };
}

/** Descarga (con progreso 0-1 si el servidor informa el tamaño) e instala. */
export async function downloadAndInstall(update: AvailableUpdate, onProgress: (fraction: number | null) => void) {
  let total = 0;
  let received = 0;
  await update.handle.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
      onProgress(total ? 0 : null);
    } else if (event.event === "Progress") {
      received += event.data.chunkLength;
      onProgress(total ? Math.min(received / total, 1) : null);
    } else if (event.event === "Finished") {
      onProgress(1);
    }
  });
}

export async function relaunchApp() {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

export async function getAppVersion(): Promise<string> {
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}
