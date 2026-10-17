import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Field, Input, Modal, Select } from "../../../../components/ui";
import { formatExactCents } from "../../shared/money";
import type { ExoCatalogs } from "../../../../types/exogena";
import { payerOptions } from "../domain/form1647";
import { cityAliasKey, cityLabel, searchCities } from "../domain/places";
import type { CryptoModel } from "../domain/model";
import type { CryptoProblem } from "../domain/problems";
import type { CryptoData } from "../useCryptoData";

interface Props {
  problem: CryptoProblem | null;
  data: CryptoData;
  model: CryptoModel;
  catalogs: ExoCatalogs;
  onClose: () => void;
}

/** Resolución de un pendiente de Exógena sin salir de la pantalla: tipo de documento, ciudad, país o pagador. Cada decisión se guarda y recalcula todo. */
export function ResolveModal({ problem, data, model, catalogs, onClose }: Props) {
  const [value, setValue] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setValue("");
    setQuery("");
  }, [problem]);

  const kind = problem?.kind;
  const payload = problem?.payload ?? {};
  const cityOptions = useMemo(() => {
    if (!problem || !kind?.startsWith("city_")) return [];
    const third = model.form1647.thirds.find((t) => t.key === String(payload.thirdKey));
    const base = kind === "city_ambiguous" || kind === "city_multiple" ? (third?.city.candidates ?? []) : [];
    return query.trim().length >= 2 ? searchCities(model.places, query) : base.length ? base : searchCities(model.places, query);
  }, [problem, kind, payload.thirdKey, query, model]);

  if (!problem) return null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  let title = "Resolver pendiente";
  let body: React.ReactNode = null;
  let save: (() => Promise<void>) | null = null;
  let canSave = true;

  if (kind === "document_type") {
    title = "Clasificar tipo de documento";
    body = (
      <>
        <Alert tone="info">
          El valor original «{String(payload.docTypeRaw)}» no tiene homologación. Se guardará para todas las empresas y no se volverá a preguntar.
        </Alert>
        <Field label="Tipo de documento DIAN" required>
          {(id) => (
            <Select id={id} value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Selecciona…</option>
              {catalogs.documentTypes.filter((d) => d.isActive).map((d) => (
                <option key={d.code} value={d.code}>
                  {d.code} · {d.description}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </>
    );
    save = () => data.saveHomologation("document", String(payload.docTypeKey), value);
  } else if (kind?.startsWith("city_")) {
    title = "Elegir municipio";
    const raw = String(payload.raw ?? "");
    const aliasable = (kind === "city_unknown" || kind === "city_ambiguous") && raw.trim() !== "" && !raw.includes(" | ");
    body = (
      <>
        <p>{String(payload.label ?? "")}</p>
        {raw && <p className="muted">Ciudad en el archivo: {raw}</p>}
        <Field label="Buscar municipio">{(id) => <Input id={id} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nombre del municipio" />}</Field>
        <Field label="Municipio" required hint={aliasable ? "Se guardará como alias del texto original." : "La elección vale solo para este tercero."}>
          {(id) => (
            <Select id={id} value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Selecciona…</option>
              {cityOptions.map((o) => (
                <option key={o.code} value={o.code}>
                  {cityLabel(o)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </>
    );
    save = async () => {
      if (aliasable) await data.saveHomologation("city", cityAliasKey(raw), value);
      else await data.decide("city", String(payload.thirdKey), value);
    };
  } else if (kind === "country") {
    title = "Confirmar país";
    body = (
      <>
        <p>{String(payload.label ?? "")}</p>
        <Field label="País de residencia o domicilio" required>
          {(id) => (
            <Select id={id} value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Selecciona…</option>
              {catalogs.countries.filter((c) => c.isActive).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </>
    );
    save = () => data.decide("country", String(payload.thirdKey), value);
  } else if (kind === "assignment") {
    title = "Asignar pagador de Ventas";
    const third = model.form1647.thirds.find((t) => t.key === String(payload.thirdKey));
    const options = payerOptions(model.form1647, String(payload.thirdKey));
    const chosen = options.find((o) => o.payer.key === value);
    canSave = Boolean(chosen?.selectable);
    body = (
      <>
        <p>
          {String(payload.label ?? "")} · {third ? formatExactCents(third.totalCents) : ""}
        </p>
        <Alert tone="info">Un tercero no se divide entre pagadores: solo se pueden elegir los que tienen saldo para cubrir su valor completo.</Alert>
        <Field label="Pagador" required error={options.length > 0 && !options.some((o) => o.selectable) ? "Ningún pagador tiene saldo suficiente para este tercero." : null}>
          {(id) => (
            <Select id={id} value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Selecciona…</option>
              {options.map((o) => (
                <option key={o.payer.key} value={o.payer.key} disabled={!o.selectable}>
                  {o.payer.label} · saldo {formatExactCents(o.availableCents)}
                  {o.selectable ? "" : " · no cubre el valor del tercero"}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </>
    );
    save = async () => {
      if (!canSave) return;
      await data.decide("assignment", String(payload.thirdKey), value);
    };
  }

  return (
    <Modal
      open
      title={title}
      size="md"
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} disabled={!value || !save || !canSave} onClick={() => save && void run(save)}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="stack stack--sm">{body ?? <p>{problem.message}</p>}</div>
    </Modal>
  );
}
