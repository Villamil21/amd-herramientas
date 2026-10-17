import type { Cell, Sheet, Workbook } from "../../../../types/excel";
import type { ExoCatalogs } from "../../../../types/exogena";
import { CATALOGS } from "../../../exogena/domain/fixtures";
import { fingerprintRow } from "./hash";
import { buildModel, type CryptoModel } from "./model";
import type { CryptoDecision, CryptoKind, CryptoStoredRow, CryptoUpload, Homologation, RowData } from "./types";

/** Utilidades de prueba: libros, filas guardadas y un modelo completo con catálogos mínimos. */

export const s = (v: string): Cell => ({ t: "s", v });
export const n = (v: number): Cell => ({ t: "n", v });
export const d = (v: string): Cell => ({ t: "d", v });
export const blank: Cell = { t: "e" };

export const PURCHASE_HEADERS = [
  "Valor total de la operación",
  "Tipo de documento del tercero para quien se recibió ingreso",
  "Identificación del tercero para quien se recibió ingreso",
  "Primer nombre del tercero para quien se recibió ingreso",
  "Otros nombres del tercero para quien se recibió ingreso",
  "Primer apellido del tercero para quien se recibió ingreso",
  "Segundo apellido del tercero para quien se recibió ingreso",
  "Razón social del tercero para quien se recibió ingreso",
  "Código mcp",
  "Fecha",
  "Orden",
];

export const SALE_HEADERS = [
  "Tipo de documento de quien se recibe ingreso",
  "Número identificación de quien se recibe ingreso",
  "DV",
  "Primer apellido de quien se recibe ingreso",
  "Segundo apellido de quien se recibe ingreso",
  "Primer nombre de quien se recibe ingreso",
  "Otros nombres de quien se recibe ingreso",
  "Razón social de quien se recibe ingreso",
  "Ingresos brutos recibidos",
];

export function sheet(name: string, header: string[], rows: Cell[][]): Sheet {
  return { name, rows: [header.map(s), ...rows] };
}

export const book = (fileName: string, ...sheets: Sheet[]): Workbook => ({ fileName, sheets });

export interface PurchaseSpec {
  amount: number;
  docType?: string;
  doc?: string;
  firstName?: string;
  firstSurname?: string;
  business?: string;
  city?: string;
  date: string;
  order?: string;
}

export const purchaseData = (p: PurchaseSpec): RowData => {
  const data: RowData = { "Valor total de la operación": p.amount, Fecha: p.date };
  if (p.docType) data["Tipo de documento del tercero para quien se recibió ingreso"] = p.docType;
  if (p.doc) data["Identificación del tercero para quien se recibió ingreso"] = p.doc;
  if (p.firstName) data["Primer nombre del tercero para quien se recibió ingreso"] = p.firstName;
  if (p.firstSurname) data["Primer apellido del tercero para quien se recibió ingreso"] = p.firstSurname;
  if (p.business) data["Razón social del tercero para quien se recibió ingreso"] = p.business;
  if (p.city) data["Código mcp"] = p.city;
  if (p.order) data["Orden"] = p.order;
  return data;
};

export interface SaleSpec {
  amount: number;
  docType?: string;
  doc?: string;
  dv?: string;
  firstName?: string;
  firstSurname?: string;
  business?: string;
}

export const saleData = (p: SaleSpec): RowData => {
  const data: RowData = { "Ingresos brutos recibidos": p.amount };
  if (p.docType) data["Tipo de documento de quien se recibe ingreso"] = p.docType;
  if (p.doc) data["Número identificación de quien se recibe ingreso"] = p.doc;
  if (p.dv) data["DV"] = p.dv;
  if (p.firstName) data["Primer nombre de quien se recibe ingreso"] = p.firstName;
  if (p.firstSurname) data["Primer apellido de quien se recibe ingreso"] = p.firstSurname;
  if (p.business) data["Razón social de quien se recibe ingreso"] = p.business;
  return data;
};

let rowIds = 0;
export function stored(uploadId: number, kind: CryptoKind, rowNumber: number, data: RowData): CryptoStoredRow {
  return { id: ++rowIds, uploadId, kind, sheet: kind === "purchase" ? "Compras" : "Ventas", rowNumber, fingerprint: fingerprintRow(kind, data), data };
}

export function upload(id: number, fileName: string, extra: Partial<CryptoUpload> = {}): CryptoUpload {
  return { id, companyId: 1, year: 2026, fileName, version: 1, status: "active", sheets: ["Compras", "Ventas"], coverageOverride: null, importedAt: `2026-10-0${id}T10:00:00Z`, updatedAt: `2026-10-0${id}T10:00:00Z`, rowCount: 0, ...extra };
}

export const decision = (kind: CryptoDecision["kind"], key: string, value: string): CryptoDecision => ({ kind, key, value, fingerprint: "", decidedAt: "2026-10-10T00:00:00Z" });

/** Catálogos de Exógena de prueba con dos «San Antonio» (ambiguo) y Cali. */
export const CATALOGS_EXTRA: ExoCatalogs = {
  ...CATALOGS,
  departments: [...CATALOGS.departments, { code: "73", name: "Tolima", isSystem: true, isActive: true }],
  municipalities: [
    ...CATALOGS.municipalities,
    { deptCode: "05", code: "647", name: "San Antonio", isSystem: true, isActive: true },
    { deptCode: "73", code: "675", name: "San Antonio", isSystem: true, isActive: true },
    { deptCode: "76", code: "109", name: "Buenaventura", isSystem: true, isActive: true },
  ],
};

export const okPuc = (key: string) => ({ code: `4135${key.length}0`.slice(0, 6), valid: true, located: true, location: "EERR" });

export function model(args: { rows: CryptoStoredRow[]; uploads: CryptoUpload[]; decisions?: CryptoDecision[]; homologations?: Homologation[]; puc?: Parameters<typeof buildModel>[0]["puc"]; address?: string; year?: number }): CryptoModel {
  return buildModel({
    year: args.year ?? 2026,
    state: { uploads: args.uploads, rows: args.rows, decisions: args.decisions ?? [], versions: [], audit: [] },
    homologations: args.homologations ?? [],
    catalogs: CATALOGS_EXTRA,
    companyAddress: args.address ?? "CL 1 # 2-3",
    puc: args.puc ?? okPuc,
  });
}
