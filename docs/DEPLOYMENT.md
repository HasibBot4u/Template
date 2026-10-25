# Sowveil Studio — Deployment & Operational Runbook (`docs/DEPLOYMENT.md`)

This guide outlines the production deployment architecture, environment configurations, security controls, backup procedures, rollback plans, and operational verification checklist for Sowveil Studio.

---

## 1. System Architecture & Hosting Runtime

- **Runtime Environment**: Node.js 22 LTS on Google Cloud Run (Containerized via Nixpacks / Google Cloud Buildpack).
- **Web Server**: Express 4 server hosting high-performance REST APIs (`/api/v1/*`) and serving Vite-built static client assets (`dist/`).
- **Database & Persistence**: Google Cloud Firestore (`ai-studio-411ad70d-501b-4df1-8287-ce21e9091d8d`) initialized in Asia-Southeast1.
- **Client App**: React 19 SPA with Progressive Web App (PWA) offline capabilities, Workbox service worker caching, and touch-optimized viewport layouts (320px–430px Android portrait primary target).

---

## 2. Environment Variables & Secret Management

All environment variables must be declared in `.env.example` without real secret values. In production, variables are injected securely via Cloud Run service configuration or Secret Manager.

| Variable Name | Required | Default / Example | Purpose |
| :--- | :--- | :--- | :--- |
| `PORT` | Yes | `3000` | Port for the HTTP dev & production server. |
| `NODE_ENV` | Yes | `production` | Node runtime environment mode. |
| `OWNER_BOOTSTRAP_EMAIL` | Recommended | `mdhasibul4u@gmail.com` | Verified Google account email authorized for one-time owner bootstrap. |
| `OWNER_BOOTSTRAP_SECRET` | Recommended | `<strong-alphanumeric-token>` | Confirmation secret required to claim initial owner role. |
| `VITE_FIREBASE_API_KEY` | Yes | (Client Config) | Public Firebase web client API key. |
| `VITE_FIREBASE_AUTH_DOMAIN` | Yes | (Client Config) | Firebase Auth custom domain / firebaseapp domain. |
| `VITE_FIREBASE_PROJECT_ID` | Yes | `ai-studio-411ad70d-501b-4df1-8287-ce21e9091d8d` | Cloud Project ID. |
| `VITE_FIREBASE_STORAGE_BUCKET`| Optional | (Configured Bucket) | Firebase Storage bucket for heavy media artifacts. |
| `CLOUD_STORAGE_ENABLED` | Optional | `false` | Set to `true` when a Cloud Storage bucket is provisioned for binary video storage. |

*Redaction Guarantee*: The server diagnostics endpoint (`/api/v1/diagnostics/technical`) strictly excludes all environment variables, bearer tokens, service-account keys, and database credentials.

---

## 3. Security & Access Hardening

1. **HTTP Headers Enforced**:
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: SAMEORIGIN`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
   - `Cross-Origin-Opener-Policy: same-origin-allow-popups`
   - `X-Robots-Tag: noindex, nofollow` on all `/api/*`, `/admin/*`, and `/technical` paths.
2. **Origin-Checked CORS**:
   - Rejects unlisted third-party origins.
   - Reflected only for verified production Cloud Run and localhost development domains.
   - Credentials support (`Access-Control-Allow-Credentials: true`) enabled for authenticated API calls.
3. **Sliding-Window Rate Limiting**:
   - `10 requests/minute` for sensitive authentication and owner bootstrap endpoints (`/api/v1/admin/bootstrap-owner`).
   - `120 requests/minute` per IP for general API endpoints.
4. **Data Isolation & RBAC**:
   - Ordinary users have access only to their own jobs (`/api/v1/jobs`), projects (`/api/v1/projects`), and favorites.
   - Draft and archived catalog items are strictly invisible to ordinary users.
   - User self-role escalation is blocked at the schema validation layer.

---

## 4. Build & Production Verification Workflow

1. **Run Static Type & Security Rules Linter**:
   ```bash
   npm run lint          # Validates TypeScript compilation (tsc --noEmit)
   npm run lint:rules    # Validates Firestore security rules via eslint-plugin-security-rules
   ```

2. **Execute Full Automated Test Suite**:
   ```bash
   npm test
   ```
   Ensures all 42+ automated unit and integration tests pass across:
   - Phase 2: Schema validation and catalog logic
   - Phase 3: Server security, RBAC, and error sanitization
   - Phase 4: Firestore security rules offline unit tests
   - Phase 5: Mobile migration, responsive layouts, and gateway adapters
   - Phase 6: Media workflows, caption parsers, WAV synthesis, and SSRF prevention
   - Phase 7: Mobile hardening, security headers, CORS, and PWA manifest integrity

3. **Compile Applet Bundle**:
   ```bash
   npm run build
   ```
   Ensures Vite bundles `dist/` with PWA service worker and manifest assets.

4. **Start Production Service**:
   ```bash
   npm start
   ```

---

## 5. Backup & Disaster Recovery

- **Cloud Firestore**:
  - Daily automatic snapshots managed via Google Cloud Firestore Export (`gcloud firestore export gs://[BACKUP_BUCKET]/backups`).
  - Point-in-time recovery (PITR) supported for transactional collections.
- **Rollback Strategy**:
  - Cloud Run supports instant traffic splitting. If an issue is detected post-deployment, route 100% of traffic back to the prior stable revision using:
    `gcloud run services update-traffic sowveil-studio --to-revisions=[PREVIOUS_REVISION]=100`

---

## 6. Production Deployment Checklist

- [x] PWA manifest configured with valid maskable and standard icons (`display: standalone`, `scope: /`, `id: /`).
- [x] Offline fallback with explicit capability breakdown and retry ping.
- [x] All 20 motion modules accessible via mobile carousel and 20-module bottom sheet drawer.
- [x] 44×44px minimum touch targets on all mobile portrait controls.
- [x] Strict security headers and origin-checked CORS active.
- [x] Public published catalog cached (`max-age=60`), private records `no-store`.
- [x] Zero obsolete desktop companion or After Effects script references.
- [x] 42+ automated tests passing with 100% success rate.
