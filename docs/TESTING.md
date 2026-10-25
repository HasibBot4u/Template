# Sowveil Studio — Automated Testing Guide (`docs/TESTING.md`)

## 1. Test Commands
- **Run Full Automated Test Suite**:
  ```bash
  npm test
  ```
- **Validate Firestore Security Rules**:
  ```bash
  npm run lint:rules
  ```
- **TypeScript Typecheck**:
  ```bash
  npm run lint
  ```

## 2. Test Suites
1. `src/tests/phase2.test.ts` — Catalog filtering, search, category counts, favorites idempotency, Project Library CRUD, and job state machine transitions.
2. `src/tests/phase3.security.test.ts` — API authentication, unverified email rejection, self-role escalation prevention, cross-user isolation, draft catalog protection, and one-time owner bootstrap lock.
3. `src/tests/firestore.rules.test.ts` — Structural and policy verification of `firestore.rules`.
4. `src/tests/mobileMigration.test.ts` — Mobile-first 20-module verification and baseline export artifact checks.
5. `src/tests/adminAndDiagnostics.test.ts` — Admin Console RBAC (`/admin/*`), editor compatibility verification guard, module disable confirmation requirement, and `/api/v1/diagnostics/technical` redaction.
6. `src/tests/editorGatewayPhase5.test.ts` — Phase 5 Mobile Editor Gateway unit & API integration tests:
   - Adapter capability discovery across all 6 adapters (`capcut`, `alight-motion`, `node-video`, `kinemaster`, `universal-bundle`, `sowveil-project`).
   - Strategy selection & Alight Motion XML subset classification (`Alight Motion XML — tested subset` vs. `Generic media pack`).
   - Portable `MotionDocument` v2.0 serialization, validation, and unknown-field passthrough.
   - Alight Motion XML serializer, fixture verification, and XXE/script rejection.
   - `.srt`, `.vtt`, and `.captions.json` generation, round-trip parsing, and validation.
   - PKZIP bundle creation, `AssetBundleManifest` validation, anti-ZIP-bomb limits, path traversal rejection, SVG sanitization, PNG/WAV binary checks, and honest video capability guard.
   - End-to-end API tests for `/api/v1/editors/:id/capabilities`, `/api/v1/exports/generate`, `/api/v1/exports/jobs/:id/download`, `/api/v1/exports/jobs/:id/retry`, `/api/v1/exports/jobs/:id` DELETE, and cross-user 403 enforcement.
7. `src/tests/mobileMediaWorkflows.test.ts` — Phase 6 Mobile Media Workflows, Rendering, Captions, Assets & Downloader tests:
   - Deterministic byte/stage job progress (`computeDeterministicJobProgress`), worker/cost gate (`evaluateMediaJobWorkerGate`), and full media job state machine lifecycle (`draft` → `queued` → `uploading` → `running` → `finalizing` → `ready` / `quota-reached`).
   - Auto Captions timestamp parsing, overlap & line-length validation, segment split/merge/delete/retime, SRT/VTT round-trip parsing, and downloadable sidecar `.zip` bundle generation (`buildCaptionSidecarZipBundle` & `POST /api/v1/captions/validate-and-bundle`).
   - Deterministic mathematical evaluation across all 12 Expressions presets (`evaluateExpressionPresetMath`), real 16-bit PCM WAV synthesis & waveform peak extraction (`extractWavWaveformPeaks`), Text Animation font fallback warnings (`getFontFallbackNotice`), glTF 2.0 header validation (`validateGltfOrGlbHeaderBytes`), and Project Library version checkpoints (`createProjectCheckpoint`).
   - SSRF URL guard (`validateMediaUrlForSsrf` & `POST /api/v1/media/validate-url`), binary magic-byte inspection (`verifyMediaMagicBytes` & `POST /api/v1/media/inspect-bytes`), filename sanitization (`sanitizeMediaFileName`), honest output size estimation (`estimateMediaOutputSize`), and owner-scoped `PATCH /api/v1/jobs/:id` isolation.

