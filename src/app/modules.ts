/**
 * Registro central de módulos. Para agregar un módulo nuevo:
 * 1. Crear src/modules/<modulo>/index.ts exportando su ModuleDef.
 * 2. Agregarlo a este arreglo.
 * Los componentes se cargan de forma diferida: un módulo no pesa hasta que se abre.
 */
import type { ModuleDef, SubmoduleDef } from "../types/modules";
import { bankAnalysisModule } from "../modules/bank-analysis";
import { certificatesModule } from "../modules/certificates";
import { salesOrdersModule } from "../modules/sales-orders";
import { socialSecurityModule } from "../modules/social-security";

export const MODULES: ModuleDef[] = [bankAnalysisModule, socialSecurityModule, certificatesModule, salesOrdersModule];

export function findModule(id: string | undefined) {
  return MODULES.find((m) => m.id === id);
}

/** Disponible si tiene pantalla propia o algún proveedor disponible. */
export function isAvailable(sub: SubmoduleDef): boolean {
  return Boolean(sub.component) || Boolean(sub.providers?.some(isAvailable));
}

export function readySubmodules(module: ModuleDef) {
  return module.submodules.filter(isAvailable);
}
