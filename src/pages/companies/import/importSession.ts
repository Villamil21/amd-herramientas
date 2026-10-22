/**
 * Sesión de importación de la ficha de empresa. Cada vez que el formulario se abre, cambia de empresa o se cierra empieza
 * una sesión nueva; el resultado de una lectura iniciada en una sesión anterior ya no le pertenece a nadie y se descarta.
 */
export interface ImportSession {
  current: () => number;
  next: () => number;
  isCurrent: (token: number) => boolean;
}

export function createImportSession(): ImportSession {
  let id = 0;
  return { current: () => id, next: () => ++id, isCurrent: (token) => token === id };
}

/** Borra archivos cargados sin guardar; un fallo en uno no impide borrar los demás (quedan sin referencia). */
export async function discardFiles(files: string[], discard: (storedFile: string) => Promise<unknown>): Promise<void> {
  await Promise.allSettled(files.map((f) => discard(f)));
}
