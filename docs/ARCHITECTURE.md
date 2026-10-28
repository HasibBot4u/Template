# Sowveil Studio — System Architecture (`docs/ARCHITECTURE.md`)

## 1. Architectural Overview

Sowveil Studio (`v2.4.0-canonical`) is an Android/mobile-first full-stack web application and Progressive Web App (PWA) built around a single **Canonical Editable Project Schema (`v2.0.0`)**:

- **Frontend (`src/`)**: React 19, TypeScript, Tailwind CSS v4, Lucide icons, and a deterministic HTML5 Canvas / SVG / Web Audio procedural motion engine (`src/components/PreviewRenderer.tsx`).
- **Backend API (`server.ts` & `src/server/apiApp.ts`)**: Express server on port `3000` serving `/api/v1/*` REST endpoints with server-side Firebase token verification, RBAC (`user`, `admin`, `owner`), sliding-window rate limiting, SSRF validation, AES-256-GCM credential encryption, and atomic JSON snapshot durability (`src/server/durableStore.ts`).
- **Cloud Persistence (`src/services/firebaseClient.ts`, `firestore.rules`, `firebase-blueprint.json`)**: Firebase Authentication (Google Sign-In) and Cloud Firestore across 21 secured collections with offline-resilient repository synchronization (`src/repositories/workspaceRepository.ts`).

---

## 2. Core Domain Engines (`src/services/`)

| Engine File | Responsibility |
|---|---|
| `src/services/canonicalProjectEngine.ts` | Canonical Project Schema `v2.0.0`, lossless migration from `1.0.0` and `2.4.0-mobile`, `CanonicalProjectStore`, and 36 typed editing commands with `ProjectCommandReceipt` & undo/redo stacks. |
| `src/services/catalogEngine.ts` | Deterministic catalog filtering, facet counting, relevance search, and sorting across all 20 reference modules. |
| `src/services/marketplaceEngine.ts` | Template Marketplace validation jobs (`runTemplateValidationJob`), `TemplateVariantInstance` overrides (`Your edits`), `forkTemplateFromVariant`, and SVG XSS sanitization. |
| `src/services/referenceLabEngine.ts` | Rights-aware Reference Lab reconstruction (`Authorized Reconstruction Mode` vs. `Reference-Inspired Mode`), shot boundary detection, per-property provenance, 7 correction tools, and `ReconstructionFidelityReport`. |
| `src/services/providerHubEngine.ts` | 7 protocol adapters (`google-gemini`, `openai-chat-completions`, `openai-responses`, `anthropic-messages`, `openai-compatible-variant`, `azure-openai`, `custom-rest-adapter`), AES-256-GCM secret vault, 14-capability verification registry, 8 task routing profiles, untrusted Extensions sandbox, and server-authorized Typed Tool Registry. |
| `src/services/aiDirectorProductionEngine.ts` | 7-stage durable AI Director production state machine, SHA-256 script lock, 4,000-char chunked offset-exact segmentation, coverage ledger, 20-field Brief, 22-field Shot Plan, 4-tier asset ranking, canonical project compilation, and 10-point Acceptance Gate. |
| `src/services/coEditingEngine.ts` | Transactional AI Co-Editing (`AiCoEditTransaction`) over `CanonicalProjectDocument` across 10 prompt archetypes with preconditions, diff preview, selective accept/reject, and 1-click rollback. |
| `src/services/templateFactoryEngine.ts` | 10-stage Template Factory pipeline, 9-category parameter extraction, `GeneralizationReport`, content-hash & semantic similarity deduplication, 7-check Quality & Determinism Gate, and consent-gated preference signals. |
| `src/services/renderExportQaEngine.ts` | Canonical render & export pipeline (`timeline-preview`, `proxy-render`, `final-render`), real work-unit progress, startup crash recovery (`interrupted-on-restart`), binary/structural output validators (`PNG`, `WAV`, `SRT`, `VTT`, `JSON`, `XML`, `ZIP`), 6 mobile adapter feature-loss analyzers, and 8-gate Final QA verifier. |

---

## 3. Route & Workspace Map (`src/App.tsx`)

- `/` & `/app/:moduleId` — 20-Module Reference Studio & Interactive Catalog Browser (`src/components/CatalogBrowserWorkspace.tsx`)
- `/app/reference-lab` — Rights-Aware Reference Reconstruction Lab (`src/components/ReferenceLabWorkspace.tsx`)
- `/app/provider-hub` — AI Provider Hub, Secret Vault, Extensions & Tool Registry (`src/components/ProviderHubWorkspace.tsx`)
- `/app/ai-director` — AI Director Script-to-Timeline Production Studio (`src/components/AiDirectorWorkspace.tsx`)
- `/app/editor` — Professional Mobile Multi-Track Editing Studio & AI Co-Editor (`src/components/EditingStudioWorkspace.tsx`)
- `/app/template-factory` — Template Factory, Deduplication & Continuous Reuse (`src/components/TemplateFactoryWorkspace.tsx`)
- `/app/render-export` — Canonical Render, Export, Mobile Adapters & Final QA (`src/components/RenderExportQaWorkspace.tsx`)
- `/app/dashboard`, `/app/favorites`, `/app/jobs`, `/app/settings/*` — User Workspace, Data Portability & Account Deletion (`src/components/SecondaryAppPages.tsx`)
- `/technical` — Redacted Technical Diagnostics & Capability Inspector (`src/components/SecondaryAppPages.tsx`)
- `/admin/*` — Role-Protected Admin Operations Console (`src/components/AdminConsoleWorkspace.tsx`)
