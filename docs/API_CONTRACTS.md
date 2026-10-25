# API Contracts (`docs/API_CONTRACTS.md`)

## 1. Response Envelope & Request Tracing
Every `/api/v1/*` endpoint sets the `X-Request-Id` response header and returns a consistent JSON envelope:
- **Success:** `{ "ok": true, "data": <T>, "requestId": "req_..." }`
- **Failure:** `{ "ok": false, "error": { "code": "...", "message": "...", "details"?: ... }, "requestId": "req_..." }`

## 2. Server-Side Authentication, Rate Limiting & Pagination
- **Bearer Token Verification (`verifyFirebaseIdTokenWithGoogle`)**: Extracts `Authorization: Bearer <idToken>`, validates token structure, expiration (`exp`), and audience (`sacred-tune-blxdt`), and verifies the account via Google Identity Toolkit `accounts:lookup`.
- **Authoritative Role Resolution**: Never trusts client-supplied `uid` or `role` in headers or request bodies. Roles (`user`, `admin`, `owner`) are resolved from server-side trusted state.
- **Rate Limiting**: Sliding-window rate limiter (`120 req/min` default per IP/actor), returning `429 RATE_LIMITED`.
- **Bounded Pagination**: `limit` is clamped to `1..100` (default `50`), `offset >= 0`.

## 3. Implemented `/api/v1` Endpoints (`src/server/apiApp.ts`)

| Method & Path | Auth / Role | Purpose & Validation |
| :--- | :--- | :--- |
| `GET /api/v1/health` | Public | Safe readiness summary (`firebaseProjectId`, `firestoreDatabaseConfigured`, `storageConfigured`). |
| `GET /api/v1/config/public` | Public | Public feature flags & owner bootstrap status. |
| `GET /api/v1/modules` | Public | Enabled module definitions ordered by `displayOrder`. |
| `GET /api/v1/categories` | Public | Module category filters (`?moduleId=...`). |
| `GET /api/v1/catalog` | Public / Auth | Paginated, filtered catalog items. Blocks `visibility != 'published'` for non-admins (`403 DRAFT_ACCESS_FORBIDDEN`). |
| `GET /api/v1/catalog/:id` | Public / Auth | Single catalog item. Blocks draft/archived items for ordinary users (`403 DRAFT_ACCESS_FORBIDDEN`). |
| `POST /api/v1/catalog` | `admin` / `owner` | Create catalog item (`CatalogCreateSchema` + audit hook `CATALOG_ITEM_CREATED`). |
| `PATCH /api/v1/catalog/:id` | `admin` / `owner` | Update catalog item (`CatalogPatchSchema` + audit hook `CATALOG_ITEM_UPDATED`). |
| `GET /api/v1/me` | Authenticated | Verified user identity, authoritative role, preferences, and `canBootstrapOwner`. |
| `PATCH /api/v1/me/preferences` | Authenticated | Update user preferences (`PreferencesPatchSchema`). Rejects any `role`/`status`/`isAdmin` field with `403 ROLE_ESCALATION_FORBIDDEN`. |
| `GET /api/v1/me/favorites` | Authenticated | List owner-scoped favorite preset IDs. |
| `PUT /api/v1/me/favorites/:itemId` | Authenticated | Idempotent add to favorites. |
| `DELETE /api/v1/me/favorites/:itemId` | Authenticated | Idempotent remove from favorites. |
| `GET /api/v1/projects` | Authenticated | Paginated owner-scoped Project Library records. Blocks cross-user `?ownerUid=` queries (`403 CROSS_USER_ACCESS_FORBIDDEN`). |
| `POST /api/v1/projects` | Authenticated | Create project record (`ProjectCreateSchema`). Rejects `blob:` URLs (`400 LOCAL_BLOB_URL_FORBIDDEN`) and cross-user `ownerUid`. |
| `GET /api/v1/projects/:id` | Authenticated (Owner) | Read single project record (`403 CROSS_USER_ACCESS_FORBIDDEN` if not owner). |
| `PATCH /api/v1/projects/:id` | Authenticated (Owner) | Update project record (`ProjectPatchSchema`). |
| `DELETE /api/v1/projects/:id` | Authenticated (Owner) | Delete project record + audit hook `PROJECT_DELETED`. |
| `POST /api/v1/assets/upload-url` | Authenticated | Returns `503 STORAGE_NOT_CONFIGURED` when cloud object storage is not enabled. |
| `GET /api/v1/devices` | Authenticated | List owner-scoped paired workstation records. |
| `POST /api/v1/devices/pairing/start` | Authenticated | Issue short-lived one-time pairing code (`SHA-256` hash stored server-side + audit hook `DEVICE_PAIRING_TOKEN_ISSUED`). |
| `GET /api/v1/jobs` | Authenticated | Paginated owner-scoped job records. |
| `POST /api/v1/jobs` | Authenticated | Create job with `idempotencyKey` deduplication (`JobCreateSchema`). |
| `POST /api/v1/connector/jobs/:id/result` | Authenticated (Owner) | Transition job state; rejects duplicate terminal completions with `409 DUPLICATE_TERMINAL_JOB_RESULT`. |
| `POST /api/v1/admin/bootstrap-owner` | Authenticated (Verified Owner Email + Secret) | Safe one-time owner promotion (`409 OWNER_ALREADY_BOOTSTRAPPED` on repeat calls). |
| `GET /api/v1/admin/audit-events` | `admin` / `owner` | Paginated append-only server audit log. |
| `PATCH /api/v1/admin/users/:uid/role` | `owner` | Assign `user`, `admin`, or `owner` role + audit hook `USER_ROLE_UPDATED`. |
