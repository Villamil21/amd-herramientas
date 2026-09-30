import { useState } from "react";
import { FileQuestion, Store } from "lucide-react";
import { Alert, Button, Card, useToast } from "../../../../components/ui";
import { withholdingService } from "../../../../services/withholdingService";
import type { TitleCategory } from "../../../../types/models";
import { formatInteger } from "../../../../utils/format";
import type { FiscalChange, FiscalConflict, PendingSupplier, UnknownTitle, WithholdingReport } from "../types";

const docs = (n: number) => (n === 1 ? "1 documento" : `${formatInteger(n)} documentos`);

/** Periodo detectado (mes predominante) o selector cuando hay empate. */
export function PeriodPanel({ period, onChoose }: { period: WithholdingReport["period"]; onChoose: (key: string) => void }) {
  if (period.months.length === 0) return null;
  if (period.tie.length > 0 && !period.key) {
    return (
      <Alert tone="warning" title="Hay el mismo número de documentos en varios meses. ¿Qué periodo deseas procesar?">
        <div className="row" style={{ marginTop: 6 }}>
          {period.tie.map((m) => (
            <Button key={m.key} size="sm" onClick={() => onChoose(m.key)}>
              {m.label} ({docs(m.count)})
            </Button>
          ))}
        </div>
      </Alert>
    );
  }
  const others = period.months.filter((m) => m.key !== period.key);
  return (
    <Card>
      <div className="row row--between">
        <div>
          <div className="muted" style={{ fontSize: "var(--text-sm)" }}>
            Periodo detectado
          </div>
          <div style={{ fontSize: "var(--text-xl)", fontWeight: 600 }}>{period.label}</div>
        </div>
        {others.length > 0 && (
          <span className="muted" style={{ fontSize: "var(--text-sm)" }}>
            Excluidos por fecha: {others.map((m) => `${m.label} (${docs(m.count)})`).join(" · ")}
          </span>
        )}
        {period.tie.length > 0 && (
          <div className="row">
            {period.tie.map((m) => (
              <Button key={m.key} size="sm" variant={m.key === period.key ? "primary" : "secondary"} onClick={() => onChoose(m.key)}>
                {m.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Proveedores sin configuración de retención: uno por NIT. */
export function PendingSuppliersPanel({ pending, onConfigure }: { pending: PendingSupplier[]; onConfigure: (p: PendingSupplier) => void }) {
  const n = pending.length;
  return (
    <Card
      flush
      title={n === 1 ? "1 proveedor pendiente" : `${n} proveedores pendientes`}
      description="Completa PJ / PN, tipo, subtipo y modo de base. Se guarda en Proveedores y se aplica automáticamente en los próximos lotes."
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Proveedor</th>
              <th>NIT</th>
              <th>Tipo contribuyente</th>
              <th>Régimen</th>
              <th className="num">Documentos</th>
              <th>Falta</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pending.map((p) => (
              <tr key={p.nit}>
                <td className="table__primary">
                  <span className="row">
                    <Store size={14} className="muted" aria-hidden />
                    {p.name || <span className="muted">Sin razón social</span>}
                  </span>
                </td>
                <td className="selectable">{p.nit}</td>
                <td>{p.taxpayerType ?? "—"}</td>
                <td className="selectable">{p.fiscalRegime || "—"}</td>
                <td className="num">{p.documentCount}</td>
                <td>{p.supplierId ? p.missing.join(", ") : "Proveedor nuevo"}</td>
                <td className="actions">
                  <Button size="sm" variant="primary" onClick={() => onConfigure(p)}>
                    {p.supplierId ? "Completar" : "Crear proveedor"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Títulos nuevos: se preguntan una vez y la decisión se guarda. */
export function UnknownTitlesPanel({ titles, onSaved }: { titles: UnknownTitle[]; onSaved: () => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState<string | null>(null);

  async function classify(t: UnknownTitle, category: TitleCategory) {
    setSaving(t.normalizedTitle);
    try {
      await withholdingService.saveTitles([{ normalizedTitle: t.normalizedTitle, displayTitle: t.displayTitle, category }]);
      toast(`«${t.displayTitle}» se clasificó como ${category === "invoice" ? "Factura" : "Nota"}.`);
      onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Alert tone="warning" title="Títulos de documento nuevos: ¿dónde deseas clasificarlos?">
      <div className="stack stack--sm" style={{ marginTop: 6 }}>
        {titles.map((t) => (
          <div key={t.normalizedTitle} className="row row--between">
            <span className="row">
              <FileQuestion size={14} aria-hidden />
              <strong>{t.displayTitle}</strong> <span className="muted">({docs(t.documentCount)})</span>
            </span>
            <span className="row">
              <Button size="sm" onClick={() => void classify(t, "invoice")} loading={saving === t.normalizedTitle} disabled={saving !== null}>
                Factura
              </Button>
              <Button size="sm" onClick={() => void classify(t, "credit_note")} disabled={saving !== null}>
                Nota
              </Button>
            </span>
          </div>
        ))}
      </div>
    </Alert>
  );
}

interface FiscalProps {
  changes: FiscalChange[];
  missing: WithholdingReport["fiscalMissing"];
  conflicts: FiscalConflict[];
  onDismiss: (c: FiscalChange) => void;
  onUpdated: () => void;
}

/** Cambios de régimen / responsabilidad fiscal frente a lo guardado y conflictos dentro del lote. */
export function FiscalPanels({ changes, missing, conflicts, onDismiss, onUpdated }: FiscalProps) {
  const toast = useToast();
  const [saving, setSaving] = useState<string | null>(null);

  async function update(items: { supplierId: number; detected: string }[], key: string, message: string) {
    setSaving(key);
    try {
      for (const i of items) await withholdingService.setFiscalRegime(i.supplierId, i.detected);
      toast(message);
      onUpdated();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      {conflicts.length > 0 && (
        <Alert tone="danger" title="Códigos fiscales diferentes para un mismo NIT en este lote (no se actualiza automáticamente)">
          <ul>
            {conflicts.map((c) => (
              <li key={c.nit}>
                <strong>{c.name || c.nit}</strong> (NIT {c.nit}):{" "}
                {c.variants.map((v) => `${v.regime} en ${v.files.join(", ")}`).join(" · ")}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {changes.map((c) => (
        <Alert key={c.nit} tone="warning" title="Se detectó un cambio en la información fiscal del proveedor.">
          <div className="row row--between" style={{ marginTop: 4 }}>
            <span>
              <strong>{c.name}</strong> (NIT {c.nit}) · Guardado: <strong>{c.stored}</strong> · Detectado ahora: <strong>{c.detected}</strong>{" "}
              <span className="muted">({c.files.join(", ")})</span>
            </span>
            <span className="row">
              <Button size="sm" variant="primary" loading={saving === c.nit} disabled={saving !== null} onClick={() => void update([c], c.nit, "Proveedor actualizado.")}>
                Actualizar proveedor
              </Button>
              <Button size="sm" onClick={() => onDismiss(c)} disabled={saving !== null}>
                Mantener información guardada
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDismiss(c)} disabled={saving !== null}>
                Revisar después
              </Button>
            </span>
          </div>
        </Alert>
      ))}
      {missing.length > 0 && (
        <Alert tone="info" title={missing.length === 1 ? "1 proveedor no tiene régimen fiscal guardado" : `${missing.length} proveedores no tienen régimen fiscal guardado`}>
          <div className="row row--between" style={{ marginTop: 4 }}>
            <span>{missing.map((m) => `${m.name} → ${m.detected}`).join(" · ")}</span>
            <Button size="sm" loading={saving === "missing"} disabled={saving !== null} onClick={() => void update(missing, "missing", "Régimen fiscal guardado en los proveedores.")}>
              Actualizar automáticamente
            </Button>
          </div>
        </Alert>
      )}
    </>
  );
}
