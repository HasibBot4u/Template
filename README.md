# Sowveil Studio

Sowveil Studio is a dark, production-oriented motion-design workspace and After Effects preset library inspired by the observable Sowveil 2.3.0 After Effects interface.

## Architecture Summary

1. **Browser UI (Available Now — Phase 1):**
   - 20 data-driven motion-design modules in exact reference order (`Text Animation` through `Project Library`).
   - Original CSS, SVG, and procedural previews (`PreviewRenderer`) with `Play`/`Pause`, `Restart`, and `Template` vs `Your edits` comparison for configurable templates.
   - Real stored item counts separated from documented `referenceReportedCount` badges.
   - Works meaningfully in disconnected mode on both desktop and mobile browsers.
2. **Cloud API & Firestore Persistence (Scheduled — Phase 3):**
   - Firebase Authentication (Google Sign-In), Cloud Firestore collections, security rules, and Express `/api/v1/*` routes.
3. **Desktop Companion & After Effects Host Bridge (Scheduled — Phase 5–6):**
   - Outbound-only local companion service (`packages/desktop-connector`) and ExtendScript host panel (`packages/ae-panel`) executing a narrow allowlist of 16 validated operations.
   - Optional local media tools (`Python`, `Whisper`, `FFmpeg`, `yt-dlp`, `Depth Anything V2`) verified locally with explicit user consent.

## Local Development

```bash
npm install
npm run dev
```

## Verification Commands

```bash
npm run lint
npm run build
```
