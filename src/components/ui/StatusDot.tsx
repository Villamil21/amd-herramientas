/**
 * Indicador de estado discreto: verde = disponible, gris = en preparación.
 * pulse: halo lento y suave en el verde (se detiene con «Reducir movimiento»).
 */
export function StatusDot({ available, pulse }: { available: boolean; pulse?: boolean }) {
  return (
    <span
      className={["status-dot", available && "status-dot--on", available && pulse && "status-dot--pulse"].filter(Boolean).join(" ")}
      role="img"
      aria-label={available ? "Disponible" : "En preparación"}
    />
  );
}
