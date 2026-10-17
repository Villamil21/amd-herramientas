import { useState } from "react";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState } from "../../../../components/ui";
import { MONTHS_ES } from "../../../../utils/dates";
import { formatInteger } from "../../../../utils/format";
import { formatExactCents } from "../../shared/money";
import type { CryptoData } from "../useCryptoData";
import type { CryptoModel } from "../domain/model";
import type { CryptoUpload } from "../domain/types";
import { cryptoService } from "../../../../services/cryptoService";
import { operationName } from "./UploadDetailModal";

interface Props {
  data: CryptoData;
  model: CryptoModel;
  onDetail: (u: CryptoUpload) => void;
  onCoverage: (uploadId: number) => void;
}

/** Operaciones: cargas vigentes, cobertura por mes, posibles duplicados y filas pendientes. */
export function OperationsTab({ data, model, onDetail, onCoverage }: Props) {
  const { state } = data;
  const [retire, setRetire] = useState<CryptoUpload | null>(null);
  const unresolved = model.groups.filter((g) => !g.resolved);
  const resolved = model.groups.filter((g) => g.resolved);
  const outOfYear = model.operations.filter((o) => o.status === "pending" && o.issues.some((i) => i.code === "year" || i.code === "date"));
  const [confirmBulk, setConfirmBulk] = useState(false);
  const pendingRows = model.operations.filter((o) => o.status === "pending" && o.issues.some((i) => i.code !== "duplicate"));

  async function setStatus(u: CryptoUpload, status: "active" | "retired") {
    await cryptoService.setStatus(u.id, status);
    await data.reloadState();
  }

  if (!state) return null;
  return (
    <div className="stack">
      <Card flush title="Archivos cargados" description="Las cargas son acumulativas: cada archivo vigente suma a la empresa y al año. Importar un nombre ya existente lo reemplaza (con confirmación).">
        {state.uploads.length === 0 ? (
          <EmptyState title="Sin archivos" description="Importa un Excel con las hojas «Compras» y «Ventas»." />
        ) : (
          <div className="table-wrap">
            <table className="table table--dense">
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Versión</th>
                  <th>Cobertura</th>
                  <th className="num">Filas</th>
                  <th className="num">Pendientes</th>
                  <th className="num">Excluidas</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {model.reconciliation.uploads.map((r) => {
                  const u = state.uploads.find((x) => x.id === r.id)!;
                  return (
                    <tr key={r.id}>
                      <td>{r.fileName}</td>
                      <td>{r.version}</td>
                      <td>{r.coverage}</td>
                      <td className="num">{formatInteger(r.rows)}</td>
                      <td className="num">{formatInteger(r.pending)}</td>
                      <td className="num">{formatInteger(r.excluded)}</td>
                      <td>
                        <Badge tone={u.status === "active" ? "success" : "dark"}>{u.status === "active" ? "Vigente" : "Retirada"}</Badge>
                      </td>
                      <td className="nowrap" style={{ textAlign: "right" }}>
                        <Button size="sm" variant="ghost" onClick={() => onDetail(u)}>
                          Detalle
                        </Button>
                        {u.status === "active" && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => onCoverage(u.id)}>
                              Cobertura
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRetire(u)}>
                              Retirar
                            </Button>
                          </>
                        )}
                        {u.status === "retired" && (
                          <Button size="sm" variant="ghost" onClick={() => void setStatus(u, "active")}>
                            Reactivar
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card flush title="Cobertura por mes" description="Un mes solo queda cubierto con filas aceptadas. Si tiene filas pendientes, se muestran aparte y el mes no se marca como cubierto hasta aceptarlas o excluirlas.">
        <div className="table-wrap">
          <table className="table table--dense">
            <thead>
              <tr>
                <th>Mes</th>
                <th>Archivos que lo cubren</th>
                <th>Pendientes por resolver</th>
              </tr>
            </thead>
            <tbody>
              {model.matrix.map((m, i) => (
                <tr key={m.month}>
                  <td>{MONTHS_ES[i].charAt(0) + MONTHS_ES[i].slice(1).toLowerCase()}</td>
                  <td>{m.uploads.length ? m.uploads.map((u) => u.fileName).join(", ") : <span className="muted">{m.pending.length ? "No cubierto" : "Sin archivo"}</span>}</td>
                  <td>
                    {m.pending.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      m.pending.map((p) => (
                        <div key={p.fileName}>
                          <strong>{formatInteger(p.pending.count)}</strong> {p.pending.count === 1 ? "fila" : "filas"} · {p.pending.reasons.map((r) => `${r.reason}: ${formatInteger(r.count)}`).join(", ")} <span className="muted">({p.fileName})</span>
                        </div>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {model.coverages.some((c) => c.unmonthed.outOfYear + c.unmonthed.unreadableDate + c.unmonthed.sales > 0) && (
          <p className="muted" style={{ padding: "8px 12px" }}>
            Pendientes que no pertenecen a ningún mes del año:{" "}
            {model.coverages
              .map((c) => ({ c, parts: [c.unmonthed.outOfYear && `${formatInteger(c.unmonthed.outOfYear)} compras de otro año`, c.unmonthed.unreadableDate && `${formatInteger(c.unmonthed.unreadableDate)} compras con fecha ilegible`, c.unmonthed.sales && `${formatInteger(c.unmonthed.sales)} ventas (no traen fecha)`].filter(Boolean) }))
              .filter((x) => x.parts.length)
              .map((x) => `${x.c.fileName}: ${x.parts.join(", ")}`)
              .join(" · ")}
            .
          </p>
        )}
      </Card>

      {unresolved.length > 0 && (
        <Card flush title="Posibles duplicados pendientes" description="Nunca se omiten solos: sus filas no cuentan hasta que decidas.">
          <div className="stack stack--sm" style={{ padding: 12 }}>
            {unresolved.map((g) => (
              <div key={g.id} className="card" style={{ padding: 12 }}>
                <div className="row row--between" style={{ flexWrap: "wrap" }}>
                  <strong>
                    {g.kind === "purchase" ? "Compras" : "Ventas"} · {g.level === "exact" ? "idénticas" : "probable duplicado"}
                  </strong>
                  <span className="muted">{g.basis}</span>
                </div>
                <table className="table table--dense">
                  <tbody>
                    {g.members.map((o) => (
                      <tr key={o.id}>
                        <td>
                          {o.fileName} · fila {o.rowNumber}
                        </td>
                        <td>{operationName(o)}</td>
                        <td className="num nowrap">{o.amountCents === null ? "—" : formatExactCents(o.amountCents)}</td>
                        <td className="nowrap" style={{ textAlign: "right" }}>
                          <Button size="sm" variant="ghost" onClick={() => void data.decide("duplicate", o.identity, "exclude")}>
                            Excluir esta fila
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Button
                  size="sm"
                  onClick={() => void data.decideMany("duplicate", g.members.map((o) => ({ key: o.identity, value: "keep" })))}
                >
                  Conservar ambos
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
      {resolved.length > 0 && (
        <Alert tone="info">
          {resolved.length} {resolved.length === 1 ? "grupo de duplicados ya decidido" : "grupos de duplicados ya decididos"}.
        </Alert>
      )}

      {pendingRows.length > 0 && (
        <Card
          flush
          title="Filas pendientes"
          description="Compras con fecha fuera del año o ilegible, o valores ilegibles. No cuentan hasta que las excluyas o corrijas el archivo."
          actions={
            outOfYear.length > 1 ? (
              <Button size="sm" onClick={() => setConfirmBulk(true)}>
                Excluir las {formatInteger(outOfYear.length)} filas fuera del año
              </Button>
            ) : undefined
          }
        >
          <div className="table-wrap">
            <table className="table table--dense">
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Fila</th>
                  <th>Fecha en el archivo</th>
                  <th>Motivo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pendingRows.slice(0, 300).map((o) => (
                  <tr key={o.id}>
                    <td>{o.fileName}</td>
                    <td>{o.rowNumber}</td>
                    <td className="nowrap">{o.dateRaw || "—"}</td>
                    <td>{o.issues.map((i) => i.message).join(" · ")}</td>
                    <td style={{ textAlign: "right" }}>
                      <Button size="sm" variant="ghost" onClick={() => void data.decide("row_exclude", o.identity, "exclude")}>
                        Excluir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {state.audit.length > 0 && (
        <Card flush title="Auditoría">
          <div className="table-wrap" style={{ maxHeight: 220, overflow: "auto" }}>
            <table className="table table--dense">
              <tbody>
                {state.audit.slice(0, 50).map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{a.createdAt.slice(0, 16).replace("T", " ")}</td>
                    <td>{a.event}</td>
                    <td className="muted">{JSON.stringify(a.detail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmBulk}
        title="Excluir filas fuera del año"
        message={`Se excluirán ${formatInteger(outOfYear.length)} compras con fecha fuera del año ${model.year} o ilegible. Quedan registradas como decisiones y puedes deshacerlas corrigiendo el archivo y reimportándolo con el mismo nombre.`}
        confirmLabel="Excluir"
        danger
        onCancel={() => setConfirmBulk(false)}
        onConfirm={async () => {
          setConfirmBulk(false);
          await data.decideMany("row_exclude", outOfYear.map((o) => ({ key: o.identity, value: "exclude" })));
        }}
      />
      <ConfirmDialog
        open={retire !== null}
        title="Retirar archivo"
        message={`«${retire?.fileName}» deja de alimentar Estados Financieros y Exógena. Se conserva para auditoría y puedes reactivarlo.`}
        confirmLabel="Retirar"
        danger
        onCancel={() => setRetire(null)}
        onConfirm={async () => {
          if (retire) await setStatus(retire, "retired");
          setRetire(null);
        }}
      />
    </div>
  );
}
