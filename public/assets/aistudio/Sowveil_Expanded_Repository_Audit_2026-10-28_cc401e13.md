# Sowveil Studio — Expanded Repository Audit and Mobile-Landscape UI Specification

**Audit date:** 28 October 2026  
**Repository:** https://github.com/HasibBot4u/Template  
**Branch inspected:** `main`  
**README version label:** `v2.4.0-canonical`  
**Purpose:** source-level audit of the current public repository, a reality check against the reference-video clone and the declared AI-production vision, plus a mobile-landscape implementation specification.

> **Scope and evidence boundary:** This is a deeper source review of the public GitHub files that could be inspected through the repository and raw-file views. I attempted to clone the repository into the execution environment, but DNS/network access to `github.com` failed. Therefore, I did **not** independently install packages, execute the build/tests, launch the app, inspect its live DOM, run the model endpoints, or capture a screenshot from the running code. Where the repository's own documentation says a test or build passed, this report treats that as a repository claim—not as a result independently reproduced in this environment. Findings below are marked **Confirmed from source**, **Strong implementation risk**, or **Requires runtime verification** accordingly.

---

## 1. Executive verdict

The current repository is no longer just the early marketplace shell described in the earlier review. Its README and current source tree describe a much larger application: a 20-module reference interface, canonical project graph and editing commands, a Reference Lab, Provider Hub, AI Director, mobile editing workspace, Template Factory, rendering/export/QA workspace, and security/admin tooling.

However, **the existence of a route, type, engine, API handler, or unit test does not prove that the feature works end-to-end**. I found multiple source-level contradictions between the advertised capabilities and what the implementation actually does:

1. The Provider Hub's connection probe builds a hypothetical request and then marks capabilities as verified without making an HTTP request.
2. The legacy provider-test endpoint returns `verified: true` and a hard-coded `18 ms` latency without contacting the provider.
3. The AI Director route passes `authToken={null}`, then the component sends `X-Test-*` headers; the server authentication middleware explicitly requires a Bearer token.
4. The main AI Director production path is a deterministic local compiler. The inspected production engine has no network/model invocation and compiles generic template/title/caption/audio clips, rather than asking a selected model to do full creative direction.
5. The Provider Hub React component imports runtime functions from a module that imports `node:crypto`, `Buffer`, and `process.env`. That creates a client/server boundary problem in a Vite browser bundle.
6. The encrypted vault has a known hard-coded fallback master secret if `SOWVEIL_VAULT_KEY` is not configured.
7. The Reference Lab UI initializes the usage mode to `authorized-reconstruction` and its rights checkbox to `true`; this contradicts the documented requirement for an explicit mandatory choice/declaration.
8. The default durable snapshot is a server-local JSON file. That is not, by itself, a shared durable data store for multi-instance or redeployed cloud hosting.
9. MP4/WebM output is gated on an external render worker and explicit data-upload consent; absent a configured, actually working worker, the project cannot produce those final video formats.
10. Existing source and documentation do not establish that the original interface is pixel-perfect, that the new route implementations are visibly integrated in the exact intended navigation state, or that all desktop and mobile interactions have been browser-tested.

**Overall assessment:** the repository contains significant scaffolding and deterministic creative-engine logic, but it should not be treated as a completed, production-grade AI video-production environment until the defects and capability gaps below are corrected and verified with runtime tests. The first priority is to remove false-success behavior, correct authentication and secrets, and separate browser-safe client code from server-only operations. The second is to connect actual model calls to the AI Director. The third is to validate the actual UI at phone-landscape and desktop sizes.

## 2. Can the landscape UI be achieved on a phone in landscape orientation?

**Yes—with a purpose-built landscape mode. No—if the requirement is to squeeze every desktop panel onto a phone at the same size and expect the same legibility.**

The generated landscape concept is a useful target for a wide creative workspace: marketplace on the left, composition preview in the center, AI Director/shot list beside it, property inspector on the right, and the timeline along the bottom. A modern phone rotated horizontally can display this general arrangement. The browser's CSS viewport is much smaller than the phone's advertised physical-pixel resolution, though, and browser chrome, safe-area insets and touch ergonomics reduce the usable area further.

### Recommended interaction model

The mobile landscape mode must be **adaptive, not a scaled-down desktop screenshot**:

- **Top bar:** compact project title, save state, undo/redo, preview/play, export and a panel-layout menu. Use a compact height; hide nonessential account and administrative controls behind menus.
- **Module bar:** retain all 20 modules, but place them in a horizontally scrollable strip or searchable module picker. Do not force 20 full-width labels onto the screen at once. Keep the original module names and order.
- **Marketplace panel:** collapsible left drawer. Default width around 22–27% of the available CSS viewport on a landscape phone; allow the user to hide it to enlarge the canvas.
- **Preview canvas:** the primary central workspace, using the remaining width. Include fit, zoom, safe-area, play/pause, frame step and preview-quality controls. Preview can go full-screen independently.
- **AI Director / Inspector:** one right-side panel with tabs (`Director`, `Properties`, `Effects`, `Keyframes`, `Audio`). Show one at a time on narrow phones. Use a split view on larger tablets and desktop widths.
- **Timeline:** collapsible lower dock, around 25–35% of landscape viewport height when expanded. Track names, snapping, current time, zoom and clip selection must remain usable. Horizontal scrolling should be independent from the page.
- **Touch targets:** aim for approximately 40–44 CSS-pixel controls where feasible. Do not rely on hover-only controls. Add long-press/context menus and keyboard shortcuts only as optional enhancements, not as the only route to an operation.
- **Responsive modes:** `Browse`, `Landscape Studio`, and `Pro Timeline` should share the same project data, not fork into separate applications.
- **Portrait remains supported:** portrait should be the browse/quick-edit mode; landscape is the production workbench. Rotation must not discard edits or force a project reload.
- **No orientation lock as a requirement:** allow users to rotate the device, and do not block the PWA when the operating system/browser does not permit orientation locking.

### Landscape acceptance criteria

1. Validate on an actual Android phone in landscape and portrait, not only desktop DevTools.
2. Validate at minimum a narrow landscape CSS viewport, a typical phone-landscape viewport, a tablet viewport and a desktop viewport.
3. At each viewport, no critical button is clipped; controls remain reachable; drawers and the timeline can be collapsed; the preview maintains the selected aspect ratio; and panel changes do not lose project state.
4. The user can add/select a template, change a property, add or move a timeline clip, use an AI prompt, undo/redo, save, reopen and export without rotating back to portrait.
5. Provide a layout reset action and persist a user's panel-layout preference.
6. Compare screenshots of the *running app* against the supplied UI concept. The concept image itself is not the implementation.

The reference UI and the expanded editing experience should be separate visual goals: first preserve the original 20-module catalogue design faithfully; then add the production workbench as a separate workspace. New panels should not silently replace the reference interface.

## 3. Severity legend

- **P0 — Stop-ship/security:** unsafe in a production deployment or misrepresents a critical operation.
- **P1 — Critical feature blocker:** prevents a core feature from working end-to-end or breaks a core route.
- **P2 — High functional/quality risk:** a significant claim, workflow, compatibility or persistence gap.
- **P3 — Medium/low quality debt:** clarity, maintainability, product polish or unverified behavior.

Confidence indicates whether the source itself proves the defect, rather than whether it was runtime-tested.

## 4. Confirmed source findings and required corrections

### P0-01 — The vault uses a public, predictable fallback encryption secret

**Evidence:** `src/services/providerHubEngine.ts`, approximately lines 350–356: `SOWVEIL_VAULT_KEY` falls back to a literal string (`sowveil-studio-server-vault-key-2026-aes256gcm-v1`); the vault encryption key is derived from this value.

**Why it matters:** if the production environment does not set `SOWVEIL_VAULT_KEY`, credentials encrypted by the application are protected with a value published in the source repository. An attacker who obtains the snapshot can derive the same key. The presence of AES-256-GCM does not fix a known master key.

**Required correction:** in production, refuse to start credential-vault operations unless a strong, randomly generated secret is configured through the deployment secret manager. Do not ship a fallback. Add startup validation and a clear readiness failure. Provide a migration/rotation procedure for credentials already encrypted with the fallback; simply changing the key will make existing ciphertext undecryptable. Keep all decryption/encryption server-side. Never return ciphertext or raw credentials to the browser.

**Confidence:** Confirmed from source; exploitability depends on whether the deployed environment overrides the default.

Source: https://github.com/HasibBot4u/Template/blob/main/src/services/providerHubEngine.ts#L347-L421

### P0-02 — Server-only Node APIs are imported into a browser component

**Evidence:** `src/components/ProviderHubWorkspace.tsx` imports runtime symbols from `../services/providerHubEngine`. That engine begins with `import crypto from 'node:crypto'` and uses `Buffer` and `process.env` for the vault.

**Why it matters:** the component is part of the client-side React app, while vault cryptography is server-only. Standard Vite browser output cannot directly execute Node's built-in `node:crypto` module. Even if the production bundle builds with a warning or externalization, opening or interacting with the Provider Hub may fail at runtime. It also places the wrong security boundary around credentials.

**Required correction:** separate shared type definitions and browser-safe protocol metadata from server-only vault operations. The browser should call `/api/v1/provider-hub/...` with a Firebase ID token. It must never import encryption/decryption functions, master secrets or server-only provider execution logic. Add a browser smoke test that opens Provider Hub after a production build and checks for module errors.

**Confidence:** Confirmed import boundary; actual failure mode requires running the built app.

Sources: https://github.com/HasibBot4u/Template/blob/main/src/components/ProviderHubWorkspace.tsx#L1-L31 and https://github.com/HasibBot4u/Template/blob/main/src/services/providerHubEngine.ts#L0-L1

### P0-03 — The Provider Hub's “live probe” does not perform a network request

**Evidence:** `probeProviderConnection()` is synchronous. It validates the URL, derives/looks up a secret, formats a hypothetical request, handles a few simulated failures, and then marks capabilities as `Verified`. It has no HTTP request/response cycle. The server's `/api/v1/provider-hub/connections/:id/test` calls this function and persists the result as verified.

**Why it matters:** a wrong key, nonexistent model, wrong base path, incompatible payload or offline endpoint can still be labelled healthy. Optional “vision”, “tools”, “structured output” and “streaming” tests can be marked verified merely because the user checked those options. This pollutes the capability registry and makes model routing unreliable.

**Required correction:** create an actual server-side probe implementation for each protocol. It must send a minimal real request, apply a timeout/abort signal, handle redirects safely, parse the real status/body, measure real latency, and mark a capability verified only when a real response demonstrates that capability. If no credential or network is configured, status must remain `Not tested`/`Needs setup`; never synthesize success. Keep failure simulation only in isolated automated tests, not in production request bodies.

**Confidence:** Confirmed from source.

Source: https://github.com/HasibBot4u/Template/blob/main/src/services/providerHubEngine.ts#L1514-L1807 and https://github.com/HasibBot4u/Template/blob/main/src/server/apiApp.ts#L5964-L6023

### P0-04 — A legacy provider-test endpoint also returns fake success

**Evidence:** `POST /api/v1/ai/providers/test` validates the URL and masks the key, but the handler returns `verified: true`, status `healthy` and `latencyMs: 18` as fixed values. There is no provider call in this handler.

**Why it matters:** any UI path still using this legacy endpoint can show a connection as healthy without testing it.

**Required correction:** either remove the legacy endpoint and route all tests through the real Provider Hub probe service, or reimplement it so that it performs a real provider request. Use actual timing, provider response codes and redacted error output.

**Confidence:** Confirmed from source.

Source: https://github.com/HasibBot4u/Template/blob/main/src/server/apiApp.ts#L5312-L5346

### P0-05 — Reference Lab pre-approves the usage/rights declaration by default

**Evidence:** `ReferenceLabWorkspace.tsx` initializes the usage mode to `authorized-reconstruction` and the rights declaration checkbox to `true`.

**Why it matters:** this contradicts the README's “mandatory Usage Mode gate” and the intended distinction between authorized reconstruction and reference-inspired work. The user can arrive in a state that appears to have consented without making an explicit choice. A rights declaration is not proof of ownership, but it should at least be a deliberate user action.

**Required correction:** initialize mode as `null` and the checkbox as `false`. Block reference ingest, remote upload, reconstruction and template promotion until the user explicitly selects the usage mode and acknowledges the declaration. Persist the declaration with the source, timestamp and mode; clearly state that it is a user declaration rather than ownership verification. Require a separate consent action before uploading source media to a remote model or worker.

**Confidence:** Confirmed from source.

Source: https://github.com/HasibBot4u/Template/blob/main/src/components/ReferenceLabWorkspace.tsx#L82-L95

### P1-01 — The AI Director route passes a null authentication token

**Evidence:** `src/App.tsx` renders `AiDirectorWorkspace` at `/app/ai-director` with `authToken={null}`. `AiDirectorWorkspace.tsx` then sends `X-Test-Uid` and `X-Test-Email` when no bearer token exists. The API's `requireAuth` middleware explicitly requires an `Authorization: Bearer ...` header before token verification.

**Why it matters:** protected AI Director requests—including session listing, session creation, planning, production, refinement and saving—will fail with `401 Missing Authorization Bearer token` when this fallback path is used. This is a direct explanation for why the Director can look present but its workflow does not function.

**Required correction:** retrieve a fresh Firebase ID token from the signed-in user for each protected request or use one shared authenticated API client. Pass it as `Authorization: Bearer <token>`. Remove `X-Test-*` fallback headers from production code. Tests should inject a token verifier at the server layer rather than spoof identity headers from the browser.

**Confidence:** Confirmed from source.

Sources: https://github.com/HasibBot4u/Template/blob/main/src/App.tsx#L962-L973; https://github.com/HasibBot4u/Template/blob/main/src/components/AiDirectorWorkspace.tsx#L107-L153; https://github.com/HasibBot4u/Template/blob/main/src/server/apiApp.ts#L1028-L1057

### P1-02 — Template Factory uses a development identity header instead of a bearer token

**Evidence:** multiple Template Factory requests send `x-sowveil-dev-uid`. The production `requireAuth` middleware only authenticates a Bearer token. This mismatch appears in save/update/fork/merge/restore/deprecate/dependency/publish calls.

**Why it matters:** Template Factory operations can fail despite the component having a user UID in props. A client-supplied UID must not function as identity in production, since it is not proof that the caller owns that UID.

**Required correction:** route every protected call through the same Firebase-authenticated API client. Use the verified UID on the server, not a client-provided UID. Remove development identity headers from production. Add authorization tests proving another account cannot edit, merge, publish, restore or delete a different user's template draft.

**Confidence:** Confirmed header mismatch in source; individual failure depends on the route and environment.

Source: https://github.com/HasibBot4u/Template/blob/main/src/components/TemplateFactoryWorkspace.tsx#L323-L560 and https://github.com/HasibBot4u/Template/blob/main/src/server/apiApp.ts#L1028-L1057

### P1-03 — AI Director production is deterministic compilation, not model-driven directing

**Evidence:** `aiDirectorProductionEngine.ts` builds sessions and shot plans through ordinary functions and compiles a canonical project through `executeDirectorProductionPlan()`. The inspected engine contains no `fetch` or provider invocation. It creates a template instance plus generic text, caption and SFX clips for each eligible shot. “Generated asset” records are metadata/provenance records, not a call to a generative media model. The newer AI Director API route calls `createAiDirectorSession()` and `executeDirectorProductionPlan()` directly.

**Why it matters:** the current pipeline can create an editable demonstration project and preserve source coverage, but it does not yet perform the user's requested live-model analysis of the entire script, ask model-generated clarifying questions, research arbitrary websites/repositories, generate bespoke visual assets, or make a truly creative plan with a chosen provider. A list of pre-populated model names is not a working model router.

**Required correction:** add a server-side orchestration service that resolves the user's chosen routing profile, decrypts the credential server-side, makes an actual provider call using the configured protocol/model, validates the response against a strict JSON schema, records source/segment IDs, and then compiles approved instructions to canonical project commands. Keep the deterministic engine as a fallback, fixture generator and validation layer—not as the only production brain. The UI must display `Demo/deterministic mode` when no real model connection is active.

**Confidence:** Confirmed that the inspected primary production engine has no model network call; completeness of any other uninspected experimental code is not established.

Sources: https://github.com/HasibBot4u/Template/blob/main/src/services/aiDirectorProductionEngine.ts#L1392-L1548; https://github.com/HasibBot4u/Template/blob/main/src/services/aiDirectorProductionEngine.ts#L1788-L2120; https://github.com/HasibBot4u/Template/blob/main/src/server/apiApp.ts#L6619-L6693 and #L6789-L6810

### P1-04 — Model names in the seeded Provider Hub are not proof of API availability

**Evidence:** the server seeds default connections with model IDs such as `gemini-4-argon` and `gemini-3.8-flash`, using fixed `generateContent` endpoint paths. The default connection uses `authMode: server-env`, and the probe's credential resolver substitutes `SERVER_ENV_KEY_PLACEHOLDER` if `GEMINI_API_KEY` is absent.

**Why it matters:** a model ID in a local array is not evidence that the endpoint/model is available to the user's project or that access is enabled. Combined with the fake probe, the placeholder can be treated as a credential and produce false capability status. A hard-coded default also makes the UI seem connected before the user has configured access.

**Required correction:** ship default connections as `Not configured`/`Not tested`; do not insert a placeholder credential. Require the real key or a user's own provider connection. Probe model IDs live, list returned/available models if the provider supports that capability, and allow manual model IDs with a real test. Never claim a model is available based only on a constant.

**Confidence:** Confirmed placeholder and endpoint constants; actual API availability must be tested using a real credential.

Sources: https://github.com/HasibBot4u/Template/blob/main/src/server/apiApp.ts#L5807-L5850 and https://github.com/HasibBot4u/Template/blob/main/src/services/providerHubEngine.ts#L1614-L1645

### P1-05 — Provider Hub UI uses local React state for the probe result

**Evidence:** `ProviderHubWorkspace.tsx`'s probe handler calls `probeProviderConnection()` locally and calls `setConnections()`. It does not make a request to `/api/v1/provider-hub/connections/:id/test` within that handler.

**Why it matters:** even if durable endpoints exist, the visible status can be a client-only simulation and diverge from the server's connection/vault state. The browser code also imports server-only logic.

**Required correction:** replace local probes with authenticated API calls. Persist connection creation, updates, capability state, routing profiles, key rotation/revocation and extension state through the server. On refresh, fetch the authoritative server record and display its timestamp/status. Client state should be a cache of server state, never the authority for connection status.

**Confidence:** Confirmed for the UI probe handler; other UI handlers should be checked individually during implementation.

Source: https://github.com/HasibBot4u/Template/blob/main/src/components/ProviderHubWorkspace.tsx#L250-L280

### P1-06 — The extension “sandbox” is a static inspection, not isolated code execution

**Evidence:** `inspectAndSandboxExtensionContent()` inspects raw content and dependencies, flags risk indicators, and records a result. The inspected code does not create a container, OS sandbox, isolated worker process, permission-enforced runtime, network policy or dependency environment for executing arbitrary repository code.

**Why it matters:** users' Claude-Code-style skills and GitHub repositories may contain instructions, scripts or packages. Static text scanning is not enough to prove safe execution. Naming a static scan a “sandbox” can encourage unsafe trust.

**Required correction:** initially treat extensions as *read-only instruction/manifest bundles* that the model may consult; don't execute arbitrary imported code. For executable tools, use an isolated service or sandbox with filesystem/network/CPU/memory/time limits, immutable version pins, dependency scanning, allowlisted capabilities, signed/hashed artifacts, explicit permission grants and kill/rollback handling. Distinguish `Scanned`, `Sandbox-tested`, `Installed`, and `Execution-tested` states.

**Confidence:** Confirmed limitation of the inspected function's implementation.

Source: https://github.com/HasibBot4u/Template/blob/main/src/services/providerHubEngine.ts#L2149-L2317 and #L6458-L6494

### P1-07 — AI project data is partly stored in a local snapshot rather than a shared production database

**Evidence:** `src/server/durableStore.ts` stores the canonical server snapshot as JSON and carries provider connections, routing profiles, extension packages, AI Director sessions, Template Factory drafts and render/export jobs. API handlers update Maps and invoke `persistState()`. The deployment document describes Cloud Run and also names a local `.sowveil-data/server-state.json` snapshot.

**Why it matters:** a local filesystem snapshot may survive a process restart on a single persistent machine, but it is not automatically shared between Cloud Run instances and should not be assumed durable across instance replacement or redeployment. If different instances have different local snapshots, users can see stale provider connections/jobs or lose changes. This is especially serious for encrypted API credentials and long-running render jobs.

**Required correction:** persist critical per-user state in Firestore or another shared durable database with schema-version migrations and transactions. Put binary assets in object storage with ownership rules. Use a real durable queue for long-running jobs. If the local snapshot remains, use it only as a documented single-instance development fallback and disable it as the production source of truth unless durable shared storage is explicitly configured and tested.

**Confidence:** Architecture risk confirmed; exact behavior depends on the deployment configuration and whether an external persistent volume is used.

Sources: https://github.com/HasibBot4u/Template/blob/main/src/server/durableStore.ts#L32-L79 and https://github.com/HasibBot4u/Template/blob/main/docs/DEPLOYMENT.md#L5-L10

### P1-08 — Final MP4/WebM requires a real external render worker

**Evidence:** `renderExportQaEngine.ts` explicitly treats MP4/WebM as requiring a heavy encoder. If the worker is not enabled/configured or remote-upload consent is absent, the job returns `needs-worker-setup`/`awaiting-upload-consent` rather than a video artifact.

**Why it matters:** the renderer can generate a number of valid still, vector, audio, subtitle and project-bundle outputs, but that does not establish end-to-end final video rendering. Without a configured, operational worker (or an implemented and tested local video encoder pipeline), the core “script to finished video” promise stops before the final video file.

**Required correction:** implement and deploy the worker protocol or implement a browser/local encoder path for the chosen supported subset. Validate real MP4/WebM output by decoding the actual file, checking audio/video streams, duration, frame rate, dimensions, synchronization and asset resolution. Keep honest `Needs worker setup` states and cost/upload consent when remote rendering is used. Do not advertise final-video export as verified until the end-to-end worker test passes.

**Confidence:** The worker gate is confirmed; operational worker availability was not testable from source inspection alone.

Sources: https://github.com/HasibBot4u/Template/blob/main/src/services/renderExportQaEngine.ts#L898-L938 and #L2034-L2091

### P1-09 — The current renderer includes procedural/synthetic outputs, not a complete equivalent of an advanced motion-graphics render engine

**Evidence:** the code has deterministic SVG/Canvas-style project compilation, generated PNG/JPEG/WAV/SRT/VTT/bundle utilities and a distinct worker gate for MP4/WebM. The AI Director compiler inserts generic title/caption/audio structures.

**Why it matters:** these are useful foundations, but they do not prove full support for arbitrary 3D geometry, robust compositing, motion blur, particle systems, masks, nested compositions, dynamic text layout, full font management, camera depth, advanced color management or arbitrary source video. A valid JSON/SVG/WAV package isn't the same as a final rendered video with all effects composited correctly.

**Required correction:** publish a render-feature matrix: fully supported, approximated, unsupported, and worker-required per effect and output. Add visual regression fixtures and real decoders. Make the editor show a warning when an effect is only a preview approximation or won't survive a target-app export.

**Confidence:** Confirmed that the engine has a limited output/worker architecture; the precise supported set needs runtime tests.

### P1-10 — External editor adapters must not overstate “native editable project” support

**Evidence:** the README lists adapters for Sowveil, Alight Motion, CapCut, Node Video and KineMaster, while the feature matrix states the 8-format basic gateway outputs Sowveil JSON, SVG, PNG, HTML, SRT, VTT, CSV and easing-curve SVG. The render engine names some mobile-editor handoff ZIP formats.

**Why it matters:** a handoff ZIP containing media and instructions is not the same as a native editable project file. CapCut and other target applications have different project formats and import limits. A file extension or generated bundle alone does not prove that it imports, opens and preserves the intended keyframes/effects.

**Required correction:** for every adapter, test a curated fixture on the real target application/version. Show supported, approximated and dropped features; required asset/font handling; exact import steps; and the test date. Use `Media handoff only` until the native project writer and import test are verified. Never rename a generic ZIP to a native extension.

**Confidence:** Confirmed that multiple formats are handoff outputs; actual compatibility requires on-device testing.

### P2-01 — The app has multiple API-auth patterns instead of one shared authenticated client

Besides the null AI Director token and Template Factory development headers, the Reference Lab optionally sends an ID token but catches server errors and continues with local state. This creates an inconsistent model of when an operation is local-only and when it is durably saved.

**Required correction:** centralize all fetches in one API client that obtains the current Firebase token, applies JSON headers, handles expired tokens, request IDs, timeouts, retries only safe idempotent requests, and returns typed errors. A UI action must distinguish `saved on device`, `synced to server`, `queued`, `failed` and `needs sign-in`.

Source examples: https://github.com/HasibBot4u/Template/blob/main/src/components/ReferenceLabWorkspace.tsx#L337-L416 and https://github.com/HasibBot4u/Template/blob/main/src/components/TemplateFactoryWorkspace.tsx#L323-L560

### P2-02 — AI tool registry is not shown connected to the AI Director loop

**Evidence:** a server-authorized typed tool registry exists in `providerHubEngine.ts`, including permission scopes and destructive-operation gates. However, the inspected AI Director path does not invoke the provider/model and tool loop. A registry by itself is not an agent runtime.

**Required correction:** build an explicit server-side agent loop that (1) sends the user goal and authorized tool schema to the selected model, (2) validates every returned tool call against the registry, (3) checks owner/project permissions, (4) executes only supported handlers, (5) returns a summarized result to the model, and (6) limits iterations, tokens, runtime, budget and side effects. Ask for user approval before destructive actions and external uploads. Keep tool audit records for every invocation.

Source: https://github.com/HasibBot4u/Template/blob/main/src/services/providerHubEngine.ts#L2753-L2800

### P2-03 — AI creation records may not represent real asset files

**Evidence:** the AI Director generates asset provenance records such as `Motion Plate`, `kinetic-title-rig` and `procedural-svg-plate`, then the API stores asset metadata records. In the inspected production path, these records do not prove that a full image/video/3D binary has been generated by a media model.

**Required correction:** separate `asset plan`, `metadata placeholder`, `generated binary`, `downloaded source asset`, and `validated reusable component` into different states. An asset is `Ready` only when the file exists, hashes correctly, opens successfully, passes virus/content validation if applicable, has license/provenance, and renders in the project. Reusable templates need actual parameterizable source, not just metadata and a title.

Source: https://github.com/HasibBot4u/Template/blob/main/src/services/aiDirectorProductionEngine.ts#L1884-L1929 and https://github.com/HasibBot4u/Template/blob/main/src/server/apiApp.ts#L6811-L6875

### P2-04 — Reference URL inspection is not the same as full video understanding

**Evidence:** `referenceLabEngine.ts` defines URL inspection statuses including `public-page-metadata-only`, `direct-media-permitted` and `blocked-restricted-or-ssrf`. Its input model also supports user-uploaded videos and screenshots. URL parsing/status checks do not prove that the application acquired and decoded every source frame and audio stream from YouTube, Instagram, Pinterest or another site.

**Required correction:** support an explicit source pipeline: accept a rights-cleared local file; validate its type and size; extract metadata, thumbnails, representative and change-point frames; sample audio and transcript if authorized; keep source timestamps; let the user review extracted frames; then run visual/audio analysis. For URLs, use permitted official APIs/direct media only; otherwise require the user to upload an authorized copy. Log which frames/audio segments were inspected and which were skipped.

**Reality constraint:** even comprehensive visual reconstruction can only infer hidden keyframes, source meshes, masks, plugins, and out-of-frame source details. It can create a highly faithful editable reconstruction, but should not claim guaranteed identity to unavailable source internals. Use `Measured`, `Inferred`, `Generated approximation`, and `Unknown` provenance honestly.

Source: https://github.com/HasibBot4u/Template/blob/main/src/services/referenceLabEngine.ts#L24-L78

### P2-05 — Static template/library data does not prove a full source-proven marketplace

**Evidence:** the repository uses `SEED_CATALOG_ITEMS` and procedural HTML Canvas/SVG/Web Audio preview paths. The README claims item counts and many modules, but a seed catalog and procedural previews are not automatically the original library's actual assets or source animation projects.

**Required correction:** display which entries are built-in demo presets, original Sowveil templates, user imports, reference reconstructions, remote-source assets, or placeholders. Provide real preview files where the catalogue claims them. Each template should have a canonical source project, editable parameter schema, dependencies, compatibility, source/license data, and validation status. Do not inflate counts with duplicate placeholders.

Source: https://github.com/HasibBot4u/Template/blob/main/README.md#L217-L242

### P2-06 — “Every property editable” requires explicit limits and a parameter contract

Third-party media or a rendered preview may not contain its original keyframes, vector layers, camera rig, masks or editable source. The application needs to state which properties truly map to source parameters. A visual approximation isn't a recovered original project.

**Required correction:** every template declares editable parameters, asset slots, animated properties, unsupported/baked effects, required fonts, render dependencies, and migration/version policy. For a flattened reference, save the reconstructed project with field-level fidelity/provenance tags. Allow one-click relabeling from `Draft reconstruction` to `Validated template` only after project/render tests—not simply after pressing Save.

### P2-07 — Render/export artifact verification is necessary but not sufficient

The code includes structural checks for PNG/JPEG/SVG/WAV/ZIP/SRT/VTT. Those checks can confirm that a file has expected bytes or structure, but they do not prove visual fidelity or that a full timeline was correctly rendered. For a handoff archive, the existence of valid contained files does not mean the target mobile app can reopen the project.

**Required correction:** test artifacts with independent decoders/importers. For video, verify playback and inspect sampled rendered frames. For audio, decode and check duration, peak/clipping and channel format. For every adapter, reopen the generated file in the target app where feasible. Add automated end-to-end fixture projects and manual Android device test evidence.

### P2-08 — In-memory maps plus local snapshots require a defined concurrency model

The API uses many in-process Maps (for example, provider connections and AI Director sessions) and persists snapshots. Even with atomic write-and-rename, two concurrent server instances don't become one shared transactional database. Concurrent writes can conflict or overwrite one another when local files differ.

**Required correction:** use shared transactions or optimistic concurrency with project revisions; store job leases and idempotency keys; prevent duplicate expensive renders; persist a unique job transition history; and test two instances racing to update a project or connection.

### P2-09 — Custom provider URL safety must cover DNS and every redirect at connection time

The URL validator blocks many private/reserved addresses and metadata hostnames, which is good. But validation of the input string alone is not sufficient against DNS rebinding or a host that resolves to a private address later. If the real provider call is added, each resolved address and redirect hop must be validated at the point of use, and credentials must not be forwarded to a new origin blindly.

**Required correction:** resolve DNS on the server, block private/loopback/link-local/metadata/reserved IPv4 and IPv6 ranges, pin or re-check the resolved destination, disallow credential leakage across origins, set safe egress policy, and test IPv4-mapped IPv6 plus redirect chains. Keep URL validation and real network request in the same secured server module.

### P2-10 — User-added GitHub repositories/websites need actual retrieval and a capability-safe extension system

A repository registry or saved URL is not the same as having ingested the repo. The current extension structures track sources, versions, manifests, permissions and validation results; they do not by themselves prove that source files have been downloaded, dependencies resolved, skills made available to model context, or tools executed.

**Required correction:** provide distinct actions/statuses for `Source registered`, `Fetched`, `Pinned to commit`, `Parsed`, `License checked`, `Security scanned`, `Available as instructions`, `Available as sandboxed tool`, and `Execution tested`. Retrieve only within defined quotas, preserve licenses/attribution, defend against prompt injection, and require approval before code execution or publishing generated work.

### P2-11 — Navigation and default route can make features seem missing

The source declares separate routes for `/app/provider-hub`, `/app/extensions`, `/app/ai-director`, `/app/editor`, `/app/template-factory`, `/app/render-export` and `/app/reference-lab`. The root/reference interface and the full app workspaces are not the same screen. Some modules may be reachable through a route or dashboard rather than the original 20-module strip.

**Required correction:** visibly expose the new workspaces without changing the original 20-module strip: for example, a secondary `Studio` workspace nav with Marketplace, AI Director, Editor, Provider Hub, Template Factory, Reference Lab, Render/Export and Project Library. Add a working breadcrumb/back path and a visible state when features need setup. Keep a direct route map in Help/About. Ensure all navigation items have usable labels on mobile landscape.

Source: https://github.com/HasibBot4u/Template/blob/main/src/App.tsx#L943-L990

### P2-12 — A source-level build status is not a runtime UI acceptance test

The package `lint` script is `tsc --noEmit`; `build` is `vite build`; `test` uses `tsx --test` on 17 listed test files. The acceptance matrix says all commands passed and reports 93 tests. This is useful evidence when actually executed, but unit/security tests don't prove that browser routes mount correctly, the Provider Hub works after bundling, the phone layout is readable, or a model returns output.

**Required correction:** add browser-level tests (Playwright or an equivalent browser runner), route smoke tests, authenticated API integration tests, viewport screenshot tests, and real-device manual checklists. The production release gate must record the commit SHA, command output, screenshot evidence, browser/OS versions, test date, and external service setup used. Don't mark a subsystem `Implemented & Verified` based only on types, a deterministic unit test or a mocked handler.

Sources: https://github.com/HasibBot4u/Template/blob/main/package.json#L5-L14 and https://github.com/HasibBot4u/Template/blob/main/docs/PHASE_ACCEPTANCE_MATRIX.md#L1-L4

### P3-01 — Package metadata still describes a generic scaffold

**Evidence:** `package.json` uses package name `react-example` and package version `0.0.0`, while the README claims `v2.4.0-canonical`.

**Required correction:** align package/product versioning, application title, manifest, package description and release changelog. The app should not expose starter/scaffold branding in generated diagnostics or package metadata.

Source: https://github.com/HasibBot4u/Template/blob/main/package.json#L1-L4

### P3-02 — README and “Implemented & Verified” claims need evidence links, not only assertions

The README and phase matrix describe a high level of implementation. For every verified claim, link to a test that actually exercises the end-to-end behavior and specify whether it is unit, API integration, browser e2e, live provider, real-device import, or manual QA. Maintain an accurate `Partial`/`Needs setup` state where a worker, API key or native-editor test is missing.

Sources: https://github.com/HasibBot4u/Template/blob/main/README.md#L217-L259 and https://github.com/HasibBot4u/Template/blob/main/docs/FEATURE_STATUS_MATRIX.md

### P3-03 — Generated temporary media should be controlled in version control

The repository listing includes an `.aistudio/artifacts/brain/.../.tempmediaStorage` path. Review whether those generated temporary files belong in the project. Avoid committing caches, temporary analysis artifacts, oversized video files or generated binaries that can be regenerated. Keep intentional reference fixtures and generated UI reference images in a dedicated `docs/reference-assets/` folder with provenance/license notes; ignore temp/cache files.

Source: https://github.com/HasibBot4u/Template

## 5. Subsystem-by-subsystem verdict

| Subsystem | What exists in source | What is not established / must be corrected |
|---|---|---|
| 20-module Reference Studio | Module definitions, strip, catalog browser, procedural Canvas/SVG/Web Audio previews | Pixel-level match against original video; original assets and full underlying proprietary catalog; all controls working in runtime |
| Template marketplace | Static seed entries, filters, variants/forks, validation metadata, provenance fields | A complete source-proven template inventory; verified editable layers for every item; true imported templates from any URL |
| Canonical project engine | Typed canonical document and typed commands, revisions/receipts/checkpoints | Complete render semantics for every effect and arbitrary source; multi-instance shared transaction guarantees |
| Provider Hub | Protocol definitions, request-format builders, vault data structure, routing profiles, typed tool registry | A real provider transport and real probes are not implemented by `probeProviderConnection`; browser/server import split and fallback key must be fixed |
| AI Director | Session/coverage/shot/approval data structures, deterministic shot planning and project compilation | Actual LLM calls, model routing, model-generated questions/plans, live research, actual image/video generation, full autonomous tool orchestration |
| Reference Lab | Rights declarations, URL classification, field-level provenance, timeline/project conversion | Explicit consent currently defaults on; URL metadata inspection isn't complete frame/audio acquisition or exact source recovery |
| Editing Studio | Quick/Pro/AI modes, timeline data structures, command/co-edit/rollback abstractions | Verified editing/rendering for every effect; AI co-edit driven by real selected model; browser/phone interaction tests |
| Template Factory | Parameter extraction, drafts, merge/fork/version operations, generated thumbnails | Reliable auth, genuine template-source generation, actual repository/skill execution, image/preview validation, persistent end-to-end workflow |
| Render/Export/QA | Valid format utilities, caption/audio/still/project bundles, adapter loss reports, worker setup gate | Real final MP4/WebM without a configured worker; external decoding/import tests; production worker availability |
| Skills/repositories | Extension metadata and heuristic/static risk checks | Secure execution sandbox, real source fetch/commit pinning/dependency install, runtime permission boundary, AI tool loop |
| Firebase/Auth/RBAC | Firebase client, Firestore rules, server Bearer verification, role checks | All browser workspace requests use one authenticated client; all state paths use shared durable storage; test all IDOR boundaries |
| Persistence | Local snapshot plus Firestore workspace repository | Shared durable source of truth for server-managed jobs/connections/session records across deployed instances |
| Analytics/telemetry | Telemetry and audit API/data structures | Runtime validation of consent, redaction and real dashboard values; avoid calling simulated events analytics |
| Testing | 17 test file paths in package script, test/feature matrices | Independently executed output, browser e2e, live provider test, genuine mobile landscape screenshots, native app import tests |

## 6. Pixel-perfect clone verdict

**The source does not establish a verified pixel-perfect clone.** It provides an implementation of the major visible module structure and a visual design inspired by the reference, using procedural previews and an expanded web application layout. That is a different claim from a pixel-by-pixel recreation of every screen, item card, preview, button state and interaction in the original video.

A proper verdict requires the following evidence, none of which can be inferred from source file names or the README:

- screenshots of the original reference video at captured timestamps, corrected for camera perspective where needed;
- screenshots of the running website at matched CSS viewport sizes and zoom;
- identical interaction state (same selected module/item, open panels, filters, preview state and scroll position);
- measured bounding boxes for navigation, side panels, cards, preview, buttons, text blocks and timeline;
- typeface, line-height, spacing, borders, shadows, color and icon comparison;
- screenshot overlays and image-difference outputs, with human interpretation because video camera moiré, perspective and compression create noise;
- interactive checks for each button/action, not just visual similarity.

Do not use the new UI concept PNG as an app background or a screenshot pretending to be the actual interface. Build actual responsive DOM/canvas components. Use the generated landscape concept as a style/layout reference for the expanded studio, while using the original recording as the source for the reference-clone screen.

## 7. Required quality gates before calling the product complete

The following are release acceptance requirements, not claims that the current repository already satisfies them.

### Provider and security gate

- Vault refuses to run without a high-entropy master secret in production.
- Browser bundle contains no `node:crypto`, raw vault key, decryption function or server credential.
- Provider probe makes a real request, has real measured latency and fails for invalid key/model/endpoint/timeout/quota.
- Capability `Verified` can only come from a successful real capability-specific request.
- Every protected request uses a real Firebase Bearer token; no test identity headers in production.
- Cross-account asset, template, provider, session and job requests return a denial without revealing whether another user's private record exists.
- SSRF tests include private IPv4/IPv6, DNS rebinding/resolution, metadata endpoints and redirects.

### AI Director gate

- A real selected provider receives a script-analysis request. Logs identify provider/model/version without exposing secrets.
- Response is schema-validated; malformed JSON, truncation, quota/rate limit and timeout produce repair/retry or a clear error.
- Every script segment has a stable source ID/offset and appears in the coverage ledger.
- Every shot has a rationale, duration, assets, audio, transition, style, template/asset source and confidence/provenance.
- Clarification questions are generated from actual ambiguities; defaults remain visible.
- Plan approval is enforced before expensive/destructive execution unless bounded autonomy is deliberately enabled.
- Model tool calls are validated against the server registry and project permissions.
- Each autonomous revision creates a checkpoint; locked user choices cannot be changed.
- Every claim that an asset was created is backed by an actual retrievable file/project object.

### Editor and rendering gate

- AI and manual controls mutate the same canonical project revision.
- Undo/redo, project save/reopen, asset relinking, checkpoints and rollback survive refresh and server restart.
- A sample project with text, SVG, image, video, 3D placeholder, captions, narration, music, SFX, transition and keyframes is rendered and inspected.
- Actual MP4/WebM is decoded by an independent media tool; duration, codec, frame rate, dimensions, audio presence and synchronization match request.
- Invalid/unsupported effects are shown in the feature-loss report and never silently labelled fully supported.
- Native editor adapters pass real import/reopen tests on documented app versions; otherwise remain `Media handoff only` or `Needs target-app validation`.

### UI and mobile landscape gate

- 20 modules and their original order/names remain accessible.
- At mobile landscape CSS dimensions, marketplace/preview/inspector/timeline can be used without horizontal overflow of the entire page.
- Side panel collapse, tab-switching, timeline zoom/scroll, touch controls, file import, save state and export all work.
- Portrait-to-landscape rotation preserves unsaved edits and current project state.
- Screenshot references are captured for portrait phone, landscape phone, tablet and desktop.
- Visual comparison is repeated after every layout change; report residual mismatches instead of claiming pixel-perfect automatically.

## 8. Source index for this review

- Repository landing/README/version and module/workspace claims: https://github.com/HasibBot4u/Template
- Package scripts: https://github.com/HasibBot4u/Template/blob/main/package.json
- Provider Hub UI/client import: https://github.com/HasibBot4u/Template/blob/main/src/components/ProviderHubWorkspace.tsx
- Provider adapter, vault and simulated probe: https://github.com/HasibBot4u/Template/blob/main/src/services/providerHubEngine.ts
- Provider API routes and bearer middleware: https://github.com/HasibBot4u/Template/blob/main/src/server/apiApp.ts
- AI Director workspace: https://github.com/HasibBot4u/Template/blob/main/src/components/AiDirectorWorkspace.tsx
- AI Director deterministic compiler: https://github.com/HasibBot4u/Template/blob/main/src/services/aiDirectorProductionEngine.ts
- Reference Lab UI and engine: https://github.com/HasibBot4u/Template/blob/main/src/components/ReferenceLabWorkspace.tsx and https://github.com/HasibBot4u/Template/blob/main/src/services/referenceLabEngine.ts
- Template Factory UI and engine: https://github.com/HasibBot4u/Template/blob/main/src/components/TemplateFactoryWorkspace.tsx and https://github.com/HasibBot4u/Template/blob/main/src/services/templateFactoryEngine.ts
- Render/export engine and workspace: https://github.com/HasibBot4u/Template/blob/main/src/services/renderExportQaEngine.ts and https://github.com/HasibBot4u/Template/blob/main/src/components/RenderExportQaWorkspace.tsx
- Durable snapshot: https://github.com/HasibBot4u/Template/blob/main/src/server/durableStore.ts
- Deployment/security docs: https://github.com/HasibBot4u/Template/tree/main/docs
- Firestore security rules: https://github.com/HasibBot4u/Template/blob/main/firestore.rules
- Phase acceptance claims: https://github.com/HasibBot4u/Template/blob/main/docs/PHASE_ACCEPTANCE_MATRIX.md

---

## Final statement

The current repository contains far more architecture than a static mockup, but several core pathways are still deterministic, simulated or disconnected. In particular, the Provider Hub does not conduct a real capability test, the primary AI Director pipeline does not call a selected model, key/auth wiring is unsafe or broken, and final video output depends on external worker setup. These are substantive issues, not merely missing visual polish.

Fix the confirmed P0/P1 findings, then execute the repository's claimed checks in the actual Google AI Studio project and record the results. Only after that should the landscape UI be judged against screenshots from the running app. The mobile-landscape design is feasible when panels are collapsible and adaptive; a phone should not be forced to display the desktop's full density in unreadably small controls.
