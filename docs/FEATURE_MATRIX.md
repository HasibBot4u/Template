# Sowveil Studio — Complete 20-Module × 5-Editor Compatibility Matrix

This document provides the exhaustive interoperability matrix across all **20 creative & utility modules** and the **5 supported mobile destination targets**.

Status Taxonomy:
- `Verified`: Formats, serializers, and schemas validated by automated unit tests and schema assertions.
- `Tested subset`: Specific feature subset validated (e.g. Alight Motion XML 2D transforms and shapes without expressions/audio).
- `Media handoff only`: Native timeline injection is unsupported by the app's public API; delivers clean alpha/chroma video plates or PNG/SVG/WAV assets.
- `Experimental`: Functional parser and generator available, awaiting wider ecosystem testing.
- `Needs setup`: Requires optional external cloud worker, server storage, or API credentials.
- `Needs device test`: Validated by simulated headless unit tests, awaiting on-device manual confirmation.
- `Blocked`: Direct timeline manipulation impossible due to sandbox/OS boundaries or absence of project import interface.
- `Not implemented`: Planned future capability.

---

## 20-Module × 5 Mobile Editor Comprehensive Matrix

| Module | Sowveil Preview | Editable Sowveil Project | Generated Output Types | CapCut Status | Alight Motion Status | Node Video Status | KineMaster Status | Other Editor Fallback | Limitations / Evidence | Automated Test Status | Real-Device Verification Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Text Animation** (`text-animation`) | `Verified` (SVG/CSS) | `Verified` (`.sowveil.json`) | `.sowveil.json`, `.zip`, `.svg`, `.png` | `Media handoff only` | `Tested subset` (XML text layer) | `Media handoff only` | `Media handoff only` | `Verified` (`.zip` bundle) | CapCut/Node Video lack project import APIs; transparent plates required. | `Verified` | `Tested subset` |
| **2. Easing Curves** (`easing-curves`) | `Verified` (Interactive Bezier) | `Verified` (`.sowveil.json`) | `.sowveil.json`, `.zip`, `.svg` | `Media handoff only` | `Tested subset` (XML Bezier tags) | `Media handoff only` | `Media handoff only` | `Verified` (`.zip` bundle) | Keyframe timing exported in Alight Motion XML curve attributes. | `Verified` | `Tested subset` |
| **3. Expressions** (`expressions`) | `Verified` (12 Math Evaluators) | `Verified` (`.sowveil.json`) | `.sowveil.json`, `.zip`, `.svg` | `Media handoff only` | `Media handoff only` (Pre-baked) | `Media handoff only` | `Media handoff only` | `Verified` (`.zip` bundle) | Mobile editors lack runtime JavaScript/expression evaluators; baked to frames. | `Verified` | `Tested subset` |
| **4. SFX & Audio** (`sfx`) | `Verified` (Web Audio + Waveform) | `Verified` (`.sowveil.json`) | `.wav`, `.sowveil.json`, `.zip` | `Media handoff only` (Audio import) | `Media handoff only` (Audio layer) | `Media handoff only` (Audio layer) | `Media handoff only` (Audio layer) | `Verified` (`.wav` RIFF) | Real 16-bit 22.05 kHz PCM synthesis; imported as standard audio tracks. | `Verified` | `Verified` |
| **5. Transitions** (`transitions`) | `Verified` (Canvas/SVG) | `Verified` (`.sowveil.json`) | `.sowveil.json`, `.zip`, `.svg`, `.png` | `Media handoff only` | `Tested subset` (Shape wipe XML) | `Media handoff only` | `Media handoff only` | `Verified` (`.zip` bundle) | Matte transitions delivered as alpha video/still plates. | `Verified` | `Tested subset` |
| **6. UI Templates** (`ui-templates`) | `Verified` (Component Layout) | `Verified` (`.sowveil.json`) | `.sowveil.json`, `.zip`, `.svg`, `.png` | `Media handoff only` | `Tested subset` (Vector shapes XML) | `Media handoff only` | `Media handoff only` | `Verified` (`.zip` bundle) | Clean vector SVGs and hi-res device mockups bundled with manifest. | `Verified` | `Tested subset` |
| **7. Kinetic Typography** (`kinetic-typography`) | `Verified` (CSS Stagger) | `Verified` (`.sowveil.json`) | `.sowveil.json`, `.zip`, `.svg`, `.png` | `Media handoff only` | `Tested subset` (Text anim XML) | `Media handoff only` | `Media handoff only` | `Verified` (`.zip` bundle) | Complex multi-word cascading handled via procedural plates. | `Verified` | `Tested subset` |
| **8. Infographics** (`infographics`) | `Verified` (Dynamic Data Charts) | `Verified` (`.sowveil.json`) | `.sowveil.json`, `.zip`, `.svg`, `.png` | `Media handoff only` | `Tested subset` (Vector bar XML) | `Media handoff only` | `Media handoff only` | `Verified` (`.zip` bundle) | Numeric counters baked or exported as modular SVG components. | `Verified` | `Tested subset` |
| **9. Color Grades** (`color-grades`) | `Verified` (CSS Filter Matrix) | `Verified` (`.sowveil.json`) | `.sowveil.json`, `.zip`, `.png` | `Media handoff only` (Overlay LUT) | `Media handoff only` (Filter plate) | `Media handoff only` (Adjustment plate) | `Media handoff only` (Filter plate) | `Verified` (`.png` color plate) | Neutral LUT / reference grade plates provided in media sidecar. | `Verified` | `Needs device test` |
| **10. Lower Thirds** (`lower-thirds`) | `Verified` (Broadcast Plate) | `Verified` (`.sowveil.json`) | `.sowveil.json`, `.zip`, `.svg`, `.png` | `Media handoff only` | `Tested subset` (Text & box XML) | `Media handoff only` | `Media handoff only` | `Verified` (`.zip` bundle) | Standard lower-third plates support transparent or chroma green. | `Verified` | `Verified` |
| **11. Social Mockups** (`social-mockups`) | `Verified` (Phone UI Rig) | `Verified` (`.sowveil.json`) | `.sowveil.json`, `.zip`, `.svg`, `.png` | `Media handoff only` | `Tested subset` (Phone frame XML) | `Media handoff only` | `Media handoff only` | `Verified` (`.zip` bundle) | Transparent phone screen cutout allows inserting footage underneath. | `Verified` | `Verified` |
| **12. Backgrounds** (`backgrounds`) | `Verified` (Procedural Shader/SVG) | `Verified` (`.sowveil.json`) | `.sowveil.json`, `.zip`, `.svg`, `.png` | `Media handoff only` | `Tested subset` (Gradient XML) | `Media handoff only` | `Media handoff only` | `Verified` (`.zip` bundle) | Seamless looping procedural motion graphics backgrounds. | `Verified` | `Verified` |
| **13. Logo Reveals** (`logo-reveals`) | `Verified` (Vector Trace Reveal) | `Verified` (`.sowveil.json`) | `.sowveil.json`, `.zip`, `.svg`, `.png` | `Media handoff only` | `Tested subset` (Mask wipe XML) | `Media handoff only` | `Media handoff only` | `Verified` (`.zip` bundle) | Custom SVG user logo slot with animated alpha reveal plate. | `Verified` | `Tested subset` |
| **14. Motion Elements** (`motion-elements`) | `Verified` (Bursts & Accents) | `Verified` (`.sowveil.json`) | `.sowveil.json`, `.zip`, `.svg`, `.png` | `Media handoff only` | `Tested subset` (Vector shapes XML) | `Media handoff only` | `Media handoff only` | `Verified` (`.zip` bundle) | Geometric accents exportable as transparent SVG or RGBA PNGs. | `Verified` | `Verified` |
| **15. 3D Transforms** (`3d-transforms`) | `Verified` (CSS 3D Perspective) | `Verified` (`.sowveil.json`) | `.sowveil.json`, `.zip`, `.svg`, `.png` | `Media handoff only` | `Media handoff only` (Baked plate) | `Media handoff only` | `Media handoff only` | `Verified` (`.zip` bundle) | Full 3D cameras baked to motion plates due to editor XML limits. | `Verified` | `Tested subset` |
| **16. Visual Effects** (`visual-effects`) | `Verified` (Noise & Light Leaks) | `Verified` (`.sowveil.json`) | `.sowveil.json`, `.zip`, `.png` | `Media handoff only` (Overlay mode) | `Media handoff only` (Screen overlay) | `Media handoff only` (Screen overlay) | `Media handoff only` (Screen overlay) | `Verified` (`.zip` bundle) | Overlay graphics intended for "Screen" or "Add" blend modes. | `Verified` | `Verified` |
| **17. Callouts** (`callouts`) | `Verified` (Pointers & Targets) | `Verified` (`.sowveil.json`) | `.sowveil.json`, `.zip`, `.svg`, `.png` | `Media handoff only` | `Tested subset` (Lines & text XML) | `Media handoff only` | `Media handoff only` | `Verified` (`.zip` bundle) | Tracking targets and pointer lines with editable text labels. | `Verified` | `Tested subset` |
| **18. Auto Captions** (`auto-captions`) | `Verified` (Timed Cue List) | `Verified` (`.captions.json`) | `.srt`, `.vtt`, `.captions.json`, `.zip` | `Media handoff only` (SRT import) | `Media handoff only` (SRT import) | `Media handoff only` (SRT import) | `Media handoff only` (SRT import) | `Verified` (`.srt`/`.vtt`) | Full SubRip and WebVTT timed subtitles with sidecar ZIP. | `Verified` | `Verified` |
| **19. Downloader** (`downloader`) | `Verified` (SSRF/Magic Byte Check) | `Verified` (Metadata Record) | Media intake & verification | `Media handoff only` | `Media handoff only` | `Media handoff only` | `Media handoff only` | `Verified` (Direct file) | Validates MP4/WebM/WAV magic bytes; blocks SSRF/internal network IPs. | `Verified` | `Verified` |
| **20. Project Library** (`project-library`) | `Verified` (Firestore/Local) | `Verified` (Checkpoints & Specs) | `.sowveil.json`, project clone | `Media handoff only` | `Tested subset` (XML projects) | `Media handoff only` | `Media handoff only` | `Verified` (`.sowveil.json`) | Version history checkpoints, duplicate, and cloud synchronization. | `Verified` | `Verified` |

---

## Editor Adapter Capabilities Breakdown

1. **CapCut Mobile (Android & iOS)**:
   - *Status*: `Media handoff only`
   - *Supported Formats*: Universal Media Bundle (`.zip`), RGBA PNG Still Plates, WebM/MP4 Alpha Video, SubRip Subtitles (`.srt`).
   - *Native Project Import*: `Blocked` (CapCut proprietary draft format is encrypted and has no public developer import interface).
   - *Handoff Strategy*: Android Web Share API (`navigator.share({ files })`) with fallback to local ZIP download + step-by-step in-app import guide.

2. **Alight Motion (Android & iOS)**:
   - *Status*: `Tested subset`
   - *Supported Formats*: Alight Motion XML Project (`.xml`), Universal Media Bundle (`.zip`), Vector SVG Plates (`.svg`).
   - *Native Project Import*: `Supported` for 2D transforms (position, scale, rotation, opacity), shape layers, text typography, and cubic-bezier keyframes.
   - *Limitations*: 3D cameras, runtime JavaScript expressions, and complex procedural audio synthesizers are unsupported in Alight XML; Sowveil automatically flags these presets and recommends media bundle handoff.

3. **Node Video (Android & iOS)**:
   - *Status*: `Media handoff only`
   - *Supported Formats*: Universal Media Bundle (`.zip`), RGBA PNG with Transparency/Green Screen, 16-Bit PCM WAV Audio (`.wav`).
   - *Native Project Import*: `Blocked` (No documented XML or JSON project ingestion schema).
   - *Handoff Strategy*: Add as Overlay/Layer on the main timeline with Blend Mode "Normal" (for PNG/SVG) or "Screen" (for VFX).

4. **KineMaster (Android & iOS)**:
   - *Status*: `Media handoff only`
   - *Supported Formats*: Universal Media Bundle (`.zip`), RGBA PNG Plates, Chroma Key (`#00FF00`) Plates, Subtitles (`.srt`).
   - *Native Project Import*: `Blocked` (`.kine` format requires vendor cloud packaging).
   - *Handoff Strategy*: Handoff via Media Browser / Layer import.

5. **Universal Media Bundle & Sowveil Native**:
   - *Status*: `Verified`
   - *Supported Formats*: Sowveil MotionDocument (`.sowveil.json`), Universal Sidecar ZIP (`.zip`) with SHA-256 integrity manifest.
   - *Native Project Import*: `Verified` (100% lossless round-trip within Sowveil Studio).
