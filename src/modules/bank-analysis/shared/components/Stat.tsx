/**
 * Tarjeta de una métrica del resumen. tone colorea el valor (verde/rojo suave).
 * Con onClick la tarjeta es un botón (ej. filtrar una tabla); active la marca.
 */
export function Stat({ label, value, tone, onClick, active, title }: { label: string; value: string; tone?: "positive" | "negative"; onClick?: () => void; active?: boolean; title?: string }) {
  const body = (
    <div>
      <div className={["stat__value", tone && `amount--${tone}`].filter(Boolean).join(" ")}>{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
  if (!onClick) return <div className="card stat">{body}</div>;
  return (
    <button type="button" className={["card stat stat--link", active && "is-active"].filter(Boolean).join(" ")} onClick={onClick} aria-pressed={active} title={title}>
      {body}
    </button>
  );
}
