import type { IdentityDocumentType, IdentityDocumentTypeInput } from "../types/models";
import { call } from "./tauri";

export const identityDocumentService = {
  list: () => call<IdentityDocumentType[]>("list_identity_document_types"),
  create: (input: IdentityDocumentTypeInput) => call<IdentityDocumentType>("create_identity_document_type", { input }),
  update: (id: number, input: IdentityDocumentTypeInput) => call<IdentityDocumentType>("update_identity_document_type", { id, input }),
  remove: (id: number) => call<void>("delete_identity_document_type", { id }),
};
