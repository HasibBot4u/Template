# Sowveil Studio — Security & Privacy Controls (`docs/SECURITY.md`)

## 1. Authentication & Authorization
- **Server-Side Token Verification**: Every `/api/v1/*` protected route verifies Bearer tokens server-side (`verifyFirebaseIdTokenWithGoogle` or injected test verifier) and enforces `email_verified === true`.
- **Role-Based Access Control (RBAC)**: Roles (`user`, `admin`, `owner`) are resolved from server-side role records and Firestore `/user_roles/{uid}`, never from client request bodies.
- **Cross-User Isolation**: Favorites, projects, devices, jobs, and export artifacts (`/api/v1/exports/jobs/:id`, `/api/v1/exports/jobs/:id/download`, `/api/v1/exports/jobs/:id/retry`, `/api/v1/exports/jobs/:id` DELETE) enforce strict ownership (`ownerUid === callerUid`), returning `403 CROSS_USER_ACCESS_FORBIDDEN` on cross-user access attempts.

## 2. Export & Input Hardening (Phase 5)
- **Anti-ZIP-Bomb & Path Traversal Defense (`validateZipSafety`)**: Inspects PKZIP headers and Central Directory records to enforce maximum file count, maximum per-file uncompressed size, maximum total expansion size, compression ratio limits, and rejects `../`, `..\`, leading `/`, drive letters (`C:`), and null bytes.
- **SVG Sanitization (`sanitizeSvgContent`)**: Strips `<script>`, `<foreignObject>`, inline `on*` event attributes (`onload`, `onerror`, etc.), `javascript:` URIs, and external `http(s)://` references.
- **XML Hardening (`validateAndInspectAlightMotionXml`)**: Escapes all user-supplied text entities and rejects `<!DOCTYPE` and `<!ENTITY` (XXE protection).
- **Local File Input & Cloud Consent (`validateLocalMediaFile`)**: Validates file extensions, sizes, and magic bytes (`PNG`, `RIFF/WAVE`) on the phone before reading. Private media stays on-device unless the user checks the explicit cloud processing consent box, with automatic retention expiry (`retentionExpiresAt`) and immediate user-initiated job/artifact deletion (`DELETE /api/v1/exports/jobs/:id`).
- **Quota & Size Caps**: Enforces `exportMaxSizeMb` (`413 EXPORT_SIZE_CAP_EXCEEDED`) and `userDailyExportQuota` (`429 EXPORT_DAILY_QUOTA_EXCEEDED`).
- **Diagnostic Redaction (`redactSensitiveDiagnosticString`)**: Strips Bearer tokens, JWTs, API keys, signed URLs, and local filesystem paths from `/api/v1/diagnostics/technical` and audit logs.

## 3. Media Workflow, SSRF & Magic-Byte Hardening (Phase 6)
- **Strict SSRF URL Validation (`validateMediaUrlForSsrf` & `POST /api/v1/media/validate-url`)**:
  - Allows `https:` only; blocks `http:`, `file:`, `ftp:`, `data:`, `javascript:`, and embedded URL credentials (`user:pass@host`).
  - Blocks `localhost`, IPv4 loopback (`127.0.0.0/8`), RFC1918 private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`), cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`), CGNAT (`100.64.0.0/10`), and IPv6 loopback/private/mapped literals (`::1`, `fc00::/7`, `fe80::/10`, `::ffff:127.0.0.1`).
- **Binary Magic-Byte Verification (`verifyMediaMagicBytes` & `POST /api/v1/media/inspect-bytes`)**:
  - Verifies actual container magic bytes (`MP4/MOV ftyp`, `WebM/MKV EBML`, `RIFF/WAVE`, `MP3 ID3/sync`, `OggS`, `PNG`, `glTF 2.0`) and rejects disguised scripts or executables regardless of file extension.
- **Filename Sanitization (`sanitizeMediaFileName`)**:
  - Strips path traversal sequences (`../`, `/`, `\`), null bytes, and control characters from all uploaded or exported filenames.
- **Large File Privacy Disclosure**:
  - Files exceeding `10 MB` in Auto Captions require explicit user acknowledgment of upload retention and privacy policy before any remote worker job can be queued.

