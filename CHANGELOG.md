# Changelog

All notable changes to the Sowveil Studio codebase are documented in this file.

## [0.8.0] — Phase 8: AI Video Director Subsystem, Strict SSRF Vault & Full-Size Plate Rendering
### Added
- **AI Video Director Subsystem (`src/features/ai-director/`)**:
  - Provider-Agnostic Gateway supporting Google Gemini, OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and Custom private gateways.
  - Strict SSRF endpoint validator (`validateProviderEndpointSsrf`) blocking loopback (127.0.0.1, localhost, ::1), link-local, cloud metadata (169.254.169.254), and RFC 1918 private subnets.
  - Diagnostic API key masking (`maskApiKey`) and untrusted content risk scanner.
  - Script Intake & 100% Coverage Tracker (`parseScriptIntoUnits`, `generateCoverageReport`) preventing dropped lines.
  - Canonical Sowveil Timeline Schema v3.0 (`v3.0.0-timeline`) with reversible command engine (`AddTrack`, `AddClip`, `TrimClip`, `MoveClip`, `AddCaption`) and undo snapshots.
  - Backend endpoints: `GET /api/v1/ai/providers`, `POST /api/v1/ai/providers/test`, `POST /api/v1/ai/script/coverage`, `POST /api/v1/ai/timeline/propose`.
- **Full-Size Composition Plate Rendering (`renderPngStillPlate`)**:
  - RFC 1950/1951 multi-block stored DEFLATE stream (`encodeZlibStoredStream`) partitioned into 32KB chunks supporting any resolution up to 1080x1920 (9:16) and 1080x1080 (1:1).
  - Validation returns extracted width and height.
- **Fail-Closed Security Hardening**:
  - Removed predictable fallback secret `SOWVEIL_OWNER_BOOTSTRAP_ONCE` from `.env.example` and `apiApp.ts`. Unconfigured bootstrap requests fail closed with `503 BOOTSTRAP_NOT_CONFIGURED`.
  - Workbox catalog cache in `vite.config.ts` strictly checks `!request.headers.has('authorization')` and published visibility.
- **Documentation Suite**:
  - Added `docs/FEATURE_TRUTH_MATRIX.md` covering all 20 modules and gateway capabilities.
  - Added `docs/AI_DIRECTOR_ROADMAP.md` specifying multi-track timeline architecture and provider contracts.
- **Test Suite (`src/tests/aiDirectorPhase8.test.ts`)**:
  - Automated tests for full-size PNG plates, SSRF validation, script coverage, timeline command execution, and AI endpoints.

## [0.7.0] — Phase 7: Mobile-First Hardening & Production PWA
### Added
- Responsive touch-first UI supporting Android portrait widths (320px–430px) with 44x44px minimum touch targets.
- Honest export statuses: `downloaded` and `ready` (Web Share sheet handoff).
- Elimination of desktop AE assumptions in favor of mobile editor workflow handoffs.

## [0.6.0] — Phase 6: Media Workflows, Auto Captions & Security Filters
### Added
- Auto Captions editor with SubRip (.srt), WebVTT (.vtt), JSON, and ZIP bundle generation.
- Media job lifecycle with deterministic progress and worker gates.
- Expressions math evaluator running 12 preset formulas client-side.
- 16-bit PCM WAV audio waveform generator and glTF asset validator.
- SSRF guard and magic-byte inspection for imported media.

## [0.5.0] — Phase 5: Mobile Editor Gateway & Real Artifact Exporters
### Added
- Mobile editor adapters: CapCut, Alight Motion, Node Video, KineMaster, Sowveil Project, Universal Bundle.
- Validated Alight Motion XML scene generator (`scene.xml`).
- RFC-compliant PKZIP bundle generator without fake file extensions.
- Validated `.sowveil.json` project document schema.

## [0.3.0] — Phase 3: Firebase Persistence, RBAC & API Security
### Added
- Firestore security rules auditing all 12 Dirty Dozen invariants.
- Express API server with JWT verification, role-based access control, and rate limiting.
- One-time owner bootstrap lock and immutable audit logging.

## [0.2.0] — Phase 2: Catalog, Search, Favorites and Project Library
### Added
- Shared Catalog Engine with multi-field search and category filtering.
- Original catalog seeds across all 17 catalog modules.
- Project Library full CRUD with checkpoint versioning.
- Job state machine with idempotent transitions.

## [0.1.0] — Phase 1: Discovery, Architecture, Design System & App Shell
### Added
- Dark studio design system and responsive app shell.
- 20-module catalog structure.
