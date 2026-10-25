# Sowveil Studio — Phase 0 Payload-First Security TDD (`security_spec.md`)

## 1. Data Invariants & Master Source of Truth
1. **Identity & Role Invariant**:
   - A user (`request.auth.uid`) can never assign or escalate their own `role` to `'admin'` or `'owner'` in `/users/{uid}` or `/admins/{uid}`.
   - Trusted admin status is derived strictly from `exists(/databases/$(database)/documents/admins/$(request.auth.uid))` or the verified runtime owner email (`mdhasibul4u@gmail.com` with `request.auth.token.email_verified == true`).
2. **PII Isolation Invariant**:
   - `/users/{uid}/private/{docId}` stores the user's `email`. No authenticated user other than `uid` (or a verified admin) may read or write this document.
3. **Catalog Visibility Invariant**:
   - Ordinary users (`user`) may only read `/catalogItems/{itemId}` when `resource.data.visibility == 'published'`. Draft and archived items are strictly restricted to admins/owners.
   - Ordinary users cannot create, update, or delete `/catalogItems`, `/modules`, or `/categories`.
4. **Private Subcollection & Resource Ownership Invariant**:
   - `/favorites/{uid}/items/{itemId}` requires the parent `/users/{uid}` document to exist (Master Gate), requires `request.auth.uid == uid`, and requires `incoming().ownerUid == request.auth.uid` and `incoming().itemId == itemId`.
   - `/projects/{projectId}`, `/jobs/{jobId}`, and `/devices/{deviceId}` require `resource.data.ownerUid == request.auth.uid` for all reads (`get` and `list`) and writes.
5. **Terminal State Locking Invariant**:
   - Once a job in `/jobs/{jobId}` reaches a terminal status (`succeeded`, `cancelled`, `expired`), ordinary users cannot transition or mutate it further.
6. **System-Only Collections Invariant**:
   - `/devicePairingTokens/{tokenId}` is completely inaccessible to client SDK reads and writes (`allow read, write: if false;`).
   - `/auditEvents/{eventId}` is never writable from the client SDK (`allow create, update, delete: if false;`) and is readable only by verified admins/owners.

---

## 2. The "Dirty Dozen" Adversarial Payloads
Each of the following 12 payloads is tested in `src/tests/firestore.rules.test.ts` and must be rejected (`PERMISSION_DENIED`):

1. **Payload 1 (Self-Role Escalation on Profile Create)**:
   - User `user_alice` creates `/users/user_alice` with `role: "owner"`.
2. **Payload 2 (Self-Role Escalation on Profile Update)**:
   - User `user_alice` updates `/users/user_alice` changing `role` from `"user"` to `"admin"`.
3. **Payload 3 (Shadow Field Injection on Profile Update)**:
   - User `user_alice` updates `/users/user_alice` with an undeclared field `isSuperAdmin: true`.
4. **Payload 4 (Cross-User PII Read)**:
   - User `user_mallory` attempts `get` on `/users/user_alice/private/info`.
5. **Payload 5 (Unverified Email Admin Spoof)**:
   - Attacker with `email: "mdhasibul4u@gmail.com"` but `email_verified: false` attempts to write to `/catalogItems/item_1`.
6. **Payload 6 (Draft Catalog Item Read by Ordinary User)**:
   - User `user_alice` attempts to read `/catalogItems/draft_secret_item` where `visibility == "draft"`.
7. **Payload 7 (Cross-User Project Read/Update)**:
   - User `user_mallory` attempts to read or update `/projects/proj_alice_1` where `ownerUid == "user_alice"`.
8. **Payload 8 (Orphaned Favorite Write Without Master Gate Parent)**:
   - User `user_ghost` (without `/users/user_ghost` profile) attempts to create `/favorites/user_ghost/items/ta-rise-up`.
9. **Payload 9 (Terminal Job State Re-open)**:
   - User `user_alice` attempts to update `/jobs/job_completed_1` (where `status == "succeeded"`) back to `status: "running"`.
10. **Payload 10 (Client Audit Log Forgery)**:
    - User `user_alice` (or even admin via client SDK) attempts to create or delete `/auditEvents/evt_1`.
11. **Payload 11 (Private Device Pairing Token Read)**:
    - User `user_alice` attempts to read `/devicePairingTokens/tok_123`.
12. **Payload 12 (Resource Poisoning / Oversized String or Invalid ID)**:
    - User `user_alice` attempts to create a project with a 5,000-character `title` or an invalid path ID containing spaces/slashes.
