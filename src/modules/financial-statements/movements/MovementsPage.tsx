import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCcw } from "lucide-react";
import { navigate, paths } from "../../../app/router";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, useToast } from "../../../components/ui";
import { useDebounced } from "../../../hooks/useDebounced";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import { MOVEMENT_STATUS_LABEL, SOURCE_LABEL, type BatchSummary, type FsSource, type Movement, type MovementStatus } from "../../../types/fs";
import { formatInteger } from "../../../utils/format";
import { normalizeKey } from "../../../utils/text";
import { CompanySelect } from "../shared/components/CompanySelect";
import { PucField } from "../shared/components/PucField";
import { formatExactCents, formatIsoDate } from "../shared/money";
import { useFsData } from "../shared/useFsData";
import { bankAccountingCents, isDebitPuc } from "../generator/engine";

/** Submódulo donde nace cada origen (para «Abrir origen»). */
export const SOURCE_PATH: Record<FsSource, string> = {
  purchases: paths.submodule("estados-financieros", "codigos-puc-por-factura"),
  bank: paths.submodule("estados-financieros", "extractos-bancarios"),
  payroll: paths.submodule("estados-financieros", "nomina"),
  sales_einvoice: paths.provider("estados-financieros", "ventas", "facturacion-electronica"),
  sales_tpsv: paths.provider("estados-financieros", "ventas", "reporte-de-operaciones"),
  opening: paths.submodule("estados-financieros", "saldos-iniciales"),
  adjustment: paths.submodule("estados-financieros", "generador"),
};

const MAX_ROWS = 500;

/**
 * Auditoría de movimientos contables: revisión y trazabilidad, no edición
 * libre. La única acción es «Reclasificar movimientos anteriores» (explícita).
 */
export default function MovementsPage() {
  const toast = useToast();
  const data = useFsData();
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [filters, setFilters] = useState({ from: "", to: "", source: "", puc: "", party: "", bank: "", document: "", period: "", status: "active" });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<Movement | null>(null);
  const [reclassifyTo, setReclassifyTo] = useState<string | undefined>();
  const [reclassifying, setReclassifying] = useState(false);
  const text = useDebounced(filters, 150);

  const load = useCallback(async () => {
    if (companyId === null) return;
    try {
      const [m, b] = await Promise.all([fsService.movements(companyId), fsService.batches(companyId)]);
      setMovements(m);
      setBatches(b);
      setSelected(new Set());
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [companyId, toast]);

  useEffect(() => {
    setMovements([]);
    void load();
  }, [load]);

  const batchById = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);
  const filtered = useMemo(() => {
    const has = (value: string, q: string) => !q || normalizeKey(value).includes(normalizeKey(q));
    return movements.filter(
      (m) =>
        (!text.from || m.accountingDate >= text.from) &&
        (!text.to || m.accountingDate <= text.to) &&
        (!text.source || m.source === text.source) &&
        (!text.status || m.status === text.status) &&
        (!text.period || m.accountingDate.startsWith(text.period)) &&
        (!text.puc || m.pucCode.startsWith(text.puc.trim())) &&
        has(`${m.supplierNit} ${m.supplierName} ${m.description}`, text.party) &&
        has(`${m.bank} ${m.accountNumber}`, text.bank) &&
        has(`${m.documentNumber} ${m.documentId}`, text.document),
    );
  }, [movements, text]);
  const shown = filtered.slice(0, MAX_ROWS);
  const total = filtered.reduce((s, m) => s + m.amountCents, 0);
  const set = (key: keyof typeof filters) => (e: { target: { value: string } }) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const selectable = shown.filter((m) => m.status === "active" && m.source !== "adjustment");

  async function reclassify() {
    if (!reclassifyTo || selected.size === 0) return;
    setReclassifying(true);
    try {
      const n = await fsService.reclassify(companyId, [...selected], reclassifyTo);
      toast(`${formatInteger(n)} movimientos reclasificados a ${reclassifyTo}.`);
      setReclassifyTo(undefined);
      await load();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setReclassifying(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Estados Financieros" title="Movimientos contables" description="Revisión y trazabilidad de todo lo enviado a Estados Financieros. No es una pantalla para editar la contabilidad." />
      <Card>
        <div className="stack">
          <CompanySelect companies={data.companies} value={companyId} onChange={setCompanyId} />
          {companyId !== null && (
            <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
              <Field label="Desde">{(id) => <Input id={id} type="date" value={filters.from} onChange={set("from")} />}</Field>
              <Field label="Hasta">{(id) => <Input id={id} type="date" value={filters.to} onChange={set("to")} />}</Field>
              <Field label="Periodo">{(id) => <Input id={id} type="month" value={filters.period} onChange={set("period")} />}</Field>
              <Field label="Origen">
                {(id) => (
                  <Select id={id} value={filters.source} onChange={set("source")}>
                    <option value="">Todos</option>
                    {Object.entries(SOURCE_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Estado">
                {(id) => (
                  <Select id={id} value={filters.status} onChange={set("status")}>
                    <option value="">Todos</option>
                    {Object.entries(MOVEMENT_STATUS_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Código PUC">{(id) => <Input id={id} value={filters.puc} onChange={set("puc")} placeholder="5135" inputMode="numeric" />}</Field>
              <Field label="Proveedor / empleado">{(id) => <Input id={id} value={filters.party} onChange={set("party")} placeholder="Nombre o NIT" />}</Field>
              <Field label="Banco">{(id) => <Input id={id} value={filters.bank} onChange={set("bank")} placeholder="BBVA" />}</Field>
              <Field label="Documento">{(id) => <Input id={id} value={filters.document} onChange={set("document")} placeholder="Número o CUFE" />}</Field>
            </div>
          )}
        </div>
      </Card>

      {companyId !== null && (
        <>
          {selected.size > 0 && (
            <Alert tone="info" title={`Reclasificar movimientos anteriores (${formatInteger(selected.size)} seleccionados)`}>
              Cambia el código PUC de los movimientos seleccionados. No cambia asociaciones futuras ni periodos cerrados.
              <div className="row" style={{ marginTop: 8 }}>
                <PucField index={data.index} value={reclassifyTo} onChange={setReclassifyTo} placeholder="Elegir PUC nuevo" mappings={data.mappingMap} onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])} />
                <Button variant="primary" icon={<RefreshCcw size={14} />} disabled={!reclassifyTo} loading={reclassifying} onClick={() => void reclassify()}>
                  Reclasificar
                </Button>
                <Button variant="ghost" onClick={() => setSelected(new Set())}>
                  Quitar selección
                </Button>
              </div>
            </Alert>
          )}
          <Card flush title={`${formatInteger(filtered.length)} movimientos`} description={`Suma de los filtrados: ${formatExactCents(total)}${filtered.length > MAX_ROWS ? ` · Se muestran los primeros ${MAX_ROWS}` : ""}`}>
            {filtered.length === 0 ? (
              <EmptyState title="Sin movimientos" description="No hay movimientos con estos filtros." />
            ) : (
              <div className="table-wrap table-wrap--scroll" style={{ maxHeight: "62vh" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Seleccionar todos"
                          checked={selectable.length > 0 && selectable.every((m) => selected.has(m.id))}
                          onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((m) => m.id)) : new Set())}
                        />
                      </th>
                      <th>Fecha</th>
                      <th>Origen</th>
                      <th>Documento</th>
                      <th>Tercero / descripción</th>
                      <th>PUC</th>
                      <th style={{ textAlign: "right" }}>Valor</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((m) => (
                      <tr key={m.id} className="is-clickable" onClick={() => setOpen(m)}>
                        <td onClick={(e) => e.stopPropagation()}>
                          {m.status === "active" && m.source !== "adjustment" && (
                            <input
                              type="checkbox"
                              aria-label="Seleccionar movimiento"
                              checked={selected.has(m.id)}
                              onChange={(e) =>
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(m.id);
                                  else next.delete(m.id);
                                  return next;
                                })
                              }
                            />
                          )}
                        </td>
                        <td>{formatIsoDate(m.accountingDate)}</td>
                        <td>
                          {SOURCE_LABEL[m.source]}
                          <div className="table__secondary">Importación #{m.batchId}</div>
                        </td>
                        <td>{m.documentNumber || "—"}</td>
                        <td>
                          <span className="table__primary">{m.supplierName || (m.bank ? `${m.bank} ${m.accountNumber}` : "")}</span>
                          <div className="table__secondary">{m.description}</div>
                        </td>
                        <td>
                          <span className="mono">{m.pucCode}</span>
                          <div className="table__secondary">{m.pucConcept}</div>
                        </td>
                        <td style={{ textAlign: "right" }} className={m.amountCents < 0 ? "amount--negative" : undefined}>
                          {formatExactCents(m.amountCents)}
                          {m.dc && <div className="table__secondary">{m.dc === "D" ? "Salida del banco" : "Entrada al banco"}</div>}
                        </td>
                        <td>
                          <Badge tone={m.status === "active" ? "success" : m.status === "replaced" ? "warning" : undefined}>{MOVEMENT_STATUS_LABEL[m.status]}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <Modal
        open={open !== null}
        size="lg"
        title={open ? `${SOURCE_LABEL[open.source]} · ${open.description || open.pucConcept}` : ""}
        onClose={() => setOpen(null)}
        footer={
          open && (
            <Button icon={<ExternalLink size={14} />} onClick={() => navigate(SOURCE_PATH[open.source])}>
              Abrir origen
            </Button>
          )
        }
      >
        {open && <MovementDetail movement={open} batch={batchById.get(open.batchId)} />}
      </Modal>
    </>
  );
}

function MovementDetail({ movement: m, batch }: { movement: Movement; batch?: BatchSummary }) {
  const item = (label: string, value: string | number | null | undefined) =>
    value === null || value === undefined || value === "" ? null : (
      <div className="summary-item">
        <span className="summary-item__label">{label}</span>
        <span className="summary-item__value selectable">{value}</span>
      </div>
    );
  const detail = (m.detail ?? {}) as Record<string, unknown>;
  const original = Array.isArray(detail.movements) ? (detail.movements as { date: string; description: string; amountCents: number }[]) : [];
  return (
    <div className="stack">
      <div className="summary-grid">
        {item("Fecha contable", formatIsoDate(m.accountingDate))}
        {item("Valor exacto", formatExactCents(m.amountCents))}
        {item("Dirección bancaria", m.dc && (m.dc === "D" ? "Salida (disminuye el banco)" : "Entrada (aumenta el banco)"))}
        {item("Valor contable", m.dc && `${formatExactCents(bankAccountingCents(m.dc, m.amountCents, isDebitPuc(m.pucCode)))} (naturaleza ${isDebitPuc(m.pucCode) ? "débito" : "crédito"} del PUC)`)}
        {item("Código PUC", `${m.pucCode} — ${m.pucConcept}`)}
        {item("Estado", MOVEMENT_STATUS_LABEL[m.status as MovementStatus])}
        {item("Documento", m.documentNumber)}
        {item("Tipo de documento", m.documentType)}
        {item("ID del documento", m.documentId)}
        {item("Proveedor", m.supplierName && `${m.supplierName} (NIT ${m.supplierNit})`)}
        {item("Banco / cuenta", m.bank && `${m.bank} ${m.accountNumber}`)}
        {item("Paga la cuenta por pagar el", m.settlesOn && formatIsoDate(m.settlesOn))}
        {item("Concepto interno", m.conceptKey)}
        {item("Registrado", m.createdAt.replace("T", " ").slice(0, 19))}
      </div>
      {batch && (
        <Alert tone="info" title={`Importación #${batch.id} · ${SOURCE_LABEL[batch.source]}`}>
          {[batch.fileName, batch.periodLabel].filter(Boolean).join(" · ")} · {formatInteger(batch.recordCount)} registros · {batch.createdAt.slice(0, 10)} · {batch.status === "active" ? "Activa" : batch.status === "replaced" ? `Reemplazada${batch.replacedBy ? ` por la importación #${batch.replacedBy}` : ""}` : "Anulada"}
        </Alert>
      )}
      {original.length > 0 && (
        <div className="table-wrap" style={{ maxHeight: 260 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Movimiento original del extracto</th>
                <th style={{ textAlign: "right" }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {original.map((o, i) => (
                <tr key={i}>
                  <td>{o.date}</td>
                  <td>{o.description}</td>
                  <td style={{ textAlign: "right" }}>{formatExactCents(o.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {Array.isArray(detail.reclassified) && <Alert tone="warning" title="Reclasificado" items={(detail.reclassified as { from: string; to: string; at: string }[]).map((r) => `${r.from} → ${r.to} (${r.at.slice(0, 10)})`)} />}
    </div>
  );
}
