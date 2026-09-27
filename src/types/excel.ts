/** Celda tal como la entrega Rust (calamine), con su tipo original. */
export type Cell =
  | { t: "e" }
  | { t: "n"; v: number }
  | { t: "s"; v: string }
  | { t: "b"; v: boolean }
  | { t: "d"; v: string } // AAAA-MM-DD
  | { t: "x"; v: string };

export interface Sheet {
  name: string;
  rows: Cell[][];
}

export interface Workbook {
  fileName: string;
  sheets: Sheet[];
}
