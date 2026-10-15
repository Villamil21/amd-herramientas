import { useState } from "react";
import { useToast } from "../../../components/ui";
import { fileService } from "../../../services/fileService";
import { errorMessage } from "../../../services/tauri";
import type { Workbook } from "../../../types/excel";
import { SalesFormatError } from "./readers";

/** Selección de un Excel y su lectura (el archivo solo vive en memoria). */
export function useWorkbook<T>(read: (book: Workbook) => T) {
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [result, setResult] = useState<{ fileName: string; data: T } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick() {
    setPicking(true);
    setError(null);
    try {
      const book = await fileService.pickExcel();
      if (!book) return;
      try {
        setResult({ fileName: book.fileName, data: read(book) });
      } catch (e) {
        setResult(null);
        setError(e instanceof SalesFormatError ? e.message : "No fue posible leer el archivo. Verifica que sea el Excel correcto.");
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPicking(false);
    }
  }

  return { picking, result, error, pick, clear: () => setResult(null) };
}
