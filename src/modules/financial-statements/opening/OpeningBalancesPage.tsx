import { resolverOf } from "../shared/pucGroups";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plus, Save, Trash2 } from "lucide-react";
import { Alert, Button, Card, ConfirmDialog, DateInput, Field, Input, PageHeader, useToast } from "../../../components/ui";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import { SECTION_LABEL, type BatchInput } from "../../../types/fs";
import { formatInteger } from "../../../utils/format";
import { parseNumericText } from "../../../utils/numbers";
import { ClassifyPucModal, lineLabel } from "../shared/components/ClassifyPucModal";
import { CompanySelect } from "../shared/components/CompanySelect";
import { PucField } from "../shared/components/PucField";
import { SendToFs } from "../shared/components/SendToFs";
import { formatExactCents, formatIsoDate, isIsoDate } from "../shared/money";
import { useFsData } from "../shared/useFsData";

interface Row {
  pucCode: string;
  /** Texto escrito por el usuario (el que se ve en la tabla). */
  text: string;
}

const toCents = (text: string) => {
  const v = parseNumericText(text);
  return v === null ? null : Math.round(v * 100);
};

/**
 * Saldos iniciales por empresa y fecha. El signo solo indica si suma o resta:
 * la ubicación de cada PUC sale del Catálogo de cuentas (un PUC sin clasificar
 * bloquea el envío hasta clasificarlo o marcarlo «No afecta EEFF»).
 */
export default function OpeningBalancesPage() {
  const toast = useToast();
  const data = useFsData();
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [date, setDate] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [classifying, setClassifying] = useState<string | null>(null);
  /** Fechas con saldos iniciales activos en Estados Financieros (historial). */
  const [sentDates, setSentDates] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<number | null>(null);

  const loadSent = (id: number) =>
    fsService.batches(id).then(
      (b) => setSentDates(new Set(b.filter((x) => x.source === "opening" && x.status === "active" && x.periodStart).map((x) => x.periodStart!))),
      () => setSentDates(new Set()),
    );

  useEffect(() => {
    if (companyId === null) {
      setSentDates(new Set());
      return setDates([]);
    }
    fsService.openingDates(companyId).then(setDates, (e) => toast(errorMessage(e), "error"));
    void loadSent(companyId);
  }, [companyId, toast]);

  useEffect(() => {
    setDirty(false);
    if (companyId === null || !isIsoDate(date)) return setRows([]);
    fsService.openingDraft(companyId, date).then(
      (draft) => setRows(Array.isArray(draft) ? (draft as { pucCode: string; amountCents: number }[]).map((r) => ({ pucCode: r.pucCode, text: (r.amountCents / 100).toFixed(2).replace(".", ",") })) : [{ pucCode: "", text: "" }]),
      (e) => toast(errorMessage(e), "error"),
    );
  }, [companyId, date, toast]);

  const parsed = useMemo(() => rows.map((r) => ({ ...r, cents: toCents(r.text) })), [rows]);
  const filled = parsed.filter((r) => r.pucCode || r.text.trim());
  const invalid = filled.filter((r) => !r.pucCode || r.cents === null);
  const unclassified = [...new Set(filled.filter((r) => r.pucCode && !resolverOf(data.mappingMap).resolve(r.pucCode)).map((r) => r.pucCode))];
  const duplicated = filled.filter((r, i) => r.pucCode && filled.findIndex((x) => x.pucCode === r.pucCode) !== i);
  const capitalLine = data.catalog?.lines.find((l) => l.role === "share_capital");
  const toCapital = filled.filter((r) => capitalLine && resolverOf(data.mappingMap).resolve(r.pucCode)?.mapping.lineId === capitalLine.id);
  const total = filled.reduce((s, r) => s + (r.cents ?? 0), 0);

  const blocked =
    companyId === null || !isIsoDate(date)
      ? "Selecciona la empresa y la fecha"
      : filled.length === 0
        ? "Agrega al menos un saldo"
        : invalid.length
          ? "Hay filas sin código PUC o con un valor no válido"
          : duplicated.length
            ? "Un código PUC está repetido"
            : unclassified.length
              ? `${unclassified.length} códigos PUC sin clasificar`
              : dirty
                ? "Guarda los cambios antes de enviar"
                : null;

  const ready = companyId !== null && isIsoDate(date);
  const removeRow = (i: number) => {
    setRows((prev) => prev.filter((_, j) => j !== i));
    setDirty(true);
  };

  const update = (i: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  async function save() {
    if (companyId === null || !isIsoDate(date)) return;
    setSaving(true);
    try {
      await fsService.saveOpeningDraft(companyId, date, filled.filter((r) => r.cents !== null).map((r) => ({ pucCode: r.pucCode, amountCents: r.cents })));
      setDirty(false);
      setDates(await fsService.openingDates(companyId));
      toast("Saldos iniciales guardados.");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  function build(): BatchInput | null {
    if (companyId === null) return null;
    return {
      companyId,
      source: "opening",
      periodLabel: `Saldos iniciales al ${formatIsoDate(date)}`,
      periodStart: date,
      periodEnd: date,
      dedupeKey: `opening:${date}`,
      metadata: { rows: filled.length },
      movements: filled.map((r) => ({ accountingDate: date, conceptKey: "opening", documentId: `opening|${date}|${r.pucCode}`, pucCode: r.pucCode, amountCents: r.cents!, description: "Saldo inicial" })),
    };
  }

  return (
    <>
      <PageHeader eyebrow="Estados Financieros" title="Saldos iniciales" description="Saldos por código PUC a una fecha. El signo solo indica si suma o resta; la ubicación la define el Catálogo de cuentas." />
      {/* Cabecera compacta: empresa, fecha, cuentas, total, estado y acciones; debajo, el historial de fechas guardadas. */}
      <Card className="fs-opening-head">
        <div className="fs-opening-head__row">
          <CompanySelect companies={data.companies} value={companyId} onChange={setCompanyId} />
          <Field label="Fecha de saldos" required>
            {(id) => <DateInput id={id} value={date} onChange={setDate} />}
          </Field>
          {ready && (
            <dl className="context-bar__items fs-opening-head__stats">
              <div className="context-bar__item">
                <dt>Cuentas</dt>
                <dd>{formatInteger(filled.length)}</dd>
              </div>
              <div className="context-bar__item">
                <dt>Total</dt>
                <dd className="nowrap">{formatExactCents(total)}</dd>
              </div>
              <div className="context-bar__item">
                <dt>Estado</dt>
                <dd>{dirty ? <span className="amount--negative">Cambios sin guardar</span> : sentDates.has(date) ? "Enviado a EEFF" : dates.includes(date) ? "Guardado · sin enviar" : "Nuevo"}</dd>
              </div>
            </dl>
          )}
          {ready && (
            <div className="context-bar__actions">
              <Button size="sm" icon={<Plus size={14} />} onClick={() => setRows((r) => [...r, { pucCode: "", text: "" }])}>
                Agregar fila
              </Button>
              <Button size="sm" variant="primary" icon={<Save size={14} />} onClick={() => void save()} loading={saving} disabled={!dirty || invalid.length > 0}>
                Guardar
              </Button>
            </div>
          )}
        </div>
        {dates.length > 0 && (
          <div className="fs-opening-history" role="group" aria-label="Fechas guardadas">
            <span className="field__hint">Historial:</span>
            {[...dates].sort().reverse().map((d) => (
              <button key={d} type="button" className={`puc-chip${d === date ? " is-active" : ""}`} aria-pressed={d === date} onClick={() => setDate(d)} title={sentDates.has(d) ? "Enviado a Estados Financieros" : "Guardado, sin enviar"}>
                {formatIsoDate(d)}
                {sentDates.has(d) && <CheckCircle2 size={12} aria-label="Enviado" />}
              </button>
            ))}
          </div>
        )}
      </Card>

      {ready && (
        <>
          {/* Sin Excel propio: solo los botones de envío. Enviar de nuevo la misma fecha reemplaza el envío anterior. */}
          <SendToFs
            blocked={blocked}
            blockedStatus={unclassified.length && !invalid.length && !duplicated.length ? "Pendiente de clasificación" : "Requiere revisión"}
            build={build}
            onSent={() => companyId !== null && void loadSent(companyId)}
            duplicateTitle="Los saldos iniciales de esta fecha ya fueron enviados."
          />
          {unclassified.length > 0 && (
            <Alert tone="warning" title={unclassified.length === 1 ? "1 código PUC sin clasificar" : `${unclassified.length} códigos PUC sin clasificar`}>
              {unclassified.join(", ")}: clasifícalos (línea del ESF / EERR) o márcalos «No afecta Estados Financieros» para poder enviar.
            </Alert>
          )}
          {toCapital.length > 0 && <Alert tone="info">El Capital social se toma automáticamente de Empresas → Capital suscrito; no es necesario importarlo aquí.</Alert>}
          <Card flush>
            <div className="table-wrap">
              <table className="table table--dense fs-opening-table">
                <colgroup>
                  <col style={{ width: 150 }} />
                  <col />
                  <col style={{ width: "32%" }} />
                  <col style={{ width: 190 }} />
                  <col style={{ width: 44 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Código PUC</th>
                    <th>Concepto</th>
                    <th>Ubicación en los estados</th>
                    <th className="num">Valor</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((r, i) => {
                    const m = resolverOf(data.mappingMap).resolve(r.pucCode)?.mapping;
                    const line = m?.lineId ? data.catalog?.lines.find((l) => l.id === m.lineId) : undefined;
                    return (
                      <tr key={i}>
                        <td>
                          <PucField compact index={data.index} value={r.pucCode || undefined} onChange={(code) => update(i, { pucCode: code })} placeholder="Buscar PUC" mappings={data.mappingMap} onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])} />
                        </td>
                        <td className="fs-opening-table__concept">{r.pucCode ? (data.index.concepts.get(r.pucCode) ?? "—") : "—"}</td>
                        <td>
                          {!r.pucCode ? (
                            "—"
                          ) : m ? (
                            <button type="button" className="fs-opening-table__location" title={m.excluded ? "No afecta Estados Financieros" : line ? lineLabel(line) : undefined} onClick={() => setClassifying(r.pucCode)}>
                              {m.excluded ? (
                                <strong>No afecta Estados Financieros</strong>
                              ) : line ? (
                                <>
                                  <strong>{line.name}</strong>
                                  <span>{SECTION_LABEL[line.section]}</span>
                                </>
                              ) : (
                                "—"
                              )}
                            </button>
                          ) : (
                            <Button size="sm" variant="primary" onClick={() => setClassifying(r.pucCode)}>
                              Clasificar
                            </Button>
                          )}
                        </td>
                        <td className="fs-opening-table__value">
                          <Input aria-label={`Valor ${r.pucCode || `fila ${i + 1}`}`} className="input--right" value={r.text} invalid={r.text.trim() !== "" && r.cents === null} placeholder="-2.000.000" onChange={(e) => update(i, { text: e.target.value })} />
                        </td>
                        <td className="actions">
                          <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} aria-label="Eliminar fila" onClick={() => (r.pucCode || r.text.trim() ? setRemoving(i) : removeRow(i))} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      <ConfirmDialog
        open={removing !== null}
        danger
        title="Eliminar fila"
        confirmLabel="Eliminar"
        message={removing !== null ? <>Se quita {rows[removing]?.pucCode || "la fila"} de los saldos. El cambio se aplica al guardar.</> : null}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          removeRow(removing!);
          setRemoving(null);
        }}
      />
      <ClassifyPucModal
        open={classifying !== null}
        pucCode={classifying ?? ""}
        concept={data.index.concepts.get(classifying ?? "") ?? ""}
        catalog={data.catalog}
        mappings={data.mappingMap}
        onClose={() => setClassifying(null)}
        onSaved={data.reloadMappings}
      />
    </>
  );
}
