# Data Model & Firestore Design (`docs/DATA_MODEL.md`)

## Provisioned Cloud Firestore Instance
- **Firebase Project ID:** `sacred-tune-blxdt`
- **Firestore Database ID:** `ai-studio-411ad70d-501b-4df1-8287-ce21e9091d8d`
- **Intermediate Representation:** `firebase-blueprint.json` (12 entities mapped to 12 collection paths)
- **Composite Indexes (`firestore.indexes.json`):**
  - `catalogItems`: `(visibility ASC, moduleId ASC, name ASC)`
  - `projects`: `(ownerUid ASC, updatedAt DESC)`
  - `jobs`: `(ownerUid ASC, createdAt DESC)`
  - `devices`: `(ownerUid ASC, updatedAt DESC)`
  - `auditEvents`: `(actorUid ASC, createdAt DESC)`
  - *Index Deployment:* Deploy via `firebase deploy --only firestore:indexes --project sacred-tune-blxdt` using the Firebase CLI if custom composite index builds are required beyond automatic single-field indexes.

## Collections & Security Enforcement (`firestore.rules`)

1. **`/users/{uid}`** (`UserProfile`)
   - **Fields:** `uid`, `displayName`, `photoURL` (optional), `role` (`user` | `admin` | `owner`), `status` (`active` | `suspended` | `pending`), `preferences` (`reducedMotion`, `defaultSortOrder`, `preserveSearchOnModuleSwitch`), `createdAt`, `updatedAt`.
   - **Rules:** PII is excluded (`email` lives in `/users/{uid}/private/info`). Users may only read their own document (`isOwner(uid) || isAdmin()`). On create, `role` must be `'user'` (unless `isAdmin()`) and `status` must be `'active'`. On update, `role`, `status`, `uid`, and `createdAt` are immutable for standard users (`affectedKeys().hasOnly(['displayName', 'photoURL', 'preferences', 'updatedAt'])`).

2. **`/users/{uid}/private/{docId}`** (`UserPrivateInfo`)
   - **Fields:** `uid`, `email`, `updatedAt`.
   - **Rules:** Split-collection PII isolation. Strictly readable/writable only by `isOwner(uid)` (with Master Gate `exists(/databases/$(database)/documents/users/$(uid))`).

3. **`/admins/{uid}`** (`AdminGrant`)
   - **Fields:** `uid`, `role` (`admin` | `owner`), `grantedBy`, `createdAt`.
   - **Rules:** Trusted role source of truth queried by `exists(/databases/$(database)/documents/admins/$(request.auth.uid))`. Writable only by `isAdmin()`.

4. **`/modules/{moduleId}`** & **`/categories/{categoryId}`**
   - **Rules:** Publicly readable when `enabled == true`; writable strictly by `isAdmin()`.

5. **`/catalogItems/{itemId}`** (`CatalogItemRecord`)
   - **Rules:** Ordinary users can only `get` or `list` items where `resource.data.visibility == 'published'`. Draft (`visibility == 'draft'`) and archived items are restricted to `isAdmin()`. Writes are restricted to `isAdmin()`.

6. **`/favorites/{uid}/items/{itemId}`** (`FavoriteRecord`)
   - **Fields:** `itemId`, `ownerUid`, `createdAt`.
   - **Rules:** Enforces Master Gate (`exists(/databases/$(database)/documents/users/$(uid))`), deterministic document ID (`incoming().itemId == itemId`), and strict owner isolation (`ownerUid == request.auth.uid`).

7. **`/projects/{projectId}`** (`ProjectRecord`)
   - **Fields:** `id`, `ownerUid`, `title`, `description`, `compCount` (`number | null`), `projectFileStatus` (`metadata-only` | `uploaded` | `linked-local` | `packaged`), `fileSizeBytes` (`number | null`), `fileSizeLabel`, `resolution`, `durationLabel`, `fps`, `aeVersion`, `hasExternalFootageWarning`, `archived`, `tags[]`, `createdAt`, `updatedAt`.
   - **Rules:** Strictly owner-scoped (`resource.data.ownerUid == request.auth.uid || isAdmin()`). `ownerUid`, `id`, and `createdAt` are immutable.

8. **`/jobs/{jobId}`** (`JobQueueRecord`)
   - **Fields:** `id`, `ownerUid`, `type`, `title`, `moduleId`, `itemId`, `operation`, `status` (`queued` | `claimed` | `running` | `succeeded` | `failed` | `cancelled` | `needs-setup` | `expired`), `attemptCount`, `idempotencyKey`, `deviceId`, `errorCode`, `redactedMessage`, `requestId`, `createdAt`, `updatedAt`.
   - **Rules:** Strictly owner-scoped. Enforces **Terminal State Locking** (`!(existing().status in ['succeeded', 'cancelled', 'expired'])`) so completed/cancelled/expired jobs cannot be reopened or overwritten by standard users.

9. **`/devices/{deviceId}`** (`DeviceRecord`) & **`/devicePairingTokens/{tokenId}`** (`DevicePairingTokenRecord`)
   - **Rules:** `/devices/{deviceId}` is owner-scoped. `/devicePairingTokens/{tokenId}` has `allow read, write: if false;` so pairing token hashes are never accessible via client SDKs.

10. **`/auditEvents/{eventId}`** (`AuditEventRecord`)
    - **Rules:** `allow get, list: if isAdmin(); allow create, update, delete: if false;` — strictly append-only via server-side hooks.
