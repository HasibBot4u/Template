# Sowveil Studio — Persistence Migration Phase 2A: Contracts and Adapter Foundation

## 1. Objective & Scope
Phase 2A establishes the shared persistence contracts, explicit DTO serializers/deserializers, immutable identity & revision guards, fail-closed repository interfaces, and adapter implementations (`AuthoritativeFirestorePersistenceAdapter` and `LocalSnapshotPersistenceAdapter`) approved by ADR-003.

In accordance with the staged migration plan, this phase delivers the **contracts, adapters, readiness gates, sanitized diagnostics, and contract test suite** without destructively replacing existing live entity endpoints yet.

---

## 2. Persistence Contracts & DTO Boundaries (`src/services/persistenceContracts.ts`)

| Domain Entity | Firestore DTO / Vault Record | Serializer / Deserializer | Enforced Invariants |
|---|---|---|---|
| `ProjectLibraryItem` | `ProjectFirestoreDto` | `serializeProjectToFirestoreDto` / `deserializeProjectFromFirestoreDto` | Immutable `id`, `ownerUid`, `createdAt`; monotonic `revision` optimistic locking (`REVISION_CONFLICT`); preserves `migrationMetadata`; rejects `blob:` URLs (`STORAGE_NOT_CONFIGURED`) and >750KB inline binaries (`BINARY_MEDIA_IN_FIRESTORE_FORBIDDEN`). |
| `AiDirectorSessionRecord` | `AiDirectorSessionFirestoreDto` | `serializeAiDirectorSessionToDto` / `deserializeAiDirectorSessionFromDto` | Immutable `id`, `ownerUid`, `createdAt`; preserves `activeRevisionNumber` and complete script coverage ledger. |
| `ReferenceLabSession` | `ReferenceLabSessionFirestoreDto` | `serializeReferenceLabSessionToDto` / `deserializeReferenceLabSessionFromDto` | Immutable `id`, `ownerUid`, `createdAt`; preserves `usageMode`, `rightsDeclaration`, and `fidelityReport`. |
| `TemplateFactoryDraftRecord` | `TemplateFactoryDraftFirestoreDto` | `serializeTemplateFactoryDraftToDto` / `deserializeTemplateFactoryDraftFromDto` | Immutable `id`, `ownerUid`, `createdAt`; preserves `sourceKind`, `provenanceClassification`, `version`, and `publishedToCatalog`. |
| `CatalogItem` & `TemplateVariantInstance` | `CatalogItem` / `TemplateVariantInstance` | `ICatalogAndVariantRepository` | Immutable `id`, `ownerUid`, `createdAt`; owner-scoped private variant isolation. |
| `ProviderConnectionRecord` | Split into `ProviderConnectionMetadataFirestoreDto` + `ServerCredentialVaultRecordDto` | `serializeProviderConnectionSplitDto` / `deserializeProviderConnectionFromSplitDto` | **Strict Credential Boundary:** Strips `encryptedCredential` and rejects raw keys (`VAULT_SECRET_IN_PUBLIC_DTO_FORBIDDEN`) on public/Firestore metadata DTOs. AES-256-GCM ciphertext is routed exclusively to `IServerCredentialVaultRepository`. |
| `DurableRenderExportJobRecord` | `RenderExportJobFirestoreDto` | `serializeRenderExportJobToFirestoreDto` / `deserializeRenderExportJobFromFirestoreDto` | **Strict Binary Boundary:** Strips `artifactBytesBase64` from Firestore documents. Marks `storagePersistenceMode: 'metadata-only-ephemeral'` when `CLOUD_STORAGE_ENABLED=false`. |
| `OwnerBootstrapLockDto` | `/systemLocks/ownerBootstrap` | `IUserAndSystemGovernanceRepository.claimOwnerBootstrapLock` | Atomic create-if-absent lock (`BOOTSTRAP_LOCK_ALREADY_CLAIMED` on second attempt). |

---

## 3. Adapter Classification & Production Readiness Gates (`src/server/persistenceAdapters.ts`)

1. **`AuthoritativeFirestorePersistenceAdapter` (`cloud-firestore-authoritative`)**:
   - Production adapter backed by `IFirestoreDocumentDriver`.
   - `silentFallbackToMemoryEnabled: false` (hardcoded invariant). Any Firestore read/write error throws a typed `PersistenceContractError` (`AUTHORITATIVE_STORE_WRITE_FAILED` / `AUTHORITATIVE_STORE_READ_FAILED`) and never falls back to a local `Map` or `localStorage`.
2. **`LocalSnapshotPersistenceAdapter` (`local-json-snapshot-dev-only`)**:
   - Marked `isDevelopmentOrTestOnly: true` unless `SOWVEIL_ALLOW_SHARED_FS_SNAPSHOT=true` is explicitly configured on a verified shared volume.
   - In `NODE_ENV=production` without a shared filesystem or authoritative Firestore adapter:
     - `GET /api/v1/ready` returns HTTP `503` with `error.code = 'PRODUCTION_DURABLE_ADAPTER_REQUIRED'` and `persistenceReadiness.status = 'blocked'`.
     - Initializing with `refuseUnreadyProductionStartup: true` (or `SOWVEIL_REFUSE_EPHEMERAL_PROD_STARTUP=true`) refuses startup immediately.

---

## 4. Sanitized Persistence Diagnostics
- `GET /api/v1/diagnostics/persistence`, `GET /api/v1/ready`, `GET /api/v1/health`, and `GET /api/v1/diagnostics/technical` expose `persistenceReadiness` reporting the active adapter, readiness status, binary artifact policy, and vault boundary policy while guaranteeing zero exposure of `SOWVEIL_MASTER_VAULT_KEY`, provider credentials, private project payloads, or server filesystem paths.

---

## 5. Reversible Rollback & Next Phase (Phase 2B)
- **Rollback**: Phase 2A is 100% additive and non-destructive. Existing data in `.data/sowveil-durable-store.json` and Firestore collections remains untouched.
- **Next Smallest Actionable Phase (Phase 2B)**: Wire `Projects` (`/api/v1/projects*` and `workspaceRepository.ts`) and `OwnerBootstrapLock` (`/api/v1/auth/bootstrap-owner`) to the shared Phase 2A repository adapter so projects created or mutated in any workspace share one canonical store across reloads.
