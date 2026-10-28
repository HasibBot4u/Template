# Sowveil Studio — Security, Privacy & Threat Model (`docs/SECURITY.md`)

This document describes the implemented security controls, privacy guarantees, data retention/deletion workflows, and known residual risks audited in Phase 14. Sowveil Studio does not claim formal security certification or immunity from all vulnerabilities.

---

## 1. Authentication, Session & Role-Based Access Control (RBAC)

- **Server-Side Token Verification (`src/server/apiApp.ts`)**:
  - Protected `/api/v1/*` routes verify Bearer tokens server-side (`verifyFirebaseIdTokenWithGoogle` or injected test verifier) and enforce `email_verified === true`.
- **Authoritative Server & Firestore Role Resolution**:
  - Roles (`user`, `admin`, `owner`) are resolved from server-side role records and Firestore `/admins/{uid}` + `/users/{uid}`, never from client request bodies.
  - Client attempts to pass `role`, `isAdmin`, `status`, or `uid` to `/api/v1/me/preferences` are rejected with `403 ROLE_ESCALATION_FORBIDDEN` and logged to the append-only audit trail.
- **Safe One-Time Owner Bootstrap (`/api/v1/admin/bootstrap-owner`)**:
  - Never auto-promotes the first visitor. Requires a verified Google account matching `OWNER_BOOTSTRAP_EMAIL` and a server-configured `OWNER_BOOTSTRAP_SECRET` (`>= 16` characters; fails closed with `503` if unconfigured) under a strict `10 req/min` sliding-window rate limit.

---

## 2. Cross-User Isolation (IDOR Prevention) & Firestore Security Rules

- **Server-Side Ownership Enforcement**:
  - Every user-scoped resource (`projects`, `jobs`, `assets`, `templateVariants`, `referenceLabSessions`, `providerConnections`, `extensionPackages`, `aiDirectorSessions`, `templateFactoryDrafts`, `renderExportJobs`, `favorites`, `recent`) enforces `ownerUid === callerUid` on read, write, command execution, key rotation/revocation, download, and deletion.
- **Firestore Security Rules (`firestore.rules` & `firebase-blueprint.json`)**:
  - Default-deny catch-all (`match /{document=**} { allow read, write: if false; }`).
  - Explicit schema and ownership validation across all **21 collection paths** (`/users/{uid}`, `/users/{uid}/private/{docId}`, `/admins/{uid}`, `/modules/{moduleId}`, `/categories/{categoryId}`, `/catalogItems/{itemId}`, `/templateVariants/{variantId}`, `/assets/{assetId}`, `/favorites/{uid}/items/{itemId}`, `/projects/{projectId}`, `/jobs/{jobId}`, `/devices/{deviceId}`, `/devicePairingTokens/{tokenId}`, `/auditEvents/{eventId}`, `/referenceLabSessions/{sessionId}`, `/providerConnections/{connectionId}`, `/extensionPackages/{extensionId}`, `/toolAuditRecords/{auditId}`, `/aiDirectorSessions/{sessionId}`, `/templateFactoryDrafts/{draftId}`, and `/renderExportJobs/{jobId}`).
  - Validated statically via `npm run lint:rules` (`@firebase/eslint-plugin-security-rules`) and `src/tests/firestore.rules.test.ts`.

---

## 3. Cache Partitioning & Service Worker Safety

- **API Cache-Control Partitioning (`src/server/apiApp.ts`)**:
  - All authenticated, mutable, private, and admin route families (`/api/v1/me`, `/api/v1/projects`, `/api/v1/jobs`, `/api/v1/assets`, `/api/v1/variants`, `/api/v1/template-variants`, `/api/v1/exports`, `/api/v1/reference-lab`, `/api/v1/provider-hub`, `/api/v1/extensions`, `/api/v1/tools`, `/api/v1/ai-director`, `/api/v1/editor`, `/api/v1/template-factory`, `/api/v1/render-export`, `/api/v1/telemetry`, `/api/v1/admin`, and `/download`) set `Cache-Control: no-store, no-cache, must-revalidate, private` and `Pragma: no-cache`.
  - Public caching (`Cache-Control: public, max-age=60, stale-while-revalidate=300`) is applied only to unauthenticated `GET /api/v1/catalog` requests for `published` items.
- **PWA Workbox Service Worker (`vite.config.ts`)**:
  - `navigateFallbackDenylist: [/^\/api\//, /^\/admin/, /^\/technical/]`.
  - Runtime cache predicate for `/api/v1/catalog` explicitly excludes any request carrying an `Authorization` header or non-`published` visibility query parameter.

---

## 4. Provider Secret Vault, SSRF Protection & Untrusted Extension Sandbox

- **AES-256-GCM Secret Vault (`src/services/providerHubEngine.ts`)**:
  - User API keys are encrypted server-side using `aes-256-gcm` with authenticated additional data (`aadScope = user:${ownerUid}|workspace:${workspaceId}|conn:${connectionId}`).
  - Client responses receive only `toPublicProviderConnectionView` (`maskedCredential`, `credentialFingerprint`, `credentialStatus`, `keyVersion`); `encryptedCredential` and raw keys are never returned to the browser or included in data exports.
  - Supports immediate key rotation (`/rotate-key`), revocation (`/revoke-key`), and full deletion.
- **SSRF & Redirect-Chain Protection (`validateCustomEndpointSsrf`, `validateMediaUrlForSsrf`)**:
  - Enforces `https:` only; blocks `http:`, `file:`, `ftp:`, `data:`, `javascript:`, and embedded URL credentials.
  - Blocks `localhost`, `.local`, `.internal`, IPv4 loopback (`127.0.0.0/8`), RFC1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local/cloud metadata (`169.254.0.0/16`, `169.254.169.254`, `metadata.google.internal`), CGNAT (`100.64.0.0/10`), and IPv6 loopback/private/mapped addresses (`::1`, `fc00::/7`, `fe80::/10`, `::ffff:127.0.0.1`), including across redirect hops.
- **Untrusted Extensions Sandbox & Typed Tool Registry**:
  - GitHub repositories, skills, websites, and API tools are treated as untrusted data with pinned commit/version, SHA-256 checksum, declared capabilities, permission diffs, and quarantine/rollback on policy violations.
  - Prompt injection payloads inside imported READMEs/instructions (`IGNORE ALL PREVIOUS INSTRUCTIONS`, secret exfiltration, unapproved shell/network access) are detected and quarantined before execution.
  - AI Director tool invocations pass through server-side schema validation, ownership checks, budget gates, and destructive-command checkpointing.

---

## 5. Uploaded Media Parsing, Path Traversal & Export Safety

- **Binary Magic-Byte Verification (`verifyMediaMagicBytes`)**: Verifies container magic bytes (`MP4/MOV ftyp`, `WebM EBML`, `RIFF/WAVE`, `MP3`, `OggS`, `PNG`, `glTF 2.0`) and rejects disguised scripts/executables.
- **Anti-ZIP-Bomb & Path Traversal Defense (`validateZipSafety`, `sanitizeMediaFileName`)**: Enforces entry count, uncompressed byte caps, compression ratio limits, and strips `../`, `..\`, leading `/`, drive letters, and null bytes.
- **SVG & XML Hardening (`sanitizeSvgContent`, `validateAndInspectAlightMotionXml`)**: Strips `<script>`, `<foreignObject>`, inline `on*` handlers, `javascript:` URIs, `<!DOCTYPE`, and `<!ENTITY` (XXE defense).

---

## 6. Privacy-Aware Operational Telemetry & Account Data Deletion

- **Redacted Operational Telemetry (`GET /api/v1/telemetry/operational` & `POST /api/v1/telemetry/opt-in`)**:
  - Records only build/schema versions, anonymized error code counts, job state counts, render stage timings, and opt-in aggregate feature counters.
  - **Strict Non-Logging Guarantee**: Raw scripts, private media, user prompts, API keys, and provider request bodies are never logged to telemetry or diagnostics (`POST /api/v1/telemetry/opt-in` actively rejects payloads containing `rawScript`, `promptText`, `apiKey`, or `privateMediaBytes` with `400 SENSITIVE_TELEMETRY_PAYLOAD_REJECTED`).
- **User Data Export & Complete Account Deletion**:
  - `GET /api/v1/me/data-export`: Exports all user-owned projects, variants, private templates, asset metadata, Reference Lab sessions, redacted Provider Hub connections, extensions, AI Director sessions, Template Factory drafts, preference signals, and render/export jobs as a portable JSON file.
  - `DELETE /api/v1/me/account-data`: Requires `confirmDelete: "DELETE_MY_ACCOUNT_DATA"` and permanently deletes all user-scoped records across all 13 server stores and purges encrypted vault keys.

---

## 7. Known Residual Risks & Operational Assumptions

1. **Master Vault Key Management (`SOWVEIL_MASTER_VAULT_KEY`)**: The credential vault (`src/server/credentialVault.ts`) strictly requires `SOWVEIL_MASTER_VAULT_KEY` (or non-conflicting legacy `SOWVEIL_VAULT_KEY`) and fails closed (`VAULT_MASTER_KEY_NOT_CONFIGURED` / `VAULT_KEY_CONFIG_CONFLICT`) when unconfigured or conflicting. It never uses a hardcoded fallback key or an ephemeral random key that would orphan persisted ciphertexts after restart. Existing persisted connection records whose ciphertext cannot be decrypted with the active `SOWVEIL_MASTER_VAULT_KEY` are preserved and marked `requires-reentry` until rotated.
2. **DNS Rebinding Timing Window**: While `validateCustomEndpointSsrf` blocks private IP literals, internal hostnames, and unsafe redirect hops, full protection against time-of-check-to-time-of-use (TOCTOU) DNS rebinding in production requires an egress proxy or custom `http.Agent` lookup pinned to the resolved public IP.
3. **Browser Hardware & Codec Variance**: Heavy multi-track compositions on low-memory Android devices rely on `540p`/`360p` proxy previews; full containerized `.mp4`/`.webm` video encoding requires an external worker (`SOWVEIL_RENDER_WORKER_ENABLED=true`) and fails closed with `needs-worker-setup` when unconfigured.
