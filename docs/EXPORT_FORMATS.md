# Sowveil Studio — Export Formats & Validation Specifications (`docs/EXPORT_FORMATS.md`)

All export strategies are implemented in `src/features/editor-gateway/strategies.ts` and validated by Zod schemas in `src/features/editor-gateway/schemas.ts`.

## 1. Supported Output Formats

1. **Portable Sowveil MotionDocument (`.sowveil.json`)**
   - **Schema**: `MotionDocumentSchema` (`schemaVersion: "2.0.0"`).
   - **Contents**: Composition dimensions (`9:16` 1080×1920, `1:1` 1080×1080, `16:9` 1920×1080), FPS (`24`/`30`/`60`), duration, background/alpha mode (`solid`, `transparent`, `chroma-key-green`), editable parameters, cubic-bezier easing handles, typed layers, asset descriptors, and audio references.
   - **Forward Compatibility**: `parsePortableMotionDocument()` preserves unknown top-level and layer fields in `unknownFields` so newer document versions never crash older readers.

2. **Universal & App-Specific Media Bundle (`.zip`)**
   - **Container**: Standards-compliant PKZIP archive (`PK\x03\x04` local headers, CRC32 checksums, `PK\x01\x02` central directory, `PK\x05\x06` EOCD).
   - **Required Manifest (`manifest.json`)**: Validated against `AssetBundleManifestSchema` (`bundleVersion: "2.0.0"`), recording every file's MIME type, role, byte size, 64-character SHA-256 hex digest, 8-character CRC32 hex digest, license, and origin.
   - **Included Assets**:
     - `manifest.json` (`AssetBundleManifest`)
     - `<slug>-<ratio>.sowveil.json` (`MotionDocument`)
     - `<slug>-<ratio>.svg` (Sanitized vector motion plate)
     - `<slug>-<ratio>.png` (Standards-compliant RGBA PNG still graphic)
     - `curve-sheet.json` (4-point cubic-bezier spline sheet for Node Video / manual keyframe editors)
     - `<slug>-<ratio>-alight.xml` (Included when module is in the tested Alight Motion XML subset)
     - `<slug>.wav` (Included for audio/SFX presets)
     - `<slug>-captions.srt` (Included for caption presets and KineMaster/CapCut bundles)
     - `IMPORT_STEPS.txt` (Step-by-step mobile import instructions and version caveats)

3. **Sanitized Vector Motion Plate (`.svg`)**
   - **Sanitization**: `sanitizeSvgContent()` strips `<script>`, `<foreignObject>`, inline `on*` event attributes (`onload`, `onerror`, `onclick`), `javascript:` URIs, and external `http(s)://` references in `href`/`xlink:href`.

4. **RGBA Still Graphic Plate (`.png`)**
   - **Generation**: `generateValidPngStillBytes()` constructs a valid 8-bit RGBA PNG (`\x89PNG\r\n\x1a\n`, `IHDR`, zlib-wrapped `IDAT` with Adler-32, and `IEND` with CRC32) supporting `solid` (`#080707`), `transparent` (alpha 0), or `chroma-key-green` (`#00FF00`) backgrounds.

5. **16-Bit PCM Audio (`.wav`)**
   - **Generation**: `generateProceduralSfxWav()` outputs a 22,050 Hz mono 16-bit PCM RIFF/WAVE binary verified by `validateWavBytes()`.

6. **Subtitles & Timed Captions (`.srt`, `.vtt`, `.captions.json`)**
   - **Generators**: `generateSrtFromCues()`, `generateVttFromCues()`, `generateJsonCaptionsFromCues()`.
   - **Round-Trip Parser & Validators**: `parseSrtOrVttToCues()`, `validateSrtContent()`, `validateVttContent()` verify monotonic cue numbering, `HH:MM:SS,mmm --> HH:MM:SS,mmm` (or `.mmm` for WebVTT) timestamps, `endSec > startSec`, and non-empty text.

7. **Alight Motion XML Scene (`.xml`)**
   - **Serializer & Inspector**: `serializeAlightMotionXml()` and `validateAndInspectAlightMotionXml()` in `src/features/editor-gateway/alightMotionXml.ts`.
   - **Security**: Escapes all user-supplied text attributes/content and rejects `<!DOCTYPE` / `<!ENTITY` (XXE) or `<script>` constructs.

8. **Rendered Video Guard (`evaluateVideoExportCapability`)**
   - Strictly refuses to write WebM bytes into an `.mp4` filename.
   - Never promises alpha transparency in H.264 MP4; recommends `chroma-key-green` (`#00FF00`) or transparent SVG/PNG plates.

9. **Auto Captions Sidecar Bundle (`buildCaptionSidecarZipBundle`)**
   - Packages validated `.srt`, `.vtt`, `.captions.json`, and `MOBILE_IMPORT_GUIDE.txt` into a standards-compliant PKZIP archive (`PK\x03\x04`) tailored to the selected mobile editor (`capcut`, `alight-motion`, `node-video`, `kinemaster`, `universal-bundle`).

10. **glTF 2.0 / `.glb` Header Validation & Honest Output Size Estimation**
   - `validateGltfOrGlbHeaderBytes()` verifies binary `.glb` (`0x46546C67` magic + version `2`) and JSON `.gltf` (`asset.version === "2.0"`).
   - `estimateMediaOutputSize()` computes exact byte sizes for deterministic formats (e.g., 16-bit PCM WAV) and returns `"Size not available until rendered"` (`calculable: false`) when compressed video/image output size cannot be known prior to encoding.

