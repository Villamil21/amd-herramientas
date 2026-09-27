import { useState } from "react";
import { Percent, Plus, Trash2 } from "lucide-react";
import { navigate, paths } from "../../../../app/router";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Select } from "../../../../components/ui";
import { ConceptFormModal } from "../../../../pages/concepts/ConceptFormModal";
import { TIPO_RETENCION_LABEL, UNIDAD_TARIFA_SYMBOL, type Concept } from "../../../../types/models";
import { formatMoneyCents, formatRate } from "../../../../utils/format";
import { parseRate } from "../../../../utils/numbers";
import { certificateTitle, resolveTipo, retainedCents } from "../logic/calculations";
import type { CertificateConceptLine } from "../logic/certificateModel";
import { newLineKey } from "../draft";

interface Props {
  concepts: Concept[];
  baseCents: number;
  lines: CertificateConceptLine[];
  onLines: (lines: CertificateConceptLine[]) => void;
  consignadoEn: string;
  onConsignadoEn: (v: string) => void;
  errors: string[];
  onConceptsChanged: () => void;
  onBack: () => void;
  onNext: () => void;
}

export function ConceptsStep(p: Props) {
  const [showErrors, setShowErrors] = useState(false);
  const [creating, setCreating] = useState(false);

  const update = (key: string, patch: Partial<CertificateConceptLine>) =>
    p.onLines(p.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const selectConcept = (key: string, id: string) => {
    const c = p.concepts.find((x) => x.id === Number(id));
    update(key, c
      ? { conceptId: c.id, nombre: c.nombre, tipo: resolveTipo(c), unidad: c.unidadTarifa, rateText: c.tarifaPredeterminada != null ? formatRate(c.tarifaPredeterminada) : "" }
      : { conceptId: null, nombre: "", tipo: null, unidad: null, rateText: "" });
  };

  const addLine = () => p.onLines([...p.lines, { key: newLineKey(), conceptId: null, nombre: "", tipo: null, unidad: null, rateText: "" }]);

  const tipos = p.lines.flatMap((l) => (l.tipo ? [l.tipo] : []));

  return (
    <Card
      title="Conceptos y tarifas"
      description={
        <>
          Todos los conceptos usan la base calculada: <strong>{formatMoneyCents(p.baseCents)}</strong>
        </>
      }
      actions={tipos.length > 0 && <Badge tone="dark">{certificateTitle(tipos)}</Badge>}
      footer={
        <div className="wizard-actions" style={{ width: "100%" }}>
          <Button variant="ghost" onClick={p.onBack}>
            Volver
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setShowErrors(true);
              if (p.errors.length === 0) p.onNext();
            }}
          >
            Ver vista previa
          </Button>
        </div>
      }
    >
      <div className="stack">
        {p.concepts.length === 0 ? (
          <EmptyState
            icon={<Percent size={20} />}
            title="Aún no hay conceptos de retención"
            description="Crea los conceptos una sola vez; quedarán guardados para los próximos certificados."
            action={
              <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
                Nuevo concepto
              </Button>
            }
          />
        ) : (
          <>
            <div className="table-wrap card">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: "46%" }}>Concepto</th>
                    <th>Tipo</th>
                    <th style={{ width: 150 }}>Tarifa</th>
                    <th className="num">Valor retenido</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {p.lines.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 20 }}>
                        Agrega al menos un concepto.
                      </td>
                    </tr>
                  )}
                  {p.lines.map((line) => {
                    const rate = parseRate(line.rateText);
                    const value = rate !== null && line.unidad ? retainedCents(p.baseCents, rate, line.unidad) : null;
                    return (
                      <tr key={line.key}>
                        <td>
                          <Select value={line.conceptId ?? ""} onChange={(e) => selectConcept(line.key, e.target.value)} invalid={showErrors && !line.conceptId}>
                            <option value="">Selecciona un concepto…</option>
                            {p.concepts.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.nombre}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td>{line.tipo ? <Badge tone={line.tipo === "ICA" ? "gold" : "dark"}>{TIPO_RETENCION_LABEL[line.tipo]}</Badge> : <span className="muted">—</span>}</td>
                        <td>
                          <div className="input-affix">
                            <Input
                              className="input--right"
                              value={line.rateText}
                              onChange={(e) => update(line.key, { rateText: e.target.value })}
                              invalid={showErrors && (rate === null || rate <= 0)}
                              disabled={!line.conceptId}
                              inputMode="decimal"
                              aria-label="Tarifa"
                            />
                            <span className="input-affix__suffix" title={line.unidad === "POR_MIL" ? "Por mil" : "Porcentaje"}>
                              {line.unidad ? UNIDAD_TARIFA_SYMBOL[line.unidad] : ""}
                            </span>
                          </div>
                        </td>
                        <td className="num">{value !== null && rate! > 0 ? formatMoneyCents(value) : <span className="muted">—</span>}</td>
                        <td className="actions">
                          <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} aria-label="Quitar concepto" onClick={() => p.onLines(p.lines.filter((l) => l.key !== line.key))} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="row row--between">
              <div className="row">
                <Button icon={<Plus size={15} />} onClick={addLine}>
                  Agregar concepto
                </Button>
                <Button variant="ghost" onClick={() => setCreating(true)}>
                  Crear concepto nuevo
                </Button>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate(paths.concepts)}>
                Administrar conceptos
              </Button>
            </div>
          </>
        )}

        <div className="form-grid">
          <Field label="Consignado en" required hint="Tomado de la ciudad de la empresa emisora; puedes modificarlo para este certificado.">
            {(id) => <Input id={id} value={p.consignadoEn} onChange={(e) => p.onConsignadoEn(e.target.value)} invalid={showErrors && !p.consignadoEn.trim()} />}
          </Field>
        </div>

        {showErrors && p.errors.length > 0 && <Alert tone="danger" title="Completa la información para continuar" items={p.errors} />}
      </div>

      <ConceptFormModal
        open={creating}
        concept={null}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          p.onConceptsChanged();
        }}
      />
    </Card>
  );
}
