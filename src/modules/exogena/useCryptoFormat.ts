import { useEffect, useMemo } from "react";
import { useCryptoSelection } from "../financial-statements/crypto/selection";
import { useCryptoData } from "../financial-statements/crypto/useCryptoData";
import type { CryptoExoFormat } from "../financial-statements/crypto/exogenaSync";
import { cryptoFormatState } from "./domain/cryptoFormat";
import { useFormatRecords } from "./hooks";

/**
 * 1007 y 1647 de una empresa y un año: los registros guardados en Exógena y lo que Transacciones Cripto propone hoy desde sus
 * cargas (solo lectura: Exógena no cambia las cargas). La selección de Transacciones Cripto sigue a la de Exógena para que
 * «Resolver» abra la misma empresa y año.
 */
export function useCryptoFormat(companyId: number | null, year: number, format: CryptoExoFormat) {
  const [, selectCrypto] = useCryptoSelection();
  useEffect(() => {
    // Sin empresa elegida en Exógena no se pisa la selección que ya tenía Transacciones Cripto.
    if (companyId !== null) selectCrypto({ companyId, year });
  }, [companyId, year, selectCrypto]);

  const crypto = useCryptoData(companyId, year);
  const records = useFormatRecords(companyId, year, format);
  const model = crypto.model;

  const computed = useMemo(() => (model && records.records ? cryptoFormatState(model, format, records.records) : null), [model, records.records, format]);

  return { crypto, company: crypto.company, companies: crypto.fs.companies, format: records, model, computed, ready: !!(model && records.records && computed) };
}
