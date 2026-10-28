# Sowveil Studio — Phase Acceptance & Final Verification Matrix (`docs/PHASE_ACCEPTANCE_MATRIX.md`)

**Last Verified:** 2026-10-28  
**Verification Commands Executed:** `npm run lint` (`0 errors`), `npm run lint:rules` (`0 errors`), `npm test` (`17 test suites, 93 tests passing, 0 failed`), `npm run build` / `compile_applet` (`PASS`)

---

## 1. Phase-by-Phase Acceptance Status (Phases 0–14)

| Phase | Milestone Description | Status | Primary Evidence (Files & Symbols) | Automated Test Suite |
|---|---|---|---|---|
| **Phase 0–1** | Forensic Audit, 20-Module Reference UI Shell, Design Tokens, Deterministic Catalog Engine & Previews | **Implemented & Verified** | `src/data/modules.ts` (`SOWVEIL_MODULES`), `src/components/ModuleStrip.tsx`, `src/components/CatalogBrowserWorkspace.tsx`, `src/components/PreviewRenderer.tsx`, `src/services/catalogEngine.ts` | `src/tests/phase2.test.ts`, `src/tests/mobileMigration.test.ts` |
| **Phase 2–4** | Firebase Auth, Cloud Firestore Persistence, RBAC, Admin Console & Safe Diagnostics | **Implemented & Verified** | `src/services/firebaseClient.ts`, `src/repositories/workspaceRepository.ts`, `firestore.rules`, `src/components/AdminConsoleWorkspace.tsx`, `src/server/apiApp.ts` | `src/tests/phase3.security.test.ts`, `src/tests/firestore.rules.test.ts`, `src/tests/adminAndDiagnostics.test.ts` |
| **Phase 5–7** | Mobile Editor Gateway, Media Workflows (`Auto Captions`, `Downloader / Media Inspector`, `Project Library`), PWA & Durable Snapshot | **Implemented & Verified** | `src/features/editor-gateway/strategies.ts`, `src/features/editor-gateway/adapters.ts`, `src/features/media-workflows/index.ts`, `src/server/durableStore.ts` | `src/tests/editorGatewayPhase5.test.ts`, `src/tests/mobileMediaWorkflows.test.ts`, `src/tests/mobileHardeningPhase7.test.ts` |
| **Phase 8** | Canonical Editable Project Schema (`v2.0.0`), Lossless Migration & 36 Typed Commands | **Implemented & Verified** | `src/types/canonicalProject.ts`, `src/services/canonicalProjectEngine.ts` (`CanonicalProjectStore`, `executeProjectCommand`, `migrateToCanonicalProject`), `docs/CANONICAL_PROJECT_SCHEMA.md` | `src/tests/canonicalProjectSchema.test.ts` |
| **Phase 9** | Reference Lab: Rights-Aware Reference Reconstruction, Shot Segmentation, Fidelity Report & Correction Tools | **Implemented & Verified** | `src/services/referenceLabEngine.ts`, `src/components/ReferenceLabWorkspace.tsx`, `src/server/apiApp.ts` (`/api/v1/reference-lab/*`) | `src/tests/referenceLab.test.ts` |
| **Phase 10** | AI Provider Hub: 7 Protocol Adapters, AES-256-GCM Secret Vault, 14-Capability Registry, Extensions Sandbox & Typed Tool Registry | **Implemented & Verified** | `src/services/providerHubEngine.ts`, `src/components/ProviderHubWorkspace.tsx`, `src/server/apiApp.ts` (`/api/v1/provider-hub/*`, `/api/v1/extensions/*`, `/api/v1/tools/*`) | `src/tests/providerHub.test.ts` |
| **Phase 11** | AI Director: 7-Stage Durable State Machine, Offset-Exact Chunked Script Coverage, 20-Field Brief, 22-Field Shot Plan & 10-Point Acceptance Gate | **Implemented & Verified** | `src/services/aiDirectorProductionEngine.ts`, `src/components/AiDirectorWorkspace.tsx`, `src/server/apiApp.ts` (`/api/v1/ai-director/*`) | `src/tests/aiDirectorProduction.test.ts` |
| **Phase 12** | Professional Mobile Editing Studio (`Quick`/`Pro`/`AI Co-Edit` Modes), Interactive Easing Curves & Transactional AI Co-Editing | **Implemented & Verified** | `src/components/EditingStudioWorkspace.tsx`, `src/components/MobileProEditorModal.tsx`, `src/services/coEditingEngine.ts`, `src/server/apiApp.ts` (`/api/v1/editor/*`) | `src/tests/editingStudioCoEdit.test.ts` |
| **Phase 13** | Template Factory, 9-Category Parameter Extraction, Deduplication, 7-Check QA Gate & Consent-Gated Preference Signals | **Implemented & Verified** | `src/services/templateFactoryEngine.ts`, `src/components/TemplateFactoryWorkspace.tsx`, `src/server/apiApp.ts` (`/api/v1/template-factory/*`) | `src/tests/templateFactory.test.ts` |
| **Phase 13B** | Canonical Render, Export, Mobile App Adapters & 8-Gate Final Quality Assurance | **Implemented & Verified** | `src/services/renderExportQaEngine.ts`, `src/components/RenderExportQaWorkspace.tsx`, `src/server/apiApp.ts` (`/api/v1/render-export/*`) | `src/tests/renderExportQa.test.ts` |
| **Phase 14** | Production Security Audit, Cross-Account IDOR Verification, Privacy-Aware Telemetry, Account Export/Deletion & Documentation | **Implemented & Verified** | `src/server/apiApp.ts` (`/api/v1/telemetry/*`, `/api/v1/me/data-export`, `DELETE /api/v1/me/account-data`), `firestore.rules`, `firebase-blueprint.json`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md` | `src/tests/securityObservabilityReleasePhase14.test.ts` |

---

## 2. Part C — Cross-Phase Acceptance Questions & Evidence

1. **Can a user open the reference interface and use all 20 modules without missing tabs or dead buttons?**
   - **Evidence:** `src/data/modules.ts` (`SOWVEIL_MODULES`, `displayOrder` 1–20), `src/components/ModuleStrip.tsx`, `src/components/CatalogBrowserWorkspace.tsx`, `src/components/UtilityWorkspaces.tsx`; verified by `src/tests/mobileMigration.test.ts` and `src/tests/phase2.test.ts`.
2. **Can a user customize a template's declared editable properties and persist the variant?**
   - **Evidence:** `src/services/marketplaceEngine.ts` (`applyVariantOverridesToTemplate`, `forkTemplateFromVariant`), `src/server/apiApp.ts` (`/api/v1/template-variants`, `/api/v1/catalog/:id/fork`), `src/components/CatalogBrowserWorkspace.tsx`; verified by `src/tests/mobileHardeningPhase7.test.ts`.
3. **Can a user provide an authorized reference video/link, inspect a reconstruction, see a truthful fidelity report and save a reusable template?**
   - **Evidence:** `src/services/referenceLabEngine.ts` (`createReferenceLabSession`, `applyReferenceCorrectionAction`, `buildDraftTemplateFromReferenceSession`, `validateAndPromoteReferenceTemplate`), `src/components/ReferenceLabWorkspace.tsx` (`/app/reference-lab`); verified by `src/tests/referenceLab.test.ts`.
4. **Can a user connect Gemini/OpenAI-compatible/Anthropic/custom models safely, test capabilities and install a sandboxed skill/repo with rollback?**
   - **Evidence:** `src/services/providerHubEngine.ts` (`createProviderConnectionRecord`, `probeProviderConnection`, `rotateConnectionCredential`, `revokeConnectionCredential`, `installAndValidateExtensionPackage`, `rollbackExtensionPackage`), `src/components/ProviderHubWorkspace.tsx` (`/app/provider-hub`); verified by `src/tests/providerHub.test.ts`.
5. **Can a user submit a script, answer only high-impact questions, review/approve a shot plan, and get a complete project with full script coverage?**
   - **Evidence:** `src/services/aiDirectorProductionEngine.ts` (`createAiDirectorSession`, `answerDirectorQuestions`, `approveAndLockPlanItems`, `executeDirectorProduction`), `src/components/AiDirectorWorkspace.tsx` (`/app/ai-director`); verified by `src/tests/aiDirectorProduction.test.ts`.
6. **Can the user manually edit that same project on phone/desktop and ask the AI to make targeted changes without losing locked scenes?**
   - **Evidence:** `src/services/canonicalProjectEngine.ts` (`CanonicalProjectStore`, `LOCKED_SCENE` guard), `src/services/coEditingEngine.ts` (`proposeAiCoEditTransaction`, `applyAiCoEditTransaction`, `rollbackAiCoEditTransaction`), `src/components/EditingStudioWorkspace.tsx` (`/app/editor`); verified by `src/tests/editingStudioCoEdit.test.ts`.
7. **Are new reusable templates/assets saved with provenance, validation and deduplication?**
   - **Evidence:** `src/services/templateFactoryEngine.ts` (`createTemplateFactoryDraft`, `captureReusableComponentsFromAiDirector`, `detectTemplateDuplication`, `runTemplateFactoryQaSuite`, `publishValidatedTemplateDraft`), `src/components/TemplateFactoryWorkspace.tsx` (`/app/template-factory`); verified by `src/tests/templateFactory.test.ts`.
8. **Does final export produce real validated files and an accurate compatibility/QA report?**
   - **Evidence:** `src/services/renderExportQaEngine.ts` (`createAndExecuteCanonicalRenderJob`, `validateWrittenRenderOutput`, `analyzeAdapterFeatureLoss`, `runFinalRenderQaVerification`), `src/components/RenderExportQaWorkspace.tsx` (`/app/render-export`); verified by `src/tests/renderExportQa.test.ts`.
9. **Are secrets, permissions, untrusted extensions, SSRF surfaces and user data isolated and tested?**
   - **Evidence:** `src/services/providerHubEngine.ts`, `src/server/apiApp.ts` (`/api/v1/me/data-export`, `DELETE /api/v1/me/account-data`, `Cache-Control: no-store`), `firestore.rules` (21 collections); verified by `src/tests/securityObservabilityReleasePhase14.test.ts`, `src/tests/providerHub.test.ts`, and `src/tests/firestore.rules.test.ts`.
10. **Did typecheck, lint, tests, build and browser verification actually run and pass?**
    - **Evidence:** `npm run lint` (`0 errors`), `npm run lint:rules` (`0 errors`), `npm test` (`93/93 passing across 17 suites`), and `npm run build` / `compile_applet` (`PASS`).

---

## 3. Part D — Final Product Acceptance Checklist

- [x] Visible Sowveil Studio reference UI is preserved (`src/components/CatalogBrowserWorkspace.tsx`, `src/components/ModuleStrip.tsx`).
- [x] All 20 modules exist in exact order (`1–20`) and have real module behavior (`src/data/modules.ts`).
- [x] Known catalog counts are preserved (`Text Animation 220`, `Expressions 12`, `Easing 26`, `SFX 60`) and expandable (`src/data/catalogSeeds.ts`, `src/services/marketplaceEngine.ts`).
- [x] Templates are truly editable for declared parameters and persist variants (`Template` vs. `Your edits` + `Fork template`).
- [x] Reference Lab can turn authorized reference material into editable templates with a truthful fidelity report (`/app/reference-lab`).
- [x] Canonical project schema (`v2.0.0`) unifies templates, manual edits, AI Director edits and exports (`src/types/canonicalProject.ts`).
- [x] Provider Hub supports Gemini, OpenAI-compatible variants, Anthropic and custom adapters with capability testing and server-side AES-256-GCM secret protection (`/app/provider-hub`).
- [x] Skills, GitHub repos, websites and APIs can be added through a sandboxed, permissioned extension system with rollback (`src/services/providerHubEngine.ts`).
- [x] AI Director analyzes the full script without silent omission, asks only necessary questions, creates an editable shot plan, builds the timeline, proposes improvements and verifies acceptance (`/app/ai-director`).
- [x] Mobile-first editor supports real timeline/layer/text/keyframe/audio/caption editing and transactional AI co-editing (`/app/editor`).
- [x] Template Factory saves validated reusable templates and avoids duplicates (`/app/template-factory`).
- [x] Rendering and export produce real validated files and honest mobile-app handoff packages (`/app/render-export`).
- [x] Security, privacy, persistence, tests, build and documentation are verified (`src/tests/securityObservabilityReleasePhase14.test.ts`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`).
