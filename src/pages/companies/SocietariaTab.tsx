import { useMemo } from "react";
import { Alert, Button, Field, Input, Select } from "../../components/ui";
import type { LegalRole } from "../../types/models";
import { CamaraRepWarnings, RepProposalAlerts } from "./import/CompanyDocuments";
import { assignRole, selectedRep } from "./import/legalReps";
import { originMark } from "./OriginMark";
import { capitalSummary } from "./capitalSummary";
import { ShareholdersSection } from "./ShareholdersSection";
import { capitalTotal } from "./normalize";
import type { TabProps } from "./tabs";

const ROLE_LABEL: Record<LegalRole, string> = { principal: "Principal", alternate: "Suplente" };
const cop = (pesos: number | null) => (pesos === null ? "—" : new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(pesos));

/** Estructura societaria: capital (acciones × valor nominal), socios y, al final, la representación legal. */
export function SocietariaTab({ values, setValues, errors, imports, company, onSaveFirst, saving }: TabProps & { onSaveFirst: () => void; saving: boolean }) {
  const summary = capitalSummary(values);
  const mark = (f: Parameters<typeof originMark>[0]) => originMark(f, values, imports);

  const updateShareholders = (update: (list: TabProps["values"]["shareholders"]) => TabProps["values"]["shareholders"]) =>
    setValues((v) => {
      let list = update(v.shareholders).map((s, i) => ({ ...s, sortOrder: i }));
      // Un único socio parte con el 100 %.
      if (list.length === 1 && !(list[0].percentage > 0)) list = [{ ...list[0], percentage: 100 }];
      return { ...v, shareholders: list };
    });

  function selectRep(role: LegalRole, value: string) {
    setValues((v) => {
      const clear = role === "principal" ? { legalRepName: "", legalRepDocument: "", legalRepManual: false } : { legalRepAltName: "", legalRepAltDocument: "", legalRepAltManual: false };
      return { ...v, ...clear, shareholders: assignRole(v.shareholders, role, value === "" ? null : Number(value)) };
    });
  }
  const repOptions = useMemo(() => values.shareholders.map((s, i) => ({ index: i, label: s.name.trim() ? `${s.name.trim()}${s.identityDocument.trim() ? ` · ${s.identityDocument.trim()}` : ""}` : `Accionista ${i + 1} (sin nombre)`, role: s.legalRole ?? null })), [values.shareholders]);

  return (
    <div className="stack">
      <section className="stack stack--sm">
        <div className="row row--between">
          <strong className="form-section__subtitle">Capital</strong>
          <div className="stat-row">
            <div className="stat">Suscrito<strong>{cop(summary.subscribed)}</strong></div>
            <div className="stat">Pagado<strong>{cop(summary.paid)}</strong></div>
            <div className="stat">Saldo por cobrar a socios<strong>{cop(summary.receivable)}</strong></div>
          </div>
        </div>
        <div className="capital-grid">
          {(
            [
              ["Capital suscrito", "subscribedTotalShares", "subscribedNominalValue"],
              ["Capital pagado", "paidTotalShares", "paidNominalValue"],
            ] as const
          ).map(([label, sharesKey, nominalKey]) => {
            const shares = values[sharesKey];
            const nominal = values[nominalKey];
            const total = capitalTotal(shares, nominal);
            return (
              <div key={label} className="capital-box">
                <div className="capital-box__title">{label}</div>
                <div className="form-grid form-grid--compact">
                  <Field label="Acciones" labelAdornment={mark(sharesKey)}>
                    {(id) => <Input id={id} type="number" min="1" value={shares ?? ""} onChange={(e) => setValues((v) => ({ ...v, [sharesKey]: e.target.value ? Number(e.target.value) : null }))} />}
                  </Field>
                  <Field label="Valor nominal" labelAdornment={mark(nominalKey)}>
                    {(id) => <Input id={id} type="number" min="1" value={nominal ?? ""} onChange={(e) => setValues((v) => ({ ...v, [nominalKey]: e.target.value ? Number(e.target.value) : null }))} />}
                  </Field>
                </div>
                <div className="capital-box__total">
                  <span>Total (acciones × valor nominal)</span>
                  <strong>{cop(total)}</strong>
                </div>
              </div>
            );
          })}
        </div>
        {summary.warnings.map((w) => (
          <Alert key={w} tone="warning">{w}</Alert>
        ))}
        <span className="field__hint">El Capital social del ESF es el suscrito; la diferencia con el pagado va a 132505 — A socios y alimenta el formato 1008.</span>
      </section>

      <section className="stack stack--sm">
        <ShareholdersSection values={values} company={company} update={updateShareholders} error={errors.shareholders} onSaveFirst={onSaveFirst} saving={saving} />
      </section>

      {(company || values.shareholders.length > 0 || imports.repProposals.length > 0) && (
        <section className="stack stack--sm">
          <strong className="form-section__subtitle">Representación legal</strong>
          <span className="field__hint">El principal firma los Estados Financieros como «Representante Legal». El suplente es opcional y no lo reemplaza automáticamente. Se eligen entre los socios.</span>
          {errors.representation && <Alert tone="danger">{errors.representation}</Alert>}
          <RepProposalAlerts values={values} imports={imports} />
          <div className="form-grid form-grid--compact">
            {(["principal", "alternate"] as LegalRole[]).map((role) => {
              const rep = selectedRep(values, role);
              const other: LegalRole = role === "principal" ? "alternate" : "principal";
              const current = repOptions.find((o) => o.role === role)?.index;
              return (
                <Field key={role} label={`Representante legal ${ROLE_LABEL[role].toLowerCase()}`} hint={role === "alternate" && !selectedRep(values, "principal") ? "Define primero el principal." : undefined}>
                  {(id) => (
                    <Select id={id} value={rep?.kind === "manual" ? "manual" : current === undefined ? "" : String(current)} onChange={(e) => e.target.value !== "manual" && selectRep(role, e.target.value)} disabled={role === "alternate" && !selectedRep(values, "principal")}>
                      <option value="">{role === "principal" ? "Sin seleccionar" : "Sin suplente"}</option>
                      {rep?.kind === "manual" && <option value="manual">{rep.name} (excepción: no es socio)</option>}
                      {repOptions.map((o) => (
                        <option key={o.index} value={o.index} disabled={o.role === other}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              );
            })}
          </div>
          {values.shareholders.length === 0 && <span className="muted">Agrega primero a los socios para elegir al representante legal.</span>}
          {(["principal", "alternate"] as LegalRole[]).map((role) => {
            const rep = selectedRep(values, role);
            return rep?.kind === "manual" ? (
              <Alert key={role} tone="warning" title={`Representante ${ROLE_LABEL[role].toLowerCase()} fuera de los socios (excepción confirmada)`}>
                {rep.name} · {rep.document || "sin documento"}.{" "}
                <Button size="sm" variant="ghost" onClick={() => selectRep(role, "")}>
                  Quitar excepción
                </Button>
              </Alert>
            ) : null;
          })}
          <CamaraRepWarnings values={values} imports={imports} />
        </section>
      )}
    </div>
  );
}
