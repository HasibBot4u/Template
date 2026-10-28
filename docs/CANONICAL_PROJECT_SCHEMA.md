# Sowveil Studio — Canonical Editable Project Schema (`v2.0.0`)

**Format Identifier:** `sowveil-canonical-project`  
**Schema Version:** `2.0.0`  
**Type Definitions:** `src/types/canonicalProject.ts`  
**Validator, Migrator & Command Engine:** `src/services/canonicalProjectEngine.ts`  
**Mobile Pro Timeline Editor UI:** `src/components/MobileProEditorModal.tsx`  
**Server Endpoints:**
- `GET /api/v1/projects/fixtures/canonical`
- `POST /api/v1/projects/migrate`
- `GET /api/v1/projects/:id/canonical`
- `POST /api/v1/projects/:id/commands`

---

## 1. Architectural Invariant: Single Shared Project Schema

All templates, template variants (`Your edits`), manual timeline interactions, AI Director commands, version history snapshots, render jobs, and mobile export adapters operate on a single canonical document model: `CanonicalProjectDocument` (`schemaVersion: '2.0.0'`).

There is **no separate AI project format** and **no disconnected manual editor format**. Both manual UI gestures (`actorKind: 'user'`) and AI Director tool executions (`actorKind: 'ai-director'`) dispatch typed `CanonicalProjectCommand` payloads through `executeProjectCommand()` / `CanonicalProjectStore.dispatch()`, producing auditable `ProjectCommandReceipt` records.

---

## 2. Schema Coverage & Capability Declaration

| Domain Area | Schema Path | Notes & Honesty Invariants |
|---|---|---|
| **Canvas, Timebase & Resolution** | `canvas: { width, height, aspectRatio, fps, timebaseTicksPerSec, durationSec, backgroundColorHex, pixelAspectRatio, safeAreaPreset }` | Supports `9:16`, `16:9`, `1:1`, `4:5`, `4:3`, `21:9` and custom resolutions up to `7680×7680`. |
| **Scenes & Script Segment Links** | `scenes[]: { id, title, orderIndex, startTimeSec, durationSec, scriptSegmentIds[], notes }` | Links timeline scenes directly to stable script segment IDs (`seg_001`, etc.) for whole-script coverage tracking. |
| **Ordered Multi-Track Timeline** | `tracks[]: { id, name, kind, orderIndex, visible, locked, muted, solo, blendMode, heightPx, clips[] }` | Supports `video`, `vector`, `text`, `audio`, `caption`, `template`, `effect`, and `camera3d` tracks. |
| **Clips, Source Ranges, Trims & Speed** | `clips[]: { id, trackId, sceneId, label, kind, startTimeSec, durationSec, sourceInSec, sourceOutSec, trimInSec, trimOutSec, speedMultiplier, ... }` | Enforces `durationSec > 0`, `sourceOutSec >= sourceInSec`, and non-negative trims. |
| **2D Transform** | `clip.transform: { position: {x,y,z?}, scale: {x,y,z?}, rotationDeg, anchor: {x,y}, opacity }` | Normalized coordinates (`position.x/y` in `0..1`, `anchor.x/y` in `0..1`, `opacity` in `0..1`). |
| **Keyframes & Interpolation** | `clip.keyframes[]: { id, property, timeOffsetSec, value, interpolation, cubicBezier }` | Supports `linear`, `hold`, `ease-in`, `ease-out`, `ease-in-out`, and `cubic-bezier([x1,y1,x2,y2])`. |
| **Effect Stack, Masks & Blend Modes** | `clip.effects[]`, `clip.masks[]`, `clip.blendMode` | Each effect declares `rendererSupport` (`supported`, `approximated`, `unsupported`) so unsupported shader passes are never faked. |
| **Transitions** | `clip.inTransition`, `clip.outTransition` | Supports `cut`, `cross-dissolve`, `dip-to-black`, `whip-pan`, `zoom-blur`, `glitch-cut`, `iris-wipe`, `light-leak` with easing curves. |
| **Text & Vector Objects** | `clip.textData`, `clip.vectorData` | Full typography (`fontFamily`, `fontWeight`, `fontSizePx`, `lineHeight`, `letterSpacingEm`, `colorHex`, `strokeColorHex`, `shadowColorHex`, `shadowBlurPx`) and SVG/vector path geometry. |
| **Audio Clips, Gain & Fades** | `clip.audioConfig: { gainDb, linearGain, pan, fadeInSec, fadeOutSec, muted, solo, proceduralSfxPreset }` | Supports both asset-backed audio and Web Audio procedural synthesis (`proceduralSfxPreset`). |
| **Captions & Subtitles** | `clip.captionData: { cueIndex, text, speaker, stylePresetId, highlightColorHex, maxCharsPerLine, wordTimings[] }` | Integrates directly with Auto Captions (`Module 18`) and `.srt` / `.vtt` export adapters. |
| **Nested Templates & Overrides** | `clip.templateBinding: { baseTemplateId, baseTemplateVersion, variantId, moduleId, parameterOverrides, assetSlotBindings, editabilityLevel }` | Links `Template` vs. `Your edits` overrides (`full-source-graph`, `parameterized-rig`, `reconstructed-approximation`, `flattened-plate`). |
| **2D/3D Entities & Cameras** | `clip.entity3d`, `clip.camera3d` | Explicitly declares `rendererSupport` (`supported` vs. `approximated`) for mobile GPU budgets. |
| **Markers, Snapshots & Branches** | `markers[]`, `snapshots[]`, `branches[]`, `revision`, `activeBranch` | Reversible checkpoints (`createSnapshot`, `restoreSnapshot`) and named branches (`createBranch`). |
| **Provenance, AI Edits & Unknown Fields** | `provenance`, `aiEditHistory[]`, `unsupportedFeatures[]`, `unknownProperties` | Preserves forward-compatible top-level and clip-level unknown JSON keys across load/validate/save round-trips. |

---

## 3. Typed Command Service (`executeProjectCommand`)

Every manual or AI edit is executed as a typed command returning a `ProjectCommandReceipt`:

```ts
interface ProjectCommandReceipt {
  ok: boolean;
  commandType: CanonicalProjectCommand['type'];
  projectId: string;
  beforeRevision: number;
  revision: number;
  changedIds: string[];
  warnings: string[];
  errors: string[];
  undoRef: string | null;
  actorKind: 'user' | 'ai-director' | 'system-migrator';
  rationale?: string;
  timestamp: string;
}
```

### Supported Commands (28 Command Types)
1. `createTrack` — Adds an ordered track; rejects duplicate track IDs.
2. `setTrackState` — Updates track `name`, `visible`, `locked`, `muted`, `solo`, or `orderIndex`.
3. `createClip` — Inserts a validated clip into an unlocked track; rejects duplicate clip IDs or invalid durations.
4. `trimClip` — Adjusts `startTimeSec`, `durationSec`, `trimInSec`, `trimOutSec`, `sourceInSec`, `sourceOutSec` on unlocked clips.
5. `splitClip` — Splits a clip at `splitTimeSec` into two contiguous clips (`left` + `right`) with adjusted source ranges and keyframe offsets.
6. `moveClip` — Moves a clip to a new `startTimeSec` and optional `targetTrackId`.
7. `reorderClip` — Moves a clip across tracks (`targetTrackId`) or order index.
8. `deleteClip` — Removes an unlocked clip from its track.
9. `setTransform` — Updates `position`, `scale`, `rotationDeg`, `anchor`, or `opacity` (`0..1`).
10. `setTextProperties` — Updates `clip.textData` typography and copy.
11. `addKeyframe` — Adds a time-sorted keyframe on a `KeyframeableProperty` (`opacity`, `position.x`, `position.y`, `scale.x`, `scale.y`, `rotationDeg`, `audio.gainDb`, `effect.intensity`).
12. `updateKeyframe` — Updates `timeOffsetSec`, `value`, `interpolation`, or `cubicBezier` on an existing keyframe.
13. `removeKeyframe` — Deletes a keyframe by ID.
14. `addEffect` — Appends a visual/audio effect to `clip.effects` (logs warning if `rendererSupport !== 'supported'`).
15. `setEffectParameter` — Updates a typed parameter on an existing effect or toggles `enabled`.
16. `removeEffect` — Removes an effect from `clip.effects`.
17. `replaceAsset` — Binds a new `AssetLibraryRecord` ID to a clip or template asset slot (`assetSlotBindings`).
18. `insertTransition` — Attaches an `in` or `out` transition (`cross-dissolve`, `whip-pan`, etc.) to a clip.
19. `setGain` — Adjusts `gainDb` (`-60..+24 dB`, auto-computing `linearGain`), `fadeInSec`, `fadeOutSec`, or `muted`.
20. `alterCaption` — Updates `text`, `speaker`, `stylePresetId`, `highlightColorHex`, `startTimeSec`, or `durationSec` on a caption clip.
21. `instantiateTemplate` — Instantiates a catalog template + variant overrides as a `template` clip on the timeline.
22. `addMarker` — Adds a timeline marker (`chapter`, `beat`, `cue`, `script-anchor`, `warning`).
23. `removeMarker` — Removes a timeline marker by ID.
24. `renameProject` — Updates project `title` and optional `description`.
25. `updateCanvas` — Updates canvas dimensions, aspect ratio, FPS, duration, or background hex.
26. `createSnapshot` — Saves a reversible in-document snapshot (`CanonicalProjectSnapshot`).
27. `restoreSnapshot` — Restores project state from a saved snapshot ID while preserving snapshot history.
28. `createBranch` — Creates a named branch from the current or specified revision.

---

## 4. Schema Migration Rules (`migrateToCanonicalProject`)

| Source Format | Detection Rule | Migration Behavior |
|---|---|---|
| `sowveil-canonical-project` (`2.0.0`) | `format === 'sowveil-canonical-project' && schemaVersion === '2.0.0'` | Validated directly; unknown properties preserved in `unknownProperties`. |
| `sowveil-mobile-project` (`2.4.0-mobile`) | `format === 'sowveil-mobile-project'` | Upgrades `composition`, `parameters`, `motionRig`, and `compatibility` into a canonical `2.0.0` project with a template track, parameterized text/rig clip, and cubic-bezier keyframe curve. |
| Legacy `SowveilProjectDocument` (`1.0.0`) | `schemaVersion === '1.0.0'` or `timeline.tracks` array | Upgrades legacy `canvas`, `scenes`, `timeline.tracks`, `clips`, `captionCues`, `audioTracks`, `markers`, and `revisionHistory` into `CanonicalProjectDocument` (`2.0.0`). |
| `ProjectLibraryItem` wrapper | Object containing `canonicalProjectJson` or `sowveilSpecJson` | Unwraps inner JSON, runs migration, and syncs `title`, `description`, `revision`, and `activeBranch`. |

---

## 5. Seven Canonical Project Archetype Examples

All seven archetypes are programmatically generated and tested via `buildCanonicalProjectFixtures()` in `src/services/canonicalProjectEngine.ts` and exposed at `GET /api/v1/projects/fixtures/canonical`.

### 5.1 Minimal Project (`minimalProject`)
```json
{
  "schemaVersion": "2.0.0",
  "format": "sowveil-canonical-project",
  "id": "proj_fixture_minimal",
  "title": "Minimal Canonical Project",
  "description": "Single-scene 9:16 mobile project with one text track and one clip.",
  "ownerId": "owner_demo",
  "workspaceId": "ws_default",
  "revision": 1,
  "activeBranch": "main",
  "canvas": {
    "width": 1080,
    "height": 1920,
    "aspectRatio": "9:16",
    "fps": 60,
    "timebaseTicksPerSec": 600,
    "durationSec": 4,
    "backgroundColorHex": "#080707",
    "pixelAspectRatio": 1,
    "safeAreaPreset": "mobile-vertical-9x16"
  }
}
```

### 5.2 Multi-Track Project (`multiTrackProject`)
Contains 4 simultaneous ordered tracks (`track_bg` vector background plate, `track_main` headline text layer, `track_captions` subtitle cue layer, and `track_audio` SFX bed) across 2 script-linked scenes (`scene_intro`, `scene_cta`).

### 5.3 Template Instance with Overrides (`templateInstanceProject`)
Binds a catalog template (`baseTemplateId: "text-animation-001"`, `variantId: "var_custom_orange"`) with `parameterOverrides` (`headlineText`, `accentColor`, `speed`, `glowIntensity`) and `assetSlotBindings` (`logo_slot: "asset_brand_svg"`).

### 5.4 Keyframe Animation Project (`keyframeAnimationProject`)
Demonstrates multi-point keyframe curves on `opacity`, `scale.x`, `scale.y`, and `position.y` using `ease-out`, `cubic-bezier([0.22, 1, 0.36, 1])`, and `ease-in-out` interpolation evaluated continuously via `evaluateProjectAtTime(project, timeSec)`.

### 5.5 Effect Stack Project (`effectStackProject`)
Demonstrates a clip with an ordered stack of 3 effects (`glow`, `gaussian-blur`, and an approximated `chromatic-aberration` shader pass with `rendererSupport: "approximated"`), plus a normalized rectangle `mask`.

### 5.6 Caption & Subtitle Project (`captionProject`)
Demonstrates timed `caption` clips with speaker attribution (`speaker: "Narrator"`), word-level karaoke timings (`wordTimings[]`), and `maxCharsPerLine: 32` constraints.

### 5.7 Audio Clip Project (`audioClipProject`)
Demonstrates an `audio` track clip with calibrated `gainDb: -3.5`, `linearGain: 0.668`, `fadeInSec: 0.25`, `fadeOutSec: 0.6`, `proceduralSfxPreset: "whoosh-sub"`, and gain automation keyframes.
