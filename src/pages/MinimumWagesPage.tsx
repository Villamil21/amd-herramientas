import { useState } from "react";
import { Plus, Save } from "lucide-react";
import { Alert, Button, Card, Field, Input, Loader, PageHeader, useToast } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { MoneyInput } from "../modules/calculators/contributions/components/MoneyInput";
import { minimumWageService } from "../services/minimumWageService";

/**
 * Datos → SMMLV por año: un valor por año, editable y sin años repetidos.
 * Configuración local y manual (nunca se consulta Internet); la usan las
 * Calculadoras y puede reutilizarla cualquier módulo.
 */
export function MinimumWagesPage() {
  const toast = useToast();
  const data = useAsync(() => minimumWageService.list(), []);
  const wages = data.data ?? [];
  const [edits, setEdits] = useState<Record<number, number | null>>({});
  const [newYear, setNewYear] = useState("");
  const [newPesos, setNewPesos] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const changed = wages.filter((w) => edits[w.year] !== undefined && edits[w.year] !== w.valuePesos);
  const invalid = changed.some((w) => !edits[w.year]);
  const yearNumber = /^\d{4}$/.test(newYear.trim()) ? Number(newYear.trim()) : null;
  const duplicate = yearNumber !== null && wages.some((w) => w.year === yearNumber);

  async function saveEdits() {
    if (invalid) return toast("Escribe el SMMLV en pesos, mayor que cero.", "error");
    setSaving(true);
    try {
      for (const w of changed) await minimumWageService.update(w.year, edits[w.year]!);
      toast(changed.length === 1 ? `SMMLV ${changed[0].year} guardado.` : "SMMLV guardados.");
      setEdits({});
      await data.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function add() {
    if (yearNumber === null || duplicate || !newPesos) return;
    setSaving(true);
    try {
      await minimumWageService.create(yearNumber, newPesos);
      toast(`SMMLV ${yearNumber} agregado.`);
      setNewYear("");
      setNewPesos(null);
      await data.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  const nextYear = String((wages[wages.length - 1]?.year ?? new Date().getFullYear()) + 1);

  return (
    <>
      <PageHeader eyebrow="Datos" title="SMMLV por año" />
      {data.error && <Alert tone="danger">{data.error}</Alert>}
      {data.loading && !data.data ? (
        <Loader />
      ) : (
        <>
          <Card title="Agregar año">
            <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
              <Field label="Año" error={duplicate ? "Ese año ya está registrado: edita su valor abajo." : null}>
                {(id) => <Input id={id} value={newYear} onChange={(e) => setNewYear(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder={nextYear} inputMode="numeric" style={{ width: 110 }} invalid={duplicate} />}
              </Field>
              <Field label="SMMLV">
                {(id) => <MoneyInput id={id} value={newPesos} onChange={setNewPesos} style={{ width: 180 }} />}
              </Field>
              <Button icon={<Plus size={14} />} onClick={() => void add()} disabled={yearNumber === null || duplicate || !newPesos || saving}>
                Agregar
              </Button>
            </div>
          </Card>

          <Card
            flush
            title="Valores registrados"
            description="Configuración local y manual: el SMMLV no se actualiza desde Internet. Lo usa la Calculadora de aportes para Independientes."
            actions={
              <Button variant="primary" icon={<Save size={14} />} onClick={() => void saveEdits()} loading={saving} disabled={changed.length === 0}>
                Guardar cambios
              </Button>
            }
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Año</th>
                    <th className="num">Valor SMMLV</th>
                  </tr>
                </thead>
                <tbody>
                  {wages.map((w) => {
                    const pesos = edits[w.year] === undefined ? w.valuePesos : edits[w.year];
                    return (
                      <tr key={w.year}>
                        <td className="table__primary">{w.year}</td>
                        <td className="num" style={{ width: 220 }}>
                          <MoneyInput aria-label={`SMMLV ${w.year}`} className="input--right" value={pesos} onChange={(v) => setEdits((prev) => ({ ...prev, [w.year]: v }))} invalid={!pesos} />
                        </td>
                      </tr>
                    );
                  })}
                  {wages.length === 0 && (
                    <tr>
                      <td colSpan={2} className="muted" style={{ textAlign: "center", padding: "var(--space-6)" }}>
                        No hay valores registrados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
