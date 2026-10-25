# Sowveil Studio — Mobile-First Architecture Migration (`docs/MOBILE_MIGRATION.md`)

**Status:** Completed & Verified  
**Target Platform:** Android Mobile-First Progressive Web App (PWA) + Mobile Editor Integration Gateway  
**Firebase Project:** `sacred-tune-blxdt` · Cloud Firestore Database: `ai-studio-411ad70d-501b-4df1-8287-ce21e9091d8d`

---

## 1. Executive Summary & Product Direction Correction

Sowveil Studio has been evolved through an **additive migration** from a desktop-bridge-focused motion-design workbench into a **mobile-first motion-design platform designed for Android phones**.

- **Zero Desktop Dependency:** No core creative module or user workflow requires Adobe After Effects, Premiere Pro, desktop software, a desktop companion, or a PC-local processing service.
- **Target Mobile Video Editors:**
  1. **CapCut (Android / Mobile)**
  2. **Alight Motion (XML Template & Media)**
  3. **Node Video (Android Pro Compositor)**
  4. **KineMaster (Mobile Timeline)**
  5. **Sowveil Studio Native (`.sowveil.json`)**
  6. **Universal Asset Bundle (`.zip`)**

---

## 2. Preserved Phase 1–3 Architecture

All existing work from Phases 1–3 was preserved without framework changes or data loss:
- **20 Original Modules Preserved:** `text-animation`, `expressions`, `easing`, `sfx`, `ready-made`, `ui-saas`, `liquid-glass`, `carousel`, `transitions`, `3d-models`, `mockups`, `logo-reveals`, `backgrounds`, `overlays-fx`, `maps`, `saas-effects`, `templates`, `auto-captions`, `downloader`, and `project-library`.
- **Firebase Authentication & Cloud Firestore:** Google Sign-In (`signInWithPopup`), split PII isolation (`/users/{uid}/private/info`), owner-scoped `/favorites`, `/projects`, `/jobs`, `/devices`, and append-only `/auditEvents`.
- **Server-Side `/api/v1` Security Layer:** Express + Zod validation + Firebase token verification + rate limiting + request IDs (`x-request-id`) + role-based access control (`user`, `admin`, `owner`).

---

## 3. Desktop Assumptions Replaced with Mobile-Native Execution Paths

| Previous Desktop Assumption | New Mobile-First Execution Path |
|---|---|
| `requiresDesktop: true` across 19 modules blocking action buttons with "Connector not paired" | `requiresDesktop: false` across all 20 modules; primary action is **"Export & Open In Mobile Editor"** |
| ExtendScript / CEP timeline injection as primary output | **Mobile Editor Integration Gateway** (`src/services/editorGateway.ts`) generating validated `.sowveil.json`, Alight Motion `.xml`, `.svg`, `.wav`, `.srt`, and `.zip` bundles |
| Desktop-only 2-row 20-module header strip | Android thumb-friendly horizontal module carousel + **"20 Modules"** bottom sheet drawer + fixed 5-tab mobile bottom navigation bar (`Modules`, `Projects`, `Saved`, `Exports`, `Settings`) |
| Desktop Companion Whisper requirement blocking Auto Captions | On-device **Mobile Timed Caption Builder** accepting phone audio/video/`.srt` files, live 9:16/1:1/16:9 caption overlay preview, and instant validated `.srt` export & Android share sheet handoff |
| Desktop `yt-dlp` requirement blocking Downloader | Policy-safe **Mobile Reference & Media Intake** validating public HTTPS URLs (blocking private IPs/SSRF) and exporting a `.sowveil.json` mobile reference intake manifest |
| Project Library restricted to `.aep` metadata | Project Library supports reusable `.sowveil.json` mobile project documents, Alight Motion `.xml` templates, and `.aep` metadata records with direct file import & download |

---

## 4. Affected Files Inventory

- **PWA & Build Configuration:**
  - `/vite.config.ts` — Added `VitePWA` plugin with manifest and Workbox runtime caching.
  - `/tsconfig.json` — Added `"vite-plugin-pwa/client"` types.
  - `/index.html` — Added Android PWA meta tags, theme color `#080707`, and compliant PNG icons.
  - `/public/icon.svg`, `/public/pwa-192x192.png`, `/public/pwa-512x512.png`, `/public/pwa-maskable-512x512.png`, `/public/apple-touch-icon.png` — Compliant non-transparent PNG icons.
  - `/src/components/PWAInstallBanner.tsx` — Install prompt hook (`beforeinstallprompt` + fallback modal) and offline indicator.
- **Mobile Editor Integration Gateway & Export UI:**
  - `/src/types/sowveil.ts` — Added `TargetMobileEditorId`, `EditorCompatibilityStatus`, `MobileAspectRatio`, `ExportArtifactFormat`, `MobileEditorAdapterDescriptor`, and `ready`/`downloaded` job statuses.
  - `/src/services/editorGateway.ts` — Implemented adapters, validators, and binary generators (`.sowveil.json`, Alight Motion `.xml`, `.svg`, 16-bit PCM `.wav`, `.srt`, and RFC-compliant PKZIP `.zip`).
  - `/src/components/ExportOpenInModal.tsx` — Mobile-first modal/bottom sheet for target editor selection, aspect ratio (`9:16`, `1:1`, `16:9`), format selection, step-by-step mobile import guide, Web Share API handoff, and Project Library saving.
- **Workspace & Shell Updates:**
  - `/src/data/modules.ts` — Updated all 20 modules to mobile-first descriptions and `requiresDesktop: false`.
  - `/src/components/ModuleStrip.tsx` — Added mobile horizontal touch strip + 20-module bottom sheet drawer.
  - `/src/components/CatalogBrowserWorkspace.tsx` — Added mobile Catalog/Inspector tab switcher and quick export triggers (`CapCut`, `Alight XML`, `Node Video`, `KineMaster`).
  - `/src/components/UtilityWorkspaces.tsx` — Upgraded Auto Captions, Downloader, and Project Library for mobile workflows.
  - `/src/components/PublicPages.tsx`, `/src/components/SecondaryAppPages.tsx`, `/src/App.tsx` — Mobile bottom navigation bar, PWA install button, and updated diagnostics.
- **Backend & Firestore Rules:**
  - `/src/server/apiApp.ts` — Added `/api/v1/editors` and `/api/v1/exports/generate`, updated project and job schemas.
  - `/firestore.rules` & `/firebase-blueprint.json` — Added `sowveil-native`, `alight-motion-xml`, `media-bundle` project statuses and `ready`/`downloaded` job states; linted and deployed to Firebase.
