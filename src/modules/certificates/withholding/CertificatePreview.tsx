import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { CertificateDocument } from "./logic/certificateModel";
import { COLORS, FONT_SIZES, LAYOUT, PAGE } from "./pdf/layout";

/** Distancia aproximada línea base → borde superior en Helvetica. */
const top = (baseline: number, size: number) => baseline - size * 0.8;

function T({ x, y, size, color, bold, align = "left", children }: { x: number; y: number; size: number; color: string; bold?: boolean; align?: "left" | "right" | "center"; children: React.ReactNode }) {
  const style: CSSProperties = { top: top(y, size), fontSize: size, color, fontWeight: bold ? 700 : 400 };
  if (align === "left") style.left = x;
  if (align === "right") style.right = PAGE.width - x;
  if (align === "center") Object.assign(style, { left: 0, right: 0, textAlign: "center" });
  return (
    <p className="paper__abs" style={style}>
      {children}
    </p>
  );
}

/**
 * Vista previa HTML a escala del mismo modelo que genera el PDF
 * (misma geometría: pdf/layout.ts).
 */
export function CertificatePreview({ doc }: { doc: CertificateDocument }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(Math.min(1.3, Math.max(0.5, (entry.contentRect.width - 8) / PAGE.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const t = LAYOUT.table;
  const issuerLines = [doc.issuer.razonSocial, doc.issuer.nit ? `NIT ${doc.issuer.nit}` : "", doc.issuer.telefono, doc.issuer.direccion].filter(Boolean);
  const cell = { size: FONT_SIZES.tableText, color: COLORS.tableText };
  const bodyMin = t.minBottom - t.headerBottom;

  return (
    <div className="paper-stage" ref={stageRef}>
      <div className="paper-frame" style={{ width: PAGE.width * scale, minHeight: PAGE.height * scale }}>
        <div className="paper" style={{ width: PAGE.width, minHeight: PAGE.height, transform: `scale(${scale})` }}>
          {doc.issuer.logoDataUrl && (
            <img
              className="paper__abs"
              src={doc.issuer.logoDataUrl}
              alt=""
              style={{ left: LAYOUT.logo.x, top: LAYOUT.logo.y, width: LAYOUT.logo.w, height: LAYOUT.logo.h, objectFit: "contain" }}
            />
          )}
          {issuerLines.map((line, i) => (
            <T key={i} x={LAYOUT.issuer.right} y={LAYOUT.issuer.firstBaseline + i * LAYOUT.issuer.lineHeight} size={FONT_SIZES.issuer} color={COLORS.issuer} align="right">
              {line}
            </T>
          ))}
          <T x={0} y={LAYOUT.title.baseline} size={FONT_SIZES.title} color={COLORS.title} bold align="center">
            {doc.title}
          </T>
          {doc.info.map((item, i) => {
            const y = LAYOUT.info.firstBaseline + i * LAYOUT.info.lineHeight;
            return (
              <div key={item.label}>
                <T x={LAYOUT.info.labelX} y={y} size={FONT_SIZES.info} color={COLORS.label} bold>
                  {item.label}
                </T>
                <T x={LAYOUT.info.valueX} y={y} size={FONT_SIZES.info} color={COLORS.value}>
                  {item.value}
                </T>
              </div>
            );
          })}

          {/* Tabla y pie en flujo normal para que crezcan con los conceptos */}
          <div style={{ position: "absolute", top: t.top, left: t.left, width: t.right - t.left }}>
            <div style={{ position: "relative", height: t.headerBottom - t.top, borderTop: `0.6px solid ${COLORS.line}`, borderBottom: `0.6px solid ${COLORS.line}` }}>
              {[
                { label: "CONCEPTO", x: t.concept.numberX },
                { label: doc.rateHeader, x: t.rateX },
                { label: "BASE DE RETENCIÓN", x: t.baseX },
              ].map((h) => (
                <T key={h.label} x={h.x - t.left} y={t.headerBaseline - t.top} size={FONT_SIZES.tableHeader} color={COLORS.tableHeader} bold>
                  {h.label}
                </T>
              ))}
              {/* alineado al borde derecho de la tabla (T usa right = PAGE.width − x) */}
              <T x={PAGE.width - (t.right - t.valueRight)} y={t.headerBaseline - t.top} size={FONT_SIZES.tableHeader} color={COLORS.tableHeader} bold align="right">
                VALOR RETENIDO
              </T>
            </div>
            <div style={{ position: "relative", minHeight: bodyMin, borderBottom: `0.6px solid ${COLORS.line}`, paddingTop: t.firstRowBaseline - t.headerBottom - cell.size * 0.8, paddingBottom: 4 }}>
              {t.columns.map((x) => (
                <span key={x} className="paper__abs" style={{ left: x - t.left, top: 0, bottom: 0, width: 0, borderLeft: `0.6px solid ${COLORS.line}` }} />
              ))}
              {doc.rows.map((row) => (
                <div key={row.index} style={{ position: "relative", fontSize: cell.size, color: cell.color, lineHeight: `${t.lineHeight}px`, marginBottom: t.rowGap, minHeight: t.lineHeight }}>
                  <span className="paper__abs" style={{ left: t.concept.numberX - t.left, top: 0, lineHeight: `${t.lineHeight}px` }}>
                    {row.index}.
                  </span>
                  <div style={{ marginLeft: t.concept.textX - t.left, width: t.concept.maxWidth, lineHeight: `${t.lineHeight}px` }}>{row.concepto}</div>
                  <span className="paper__abs" style={{ left: t.rateX - t.left, top: 0, lineHeight: `${t.lineHeight}px` }}>
                    {row.tasa}
                  </span>
                  <span className="paper__abs" style={{ left: t.baseX - t.left, top: 0, lineHeight: `${t.lineHeight}px` }}>
                    {row.base}
                  </span>
                  <span className="paper__abs" style={{ right: t.right - t.valueRight, top: 0, lineHeight: `${t.lineHeight}px` }}>
                    {row.valor}
                  </span>
                </div>
              ))}
            </div>
            <p style={{ margin: `${LAYOUT.footer.gapAfterTable - FONT_SIZES.footer}px 0 40px ${LAYOUT.footer.x - t.left}px`, fontSize: FONT_SIZES.footer, fontWeight: 700, color: COLORS.footer }}>
              {doc.footer}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
