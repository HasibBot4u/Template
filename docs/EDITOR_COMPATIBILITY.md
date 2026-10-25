# Sowveil Studio — Mobile Editor Compatibility Matrix (`docs/EDITOR_COMPATIBILITY.md`)

Sowveil Studio is an Android/mobile-first motion-design platform. It does **not** depend on Adobe After Effects, Premiere Pro, or a desktop companion app. Instead, it pairs its own native browser motion engine with the **Mobile Editor Interoperability Gateway** (`src/features/editor-gateway/`).

## 1. Core Interoperability Principle

A mobile video editor's internal project format is sandboxed by Android/iOS and is **not** a public third-party timeline manipulation API. Sowveil Studio strictly enforces honest capability disclosure:
- Never claims universal "direct timeline injection" into third-party mobile apps.
- Never fabricates fake project files by renaming `.zip` or `.json` archives to `.capcut` or `.kine`.
- Never labels a generic media ZIP as a `Node Video Project` (always labeled `Sowveil media bundle for Node Video`).
- Never writes WebM bytes into an `.mp4` filename or promises alpha transparency in H.264 MP4.

---

## 2. Destination Mobile Editor Adapters

| Adapter ID | Target App | Compatibility Status | Secondary Badge | Native Project Writing | Verified Export Outputs | Tested Versions |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `capcut` | **CapCut Mobile** | `Media handoff only` | `Verified` | Unsupported (No public `.capcut` writer or 3P timeline API) | `.zip`, `.svg`, `.png`, `.wav`, `.srt`, `.vtt` | CapCut Mobile v12.4+ (Android 13/14) |
| `alight-motion` | **Alight Motion** | `Tested subset` | `Needs target-app validation` | Supported for tested 2D XML subset (`.xml`, `amproj="4.0"`) | `.xml`, `.zip`, `.svg`, `.png`, `.wav`, `.sowveil.json` | Alight Motion v5.0+ |
| `node-video` | **Node Video** | `Media handoff only` | `Verified` | Unsupported (`Sowveil media bundle for Node Video`) | `.zip` (with `curve-sheet.json`), `.svg`, `.png`, `.wav`, `.sowveil.json` | Node Video v6.x+ |
| `kinemaster` | **KineMaster** | `Media handoff only` | `Needs target-app validation` | Disabled (`.kine` writer unverified; never faked) | `.zip`, `.srt`, `.vtt`, `.svg`, `.png`, `.wav` | KineMaster v7.4+ |
| `universal-bundle` | **Other Mobile Editor** (VN, InShot, LumaFusion) | `Verified` | `Verified` | N/A (Universal PKZIP asset & manifest bundle) | `.zip`, `.svg`, `.png`, `.wav`, `.srt`, `.vtt`, `.captions.json`, `.sowveil.json` | VN, InShot, LumaFusion, PowerDirector |
| `sowveil-project` | **Sowveil Only** | `Verified` | `Verified` | Supported (`.sowveil.json` v2.0 Portable MotionDocument) | `.sowveil.json`, `.zip`, `.svg`, `.png`, `.wav`, `.srt`, `.vtt`, `.captions.json` | Sowveil Studio v2.0 |

---

## 3. Alight Motion XML (`amproj="4.0"`) Tested Subset Matrix

Isolated in `src/features/editor-gateway/alightMotionXml.ts`:

| Feature / Construct | XML Element / Attribute | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Scene Aspect Ratio & Timing** | `<scene width="..." height="..." fps="..." totalTime="...">` | **Supported (Tested Subset)** | Supports `9:16` (1080×1920), `1:1` (1080×1080), and `16:9` (1920×1080). |
| **2D Transform Keyframes** | `<transform><location/><scale/><opacity/></transform>` | **Supported (Tested Subset)** | Normalized `t=[0..1]` keyframe progression. |
| **Cubic-Bezier Easing** | `e="cubicBezier x1 y1 x2 y2"` | **Supported (Tested Subset)** | Direct serialization of 4-point cubic-bezier handles. |
| **Editable Text Layers** | `<text><content>...</content><fillColor .../></text>` | **Supported (Tested Subset)** | Full XML entity escaping (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`) and XXE protection. |
| **Vector Rounded Rect Shapes** | `<shape s=".roundrect"><fill .../><property name="size" .../></shape>` | **Supported (Tested Subset)** | Safe-zone card & frame plates. |
| **AE JavaScript Expressions** | N/A | **Unsupported in XML** | Automatically falls back to `Generic media pack` (`.zip`). |
| **3D Meshes & Depth Shaders** | N/A | **Unsupported in XML** | Automatically falls back to `Generic media pack` (`.zip`). |
| **Embedded Multi-Track PCM Audio** | N/A | **Unsupported in XML** | Exported as standalone 16-bit PCM `.wav` or bundled in `.zip`. |

---

## 4. Phase 6 Typography, Expression & Subtitle Interoperability

- **Font Availability & Fallback (`getFontFallbackNotice`)**: Mobile editors (`CapCut`, `Alight Motion`, `Node Video`, `KineMaster`) do not automatically have custom web fonts (`Space Grotesk`, `Inter`, `JetBrains Mono`) installed. Sowveil Studio explicitly warns the user when a non-system font is selected and offers pre-rendered SVG/PNG text plates when exact glyph fidelity is required.
- **Expression Baking (`evaluateExpressionPresetMath`)**: After Effects JavaScript expressions are not natively executed by mobile editors; Sowveil Studio evaluates all 12 expression presets deterministically in-browser and exports baked keyframe samples (`curve-sheet.json` / `.sowveil.json`) plus visual overlay plates.
- **Subtitle Sidecars (`buildCaptionSidecarZipBundle`)**: Provides verified `.srt`, `.vtt`, and `.captions.json` tracks alongside `MOBILE_IMPORT_GUIDE.txt` for CapCut, Alight Motion, Node Video, and KineMaster.

