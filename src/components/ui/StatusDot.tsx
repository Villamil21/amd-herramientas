/** Indicador de estado discreto: verde = disponible, gris = en preparación. */
export function StatusDot({ available }: { available: boolean }) {
  return (
    <span
      className={`status-dot ${available ? "status-dot--on" : ""}`}
      role="img"
      aria-label={available ? "Disponible" : "En preparación"}
    />
  );
}
