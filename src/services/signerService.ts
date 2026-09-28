import type { CertificateSigner, CertificateSignerInput } from "../types/models";
import { call } from "./tauri";

export const signerService = {
  list: (search?: string) => call<CertificateSigner[]>("list_certificate_signers", { search: search || null }),
  create: (input: CertificateSignerInput) => call<CertificateSigner>("create_certificate_signer", { input }),
  update: (id: number, input: CertificateSignerInput) => call<CertificateSigner>("update_certificate_signer", { id, input }),
  remove: (id: number) => call<void>("delete_certificate_signer", { id }),
  pickSignature: () => call<{ signatureFile: string; dataUrl: string } | null>("pick_certificate_signature"),
  dataUrl: (signatureFile: string) => call<string | null>("get_signature_data_url", { signatureFile }),
};
