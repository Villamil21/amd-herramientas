import { useState } from "react";
import { BookOpenText, Pencil } from "lucide-react";
import { Badge, Button, Modal } from "../../../../components/ui";
import type { FsPucMapping } from "../../../../types/fs";
import type { PucCode } from "../../../../types/models";
import { PucCodePicker } from "../../puc-codes/components/PucCodePicker";
import { leafConcept, type PucIndex } from "../../puc-codes/services/pucCatalog";
import { CreatePucCodeModal } from "./CreatePucCodeModal";

interface Props {
  index: PucIndex;
  value: string | undefined;
  onChange: (code: string) => void;
  /** Accesos rápidos (ej. códigos usados con el proveedor o sugeridos por el banco). */
  suggestions?: PucCode[];
  title?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  /** Tras crear un código personalizado: recargar la tabla PUC (y los mapeos). */
  onCodesChanged?: () => Promise<unknown> | void;
  mappings?: Map<string, FsPucMapping>;
  placeholder?: string;
  /** Solo el código (el concepto queda en el tooltip): para tablas con columna Concepto propia. */
  compact?: boolean;
}

/**
 * Campo de cuenta PUC: muestra el código elegido con su concepto y abre el
 * buscador para elegir otro (con confirmación) o crear una cuenta nueva.
 */
export function PucField({ index, value, onChange, suggestions, title = "Cuenta PUC", disabled, size = "sm", onCodesChanged, mappings, placeholder = "Elegir cuenta PUC", compact }: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const concept = leafConcept(index, value);

  return (
    <>
      {value ? (
        <span className="row" style={{ gap: 6, flexWrap: "nowrap", minWidth: 0 }}>
          <span className="puc-chip" title={`${value} — ${concept ?? "código no encontrado"}`} style={{ cursor: "default" }}>
            <strong>{value}</strong>
            {!compact && <> — {concept ?? <span className="amount--negative">no existe en la tabla</span>}</>}
          </span>
          {index.custom.has(value) && <Badge>Personalizado</Badge>}
          {index.inactive.has(value) && <Badge tone="warning">Inactivo</Badge>}
          {!disabled && <Button size="sm" variant="ghost" iconOnly icon={<Pencil size={13} />} aria-label="Cambiar cuenta PUC" title="Cambiar cuenta PUC" onClick={() => setOpen(true)} />}
        </span>
      ) : (
        <Button size={size} icon={<BookOpenText size={14} />} onClick={() => setOpen(true)} disabled={disabled}>
          {placeholder}
        </Button>
      )}
      <Modal open={open} title={title} description="Busca por código o concepto y confirma. Si la cuenta no existe, créala como código personalizado." size="lg" onClose={() => setOpen(false)}>
        <PucCodePicker
          index={index}
          autoFocus
          suggestions={suggestions}
          onConfirm={(code) => {
            onChange(code);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
          onCreate={(typed) => setCreating(typed)}
        />
      </Modal>
      <CreatePucCodeModal
        open={creating !== null}
        initialCode={/^\d+$/.test(creating ?? "") ? creating! : ""}
        index={index}
        mappings={mappings}
        onClose={() => setCreating(null)}
        onCreated={async (code) => {
          await onCodesChanged?.();
          setCreating(null);
          setOpen(false);
          onChange(code.code);
        }}
      />
    </>
  );
}
