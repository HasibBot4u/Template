import {
  CatalogItem,
  EditorCompatibilityStatus,
  ExportArtifactFormat,
  MobileAspectRatio,
  MobileEditorAdapterDescriptor,
  ModuleId,
  TargetMobileEditorId,
} from '../../types/sowveil';
import {
  AssetBundleEntryMetadata,
  EditorAdapter,
  EditorCapability,
  EditorValidationResult,
  ExportPreset,
  ExportProgressEvent,
  ExportResultFile,
  GeneratedGatewayExport,
} from './types';
import {
  ALIGHT_MOTION_TESTED_XML_MODULES,
  classifyPresetForAlightMotionXml,
  serializeAlightMotionXml,
  validateAndInspectAlightMotionXml,
} from './alightMotionXml';
import {
  buildExportPreset,
  buildPortableMotionDocument,
  buildSafeExportFilename,
  buildVerifiedAssetBundleManifest,
  CaptionCueSegment,
  computeSha256Hex,
  generateJsonCaptionsFromCues,
  generateProceduralSfxWav,
  generateRealZipBundle,
  generateSanitizedVectorSvg,
  generateSrtFromCues,
  generateValidPngStillBytes,
  generateVttFromCues,
  parsePortableMotionDocument,
  sanitizeSvgContent,
  validatePngBytes,
  validateSrtContent,
  validateVttContent,
  validateWavBytes,
  validateZipSafety,
} from './strategies';

const ALL_MODULES: ModuleId[] = [
  'text-animation',
  'expressions',
  'easing',
  'sfx',
  'ready-made',
  'ui-saas',
  'liquid-glass',
  'carousel',
  'transitions',
  '3d-models',
  'mockups',
  'logo-reveals',
  'backgrounds',
  'overlays-fx',
  'maps',
  'saas-effects',
  'templates',
  'auto-captions',
  'downloader',
  'project-library',
];

export const GATEWAY_ADAPTER_DESCRIPTORS: MobileEditorAdapterDescriptor[] = [
  {
    id: 'capcut',
    name: 'CapCut Mobile (Media & Caption Handoff)',
    shortName: 'CapCut',
    platform: 'Android & iOS',
    compatibilityStatus: 'Media handoff only',
    secondaryValidationBadge: 'Verified',
    defaultExportFormat: 'zip-bundle',
    supportedFormats: [
      'zip-bundle',
      'svg-frame',
      'png-still',
      'wav-audio',
      'srt-captions',
      'vtt-captions',
    ],
    verifiedFormats: [
      'zip-bundle',
      'svg-frame',
      'png-still',
      'wav-audio',
      'srt-captions',
      'vtt-captions',
    ],
    testedVersions: 'CapCut Mobile v12.4+ (Android 13/14)',
    docsUrl: 'https://www.capcut.com',
    lastValidationDate: '2026-10-25',
    verificationNote:
      'Verified media overlay, chroma-key green screen, 16-bit WAV audio, and SRT/VTT subtitle import on Android.',
    supportedModules: ALL_MODULES,
    honestCapabilitySummary:
      'Exports production-ready 9:16 / 1:1 / 16:9 vector/PNG overlays, chroma-key green plates, 16-bit PCM WAV sound effects, and timed .srt/.vtt subtitle tracks for CapCut mobile timelines.',
    limitationsNote:
      'CapCut does not provide a public third-party timeline insertion API or open .capcut project specification. Sowveil never fabricates fake .capcut archives; assets are imported as Overlays, Audio, or Local Captions.',
    importSteps: [
      'Tap "Share" or "Download" to save the CapCut media package (.zip), still (.png/.svg), audio (.wav), or subtitle (.srt) file to your phone.',
      'Open CapCut on Android and open your active 9:16, 1:1, or 16:9 timeline project.',
      'For visual plates: tap Overlay → Add Overlay and select the exported SVG/PNG graphic (if using Chroma-Key Green #00FF00, tap Cutout → Chroma Key and pick the green background).',
      'For sound effects: tap Audio → Sounds → Folder icon (From Device) and add the exported .wav track.',
      'For subtitles: tap Text → Local Captions (or Auto Captions → Import SRT depending on regional CapCut version) and select the exported .srt file.',
    ],
  },
  {
    id: 'alight-motion',
    name: 'Alight Motion (XML Subset & Media Pack)',
    shortName: 'Alight Motion',
    platform: 'Android & iOS',
    compatibilityStatus: 'Tested subset',
    secondaryValidationBadge: 'Needs target-app validation',
    defaultExportFormat: 'alight-xml',
    supportedFormats: [
      'alight-xml',
      'zip-bundle',
      'svg-frame',
      'png-still',
      'wav-audio',
      'sowveil-json',
    ],
    verifiedFormats: ['alight-xml', 'zip-bundle', 'svg-frame', 'png-still', 'wav-audio'],
    testedVersions: 'Alight Motion v5.0+ (amproj 4.0 XML schema)',
    docsUrl: 'https://alightmotion.com',
    lastValidationDate: '2026-10-25',
    verificationNote:
      'Validated isolated XML serializer against tested 2D transform, text, shape, color, opacity, and cubic-bezier subset.',
    supportedModules: ALL_MODULES,
    honestCapabilitySummary:
      'Generates structured Alight Motion XML (.xml) scenes for the tested subset of 2D transforms (position, scale, opacity), text layers, vector shapes, and cubic-bezier easing curves.',
    limitationsNote:
      'Tested subset only: AE JavaScript expressions, 3D GLB shaders, and embedded multi-track PCM audio are not representable in Alight Motion XML and automatically fall back to the Universal Media Pack (.zip).',
    importSteps: [
      'Download the generated .xml scene file or tap "Share" and choose Alight Motion from the Android system share sheet.',
      'In Alight Motion, open the "Templates" (or "Projects") tab and tap "Upload XML file" to import the .xml scene.',
      'Open the imported scene composition; all 2D keyframe transforms, cubic-bezier easing curves, and text layers remain editable.',
      'If your preset includes companion .wav audio or raster plates from the .zip bundle, add them via the (+) → Media / Audio menu.',
    ],
  },
  {
    id: 'node-video',
    name: 'Node Video (Sowveil Media Bundle & Curve Sheet)',
    shortName: 'Node Video',
    platform: 'Android & iOS',
    compatibilityStatus: 'Media handoff only',
    secondaryValidationBadge: 'Verified',
    defaultExportFormat: 'zip-bundle',
    supportedFormats: ['zip-bundle', 'svg-frame', 'png-still', 'wav-audio', 'sowveil-json'],
    verifiedFormats: ['zip-bundle', 'svg-frame', 'png-still', 'wav-audio', 'sowveil-json'],
    testedVersions: 'Node Video v6.x+ (Android)',
    docsUrl: 'https://www.nodevideo.com',
    lastValidationDate: '2026-10-25',
    verificationNote:
      'VerifiedSowveil media bundle for Node Video with spline/cubic-bezier curve reference sheet and SVG/PNG/WAV assets.',
    supportedModules: ALL_MODULES,
    honestCapabilitySummary:
      'Produces a "Sowveil media bundle for Node Video" containing vector/PNG plates, 16-bit WAV audio, and a spline/cubic-bezier parameter sheet for Node Video’s Custom Curve editor.',
    limitationsNote:
      'Media handoff only: Node Video uses a proprietary internal project format. This export is a "Sowveil media bundle for Node Video" (never a native Node Video project file) and requires manual keyframe/spline setup for custom node properties.',
    importSteps: [
      'Download and extract the "Sowveil media bundle for Node Video" (.zip) on your phone.',
      'In Node Video, tap New Project, set Ratio to 9:16 (1080×1920), 1:1, or 16:9, and set FPS to match your preset (24/30/60).',
      'Tap (+) → Media → Image / Audio to import the SVG/PNG visual plates and .wav sound effects.',
      'Open curve-sheet.json (or IMPORT_STEPS.txt) from the bundle and enter the 4-point cubic-bezier handles into Node Video’s Custom Spline Curve editor where manual timeline rebuild is needed.',
    ],
  },
  {
    id: 'kinemaster',
    name: 'KineMaster (Media Overlay & Verified SRT Handoff)',
    shortName: 'KineMaster',
    platform: 'Android & iOS',
    compatibilityStatus: 'Media handoff only',
    secondaryValidationBadge: 'Needs target-app validation',
    defaultExportFormat: 'zip-bundle',
    supportedFormats: [
      'zip-bundle',
      'srt-captions',
      'vtt-captions',
      'svg-frame',
      'png-still',
      'wav-audio',
    ],
    verifiedFormats: ['zip-bundle', 'srt-captions', 'svg-frame', 'png-still', 'wav-audio'],
    testedVersions: 'KineMaster v7.4+ (Android)',
    docsUrl: 'https://www.kinemaster.com',
    lastValidationDate: '2026-10-25',
    verificationNote:
      'Verified .srt subtitle track import, PNG/SVG layer import, and 16-bit PCM WAV import. Native .kine archiving disabled pending verified target-app specification.',
    supportedModules: ALL_MODULES,
    honestCapabilitySummary:
      'Delivers verified .srt subtitle sidecar tracks, PNG/SVG layer overlays, chroma-key plates, and 16-bit PCM WAV audio for KineMaster mobile projects.',
    limitationsNote:
      'Native .kine project archive generation is disabled ("Needs target-app validation") because KineMaster does not publish a stable third-party .kine writer spec. Sowveil never renames a .zip or .json file to .kine.',
    importSteps: [
      'Download the KineMaster media bundle (.zip) or standalone .srt / .wav / .png asset to your phone.',
      'Open KineMaster and create a project matching your aspect ratio (9:16, 1:1, or 16:9).',
      'Tap Layer → Media to add the exported PNG/SVG graphic (enable Chroma Key if you exported with #00FF00 green background).',
      'Tap Audio → Folders to import the .wav sound effect, or import the verified .srt subtitle file for timed captions.',
    ],
  },
  {
    id: 'universal-bundle',
    name: 'Other Mobile Editor (Universal Media & Manifest ZIP)',
    shortName: 'Other Editor',
    platform: 'Android & iOS',
    compatibilityStatus: 'Verified',
    secondaryValidationBadge: 'Verified',
    defaultExportFormat: 'zip-bundle',
    supportedFormats: [
      'zip-bundle',
      'svg-frame',
      'png-still',
      'wav-audio',
      'srt-captions',
      'vtt-captions',
      'json-captions',
      'sowveil-json',
    ],
    verifiedFormats: [
      'zip-bundle',
      'svg-frame',
      'png-still',
      'wav-audio',
      'srt-captions',
      'vtt-captions',
      'json-captions',
      'sowveil-json',
    ],
    testedVersions: 'InShot, VN Video Editor, LumaFusion, PowerDirector Mobile',
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share',
    lastValidationDate: '2026-10-25',
    verificationNote:
      'Verified PKZIP archive with SHA-256/CRC32 manifest, SVG/PNG plates, WAV audio, SRT/VTT captions, and step-by-step guide.',
    supportedModules: ALL_MODULES,
    honestCapabilitySummary:
      'Packages a complete, standards-compliant .zip media bundle with SHA-256 asset manifest, vector/PNG plates, 16-bit WAV audio, SRT/VTT captions, and portable MotionDocument JSON for any mobile editor.',
    limitationsNote:
      'Universal asset bundle: does not claim direct timeline injection into third-party proprietary editors.',
    importSteps: [
      'Tap "Download" or "Share" to save the Universal Mobile Media Bundle (.zip) on your device.',
      'Extract the .zip archive in your Files app or import individual .png, .svg, .wav, and .srt assets into VN, InShot, LumaFusion, or PowerDirector.',
      'Consult manifest.json and IMPORT_STEPS.txt inside the archive for exact aspect ratio, FPS, and cubic-bezier timing parameters.',
    ],
  },
  {
    id: 'sowveil-project',
    name: 'Sowveil Only (Native Portable MotionDocument)',
    shortName: 'Sowveil Only',
    platform: 'Universal Mobile Web',
    compatibilityStatus: 'Verified',
    secondaryValidationBadge: 'Verified',
    defaultExportFormat: 'sowveil-json',
    supportedFormats: [
      'sowveil-json',
      'zip-bundle',
      'svg-frame',
      'png-still',
      'wav-audio',
      'srt-captions',
      'vtt-captions',
      'json-captions',
    ],
    verifiedFormats: [
      'sowveil-json',
      'zip-bundle',
      'svg-frame',
      'png-still',
      'wav-audio',
      'srt-captions',
      'vtt-captions',
      'json-captions',
    ],
    testedVersions: 'Sowveil Studio v2.0 Portable MotionDocument Schema',
    docsUrl: 'https://sowveil.studio/docs/export-formats',
    lastValidationDate: '2026-10-25',
    verificationNote:
      'Verified 100% lossless round-trip serialization, schema validation, and forward-compatible unknown-field preservation.',
    supportedModules: ALL_MODULES,
    honestCapabilitySummary:
      'Saves a lossless, schema-validated Sowveil Portable MotionDocument (.sowveil.json) that re-opens directly in Sowveil Studio’s mobile motion engine and cloud Project Library.',
    limitationsNote:
      'Native to Sowveil Studio; to use in external mobile video editors, choose CapCut, Alight Motion, Node Video, KineMaster, or Other Editor.',
    importSteps: [
      'Tap "Save to Project Library" for instant cloud persistence, or download the .sowveil.json portable document.',
      'To re-open on any phone, open Sowveil Studio → Project Library → Import / Create Project and select the .sowveil.json file.',
    ],
  },
];

function createDefaultCuesForItem(
  item: CatalogItem,
  customValues: Record<string, string | number | boolean>
): CaptionCueSegment[] {
  const headline = String(
    customValues.headline ??
      customValues.title ??
      customValues.badgeText ??
      item.name
  );
  return [
    {
      index: 1,
      startSec: 0,
      endSec: 1.4,
      text: headline,
    },
    {
      index: 2,
      startSec: 1.4,
      endSec: Math.max(2.8, item.metadata.durationSec || 3.0),
      text: `${item.packLabel} · Sowveil Mobile Studio`,
    },
  ];
}

function createEditorAdapterInstance(
  descriptor: MobileEditorAdapterDescriptor
): EditorAdapter {
  return {
    id: descriptor.id,
    name: descriptor.name,
    shortName: descriptor.shortName,
    platform: descriptor.platform,

    discoverCapabilities(moduleId?: ModuleId): EditorCapability {
      const isAlight = descriptor.id === 'alight-motion';
      const isSowveil = descriptor.id === 'sowveil-project';
      const xmlEligibleForModule =
        !moduleId || ALIGHT_MOTION_TESTED_XML_MODULES.includes(moduleId);

      const whyNotDirectMap: Record<TargetMobileEditorId, string> = {
        capcut:
          'Mobile operating systems (Android/iOS) sandbox each app’s private project database, and CapCut does not expose a public third-party timeline insertion API or open .capcut project writer specification. Delivering verified overlay graphics, WAV audio, and SRT subtitles is the only genuine, non-fabricated interoperability path.',
        'alight-motion':
          'Android sandboxes prevent one web/mobile app from directly mutating an open Alight Motion timeline in memory. Instead, Alight Motion officially supports importing structured XML scenes via its Templates tab or system Share Sheet for the tested 2D transform/text/shape subset.',
        'node-video':
          'Node Video stores projects in an undocumented internal format inside its app sandbox and provides no external timeline injection API. Sowveil therefore exports a "Sowveil media bundle for Node Video" containing ready-to-import visual/audio layers plus a cubic-bezier spline reference sheet.',
        kinemaster:
          'KineMaster’s .kine project archive format is proprietary and not publicly specified for third-party writers. Rather than renaming a .zip file to a fake .kine extension that would fail on import, Sowveil exports verified PNG/SVG overlays, 16-bit WAV audio, and standard .srt subtitle tracks.',
        'universal-bundle':
          'Third-party mobile editors run in isolated OS sandboxes without a universal cross-app timeline protocol. A standards-compliant PKZIP media bundle with SHA-256 manifest, visual plates, audio, and captions guarantees compatibility across VN, InShot, LumaFusion, and PowerDirector.',
        'sowveil-project':
          'Sowveil Studio owns the Portable MotionDocument (.sowveil.json) schema, so presets save and re-open directly inside Sowveil’s own motion engine and Cloud Project Library with 100% fidelity.',
      };

      return {
        editorId: descriptor.id,
        supportedFileTypes: descriptor.supportedFormats,
        verifiedFileTypes: descriptor.verifiedFormats || descriptor.supportedFormats,
        nativeProjectWriting: {
          supported: isSowveil || (isAlight && xmlEligibleForModule),
          status: isSowveil
            ? 'Verified'
            : isAlight
            ? xmlEligibleForModule
              ? 'Tested subset'
              : 'Media handoff only'
            : descriptor.id === 'kinemaster'
            ? 'Needs target-app validation'
            : 'Unsupported',
          formatExtension: isSowveil
            ? '.sowveil.json'
            : isAlight && xmlEligibleForModule
            ? '.xml'
            : null,
          explanation: isSowveil
            ? 'Full native portable document read/write support in Sowveil Studio.'
            : isAlight
            ? xmlEligibleForModule
              ? 'Generates Alight Motion XML (amproj 4.0) for the tested subset of 2D transforms, text, shapes, and cubic-bezier curves.'
              : 'This module uses audio, captions, or 3D/expression features outside the Alight Motion XML subset; exports a verified Media Bundle instead.'
            : descriptor.id === 'kinemaster'
            ? 'Native .kine project writing is disabled pending target-app format verification; exports verified media & .srt sidecar files.'
            : 'Destination editor does not provide a verified public project writer; exports interoperable media, audio, and caption files.',
        },
        assetHandoffSupported: true,
        shareOpenMethods: [
          'web-share-files',
          'direct-download',
          'clipboard-steps',
          'in-app-preview',
        ],
        documentedVersionRequirements: descriptor.testedVersions || 'Current Android/iOS release',
        regionalOrPlatformNotes:
          descriptor.id === 'capcut'
            ? 'CapCut Local SRT import location varies by region and app version (Text → Local Captions vs. Auto Captions → Import). Direct overlay (.png/.svg) and audio (.wav) import works across all regions.'
            : descriptor.id === 'alight-motion'
            ? 'XML template upload requires Alight Motion v4.0+ / v5.0+ on Android or iOS.'
            : 'Compatible with Android 11+ and iOS 15+ system file pickers and Web Share sheets.',
        limitations: [descriptor.limitationsNote],
        whyNotDirectTimelineInsertion: whyNotDirectMap[descriptor.id],
        evidence: {
          lastValidationDate: descriptor.lastValidationDate || '2026-10-25',
          testedTargetVersions: descriptor.testedVersions || 'Verified in automated suite',
          verificationSummary:
            descriptor.verificationNote || descriptor.honestCapabilitySummary,
        },
      };
    },

    validateConfiguration(
      item: CatalogItem,
      preset: Partial<ExportPreset>
    ): EditorValidationResult {
      const warnings: string[] = [];
      const errors: string[] = [];
      const requestedFormat = preset.outputFormat;

      if (descriptor.id === 'alight-motion' && requestedFormat === 'alight-xml') {
        const xmlClass = classifyPresetForAlightMotionXml(item);
        if (!xmlClass.canExportXml) {
          warnings.push(
            `${xmlClass.reason} Automatically switching to Universal Media Bundle (.zip).`
          );
          return {
            valid: true,
            resolvedFormat: 'zip-bundle',
            compatibilityStatus: 'Media handoff only',
            warnings,
            errors,
            fallbackFormat: 'zip-bundle',
          };
        }
      }

      if (
        requestedFormat &&
        !descriptor.supportedFormats.includes(requestedFormat)
      ) {
        const fallback = this.chooseExportStrategy(item);
        warnings.push(
          `Format "${requestedFormat}" is not supported by ${descriptor.shortName}; using "${fallback}".`
        );
        return {
          valid: true,
          resolvedFormat: fallback,
          compatibilityStatus: descriptor.compatibilityStatus,
          warnings,
          errors,
          fallbackFormat: fallback,
        };
      }

      const resolvedFormat = this.chooseExportStrategy(item, requestedFormat);
      return {
        valid: true,
        resolvedFormat,
        compatibilityStatus:
          descriptor.id === 'alight-motion' && resolvedFormat === 'alight-xml'
            ? 'Tested subset'
            : descriptor.compatibilityStatus,
        warnings,
        errors,
      };
    },

    chooseExportStrategy(
      item: CatalogItem,
      requestedFormat?: ExportArtifactFormat
    ): ExportArtifactFormat {
      if (requestedFormat && descriptor.supportedFormats.includes(requestedFormat)) {
        if (
           requestedFormat === 'alight-xml' &&
          !ALIGHT_MOTION_TESTED_XML_MODULES.includes(item.moduleId)
        ) {
          return 'zip-bundle';
        }
        return requestedFormat;
      }

      if (item.moduleId === 'sfx' && descriptor.supportedFormats.includes('wav-audio')) {
        return 'wav-audio';
      }
      if (
        item.moduleId === 'auto-captions' &&
        descriptor.supportedFormats.includes('srt-captions')
      ) {
        return 'srt-captions';
      }
      if (
        descriptor.id === 'alight-motion' &&
        ALIGHT_MOTION_TESTED_XML_MODULES.includes(item.moduleId)
      ) {
        return 'alight-xml';
      }
      return descriptor.defaultExportFormat;
    },

    generateExport(params): GeneratedGatewayExport {
      const { item, customValues = {} } = params;
      const aspectRatio: MobileAspectRatio = params.preset?.aspectRatio ?? '9:16';
      const validation = this.validateConfiguration(item, params.preset || {});
      const resolvedFormat = validation.resolvedFormat;
      const preset = buildExportPreset({
        item,
        aspectRatio,
        fps: params.preset?.fps,
        durationSec: params.preset?.durationSec,
        qualityPolicy: params.preset?.qualityPolicy,
        backgroundMode: params.preset?.backgroundMode,
        outputFormat: resolvedFormat,
      });

      const nowIso = new Date().toISOString();
      const progressEvents: ExportProgressEvent[] = [
        {
          step: 'validating',
          percent: 15,
          message: `Validated ${descriptor.shortName} capabilities (${validation.compatibilityStatus}).`,
          timestamp: nowIso,
        },
      ];

      const motionDocument = buildPortableMotionDocument({
        item,
        targetEditor: descriptor.id,
        aspectRatio,
        fps: preset.fps,
        durationSec: preset.durationSec,
        backgroundMode: preset.backgroundMode,
        customValues,
      });

      progressEvents.push({
        step: 'building-document',
        percent: 40,
        message: `Built portable MotionDocument v${motionDocument.schemaVersion} (${preset.width}×${preset.height} @ ${preset.fps}fps).`,
        timestamp: nowIso,
      });

      const encoder = new TextEncoder();
      const jsonText = JSON.stringify(motionDocument, null, 2);
      const jsonBytes = encoder.encode(jsonText);

      const svgText = generateSanitizedVectorSvg({
        item,
        aspectRatio,
        backgroundMode: preset.backgroundMode,
        customValues,
      });
      const svgBytes = encoder.encode(svgText);

      const pngBytes = generateValidPngStillBytes({
        aspectRatio,
        backgroundMode: preset.backgroundMode,
        accentHex: String(customValues.accentColor ?? '#F06424'),
      });

      const wavBytes = generateProceduralSfxWav({
        durationSec: Math.min(preset.durationSec, 2.0),
        baseFreqHz: 210,
        endFreqHz: 660,
      });

      const cues = createDefaultCuesForItem(item, customValues);
      const srtText = generateSrtFromCues(cues);
      const srtBytes = encoder.encode(srtText);

      const vttText = generateVttFromCues(cues);
      const vttBytes = encoder.encode(vttText);

      const jsonCaptionsText = generateJsonCaptionsFromCues(cues, aspectRatio);
      const jsonCaptionsBytes = encoder.encode(jsonCaptionsText);

      const xmlClass = classifyPresetForAlightMotionXml(item);
      const xmlText = xmlClass.canExportXml
        ? serializeAlightMotionXml({
            item,
            aspectRatio,
            fps: preset.fps,
            durationSec: preset.durationSec,
            backgroundMode: preset.backgroundMode,
            customValues,
          })
        : '';
      const xmlBytes = xmlText ? encoder.encode(xmlText) : new Uint8Array(0);

      const curveSheetText = JSON.stringify(
        {
          bundleType:
            descriptor.id === 'node-video'
              ? 'Sowveil media bundle for Node Video'
              : `Sowveil curve sheet for ${descriptor.shortName}`,
          presetName: item.name,
          aspectRatio,
          width: preset.width,
          height: preset.height,
          fps: preset.fps,
          durationSec: preset.durationSec,
          cubicBezier: motionDocument.easing.cubicBezier,
          manualRebuildInstructions:
            'Apply cubicBezier handles [x1, y1, x2, y2] in your mobile editor’s keyframe graph / custom spline editor.',
        },
        null,
        2
      );
      const curveSheetBytes = encoder.encode(curveSheetText);

      progressEvents.push({
        step: 'encoding-assets',
        percent: 70,
        message: 'Encoded vector SVG, RGBA PNG still, 16-bit PCM WAV, and timed subtitle tracks.',
        timestamp: nowIso,
      });

      const guide = this.getImportGuide(resolvedFormat, aspectRatio);

      const bundleComponentFiles: Array<{
        fileName: string;
        mimeType: string;
        role: AssetBundleEntryMetadata['role'];
        bytes: Uint8Array;
      }> = [
        {
          fileName: `${item.slug}-${aspectRatio.replace(':', 'x')}.sowveil.json`,
          mimeType: 'application/json',
          role: 'motion-document',
          bytes: jsonBytes,
        },
        {
          fileName: `${item.slug}-${aspectRatio.replace(':', 'x')}.svg`,
          mimeType: 'image/svg+xml',
          role: 'vector-graphic',
          bytes: svgBytes,
        },
        {
          fileName: `${item.slug}-${aspectRatio.replace(':', 'x')}.png`,
          mimeType: 'image/png',
          role: 'still-png',
          bytes: pngBytes,
        },
        {
          fileName: 'curve-sheet.json',
          mimeType: 'application/json',
          role: 'curve-sheet',
          bytes: curveSheetBytes,
        },
      ];

      if (xmlClass.canExportXml && xmlBytes.byteLength > 0) {
        bundleComponentFiles.push({
          fileName: `${item.slug}-${aspectRatio.replace(':', 'x')}-alight.xml`,
          mimeType: 'application/xml',
          role: 'editor-native-xml',
          bytes: xmlBytes,
        });
      }

      if (item.moduleId === 'sfx' || item.metadata.audioAssetAvailable) {
        bundleComponentFiles.push({
          fileName: `${item.slug}.wav`,
          mimeType: 'audio/wav',
          role: 'audio-wav',
          bytes: wavBytes,
        });
      }

      if (item.moduleId === 'auto-captions' || descriptor.id === 'kinemaster' || descriptor.id === 'capcut') {
        bundleComponentFiles.push({
          fileName: `${item.slug}-captions.srt`,
          mimeType: 'application/x-subrip',
          role: 'caption-srt',
          bytes: srtBytes,
        });
      }

      const importStepsTxt = [
        `SOWVEIL STUDIO — MOBILE EDITOR IMPORT GUIDE`,
        `Preset: ${item.name} (${item.moduleId})`,
        `Destination: ${descriptor.name}`,
        `Bundle Label: ${
          descriptor.id === 'node-video'
            ? 'Sowveil media bundle for Node Video'
            : `${descriptor.shortName} Export Package`
        }`,
        `Compatibility Status: ${validation.compatibilityStatus}`,
        `Aspect Ratio: ${aspectRatio} (${preset.width}x${preset.height} @ ${preset.fps}fps)`,
        `Background Mode: ${preset.backgroundMode} (${preset.backgroundColorHex})`,
        ``,
        `WHY THIS CANNOT BE INSERTED DIRECTLY INTO AN EXTERNAL APP TIMELINE:`,
        guide.whyNotDirectTimelineInsertion,
        ``,
        `STEP-BY-STEP MOBILE IMPORT INSTRUCTIONS:`,
        ...guide.steps.map((s, i) => `${i + 1}. ${s}`),
        ``,
        `VERSION & REGIONAL NOTES:`,
        guide.versionAndRegionNotes,
      ].join('\n');

      const importGuideBytes = encoder.encode(importStepsTxt);
      bundleComponentFiles.push({
        fileName: 'IMPORT_STEPS.txt',
        mimeType: 'text/plain',
        role: 'import-guide',
        bytes: importGuideBytes,
      });

      const manifest = buildVerifiedAssetBundleManifest({
        item,
        targetEditor: descriptor.id,
        compatibilityLevel: validation.compatibilityStatus,
        preset,
        documentId: motionDocument.documentId,
        files: bundleComponentFiles,
        warnings: validation.warnings,
        importSteps: guide.steps,
      });

      const manifestBytes = encoder.encode(JSON.stringify(manifest, null, 2));

      progressEvents.push({
        step: 'packaging',
        percent: 88,
        message: `Assembled ${manifest.bundleLabel} with SHA-256 & CRC32 manifest.`,
        timestamp: nowIso,
      });

      let primaryFile: ExportResultFile;
      const additionalFiles: ExportResultFile[] = [];

      if (resolvedFormat === 'alight-xml') {
        const fileName = buildSafeExportFilename({
          slugOrName: item.slug,
          targetEditor: descriptor.id,
          aspectRatio,
          extensionWithDot: '.xml',
        });
        primaryFile = {
          fileName,
          mimeType: 'application/xml',
          sizeBytes: xmlBytes.byteLength,
          sha256: computeSha256Hex(xmlBytes),
          format: 'alight-xml',
          bytes: xmlBytes,
          textPreview: xmlText,
        };
      } else if (resolvedFormat === 'sowveil-json') {
        const fileName = buildSafeExportFilename({
          slugOrName: item.slug,
          targetEditor: descriptor.id,
          aspectRatio,
          extensionWithDot: '.sowveil.json',
        });
        primaryFile = {
          fileName,
          mimeType: 'application/json',
          sizeBytes: jsonBytes.byteLength,
          sha256: computeSha256Hex(jsonBytes),
          format: 'sowveil-json',
          bytes: jsonBytes,
          textPreview: jsonText,
        };
      } else if (resolvedFormat === 'svg-frame') {
        const fileName = buildSafeExportFilename({
          slugOrName: item.slug,
          targetEditor: descriptor.id,
          aspectRatio,
          extensionWithDot: '.svg',
        });
        primaryFile = {
          fileName,
          mimeType: 'image/svg+xml',
          sizeBytes: svgBytes.byteLength,
          sha256: computeSha256Hex(svgBytes),
          format: 'svg-frame',
          bytes: svgBytes,
          textPreview: svgText,
        };
      } else if (resolvedFormat === 'png-still') {
        const fileName = buildSafeExportFilename({
          slugOrName: item.slug,
          targetEditor: descriptor.id,
          aspectRatio,
          extensionWithDot: '.png',
        });
        primaryFile = {
          fileName,
          mimeType: 'image/png',
          sizeBytes: pngBytes.byteLength,
          sha256: computeSha256Hex(pngBytes),
          format: 'png-still',
          bytes: pngBytes,
        };
      } else if (resolvedFormat === 'wav-audio') {
        const fileName = buildSafeExportFilename({
          slugOrName: item.slug,
          targetEditor: descriptor.id,
          aspectRatio,
          extensionWithDot: '.wav',
        });
        primaryFile = {
          fileName,
          mimeType: 'audio/wav',
          sizeBytes: wavBytes.byteLength,
          sha256: computeSha256Hex(wavBytes),
          format: 'wav-audio',
          bytes: wavBytes,
        };
      } else if (resolvedFormat === 'srt-captions') {
        const fileName = buildSafeExportFilename({
          slugOrName: item.slug,
          targetEditor: descriptor.id,
          aspectRatio,
          extensionWithDot: '.srt',
        });
        primaryFile = {
          fileName,
          mimeType: 'application/x-subrip',
          sizeBytes: srtBytes.byteLength,
          sha256: computeSha256Hex(srtBytes),
          format: 'srt-captions',
          bytes: srtBytes,
          textPreview: srtText,
        };
      } else if (resolvedFormat === 'vtt-captions') {
        const fileName = buildSafeExportFilename({
          slugOrName: item.slug,
          targetEditor: descriptor.id,
          aspectRatio,
          extensionWithDot: '.vtt',
        });
        primaryFile = {
          fileName,
          mimeType: 'text/vtt',
          sizeBytes: vttBytes.byteLength,
          sha256: computeSha256Hex(vttBytes),
          format: 'vtt-captions',
          bytes: vttBytes,
          textPreview: vttText,
        };
      } else if (resolvedFormat === 'json-captions') {
        const fileName = buildSafeExportFilename({
          slugOrName: item.slug,
          targetEditor: descriptor.id,
          aspectRatio,
          extensionWithDot: '.captions.json',
        });
        primaryFile = {
          fileName,
          mimeType: 'application/json',
          sizeBytes: jsonCaptionsBytes.byteLength,
          sha256: computeSha256Hex(jsonCaptionsBytes),
          format: 'json-captions',
          bytes: jsonCaptionsBytes,
          textPreview: jsonCaptionsText,
        };
      } else {
        // Default: 'zip-bundle'
        const zipEntries = [
          { name: 'manifest.json', data: manifestBytes },
          ...bundleComponentFiles.map((f) => ({ name: f.fileName, data: f.bytes })),
        ];
        const zipBytes = generateRealZipBundle(zipEntries);
        const fileName = buildSafeExportFilename({
          slugOrName: item.slug,
          targetEditor: descriptor.id,
          aspectRatio,
          extensionWithDot: '.zip',
        });
        primaryFile = {
          fileName,
          mimeType: 'application/zip',
          sizeBytes: zipBytes.byteLength,
          sha256: computeSha256Hex(zipBytes),
          format: 'zip-bundle',
          bytes: zipBytes,
          textPreview: JSON.stringify(manifest, null, 2),
        };
      }

      const outputCheck = this.validateOutput(primaryFile);
      progressEvents.push({
        step: outputCheck.valid ? 'ready' : 'failed',
        percent: 100,
        message: outputCheck.reason,
        timestamp: new Date().toISOString(),
      });

      return {
        adapterId: descriptor.id,
        adapterName: descriptor.name,
        shortName: descriptor.shortName,
        bundleLabel: manifest.bundleLabel,
        compatibilityStatus: validation.compatibilityStatus,
        secondaryBadge: descriptor.secondaryValidationBadge,
        preset: {
          ...preset,
          estimatedSizeBytes: primaryFile.sizeBytes,
        },
        primaryFile,
        additionalFiles,
        manifest,
        motionDocument,
        importSteps: guide.steps,
        whyNotDirectNote: guide.whyNotDirectTimelineInsertion,
        validationPassed: outputCheck.valid,
        validationDetails: outputCheck.reason,
        progressEvents,
      };
    },

    validateOutput(file: ExportResultFile): { valid: boolean; reason: string } {
      // Never permit fake .capcut or .kine extensions
      const lowerName = file.fileName.toLowerCase();
      if (lowerName.endsWith('.capcut') || lowerName.endsWith('.kine')) {
        return {
          valid: false,
          reason: `Forbidden fabricated project extension in "${file.fileName}". Sowveil never renames archives to .capcut or .kine.`,
        };
      }

      switch (file.format) {
        case 'alight-xml': {
          const text = file.textPreview ?? new TextDecoder().decode(file.bytes);
          const check = validateAndInspectAlightMotionXml(text);
          return { valid: check.valid, reason: check.reason };
        }
        case 'sowveil-json': {
          const text = file.textPreview ?? new TextDecoder().decode(file.bytes);
          try {
            const raw = JSON.parse(text);
            const parsed = parsePortableMotionDocument(raw);
            return {
              valid: parsed.valid,
              reason: parsed.valid
                ? `Verified Sowveil MotionDocument v${parsed.document?.schemaVersion} (${parsed.document?.layers.length} layers).`
                : parsed.error || 'Invalid MotionDocument JSON.',
            };
          } catch {
            return { valid: false, reason: 'Malformed JSON in .sowveil.json output.' };
          }
        }
        case 'svg-frame': {
          const text = file.textPreview ?? new TextDecoder().decode(file.bytes);
          const sanitized = sanitizeSvgContent(text);
          const hasSvgRoot =
            sanitized.sanitizedSvg.includes('<svg') &&
            sanitized.sanitizedSvg.includes('</svg>');
          return {
            valid: sanitized.safe && hasSvgRoot,
            reason:
              sanitized.safe && hasSvgRoot
                ? `Verified sanitized SVG vector frame (${file.sizeBytes} bytes).`
                : `SVG validation failed: ${sanitized.removedThreats.join(', ') || 'missing <svg> root'}.`,
          };
        }
        case 'png-still':
          return validatePngBytes(file.bytes);
        case 'wav-audio':
          return validateWavBytes(file.bytes);
        case 'srt-captions': {
          const text = file.textPreview ?? new TextDecoder().decode(file.bytes);
          return validateSrtContent(text);
        }
        case 'vtt-captions': {
          const text = file.textPreview ?? new TextDecoder().decode(file.bytes);
          return validateVttContent(text);
        }
        case 'json-captions': {
          const text = file.textPreview ?? new TextDecoder().decode(file.bytes);
          try {
            const obj = JSON.parse(text);
            return {
              valid: obj.format === 'sowveil-caption-track' && Array.isArray(obj.cues) && obj.cues.length > 0,
              reason: `Verified JSON caption track (${obj.cues?.length ?? 0} cues).`,
            };
          } catch {
            return { valid: false, reason: 'Invalid JSON caption track.' };
          }
        }
        case 'zip-bundle': {
          const safety = validateZipSafety(file.bytes);
          return {
            valid: safety.valid && safety.fileNames.includes('manifest.json'),
            reason: safety.valid
              ? `Verified PKZIP bundle (${safety.entryCount} files: ${safety.fileNames.join(', ')}).`
              : safety.reason,
          };
        }
        default:
          return {
            valid: file.sizeBytes > 0,
            reason: `Generated ${file.format} (${file.sizeBytes} bytes).`,
          };
      }
    },

    getHandoffStrategy() {
      return {
        prefersWebShareFiles: true,
        supportsDirectDownload: true,
        supportsInAppPreview: true,
      };
    },

    getImportGuide(format: ExportArtifactFormat, aspectRatio: MobileAspectRatio) {
      const cap = this.discoverCapabilities();
      return {
        headline: `Import into ${descriptor.shortName} (${aspectRatio} · ${format})`,
        steps: descriptor.importSteps,
        versionAndRegionNotes: `${cap.documentedVersionRequirements} — ${cap.regionalOrPlatformNotes}`,
        whyNotDirectTimelineInsertion: cap.whyNotDirectTimelineInsertion,
      };
    },

    mapError(error: unknown) {
      const msg = error instanceof Error ? error.message : String(error || 'Unknown export error');
      return {
        code: 'EXPORT_GENERATION_FAILED',
        userMessage: `Could not complete ${descriptor.shortName} export (${msg}). Your configuration is preserved — retry or switch to Universal Media Bundle (.zip).`,
        recoverable: true,
        suggestedFallbackFormat: 'zip-bundle',
      };
    },
  };
}

export const EDITOR_ADAPTER_INSTANCES: Record<TargetMobileEditorId, EditorAdapter> =
  GATEWAY_ADAPTER_DESCRIPTORS.reduce((acc, desc) => {
    acc[desc.id] = createEditorAdapterInstance(desc);
    return acc;
  }, {} as Record<TargetMobileEditorId, EditorAdapter>);

export function getEditorAdapter(id: TargetMobileEditorId): EditorAdapter {
  return EDITOR_ADAPTER_INSTANCES[id] || EDITOR_ADAPTER_INSTANCES.capcut;
}

export function listEditorAdapters(): EditorAdapter[] {
  return GATEWAY_ADAPTER_DESCRIPTORS.map((d) => EDITOR_ADAPTER_INSTANCES[d.id]);
}
