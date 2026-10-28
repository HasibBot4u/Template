# Sowveil Studio — Mobile-First & Canonical Project Architecture

**Target Platform:** Android-First Progressive Web App (PWA) (`320px–430px` portrait phones, foldable tablets, and desktop browsers)  
**Zero Desktop Companion Requirement:** All browsing, previewing, parameter editing, caption processing, AI script planning, and export generation run in the mobile web app + cloud API without requiring desktop After Effects or local PC daemons.

---

## 1. Android-First Ergonomics & PWA Design

### 1.1 Viewport, Safe Areas & Touch Targets (`src/index.css`)
- **Safe-Area Insets:** `.safe-bottom` applies `padding-bottom: max(0.75rem, env(safe-area-inset-bottom))` to protect bottom drawers and action bars from Android gesture navigation bars.
- **Touch Target Minimums:** Interactive pills, module buttons, and modal actions enforce `min-height: 44px` or `36px+` with generous horizontal padding and `touch-pan-x` scrolling on horizontal strips.
- **Reduced Motion & Low-End Device Guardrails:**
  - Respects `@media (prefers-reduced-motion: reduce)` and the user's in-app `reducedMotion` workspace setting (`UserProfile.preferences.reducedMotion`).
  - Preview canvases (`PreviewRenderer.tsx`) cancel `requestAnimationFrame` loops immediately on unmount or when paused.
  - Catalog grid thumbnails use lightweight SVG/Canvas previews or `64×64` PNG thumbnails (`generatePngPreviewThumbnail`) while reserving full `1080×1920` / `1080×1080` raster allocation (`renderPngStillPlate`) strictly for explicit user still-plate exports.

### 1.2 Service Worker & Cache Security (`vite.config.ts`)
- **Static App Shell Precaching:** `vite-plugin-pwa` (`registerType: 'autoUpdate'`) precaches compiled JS, CSS, HTML, and SVG icons for instant repeat loads on mobile networks.
- **Strict Public-Only API Caching:** Workbox runtime caching (`sowveil-public-catalog-cache`) caches `/api/v1/catalog` responses **only** when:
  1. `request.method === 'GET'`
  2. `!request.headers.has('authorization')`
  3. `!url.searchParams.has('includeDrafts')`
  4. `url.searchParams.get('visibility')` is `null` or `'published'`
- **Private & Admin Route Isolation:** All `/api/v1/admin/*`, `/api/v1/auth/*`, and `/api/v1/ai/*` routes send `Cache-Control: private, no-store, no-cache, must-revalidate` and `Vary: Authorization`, preventing shared browser or SW cache poisoning.

---

## 2. Offline vs. Online Operational Matrix

| Feature Area | Offline / Signed-Out Capability | Online / Signed-In Capability |
|---|---|---|
| **20-Module Catalog Browsing** | Full access to 74 seeded templates, search, category filtering, sorting, and live interactive previews. | Syncs with `/api/v1/catalog` and user favorites in Cloud Firestore. |
| **Parameter Editing & Preview** | Real-time slider/color/text/select adjustments in `CatalogBrowserWorkspace` and `PreviewRenderer`. | Saves custom parameter overrides to `projects/{projectId}` in Firestore with revision tracking. |
| **Auto Captions (`Module 18`)** | Client-side SRT/VTT cue parsing, timing overlap checks, and `.srt`/`.vtt` file download. | Persists caption job state transitions in Firestore (`jobs/{jobId}`). |
| **Media Inspector (`Module 19`)** | Local file metadata inspection (`File` API) and client URL syntax checks. | Server-side SSRF-guarded URL inspection (`/api/v1/media/inspect`). |
| **Project Library (`Module 20`)** | LocalStorage workspace fallback (`LocalFallbackWorkspaceRepository`) + `.sowveil.json` file backup/restore. | Cloud Firestore persistence (`FirestoreWorkspaceRepository`) with bounded revision checkpoints (`max 20`). |
| **Mobile Editor Export Gateway** | Client-side generation of `.sowveil.json`, `.svg`, `.html`, `.srt`, `.vtt`, `.csv`, and `1080×1920` `.png` still plates + Web Share / download. | Server-verified export receipts (`/api/v1/export/generate`) and job history logging. |
| **AI Video Director (`/api/v1/ai/*`)** | Offline deterministic heuristic script segmentation and timeline compilation (`scriptDirector.ts`). | Encrypted server-side provider credential vault + live LLM adapters (Gemini, OpenAI, Anthropic, OpenRouter, Custom). |

---

## 3. Canonical Editable Project Schema Unification

### 3.1 Current Schema Layers
1. **`ProjectLibraryItem` (`src/types/sowveil.ts`):**
   - Stores user-saved template customizations (`id`, `userId`, `title`, `templateItemId`, `moduleId`, `aspectRatio`, `durationSeconds`, `fps`, `parameterValues`, `revision`, `checkpoints`).
2. **`MotionDocument` / `SowveilProjectDocument` `v2.4.0-mobile` (`src/features/editor-gateway/schemas.ts`):**
   - Portable single-item motion specification containing normalized parameters, expression declarations, cubic-bezier easing coordinates, and asset references for mobile editor adapters.
3. **`SowveilTimelineProject` `v3.0.0-timeline` (`src/features/ai-director/types.ts`):**
   - Multi-scene, multi-track canonical timeline schema supporting `scenes`, `tracks` (`video`, `title`, `graphic`, `caption`, `audio-voice`, `audio-sfx`, `camera`), `clips`, `keyframes`, `scriptSegments`, `shotPlan`, `revision`, `checkpoints`, and `commandHistory`.

### 3.2 Unification Architecture (Phase 2 Protected Migration)
- **Single Source of Truth:** Every `ProjectLibraryItem` can deterministically project into a 1-scene `SowveilTimelineProject` (`v3.0.0-timeline`) where `parameterValues` populate the primary template clip's `properties` and `keyframes`, and any multi-scene `SowveilTimelineProject` can export individual scenes or the full composition through `editorGateway.ts`.
- **Typed Command Layer (`src/features/ai-director/timelineEngine.ts`):**
  - Both manual inspector edits and AI Director actions execute through `applyTimelineCommand(project, command, actorId)`, which validates preconditions, respects `locked` clips/shots, increments `revision`, appends an immutable `TimelineCommandReceipt`, and records reversible checkpoints before destructive operations.

---

## 4. Mobile Editor Gateway Truth & Compatibility

| Target Adapter ID | Target App / Method | Real Supported Handoff Formats | Truthful Capability Status |
|---|---|---|---|
| `sowveil-composer` | Sowveil Mobile Composer | `.sowveil.json` (`v2.4.0-mobile`), `.html` preview player | **Implemented & Verified:** Full lossless parameter, expression, and keyframe fidelity. |
| `alight-motion` | Alight Motion (Android) | `.svg` vector card, `1080×1920` `.png` still plate, `.csv` cue sheet, cubic-bezier curve spec | **Implemented & Verified (Assistive Bundle):** Exports standard SVG/PNG/CSV/curve specs for import; does not claim undocumented closed-source `.alightproj` binary signing. |
| `capcut-mobile` | CapCut Mobile | `.srt` / `.vtt` captions, `1080×1920` `.png` overlay plates, `.csv` timing sheet | **Implemented & Verified (Assistive Bundle):** Uses standard caption and overlay imports supported on Android CapCut. |
| `vn-editor` | VN Video Editor | `.srt` captions, `.svg` / `.png` graphic plates | **Implemented & Verified (Assistive Bundle):** Standard file share / download handoff. |
| `system-share` | Android System Share Sheet | `navigator.share({ files })` for `.png`, `.svg`, `.srt`, `.vtt`, `.json`, `.html` | **Implemented & Verified:** Invokes native Web Share Level 2 on Android Chrome/Edge with automatic file-download fallback. |
| `file-export` | Direct Device Download | All 8 formats (`.sowveil.json`, `.svg`, `.png`, `.html`, `.srt`, `.vtt`, `.csv`, `.curve.svg`) | **Implemented & Verified:** Direct browser download with byte-size and checksum validation. |
