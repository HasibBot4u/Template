# Sowveil Studio (`v2.4.0-canonical`)

Sowveil Studio is an Android/mobile-first full-stack web application and Progressive Web App (PWA) for procedural motion graphics, canonical multi-track timeline editing, rights-aware reference reconstruction, multi-provider AI Direction, reusable template derivation, and verified mobile editor export.

---

## 1. Core Product Architecture & Workspaces

1. **20-Module Reference Studio (`/` & `/app/:moduleId`)**:
   - Preserves all 20 observed reference modules (`displayOrder` 1–20: `Text Animation` 220, `Expressions` 12, `Easing` 26, `SFX` 60, `Ready-made`, `UI & SaaS`, `Liquid Glass`, `Carousel`, `Transitions`, `3D Models`, `Mockups`, `Logo Reveals`, `Backgrounds`, `Overlays & FX`, `Maps`, `SaaS Effects`, `Templates`, `Auto Captions`, `Downloader`, and `Project Library`).
   - Interactive procedural HTML5 Canvas / SVG / Web Audio previews, `Template` vs. `Your edits` variant instances (`TemplateVariantInstance`), and `Fork template` derivation.
2. **Canonical Editable Project Schema (`v2.0.0` — `src/types/canonicalProject.ts` & `src/services/canonicalProjectEngine.ts`)**:
   - Single versioned project graph (`2.0.0`) shared across Marketplace Templates, Manual Editing Studio, AI Director, Reference Lab, Template Factory, and Render/Export.
   - 36 typed commands executed through `CanonicalProjectStore` with preconditions, scene-lock guards (`LOCKED_SCENE`), change receipts (`ProjectCommandReceipt`), undo/redo stacks, and reversible checkpoints.
3. **Reference Lab (`/app/reference-lab` — `src/services/referenceLabEngine.ts`)**:
   - Rights-aware reference reconstruction with mandatory Usage Mode gate (`Authorized Reconstruction Mode` vs. `Reference-Inspired Mode`), local-only remote-upload cancellation, shot segmentation, per-property provenance (`Source-proven`, `Measured`, `Inferred`, `Generated approximation`, `Unknown`), side-by-side comparison, 7 correction tools, and `Reconstruction Fidelity Report`.
4. **AI Provider Hub, Capability Registry, Extensions & Tool Registry (`/app/provider-hub` — `src/services/providerHubEngine.ts`)**:
   - 7 distinct protocol adapters (`google-gemini`, `openai-chat-completions`, `openai-responses`, `anthropic-messages`, `openai-compatible-variant`, `azure-openai`, `custom-rest-adapter`).
   - AES-256-GCM encrypted server vault with AAD user/workspace/connection binding, key rotation/revocation, SSRF & redirect-hop validation, 14-capability verification registry, 8 task routing profiles, untrusted Extensions sandbox with rollback, and server-authorized Typed Tool Registry.
5. **AI Director Production Workspace (`/app/ai-director` — `src/services/aiDirectorProductionEngine.ts`)**:
   - 7-stage durable production state machine (`intake` → `analysis-coverage` → `questions-clarification` → `brief-shot-plan` → `production-execution` → `adaptive-refinement` → `acceptance-verified`).
   - Immutable script storage with SHA-256 verification, 4,000-char chunked offset-exact segmentation, repetition preservation, complete coverage ledger, 20-field Director Brief, 22-field Shot Plan, 4-tier asset ranking, canonical project compilation, and 10-point Acceptance Gate.
6. **Professional Mobile Editing Studio & Transactional AI Co-Editing (`/app/editor` — `src/components/EditingStudioWorkspace.tsx` & `src/services/coEditingEngine.ts`)**:
   - Progressive disclosure (`Quick Mode`, `Pro Mode`, `AI Co-Edit Mode`), mobile proxy preview selector (`1080p`, `540p`, `360p`), multi-track timeline, interactive SVG Cubic-Bezier Easing Curve Editor, Version Compare diff viewer, Missing Asset & Unsupported Feature recovery, and `AiCoEditTransaction` with selective per-operation accept/reject and 1-click rollback.
7. **Template Factory (`/app/template-factory` — `src/services/templateFactoryEngine.ts`)**:
   - 10-stage template derivation pipeline from scratch, canonical projects, Reference Lab sessions, or AI Director runs; extracts 9 editable parameter categories; content-hash & semantic similarity deduplication; 7-check Quality & Determinism Gate; and transparent consent-gated workspace preference signals.
8. **Canonical Render, Export, Mobile App Adapters & Final QA (`/app/render-export` — `src/services/renderExportQaEngine.ts`)**:
   - Separates `timeline-preview`, `proxy-render`, and `final-render`; tracks real work-unit progress; persists jobs durably with honest startup recovery (`interrupted-on-restart`); validates written binary/structural outputs (`PNG`, `WAV`, `SRT`, `VTT`, `JSON`, `XML`, `ZIP`); generates per-project `AdapterFeatureLossReport` across 6 mobile adapters (`sowveil-project`, `alight-motion`, `capcut`, `node-video`, `kinemaster`, `universal-bundle`); and enforces an 8-gate Final QA report.

---

## 2. Verification & Development Commands

```bash
npm run lint          # TypeScript static typecheck (tsc --noEmit)
npm run lint:rules    # Validate Firestore Security Rules (eslint firestore.rules)
npm test              # Run all 17 automated unit, security & integration test suites
npm run build         # Production Vite + PWA bundle build
npm start             # Start Express + Vite production server on port 3000
```

---

## 3. Documentation Index

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — System architecture, canonical schema, and route map.
- [`docs/SECURITY.md`](./docs/SECURITY.md) — Threat model, RBAC, IDOR isolation, SSRF, secret vault, extension sandbox, telemetry privacy, and residual risks.
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — Environment variables, model routing, supported browsers, migration, backup/recovery, and release runbook.
- [`docs/TESTING.md`](./docs/TESTING.md) — Automated test suite matrix and verification commands.
- [`docs/FEATURE_STATUS_MATRIX.md`](./docs/FEATURE_STATUS_MATRIX.md) — Living truth matrix of implemented, verified, and external-setup features.
- [`docs/PHASE_ACCEPTANCE_MATRIX.md`](./docs/PHASE_ACCEPTANCE_MATRIX.md) — Complete Phase 0–14 acceptance matrix, Part C 10-question evidence report, and Part D final checklist.
