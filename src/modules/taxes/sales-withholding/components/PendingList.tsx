import { useState, type ReactNode } from "react";
import { Building2, Filter, Pencil, Percent, Save } from "lucide-react";
import { Alert, Button, Input } from "../../../../components/ui";
import { formatInteger } from "../../../../utils/format";
import { isValidCiiuInput } from "../services/ciiu";
import type { Pending } from "../types";

const firstOf = (items: string[], max = 10) => (items.length > max ? [...items.slice(0, max), `… y ${formatInteger(items.length - max)} más`] : items);

interface Props {
  pending: Pending[];
  onCreateCompany: () => void;
  onEditCompany: () => void;
  onSaveCiiu: (code: string) => Promise<void>;
  onOpenTable: () => void;
  onShowReview: () => void;
}

/** Pendientes visibles con su acción: bloqueantes primero, luego advertencias. */
export function PendingList({ pending, onCreateCompany, onEditCompany, onSaveCiiu, onOpenTable, onShowReview }: Props) {
  const sorted = [...pending].sort((a, b) => Number(b.blocking) - Number(a.blocking));
  return (
    <>
      {sorted.map((p, i) => (
        <Alert key={`${p.kind}-${i}`} tone={p.blocking ? "danger" : "warning"} title={p.title}>
          {p.detail && <span>{p.detail}</span>}
          {p.items && p.items.length > 0 && (
            <ul>
              {firstOf(p.items).map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          )}
          <Actions pending={p} {...{ onCreateCompany, onEditCompany, onSaveCiiu, onOpenTable, onShowReview }} />
        </Alert>
      ))}
    </>
  );
}

function Actions({ pending, onCreateCompany, onEditCompany, onSaveCiiu, onOpenTable, onShowReview }: { pending: Pending } & Omit<Props, "pending">) {
  const row = (children: ReactNode) => (
    <div className="row" style={{ marginTop: "var(--space-2)" }}>
      {children}
    </div>
  );
  switch (pending.kind) {
    case "company_missing":
      return row(
        <Button size="sm" variant="primary" icon={<Building2 size={14} />} onClick={onCreateCompany}>
          Crear empresa
        </Button>,
      );
    case "ciiu_missing":
      return row(
        <>
          <CiiuInput onSave={onSaveCiiu} />
          <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={onEditCompany}>
            Abrir empresa
          </Button>
        </>,
      );
    case "ciiu_not_found":
      return row(
        <>
          <Button size="sm" icon={<Pencil size={14} />} onClick={onEditCompany}>
            Revisar empresa
          </Button>
          <Button size="sm" icon={<Percent size={14} />} onClick={onOpenTable}>
            Abrir Tabla de Autorretenciones
          </Button>
        </>,
      );
    case "invalid_value":
    case "no_type":
    case "duplicate":
      return row(
        <Button size="sm" icon={<Filter size={14} />} onClick={onShowReview}>
          Ver en el detalle
        </Button>,
      );
    default:
      return null;
  }
}

/** [ Configurar CIIU ]: guarda el código en la empresa sin salir del módulo. */
function CiiuInput({ onSave }: { onSave: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const invalid = code.trim() !== "" && !isValidCiiuInput(code);
  const save = async () => {
    if (!isValidCiiuInput(code) || saving) return;
    setSaving(true);
    try {
      await onSave(code.trim());
    } finally {
      setSaving(false);
    }
  };
  return (
    <span className="row" style={{ flexWrap: "nowrap" }}>
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void save()}
        placeholder="Código CIIU (ej. 6201)"
        aria-label="Código CIIU"
        inputMode="numeric"
        invalid={invalid}
        title={invalid ? "Solo números (ej. 6201 o 0111)." : undefined}
        style={{ width: 190 }}
      />
      <Button size="sm" variant="primary" icon={<Save size={14} />} loading={saving} disabled={!isValidCiiuInput(code)} onClick={() => void save()}>
        Configurar CIIU
      </Button>
    </span>
  );
}
