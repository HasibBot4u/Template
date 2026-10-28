# Sowveil Studio — Automated Testing & Verification Guide (`docs/TESTING.md`)

## 1. Verification Commands

```bash
npm run lint          # TypeScript static typecheck (tsc --noEmit)
npm run lint:rules    # Validate Firestore Security Rules (eslint firestore.rules)
npm test              # Execute all 17 automated test suites (node:test via tsx)
npm run build         # Production Vite + PWA bundle compilation
```

---

## 2. Automated Test Suite Matrix (17 Suites, 93 Tests)

| # | Test Suite File | Scope & Invariants Verified |
|---:|---|---|
| 1 | `src/tests/phase2.test.ts` | Catalog filtering, search relevance, category counts, favorites idempotency, Project Library CRUD, and job state machine transitions. |
| 2 | `src/tests/phase3.security.test.ts` | API authentication, unverified email rejection, self-role escalation prevention, cross-user isolation, draft catalog protection, and one-time owner bootstrap lock. |
| 3 | `src/tests/firestore.rules.test.ts` | Structural and policy verification of `firestore.rules` and `firebase-blueprint.json` across all 21 collections and 12 Dirty Dozen security invariants. |
| 4 | `src/tests/mobileMigration.test.ts` | Mobile-first 20-module verification (`displayOrder` 1–20, authentic counts 220/12/26/60) and baseline export artifact checks. |
| 5 | `src/tests/adminAndDiagnostics.test.ts` | Admin Console RBAC (`/admin/*`), editor compatibility verification guard, module disable confirmation requirement, and `/api/v1/diagnostics/technical` redaction. |
| 6 | `src/tests/editorGatewayPhase5.test.ts` | Mobile Editor Gateway adapters (`capcut`, `alight-motion`, `node-video`, `kinemaster`, `universal-bundle`, `sowveil-project`), Alight Motion XML serializer & XXE guard, PKZIP anti-bomb validation, SVG sanitization, and cross-user 403 export isolation. |
| 7 | `src/tests/mobileMediaWorkflows.test.ts` | Deterministic byte/stage job progress, Auto Captions cue validation & sidecar `.zip` generation, 12 Expressions math evaluation, 16-bit PCM WAV synthesis, SSRF URL blocker, and binary magic-byte inspection. |
| 8 | `src/tests/mobileHardeningPhase7.test.ts` | Strict security headers, origin-checked CORS, sliding-window rate limiting, PWA manifest integrity, and durable snapshot persistence across server restarts. |
| 9 | `src/tests/aiDirectorPhase8.test.ts` | Baseline AES-256-GCM credential vault, SSRF provider endpoint blocker, script segmentation coverage, and timeline checkpoints. |
| 10 | `src/tests/canonicalProjectSchema.test.ts` | Canonical Project Schema `v2.0.0`, lossless migration from `1.0.0` and `2.4.0-mobile`, 36 typed commands, scene-lock enforcement (`LOCKED_SCENE`), undo/redo stacks, unknown-property preservation, and 7 canonical fixtures. |
| 11 | `src/tests/referenceLab.test.ts` | Reference Lab Usage Mode gate (`Authorized Reconstruction` vs. `Reference-Inspired`), local-only remote-upload cancellation, shot segmentation, provenance/confidence labels, 7 correction actions, and Draft-to-Validated promotion. |
| 12 | `src/tests/providerHub.test.ts` | 7 distinct protocol adapters, AES-256-GCM AAD-scoped secret vault, key rotation/revocation, SSRF & redirect-hop blocker, 14-capability verification registry, 8 task routing profiles, untrusted Extensions sandbox & prompt-injection quarantine, and Typed Tool Registry authorization. |
| 13 | `src/tests/aiDirectorProduction.test.ts` | 7-stage durable AI Director state machine, 4,000-char chunked script segmentation with zero tail truncation, repetition preservation, coverage ledger, question deduplication, 20-field Brief, 22-field Shot Plan, 4-tier asset ranking, per-shot dependency failure isolation, and 10-point Acceptance Gate. |
| 14 | `src/tests/editingStudioCoEdit.test.ts` | Professional Mobile Editing Studio (`Quick`, `Pro`, `AI Co-Edit` modes), multi-track commands, interactive easing curves, version diff compare, and `AiCoEditTransaction` with selective per-operation accept/reject, locked-scene protection, and 1-click rollback across all 10 prompt archetypes. |
| 15 | `src/tests/templateFactory.test.ts` | 10-stage Template Factory derivation pipeline, 9-category parameter extraction, `GeneralizationReport`, untouched source verification, content-hash & similarity deduplication, 7-check Quality & Determinism Gate (`<= 0.001`), fork/merge/deprecate lifecycle, and consent-gated preference signals. |
| 16 | `src/tests/renderExportQa.test.ts` | Canonical render & export tiers (`timeline-preview`, `proxy-render`, `final-render`), real work-unit progress, startup crash recovery (`interrupted-on-restart`), binary/structural validators (`PNG`, `WAV`, `SRT`, `VTT`, `JSON`, `XML`, `ZIP`), audio clipping detection, honest `needs-worker-setup` MP4/WebM gate, 6 adapter feature-loss matrices, and 8-gate Final QA report. |
| 17 | `src/tests/securityObservabilityReleasePhase14.test.ts` | Cross-account IDOR isolation across all workspaces (`projects`, `reference-lab`, `provider-hub`, `extensions`, `ai-director`, `template-factory`, `render-export`), `Cache-Control: no-store` partitioning, privacy-aware operational telemetry (`logsRawScripts: false`, `logsApiKeysOrTokens: false`), portable JSON data export (`/api/v1/me/data-export`), and full account/project/vault deletion (`DELETE /api/v1/me/account-data`). |
