# Sowveil Studio — Project Forensic Audit & Protected Migration Plan

**Audit Date:** 2026-04-20  
**Target Environment:** Android-first Creative Studio Web App / PWA (Vite + React 19 + TypeScript + Express + Firebase Firestore/Auth)  
**Audit Methodology:** Direct source-level inspection + static typecheck + ESLint rules check + Vitest execution across all repository modules. No secret values are exposed.

---

## 1. Repository File & Symbol Inventory

### 1.1 Build, Server & Configuration Files
| File Path | Key Symbols / Configuration | Role & Audit Findings |
|---|---|---|
| `/package.json` | Scripts: `dev` (`tsx server.ts`), `build` (`vite build`), `start` (`tsx server.ts`), `test` (`vitest run`), `lint` (`tsc --noEmit`), `lint:rules` (`eslint firestore.rules`) | Full-stack Express + Vite SPA setup. Dependencies include `firebase@^12.12.0`, `express@^4.21.2`, `zod@^4.3.6`, `lucide-react@^1.16.0`, `vite-plugin-pwa@^1.2.0`. |
| `/vite.config.ts` | `VitePWA(...)`, `workbox.runtimeCaching` | Generates `/manifest.webmanifest`, registers SW, precaches static shell, and restricts `/api/v1/catalog` `StaleWhileRevalidate` cache to unauthenticated public `GET` requests (`!request.headers.has('authorization')`, `!url.searchParams.has('includeDrafts')`, `visibility === null \|\| visibility === 'published'`). |
| `/server.ts` | `startServer()` | Mounts `createApiApp()` from `src/server/apiApp.ts` on port `3000`, attaches Vite middleware in development and serves `dist/` with SPA fallback in production. |
| `/.env.example` | `FIREBASE_PROJECT_ID`, `SOWVEIL_BOOTSTRAP_OWNER_SECRET`, `SOWVEIL_ADMIN_UIDS`, `SOWVEIL_CREDENTIAL_MASTER_KEY` | Template only; no hardcoded or predictable default secrets remain. |
| `/firestore.rules` | `isSignedIn()`, `isAdmin()`, `isValidProjectRecord()`, `isValidJobRecord()`, `isValidCatalogItem()` | Enforces strict RBAC (`admin`, `editor`, `moderator`, `user`, `suspended`), field-level `hasOnly`/`hasAll` schemas, and immutable `userId`/`createdAt`. Fixed in Phase 0 to allow `checkpoints` on projects and progress/status fields on jobs. |
| `/firebase-blueprint.json` | Entities: `UserProfile`, `UserRoleGrant`, `CatalogItemRecord`, `FavoriteRecord`, `ProjectRecord`, `JobRecord`, `AuditEventRecord` | Canonical Firestore blueprint synced with `/firestore.rules`. |
| `/firebase-applet-config.json` | `projectId: "gen-lang-client-0519616269"`, `firestoreDatabaseId: "ai-studio-411ad70d-501b-4df1-8287-ce21e9091d8d"` | Provisioned Firebase Web client configuration consumed by `src/services/firebaseClient.ts`. |

### 1.2 Core Data, Schemas & Services
| File Path | Key Symbols | Role & Audit Findings |
|---|---|---|
| `/src/types/sowveil.ts` | `ModuleId` (20 union literals), `ModuleDefinition`, `CatalogItem`, `EditableProperty`, `ProjectLibraryItem`, `JobRecord`, `UserProfile` | Defines core TypeScript interfaces across the 20 modules, workspace persistence, and catalog items. Contains legacy desktop-named fields (`CompanionState.aeActiveComp`, `HostOperationName`) retained for backwards compatibility. |
| `/src/schemas/sowveilSchemas.ts` | `CatalogItemSchema`, `ProjectLibraryItemSchema`, `JobRecordSchema`, `AdminMutationAuditSchema`, `validateAndMigrateCatalogItem` | Zod v4 validation schemas for catalog items, user projects, jobs, and audit logs. |
| `/src/data/modules.ts` | `SOWVEIL_MODULES` (20 modules), `MODULE_MAP`, `computeActualModuleCounts()` | Defines the 20 reference modules in exact 2-row order (`displayOrder` 1–10 in Row 1, 11–20 in Row 2), preserving both `referenceReportedCount` (e.g., Text Animation `220`, Expressions `12`, Easing `26`, SFX `60`) and dynamically computed `actualItemCount`. |
| `/src/data/catalogSeeds.ts` | `SEED_CATALOG_ITEMS` (74 items) | Seeded catalog records across the 17 catalog-browsing modules with authentic editable property definitions (`slider`, `color`, `select`, `text`, `toggle`), tags, and expression snippets. |
| `/src/services/catalogEngine.ts` | `queryCatalog()`, `scoreCatalogItem()`, `extractFacetCounts()`, `computeRelatedItems()` | Deterministic search, relevance scoring, facet counting, sorting (`featured`, `popular`, `newest`, `name-asc`, `duration-asc`), and pagination engine. |
| `/src/services/jobStateMachine.ts` | `canTransitionJobStatus()`, `transitionJob()`, `createInitialJob()` | Enforces legal state transitions across `draft` → `queued` → `validating` → `uploading` → `processing` → `finalizing` → `completed` / `failed` / `cancelled` / `expired` / `quota-reached`. |
| `/src/services/firebaseClient.ts` | `firebaseApp`, `firebaseAuth`, `firestoreDb`, `signInWithGooglePopup()`, `OperationType`, `handleFirestoreError()` | Initializes Firebase Auth and named Firestore database with popup auth fallback and structured error diagnostics. |
| `/src/repositories/workspaceRepository.ts` | `WorkspaceRepository`, `FirestoreWorkspaceRepository`, `LocalFallbackWorkspaceRepository` | Implements real Firestore CRUD (`favorites/{uid}_{itemId}`, `projects/{id}`, `jobs/{id}`, `users/{uid}`) with revision concurrency checks, bounded project checkpoints (`MAX_CHECKPOINTS = 20`), and offline/signed-out localStorage fallback. |

### 1.3 Mobile Editor Gateway, Media Workflows & AI Director
| File Path | Key Symbols | Role & Audit Findings |
|---|---|---|
| `/src/features/editor-gateway/schemas.ts` | `MotionDocumentSchema`, `AdapterActionResultSchema`, `TargetEditorIdSchema`, `ExportFormatIdSchema` | Canonical `MotionDocument` (`2.4.0-mobile`) schema and adapter action outcome contract (`opened`, `shared`, `downloaded`, `copied`, `ready`, `unsupported`, `failed`). |
| `/src/features/editor-gateway/adapters.ts` | `MOBILE_EDITOR_ADAPTERS`, `getEditorAdapter()`, `getCapabilityMatrix()` | Capability matrix for `sowveil-Composer`, ` alight-motion`, `capcut-mobile`, `vn-editor`, `luma-fusion`, `kine-master`, `inshot-mobile`, `system-share`, and `file-export`. |
| `/src/features/editor-gateway/strategies.ts` | `generateExportArtifact()`, `encodeZlibStoredStream()`, `renderPngStillPlate()`, `generateSvgVectorCard()`, `generateJsonMotionBundle()`, `generateStandaloneHtml5Preview()`, `generateSrtCaptions()`, `generateVttCaptions()`, `generateCsvCueSheet()`, `generateSvgCurveSpec()` | Real client/server artifact generators. Generates multi-block RFC 1950/1951 PNG still plates at full `1080×1920` (`9:16`) and `1080×1080` (`1:1`) resolutions, plus `64×64` preview thumbnails, SVG cards, JSON motion bundles, HTML5 players, SRT/VTT captions, and CSV cue sheets. |
| `/src/services/editorGateway.ts` | `buildProjectDocument()`, `validateExportArtifact()`, `executeAdapterAction()` | Bridges `CatalogItem` + parameter overrides into `SowveilProjectDocument`, validates generated artifacts (XML/JSON/SRT/VTT/PNG signature checks), and executes Web Share API / File Download / Deep Link handoffs. |
| `/src/features/media-workflows/index.ts` | `parseCaptionCueText()`, `exportCaptionsToSrt()`, `exportCaptionsToVtt()`, `validateRemoteMediaUrl()`, `inspectAuthorizedMediaInput()` | Real SRT/VTT parser & serializer, timing overlap validator, and SSRF-hardened URL validator (rejects `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254`, `.local`, `.internal`, and platform terms violations). |
| `/src/features/ai-director/*` | `ServerCredentialVault` (`securityVault.ts`), `validateCustomProviderEndpoint()`, `executeProviderPrompt()` (`providerAdapters.ts`), `applyTimelineCommand()`, `rollbackProjectToRevision()` (`timelineEngine.ts`), `segmentScriptExhaustively()`, `generateDirectorBriefAndPlan()`, `compileTimelineFromPlan()`, `auditScriptCoverage()` (`scriptDirector.ts`) | AES-256-GCM server-side secret vault, SSRF-protected multi-provider adapters (Gemini, OpenAI, Anthropic, OpenRouter, Custom OpenAI-compatible), canonical `SowveilTimelineProject` (`3.0.0-timeline`) command engine with checkpoints, and exhaustive script-to-shot coverage compiler. |

### 1.4 Frontend UI Components & Routes
| File Path | Key Symbols | Role & Audit Findings |
|---|---|---|
| `/src/App.tsx` | `SowveilStudioApp`, `WorkspaceModuleRoute` | Main router supporting `/`, `/pricing`, `/templates`, `/docs`, `/privacy`, `/terms`, `/login`, `/signup`, `/reset-password`, `/app/:moduleSlug`, `/app/account`, `/app/billing`, `/app/exports`, `/app/settings`, `/app/help`, `/app/status`, `/app/admin`. |
| `/src/components/TopHeaderBar.tsx` | `TopHeaderBar` | Studio header bar with brand badge, workspace mode indicator, quick links, and user account trigger. |
| `/src/components/ModuleStrip.tsx` | `ModuleStrip` | Renders the exact 2-row, 10-column desktop / horizontal-scroll mobile navigation strip for all 20 modules with icon, label, and live item count badge. |
| `/src/components/CatalogBrowserWorkspace.tsx` | `CatalogBrowserWorkspace` | Category filter bar, search input, sort dropdown, grid/list toggle, responsive card grid, and live right-hand/drawer inspector with real parameter sliders/color/text/select controls and honest action states. |
| `/src/components/PreviewRenderer.tsx` | `PreviewRenderer` | Interactive deterministic canvas/DOM preview engine for all 17 catalog module families (kinetic typography, easing graphs, audio waveform synth via Web Audio API, liquid glass shaders, 3D/mockup cards, transitions, maps, etc.). |
| `/src/components/UtilityWorkspaces.tsx` | `AutoCaptionsWorkspace`, `MediaInspectorWorkspace`, `ProjectLibraryWorkspace` | Specialized workspaces for Modules 18 (`auto-captions`), 19 (`downloader`), and 20 (`project-library`), including SRT/VTT import/edit/export, SSRF-safe media inspection, and Firestore project revision/checkpoint rollback. |
| `/src/components/ExportOpenInModal.tsx` | `ExportOpenInModal` | Mobile editor handoff & artifact export modal with real artifact validation receipts, SHA-like size reporting, and Web Share / file download actions. |
| `/src/components/AdminConsoleWorkspace.tsx` | `AdminConsoleWorkspace` | Admin console with tabs for Overview, Catalog CRUD, Modules, Users & Roles, Editor Adapters, Audit Logs, and Security Diagnostics. |

---

## 2. Public API Contracts (`src/server/apiApp.ts`)

| Endpoint | Method | Auth / Role | Request / Query Schema | Response Contract | Persistence / Backing Store |
|---|---|---|---|---|---|
| `/api/v1/health` | `GET` | Public | None | `{ ok, data: { status, version, service, timestamp, uptimeSeconds, capabilities } }` | Stateless runtime metrics |
| `/api/v1/auth/verify` | `GET` | Bearer Token | Header `Authorization: Bearer <jwt>` | `{ ok, data: { uid, email, role, status } }` | Verified via Firebase Auth / Google JWKS (`jose`) + `roleStore` |
| `/api/v1/auth/bootstrap-owner` | `POST` | Bearer Token + Header `x-sowveil-bootstrap-secret` | `{ confirm: true }` | `{ ok, data: { uid, role: 'admin', bootstrappedAt } }` | Fails closed (`503`) if `SOWVEIL_BOOTSTRAP_OWNER_SECRET` env var is unset or `<16` chars |
| `/api/v1/catalog` | `GET` | Public (Drafts require `admin`/`editor`) | Query: `moduleId`, `category`, `search`, `sortBy`, `aspectRatio`, `page`, `pageSize`, `includeDrafts`, `visibility` | `{ ok, data: { items, totalCount, page, pageSize, totalPages, facetCounts } }` | `catalogStore` (seeded from `SEED_CATALOG_ITEMS`); sets `Cache-Control: private, no-store` if auth/drafts present |
| `/api/v1/catalog/:id` | `GET` | Public (Drafts require `admin`/`editor`) | Path `:id` | `{ ok, data: CatalogItem }` | `catalogStore` |
| `/api/v1/catalog` | `POST` | `admin`, `editor` | `CatalogCreateSchema` | `{ ok, data: CatalogItem }` | `catalogStore` + `auditLog` |
| `/api/v1/catalog/:id` | `PATCH` | `admin`, `editor` | `CatalogPatchSchema` | `{ ok, data: CatalogItem }` | `catalogStore` + `auditLog` |
| `/api/v1/catalog/:id/status` | `POST` | `admin`, `editor`, `moderator` | `{ status: 'draft' \| 'published' \| 'archived' }` | `{ ok, data: CatalogItem }` | `catalogStore` + `auditLog` |
| `/api/v1/catalog/:id` | `DELETE` | `admin` | Path `:id` | `{ ok, data: { deletedId } }` | `catalogStore` + `auditLog` |
| `/api/v1/modules` | `GET` / `PATCH` | Public `GET` / `admin` `PATCH` | `ModulePatchSchema` | `{ ok, data: ModuleDefinition[] }` | `modulesStore` |
| `/api/v1/adapters` | `GET` / `PATCH` | Public `GET` / `admin` `PATCH` | `AdapterPatchSchema` | `{ ok, data: MobileEditorAdapter[] }` | `editorAdaptersStore` |
| `/api/v1/media/inspect` | `POST` | Public (Rate-limited) | `{ url, rightsConfirmed, sourceType }` | `{ ok, data: MediaInspectResult }` | Stateless SSRF-guarded validator |
| `/api/v1/captions/process` | `POST` | Public (Rate-limited) | `{ rawText, format, fps, maxCharsPerLine }` | `{ ok, data: { cues, srt, vtt, warnings } }` | Stateless caption engine |
| `/api/v1/export/generate` | `POST` | Public (Rate-limited) | `{ itemId, formatId, targetEditorId, parameterValues, aspectRatio }` | `{ ok, data: ExportArtifactPackage }` | Stateless generator (`strategies.ts`) |
| `/api/v1/admin/*` | `GET`/`POST`/`DELETE` | `admin`, `editor`, `moderator` | Overview, users, roles, status, audit, assets | Enforces `Cache-Control: private, no-store, no-cache, must-revalidate` + `Vary: Authorization` | `roleStore`, `userStatusStore`, `auditLog`, `assetsStore` |
| `/api/v1/ai/*` | `GET`/`POST`/`DELETE` | Authenticated user (`uid` scoped) | Credentials vault, script brief, timeline compile, command execution, coverage audit | `{ ok, data: ... }` | `ServerCredentialVault` (AES-256-GCM) + `aiProjectStore` (per-user Map) |

---

## 3. Confirmed Defects vs. Risk Hypotheses

### 3.1 Confirmed Defects Fixed in Phase 0 (Immediate Security & Integrity Hardening)
1. **[CRITICAL — FIXED] Predictable Owner Bootstrap Secret Fallback**
   - **Location:** `/.env.example` (line 19) & `/src/server/apiApp.ts` (`getBootstrapOwnerSecret`, lines 417–421 & `/api/v1/auth/bootstrap-owner`, lines 2292–2302).
   - **Evidence:** Previously accepted a predictable fallback string if `SOWVEIL_BOOTSTRAP_OWNER_SECRET` was not customized.
   - **Fix Applied:** Removed fallback value; `getBootstrapOwnerSecret()` returns `null` unless `process.env.SOWVEIL_BOOTSTRAP_OWNER_SECRET` is explicitly set to at least 16 characters, and `/api/v1/auth/bootstrap-owner` fails closed with HTTP `503 BOOTSTRAP_NOT_CONFIGURED`.
2. **[HIGH — FIXED] Workbox Runtime Cache Leakage on `/api/v1/catalog`**
   - **Location:** `/vite.config.ts` (lines 92–102) & `/src/server/apiApp.ts` (lines 1185–1193).
   - **Evidence:** Previously, Workbox `urlPattern` matched all `/api/v1/catalog` requests regardless of `Authorization` headers or `includeDrafts=true`.
   - **Fix Applied:** Restricted Workbox `urlPattern` to cache only when `request.method === 'GET'`, `!request.headers.has('authorization')`, `!url.searchParams.has('includeDrafts')`, and `visibility` is absent or `'published'`. Server route also sets `Cache-Control: private, no-store` whenever auth headers or draft filters are present.
3. **[HIGH — FIXED] Firestore Security Rules Schema Drift Blocking Project Checkpoints & Job Progress Updates**
   - **Location:** `/firestore.rules` (`isValidProjectRecord` lines 116–142, `isValidJobRecord` lines 144–176).
   - **Evidence:** `allow update` on `/projects/{projectId}` (line 298) permitted `'checkpoints'` in `affectedKeys()`, and `FirestoreWorkspaceRepository.saveProject` (`src/repositories/workspaceRepository.ts` lines 246, 295) writes `checkpoints`, but `isValidProjectRecord` omitted `'checkpoints'` from `data.keys().hasOnly(...)`, causing Firestore permission denials on checkpoint writes. Similarly, `isValidJobRecord` omitted `'draft'`, `'uploading'`, `'finalizing'`, `'quota-reached'` and byte/stage progress fields.
   - **Fix Applied:** Updated `isValidProjectRecord` and `isValidJobRecord` in `/firestore.rules` and `/firebase-blueprint.json` to validate optional `checkpoints` (list, max 20) and job progress fields.
4. **[MEDIUM — FIXED] Downscaled PNG Still Plates & Synthetic Host Execution Toasts**
   - **Location:** `/src/features/editor-gateway/strategies.ts` (`encodeZlibStoredStream`, `renderPngStillPlate`), `/src/components/CatalogBrowserWorkspace.tsx`, `/src/components/ExportOpenInModal.tsx`.
   - **Evidence:** Single-block uncompressed DEFLATE limited PNG generation to 64×64 thumbnails, and UI buttons showed simulated host completion messages.
   - **Fix Applied:** Implemented multi-block RFC 1950/1951 stored DEFLATE supporting full `1080×1920` (`9:16`) and `1080×1080` (`1:1`) PNG still plates, separated from `64×64` preview thumbnails (`generatePngPreviewThumbnail`), and replaced synthetic timers with real artifact validation and honest handoff statuses (`downloaded` vs `ready`).

### 3.2 Confirmed Architectural Gaps Scheduled for Protected Migration (Phases 1–6)
1. **[HIGH] Dual-Persistence Split Between Express In-Memory Stores and Cloud Firestore**
   - **Location:** `/src/server/apiApp.ts` (lines 425–446: `roleStore`, `userStatusStore`, `catalogStore`, `modulesStore`, `editorAdaptersStore`, `assetsStore`, `auditLog`, `ownerBootstrappedUid`, `aiProjectStore`).
   - **Evidence:** While user workspace records (`favorites`, `projects`, `jobs`, `users`) persist in Cloud Firestore via `FirestoreWorkspaceRepository` (`src/repositories/workspaceRepository.ts`), server-side admin mutations, catalog creations, and AI Director projects live in volatile Node `Map` instances that reset when the server restarts.
2. **[MEDIUM] Catalog Browser Reads Static `SEED_CATALOG_ITEMS` Instead of Live Catalog Repository**
   - **Location:** `/src/App.tsx` (`WorkspaceModuleRoute`, lines 110–113).
   - **Evidence:** `WorkspaceModuleRoute` filters `SEED_CATALOG_ITEMS` directly in memory (`SEED_CATALOG_ITEMS.filter(item => item.moduleId === activeModule.id && item.status !== 'archived')`), so items added or edited in `AdminConsoleWorkspace` via `/api/v1/catalog` do not appear in the main module browser until unified with live catalog fetching.
3. **[MEDIUM] Three Parallel Project Schemas Need a Single Canonical Bridge**
   - **Location:**
     1. `ProjectLibraryItem` (`/src/types/sowveil.ts`, lines 318–337) — template parameter overrides + checkpoints.
     2. `MotionDocument` / `SowveilProjectDocument` `2.4.0-mobile` (`/src/features/editor-gateway/schemas.ts` & `/src/services/editorGateway.ts`) — single-item export bundle.
     3. `SowveilTimelineProject` `3.0.0-timeline` (`/src/features/ai-director/types.ts`) — multi-scene, multi-track timeline with script coverage and command history.
   - **Evidence:** Template edits in `ProjectLibraryWorkspace` save `ProjectLibraryItem` records, whereas `/api/v1/ai/project` operates on `SowveilTimelineProject`. A lossless bidirectional converter is needed so templates, manual edits, and AI Director share one canonical project state.
4. **[LOW] Desktop Terminology Remnants in Descriptions & Types**
   - **Location:** `/src/data/modules.ts` (lines 24, 283, 299, 315) and `/src/types/sowveil.ts` (`CompanionState.aeActiveComp`, `HostOperationName`).
   - **Evidence:** Module descriptions still mention "After Effects timeline properties" or "desktop yt-dlp" as historical contrast notes.

### 3.3 Risk Hypotheses (Evaluated &Monitored)
- **Hypothesis 1: Large `1080×1920` uncompressed stored-DEFLATE PNG buffers (~8.3 MB) may pressure memory on low-RAM Android devices if generated repeatedly in rapid succession.**
  - *Status:* Plausible mobile memory risk. `renderPngStillPlate` allocates a single `Uint8Array` per export request, and preview cards use `64×64` thumbnails (`generatePngPreviewThumbnail`, ~16 KB). Future optimization should stream or compress PNG chunks using `CompressionStream('deflate')` where available.
- **Hypothesis 2: DNS Rebinding on Custom AI Provider Endpoints.**
  - *Status:* Mitigated at URL parsing layer (`validateCustomProviderEndpoint` blocks private IPs, localhost, and non-HTTPS), and `executeProviderPrompt` sets `redirect: 'error'`. Performing a pre-connect DNS lookup (`dns.lookup`) in Node before `fetch` will harden against custom domains resolving to `127.0.0.1`.

---

## 4. Protected Migration Plan

| Phase | Scope & Objective | Risk Level | Dependencies | Rollback Plan | Verification Tests |
|---|---|---|---|---|---|
| **Phase 0 (Completed)** | Forensic audit docs, remove predictable bootstrap secret, harden Workbox `/api/v1/catalog` cache, fix `firestore.rules` project checkpoint & job fields, full-res PNG still plates, remove synthetic toasts. | Low | None | Revert individual rules/config commits; zero schema-breaking changes. | `npm run lint:rules`, `npm run lint`, `npm test` (49/49 passing). |
| **Phase 1: Reference UI Lock & Live Catalog Sync** | Connect `WorkspaceModuleRoute` (`src/App.tsx`) to live catalog state (`/api/v1/catalog` + Firestore `/catalogItems` fallback to `SEED_CATALOG_ITEMS`) while keeping the 2-row 20-module reference UI untouched. Clean up desktop copy remnants. | Low | Phase 0 | Fallback to `SEED_CATALOG_ITEMS` selector if API/Firestore is offline. | Visual & DOM snapshot tests for all 20 modules + catalog live-update integration test. |
| **Phase 2: Canonical Project Schema Unification** | Bridge `ProjectLibraryItem`, `MotionDocument` (`2.4.0-mobile`), and `SowveilTimelineProject` (`3.0.0-timeline`) with deterministic upcast/downcast migrations and Zod validation so manual inspector edits, Project Library items, and AI Director share one project model. | Medium | Phase 1 | Preserve original `parameterValues` map alongside `timelineDocument` field; non-destructive additive schema migration. | Unit & property tests verifying round-trip conversion without losing parameters, keyframes, or checkpoints. |
| **Phase 3: Durable Server Persistence & Firestore Sync** | Back server-side `catalogStore`, `roleStore`, `auditLog`, and `aiProjectStore` with durable storage / Firestore synchronization so restarts do not wipe admin mutations or AI Director projects. | Medium | Phase 2 | Keep in-memory cache layer with write-through adapter; can toggle back to memory-only in test mode. | Persistence restart test suite & RBAC cross-user isolation tests. |
| **Phase 4: Mobile Editor & Export Upgrade** | Add `CompressionStream` deflate optimization for `1080×1920` PNG still plates and WebCodecs / Canvas `MediaRecorder` real WebM/MP4 preview clip rendering on supported Android browsers. | Medium | Phase 2 | Graceful fallback to existing RFC 1951 stored-DEFLATE PNG, HTML5 standalone player, and JSON/SVG bundles. | Artifact binary header validation + mobile viewport E2E check. |
| **Phase 5: Contextual AI Director Drawer UI** | Add a non-intrusive contextual drawer in `ProjectLibraryWorkspace` and a dedicated `/app/director` route (leaving the 20-module reference header untouched when closed) wired to `/api/v1/ai/*`. | Low | Phases 2 & 3 | Feature-flagged drawer route; closing drawer restores exact reference workspace. | End-to-end script segmentation, coverage audit, and checkpoint rollback UI tests. |
