import { describe, expect, it } from "vitest";
import type { CompanyDocument } from "../../../types/models";
import { formatSize, versionHistory, type PendingDocument } from "./documentHistory";

const saved = (id: number, kind: "rut" | "camara", at: string): CompanyDocument => ({ id, kind, fileName: `${kind}-${id}.pdf`, storedFile: `file-${id}.pdf`, sizeBytes: 100, uploadedAt: at, isCurrent: false });
const pending = (kind: "rut" | "camara", n: number): PendingDocument => ({ kind, fileName: `nuevo-${n}.pdf`, storedFile: `new-${n}.pdf`, sizeBytes: 50 });

describe("historial de versiones de RUT y Cámara", () => {
  it("la versión más reciente es la vigente y las anteriores siguen disponibles", () => {
    const rows = versionHistory([saved(1, "rut", "2025-01-01T10:00:00Z"), saved(2, "rut", "2026-01-01T10:00:00Z"), saved(3, "camara", "2026-02-01T10:00:00Z")], [], "rut");
    expect(rows.map((r) => [r.fileName, r.isCurrent])).toEqual([["rut-2.pdf", true], ["rut-1.pdf", false]]);
  });

  it("una carga nueva queda como vigente sin quitar ninguna anterior", () => {
    const rows = versionHistory([saved(1, "rut", "2025-01-01T10:00:00Z")], [pending("rut", 1)], "rut");
    expect(rows.map((r) => [r.fileName, r.isCurrent, r.pending])).toEqual([["nuevo-1.pdf", true, true], ["rut-1.pdf", false, false]]);
    expect(rows[0].uploadedAt).toBeNull();
  });

  it("varias cargas en la misma edición: la última es la vigente y todas se conservan", () => {
    const rows = versionHistory([], [pending("camara", 1), pending("camara", 2)], "camara");
    expect(rows.map((r) => [r.fileName, r.isCurrent])).toEqual([["nuevo-2.pdf", true], ["nuevo-1.pdf", false]]);
  });

  it("cada tipo lleva su propio historial", () => {
    const docs = [saved(1, "rut", "2025-01-01T10:00:00Z"), saved(2, "camara", "2026-02-01T10:00:00Z")];
    expect(versionHistory(docs, [pending("rut", 1)], "camara").map((r) => r.fileName)).toEqual(["camara-2.pdf"]);
    expect(versionHistory([], [], "rut")).toEqual([]);
  });

  it("muestra los tamaños de forma legible", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(231_199)).toBe("226 KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
