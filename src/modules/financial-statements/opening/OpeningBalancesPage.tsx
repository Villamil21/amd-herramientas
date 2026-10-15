import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Alert, Button, Card, DateInput, Field, Input, PageHeader, useToast } from "../../../components/ui";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import type { BatchInput } from "../../../types/fs";
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

  useEffect(() => {
    if (companyId === null) return setDates([]);
    fsService.openingDates(companyId).then(setDates, (e) => toast(errorMessage(e), "error"));
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
  const unclassified = [...new Set(filled.filter((r) => r.pucCode && !data.mappingMap.has(r.pucCode)).map((r) => r.pucCode))];
  const duplicated = filled.filter((r, i) => r.pucCode && filled.findIndex((x) => x.pucCode === r.pucCode) !== i);
  const capitalLine = data.catalog?.lines.find((l) => l.role === "share_capital");
  const toCapital = filled.filter((r) => capitalLine && data.mappingMap.get(r.pucCode)?.lineId === capitalLine.id);
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
      <Card>
        <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
          <CompanySelect companies={data.companies} value={companyId} onChange={setCompanyId} />
          <Field label="Fecha" required>
            {(id) => <DateInput id={id} value={date} onChange={setDate} />}
          </Field>
          {dates.length > 0 && (
            <div className="row" style={{ flexWrap: "wrap" }}>
              <span className="field__hint">Guardados:</span>
              {dates.map((d) => (
                <button key={d} type="button" className="puc-chip" onClick={() => setDate(d)}>
                  {formatIsoDate(d)}
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {companyId !== null && isIsoDate(date) && (
        <>
          {/* Sin Excel propio: solo los botones de envío. Enviar de nuevo la misma fecha reemplaza el envío anterior. */}
          <SendToFs
            blocked={blocked}
            blockedStatus={unclassified.length && !invalid.length && !duplicated.length ? "Pendiente de clasificación" : "Requiere revisión"}
            build={build}
            duplicateTitle="Los saldos iniciales de esta fecha ya fueron enviados."
          />
          {unclassified.length > 0 && (
            <Alert tone="warning" title="Códigos PUC sin clasificar">
              Clasifícalos (línea del ESF / EERR) o márcalos «No afecta Estados Financieros» para poder enviar.
            </Alert>
          )}
          {toCapital.length > 0 && <Alert tone="info">El Capital social se toma automáticamente de Empresas → Capital suscrito; no es necesario importarlo aquí.</Alert>}
          <Card
            flush
            title={`Saldos al ${formatIsoDate(date)}`}
            description={`Total: ${formatExactCents(total)}`}
            actions={
              <>
                <Button icon={<Plus size={14} />} onClick={() => setRows((r) => [...r, { pucCode: "", text: "" }])}>
                  Agregar fila
                </Button>
                <Button variant="primary" icon={<Save size={14} />} onClick={() => void save()} loading={saving} disabled={!dirty || invalid.length > 0}>
                  Guardar
                </Button>
              </>
            }
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Código PUC</th>
                    <th>Concepto</th>
                    <th>Ubicación en los estados</th>
                    <th style={{ textAlign: "right", width: 200 }}>Valor</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((r, i) => {
                    const m = data.mappingMap.get(r.pucCode);
                    const line = m?.lineId ? data.catalog?.lines.find((l) => l.id === m.lineId) : undefined;
                    return (
                      <tr key={i}>
                        <td>
                          <PucField index={data.index} value={r.pucCode || undefined} onChange={(code) => update(i, { pucCode: code })} placeholder="Buscar PUC" mappings={data.mappingMap} onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])} />
                        </td>
                        <td>{r.pucCode ? (data.index.concepts.get(r.pucCode) ?? "—") : "—"}</td>
                        <td>
                          {!r.pucCode ? (
                            "—"
                          ) : m ? (
                            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setClassifying(r.pucCode)}>
                              {m.excluded ? "No afecta Estados Financieros" : line ? lineLabel(line) : "—"}
                            </button>
                          ) : (
                            <Button size="sm" variant="primary" onClick={() => setClassifying(r.pucCode)}>
                              Clasificar
                            </Button>
                          )}
                        </td>
                        <td>
                          <Input className="input--right" value={r.text} invalid={r.text.trim() !== "" && r.cents === null} placeholder="-2.000.000" onChange={(e) => update(i, { text: e.target.value })} />
                        </td>
                        <td className="actions">
                          <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} aria-label="Eliminar fila" onClick={() => { setRows((prev) => prev.filter((_, j) => j !== i)); setDirty(true); }} />
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
