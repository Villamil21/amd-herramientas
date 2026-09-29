import { useState } from "react";
import { logoUrl, reportMissingLogo } from "../app/logos";
import { StatusDot } from "./ui";

interface Props {
  name: string;
  /** Nombre exacto del archivo dentro de Logos/ (ej. "Bancolombia.png"). */
  logo?: string;
  available: boolean;
  onOpen: () => void;
}

/**
 * Tarjeta de selección de entidad (bancos, proveedores de planilla): logo y
 * nombre centrados, y el estado en la esquina inferior derecha. Si el logo
 * falta, el nombre queda centrado en la tarjeta.
 */
export function BankCard({ name, logo, available, onOpen }: Props) {
  const src = logoUrl(logo);
  const [failed, setFailed] = useState(false);
  const showLogo = Boolean(src) && !failed;

  return (
    <button className="card bank-card" onClick={onOpen}>
      {showLogo && (
        <div className="bank-card__logo">
          <img
            src={src}
            alt=""
            draggable={false}
            onError={() => {
              setFailed(true);
              if (logo) reportMissingLogo(logo);
            }}
          />
        </div>
      )}
      <h3 className="bank-card__name">{name}</h3>
      <span className="bank-card__status">
        <StatusDot available={available} pulse />
      </span>
    </button>
  );
}
