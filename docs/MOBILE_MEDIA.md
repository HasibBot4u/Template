# Sowveil Studio — Mobile Media Workflows, Rendering, Captions, Assets & Downloader (`docs/MOBILE_MEDIA.md`)

This document describes the Phase 6 mobile-first media workflows (`src/features/media-workflows/index.ts`, `src/components/PreviewRenderer.tsx`, `src/components/CatalogBrowserWorkspace.tsx`, `src/components/UtilityWorkspaces.tsx`, and `/api/v1/media/*` / `/api/v1/captions/*` / `/api/v1/jobs/*`).

---

## 1. Media Job Architecture & Honest Progress Tracking

1. **Owner-Scoped Persisted Job Lifecycle (`JobStatus`)**:
   - Every media workflow creates and transitions an owner-scoped `JobRecord` across honest states:
     `draft` → `queued` → `uploading` → `running` → `finalizing` → `ready` → `downloaded` (or terminal/blocked states `cancelled`, `failed`, `needs-setup`, `quota-reached`, `expired`).
2. **Deterministic Progress (`computeDeterministicJobProgress`)**:
   - Progress is calculated strictly from actual byte counts (`Math.round((processedBytes / totalBytes) * 100)`) or completed processing stages (`Math.round((completedStageIndex / totalStages) * 100)`).
   - Arbitrary `setInterval` timers are never used to fake job progress.
3. **Worker & Cost Gate (`evaluateMediaJobWorkerGate`)**:
   - When an operation requires a remote media worker (e.g., server-side Whisper ASR transcription, 4K H.264/HEVC encoding, or social URL stream extraction) and no worker is configured in the AI Studio environment, the job is transparently marked `needs-setup` (`Needs server worker setup`).
   - Users are explicitly informed that Cloud Run, Cloud Storage, AI APIs, or video rendering may incur charges and require owner configuration and quota approval.

---

## 2. Auto Captions (`AutoCaptionsWorkspace`)

1. **Step 1 — Source Selection**:
   - Select an audio/video file from the Android/mobile file picker (`.mp4`, `.webm`, `.wav`, `.mp3`, `.ogg`) with immediate magic-byte inspection (`verifyMediaMagicBytes`), or select an existing item from the user's Project Library.
   - Files larger than `10 MB` trigger an explicit privacy & retention disclosure before any remote upload is allowed.
   - Never claims *"Everything runs on this phone"* when using a remote transcription worker.
2. **Step 2 — Transcribe & Segment Settings**:
   - Supports `Auto detect` plus verified language codes (`en`, `es`, `fr`, `de`, `pt`, `ja`, `hi`, `ar`), processing tier (`Browser Manual / Local Cue Builder` vs. `Server ASR Worker — Needs server worker setup`), and configurable `Words per caption` (`1` to `10`, default `3`).
   - Also supports importing existing `.srt` or `.vtt` subtitle files directly from the phone.
3. **Step 3 — Touch-Friendly Timed Segment Editor & Validator**:
   - Edit cue text, speaker label, start time (`s`), and end time (`s`).
   - Touch actions for **Split (`÷2`)**, **Merge (`+Next`)**, and **Delete** on every timed segment, plus **Re-group by N words**.
   - Real-time `validateCaptionTimeline()` checks for monotonic timing (`endTimeSec > startTimeSec`), cue overlaps (`OVERLAP_WITH_PREVIOUS`), configurable maximum characters per line (`maxCharsPerLine`), and minimum/maximum cue duration (`minDurationSec`, `maxDurationSec`).
4. **Step 4 — Verified Subtitle & Sidecar Bundle Export**:
   - Exports parser-verified `.srt` (SubRip), `.vtt` (WebVTT), `.captions.json`, or a mobile editor sidecar `.zip` bundle (`buildCaptionSidecarZipBundle` / `POST /api/v1/captions/validate-and-bundle`) containing `.srt`, `.vtt`, `.captions.json`, and `MOBILE_IMPORT_GUIDE.txt`.

---

## 3. Mobile Motion Preview Engine & Module-Specific Authoring

1. **Interactive Timeline Scrubber & Mobile Battery Safeguards (`PreviewRenderer.tsx`)**:
   - Play/pause toggle, interactive `0.00s`–`duration` timeline scrubber, expandable `MotionDocument` scene/layer inspector, and mobile resolution selector (`0.5x Mobile`, `1x High`, `Still Safe`).
   - Automatically pauses playback on `document.visibilitychange` (`document.hidden`) and stops/cleans up Web Audio nodes on unmount.
2. **Module-Specific Capabilities**:
   - **Text Animation**: Font family selector (`Space Grotesk`, `Inter`, `JetBrains Mono`, `System Sans`) with `getFontFallbackNotice()` warning when a target mobile editor requires font installation or pre-rendered SVG/PNG plates; animation unit (`word`, `character`, `line`), alignment (`left`, `center`, `right`), entry/exit mode, background/alpha policy (`solid`, `transparent`, `chroma-key-green`), and accent fill color.
   - **Expressions**: Deterministic mathematical evaluator (`evaluateExpressionPresetMath`) across all 12 expression presets (inertial bounce, elastic spring, pendulum decay, posterize-time strobe, orbital loop, Perlin jitter, overshoot snap, squash & stretch, audio pulse, exponential decay, sine wave cascade, magnetic pull) with live `ΔX`, `ΔY`, `scale`, `rot` telemetry and honest export fallback disclosure.
   - **Easing**: Interactive cubic-bezier control point sliders (`X1`, `Y1`, `X2`, `Y2`) and animated curve sample dot across all 26 easing presets.
   - **SFX**: Real 44.1 kHz 16-bit PCM WAV synthesis (`generateProceduralSfxWavBytes`) + real PCM sample peak extraction (`extractWavWaveformPeaks`) + in-app Web Audio / WAV playback and volume control across all 60 SFX entries.
   - **3D Models & Maps**: glTF 2.0 / `.glb` binary header validator (`validateGltfOrGlbHeaderBytes`) with static poster fallback on mobile; original abstract vector route animations for Maps with zero paid Map API keys exposed.
   - **Project Library**: Editable `.sowveil.json` documents distinguished from rendered media, version history checkpoints (`+ Checkpoint` and `Restore`), duplicate project button, and honest cloud/local storage badge.

---

## 4. Downloader, Local File Inspector & SSRF Protection

1. **Modes**: `Video`, `Audio only`, `Thumbnail`, plus `Paste` and `Download` controls and a **Phone-Local File Import & Magic-Byte Inspector**.
2. **Strict SSRF Guard (`validateMediaUrlForSsrf` & `POST /api/v1/media/validate-url`)**:
   - Rejects non-`https:` protocols, embedded URL credentials, `localhost`, loopback (`127.0.0.0/8`, `::1`), RFC1918 private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`, `fe80::/10`), cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`), CGNAT (`100.64.0.0/10`), and IPv4-mapped IPv6 literals.
   - Social video URLs (YouTube, TikTok, Instagram, X, Vimeo) are never faked; they are marked `needs-setup` (`Needs server worker setup`) unless a remote extractor worker is configured.
3. **Magic-Byte Verification (`verifyMediaMagicBytes` & `POST /api/v1/media/inspect-bytes`)**:
   - Verifies binary headers (`ISO BMFF ftyp` for MP4/MOV, `EBML 1A 45 DF A3` for WebM/MKV, `RIFF/WAVE` for WAV, `ID3`/`FF FB` for MP3, `OggS` for Ogg, `\x89PNG` for PNG, `glTF` for GLB) and rejects disguised scripts or executables.
