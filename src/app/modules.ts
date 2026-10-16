/**
 * Registro central de módulos. Para agregar un módulo nuevo:
 * 1. Crear src/modules/<modulo>/index.ts exportando su ModuleDef.
 * 2. Agregarlo a este arreglo.
 * Los componentes se cargan de forma diferida: un módulo no pesa hasta que se abre.
 */
import type { ModuleDef, SubmoduleDef } from "../types/modules";
import { calculatorsModule } from "../modules/calculators";
import { certificatesModule } from "../modules/certificates";
import { dropiModule } from "../modules/dropi";
import { exogenaModule } from "../modules/exogena";
import { financialStatementsModule } from "../modules/financial-statements";
import { regulatoryReportsModule } from "../modules/regulatory-reports";
import { salesOrdersModule } from "../modules/sales-orders";
import { socialSecurityModule } from "../modules/social-security";
import { taxesModule } from "../modules/taxes";
import { sortByName } from "../utils/text";

/**
 * Extractos bancarios ya no es un módulo propio: vive en Estados Financieros → Extractos bancarios.
 * El orden del arreglo no importa: las tarjetas de Herramientas se muestran alfabéticamente.
 */
export const MODULES: ModuleDef[] = sortByName([socialSecurityModule, certificatesModule, salesOrdersModule, regulatoryReportsModule, taxesModule, dropiModule, financialStatementsModule, calculatorsModule, exogenaModule]);

export function findModule(id: string | undefined) {
  return MODULES.find((m) => m.id === id);
}

/** Disponible si tiene pantalla propia o algún proveedor disponible. */
export function isAvailable(sub: SubmoduleDef): boolean {
  return Boolean(sub.component) || Boolean(sub.providers?.some(isAvailable));
}

/** Prioridad de una tarjeta sin `priority` explícita. */
const DEFAULT_PRIORITY = 1;

/** Submódulos en el orden de las tarjetas: por prioridad explícita y, a igual prioridad, alfabéticamente (no por el orden declarado). */
export function orderedSubmodules(module: ModuleDef): SubmoduleDef[] {
  return sortByName(module.submodules).sort((a, b) => (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY));
}

export function readySubmodules(module: ModuleDef) {
  return module.submodules.filter(isAvailable);
}
