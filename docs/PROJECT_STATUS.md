# Sowveil Studio — Project Status (`docs/PROJECT_STATUS.md`)

## Current Phase: Phase 7 Complete (Mobile-First Production Hardening, PWA, Security, Performance, Testing & Deployment)

### Completed Milestones
- **Phase 1**: Mobile-first Dark Obsidian & Signal Ember UI shell, 20 module definitions, live procedural preview renderer, and honest capability badges.
- **Phase 2**: Shared catalog repository, debounced keyboard-accessible search, real category counts, optimistic favorites with rollback, detail inspection drawer, Project Library CRUD, and job state machine.
- **Phase 3**: Provisioned Firebase Authentication & Cloud Firestore (`ai-studio-411ad70d-501b-4df1-8287-ce21e9091d8d`), hardened `firestore.rules`, server-side `/api/v1/*` token verification, RBAC (`user`, `admin`, `owner`), rate limiting, and one-time owner bootstrap.
- **Prompt 0 (Mobile-First Architecture Correction)**: Replaced desktop After Effects assumptions with Android/mobile-first workflows, bottom navigation, PWA manifest/service worker, and mobile aspect ratio presets (`9:16`, `1:1`, `16:9`).
- **Phase 4 (Admin Console & Safe Technical Diagnostics)**: Built `/admin/*` (11 sub-routes) and `/technical` with server-enforced RBAC, confirmation dialogs, and strict secret redaction.
- **Phase 5 (Mobile Editor Gateway, Export Engine & App-Specific Adapters)**:
  - Created `src/features/editor-gateway/` (`types.ts`, `schemas.ts`, `alightMotionXml.ts`, `strategies.ts`, `adapters.ts`, `index.ts`).
  - Implemented all 7 export strategies (`.sowveil.json` v2.0 `MotionDocument`, `.zip` with `AssetBundleManifest` & SHA-256/CRC32, sanitized `.svg`, RGBA `.png`, 16-bit PCM `.wav`, `.srt`/`.vtt`/`.captions.json` with round-trip parser, and isolated Alight Motion `.xml` tested subset).
  - Upgraded `src/components/ExportOpenInModal.tsx` with the 6-step mobile flow, `"Why can't this be added directly?"` contextual help drawer, Alight Motion XML subset matrix, FPS/duration/quality/background-alpha/chroma-key `#00FF00` settings, low-power static preview toggle, and Web Share API handoff.
  - Added `/api/v1/editors/:id/capabilities`, `/api/v1/exports/jobs/:id`, `/api/v1/exports/jobs/:id/download`, `/api/v1/exports/jobs/:id/retry`, and `DELETE /api/v1/exports/jobs/:id` with cross-user isolation and quota enforcement.
  - Added automated test suite `src/tests/editorGatewayPhase5.test.ts` and documentation (`docs/EDITOR_COMPATIBILITY.md`, `docs/EXPORT_FORMATS.md`).
- **Phase 6 (Mobile Media Workflows, Rendering, Captions, Assets & Downloader)**:
  - Created `src/features/media-workflows/index.ts` and expanded `JobRecord` / `VALID_JOB_TRANSITIONS` (`draft`, `queued`, `uploading`, `running`, `finalizing`, `ready`, `downloaded`, `cancelled`, `failed`, `needs-setup`, `quota-reached`) with deterministic byte/stage progress and worker/cost gates.
  - Upgraded `AutoCaptionsWorkspace` (`src/components/UtilityWorkspaces.tsx`) to a 4-step workflow (`1. Source`, `2. Transcribe`, `3. Edit Timed Segments` with touch split/merge/delete/retime and overlap/line-length validation, `4. Export` `.srt`, `.vtt`, `.captions.json`, and mobile editor sidecar `.zip`).
  - Upgraded `PreviewRenderer.tsx` and `CatalogBrowserWorkspace.tsx` with timeline scrubbing, `visibilitychange` auto-pause, mobile resolution toggle (`0.5x Mobile`, `1x High`, `Still Safe`), Text Animation font fallback warnings, deterministic math across all 12 Expressions presets, interactive cubic-bezier handles across 26 Easing presets, real 16-bit PCM WAV waveform peaks & Web Audio playback across 60 SFX items, glTF 2.0 header validation, and abstract vector Map routes.
  - Upgraded `DownloaderWorkspace` and `ProjectLibraryWorkspace` with strict SSRF URL validation, binary magic-byte inspection (`MP4`, `WebM`, `WAV`, `MP3`, `PNG`, `GLB`), version history checkpoints (`+ Checkpoint` / `Restore`), and project duplication.
  - Added `/api/v1/media/validate-url`, `/api/v1/media/inspect-bytes`, `/api/v1/captions/validate-and-bundle`, and `PATCH /api/v1/jobs/:id`, plus `src/tests/mobileMediaWorkflows.test.ts` and `docs/MOBILE_MEDIA.md`.
- **Phase 7 (Mobile-First Production Hardening, PWA, Security, Performance & Deployment)**:
  - **Mobile UX Acceptance**: Hardened 320px, 360px, 390px, 412px, 430px Android portrait viewports. Upgraded touch targets to 44×44px across all interactive buttons, filter tabs, search clear, and bottom sheet dialogs (`max-h-[90dvh]`, `overscroll-contain`).
  - **PWA Production Readiness**: Configured web app manifest (`id: /`, `short_name: Sowveil`, `display: standalone`), Workbox runtime caching for shell and public catalog while strictly excluding private/authenticated APIs, offline status dialog with real health-check retry ping, and real browser signal install detection (`beforeinstallprompt` + iOS Safari instructions, zero fabricated "Installed" flags).
  - **Security & Crawlers**: Enforced `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`, `X-Robots-Tag: noindex, nofollow` on `/api/*`, `/admin/*`, and `/technical`.
  - **Origin-Checked CORS**: Strict origin validation against allowed origins with credentials support and preflight 204.
  - **Cache-Control Policies**: `public, max-age=60, stale-while-revalidate=300` for public catalog; `no-store, no-cache, must-revalidate, private` for jobs, projects, user data, and export downloads.
  - **Auth Rate-Limiting**: Strict 10 req/min limit on `/api/v1/admin/bootstrap-owner` and auth routes; 120 req/min on general `/api/v1`.
  - **SEO & Discoverability**: Synced `metadata.json` and `index.html` (title, meta description, OpenGraph, Twitter card, canonical URL, Schema.org `WebApplication` JSON-LD), `public/robots.txt`, and `public/sitemap.xml`.
  - **Complete 20×5 Matrix**: Generated full 20-module × 5 mobile editor matrix in `docs/FEATURE_MATRIX.md` and complete deployment runbook in `docs/DEPLOYMENT.md`.
  - **Automated Test Suite**: Added `src/tests/mobileHardeningPhase7.test.ts` (42+ automated tests passing across 8 test suites).
