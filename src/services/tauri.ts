import { invoke } from "@tauri-apps/api/core";

/**
 * Único punto de contacto con Rust. Los comandos devuelven mensajes ya
 * redactados para el usuario; aquí solo se normaliza cualquier otro error.
 */
export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

export function errorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message) return error.message;
  return "Ocurrió un error inesperado. Inténtalo de nuevo.";
}

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
