import { useState } from "react";
import { logoUrl, reportMissingLogo } from "../app/logos";
import { StatusDot } from "./ui";

interface Props {
  name: string;
  /** Nombre exacto del archivo dentro de Logos/ (ej. "Bancolombia.png"). */
  logo?: string;
  description: string;
  available: boolean;
  onOpen: () => void;
}

/** Tarjeta con el logo real de la entidad. Si el logo falta, muestra solo el nombre. */
export function BankCard({ name, logo, description, available, onOpen }: Props) {
  const src = logoUrl(logo);
  const [failed, setFailed] = useState(false);
  const showLogo = Boolean(src) && !failed;

  return (
    <button className="card tile bank-card" onClick={onOpen}>
      {showLogo && (
        <div className="bank-card__logo">
          <img
            src={src}
            alt={`Logo de ${name}`}
            draggable={false}
            onError={() => {
              setFailed(true);
              if (logo) reportMissingLogo(logo);
            }}
          />
        </div>
      )}
      <div>
        <div className="bank-card__title">
          <h3>{name}</h3>
          <StatusDot available={available} />
        </div>
        {description && <p>{description}</p>}
      </div>
    </button>
  );
}
