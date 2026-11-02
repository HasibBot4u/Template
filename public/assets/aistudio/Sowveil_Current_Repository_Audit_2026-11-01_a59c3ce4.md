# Sowveil Studio — Current Repository, UI and Open-Source Integration Audit

**Review date:** 1 November 2026  
**Repository:** https://github.com/HasibBot4u/Template  
**Branch reviewed:** `main` (GitHub raw source snapshots)  
**Review basis:** current source files exposed by GitHub, plus the two Android screenshots supplied in this conversation and the user's reference-video description.

> **Scope and honesty note:** This is a deep static source review of the files and functions identified below, not a claim that every line of the repository was executed. I could not run the current branch, install dependencies, access a live deployment, or execute browser/device tests in this environment. No pixel-difference score is claimed. GitHub `main` can change while being reviewed; before the next edit, the coding agent must record the exact HEAD commit SHA and use that same SHA for the whole audit/patch. Several repository names in the user's list do not include exact URLs, so those entries cannot be uniquely audited or safely incorporated until the canonical URLs are supplied.

---

## 1. Executive decision

The project has made real progress: it now contains a server-side Firestore Admin driver, a server persistence-adapter initializer, a canonical project/timeline model, a real live AI-provider orchestration function and route, a set of editor workspaces, and a Landscape Studio component. The correct next move is **not** to replace the repository or import dozens of editors. It is to consolidate the editing experience, correct false functionality, and make the mobile layout genuinely responsive.

The immediate blockers are:

1. The Landscape Studio's fixed-width sidebars collapse the central preview on narrow phone viewports.
2. The Landscape Studio is a second, partly independent editor rather than a responsive shell over the same canonical editing engine used by Editing Studio.
3. The Landscape Studio starts a generated starter project rather than loading a chosen existing project; the route does not pass `initialProject`, and the component does not use its `projects` prop to select a project.
4. Its Save callback persists a metadata-shaped `ProjectLibraryItem`, not the full edited `CanonicalProjectDocument`; it even reports a fixed 1 KB file size.
5. Its embedded AI Co-Director is a regex-based simulation with a delay, not the authenticated live AI Director.
6. The keyframe button only shows a toast. Easing cards are decorative. The timeline has selection and click-to-scrub but no actual clip drag/trim handlers in this component.
7. The Landscape Studio template source is still `SEED_CATALOG_ITEMS`, so newly published dynamic templates are not automatically available there.
8. The full AI Director has a real live-orchestration endpoint, but its App route does not pass `authToken` or `getAuthToken`; the component's token resolver returns `null` in that configuration.
9. The normal `/produce` endpoint calls the deterministic project compiler. Live model orchestration is a separate action and is not automatically the same as generating the final project.
10. The renderer has a real SVG timeline compositor for some supported layers, but PNG/JPEG generation in the render-job path uses separate procedural still generators rather than rasterizing the compositor SVG. Final MP4/WebM still requires a configured render worker.

The most important architecture rule is: **one canonical project document, one typed editing-command service, one asset model, one AI tool gateway, and one renderer contract.** Marketplace, AI Director, Landscape Studio, Editing Studio and export must all manipulate that same project.

---

## 2. Screenshot analysis: why the preview disappears

### 2.1 What the screenshots prove

Both supplied screenshots show the app inside a portrait Android Chrome/AI Studio preview viewport. The app header itself displays `LANDSCAPE`, but the visible app content remains tall and narrow. The global workspace switcher in the first screenshot also covers much of the editing surface.

The code explains the collapse:

- The main work area is a fixed three-column flex layout: marketplace sidebar, center preview, right-side inspector/director.
- The left sidebar uses `w-64 sm:w-72 lg:w-80` while open (256 CSS px at the smallest breakpoint).
- The right sidebar uses `w-72 sm:w-80 lg:w-96` while open (288 CSS px at the smallest breakpoint).
- Both sidebars are `shrink-0`; the central preview is `flex-1 min-w-0`. On a narrow viewport, the two fixed sidebars can demand more width than exists, leaving the center preview too small to use.
- The expanded timeline uses a fixed `h-52 sm:h-60` (208–240 CSS px), which is a large fraction of a phone's landscape height and an even larger fraction of a short portrait viewport.

Source references:
- `src/components/LandscapeCreativeStudio.tsx`, left sidebar: `w-64 sm:w-72 lg:w-80`.
- Same file, right panel: `w-72 sm:w-80 lg:w-96`.
- Same file, bottom timeline: `h-52 sm:h-60`.
- Same file, main area: three-column sidebar/canvas/inspector structure.

### 2.2 Required responsive behavior

Do not solve this by shrinking every text label and panel. Use three deliberate layout modes based on actual CSS viewport/container dimensions:

**Desktop / wide landscape (large available width)**
- Three-column workspace is allowed: left template browser, central preview, right contextual panel.
- Reserve a minimum useful width for the preview; never let sidebars consume it.
- Keep timeline resizable and docked below the preview.

**Android phone landscape**
- Center preview is the permanent primary surface.
- Marketplace becomes a left drawer that is closed by default; open it as an overlay or temporary dock.
- AI Director / Inspector / Effects / Animation / Assets share one right drawer or tabbed sheet; never render the full-width marketplace and right panel at the same time if that would collapse the preview.
- Timeline is compact/resizable (target approximately 100–150 CSS px by default, with a collapsed strip and expand gesture); its height must adapt to `100dvh` and safe areas.
- Module strip scrolls horizontally and can collapse to an icon/menu; it must not consume the preview width.
- Use touch-first 44px minimum targets for important actions where practical, without making the visual density desktop-like.

**Android phone portrait**
- Do not force a fake desktop three-column layout.
- Use a single primary pane with navigation tabs or a compact bottom dock: Marketplace, Preview/Editor, AI Director, Projects, More.
- Properties and effects open in bottom sheets or full-height drawers.
- The preview gets a dedicated screen and must never disappear behind two permanent sidebars.
- Timeline is a compact horizontally scrollable panel with a full-screen/expanded editing mode.

Additional responsive requirements:
- Detect the available CSS viewport, not the physical screenshot resolution and not a manually selected `LANDSCAPE` label.
- Only show an active landscape indicator when the actual viewport/container is landscape; offer an optional rotate-device hint, not a false state.
- Do not rely on `screen.orientation.lock()` as a prerequisite; it is not universally available or guaranteed in browser previews.
- Use `100dvh`/safe-area insets, `min-height: 0`, `min-width: 0`, container queries or carefully tested media queries, proper scroll containment, and z-index rules.
- Workspace switcher must be a compact responsive popover/drawer with outside-click and Escape dismissal, not a large overlay that permanently obscures the preview.
- Add UI tests at real CSS viewport sizes (e.g. narrow phone portrait, phone landscape, tablet and desktop). Do not infer layout correctness from one desktop screenshot.

---

## 3. LandscapeCreativeStudio source audit

Primary file: `src/components/LandscapeCreativeStudio.tsx` (2,277 lines in the reviewed raw snapshot).

### 3.1 It is not yet the unified editor

The component owns its own local `project` React state and editing handlers. The normal `/app/editor` route mounts a separate `EditingStudioWorkspace`. This creates two places where edits, selection, undo, preview and save can behave differently.

**Correction:** make one canonical editor core and one shared command service. `LandscapeCreativeStudio` should become a responsive shell/view over that core, or be retired in favour of a responsive `EditingStudioWorkspace` shell. Do not maintain two competing timelines.

### 3.2 Existing-project loading is missing

`LandscapeCreativeStudioProps` declares `initialProject`, but `App.tsx`'s `LandscapeStudioRouteWrapper` does not pass it. The component initializes with:

`initialProject || createSevenTrackStarterProject('Sowveil Mobile Campaign', '9:16')`

The wrapper passes `projects`, but the component does not use `projects.map(...)` or a selected project ID to load a project. This means opening Landscape Studio can create a new sample starter rather than opening the user's chosen existing canonical project.

**Correction:** route by project ID (`/app/studio/:projectId` or equivalent), load the full canonical project through the authoritative repository, pass it into the editor, and provide a deliberate New Project action. A Project Library metadata card is not the full canonical project.

### 3.3 Save is metadata-only and reports a fake size

`handleSave()` constructs a `ProjectLibraryItem` from the current project but sets `fileSizeBytes: 1024` and `fileSizeLabel: '1 KB'`. The `onSaveProject` callback receives that metadata record. It is not given the complete canonical timeline document, asset references, effect stacks, keyframes and source media state.

**Correction:** save the full canonical project through the authoritative project repository/command API. Save metadata as a derived index only. Calculate actual serialized size if it is shown. Success UI must wait for a confirmed durable save; otherwise show unsaved/error state.

### 3.4 Embedded AI Co-Director is simulated

`handleApplyAiPrompt()` explicitly says “Simulate transactional AI reasoning”, waits 600 ms and uses string matching. It only handles a small set of terms such as title/launch, whoosh/SFX and emerald/color. Other prompts can receive a success notification saying the layers were optimized even when no actual command ran.

**Correction:** remove this fake path. The embedded Director must call the same authenticated AI Director service and typed canonical command gateway as the full Director. It should show proposed changes, preview/diff, affected clips, validation and approval before applying. If no model/provider is configured, report “AI not configured” rather than fake success.

### 3.5 Keyframe button is fake

The timeline toolbar keyframe control only calls `onNotify('Keyframe added at current playhead.')`. It does not insert a keyframe into the selected clip/property.

**Correction:** require a selected clip and selected animatable property; read the property's current value at the playhead; issue a typed `upsertKeyframe` command; update the canonical document; show a keyframe marker; support edit, move, delete, interpolation and easing.

### 3.6 Easing cards are decorative

The easing list renders `div` elements with cursor styling and SVG curves but no click handler or selected state.

**Correction:** every easing preset must apply to a selected keyframe segment/property through a canonical command; display active curve and allow custom curve editing where supported. Otherwise remove the fake cursor affordance.

### 3.7 Timeline interactions are incomplete

The component supports useful initial operations such as selecting clips, clicking the lane to move the playhead, split, duplicate, delete, mute and visibility toggles. However, no `onPointerDown`, `onMouseDown` or HTML `draggable` timeline gesture handler was found in this component.

**Missing professional timeline behavior:** touch/pointer drag-to-move, left/right trim handles, snap guides, ripple/insert/overwrite mode, multi-select, group/ungroup, track reordering, track creation/deletion, clip lock, clip slip/slide, speed changes, markers, keyframe lane, waveforms and gesture cancellation.

**Correction:** use Pointer Events with pointer capture, a gesture state machine, snapping, constraints and undoable typed commands. Do not implement touch and mouse as separate inconsistent systems.

### 3.8 Assets tab is sample data, not the real asset manager

The Assets tab contains fixed examples such as `Cyberpunk Grid Gradient.mp4`, `Neon Horizon BGM.wav`, `Whoosh Hit SFX.wav` and a font. These are not evidence of an authoritative project asset library.

**Correction:** bind to a real per-project asset repository; show actual file status, previews, duration/dimensions, codec, waveform, source, license, missing/online/offline status and `Add to Track` operations. Every visible action must perform the action or be visibly disabled with a reason.

### 3.9 Marketplace catalogue is seed-only

The component imports `SEED_CATALOG_ITEMS` and filters that static array. Templates created/published later from Template Factory or Reference Lab will not necessarily show up inside the Landscape Studio picker.

**Correction:** consume the same authoritative catalogue query/cache as the main Marketplace. Include live user-owned templates, published templates, favorites, version/compatibility, source attribution and editability properties.

### 3.10 Preview is a partial compositor, not final media playback

The central area calls `renderCanonicalFrameSvg()` and evaluates timeline state. This is a useful foundation for vector/text previews. But video layers are not proven to be decoded and displayed as real media in this component; the screen includes procedural/fake treatment for some media/template/effect kinds.

**Correction:** render real image/video/audio assets, decode thumbnails or frame proxies, preserve color profiles where supported, and label unrendered kinds honestly. The preview must show the same evaluated canonical project that the final renderer receives.

### 3.11 Keyboard and accessibility

The UI labels shortcuts such as Ctrl+S, Ctrl+Z, Space, K, Home and End. Verify every shortcut has a real keyboard handler, does not fire while typing in an input, and has an accessible touch equivalent. The keyframe shortcut must use the same real keyframe command as the button.

### 3.12 State/undo consistency

Local undo/redo uses in-memory snapshots. That is acceptable as a prototype mechanism, but it must be moved behind the shared canonical command/history service so Landscape Studio, Editing Studio and AI edits share one history, checkpoint and dirty-state model. Do not let an AI operation bypass the user's undo stack.

---

## 4. Full AI Director audit

Relevant files:
- `src/components/AiDirectorWorkspace.tsx`
- `src/services/aiDirectorProductionEngine.ts`
- `src/server/apiApp.ts`
- `src/services/apiClient.ts`

### 4.1 A real live orchestration path exists

The service includes `orchestrateLiveAiDirectorSession()`, which resolves the selected/routed Provider Hub connection, invokes a provider adapter, records the actual contacted model/latency/usage and can attempt a configured fallback connection. The server exposes an authenticated `/api/v1/ai-director/sessions/:id/orchestrate-live` route.

This is progress. Do not delete it or replace it with a new agent framework blindly.

### 4.2 But normal production compilation is a different path

The `/api/v1/ai-director/sessions/:id/produce` route imports and calls `executeDirectorProductionPlan()` directly. That compiler is deterministic and builds canonical clips. The component has a separate `handleRunLiveOrchestration()` action for the live provider endpoint. Therefore, a user can successfully compile a deterministic plan without having used a live model to make the creative decisions.

**Correction:** clearly separate “Create deterministic baseline”, “Run AI analysis/planning”, “Approve director plan” and “Compile approved plan”. When a provider is configured, the normal Director workflow should call the chosen model for semantic analysis, visual direction and shot refinement; deterministic script segmentation and exact coverage calculation should remain as safety controls. Never label a deterministic fallback as Gemini/AI output.

### 4.3 Authentication props are not wired at the route

`AiDirectorWorkspace` supports `authToken` and `getAuthToken`; its `resolveToken()` returns `null` if neither is provided. The current App route supplies `userUid` and callbacks, but does not pass `authToken` or `getAuthToken`. Its authenticated API requests can therefore fail even though the component exists.

**Correction:** use the shared authenticated API client that resolves the currently signed-in Firebase user and refreshes the ID token. Test the component/route request headers; a server-only mocked token verifier is insufficient.

### 4.4 Save callbacks need durable failure handling

The App `upsertServerProject` callback catches and ignores Firestore upsert failures, then updates local project state anyway. A success toast or local list update must not be presented as proof of a durable project save.

**Correction:** await the authoritative write, verify returned project ID/revision, then update the UI. On failure, keep the project dirty and expose Retry/Save Locally/Export actions truthfully.

### 4.5 Director workflow requirements

The real Director needs these gates:
1. Full script ingest with stable segment IDs and exact source offsets.
2. Script coverage ledger that persists every original passage.
3. Clarification queue and user-approved defaults.
4. Production brief and shot-by-shot plan.
5. Asset/template retrieval with source/license/editability metadata.
6. Live model calls through Provider Hub with task routing, timeout, budgets and fallback.
7. Structured, schema-validated model output.
8. Approved canonical command operations; no free-form arbitrary code execution.
9. Plan revisions/checkpoints, locked choices and reversible changes.
10. A generated editable project that uses the exact same timeline core as manual editing.
11. Final coverage, continuity, missing-assets and output validation.

---

## 5. Renderer and export audit

Relevant file: `src/services/renderExportQaEngine.ts`.

### 5.1 Positive foundation

`renderCanonicalFrameSvg()` calls `evaluateProjectAtTimestamp()` and documents support for track order, transforms, cubic-bezier keyframes, text, vector geometry and blend modes. This is a useful starting point for a shared compositor.

### 5.2 PNG/JPEG generation does not use the composited SVG

The render job creates `svgFrameContent`, but the PNG and JPEG stills are generated separately through `generateValidPngStillBytes()` and `generateValidJpegFrameBytes()` using canvas/background/accent parameters. The actual rendered SVG content is not passed into these still generators. This means a valid PNG/JPEG file can still be a procedural color plate rather than the visual timeline composition.

**Correction:** rasterize the evaluated SVG/canvas/WebGL frame or use a deterministic renderer to produce the actual frame. Add image-diff tests with known text/vector/media layers.

### 5.3 Audio mixer has partial real-audio handling but synthetic fallback remains

The audio path contains logic to use available WAV preview data and to account for timeline position, gain/fades/mute/solo/automation. However, when project media is missing or no audio tracks exist it can create a short procedural soundbed. The clipping report also contains an artificial gain-based override. Do not call the resulting WAV or QA measurement a fully verified master mix without actual source assets and sample-based checks.

**Correction:** require resolved asset bytes or report a missing-media state. Render the full requested duration. Measure peak/RMS/clipping from the actual output PCM samples only. Never inject synthetic clip counts into QA telemetry.

### 5.4 MP4/WebM final rendering requires a real worker

The code has honest `needs-worker-setup` behavior. That is better than fake success. Keep it honest until a real worker is provisioned, secured, tested, monitored and able to produce a playable final artifact.

### 5.5 Required render design

- One evaluated canonical timeline is the source for preview and final rendering.
- Asset resolver fetches the original/derived asset and validates it.
- Frame renderer composites background, vector, text, raster, video, 3D, mask, transitions, effects and captions by supported feature.
- Audio mixer uses actual decoded media and automation.
- Encoder muxes actual video/audio streams and preserves timestamps, frame rate and dimensions.
- Final QA decodes the final file and validates visual/audio properties, not just project metadata.
- Unsupported effects produce a feature-loss report and user consent, not silent omission.
- Render jobs are queued, resumable, cancellable and durable.

---

## 6. Persistence and deployment findings: update from earlier audits

There is now a real server-side Firestore Admin driver in `src/server/firestoreAdminDriver.ts`. `server.ts` imports `initializeServerPersistenceAdapterFromEnv()` and passes the returned adapter into `createApiApp()`. The initializer selects a real Firestore driver for production/explicit Firestore mode, performs an async production-readiness check, and retains a local snapshot adapter for explicit development/test use.

This corrects the older statement that no Firestore Admin driver existed. The code foundation has improved.

However, source presence is not deployment verification. Confirm:
- The Firebase project ID and Firestore database ID match the project/database you actually own and use.
- `FIREBASE_PROJECT_ID`/`GOOGLE_CLOUD_PROJECT` and `FIRESTORE_DATABASE_ID` are not silently pointing at another project's default.
- Cloud Run or the chosen host has Application Default Credentials / workload identity with minimum required Firestore permissions.
- The Firestore Admin health probe succeeds against the intended database and test writes are cleaned up safely.
- Production startup refuses local snapshot mode as intended.
- Migration dry-run is backed by durable migration state and only becomes apply-ready when every precondition and record-parity check passes.
- The server and client do not become competing writers for the same entity.

The migration `canSafelyApply` value is computed from preconditions in the reviewed current file; do not repeat the old claim that it is hard-coded `true`. But the migration still requires real deployment/Emulator test evidence before applying it to valuable records.

### Recommended entity ownership

- **Canonical projects/timelines:** one server-mediated Firestore repository; client reads/writes through authenticated APIs or a well-defined repository adapter, but not conflicting direct/server stores.
- **AI Director sessions:** authoritative Firestore repository.
- **Reference Lab sessions:** authoritative Firestore repository; large extracted media/frames stored in object storage, not inline base64 docs.
- **Template Factory drafts:** authoritative Firestore repository.
- **Published catalog:** one catalog API/repository. Main Marketplace and Landscape Studio consume the same live query.
- **Provider connection metadata and encrypted credentials:** server-side repository + server-only credential vault. Never expose raw keys or vault ciphertexts to browser code.
- **Render jobs and job state:** authoritative durable job repository; binary artifacts in object storage when enabled.
- **Asset binaries:** object storage or user-owned on-device files with durable references and explicit availability states.
- **Local caches:** IndexedDB/localStorage only as caches/offline drafts, clearly marked unsynced and scoped by UID. They are not cloud persistence.

---

## 7. Open-source repository evaluation: what to use, study or avoid

The list should be managed as a curated compatibility registry, not a mass code import. A full desktop editor cannot simply become a React component, and an AI skill is not a media renderer. Before importing any code, pin the commit, inspect the exact LICENSE and third-party notices, generate an SBOM, scan dependencies, test it in a sandbox, and record platform/runtime requirements.

### 7.1 Highest-value candidates for Sowveil

| Project | Best role in Sowveil | Integration recommendation | Important constraint |
|---|---|---|---|
| [Concat](https://github.com/jub0t/concat) | Android-native editor candidate and agent-control API/MCP reference | Study its Android build, local GPU compositor, JSON-RPC/MCP actions and project behavior. Treat it as a later optional native Android companion or verified export destination, not a React dependency. | Beta; AGPL-3.0-or-later with plugin exception; bundled FFmpeg/Slint dependencies include GPL components. Review `LICENSE-EXCEPTIONS.md` and third-party notices before code reuse. |
| [OpenFilm](https://github.com/openfilm/openfilm) | Best conceptual model for agent-created editable scenes | Study its `film.html` / shot `frame(t)` model: every shot is deterministic and editable; adapt that idea into Sowveil's canonical scene/composition schema. | MIT code, but Studio/render setup expects Node, FFmpeg and headless Chromium; not a zero-dependency Android browser editor. |
| [HyperFrames](https://github.com/heygen-com/hyperframes) | Server-side HTML/CSS motion-graphics renderer | Strong candidate for a separate render-worker proof of concept: HTML/CSS/GSAP/Three/Lottie compositions rendered deterministically to video. | Apache-2.0. It is an agent-friendly renderer/composition framework, not a full manual NLE timeline. Requires server/browser rendering infrastructure. |
| [FilmCraft](https://github.com/storytold/filmcraft) | Candidate editing/rendering core to benchmark | Build a small WebAssembly/mobile browser proof of concept and compare timeline commands, preview performance and supported formats against Sowveil's canonical engine. | MIT or Apache-2.0 at repo level; bundled assets have separate attribution; target Android Chrome performance is unverified. |
| [MediaBunny](https://github.com/Vanilagy/mediabunny) | Browser-side media import/read/write/transcode layer | Evaluate for reading/probing source files, extracting metadata and supported codecs, simple trimming/conversion, and WebCodecs-based preview/export. | MPL-2.0; changing MPL source files and distributing the modified files triggers source-sharing obligations for those files. It is not a full compositor/NLE. |
| [Diffusion Studio Editor](https://github.com/diffusionstudio/editor) | Media asset/package/editor architecture reference | Study asset manifests, content hashes, probing/resolution, offline encoding and its media model; adapt concepts, not the whole Solid application. | MPL-2.0; it uses Solid/Vite and an app structure different from the current React app. Desktop assets have separate rights. |
| [OpenChatCut](https://github.com/0xsline/OpenChatCut) | Agent-to-timeline command design reference | Study its shared command layer, proposal/apply workflow, custom skills/MCP directory and true editability. Reimplement the compatible concepts in Sowveil's project-command API. | AGPL-3.0-or-later and desktop/Electron-oriented. Do not copy/merge code into a closed-source or differently licensed product without a deliberate AGPL compliance decision. Remotion licensing also needs review. |
| [OpenMontage](https://github.com/calesthio/OpenMontage) | Production-pipeline and skill-registry reference | Study pipeline selection, stage skills, review gates, asset research, budget/cost visibility and human approval workflow. Adapt ideas to typed Sowveil tools. | AGPL-3.0. Do not import its entire skills tree or codebase wholesale; individual assets and dependencies have separate licenses. |
| [FireRed-OpenStoryline](https://github.com/FireRedTeam/FireRed-OpenStoryline) | Workflow/skill orchestration reference | Study the workflow-skill-first pattern, approval gate, partial redo and capability-skill architecture. Verify its current license/dependency tree before code reuse. | Treat as architecture inspiration until the exact current license, runtime, model requirements and mobile compatibility are independently reviewed. |
| [Theatre.js](https://github.com/theatre-js/theatre) | Web motion-design sequencing | Evaluate `@theatre/core` for animation timelines and 3D/DOM/SVG choreography; do not automatically embed the studio package. | Core is Apache-2.0; the Studio package is AGPL-3.0. Current development is temporarily in a private repo according to its README. |

### 7.2 Useful processing tools and model runtimes

| Project | Best use | Limitation / caution |
|---|---|---|
| [FFmpeg](https://github.com/FFmpeg/FFmpeg) | Worker-side decode/encode, filters, muxing, transcode and audio/video processing | Build configuration affects licensing: most files are LGPL; enabling optional GPL parts changes obligations. Codec/patent and binary distribution review is separate. |
| [Auto-Editor](https://github.com/WyattBlue/auto-editor) | Worker-side silence detection, rough-cut suggestions and timeline export | A CLI/editor-automation tool, not a full video editor or mobile PWA library. |
| [WhisperX](https://github.com/m-bain/whisperX) | Word timestamps, alignment and diarization in an optional transcription worker | BSD-2 code; dependent models such as pyannote have their own model/data license terms. GPU/worker resources may be needed. |
| [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper) | Efficient server-side transcription | MIT; still requires model downloads and CPU/GPU memory. |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | Optional Android/on-device transcription experiment | MIT; benchmark model size, RAM, speed, battery and thermal impact on actual Android devices before shipping. |
| [Video2X](https://github.com/k4yt3x/video2x) | Optional heavy upscaling/frame interpolation worker | AGPL-3.0; GPU-heavy and not an appropriate default phone/browser dependency. |
| [AutoSubs](https://github.com/tmoroney/auto-subs) | Subtitle workflow and diarization architecture reference | MIT code, but optional MMS forced-alignment model weights are CC BY-NC 4.0; those weights are not safe to bundle for commercial use without permission. |
| [BackgroundRemover](https://github.com/nadermx/backgroundremover) | Background removal worker/optional tool | Python/PyTorch/FFmpeg dependencies; not lightweight browser-native processing. Model licenses must be checked separately. |
| [Remotion](https://www.remotion.dev/) | Alternative programmatic React composition renderer | Current automator pricing lists $0.01/render and a $100/month minimum for building automated video products; budget/license is a real constraint. HyperFrames may be more viable for a no-budget early worker. |

### 7.3 Established desktop editors: use as references, not direct mobile integrations

- [Shotcut](https://github.com/mltframework/shotcut): GPLv3 Qt/MLT desktop editor. Good reference for timeline/effects, not a browser drop-in.
- [Kdenlive](https://github.com/KDE/kdenlive): GPL-3.0 MLT/KDE desktop NLE. Its timeline/workflow is useful to study; the app is not a React component.
- [Flowblade](https://github.com/jliljebl/flowblade): desktop NLE; inspect runtime and license before any reuse.
- [Olive](https://github.com/olive-editor/olive): experimental desktop NLE; assess activity and stability before reliance.
- [OpenShot](https://github.com/OpenShot/openshot-qt): desktop UI; `libopenshot` is LGPL-3.0 and has a commercial licensing option. Its C++/Python/Ruby API is not a direct mobile web dependency.
- [Blender](https://github.com/blender/blender): GPL-3.0-or-later 3D/animation/video sequence environment; use only as an optional isolated worker or asset authoring tool, not as the core mobile application.
- [Natron](https://github.com/NatronGitHub/Natron): desktop node compositor; strong VFX reference, not a mobile web UI dependency.
- [Avidemux](https://github.com/mean00/avidemux2), [LosslessCut](https://github.com/mifi/lossless-cut), [Pitivi](https://gitlab.gnome.org/GNOME/pitivi), [GStreamer](https://gitlab.freedesktop.org/gstreamer/gstreamer), [MLT](https://github.com/mltframework/mlt): each is a distinct application/framework/runtime with native dependencies. Evaluate individually if a native/server worker is proposed.

### 7.4 Motion and subtitle libraries

- [OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO): useful timeline interchange representation, not a video renderer or full editable media engine. It can inform adapters but must not replace the richer Sowveil canonical project without loss analysis.
- [Motion Canvas](https://github.com/motion-canvas/motion-canvas), [Manim](https://github.com/ManimCommunity/manim), [Lottie Web](https://github.com/airbnb/lottie-web), [Glaxnimate](https://github.com/GlaxnimateOrg/Glaxnimate), [Synfig](https://github.com/synfig/synfig), [OpenToonz](https://github.com/opentoonz/opentoonz): useful for specific animation classes, but not all are lightweight/browser-native; use a renderer/asset export adapter rather than merging full desktop applications.
- [Aegisub](https://github.com/Aegisub/Aegisub), [Subtitle Edit](https://github.com/SubtitleEdit/subtitleedit), [FFsubsync](https://github.com/smacke/ffsubsync): subtitle styling/timing utilities; use as optional pipeline tools or inspiration.
- [Demucs](https://github.com/facebookresearch/demucs): archived upstream; use only after checking a maintained fork, model license and current dependencies.
- [Audacity](https://github.com/audacity/audacity), [OBS Studio](https://github.com/obsproject/obs-studio), [HandBrake](https://github.com/HandBrake/HandBrake), [Tdarr](https://github.com/HaveAGitGat/Tdarr), [MediaInfo](https://github.com/MediaArea/MediaInfo), [GPAC](https://github.com/gpac/gpac): supporting tools, not direct in-browser modules.

### 7.5 Repository names that are ambiguous in the supplied list

The following names were supplied without an exact GitHub URL or a unique canonical repository: Agentic Video Editor, Video ShotCraft (multiple possible matches/forks), CutCraft, AI YouTube Shorts Generator, Short Video Factory, VideoAgent, AutoCut, AutoClip, Video Subtitle Extractor, Video Subtitle Remover and generic Clip.js. Some names also overlap with distinct projects. Do not let an AI agent guess a repository and import it. Add the exact canonical URL and intended branch/commit first.

---

## 8. Recommended target architecture for Sowveil

### 8.1 One canonical project, multiple views

- `CanonicalProjectDocument` is the authoritative creative project.
- Marketplace inserts parameterized template instances into that project.
- AI Director proposes edits against that same project.
- Editing Studio and Landscape Studio show the same project and call the same command layer.
- Undo/redo, checkpoints, autosave and dirty state belong to that shared command/history system.
- Export consumes the same document and the same evaluated frame/track model.

### 8.2 One command bus for manual and AI edits

Typed actions should include, at minimum:
- create project / instantiate template
- add/remove/reorder track
- add/move/trim/split/duplicate/delete clip
- add/remove/edit keyframe
- change transform, text, color, font, mask, effect, transition or easing
- edit audio gain/fade/duck/automation
- attach/replace media asset
- change project settings/aspect ratio/frame rate
- create checkpoint / undo / redo / rollback

Every command must validate ownership, project revision, selected clip/track, supported property range and resulting canonical schema. AI output must be parsed into a typed command proposal, shown as a diff, approved according to autonomy mode and executed through the same command bus as manual edits.

### 8.3 AI tool gateway and skills

- Register tools with name, description, JSON schema, permissions, execution adapter, timeout, cost class, audit fields and rollback strategy.
- Provider models never receive raw vault secrets.
- Skills/repositories/websites are untrusted inputs. Parse their documentation as data; never let their instructions override the user's system policy.
- Import pipeline: URL/ref → pinned commit/version → license/notice scan → dependency/SBOM → static scan → sandbox test → capability manifest → user permission approval → enable/disable/rollback.
- A regex scan is not a code sandbox. Code execution must run in an isolated worker/container with least privilege, resource/network/file limits and no access to secrets by default.

### 8.4 Asset pipeline

Store metadata and binary media separately. Assets need stable IDs, content hashes, type, media metadata, source/provenance, license, ownership, generated/source status, storage URI, thumbnail/proxy URIs, availability, duration, dimensions, frame rate, codec, font info and dependency links.

### 8.5 Rendering strategy

Build a small proof-of-concept before choosing the permanent compositor:

1. Browser preview/compositor for text/vector/shape/low-cost graphics.
2. MediaBunny proof for browser media read/probe/codec capabilities.
3. HyperFrames + FFmpeg server-worker proof for deterministic animated 2D/HTML motion-graphics render.
4. FilmCraft WebAssembly proof on a real Android phone for heavier timeline/compositor feasibility.
5. Evaluate Concat separately as an optional native Android editor/agent integration target.

Do not integrate all engines into the runtime. Select one primary project/render contract and keep optional adapters behind stable interfaces.

---

## 9. Prioritized repair order

### P0 — Must fix before calling the editor functional
1. Responsive layout: keep the preview visible; collapse left/right panels on phone.
2. Unify Landscape Studio and Editing Studio onto one canonical editor core.
3. Load an actual project by ID; do not start a sample project silently.
4. Persist the full canonical project document, not just ProjectLibrary metadata.
5. Remove the fake embedded AI prompt simulation and false success.
6. Fix the main AI Director route to provide a real Firebase token callback.
7. Make the normal Director production workflow clearly distinguish deterministic compile from live AI planning.
8. Implement actual keyframe/easing actions and truthful enabled/disabled controls.

### P1 — Core product integrity
9. Timeline Pointer Events: drag/trim/snap/selection/undo/redo.
10. Real media pool and actual asset replacement/import.
11. Live marketplace query in Landscape Studio.
12. Shared project revision and server persistence across all workspaces.
13. Real frame compositor rasterized to PNG/JPEG and real audio master mix.
14. Queue/cancel/retry/resume and final MP4/WebM render worker.
15. Actual media ingestion in Reference Lab with measured vs inferred reporting.

### P2 — Extensible creative platform
16. Provider task routing with accurate capability evidence.
17. Repository/skill registry and secure extension sandbox.
18. Skill-driven template generator and AI Creations Library.
19. Mobile-editor format adapters tested against specific app versions.
20. Quality analysis, provenance/license checks and cost controls.

---

## 10. Acceptance criteria

A phase is not complete just because generated code exists or a green toast appears. Require real tests:

### UI
- At phone portrait, phone landscape, tablet portrait/landscape and desktop widths, preview canvas remains visible and usable.
- Sidebars switch to drawers/tabs when viewport is too small.
- Timeline can expand/collapse and does not consume the entire phone screen.
- No clipping, unreachable panels, global horizontal overflow, or modal obscuring the preview.
- Screenshot diff is performed against both the original reference-video frames and the approved landscape concept.

### Project/editor
- A Project Library project opens in Landscape Studio with the same canonical project ID and revision.
- A project edit changes the canonical document and survives refresh/reopen.
- A keyframe button creates a real keyframe; easing cards modify the real interpolation.
- Dragging a clip moves it; trimming changes its duration and start; undo/redo restores exact state.
- Save confirmation occurs only after authoritative persistence succeeds.

### AI
- AI Director API request carries a valid Firebase ID token.
- A real provider invocation is recorded with provider, requested model, actual contacted model, latency, status and sanitized token/usage evidence where available.
- With no provider configured, the UI says so and does not claim AI completion.
- Script coverage remains exact and every model-generated edit becomes a schema-validated canonical command proposal.
- AI edits and manual edits share the same undo/checkpoint history.

### Renderer
- PNG/JPEG output visually matches the actual composed timeline at the requested timestamp.
- Audio output has the requested duration and is mixed from real timeline assets.
- MP4/WebM is decoded after render; dimensions, duration, frame rate, audio streams and sync are verified.
- Missing/unsupported effects appear in feature-loss report; no silent omissions.

### Repository integrations
- Every installed extension has exact source URL, pinned commit/version, license/attribution, dependencies/SBOM, security scan, capability list and permissions.
- No executable repository code runs in the browser or accesses credentials without an isolated approved executor.
- Every imported repo can be disabled, removed and rolled back.

---

## 11. Recommended next action

Create a backup branch first. Then submit the **read-only current-commit audit prompt** from the separate repair prompt pack. After the agent records the exact HEAD SHA and confirms the actual current interfaces, submit the **Landscape UI rescue prompt**. That is the first visible change you should expect. Do not let the agent import all GitHub projects or replace the whole editor in one operation.
