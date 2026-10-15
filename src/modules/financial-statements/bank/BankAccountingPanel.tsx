import { useEffect, useMemo, useState } from "react";
import { Alert, Card, Field, Select } from "../../../components/ui";
import { fsService } from "../../../services/fsService";
import type { BankAccount, BankConceptMapping } from "../../../types/fs";
import { formatInteger } from "../../../utils/format";
import { CompanySelect } from "../shared/components/CompanySelect";
import { PucField } from "../shared/components/PucField";
import { SendToFs } from "../shared/components/SendToFs";
import { formatExactCents, formatIsoDate } from "../shared/money";
import { useFsData } from "../shared/useFsData";
import { buildBankBatch, conceptMappingKey, fromSignedGroups, fromTypedGroups, pendingConcepts, type AccountingStatement, type ConceptDecision, type Destination } from "./bankAccounting";

interface Props {
  statement: AccountingStatement;
  fileName: string;
  onExport: () => Promise<string | null | void>;
  exporting?: boolean;
}

/**
 * Resumen por concepto con su destino (Seleccionar / Enviar a Estados
 * Financieros / No enviar) y cuenta PUC, cuenta PUC del saldo bancario y envío.
 * La asociación banco + concepto → PUC es global y solo se sugiere; «No enviar»
 * aplica solo a este extracto.
 */
export function BankAccountingPanel({ statement, fileName, onExport, exporting }: Props) {
  const data = useFsData();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [conceptMappings, setConceptMappings] = useState<BankConceptMapping[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [balancePuc, setBalancePuc] = useState<string | undefined>();
  const [decisions, setDecisions] = useState<Record<string, ConceptDecision>>({});

  useEffect(() => {
    void fsService.bankAccounts().then(setAccounts);
    void fsService.bankConceptMappings().then(setConceptMappings);
  }, []);

  // Empresa y PUC de saldo ya configurados para este banco + cuenta.
  useEffect(() => {
    const known = accounts.find((a) => a.bank === statement.bank && a.accountNumber === statement.accountNumber);
    if (known && companyId === null) {
      setCompanyId(known.companyId);
      setBalancePuc(known.pucCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, statement]);

  useEffect(() => {
    if (companyId === null) return;
    const known = accounts.find((a) => a.companyId === companyId && a.bank === statement.bank && a.accountNumber === statement.accountNumber);
    setBalancePuc(known?.pucCode);
  }, [companyId, accounts, statement]);

  const suggested = useMemo(() => new Map(conceptMappings.map((m) => [conceptMappingKey(m.bank, m.concept), m.pucCode])), [conceptMappings]);
  const pending = pendingConcepts(statement, decisions);
  const missing = [
    companyId === null && "Selecciona la empresa",
    !statement.accountNumber && "El extracto no trae número de cuenta",
    (!statement.periodFrom || !statement.periodTo) && "El extracto no trae el periodo",
    statement.closingBalanceCents !== undefined && !balancePuc && "Falta la cuenta PUC del saldo bancario",
    pending > 0 && (pending === 1 ? "Hay 1 concepto pendiente de clasificación" : `Hay ${formatInteger(pending)} conceptos pendientes de clasificación`),
  ].filter(Boolean) as string[];

  function decide(key: string, description: string, destination: Destination) {
    setDecisions((prev) => ({ ...prev, [key]: { destination, pucCode: destination === "send" ? (prev[key]?.pucCode ?? suggested.get(conceptMappingKey(statement.bank, description))) : undefined } }));
  }

  return (
    <Card title="Estados Financieros" description="Decide el destino de cada concepto. «Seleccionar» no es válido para enviar; «No enviar» aplica solo a este extracto.">
      <div className="stack">
        <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
          <CompanySelect companies={data.companies} value={companyId} onChange={setCompanyId} />
          <Field label="Cuenta PUC del saldo bancario" hint={`${statement.bank} · Cuenta ${statement.accountNumber ?? "—"} · Saldo final ${statement.closingBalanceCents === undefined ? "no disponible" : formatExactCents(statement.closingBalanceCents)}${statement.periodTo ? ` al ${formatIsoDate(statement.periodTo)}` : ""}`}>
            {() => <PucField index={data.index} value={balancePuc} onChange={setBalancePuc} title="Cuenta PUC del saldo bancario" disabled={companyId === null} mappings={data.mappingMap} onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])} />}
          </Field>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Tipo</th>
                <th style={{ textAlign: "right" }}>Cantidad</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th>Destino</th>
                <th>Cuenta PUC</th>
              </tr>
            </thead>
            <tbody>
              {statement.concepts.map((c) => {
                const d = decisions[c.key];
                const destination = d?.destination ?? "select";
                const suggestion = suggested.get(conceptMappingKey(statement.bank, c.description));
                return (
                  <tr key={c.key} className={destination === "select" ? "row-attention--warning" : undefined}>
                    <td className="selectable">{c.description}</td>
                    <td>{c.dc === "D" ? "Salida" : "Entrada"}</td>
                    <td style={{ textAlign: "right" }}>{formatInteger(c.count)}</td>
                    <td style={{ textAlign: "right" }}>{formatExactCents(c.totalCents)}</td>
                    <td>
                      <Select aria-label={`Destino de ${c.description}`} value={destination} onChange={(e) => decide(c.key, c.description, e.target.value as Destination)} style={{ width: "auto" }}>
                        <option value="select">Seleccionar</option>
                        <option value="send">Enviar a Estados Financieros</option>
                        <option value="skip">No enviar</option>
                      </Select>
                    </td>
                    <td>
                      {destination === "send" ? (
                        <PucField
                          index={data.index}
                          value={d?.pucCode}
                          onChange={(code) => setDecisions((prev) => ({ ...prev, [c.key]: { destination: "send", pucCode: code } }))}
                          suggestions={suggestion ? [{ code: suggestion, concept: data.index.concepts.get(suggestion) ?? "" }] : undefined}
                          title={c.description}
                          mappings={data.mappingMap}
                          onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])}
                        />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pending > 0 && <Alert tone="warning">{pending === 1 ? "Hay 1 concepto pendiente de clasificación." : `Hay ${formatInteger(pending)} conceptos pendientes de clasificación.`}</Alert>}
        <SendToFs
          blocked={missing[0] ?? null}
          build={() => (companyId === null ? null : buildBankBatch(companyId, statement, fileName, decisions, balancePuc ?? ""))}
          onExport={onExport}
          exporting={exporting}
          duplicateTitle="Este extracto ya fue enviado."
          replaceLabel="Reemplazar envío anterior"
          onSent={() => void fsService.bankConceptMappings().then(setConceptMappings)}
        />
      </div>
    </Card>
  );
}

type SignedArgs = Parameters<typeof fromSignedGroups>;
type TypedArgs = Parameters<typeof fromTypedGroups>;
interface Common {
  fileName: string;
  onExport: () => Promise<string | null | void>;
  exporting?: boolean;
}

/** Bancos con grupos por signo (Bancolombia, Davivienda, Iris Bank). */
export function SignedBankAccounting({ statement, groups, ...rest }: Common & { statement: SignedArgs[0]; groups: SignedArgs[1] }) {
  const accounting = useMemo(() => fromSignedGroups(statement, groups), [statement, groups]);
  return <BankAccountingPanel statement={accounting} {...rest} />;
}

/** Bancos con grupos por crédito / débito (Bancoomeva, Coopcentral, BBVA). */
export function TypedBankAccounting({ statement, closingBalanceCents, groups, ...rest }: Common & { statement: TypedArgs[0]; closingBalanceCents: TypedArgs[1]; groups: TypedArgs[2] }) {
  const accounting = useMemo(() => fromTypedGroups(statement, closingBalanceCents, groups), [statement, closingBalanceCents, groups]);
  return <BankAccountingPanel statement={accounting} {...rest} />;
}
