export function Loader({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="loader" role="status">
      <span className="spinner" aria-hidden />
      {label}
    </div>
  );
}
