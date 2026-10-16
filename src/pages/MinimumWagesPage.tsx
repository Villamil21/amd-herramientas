import { useState } from "react";
import { Check, Pencil, Plus, X } from "lucide-react";
import { Alert, Button, Card, Input, Loader, PageHeader, useToast } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { MoneyInput } from "../modules/calculators/contributions/components/MoneyInput";
import { minimumWageService } from "../services/minimumWageService";
import { formatInteger } from "../utils/format";

const pesos = (v: number | null | undefined) => (v ? `$${formatInteger(v)}` : "—");

/**
 * Datos → SMMLV por año: tabla histórica compacta (Año · SMMLV · Auxilio de
 * transporte · Acciones). Un valor por año, editable fila por fila y sin años
 * repetidos. Configuración local y manual (nunca se consulta Internet); la usan
 * las Calculadoras y Estados Financieros → Nómina.
 */
export function MinimumWagesPage() {
  const toast = useToast();
  const data = useAsync(() => minimumWageService.list(), []);
  const wages = [...(data.data ?? [])].sort((a, b) => b.year - a.year);
  /** Fila en edición: año existente, o "new" para la fila de agregar. */
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [year, setYear] = useState("");
  const [wage, setWage] = useState<number | null>(null);
  const [aux, setAux] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const yearNumber = /^\d{4}$/.test(year.trim()) ? Number(year.trim()) : null;
  const duplicate = editing === "new" && yearNumber !== null && wages.some((w) => w.year === yearNumber);
  const nextYear = String((wages[0]?.year ?? new Date().getFullYear()) + 1);

  function startAdd() {
    setEditing("new");
    setYear(nextYear);
    setWage(null);
    setAux(null);
  }

  function startEdit(y: number) {
    const w = wages.find((x) => x.year === y)!;
    setEditing(y);
    setWage(w.valuePesos);
    setAux(w.transportAllowancePesos ?? null);
  }

  async function save() {
    if (editing === null || !wage) return toast("Escribe el SMMLV en pesos, mayor que cero.", "error");
    if (editing === "new" && !aux) return toast("Escribe el auxilio de transporte: un año no se guarda incompleto.", "error");
    setSaving(true);
    try {
      if (editing === "new") {
        if (yearNumber === null || duplicate) return;
        await minimumWageService.create(yearNumber, wage, aux!);
        toast(`Año ${yearNumber} agregado.`);
      } else {
        const w = wages.find((x) => x.year === editing)!;
        if (wage !== w.valuePesos) await minimumWageService.update(editing, wage);
        if ((aux || null) !== (w.transportAllowancePesos ?? null)) await minimumWageService.setTransportAllowance(editing, aux || null);
        toast(`Valores de ${editing} guardados.`);
      }
      setEditing(null);
      await data.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  const editActions = (
    <>
      <Button size="sm" variant="primary" iconOnly icon={<Check size={14} />} aria-label="Guardar" title="Guardar" loading={saving} disabled={!wage || (editing === "new" && (yearNumber === null || duplicate || !aux))} onClick={() => void save()} />
      <Button size="sm" variant="ghost" iconOnly icon={<X size={14} />} aria-label="Cancelar" title="Cancelar" onClick={() => setEditing(null)} disabled={saving} />
    </>
  );

  return (
    <>
      <PageHeader
        eyebrow="Datos"
        title="SMMLV por año"
        description="Valores locales y manuales (no se actualizan desde Internet). Los usan la Calculadora de aportes para Independientes y Estados Financieros → Nómina."
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={startAdd} disabled={editing !== null}>
            Agregar año
          </Button>
        }
      />
      {data.error && <Alert tone="danger">{data.error}</Alert>}
      {data.loading && !data.data ? (
        <Loader />
      ) : (
        <Card flush className="narrow-card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Año</th>
                  <th className="num">SMMLV</th>
                  <th className="num">Auxilio transporte</th>
                  <th style={{ width: 96 }} className="num">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {editing === "new" && (
                  <tr className="is-edited">
                    <td>
                      <Input aria-label="Año" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" invalid={duplicate} title={duplicate ? "Ese año ya está registrado" : undefined} autoFocus />
                    </td>
                    <td className="num">
                      <MoneyInput aria-label="SMMLV" className="input--right" value={wage} onChange={setWage} invalid={!wage} title={!wage ? "Obligatorio" : undefined} />
                    </td>
                    <td className="num">
                      <MoneyInput aria-label="Auxilio de transporte" className="input--right" value={aux} onChange={setAux} invalid={!aux} title={!aux ? "Obligatorio" : undefined} />
                    </td>
                    <td className="actions">{editActions}</td>
                  </tr>
                )}
                {wages.map((w) =>
                  editing === w.year ? (
                    <tr key={w.year} className="is-edited">
                      <td className="table__primary">{w.year}</td>
                      <td className="num">
                        <MoneyInput aria-label={`SMMLV ${w.year}`} className="input--right" value={wage} onChange={setWage} invalid={!wage} autoFocus />
                      </td>
                      <td className="num">
                        <MoneyInput aria-label={`Auxilio de transporte ${w.year}`} className="input--right" value={aux} onChange={setAux} />
                      </td>
                      <td className="actions">{editActions}</td>
                    </tr>
                  ) : (
                    <tr key={w.year}>
                      <td className="table__primary">{w.year}</td>
                      <td className="num">{pesos(w.valuePesos)}</td>
                      <td className="num">{w.transportAllowancePesos ? pesos(w.transportAllowancePesos) : <span className="muted">Sin configurar</span>}</td>
                      <td className="actions">
                        <Button size="sm" variant="ghost" iconOnly icon={<Pencil size={14} />} aria-label={`Editar ${w.year}`} title="Editar" disabled={editing !== null} onClick={() => startEdit(w.year)} />
                      </td>
                    </tr>
                  ),
                )}
                {wages.length === 0 && editing !== "new" && (
                  <tr>
                    <td colSpan={4} className="muted" style={{ textAlign: "center", padding: "var(--space-6)" }}>
                      No hay valores registrados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
