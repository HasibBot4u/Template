# Sowveil Studio — Admin Operations & Governance Guide (`docs/ADMIN.md`)

## 1. Overview & Mobile-First Admin Ergonomics
Sowveil Studio’s `/admin/*` workspace is a server-authorized, mobile-first operations console designed to be operated comfortably on an Android phone viewport (`44px+` touch targets, horizontal scrollable section navigation, responsive cards, and live mobile previews) as well as desktop browsers.

Every admin view is backed by real server endpoints under `/api/v1/admin/*` and `/api/v1/catalog*` that verify the caller’s Firebase Authentication ID token and authoritative role (`admin` or `owner`) before executing any read or mutation.

---

## 2. Admin Routes & Capabilities

| Route | Server API Endpoint(s) | Purpose & Key Controls |
| --- | --- | --- |
| `/admin` | `GET /api/v1/admin/summary?range=24h\|7d\|30d\|all` | Operational summary with real persisted counters across catalog states (`published`, `draft`, `archived`), enabled modules (`20/20`), active users, roles, jobs, assets, verified mobile editors, and audit events within the selected time window. |
| `/admin/catalog` | `GET /api/v1/catalog?visibility=all`, `PATCH /api/v1/catalog/:id`, `DELETE /api/v1/catalog/:id?confirm=true` | Search, filter by module (all 20 modules), visibility (`published`, `draft`, `archived`), and capability status (`Available`, `Needs setup`, `Unsupported`), paginate entries, publish/unpublish items, or soft-delete (`archived`) with confirmation. |
| `/admin/catalog/new` & `/admin/catalog/:id` | `POST /api/v1/catalog`, `PATCH /api/v1/catalog/:id` | Create or edit catalog entries with shared client/server Zod schema validation (`src/schemas/sowveilSchemas.ts`), live `PreviewRenderer` preview, license/attribution metadata, and mobile export format selection. |
| `/admin/assets` | `GET /api/v1/admin/assets`, `POST /api/v1/admin/assets`, `PATCH /api/v1/admin/assets/:id` | Asset ownership, SPDX/commercial license registry, and source attribution. Explicitly reports the configured binary storage provider (`none-configured — Metadata-only registry active` unless `CLOUD_STORAGE_ENABLED=true`) and never fabricates mock bucket URLs. |
| `/admin/modules` | `GET /api/v1/admin/modules`, `PATCH /api/v1/admin/modules/:id`, `DELETE /api/v1/admin/modules/:id` | Configure labels, short mobile labels, descriptions, navigation order (`1–20`), default capability state, and integration availability messages across all 20 creative modules. Deleting any required module is blocked (`403 REQUIRED_MODULE_DELETION_FORBIDDEN`). Disabling a module requires a confirmation reason (`min 5 chars`) and writes an audit record. |
| `/admin/users` | `GET /api/v1/admin/users`, `PATCH /api/v1/admin/users/:uid/status` | Search users and inspect roles, account status (`active`, `suspended`, `pending`), creation date, and masked email (`m***u@gmail.com`). Passwords, auth tokens, and private user project files are never exposed. Supports suspending/reactivating accounts with last-owner protection. |
| `/admin/roles` | `PATCH /api/v1/admin/users/:uid/role` | Assign approved roles (`user`, `admin`, `owner`) with mandatory audit reason. Enforces server-side self-escalation blocking (`SELF_ROLE_ESCALATION_FORBIDDEN`), owner-only owner grants (`ONLY_OWNER_CAN_GRANT_OWNER`), and last-owner lockout protection (`409 LAST_OWNER_PROTECTION`). |
| `/admin/jobs` | `GET /api/v1/admin/jobs` | Inspect caption, render, and mobile export jobs across users with redacted diagnostic messages (`redactSensitiveDiagnosticString`), retry counts, request IDs, and error codes. |
| `/admin/analytics` | `GET /api/v1/admin/analytics` | Real internal operational counters (catalog distribution, per-module item counts, job status counts, editor compatibility breakdown) while explicitly displaying `Not configured` for external telemetry providers rather than fabricated charts. |
| `/admin/settings` | `GET /api/v1/admin/settings`, `PATCH /api/v1/admin/settings`, `GET /api/v1/admin/editors`, `PATCH /api/v1/admin/editors/:id` | Manage safe platform settings (export size cap MB, concurrent job quota, retention days, PWA/Web Share flags, maintenance banner) and the **Mobile Editor Capability & Compatibility Matrix**. Any attempt to edit secrets is rejected with `400 SECRETS_NOT_EDITABLE`. |
| `/admin/audit` | `GET /api/v1/admin/audit-events` | Searchable, filterable append-only security and operations audit log (`actorUid`, `action`, `targetType`, `targetId`, `outcome`, `detailsRedacted`, `createdAt`). Any `DELETE`/`PATCH`/`PUT` against audit events is rejected with `403 AUDIT_LOG_IMMUTABLE`. |

---

## 3. Catalog Lifecycle & Cache Invalidation
1. **Draft Isolation:** Items in `draft` or `archived` state are hidden from non-admin users on `GET /api/v1/catalog` and blocked if requested explicitly (`403 DRAFT_ACCESS_DENIED`).
2. **Cache Versioning:** Every catalog or module mutation increments `catalogCacheVersion` and returns the `X-Catalog-Cache-Version` HTTP header so clients invalidate stale catalog state immediately.
3. **Reference Preservation on Soft-Delete:** Deleting a catalog item via `DELETE /api/v1/catalog/:id?confirm=true` transitions the record to `visibility: "archived"` (`preservedReferences: true`), ensuring existing user favorites and saved Project Library documents never break with dangling references.

---

## 4. Mobile Editor Compatibility Governance
Admins can update compatibility metadata for all 6 registered mobile editor targets (`sowveil-native`, `capcut`, `alight-motion`, `node-video`, `kinemaster`, `generic-files`) in `/admin/settings`.
- Allowed statuses: `Verified`, `Tested subset`, `Media bundle only`, `Planned`, `Unsupported`.
- **Verification Gate:** `EditorAdapterAdminPatchSchema` rejects setting `compatibilityStatus: "Verified"` unless `testedVersions` is non-empty and `verificationNote` is at least 10 characters explaining how the real export generator was verified.
