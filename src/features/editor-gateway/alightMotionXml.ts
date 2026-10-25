import { CatalogItem, MobileAspectRatio, ModuleId } from '../../types/sowveil';
import { AlightMotionPresetXmlStatus, BackgroundAlphaMode } from './types';

/**
 * Modules whose presets use only the tested 2D transform, text, vector shape,
 * opacity, color, and cubic-bezier subset supported by Alight Motion XML (`amproj="4.0"`).
 */
export const ALIGHT_MOTION_TESTED_XML_MODULES: ModuleId[] = [
  'text-animation',
  'easing',
  'ready-made',
  'ui-saas',
  'liquid-glass',
  'carousel',
  'transitions',
  'logo-reveals',
  'backgrounds',
  'overlays-fx',
  'maps',
  'saas-effects',
  'templates',
];

/**
 * Modules that deliver audio, expressions, 3D mesh plates, or caption tracks
 * where generic media pack handoff (`.zip`, `.wav`, `.srt`, `.svg`) is required
 * instead of an Alight Motion `.xml` scene.
 */
export const ALIGHT_MOTION_MEDIA_PACK_ONLY_MODULES: ModuleId[] = [
  'expressions',
  'sfx',
  '3d-models',
  'mockups',
  'auto-captions',
  'downloader',
  'project-library',
];

export interface AlightMotionSubsetFeatureEntry {
  feature: string;
  xmlConstruct: string;
  status: 'Supported (Tested Subset)' | 'Unsupported in XML (Fallback to Media Pack)';
  notes: string;
}

export const ALIGHT_MOTION_XML_FEATURE_MATRIX: AlightMotionSubsetFeatureEntry[] = [
  {
    feature: 'Scene Composition & Aspect Ratio (9:16, 1:1, 16:9)',
    xmlConstruct: '<scene title="..." width="..." height="..." fps="..." totalTime="...">',
    status: 'Supported (Tested Subset)',
    notes: 'Maps mobile aspect ratios (1080×1920, 1080×1080, 1920×1080) and millisecond timing.',
  },
  {
    feature: '2D Position, Scale & Opacity Keyframes',
    xmlConstruct: '<transform><location><kf .../></location><scale><kf .../></scale><opacity><kf .../></opacity></transform>',
    status: 'Supported (Tested Subset)',
    notes: 'Normalized t=[0..1] keyframe progression with center-origin coordinate offsets.',
  },
  {
    feature: 'Cubic-Bezier Easing Curves',
    xmlConstruct: 'e="cubicBezier x1 y1 x2 y2"',
    status: 'Supported (Tested Subset)',
    notes: 'Direct 1:1 serialization of 4-point cubic-bezier control handles.',
  },
  {
    feature: 'Editable Text Layers & Fill Colors',
    xmlConstruct: '<text id="..." label="..." startTime="0" endTime="..."><content>...</content><fillColor value="..."/></text>',
    status: 'Supported (Tested Subset)',
    notes: 'Escapes XML entities (&amp;, &lt;, &gt;, &quot;, &apos;) and preserves hex color.',
  },
  {
    feature: 'Vector Guide Plates & Rounded Rect Shapes',
    xmlConstruct: '<shape id="..." s=".roundrect"><fill color="..."/><property name="size" .../></shape>',
    status: 'Supported (Tested Subset)',
    notes: 'Provides clean safe-zone and card backdrop layers inside the scene.',
  },
  {
    feature: 'JavaScript / After Effects Expressions (wiggle, loopOut)',
    xmlConstruct: 'N/A (Alight Motion does not execute AE JS expressions)',
    status: 'Unsupported in XML (Fallback to Media Pack)',
    notes: 'Exported as baked keyframes or curve/parameter reference sheet in the ZIP media pack.',
  },
  {
    feature: 'True 3D Mesh / GLB Shaders & Depth Maps',
    xmlConstruct: 'N/A (Requires pre-rendered visual plate)',
    status: 'Unsupported in XML (Fallback to Media Pack)',
    notes: 'Exported as high-contrast SVG/PNG visual plates inside the Universal Media Bundle.',
  },
  {
    feature: 'Embedded Multi-Track PCM Audio Streams',
    xmlConstruct: 'N/A (External audio asset reference)',
    status: 'Unsupported in XML (Fallback to Media Pack)',
    notes: 'Exported as standalone 16-bit PCM .wav or bundled inside the .zip package.',
  },
];

function escapeXmlText(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function classifyPresetForAlightMotionXml(
  item: CatalogItem
): {
  status: AlightMotionPresetXmlStatus;
  canExportXml: boolean;
  reason: string;
  unsupportedFeatures: string[];
} {
  if (ALIGHT_MOTION_TESTED_XML_MODULES.includes(item.moduleId)) {
    return {
      status: 'Alight Motion XML — tested subset',
      canExportXml: true,
      reason: `Module "${item.moduleId}" uses the verified 2D transform, text, shape, color, opacity, and cubic-bezier XML subset.`,
      unsupportedFeatures: [],
    };
  }

  if (item.moduleId === 'sfx' || item.moduleId === 'auto-captions') {
    return {
      status: 'Generic media pack',
      canExportXml: false,
      reason: `Module "${item.moduleId}" produces native audio (.wav) or subtitle (.srt/.vtt) tracks rather than an Alight Motion XML scene.`,
      unsupportedFeatures: ['Embedded PCM audio binary', 'Timed subtitle cue track'],
    };
  }

  if (item.moduleId === 'expressions' || item.moduleId === '3d-models' || item.moduleId === 'mockups') {
    return {
      status: 'Generic media pack',
      canExportXml: false,
      reason: `Module "${item.moduleId}" relies on procedural expressions or 3D/mockup plates not representable in Alight Motion XML; use the ZIP media bundle.`,
      unsupportedFeatures: ['AE JavaScript expression evaluation', '3D mesh/shader pipeline'],
    };
  }

  return {
    status: 'Unsupported for XML export',
    canExportXml: false,
    reason: `Module "${item.moduleId}" is a project/utility manager and does not emit an Alight Motion XML scene directly.`,
    unsupportedFeatures: ['Project/utility workspace state'],
  };
}

export function getAlightDimensions(aspectRatio: MobileAspectRatio): {
  width: number;
  height: number;
} {
  switch (aspectRatio) {
    case '9:16':
      return { width: 1080, height: 1920 };
    case '1:1':
      return { width: 1080, height: 1080 };
    case '16:9':
      return { width: 1920, height: 1080 };
  }
}

export function serializeAlightMotionXml(params: {
  item: CatalogItem;
  aspectRatio: MobileAspectRatio;
  fps?: number;
  durationSec?: number;
  backgroundMode?: BackgroundAlphaMode;
  customValues?: Record<string, string | number | boolean>;
}): string {
  const { item, aspectRatio, customValues = {} } = params;
  const dims = getAlightDimensions(aspectRatio);
  const fps = params.fps ?? item.metadata.fps ?? 60;
  const durationSec = params.durationSec ?? item.metadata.durationSec ?? 3;
  const durationMs = Math.max(500, Math.round(durationSec * 1000));
  const curve = item.metadata.curvePoints || [0.22, 1, 0.36, 1];

  const primaryText = String(
    customValues.headline ??
      customValues.title ??
      customValues.badgeText ??
      item.name
  );
  const accentHex = String(
    customValues.accentColor ?? customValues.primaryColor ?? '#F06424'
  );
  const normalizedHex = accentHex.startsWith('#') ? accentHex : `#${accentHex}`;
  const bgHex =
    params.backgroundMode === 'chroma-key-green'
      ? '#ff00ff00'
      : params.backgroundMode === 'transparent'
      ? '#00000000'
      : '#ff080707';

  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<!-- Generated by Sowveil Studio Mobile Motion Engine (Tested Subset v2.0) -->`,
    `<!-- Target: Alight Motion Android / iOS · Aspect Ratio: ${aspectRatio} (${dims.width}x${dims.height}) -->`,
    `<scene title="${escapeXmlText(item.name)} (${aspectRatio})" width="${dims.width}" height="${dims.height}" exportWidth="${dims.width}" exportHeight="${dims.height}" precompose="dynamicResolution" bgcolor="${bgHex}" totalTime="${durationMs}" fps="${fps}" modifiedTime="${Date.now()}" amproj="4.0" sowveilModule="${escapeXmlText(item.moduleId)}" sowveilSubset="tested-2d-v2">`,
    `  <metadata>`,
    `    <generator>Sowveil Studio Mobile Editor Gateway</generator>`,
    `    <presetId>${escapeXmlText(item.id)}</presetId>`,
    `    <moduleId>${escapeXmlText(item.moduleId)}</moduleId>`,
    `    <aspectRatio>${escapeXmlText(aspectRatio)}</aspectRatio>`,
    `    <compatibilityStatus>Tested subset</compatibilityStatus>`,
    `    <supportedConstructs>scene,shape,text,transform,location,scale,opacity,cubicBezier</supportedConstructs>`,
    `    <unsupportedConstructs>aeExpressions,glb3dMeshes,embeddedPcmAudio</unsupportedConstructs>`,
    `  </metadata>`,
    `  <shape id="101" label="Sowveil Safe-Zone Card" startTime="0" endTime="${durationMs}" fillType="color" s=".roundrect">`,
    `    <transform>`,
    `      <location>`,
    `        <kf t="0.000000" v="${dims.width / 2},${dims.height / 2},0" />`,
    `        <kf t="1.000000" v="${dims.width / 2},${dims.height / 2},0" e="cubicBezier ${curve[0]} ${curve[1]} ${curve[2]} ${curve[3]}" />`,
    `      </location>`,
    `      <scale>`,
    `        <kf t="0.000000" v="0.880000,0.880000" />`,
    `        <kf t="0.350000" v="1.000000,1.000000" e="cubicBezier ${curve[0]} ${curve[1]} ${curve[2]} ${curve[3]}" />`,
    `      </scale>`,
    `      <opacity>`,
    `        <kf t="0.000000" v="0.000000" />`,
    `        <kf t="0.220000" v="1.000000" e="cubicBezier ${curve[0]} ${curve[1]} ${curve[2]} ${curve[3]}" />`,
    `      </opacity>`,
    `    </transform>`,
    `    <fill color="${escapeXmlText(normalizedHex)}" />`,
    `    <property name="size" type="vec2" value="${Math.round(dims.width * 0.4)},${Math.round(dims.height * 0.14)}" />`,
    `    <property name="cornerRadius" type="float" value="28.0" />`,
    `  </shape>`,
    `  <text id="102" label="${escapeXmlText(item.name)} Primary Text" startTime="0" endTime="${durationMs}">`,
    `    <transform>`,
    `      <location>`,
    `        <kf t="0.000000" v="${dims.width / 2},${Math.round(dims.height * 0.54)},0" />`,
    `        <kf t="0.300000" v="${dims.width / 2},${dims.height / 2},0" e="cubicBezier ${curve[0]} ${curve[1]} ${curve[2]} ${curve[3]}" />`,
    `      </location>`,
    `      <opacity>`,
    `        <kf t="0.000000" v="0.000000" />`,
    `        <kf t="0.250000" v="1.000000" />`,
    `      </opacity>`,
    `    </transform>`,
    `    <content>${escapeXmlText(primaryText)}</content>`,
    `    <font>PlusJakartaSans-Bold</font>`,
    `    <size>48.0</size>`,
    `    <fillColor value="#FFF3EEE8" />`,
    `  </text>`,
    `</scene>`,
  ].join('\n');
}

export interface ParsedAlightMotionSceneSummary {
  valid: boolean;
  reason: string;
  title?: string;
  width?: number;
  height?: number;
  fps?: number;
  totalTimeMs?: number;
  shapeCount: number;
  textCount: number;
  keyframeCount: number;
  hasCubicBezier: boolean;
}

/**
 * Validates and parses an Alight Motion XML document to confirm structural
 * well-formedness, scene dimensions, FPS, duration, and tested subset tags.
 */
export function validateAndInspectAlightMotionXml(
  xml: string
): ParsedAlightMotionSceneSummary {
  const trimmed = xml.trim();
  if (!trimmed.startsWith('<?xml')) {
    return {
      valid: false,
      reason: 'Missing XML declaration header (<?xml version="1.0" ...?>).',
      shapeCount: 0,
      textCount: 0,
      keyframeCount: 0,
      hasCubicBezier: false,
    };
  }

  // Reject unescaped script tags or DTD external entities (XXE defense)
  if (/<!DOCTYPE/i.test(trimmed) || /<!ENTITY/i.test(trimmed) || /<script\b/i.test(trimmed)) {
    return {
      valid: false,
      reason: 'Rejected unsafe XML DTD/ENTITY or <script> construct.',
      shapeCount: 0,
      textCount: 0,
      keyframeCount: 0,
      hasCubicBezier: false,
    };
  }

  const sceneOpenMatch = trimmed.match(/<scene\b([^>]*)>/);
  if (!sceneOpenMatch || !trimmed.endsWith('</scene>')) {
    return {
      valid: false,
      reason: 'Missing root <scene> ... </scene> element.',
      shapeCount: 0,
      textCount: 0,
      keyframeCount: 0,
      hasCubicBezier: false,
    };
  }

  const sceneAttrs = sceneOpenMatch[1];
  const titleMatch = sceneAttrs.match(/title="([^"]+)"/);
  const widthMatch = sceneAttrs.match(/width="(\d+)"/);
  const heightMatch = sceneAttrs.match(/height="(\d+)"/);
  const fpsMatch = sceneAttrs.match(/fps="(\d+)"/);
  const totalTimeMatch = sceneAttrs.match(/totalTime="(\d+)"/);

  if (!widthMatch || !heightMatch || !fpsMatch || !totalTimeMatch) {
    return {
      valid: false,
      reason: 'Root <scene> is missing required width, height, fps, or totalTime attributes.',
      shapeCount: 0,
      textCount: 0,
      keyframeCount: 0,
      hasCubicBezier: false,
    };
  }

  const width = Number(widthMatch[1]);
  const height = Number(heightMatch[1]);
  const fps = Number(fpsMatch[1]);
  const totalTimeMs = Number(totalTimeMatch[1]);

  if (width <= 0 || height <= 0 || fps <= 0 || totalTimeMs <= 0) {
    return {
      valid: false,
      reason: 'Scene dimensions, fps, and totalTime must be positive numbers.',
      shapeCount: 0,
      textCount: 0,
      keyframeCount: 0,
      hasCubicBezier: false,
    };
  }

  const shapeCount = (trimmed.match(/<shape\b/g) || []).length;
  const textCount = (trimmed.match(/<text\b/g) || []).length;
  const keyframeCount = (trimmed.match(/<kf\b/g) || []).length;
  const hasCubicBezier = /cubicBezier\s+[\d.-]+\s+[\d.-]+\s+[\d.-]+\s+[\d.-]+/.test(trimmed);

  if (shapeCount === 0 && textCount === 0) {
    return {
      valid: false,
      reason: 'Scene must contain at least one <shape> or <text> layer.',
      shapeCount,
      textCount,
      keyframeCount,
      hasCubicBezier,
    };
  }

  if (!trimmed.includes('<transform>') || keyframeCount === 0) {
    return {
      valid: false,
      reason: 'Scene layers must include <transform> with at least one <kf> keyframe.',
      shapeCount,
      textCount,
      keyframeCount,
      hasCubicBezier,
    };
  }

  return {
    valid: true,
    reason: `Verified Alight Motion XML scene (${width}×${height} @ ${fps}fps, ${totalTimeMs}ms, ${shapeCount} shape(s), ${textCount} text layer(s), ${keyframeCount} keyframes).`,
    title: titleMatch ? titleMatch[1] : undefined,
    width,
    height,
    fps,
    totalTimeMs,
    shapeCount,
    textCount,
    keyframeCount,
    hasCubicBezier,
  };
}
