import { useSyncExternalStore } from "react";

/**
 * Enrutador mínimo basado en el hash (#/herramientas/certificados/retencion).
 * Suficiente para una app de escritorio y sin dependencias extra.
 */
function getSegments(): string[] {
  return window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
}

let cached = getSegments();
let cachedHash = window.location.hash;

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function snapshot(): string[] {
  if (window.location.hash !== cachedHash) {
    cachedHash = window.location.hash;
    cached = getSegments();
  }
  return cached;
}

export function useRoute(): string[] {
  return useSyncExternalStore(subscribe, snapshot);
}

export function navigate(path: string) {
  const target = `#${path.startsWith("/") ? path : `/${path}`}`;
  if (window.location.hash !== target) window.location.hash = target;
}

export const paths = {
  tools: "/herramientas",
  module: (moduleId: string) => `/herramientas/${moduleId}`,
  submodule: (moduleId: string, subId: string) => `/herramientas/${moduleId}/${subId}`,
  provider: (moduleId: string, subId: string, providerId: string) => `/herramientas/${moduleId}/${subId}/${providerId}`,
  companies: "/empresas",
  concepts: "/conceptos",
  signers: "/firmas",
  settings: "/configuracion",
};
