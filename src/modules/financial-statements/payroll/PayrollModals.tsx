import { useEffect, useState } from "react";
import { Alert, Button, DateInput, Field, Input, Modal, Select, Textarea, useToast } from "../../../components/ui";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import { AREA_LABEL, type Area, type Employee } from "../../../types/fs";
import { areaFor } from "./calc";
import { formatExactCents, lastDayOfMonth, periodLabel, todayIso } from "../shared/money";
import { formatDateForDisplay, formatDateTimeForDisplay } from "../../../utils/dates";

function useSave(onDone: () => void | Promise<unknown>) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>, message: string) {
    setSaving(true);
    setError(null);
    try {
      await action();
      toast(message);
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  return { saving, error, setError, run };
}

const footer = (saving: boolean, onClose: () => void, onSave: () => void, label: string, disabled = false) => (
  <>
    <Button variant="ghost" onClick={onClose} disabled={saving}>
      Cancelar
    </Button>
    <Button variant="primary" onClick={onSave} loading={saving} disabled={disabled}>
      {label}
    </Button>
  </>
);

/** Ficha obligatoria de un empleado que aparece por primera vez. La fecha de ingreso la escribe el usuario. */
export function EmployeeFormModal({ open, companyId, docType, docNumber, name, period, onClose, onSaved }: { open: boolean; companyId: number; docType: string; docNumber: string; name: string; period: string; onClose: () => void; onSaved: () => void | Promise<unknown> }) {
  const [values, setValues] = useState({ name: "", hireDate: "", area: "" });
  const { saving, error, run } = useSave(onSaved);
  useEffect(() => {
    if (open) setValues({ name, hireDate: "", area: "" });
  }, [open, name]);
  const ready = values.name.trim() && /^\d{4}-\d{2}-\d{2}$/.test(values.hireDate) && values.area;
  const save = () => void run(() => fsService.createEmployee({ companyId, docType, docNumber, name: values.name, hireDate: values.hireDate, area: values.area, effectiveFrom: period }), "Ficha del empleado creada.");
  return (
    <Modal open={open} title="Empleado nuevo" description={`${docType} ${docNumber} aparece por primera vez. Completa su ficha.`} onClose={onClose} locked={saving} footer={footer(saving, onClose, save, "Guardar ficha", !ready)}>
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="form-grid">
          <Field label="Tipo de documento">{(id) => <Input id={id} value={docType} disabled />}</Field>
          <Field label="Número de documento">{(id) => <Input id={id} value={docNumber} disabled />}</Field>
          <Field label="Nombre" required className="span-2">
            {(id) => <Input id={id} value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} />}
          </Field>
          <Field label="Fecha de ingreso" required hint="Escríbela tal como figura en el contrato.">
            {(id) => <DateInput id={id} value={values.hireDate} onChange={(hireDate) => setValues((v) => ({ ...v, hireDate }))} />}
          </Field>
          <Field label="Área contable" required hint={`Vigente desde ${periodLabel(period)}.`}>
            {(id) => (
              <Select id={id} value={values.area} onChange={(e) => setValues((v) => ({ ...v, area: e.target.value }))}>
                <option value="">Seleccionar…</option>
                <option value="admin">Administración</option>
                <option value="sales">Ventas</option>
              </Select>
            )}
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/** Reingreso: nueva vinculación con su propia fecha de ingreso (las provisiones no se mezclan). */
export function RehireModal({ employee, onClose, onSaved }: { employee: Employee | null; onClose: () => void; onSaved: () => void | Promise<unknown> }) {
  const [hireDate, setHireDate] = useState("");
  const { saving, error, run } = useSave(onSaved);
  useEffect(() => setHireDate(""), [employee]);
  const last = employee?.employments[employee.employments.length - 1];
  const save = () => employee && void run(() => fsService.addEmployment(employee.id, hireDate), "Reingreso registrado.");
  return (
    <Modal open={employee !== null} title="Reingreso" description={employee ? `${employee.name} (${employee.docType} ${employee.docNumber}) fue liquidado el ${formatDateForDisplay(last?.endDate)}. Se abrirá la vinculación #${(last?.number ?? 0) + 1}.` : ""} onClose={onClose} locked={saving} footer={footer(saving, onClose, save, "Registrar reingreso", !/^\d{4}-\d{2}-\d{2}$/.test(hireDate))}>
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Fecha de reingreso" required>
          {(id) => <DateInput id={id} value={hireDate} onChange={setHireDate} />}
        </Field>
      </div>
    </Modal>
  );
}

/** Liquidación del empleado: lo acumulado por pagar (prima, cesantías, intereses, vacaciones) queda pagado en esa fecha. */
export function LiquidationModal({ employee, lastPeriod, onClose, onSaved }: { employee: Employee | null; lastPeriod: string; onClose: () => void; onSaved: () => void | Promise<unknown> }) {
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const { saving, error, run } = useSave(onSaved);
  useEffect(() => {
    if (employee) {
      setDate(lastDayOfMonth(lastPeriod));
      setNotes("");
    }
  }, [employee, lastPeriod]);
  const employment = employee?.employments.find((j) => !j.endDate);
  const save = () =>
    employment &&
    void run(async () => {
      const l = await fsService.registerLiquidation({ employmentId: employment.id, liquidationDate: date, lastPeriod, notes });
      return l;
    }, "Liquidación registrada.");
  return (
    <Modal
      open={employee !== null}
      title="Registrar liquidación"
      description={employee ? `${employee.name} · ${employee.docType} ${employee.docNumber} · Vinculación #${employment?.number ?? "—"} desde ${formatDateForDisplay(employment?.hireDate)}` : ""}
      onClose={onClose}
      locked={saving}
      footer={footer(saving, onClose, save, "Registrar liquidación", !employment || !/^\d{4}-\d{2}-\d{2}$/.test(date))}
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="form-grid">
          <Field label="Fecha de liquidación" required>{(id) => <DateInput id={id} value={date} onChange={setDate} />}</Field>
          <Field label="Último periodo trabajado">{(id) => <Input id={id} value={periodLabel(lastPeriod)} disabled />}</Field>
          <Field label="Motivo / observación" className="span-2">{(id) => <Textarea id={id} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        </div>
        <span className="field__hint">Se registran la prima, cesantías, intereses y vacaciones acumulados por pagar de esta vinculación. El gasto ya causado no cambia.</span>
      </div>
    </Modal>
  );
}

/** «No se retiró / justificar ausencia»: texto obligatorio que queda guardado. */
export function JustifyAbsenceModal({ employee, period, onClose, onSaved }: { employee: Employee | null; period: string; onClose: () => void; onSaved: () => void | Promise<unknown> }) {
  const [text, setText] = useState("");
  const { saving, error, run } = useSave(onSaved);
  useEffect(() => setText(""), [employee]);
  const save = () => employee && void run(() => fsService.justifyAbsence(employee.id, period, text), "Ausencia justificada.");
  return (
    <Modal open={employee !== null} title="No se retiró / justificar ausencia" description={employee ? `${employee.name} no aparece en la planilla de ${periodLabel(period)}.` : ""} onClose={onClose} locked={saving} footer={footer(saving, onClose, save, "Guardar justificación", !text.trim())}>
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Justificación" required>
          {(id) => <Textarea id={id} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ej. licencia no remunerada" />}
        </Field>
      </div>
    </Modal>
  );
}

/** Cambio de área desde un periodo (no reescribe el histórico). */
export function AreaChangeModal({ employee, period, onClose, onSaved }: { employee: Employee | null; period: string; onClose: () => void; onSaved: () => void | Promise<unknown> }) {
  const [area, setArea] = useState<Area | "">("");
  const { saving, error, run } = useSave(onSaved);
  useEffect(() => setArea(""), [employee]);
  const save = () => employee && area && void run(() => fsService.setEmployeeArea(employee.id, area, period), "Área actualizada desde este periodo.");
  return (
    <Modal open={employee !== null} title="Cambiar área contable" description={employee ? `${employee.name}: el área nueva rige desde ${periodLabel(period)}. Los periodos anteriores conservan la suya.` : ""} onClose={onClose} locked={saving} footer={footer(saving, onClose, save, "Guardar", !area)}>
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        {employee && (
          <div className="field__hint">
            Historial: {employee.areas.map((a) => `${AREA_LABEL[a.area]} desde ${periodLabel(a.effectiveFrom)}`).join(" · ")}
          </div>
        )}
        <Field label="Área desde este periodo" required>
          {(id) => (
            <Select id={id} value={area} onChange={(e) => setArea(e.target.value as Area)}>
              <option value="">Seleccionar…</option>
              <option value="admin">Administración</option>
              <option value="sales">Ventas</option>
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}

const FIELD_LABEL: Record<string, string> = { docType: "Tipo de documento", docNumber: "Número", name: "Nombre", hireDate: "Fecha de ingreso", area: "Área", areaFrom: "Área desde" };

const fieldValue = (key: string, value: unknown) =>
  value === null || value === undefined || value === "" ? "—" : key === "area" ? (AREA_LABEL[value as Area] ?? String(value)) : key === "areaFrom" ? periodLabel(String(value)) : key === "hireDate" ? formatDateForDisplay(String(value)) : String(value);

/**
 * «Editar empleado»: corrige la ficha sin eliminarla. Un cambio de área no
 * reescribe el pasado: rige desde el mes indicado (los meses anteriores y la
 * nómina ya enviada conservan su área). Cada edición queda en el historial.
 */
export function EmployeeEditModal({ employee, period, onClose, onSaved }: { employee: Employee | null; period: string; onClose: () => void; onSaved: () => void | Promise<unknown> }) {
  const [values, setValues] = useState({ docType: "", docNumber: "", name: "", hireDate: "", area: "" as Area | "", areaFrom: "" });
  const { saving, error, run } = useSave(onSaved);
  const employment = employee?.employments[employee.employments.length - 1];
  useEffect(() => {
    if (!employee) return;
    const from = period || todayIso().slice(0, 7);
    setValues({ docType: employee.docType, docNumber: employee.docNumber, name: employee.name, hireDate: employment?.hireDate ?? "", area: areaFor(employee, from) ?? "", areaFrom: from });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee, period]);
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const currentArea = employee && /^\d{4}-\d{2}$/.test(values.areaFrom) ? areaFor(employee, values.areaFrom) : undefined;
  const areaChanged = Boolean(values.area) && values.area !== currentArea;
  const ready = values.docType.trim() && values.docNumber.trim() && values.name.trim() && /^\d{4}-\d{2}-\d{2}$/.test(values.hireDate) && (!areaChanged || /^\d{4}-\d{2}$/.test(values.areaFrom));
  const save = () =>
    employee &&
    void run(
      () =>
        fsService.updateEmployee({
          employeeId: employee.id,
          docType: values.docType,
          docNumber: values.docNumber,
          name: values.name,
          hireDate: values.hireDate,
          area: areaChanged ? (values.area as Area) : null,
          areaFrom: areaChanged ? values.areaFrom : null,
        }),
      "Ficha del empleado actualizada.",
    );
  return (
    <Modal
      open={employee !== null}
      title="Editar empleado"
      description={employee ? `${employee.name} · ${employee.docType} ${employee.docNumber}. Los cambios no modifican la nómina ya enviada.` : ""}
      onClose={onClose}
      locked={saving}
      footer={footer(saving, onClose, save, "Guardar cambios", !ready)}
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="form-grid">
          <Field label="Tipo de documento" required>
            {(id) => <Input id={id} value={values.docType} onChange={set("docType")} />}
          </Field>
          <Field label="Número de documento" required hint="Es la llave con la que se reconoce en la planilla.">
            {(id) => <Input id={id} value={values.docNumber} onChange={set("docNumber")} />}
          </Field>
          <Field label="Nombre" required className="span-2">
            {(id) => <Input id={id} value={values.name} onChange={set("name")} />}
          </Field>
          <Field label="Fecha de ingreso" required hint={employment ? `Vinculación #${employment.number}${employment.endDate ? ` (liquidada el ${formatDateForDisplay(employment.endDate)})` : " vigente"}.` : undefined}>
            {(id) => <DateInput id={id} value={values.hireDate} onChange={(v) => set("hireDate")({ target: { value: v } })} />}
          </Field>
          <span />
          <Field label="Área contable" required hint={currentArea ? `Vigente en ${periodLabel(values.areaFrom)}: ${AREA_LABEL[currentArea]}.` : undefined}>
            {(id) => (
              <Select id={id} value={values.area} onChange={set("area")}>
                <option value="">Seleccionar…</option>
                <option value="admin">Administración</option>
                <option value="sales">Ventas</option>
              </Select>
            )}
          </Field>
          <Field label="Área nueva rige desde" required={areaChanged} hint="Los meses anteriores conservan su área.">
            {(id) => <Input id={id} type="month" value={values.areaFrom} onChange={set("areaFrom")} />}
          </Field>
        </div>
        {areaChanged && currentArea && (
          <Alert tone="info">
            Desde {periodLabel(values.areaFrom)}: {AREA_LABEL[values.area as Area]}. Los meses anteriores conservan {AREA_LABEL[currentArea]}. Para corregir meses ya enviados, reemplaza el envío de
            esa planilla.
          </Alert>
        )}
        {employee && (
          <div className="stack stack--sm">
            <div className="field__hint">Historial de área: {employee.areas.map((a) => `${AREA_LABEL[a.area]} desde ${periodLabel(a.effectiveFrom)}`).join(" · ")}</div>
            {employee.events.length > 0 && (
              <ul className="fs-history">
                {[...employee.events].reverse().map((e, i) => (
                  <li key={i}>
                    <span>
                      {Object.keys(e.next ?? {})
                        .filter((k) => k !== "areaFrom")
                        .map((k) => `${FIELD_LABEL[k] ?? k}: ${fieldValue(k, e.previous?.[k])} → ${fieldValue(k, e.next?.[k])}`)
                        .join(" · ")}
                      {e.next?.areaFrom ? ` (desde ${fieldValue("areaFrom", e.next.areaFrom)})` : ""}
                    </span>
                    <span className="muted">{formatDateTimeForDisplay(e.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

export const money = formatExactCents;
