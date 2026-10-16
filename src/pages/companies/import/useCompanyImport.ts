import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { extractPdfText } from "../../../modules/bank-analysis/shared/pdf/pdfExtractor";
import { companyService } from "../../../services/companyService";
import type { CompanyDocumentKind, CompanyInput, LegalRole } from "../../../types/models";
import { normalizeDocument, normalizePhone, upperText } from "../normalize";
import { parseCamara, type CamaraData } from "./camaraParser";
import { base64ToBytes, type PendingDocument } from "./documentHistory";
import { planImport, type ImportConflict, type ImportField, type ImportOption, type ImportSource, type ImportValue, type ImportableValues } from "./importPlan";
import { assignRole, findShareholder, planRepresentatives, type Person, type RepOption, type RepProposal } from "./legalReps";
import { parseRut, type RutData } from "./rutParser";
import { REGISTRAL_FIELDS } from "./registral";

const IMPORTABLE: ImportField[] = ["razonSocial", "nit", "dv", "ciiuCode", "ciudad", "direccion", "correo", "telefono", "subscribedTotalShares", "subscribedNominalValue", "paidTotalShares", "paidNominalValue", ...REGISTRAL_FIELDS];

const importableOf = (v: CompanyInput): ImportableValues => Object.fromEntries(IMPORTABLE.map((k) => [k, v[k]])) as unknown as ImportableValues;

export interface AppliedOrigin {
  sources: ImportSource[];
  /** Valor aplicado: si el usuario lo edita después, el origen deja de mostrarse. */
  value: ImportValue;
}

export type RepMode = "shareholder" | "add-shareholder" | "exception";

/** Un valor tal como se muestra en el formulario (mismo formato que se guarda). */
function formValue(field: ImportField, value: ImportValue): ImportValue {
  if (typeof value === "number") return value;
  if ((REGISTRAL_FIELDS as string[]).includes(field)) return value.replace(/\s+/g, " ").trim();
  if (field === "nit" || field === "dv") return value.replace(/\D/g, "");
  if (field === "correo") return value.toLowerCase();
  if (field === "telefono") return normalizePhone(value);
  if (field === "ciiuCode") return value.replace(/\D/g, "");
  return upperText(value);
}

/**
 * Orquesta la importación del RUT y de la Cámara de Comercio en el formulario de empresa:
 * copia el PDF al almacenamiento, lo lee en el equipo, precarga lo que no choca con nada y deja a la vista
 * las discrepancias y los representantes propuestos para que el usuario decida. Nada se bloquea para editar.
 */
export function useCompanyImport(values: CompanyInput, setValues: Dispatch<SetStateAction<CompanyInput>>) {
  const [pending, setPending] = useState<PendingDocument[]>([]);
  const [busy, setBusy] = useState<CompanyDocumentKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rut, setRut] = useState<RutData | null>(null);
  const [camara, setCamara] = useState<CamaraData | null>(null);
  const [origins, setOrigins] = useState<Partial<Record<ImportField, AppliedOrigin>>>({});
  const [conflicts, setConflicts] = useState<ImportConflict[]>([]);
  const [repProposals, setRepProposals] = useState<RepProposal[]>([]);
  const [repResolved, setRepResolved] = useState<Partial<Record<LegalRole, boolean>>>({});
  const [notes, setNotes] = useState<Partial<Record<CompanyDocumentKind, string[]>>>({});
  const parsed = useRef<{ rut: RutData | null; camara: CamaraData | null }>({ rut: null, camara: null });
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const pendingRef = useRef<PendingDocument[]>([]);
  pendingRef.current = pending;

  /** Lee el PDF, compara con el formulario y aplica solo lo que no pisa nada. */
  const processBytes = useCallback(
    async (kind: CompanyDocumentKind, bytes: Uint8Array) => {
      let data: RutData | CamaraData | null = null;
      let failure: string | null = null;
      try {
        const text = await extractPdfText(bytes);
        const hasText = text.pages.some((p) => p.items.length > 0);
        if (!hasText) failure = "El PDF no tiene texto legible (puede ser una imagen escaneada). Se guardó como versión, pero los campos quedan para llenar a mano.";
        else data = kind === "rut" ? parseRut(text) : parseCamara(text);
      } catch (e) {
        failure = `${(e as Error).message || "No fue posible leer el PDF."} Se guardó como versión, pero los campos quedan para llenar a mano.`;
      }
      setNotes((n) => ({ ...n, [kind]: failure ? [failure] : (data as RutData | CamaraData).notes }));
      if (!data) return;
      if (kind === "rut") parsed.current.rut = data as RutData;
      else parsed.current.camara = data as CamaraData;
      setRut(parsed.current.rut);
      setCamara(parsed.current.camara);

      const current = valuesRef.current;
      const plan = planImport(importableOf(current), parsed.current.rut, parsed.current.camara);
      const applied = Object.fromEntries(Object.entries(plan.apply).map(([k, v]) => [k, formValue(k as ImportField, v as ImportValue)]));
      setValues((v) => {
        const next = { ...v, ...applied } as CompanyInput;
        // «Revisar»: lo que la Cámara no permitió confirmar y sigue vacío; lo que ya tiene valor deja de estar en revisión.
        if (kind === "camara") {
          const fromCamara = (parsed.current.camara?.registral.review ?? []) as string[];
          const keep = new Set([...v.registralReview.filter((k) => !(next[k as keyof CompanyInput] as string)), ...fromCamara.filter((k) => !(next[k as keyof CompanyInput] as string))]);
          next.registralReview = [...keep];
        }
        return next;
      });
      setOrigins((o) => ({ ...o, ...Object.fromEntries(Object.entries(applied).map(([k, v]) => [k, { sources: plan.origin[k as ImportField]!, value: v as ImportValue }])) }));
      setConflicts(plan.conflicts);

      // Representantes: se aplican solos únicamente si ya son socios y el cargo estaba vacío; si no, se proponen.
      const proposals = planRepresentatives(parsed.current.rut, parsed.current.camara);
      const keep: RepProposal[] = [];
      let shareholders = current.shareholders;
      for (const proposal of proposals) {
        const free = !shareholders.some((s) => s.legalRole === proposal.role) && !(proposal.role === "principal" ? current.legalRepManual && current.legalRepName : current.legalRepAltManual && current.legalRepAltName);
        const index = proposal.options.length ? findShareholder(shareholders, proposal.options[0].person) : -1;
        if (free && !proposal.conflict && !proposal.ambiguous && index >= 0) shareholders = assignRole(shareholders, proposal.role, index);
        else keep.push(proposal);
      }
      if (shareholders !== current.shareholders) setValues((v) => ({ ...v, shareholders }));
      setRepProposals(keep);
      setRepResolved({});
    },
    [setValues],
  );

  const importDocument = useCallback(
    async (kind: CompanyDocumentKind) => {
      setError(null);
      setBusy(kind);
      try {
        const picked = await companyService.pickDocument(kind);
        if (!picked) return;
        setPending((p) => [...p, { kind, fileName: picked.fileName, storedFile: picked.storedFile, sizeBytes: picked.sizeBytes }]);
        await processBytes(kind, base64ToBytes(picked.dataBase64));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [processBytes],
  );

  /** Vuelve a leer una versión ya guardada (para comparar sus datos con el formulario). */
  const rereadVersion = useCallback(
    async (kind: CompanyDocumentKind, storedFile: string) => {
      setError(null);
      setBusy(kind);
      try {
        await processBytes(kind, base64ToBytes(await companyService.readDocument(storedFile)));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [processBytes],
  );

  const removePending = useCallback(async (storedFile: string) => {
    const removed = pendingRef.current.find((d) => d.storedFile === storedFile);
    setPending((p) => p.filter((d) => d.storedFile !== storedFile));
    try {
      await companyService.discardDocument(storedFile);
    } catch {
      // Si no se pudo borrar, queda sin referencia y se limpia en el siguiente arranque.
    }
    if (removed && !pendingRef.current.some((d) => d.kind === removed.kind && d.storedFile !== storedFile)) {
      if (removed.kind === "rut") parsed.current.rut = null;
      else parsed.current.camara = null;
      setRut(parsed.current.rut);
      setCamara(parsed.current.camara);
      setNotes((n) => ({ ...n, [removed.kind]: undefined }));
      setConflicts(planImport(importableOf(valuesRef.current), parsed.current.rut, parsed.current.camara).conflicts);
      setRepProposals(planRepresentatives(parsed.current.rut, parsed.current.camara));
    }
  }, []);

  /** Descarta los PDF cargados que no se guardaron (al cancelar el formulario). */
  const discardPending = useCallback(async () => {
    const files = pendingRef.current.map((d) => d.storedFile);
    setPending([]);
    await Promise.allSettled(files.map((f) => companyService.discardDocument(f)));
  }, []);

  /** Tras guardar, las cargas ya son versiones registradas. */
  const markSaved = useCallback(() => setPending([]), []);

  const resolveConflict = useCallback(
    (conflict: ImportConflict, option: ImportOption) => {
      if (option.source !== "current") {
        setValues((v) => ({ ...v, [conflict.field]: formValue(conflict.field, option.value) }));
        setOrigins((o) => ({ ...o, [conflict.field]: { sources: [option.source as ImportSource], value: formValue(conflict.field, option.value) } }));
      }
      setConflicts((list) => list.filter((c) => c.field !== conflict.field));
    },
    [setValues],
  );

  /** Aplica una persona propuesta al cargo: como socio existente, agregándola como socio, o como excepción confirmada. */
  const applyRep = useCallback(
    (role: LegalRole, option: RepOption, mode: RepMode) => {
      const person: Person = option.person;
      setValues((v) => {
        const clearManual = role === "principal" ? { legalRepName: "", legalRepDocument: "", legalRepManual: false } : { legalRepAltName: "", legalRepAltDocument: "", legalRepAltManual: false };
        if (mode === "exception") {
          const manual = role === "principal" ? { legalRepName: upperText(person.name), legalRepDocument: normalizeDocument(person.document), legalRepManual: true } : { legalRepAltName: upperText(person.name), legalRepAltDocument: normalizeDocument(person.document), legalRepAltManual: true };
          return { ...v, ...manual, shareholders: assignRole(v.shareholders, role, null) };
        }
        if (mode === "add-shareholder") {
          const added = { name: upperText(person.name), identityDocument: normalizeDocument(person.document), percentage: v.shareholders.length === 0 ? 100 : 0, sortOrder: v.shareholders.length, legalRole: null };
          return { ...v, ...clearManual, shareholders: assignRole([...v.shareholders, added], role, v.shareholders.length) };
        }
        const index = findShareholder(v.shareholders, person);
        return index < 0 ? v : { ...v, ...clearManual, shareholders: assignRole(v.shareholders, role, index) };
      });
      setRepResolved((r) => ({ ...r, [role]: true }));
      setRepProposals((list) => list.filter((p) => p.role !== role));
    },
    [setValues],
  );

  /** El usuario revisó la propuesta y conserva lo que ya está seleccionado. */
  const keepRep = useCallback((role: LegalRole) => {
    setRepResolved((r) => ({ ...r, [role]: true }));
    setRepProposals((list) => list.filter((p) => p.role !== role));
  }, []);

  const blockers: string[] = [];
  if (conflicts.length) blockers.push(`Hay ${conflicts.length} ${conflicts.length === 1 ? "discrepancia" : "discrepancias"} entre documentos y el formulario sin resolver (${conflicts.map((c) => c.label).join(", ")}).`);
  for (const p of repProposals) {
    if ((p.conflict || p.ambiguous) && !repResolved[p.role]) blockers.push(`Elige quién es el representante legal ${p.role === "principal" ? "principal" : "suplente"}: el RUT y la Cámara no coinciden.`);
  }

  return { pending, busy, error, rut, camara, origins, conflicts, repProposals, repResolved, notes, blockers, importDocument, rereadVersion, removePending, discardPending, markSaved, resolveConflict, applyRep, keepRep };
}

export type CompanyImport = ReturnType<typeof useCompanyImport>;
