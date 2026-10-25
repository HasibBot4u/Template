# Reference Gaps & Observable Discrepancies (`docs/REFERENCE_GAPS.md`)

## 1. Observable Facts from Reference Video (`Sowveil 2.3.0 · After Effects`)
- The panel header displays `SOWVEIL STUDIO` with a two-row 20-module icon/label selector (`Text Animation` through `Project Library`).
- The bottom bar displays connection telemetry (`Connected · No active comp` or `Disconnected · No active comp`) on the left and `Sowveil 2.3.0 · After Effects` on the right.
- Templates rendered by After Effects show a `Template` / `Your edits` toggle with the note: *"This template so rendered by After Effects. Change anything below to see your version."*

## 2. Documented Source Discrepancies
- **SaaS Effects Count Badge:** At 01:12–01:16, the filter pill reads `All 8` (`Depth Reveal 3`, `Cursor 3`, `Click 3`), which sums to **9** visible cards (`Depth Reveal 1–3`, `Cursor 1–3`, `Splash Click`, `Smoke Click`, `Dot Burst Click`). We store `referenceReportedCount: 8` alongside a `referenceDiscrepancyNote` and display actual stored counts on filter buttons.
- **Templates Search Placeholder:** The video frame at 01:17 displays `Search 39 templates` while specification notes reference `Search 20 templates`. Our search input dynamically displays the actual stored item count (`Search N seeded items…`) and records the reference count separately.
- **AI Model Switcher:** Located under `Ready-made` (00:15) and `Project Library`. Treated strictly as a motion-graphics composition template (`1080 × 1920 · 12s · 30 fps`), not an AI/LLM backend integration.

## 3. Proprietary Media & Bundled Assets
- The reference video previews pre-rendered 4K `.aep` compositions and local WAV files (`C:\Users\SOWVEIL\Documents\Sowveil\SFX Library`). In accordance with rule A.10, no proprietary artwork or audio is copied; original procedural CSS/SVG/Canvas previews are rendered in the browser and host-dependent items are honestly labelled `Needs setup` or `Disconnected`.
