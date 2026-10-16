/** Un pendiente que impide (o advierte sobre) dejar un formato listo. */
export interface Problem {
  level: "blocking" | "warning";
  message: string;
  /** Registro afectado (`source_key`), si aplica. */
  recordKey?: string;
  /** Campo afectado, si aplica. */
  field?: string;
  /** Tipo de pendiente que la interfaz distingue (p. ej. «manual_balance»: saldo editado a mano que difiere del calculado). */
  code?: "manual_balance";
  /** A dónde ir a resolverlo. */
  action?: { label: string; path: string };
}

export const blocking = (problems: Problem[]) => problems.filter((p) => p.level === "blocking");
