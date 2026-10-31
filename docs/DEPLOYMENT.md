# Sowveil Studio — Deployment, Operations & Release Runbook (`docs/DEPLOYMENT.md`)

This runbook covers environment configuration, model routing recommendations, supported mobile & desktop browsers, database/schema migration procedures, backup & disaster recovery, privacy-aware operational telemetry, and the production release checklist for Sowveil Studio (`v2.4.0-canonical`).

---

## 1. Runtime Architecture

- **Runtime Environment**: Node.js 22 LTS on Google Cloud Run (containerized via Cloud Buildpacks / Nixpacks).
- **HTTP & API Server**: Express 4 (`server.ts` + `src/server/apiApp.ts`) listening on port `3000`, serving `/api/v1/*` REST routes and static Vite PWA assets (`dist/`).
- **Durable Storage**:
  - **Cloud Firestore**: Primary multi-device cloud database (`firebase-applet-config.json`, governed by `firestore.rules` across 21 collections).
  - **Atomic Server Snapshot (`src/server/durableStore.ts`)**: Crash-safe write-then-rename snapshot file (`.sowveil-data/server-state.json`) with startup recovery for interrupted render jobs (`recoverInterruptedRenderJobsOnStartup`).

---

## 2. Environment Variables & Secrets (`.env.example`)

Never commit real secrets or API keys to source control. Inject secrets via Cloud Run Secret Manager or server environment variables:

| Variable Name | Required | Default / Example | Purpose |
|---|---|---|---|
| `PORT` | Yes | `3000` | HTTP server port (must be `3000` in AI Studio runtime). |
| `NODE_ENV` | Yes | `production` | Runtime environment (`development` or `production`). |
| `OWNER_BOOTSTRAP_EMAIL` | Optional (dev only) | `""` (empty by default) | Verified Google email authorized for one-time dev owner role claim. Fails closed (`503`) if unset; no hardcoded fallback. |
| `OWNER_BOOTSTRAP_SECRET` | Optional (dev only) | `""` (empty by default) | Secret required by `/api/v1/admin/bootstrap-owner` (fails closed with `503` if unset; route is disabled in `NODE_ENV=production` until durable Firestore transactional lock is enabled). |
| `SOWVEIL_MASTER_VAULT_KEY` | Required for encrypted vault | `<32-byte-hex-or-base64-key>` | Canonical master key for AES-256-GCM encryption/decryption of user provider credentials (`src/server/credentialVault.ts`). Fails closed (`503 VAULT_MASTER_KEY_NOT_CONFIGURED`) if unset; never uses a hardcoded or ephemeral fallback key. Legacy `SOWVEIL_VAULT_KEY` is accepted only when `SOWVEIL_MASTER_VAULT_KEY` is unset or identical; conflicting values fail closed (`VAULT_KEY_CONFIG_CONFLICT`). |
| `GEMINI_API_KEY` | Optional | `<server-managed-gemini-key>` | Server-side key used when a Provider Hub connection uses `authMode: "server-env"`. |
| `SOWVEIL_RENDER_WORKER_ENABLED` | Optional | `false` | Set to `true` only when a dedicated server-side video muxing worker is provisioned for `.mp4`/`.webm` output. |
| `CLOUD_STORAGE_ENABLED` | Optional | `false` | Set to `true` when Cloud Object Storage is provisioned for large binary media uploads. |
| `VITE_FIREBASE_API_KEY` | Yes | (From `firebase-applet-config.json`) | Public Firebase web client API key. |
| `VITE_FIREBASE_PROJECT_ID` | Yes | `ai-studio-411ad70d-501b-4df1-8287-ce21e9091d8d` | Google Cloud / Firebase project ID. |

---

## 3. Recommended Model Routing Policy

Sowveil Studio separates **AI Studio Builder model selection** from **in-product Provider Hub task routing**:

- **High-Complexity Architecture, Script Analysis, Shot Planning, Code & Evaluation**:
  - Primary: **Gemini 4 Argon (`gemini-4-argon`)** with `thinkingLevel: "HIGH"`.
- **Routine Metadata Tagging, Fast Asset Research & Lightweight Summaries**:
  - Primary: **Gemini 3.8 Flash (`gemini-3.8-flash`)** with `thinkingLevel: "LOW"`, configured with automatic fallback to `gemini-4-argon`.
- All 8 task types (`script-analysis`, `planning`, `code`, `asset-research`, `vision`, `voice-transcription`, `evaluation`, `routine-tasks`) can be inspected and customized per workspace in `/app/provider-hub`.

---

## 4. Supported Browsers & Mobile Device Tiers

- **Primary Target**: Android Chrome 118+ / Edge / Samsung Internet on Android phones (`320px–430px` portrait and landscape, `44×44px` minimum touch targets, safe-area inset support, installable standalone PWA).
- **Secondary Targets**: iOS Safari 17+ (iPhone/iPad) and desktop Chrome / Firefox / Safari / Edge.
- **Low-Memory Mobile Adaptations**:
  - Paginated API responses and virtualized catalog/timeline rendering.
  - Proxy preview selector (`ultra-light-360p` and `mobile-proxy-540p` @ `24fps`) in the Editing Studio and Render/Export workspace.
  - `prefers-reduced-motion` and user-togglable `Reduced Motion Previews` preference.

---

## 5. Schema Migration, Backup & Disaster Recovery

1. **Canonical Project Schema Migration (`v1.0.0` / `v2.4.0-mobile` → `v2.0.0`)**:
   - Automatic, lossless forward migration via `migrateToCanonicalProject` (`src/services/canonicalProjectEngine.ts`) and `POST /api/v1/projects/migrate`. Unknown future fields are preserved in `unknownProperties` passthrough bags rather than stripped.
2. **Interrupted Render Job Recovery**:
   - On server startup, `recoverInterruptedRenderJobsOnStartup` (`src/services/renderExportQaEngine.ts`) inspects all persisted render jobs and transitions any in-flight job (`queued`, `validating-project`, `resolving-assets`, `synthesizing-frames`, `mixing-audio`, `encoding-packaging`, `running-qa-gates`) to `interrupted-on-restart` (`retryable: true`). It never fabricates a completed artifact.
3. **Firestore & User Data Backup / Recovery**:
   - Cloud Firestore daily exports (`gcloud firestore export gs://[BACKUP_BUCKET]/backups`).
   - Users can export a complete portable JSON backup of their workspace at any time via `GET /api/v1/me/data-export` (or the **Export All Account Data (.json)** button in `/app/settings/profile`) and restore individual projects/templates via Project Library import.

---

## 6. Release Verification Checklist

Before cutting a production release, run and verify every check below:

```bash
npm run lint          # Must exit 0 (0 TypeScript errors)
npm run lint:rules    # Must exit 0 (0 Firestore security rule errors)
npm test              # Must pass all 17 test suites (93/93 tests passing)
npm run build         # Must bundle dist/ and PWA service worker cleanly
```

- [x] All 20 reference modules present in exact `displayOrder` 1–20 with authentic seed counts (`220`, `12`, `26`, `60`).
- [x] `Cache-Control: no-store, no-cache, must-revalidate, private` enforced on all authenticated/mutable/admin routes.
- [x] `firestore.rules` covers all 21 collections in `firebase-blueprint.json` with default-deny catch-all.
- [x] Operational telemetry (`/api/v1/telemetry/operational`) verified free of scripts, prompts, private media, and API keys.
- [x] Account data export (`GET /api/v1/me/data-export`) and full account deletion (`DELETE /api/v1/me/account-data`) verified by automated integration tests.
