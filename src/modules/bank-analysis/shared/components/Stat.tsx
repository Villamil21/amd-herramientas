/** Tarjeta de una métrica del resumen. tone colorea el valor (verde/rojo suave). */
export function Stat({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div className="card stat">
      <div>
        <div className={["stat__value", tone && `amount--${tone}`].filter(Boolean).join(" ")}>{value}</div>
        <div className="stat__label">{label}</div>
      </div>
    </div>
  );
}
