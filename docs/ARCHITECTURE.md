# Sowveil Studio — Architecture (`docs/ARCHITECTURE.md`)

## 1. System Overview
Sowveil Studio is an Android/mobile-first full-stack web application and Progressive Web App (PWA) built with:
- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide icons, HTML5 SVG/Canvas procedural motion engine (`src/components/PreviewRenderer.tsx`).
- **Mobile Editor Interoperability Subsystem (`src/features/editor-gateway/`)**:
  - `types.ts`: Typed contracts for `EditorAdapter`, `EditorCapability`, `ExportPreset`, `MotionDocument`, `ExportJob`, and `AssetBundleManifest`.
  - `schemas.ts`: Zod runtime schemas, forward-compatible `parsePortableMotionDocument`, `sanitizeSvgContent`, `validateZipSafety`, and `validateLocalMediaFile`.
  - `alightMotionXml.ts`: Isolated Alight Motion XML (`amproj="4.0"`) serializer, inspector, XXE guard, and per-preset subset classifier.
  - `strategies.ts`: Deterministic SHA-256 & CRC32 calculators, `.sowveil.json`, `.zip`, `.svg`, `.png`, `.wav`, `.srt`, `.vtt`, and `.captions.json` generators/validators, plus `evaluateVideoExportCapability`.
  - `adapters.ts`: Concrete adapter implementations for `capcut`, `alight-motion`, `node-video`, `kinemaster`, `universal-bundle`, and `sowveil-project`.
- **Backend API (`server.ts` & `src/server/apiApp.ts`)**: Express server running on port 3000 providing `/api/v1/*` routes, server-side token verification, role-based access control (`user`, `admin`, `owner`), rate limiting, export quota enforcement, and redacted audit/diagnostic logging.
- **Database & Auth**: Firebase Authentication (Google Sign-In) and Cloud Firestore (`firestore.rules` + `firebase-applet-config.json`).

## 2. Key Route & Subsystem Map
- `/` & `/m/:moduleId`: Mobile-first creative studio across all 20 modules.
- `Export & Open In` modal (`src/components/ExportOpenInModal.tsx`): 6-step mobile export workflow with capability disclosure, `"Why can't this be added directly?"` help drawer, Alight Motion XML subset matrix, FPS/duration/alpha/chroma-key controls, SHA-256 verification, and Android Web Share API handoff.
- `/technical`: Safe Technical Status & Diagnostics screen (`src/components/SecondaryAppPages.tsx`).
- `/admin/*`: Protected Admin Operations Console (`src/components/AdminConsoleWorkspace.tsx`).
