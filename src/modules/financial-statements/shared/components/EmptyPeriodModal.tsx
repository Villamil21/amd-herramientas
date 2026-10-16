import { useEffect, useMemo, useState } from "react";
import { CalendarX2, Undo2 } from "lucide-react";
import { Alert, Badge, Button, ConfirmDialog, Field, Modal, Select, useToast } from "../../../../components/ui";
import { fsService } from "../../../../services/fsService";
import { errorMessage } from "../../../../services/tauri";
import { EMPTY_PERIOD_LABEL, isEmptyPeriodBatch, type BatchSummary, type EmptyPeriodSource } from "../../../../types/fs";
import type { Company } from "../../../../types/models";
import { formatDateForDisplay } from "../../../../utils/dates";
import { describeMonths, MONTH_NAMES, monthsBetween, periodLabel } from "../money";
import { CompanySelect } from "./CompanySelect";

/** Lo que el usuario confirma explícitamente para cada fuente (queda en la trazabilidad). */
const CONFIRMATION: Record<EmptyPeriodSource, string> = {
  purchases: "Confirmo que la empresa no tuvo facturas de compra en este periodo.",
  payroll: "Confirmo que la empresa no tuvo nómina (empleados con pago) en este periodo.",
  sales_einvoice: "Confirmo que la empresa no emitió facturas de venta electrónicas en este periodo.",
  sales_tpsv: "Confirmo que la empresa no tuvo operaciones en el reporte de este periodo.",
};

const WHAT: Record<EmptyPeriodSource, string> = {
  purchases: "compras",
  payroll: "nómina",
  sales_einvoice: "ventas",
  sales_tpsv: "operaciones",
};

interface Props {
  open: boolean;
  source: EmptyPeriodSource;
  companies: Company[] | null;
  /** Empresa propuesta (la de la pantalla); se puede cambiar. */
  companyId: number | null;
  /** Mes propuesto AAAA-MM (p. ej. el detectado o el anterior al actual). */
  defaultMonth?: string | null;
  onClose: () => void;
  /** Tras registrar o anular (para recargar la cobertura). */
  onChanged?: () => void;
}

function previousMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Mes AAAA-MM con dos selects (mes · año): el campo de mes nativo no existe en WebKit. */
function MonthPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const year = Number(value.slice(0, 4));
  const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() + 1 - i);
  if (!years.includes(year)) years.push(year);
  return (
    <Field label={label}>
      {(id) => (
        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          <Select id={id} aria-label={`${label}: mes`} value={value.slice(5, 7)} onChange={(e) => onChange(`${value.slice(0, 4)}-${e.target.value}`)}>
            {MONTH_NAMES.map((n, i) => (
              <option key={n} value={String(i + 1).padStart(2, "0")}>
                {n}
              </option>
            ))}
          </Select>
          <Select aria-label={`${label}: año`} value={year} onChange={(e) => onChange(`${e.target.value}-${value.slice(5, 7)}`)} style={{ width: 96 }}>
            {years
              .sort((a, b) => b - a)
              .map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
          </Select>
        </div>
      )}
    </Field>
  );
}

/**
 * «Registrar periodo sin compras / nómina / ventas / operaciones»: empresa,
 * periodo (uno o varios meses), confirmación explícita y registrar. Crea
 * cobertura válida para el Generador sin crear movimientos contables. Si algún
 * mes ya tiene información real, lo advierte y solo sigue si el usuario lo
 * acepta. Muestra los registros vigentes de la empresa (con «Anular»).
 */
export function EmptyPeriodModal({ open, source, companies, companyId, defaultMonth, onClose, onChanged }: Props) {
  const toast = useToast();
  const label = EMPTY_PERIOD_LABEL[source];
  const [company, setCompany] = useState<number | null>(companyId);
  const [from, setFrom] = useState(defaultMonth ?? previousMonth());
  const [to, setTo] = useState(defaultMonth ?? previousMonth());
  const [confirmed, setConfirmed] = useState(false);
  const [withData, setWithData] = useState<string[] | null>(null);
  const [acceptData, setAcceptData] = useState(false);
  const [saving, setSaving] = useState(false);
  const [registered, setRegistered] = useState<BatchSummary[]>([]);
  const [voiding, setVoiding] = useState<BatchSummary | null>(null);

  useEffect(() => {
    if (!open) return;
    setCompany(companyId);
    setFrom(defaultMonth ?? previousMonth());
    setTo(defaultMonth ?? previousMonth());
    setConfirmed(false);
    setWithData(null);
    setAcceptData(false);
  }, [open, companyId, defaultMonth]);

  const loadRegistered = useMemo(
    () => async (id: number | null) => {
      if (!id) return setRegistered([]);
      try {
        const batches = await fsService.batches(id);
        setRegistered(batches.filter((b) => b.source === source && b.status === "active" && isEmptyPeriodBatch(b)).sort((a, b) => (b.periodStart ?? "").localeCompare(a.periodStart ?? "")));
      } catch {
        setRegistered([]);
      }
    },
    [source],
  );
  useEffect(() => {
    if (open) void loadRegistered(company);
  }, [open, company, loadRegistered]);

  const months = from <= to ? monthsBetween(`${from}-01`, `${to}-01`) : [];
  const tooLong = months.length > 24;
  const already = new Set(registered.map((b) => b.periodStart?.slice(0, 7)));
  const fresh = months.filter((m) => !already.has(m));
  const blocked = !company ? "Elige la empresa." : from > to ? "El mes final es anterior al inicial." : tooLong ? "Máximo 24 meses por registro." : fresh.length === 0 ? `Ese periodo ya está registrado como «${label}».` : !confirmed ? "Marca la confirmación." : withData && !acceptData ? "Acepta la advertencia o cancela." : null;

  async function register() {
    if (blocked || !company) return;
    setSaving(true);
    try {
      const outcome = await fsService.registerEmptyPeriod({ companyId: company, source, months: fresh, confirmation: CONFIRMATION[source], allowWithData: acceptData });
      if (outcome.kind === "hasData") {
        setWithData(outcome.months);
        return;
      }
      toast(`${describeMonths(fresh)} registrado como «${label}».`);
      onChanged?.();
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function voidRegistration() {
    if (!voiding) return;
    setSaving(true);
    try {
      await fsService.voidEmptyPeriod(voiding.id, `Anulado desde «Registrar periodo ${label.toLowerCase()}»`);
      toast(`Registro de ${periodLabel(voiding.periodStart!.slice(0, 7))} anulado.`);
      setVoiding(null);
      await loadRegistered(company);
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Modal
        open={open && !voiding}
        title={`Registrar periodo ${label.toLowerCase()}`}
        description={`Cubre el periodo en el Generador sin crear movimientos contables. Si después se importan ${WHAT[source]} reales de ese periodo, se pedirá reemplazar este registro.`}
        onClose={onClose}
        locked={saving}
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button variant="primary" icon={<CalendarX2 size={15} />} loading={saving} disabled={blocked !== null} title={blocked ?? undefined} onClick={() => void register()}>
              Registrar
            </Button>
          </>
        }
      >
        <div className="stack">
          <CompanySelect companies={companies} value={company} onChange={(id) => (setCompany(id), setWithData(null), setAcceptData(false))} />
          <div className="form-grid">
            <MonthPicker label="Desde" value={from} onChange={(v) => (setFrom(v), setWithData(null), setAcceptData(false), to < v && setTo(v))} />
            <MonthPicker label="Hasta" value={to} onChange={(v) => (setTo(v), setWithData(null), setAcceptData(false))} />
          </div>
          {months.length > 0 && !tooLong && (
            <p className="muted" style={{ margin: 0 }}>
              Periodo: <strong>{describeMonths(months)}</strong>
              {fresh.length < months.length && fresh.length > 0 && ` · ya registrado: ${describeMonths(months.filter((m) => already.has(m)))}`}
            </p>
          )}
          <label className="checkbox">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>{CONFIRMATION[source]}</span>
          </label>
          {withData && (
            <Alert tone="warning" title={`${describeMonths(withData)} ya tiene ${WHAT[source]} reales enviadas a Estados Financieros.`}>
              <label className="checkbox">
                <input type="checkbox" checked={acceptData} onChange={(e) => setAcceptData(e.target.checked)} />
                <span>Registrar de todas formas (las {WHAT[source]} enviadas no se modifican).</span>
              </label>
            </Alert>
          )}
          {registered.length > 0 && (
            <div className="stack stack--sm">
              <div className="field__label">Registrados {label.toLowerCase()}</div>
              <div className="table-wrap">
                <table className="table table--dense">
                  <thead>
                    <tr>
                      <th>Periodo</th>
                      <th>Confirmado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {registered.map((b) => (
                      <tr key={b.id}>
                        <td className="nowrap">
                          <Badge tone="success">✓ {label}</Badge> {periodLabel(b.periodStart!.slice(0, 7))}
                        </td>
                        <td className="nowrap">{formatDateForDisplay(String(b.metadata?.confirmedAt ?? b.createdAt))}</td>
                        <td className="actions">
                          <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} onClick={() => setVoiding(b)}>
                            Anular
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={voiding !== null}
        danger
        title="Anular registro"
        confirmLabel="Anular"
        loading={saving}
        message={voiding ? <>{periodLabel(voiding.periodStart!.slice(0, 7))} dejará de estar cubierto como «{label}». El registro queda anulado (no se borra).</> : null}
        onCancel={() => setVoiding(null)}
        onConfirm={() => void voidRegistration()}
      />
    </>
  );
}
