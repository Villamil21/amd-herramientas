import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { navigate, paths } from "../../../app/router";
import { Alert, Badge, Button, Card, Input, useToast } from "../../../components/ui";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import { SECTION_LABEL, SOURCE_LABEL } from "../../../types/fs";
import { formatInteger } from "../../../utils/format";
import { formatExactCents, formatIsoDate } from "../shared/money";
import { reclassificationAges, type MappingConflict, type MissingCounterpart, type Reclassification, type ReclassificationReview, type UnclassifiedChild, type UnclassifiedPuc } from "./engine";

const ENTRY_LIMIT = 50;
const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function EntriesTable({ child }: { child: UnclassifiedChild }) {
  const shown = child.entries.slice(0, ENTRY_LIMIT);
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Origen</th>
          <th>Documento</th>
          <th>Descripción</th>
          <th style={{ textAlign: "right" }}>Valor</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((e, i) => (
          <tr key={i}>
            <td>{e.date ? formatIsoDate(e.date) : "—"}</td>
            <td>{e.source ? SOURCE_LABEL[e.source] : "—"}</td>
            <td>{e.documentNumber || "—"}</td>
            <td>{e.description || "—"}</td>
            <td style={{ textAlign: "right" }}>{formatExactCents(e.cents)}</td>
          </tr>
        ))}
        {child.entries.length > shown.length && (
          <tr>
            <td colSpan={5} className="muted">
              y {formatInteger(child.entries.length - shown.length)} movimientos más (se ven completos en Movimientos contables).
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/**
 * Códigos PUC sin clasificar, agrupados por sus primeros cuatro dígitos: una fila por grupo (2370), con sus subcuentas
 * (237005, 237006…) y los movimientos / documentos que lo componen solo como trazabilidad. «Clasificar» decide el grupo completo.
 */
export function UnclassifiedGroups({ items, onClassify }: { items: UnclassifiedPuc[]; onClassify: (code: string, concept: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [openChild, setOpenChild] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (!next.delete(key)) next.add(key);
    return next;
  };
  const q = plain(query.trim());
  const visible = useMemo(
    () =>
      q
        ? items.filter((g) => plain(`${g.pucCode} ${g.concept}`).includes(q) || g.children.some((c) => plain(`${c.pucCode} ${c.concept}`).includes(q) || c.entries.some((e) => plain(`${e.documentNumber} ${e.description}`).includes(q))))
        : items,
    [items, q],
  );
  return (
    <Card
      flush
      title="Códigos PUC sin clasificar"
      description="Se clasifican por los primeros cuatro dígitos: una sola decisión cubre todas las cuentas del grupo. Bloquean el estado «Listo»: asígnalos a una línea del ESF / EERR o márcalos «No afecta Estados Financieros»."
      actions={<Input aria-label="Buscar grupo, cuenta o documento" placeholder="Buscar código, concepto o documento" value={query} onChange={(e) => setQuery(e.target.value)} />}
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th />
              <th>Grupo PUC</th>
              <th>Concepto</th>
              <th style={{ textAlign: "right" }}>Movimientos</th>
              <th style={{ textAlign: "right" }}>Valor</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((u) => {
              const expanded = open.has(u.pucCode) || (q !== "" && u.children.length > 0);
              return (
                <Fragment key={u.pucCode}>
                  <tr className="row-attention--blocking">
                    <td style={{ width: 32 }}>
                      <Button size="sm" variant="ghost" aria-expanded={expanded} aria-label={`${expanded ? "Ocultar" : "Ver"} las cuentas de ${u.pucCode}`} icon={expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} onClick={() => setOpen(toggle(open, u.pucCode))} />
                    </td>
                    <td className="mono">
                      {u.pucCode}
                      <div className="table__secondary">{u.children.length === 1 ? "1 cuenta" : `${u.children.length} cuentas`} del grupo</div>
                    </td>
                    <td>
                      {u.concept}
                      {u.inactiveLine && <div className="table__secondary">Su línea «{u.inactiveLine}» está desactivada.</div>}
                    </td>
                    <td style={{ textAlign: "right" }}>{formatInteger(u.count)}</td>
                    <td style={{ textAlign: "right" }}>{formatExactCents(u.cents)}</td>
                    <td className="actions">
                      <Button size="sm" variant="primary" onClick={() => onClassify(u.pucCode, u.concept)}>
                        Clasificar
                      </Button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td />
                      <td colSpan={5}>
                        <table className="table" aria-label={`Cuentas del grupo ${u.pucCode}`}>
                          <thead>
                            <tr>
                              <th />
                              <th>Código</th>
                              <th>Concepto</th>
                              <th style={{ textAlign: "right" }}>Movimientos</th>
                              <th style={{ textAlign: "right" }}>Valor</th>
                            </tr>
                          </thead>
                          <tbody>
                            {u.children.map((c) => {
                              const key = `${u.pucCode}/${c.pucCode}`;
                              const childOpen = openChild.has(key);
                              return (
                                <Fragment key={key}>
                                  <tr>
                                    <td style={{ width: 32 }}>
                                      <Button size="sm" variant="ghost" aria-expanded={childOpen} aria-label={`${childOpen ? "Ocultar" : "Ver"} los movimientos de ${c.pucCode}`} icon={childOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} onClick={() => setOpenChild(toggle(openChild, key))} />
                                    </td>
                                    <td className="mono">{c.pucCode}</td>
                                    <td>{c.concept}</td>
                                    <td style={{ textAlign: "right" }}>{formatInteger(c.count)}</td>
                                    <td style={{ textAlign: "right" }}>{formatExactCents(c.cents)}</td>
                                  </tr>
                                  {childOpen && (
                                    <tr>
                                      <td />
                                      <td colSpan={4}>
                                        <EntriesTable child={c} />
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Ningún grupo coincide con la búsqueda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Clasificaciones antiguas de subcuentas que se contradicen dentro de un grupo: se resuelven desde el mismo flujo de clasificación. */
export function MappingConflicts({ items, onResolve }: { items: MappingConflict[]; onResolve: (family: string, concept: string) => void }) {
  return (
    <Alert tone="danger" title={items.length === 1 ? "Conflicto de clasificación en 1 grupo PUC" : `Conflicto de clasificación en ${items.length} grupos PUC`}>
      <div className="stack stack--sm">
        <span>Las subcuentas de un mismo grupo tienen clasificaciones antiguas distintas. No se sobrescribió ninguna ni se eligió por ti: decide el grupo completo para consolidarlo.</span>
        {items.map((c) => (
          <div key={c.family} className="stack stack--sm">
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              <strong className="mono">{c.family}</strong>
              <span>{c.concept}</span>
              <span className="muted">
                {formatInteger(c.count)} movimientos · {formatExactCents(c.cents)}
              </span>
              <Button size="sm" variant="primary" onClick={() => onResolve(c.family, c.concept)}>
                Resolver
              </Button>
            </div>
            <ul className="fs-checklist">
              {c.options.map((o) => (
                <li key={o.key}>
                  <span>
                    <strong>{o.label}</strong> · <span className="mono">{o.codes.join(", ")}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Alert>
  );
}

/** Falta la línea no corriente equivalente de una línea corriente con saldos de años anteriores: bloquea y se crea aquí mismo. */
export function MissingCounterparts({ items, onChanged }: { items: MissingCounterpart[]; onChanged: () => void | Promise<unknown> }) {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  async function create(m: MissingCounterpart) {
    setBusy(m.lineId);
    try {
      await fsService.createLine(m.targetSection, m.lineName);
      toast(`«${m.lineName}» creada en ${SECTION_LABEL[m.targetSection]}.`);
      await onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }
  return (
    <Alert tone="danger" title="Falta la línea no corriente equivalente">
      <div className="stack stack--sm">
        <span>
          Hay saldos de años anteriores en líneas corrientes. Se presentan en la línea del mismo nombre de la sección no corriente, y esa línea no existe: mientras tanto el valor sigue en su línea corriente y el periodo queda bloqueado.
        </span>
        {items.map((m) => (
          <div key={m.lineId} className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <span>
              «{m.lineName}» ({SECTION_LABEL[m.section]}) · {formatExactCents(m.cents)} sin reclasificar → falta en {SECTION_LABEL[m.targetSection]}
            </span>
            <Button size="sm" variant="primary" loading={busy === m.lineId} onClick={() => void create(m)}>
              Crear «{m.lineName}»
            </Button>
          </div>
        ))}
        <div className="row">
          <Button size="sm" onClick={() => navigate(paths.fsCatalog)}>
            Abrir Catálogo de cuentas
          </Button>
        </div>
      </div>
    </Alert>
  );
}

/** Saldos que se presentaron en no corriente (resumen por antigüedad y detalle) y cruces sin origen pendientes de revisión. */
export function ReclassificationAudit({ items, reviews, endYear }: { items: Reclassification[]; reviews: ReclassificationReview[]; endYear: string }) {
  const [detail, setDetail] = useState(false);
  const ages = reclassificationAges(items);
  const total = items.reduce((sum, r) => sum + r.pendingCents, 0);
  return (
    <>
      {reviews.length > 0 && (
        <Alert tone="warning" title="Saldos con origen sin determinar" items={reviews.map((r) => `${r.lineName} · ${r.pucCode} ${formatIsoDate(r.date)}${r.document ? ` · ${r.document}` : ""}: ${formatExactCents(r.cents)}. ${r.reason}`)}>
          Revisa estos pagos o cruces en Movimientos contables: sin un saldo de origen no se pueden asignar a un año.
        </Alert>
      )}
      {items.length > 0 && (
        <Card
          flush
          title="Auditoría de reclasificación a no corriente"
          description={`Saldos pendientes originados antes de ${endYear} que se presentan como no corrientes aunque su PUC esté configurado como corriente. Es solo presentación de este periodo: no cambia el PUC ni los movimientos.`}
          actions={
            <Button size="sm" variant="ghost" icon={detail ? <ChevronDown size={14} /> : <ChevronRight size={14} />} aria-expanded={detail} onClick={() => setDetail((v) => !v)}>
              {detail ? "Ocultar detalle" : "Ver detalle"}
            </Button>
          }
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Antigüedad</th>
                  <th style={{ textAlign: "right" }}>Saldos</th>
                  <th style={{ textAlign: "right" }}>Valor reclasificado</th>
                </tr>
              </thead>
              <tbody>
                {ages.map((a) => (
                  <tr key={String(a.originYear)}>
                    <td>{a.originYear === null ? "Obligaciones tributarias de años anteriores" : `Originado en ${a.originYear} · ${a.ageYears === 1 ? "1 año" : `${a.ageYears} años`}`}</td>
                    <td style={{ textAlign: "right" }}>{formatInteger(a.count)}</td>
                    <td style={{ textAlign: "right" }}>{formatExactCents(a.cents)}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>Total reclasificado</strong>
                  </td>
                  <td />
                  <td style={{ textAlign: "right" }}>
                    <strong>{formatExactCents(total)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {detail && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Origen</th>
                    <th>PUC</th>
                    <th>Documento</th>
                    <th>Línea corriente → línea presentada</th>
                    <th style={{ textAlign: "right" }}>Valor original</th>
                    <th style={{ textAlign: "right" }}>Aplicado</th>
                    <th style={{ textAlign: "right" }}>Pendiente</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r, i) => (
                    <tr key={i}>
                      <td>
                        {r.originDate ? formatIsoDate(r.originDate) : "Años anteriores"}
                        {r.source && <div className="table__secondary">{SOURCE_LABEL[r.source]}</div>}
                      </td>
                      <td className="mono">
                        {r.pucCode}
                        <div className="table__secondary">{r.concept}</div>
                      </td>
                      <td>{r.document || "—"}</td>
                      <td>
                        {r.lineName} <Badge tone="neutral">corriente</Badge> → {r.targetLineName} <Badge tone="warning">no corriente</Badge>
                      </td>
                      <td style={{ textAlign: "right" }}>{formatExactCents(r.originalCents)}</td>
                      <td style={{ textAlign: "right" }}>{formatExactCents(r.appliedCents)}</td>
                      <td style={{ textAlign: "right" }}>{formatExactCents(r.pendingCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
