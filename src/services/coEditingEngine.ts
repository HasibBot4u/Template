import {
  CanonicalClip,
  CanonicalProjectCommand,
  CanonicalProjectDocument,
  ProjectCommandReceipt,
} from '../types/canonicalProject';
import {
  executeProjectCommand,
  validateCanonicalProject,
} from './canonicalProjectEngine';

// ============================================================================
// 1. EASING CURVE PRESETS & SVG PATH GENERATOR
// ============================================================================

export interface EasingCurvePreset {
  id: string;
  label: string;
  category: 'out' | 'in-out' | 'spring' | 'linear';
  points: [number, number, number, number];
  description: string;
}

export const EASING_CURVE_PRESETS: EasingCurvePreset[] = [
  {
    id: 'expo-out',
    label: 'Expo Out (Snappy)',
    category: 'out',
    points: [0.16, 1, 0.3, 1],
    description: 'Fast initial velocity with a long, cushioned settle.',
  },
  {
    id: 'spring-snappy',
    label: 'Sowveil Signature Out',
    category: 'out',
    points: [0.22, 1, 0.36, 1],
    description: 'Balanced kinetic typography & SaaS card entrance curve.',
  },
  {
    id: 'smooth-cinematic',
    label: 'Smooth Cinematic',
    category: 'in-out',
    points: [0.25, 0.1, 0.25, 1.0],
    description: 'Gentle acceleration and deceleration for soft transitions.',
  },
  {
    id: 'quint-in-out',
    label: 'Quint In-Out',
    category: 'in-out',
    points: [0.83, 0, 0.17, 1],
    description: 'High-contrast whip transition curve.',
  },
  {
    id: 'back-overshoot',
    label: 'Back Overshoot',
    category: 'spring',
    points: [0.34, 1.35, 0.64, 1],
    description: 'Subtle elastic overshoot for badges and callouts.',
  },
  {
    id: 'linear',
    label: 'Linear (Constant)',
    category: 'linear',
    points: [0, 0, 1, 1],
    description: 'Constant rate of change without easing.',
  },
];

export function buildCubicBezierSvgPath(
  points: [number, number, number, number],
  width = 160,
  height = 100,
  padding = 14
): {
  curvePath: string;
  handle1: { x1: number; y1: number; x2: number; y2: number };
  handle2: { x1: number; y1: number; x2: number; y2: number };
} {
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const startX = padding;
  const startY = height - padding;
  const endX = width - padding;
  const endY = padding;

  const cp1X = Number((startX + points[0] * innerW).toFixed(1));
  const cp1Y = Number((startY - points[1] * innerH).toFixed(1));
  const cp2X = Number((startX + points[2] * innerW).toFixed(1));
  const cp2Y = Number((startY - points[3] * innerH).toFixed(1));

  return {
    curvePath: `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`,
    handle1: { x1: startX, y1: startY, x2: cp1X, y2: cp1Y },
    handle2: { x1: endX, y1: endY, x2: cp2X, y2: cp2Y },
  };
}

// ============================================================================
// 2. CANONICAL PROJECT DIFF ENGINE (VERSION & TRANSACTION COMPARISON)
// ============================================================================

export type DiffCategory =
  | 'canvas'
  | 'scene'
  | 'track'
  | 'clip'
  | 'keyframe'
  | 'effect'
  | 'transition'
  | 'audio'
  | 'caption'
  | 'asset';

export interface ProjectDiffEntry {
  id: string;
  category: DiffCategory;
  changeKind: 'added' | 'modified' | 'removed';
  entityId: string;
  entityName: string;
  trackId?: string;
  sceneId?: string;
  parameterKey: string;
  beforeValue: string;
  afterValue: string;
  humanSummary: string;
}

export interface CanonicalProjectDiff {
  beforeRevision: number;
  afterRevision: number;
  totalChanges: number;
  affectedClipIds: string[];
  affectedTrackIds: string[];
  affectedSceneIds: string[];
  affectedParameters: string[];
  summaryText: string;
  entries: ProjectDiffEntry[];
}

function formatDiffVal(v: unknown): string {
  if (v === undefined || v === null) return 'none';
  if (typeof v === 'number') return Number(v.toFixed(3)).toString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

export function diffCanonicalProjects(
  beforeDoc: CanonicalProjectDocument,
  afterDoc: CanonicalProjectDocument
): CanonicalProjectDiff {
  const entries: ProjectDiffEntry[] = [];
  const affectedClipIds = new Set<string>();
  const affectedTrackIds = new Set<string>();
  const affectedSceneIds = new Set<string>();
  const affectedParameters = new Set<string>();

  const pushEntry = (entry: Omit<ProjectDiffEntry, 'id'>) => {
    entries.push({
      ...entry,
      id: `diff_${entries.length + 1}_${entry.entityId}_${entry.parameterKey}`,
    });
    affectedParameters.add(entry.parameterKey);
    if (entry.trackId) affectedTrackIds.add(entry.trackId);
    if (entry.sceneId) affectedSceneIds.add(entry.sceneId);
    if (
      entry.category === 'clip' ||
      entry.category === 'keyframe' ||
      entry.category === 'effect' ||
      entry.category === 'transition' ||
      entry.category === 'audio' ||
      entry.category === 'caption'
    ) {
      affectedClipIds.add(entry.entityId);
    }
  };

  // 1. Project Title & Canvas
  if (beforeDoc.title !== afterDoc.title) {
    pushEntry({
      category: 'canvas',
      changeKind: 'modified',
      entityId: afterDoc.id,
      entityName: afterDoc.title,
      parameterKey: 'project.title',
      beforeValue: beforeDoc.title,
      afterValue: afterDoc.title,
      humanSummary: `Renamed project from "${beforeDoc.title}" to "${afterDoc.title}"`,
    });
  }

  const canvasKeys: Array<keyof CanonicalProjectDocument['canvas']> = [
    'aspectRatio',
    'width',
    'height',
    'fps',
    'durationSec',
    'backgroundColorHex',
    'backgroundAlphaMode',
  ];
  for (const k of canvasKeys) {
    if (beforeDoc.canvas[k] !== afterDoc.canvas[k]) {
      pushEntry({
        category: 'canvas',
        changeKind: 'modified',
        entityId: afterDoc.id,
        entityName: 'Project Canvas',
        parameterKey: `canvas.${k}`,
        beforeValue: formatDiffVal(beforeDoc.canvas[k]),
        afterValue: formatDiffVal(afterDoc.canvas[k]),
        humanSummary: `Canvas ${k}: ${formatDiffVal(beforeDoc.canvas[k])} → ${formatDiffVal(afterDoc.canvas[k])}`,
      });
    }
  }

  // 2. Scenes
  const beforeScenes = new Map(beforeDoc.scenes.map((s) => [s.id, s]));
  const afterScenes = new Map(afterDoc.scenes.map((s) => [s.id, s]));
  for (const [sid, sAfter] of afterScenes.entries()) {
    const sBefore = beforeScenes.get(sid);
    if (!sBefore) {
      affectedSceneIds.add(sid);
      pushEntry({
        category: 'scene',
        changeKind: 'added',
        entityId: sid,
        entityName: sAfter.title,
        sceneId: sid,
        parameterKey: 'scene.created',
        beforeValue: 'none',
        afterValue: `${sAfter.title} (${sAfter.durationSec}s, segments: ${sAfter.scriptSegmentIds.join(',') || 'none'})`,
        humanSummary: `Added scene "${sAfter.title}" retaining segments [${sAfter.scriptSegmentIds.join(', ')}]`,
      });
    } else {
      if (sBefore.status !== sAfter.status) {
        affectedSceneIds.add(sid);
        pushEntry({
          category: 'scene',
          changeKind: 'modified',
          entityId: sid,
          entityName: sAfter.title,
          sceneId: sid,
          parameterKey: 'scene.status',
          beforeValue: sBefore.status,
          afterValue: sAfter.status,
          humanSummary: `Scene "${sAfter.title}" status: ${sBefore.status} → ${sAfter.status}`,
        });
      }
      if (sBefore.title !== sAfter.title) {
        affectedSceneIds.add(sid);
        pushEntry({
          category: 'scene',
          changeKind: 'modified',
          entityId: sid,
          entityName: sAfter.title,
          sceneId: sid,
          parameterKey: 'scene.title',
          beforeValue: sBefore.title,
          afterValue: sAfter.title,
          humanSummary: `Scene title: "${sBefore.title}" → "${sAfter.title}"`,
        });
      }
    }
  }

  // 3. Tracks & Clips
  const beforeTracks = new Map(beforeDoc.tracks.map((t) => [t.id, t]));
  const afterTracks = new Map(afterDoc.tracks.map((t) => [t.id, t]));

  for (const [tid, tAfter] of afterTracks.entries()) {
    const tBefore = beforeTracks.get(tid);
    if (!tBefore) {
      pushEntry({
        category: 'track',
        changeKind: 'added',
        entityId: tid,
        entityName: tAfter.name,
        trackId: tid,
        parameterKey: 'track.created',
        beforeValue: 'none',
        afterValue: `${tAfter.name} (${tAfter.kind})`,
        humanSummary: `Added ${tAfter.kind} track "${tAfter.name}"`,
      });
    } else {
      for (const tk of ['visible', 'locked', 'muted', 'solo', 'gainDb'] as const) {
        if (tBefore[tk] !== tAfter[tk]) {
          pushEntry({
            category: 'track',
            changeKind: 'modified',
            entityId: tid,
            entityName: tAfter.name,
            trackId: tid,
            parameterKey: `track.${tk}`,
            beforeValue: formatDiffVal(tBefore[tk]),
            afterValue: formatDiffVal(tAfter[tk]),
            humanSummary: `Track "${tAfter.name}" ${tk}: ${formatDiffVal(tBefore[tk])} → ${formatDiffVal(tAfter[tk])}`,
          });
        }
      }
    }
  }

  const beforeClips = new Map<string, { clip: CanonicalClip; trackId: string }>();
  for (const t of beforeDoc.tracks) {
    for (const c of t.clips) {
      beforeClips.set(c.id, { clip: c, trackId: t.id });
    }
  }

  const afterClips = new Map<string, { clip: CanonicalClip; trackId: string }>();
  for (const t of afterDoc.tracks) {
    for (const c of t.clips) {
      afterClips.set(c.id, { clip: c, trackId: t.id });
    }
  }

  for (const [cid, { clip: cBefore, trackId }] of beforeClips.entries()) {
    if (!afterClips.has(cid)) {
      pushEntry({
        category: 'clip',
        changeKind: 'removed',
        entityId: cid,
        entityName: cBefore.name,
        trackId,
        sceneId: cBefore.sceneId,
        parameterKey: 'clip.deleted',
        beforeValue: `${cBefore.name} (${cBefore.startTimeSec}s..${(cBefore.startTimeSec + cBefore.durationSec).toFixed(2)}s)`,
        afterValue: 'removed',
        humanSummary: `Deleted clip "${cBefore.name}" from track ${trackId}`,
      });
    }
  }

  for (const [cid, { clip: cAfter, trackId }] of afterClips.entries()) {
    const prev = beforeClips.get(cid);
    if (!prev) {
      pushEntry({
        category: 'clip',
        changeKind: 'added',
        entityId: cid,
        entityName: cAfter.name,
        trackId,
        sceneId: cAfter.sceneId,
        parameterKey: 'clip.created',
        beforeValue: 'none',
        afterValue: `${cAfter.kind} @ ${cAfter.startTimeSec.toFixed(2)}s (${cAfter.durationSec.toFixed(2)}s)`,
        humanSummary: `Added ${cAfter.kind} clip "${cAfter.name}" at ${cAfter.startTimeSec.toFixed(2)}s`,
      });
      continue;
    }

    const cBefore = prev.clip;
    if (prev.trackId !== trackId) {
      pushEntry({
        category: 'clip',
        changeKind: 'modified',
        entityId: cid,
        entityName: cAfter.name,
        trackId,
        sceneId: cAfter.sceneId,
        parameterKey: 'clip.trackId',
        beforeValue: prev.trackId,
        afterValue: trackId,
        humanSummary: `Moved clip "${cAfter.name}" from track ${prev.trackId} to ${trackId}`,
      });
    }

    const scalarFields: Array<keyof CanonicalClip> = [
      'name',
      'startTimeSec',
      'durationSec',
      'trimInSec',
      'trimOutSec',
      'speedMultiplier',
      'visible',
      'locked',
      'muted',
      'solo',
      'blendMode',
      'groupId',
      'assetId',
    ];
    for (const f of scalarFields) {
      if (cBefore[f] !== cAfter[f]) {
        pushEntry({
          category: 'clip',
          changeKind: 'modified',
          entityId: cid,
          entityName: cAfter.name,
          trackId,
          sceneId: cAfter.sceneId,
          parameterKey: `clip.${f}`,
          beforeValue: formatDiffVal(cBefore[f]),
          afterValue: formatDiffVal(cAfter[f]),
          humanSummary: `Clip "${cAfter.name}" ${f}: ${formatDiffVal(cBefore[f])} → ${formatDiffVal(cAfter[f])}`,
        });
      }
    }

    // Transform diff
    if (
      JSON.stringify(cBefore.transform) !== JSON.stringify(cAfter.transform)
    ) {
      pushEntry({
        category: 'clip',
        changeKind: 'modified',
        entityId: cid,
        entityName: cAfter.name,
        trackId,
        sceneId: cAfter.sceneId,
        parameterKey: 'clip.transform',
        beforeValue: `pos(${cBefore.transform.position.join(',')}) scale(${cBefore.transform.scale[0]}) rot(${cBefore.transform.rotationDeg}°) op(${cBefore.transform.opacity})`,
        afterValue: `pos(${cAfter.transform.position.join(',')}) scale(${cAfter.transform.scale[0]}) rot(${cAfter.transform.rotationDeg}°) op(${cAfter.transform.opacity})`,
        humanSummary: `Updated spatial transform on "${cAfter.name}"`,
      });
    }

    // Text diff
    if (JSON.stringify(cBefore.textData) !== JSON.stringify(cAfter.textData)) {
      pushEntry({
        category: 'clip',
        changeKind: 'modified',
        entityId: cid,
        entityName: cAfter.name,
        trackId,
        sceneId: cAfter.sceneId,
        parameterKey: 'clip.textData',
        beforeValue: cBefore.textData
          ? `"${cBefore.textData.content}" (${cBefore.textData.fontSizePx}px ${cBefore.textData.colorHex})`
          : 'none',
        afterValue: cAfter.textData
          ? `"${cAfter.textData.content}" (${cAfter.textData.fontSizePx}px ${cAfter.textData.colorHex})`
          : 'none',
        humanSummary: `Updated text on "${cAfter.name}" → "${cAfter.textData?.content || ''}"`,
      });
    }

    // Caption diff
    if (
      JSON.stringify(cBefore.captionData) !== JSON.stringify(cAfter.captionData)
    ) {
      pushEntry({
        category: 'caption',
        changeKind: 'modified',
        entityId: cid,
        entityName: cAfter.name,
        trackId,
        sceneId: cAfter.sceneId,
        parameterKey: 'clip.captionData',
        beforeValue: cBefore.captionData
          ? `"${cBefore.captionData.text}" (${cBefore.captionData.highlightColorHex})`
          : 'none',
        afterValue: cAfter.captionData
          ? `"${cAfter.captionData.text}" (${cAfter.captionData.highlightColorHex})`
          : 'none',
        humanSummary: `Updated caption "${cAfter.captionData?.text || cAfter.name}"`,
      });
    }

    // Audio diff
    if (
      JSON.stringify(cBefore.audioConfig) !== JSON.stringify(cAfter.audioConfig)
    ) {
      pushEntry({
        category: 'audio',
        changeKind: 'modified',
        entityId: cid,
        entityName: cAfter.name,
        trackId,
        sceneId: cAfter.sceneId,
        parameterKey: 'clip.audioConfig',
        beforeValue: cBefore.audioConfig
          ? `${cBefore.audioConfig.gainDb}dB (fade ${cBefore.audioConfig.fadeInSec}s/${cBefore.audioConfig.fadeOutSec}s)`
          : 'none',
        afterValue: cAfter.audioConfig
          ? `${cAfter.audioConfig.gainDb}dB (fade ${cAfter.audioConfig.fadeInSec}s/${cAfter.audioConfig.fadeOutSec}s)`
          : 'none',
        humanSummary: `Updated audio gain/fades on "${cAfter.name}"`,
      });
    }

    // Keyframes diff
    if (JSON.stringify(cBefore.keyframes) !== JSON.stringify(cAfter.keyframes)) {
      pushEntry({
        category: 'keyframe',
        changeKind:
          cAfter.keyframes.length > cBefore.keyframes.length
            ? 'added'
            : cAfter.keyframes.length < cBefore.keyframes.length
            ? 'removed'
            : 'modified',
        entityId: cid,
        entityName: cAfter.name,
        trackId,
        sceneId: cAfter.sceneId,
        parameterKey: 'clip.keyframes',
        beforeValue: cBefore.keyframes
          .map((k) => `${k.property}@${k.timeSec}s=${k.value}`)
          .join(', ') || 'none',
        afterValue: cAfter.keyframes
          .map((k) => `${k.property}@${k.timeSec}s=${k.value}`)
          .join(', ') || 'none',
        humanSummary: `Updated keyframes on "${cAfter.name}" (${cBefore.keyframes.length} → ${cAfter.keyframes.length} keyframes)`,
      });
    }

    // Effects diff
    if (JSON.stringify(cBefore.effects) !== JSON.stringify(cAfter.effects)) {
      pushEntry({
        category: 'effect',
        changeKind:
          cAfter.effects.length > cBefore.effects.length
            ? 'added'
            : cAfter.effects.length < cBefore.effects.length
            ? 'removed'
            : 'modified',
        entityId: cid,
        entityName: cAfter.name,
        trackId,
        sceneId: cAfter.sceneId,
        parameterKey: 'clip.effects',
        beforeValue:
          cBefore.effects
            .map((e) => `${e.name}:${JSON.stringify(e.parameters)}`)
            .join(', ') || 'none',
        afterValue:
          cAfter.effects
            .map((e) => `${e.name}:${JSON.stringify(e.parameters)}`)
            .join(', ') || 'none',
        humanSummary: `Updated effect stack on "${cAfter.name}"`,
      });
    }

    // Transitions diff
    if (
      JSON.stringify(cBefore.inTransition) !==
        JSON.stringify(cAfter.inTransition) ||
      JSON.stringify(cBefore.outTransition) !==
        JSON.stringify(cAfter.outTransition)
    ) {
      pushEntry({
        category: 'transition',
        changeKind: 'modified',
        entityId: cid,
        entityName: cAfter.name,
        trackId,
        sceneId: cAfter.sceneId,
        parameterKey: 'clip.transition',
        beforeValue: cBefore.inTransition
          ? `${cBefore.inTransition.type} (${cBefore.inTransition.durationSec}s)`
          : 'none',
        afterValue: cAfter.inTransition
          ? `${cAfter.inTransition.type} (${cAfter.inTransition.durationSec}s)`
          : cAfter.outTransition
          ? `${cAfter.outTransition.type} (${cAfter.outTransition.durationSec}s)`
          : 'none',
        humanSummary: `Updated transition on "${cAfter.name}"`,
      });
    }
  }

  // 4. Assets diff
  if (
    JSON.stringify(beforeDoc.assetReferences) !==
    JSON.stringify(afterDoc.assetReferences)
  ) {
    pushEntry({
      category: 'asset',
      changeKind: 'modified',
      entityId: afterDoc.id,
      entityName: 'Project Assets',
      parameterKey: 'project.assetReferences',
      beforeValue: `${beforeDoc.assetReferences.length} assets (${beforeDoc.assetReferences.filter((a) => a.missing).length} missing)`,
      afterValue: `${afterDoc.assetReferences.length} assets (${afterDoc.assetReferences.filter((a) => a.missing).length} missing)`,
      humanSummary: `Updated asset bindings (${afterDoc.assetReferences.filter((a) => a.missing).length} missing remaining)`,
    });
  }

  const summaryText =
    entries.length === 0
      ? 'No canonical differences between compared revisions.'
      : `${entries.length} canonical change(s) across ${affectedClipIds.size} clip(s), ${affectedTrackIds.size} track(s), and ${affectedSceneIds.size} scene(s).`;

  return {
    beforeRevision: beforeDoc.revision,
    afterRevision: afterDoc.revision,
    totalChanges: entries.length,
    affectedClipIds: Array.from(affectedClipIds),
    affectedTrackIds: Array.from(affectedTrackIds),
    affectedSceneIds: Array.from(affectedSceneIds),
    affectedParameters: Array.from(affectedParameters),
    summaryText,
    entries,
  };
}

// ============================================================================
// 3. AI CO-EDITING TRANSACTIONS & NATURAL-LANGUAGE COMMAND PLANNER
// ============================================================================

export interface AiProposedOperation {
  id: string;
  label: string;
  rationale: string;
  command: CanonicalProjectCommand;
  affectedTrackId?: string;
  affectedClipIds: string[];
  affectedSceneId?: string;
  affectedParameters: string[];
  destructive: boolean;
  selected: boolean;
}

export interface AiClarifyingQuestion {
  id: string;
  question: string;
  suggestedAnswers: string[];
  contextHint: string;
}

export interface AiCoEditTransaction {
  id: string;
  prompt: string;
  createdAt: string;
  status:
    | 'proposed'
    | 'needs-clarification'
    | 'unsupported-operation'
    | 'applied'
    | 'cancelled'
    | 'rolled-back';
  preconditions: {
    expectedRevision: number;
    selectedClipId: string | null;
    selectedSceneId: string | null;
    playheadSec: number;
    lockedSceneIds: string[];
    lockedClipIds: string[];
  };
  clarifyingQuestions: AiClarifyingQuestion[];
  unsupportedReason?: string;
  operations: AiProposedOperation[];
  proposedDiff: CanonicalProjectDiff;
  requiresDestructiveConfirmation: boolean;
  checkpointSnapshotId?: string;
  appliedRevision?: number;
}

export interface AiCoEditLogEntry {
  id: string;
  transactionId: string;
  timestamp: string;
  prompt: string;
  rationale: string;
  acceptedOperationCount: number;
  rejectedOperationCount: number;
  affectedClipIds: string[];
  affectedTrackIds: string[];
  affectedParameters: string[];
  beforeRevision: number;
  afterRevision: number;
  checkpointSnapshotId: string;
  diffSummary: string;
  rolledBack: boolean;
}

const NAMED_COLORS: Record<string, string> = {
  orange: '#F06424',
  emerald: '#55B98B',
  green: '#55B98B',
  amber: '#E4B45A',
  gold: '#E4B45A',
  crimson: '#F06464',
  red: '#F06464',
  cyan: '#38BDF8',
  blue: '#3B82F6',
  violet: '#A855F7',
  purple: '#A855F7',
  white: '#F3EEE8',
  dark: '#141824',
  midnight: '#0F172A',
  charcoal: '#181412',
};

function extractColorHexFromPrompt(prompt: string, fallback = '#55B98B'): string {
  const hexMatch = prompt.match(/#([0-9A-Fa-f]{6})\b/);
  if (hexMatch) return `#${hexMatch[1].toUpperCase()}`;
  const lower = prompt.toLowerCase();
  for (const [name, hex] of Object.entries(NAMED_COLORS)) {
    if (lower.includes(name)) return hex;
  }
  return fallback;
}

function findPrimaryOrSelectedClip(
  project: CanonicalProjectDocument,
  selectedClipId: string | null,
  preferredKinds?: Array<CanonicalClip['kind']>
): { clip: CanonicalClip; trackId: string } | null {
  if (selectedClipId) {
    for (const t of project.tracks) {
      const found = t.clips.find((c) => c.id === selectedClipId);
      if (found && (!preferredKinds || preferredKinds.includes(found.kind))) {
        return { clip: found, trackId: t.id };
      }
    }
  }
  for (const t of project.tracks) {
    for (const c of t.clips) {
      if (!c.locked && (!preferredKinds || preferredKinds.includes(c.kind))) {
        return { clip: c, trackId: t.id };
      }
    }
  }
  return null;
}

/**
 * Dry-runs the selected operations in an AiCoEditTransaction against a clone of the
 * canonical project to produce an exact, schema-validated `CanonicalProjectDiff`.
 */
export function simulateOperationsDiff(
  project: CanonicalProjectDocument,
  operations: AiProposedOperation[]
): {
  previewProject: CanonicalProjectDocument;
  diff: CanonicalProjectDiff;
  simulationErrors: string[];
} {
  let working: CanonicalProjectDocument = JSON.parse(JSON.stringify(project));
  const simulationErrors: string[] = [];

  for (const op of operations) {
    if (!op.selected) continue;
    const res = executeProjectCommand(working, op.command, {
      actorId: 'ai-co-editor',
      actorKind: 'ai-director',
      rationale: op.rationale,
      approvedByUser: false,
    });
    if (res.receipt.ok) {
      working = res.project;
    } else {
      simulationErrors.push(...res.receipt.errors);
    }
  }

  return {
    previewProject: working,
    diff: diffCanonicalProjects(project, working),
    simulationErrors,
  };
}

/**
 * Parses a natural-language co-editing prompt against the live CanonicalProjectDocument
 * and current editor context (selected clip, selected scene, playhead time/frame),
 * returning an `AiCoEditTransaction` with preconditions, proposed operations, and diff.
 */
export function planAiCoEditTransaction(params: {
  project: CanonicalProjectDocument;
  prompt: string;
  selectedClipId?: string | null;
  selectedSceneId?: string | null;
  playheadSec?: number;
}): AiCoEditTransaction {
  const { project } = params;
  const rawPrompt = params.prompt.trim();
  const lower = rawPrompt.toLowerCase();
  const selectedClipId = params.selectedClipId ?? null;
  const selectedSceneId = params.selectedSceneId ?? (project.scenes[0]?.id || null);
  const playheadSec = Number((params.playheadSec ?? 0).toFixed(3));
  const now = new Date().toISOString();
  const txId = `aitx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const lockedSceneIds = project.scenes
    .filter((s) => s.status === 'locked')
    .map((s) => s.id);
  const lockedClipIds: string[] = [];
  for (const t of project.tracks) {
    for (const c of t.clips) {
      if (c.locked) lockedClipIds.push(c.id);
    }
  }

  const preconditions = {
    expectedRevision: project.revision,
    selectedClipId,
    selectedSceneId,
    playheadSec,
    lockedSceneIds,
    lockedClipIds,
  };

  const emptyDiff = diffCanonicalProjects(project, project);

  if (!rawPrompt) {
    return {
      id: txId,
      prompt: rawPrompt,
      createdAt: now,
      status: 'needs-clarification',
      preconditions,
      clarifyingQuestions: [
        {
          id: 'q_empty_prompt',
          question: 'What edit would you like to perform on the timeline?',
          suggestedAnswers: [
            'Change title to "Ship Faster on Android"',
            'Slow entrance from 0.3 to 0.7 seconds',
            'Create a softer transition',
            'Adjust accent palette to #55B98B',
          ],
          contextHint: 'Describe a title, timing, transition, effect, audio, caption, or scene adjustment.',
        },
      ],
      operations: [],
      proposedDiff: emptyDiff,
      requiresDestructiveConfirmation: false,
    };
  }

  // Check for explicitly unsupported capabilities (Honest Capability Gate — never fake!)
  if (
    lower.includes('cloth simulation') ||
    lower.includes('fluid simulation') ||
    lower.includes('stem separation') ||
    lower.includes('rotoscope') ||
    lower.includes('cinema 4d') ||
    lower.includes('after effects plugin')
  ) {
    return {
      id: txId,
      prompt: rawPrompt,
      createdAt: now,
      status: 'unsupported-operation',
      preconditions,
      clarifyingQuestions: [],
      unsupportedReason:
        'This operation requires desktop GPU physics/stem-separation engines that are not implemented in the mobile canonical 2D/vector runtime. Use supported timeline, keyframe, effect, transition, audio, or template rig commands.',
      operations: [],
      proposedDiff: emptyDiff,
      requiresDestructiveConfirmation: false,
    };
  }

  const operations: AiProposedOperation[] = [];
  let opIndex = 0;
  const addOp = (op: Omit<AiProposedOperation, 'id' | 'selected'>) => {
    opIndex += 1;
    operations.push({
      ...op,
      id: `aiop_${opIndex}_${op.command.type}`,
      selected: true,
    });
  };

  // ==========================================================================
  // ARCHETYPE 10: "Refine scene X while locking scene Y"
  // ==========================================================================
  const refineLockMatch = lower.match(
    /refine\s+scene\s+(\d+|[a-z0-9_-]+)\s+while\s+locking\s+scene\s+(\d+|[a-z0-9_-]+)/i
  ) || lower.match(
    /lock\s+scene\s+(\d+|[a-z0-9_-]+)\s+and\s+refine\s+scene\s+(\d+|[a-z0-9_-]+)/i
  );

  if (refineLockMatch) {
    const isLockFirst = lower.startsWith('lock');
    const refineRef = isLockFirst ? refineLockMatch[2] : refineLockMatch[1];
    const lockRef = isLockFirst ? refineLockMatch[1] : refineLockMatch[2];

    const resolveScene = (ref: string) => {
      const byId = project.scenes.find((s) => s.id.toLowerCase() === ref.toLowerCase());
      if (byId) return byId;
      const num = Number(ref);
      if (Number.isFinite(num) && num >= 1) {
        const padded = String(num).padStart(2, '0');
        return (
          project.scenes.find(
            (s) => s.id === `scene_${num}` || s.id === `scene_${padded}`
          ) || project.scenes[num - 1]
        );
      }
      return undefined;
    };

    const sceneToLock = resolveScene(lockRef);
    const sceneToRefine = resolveScene(refineRef);

    if (!sceneToLock || !sceneToRefine) {
      return {
        id: txId,
        prompt: rawPrompt,
        createdAt: now,
        status: 'needs-clarification',
        preconditions,
        clarifyingQuestions: [
          {
            id: 'q_missing_scene_target',
            question: `Project currently has ${project.scenes.length} scene(s) (${project.scenes.map((s) => s.id).join(', ')}). Which scenes should be locked and refined?`,
            suggestedAnswers:
              project.scenes.length >= 2
                ? [
                    `Refine ${project.scenes[project.scenes.length - 1].id} while locking ${project.scenes[0].id}`,
                  ]
                : ['Duplicate scene 1 and retain its source mapping'],
            contextHint: 'Specify existing scene numbers or duplicate a scene first.',
          },
        ],
        operations: [],
        proposedDiff: emptyDiff,
        requiresDestructiveConfirmation: false,
      };
    }

    // 1. Lock scene Y
    addOp({
      label: `Lock ${sceneToLock.title} (${sceneToLock.id})`,
      rationale: `User requested locking ${sceneToLock.title} so its clips cannot be modified during refinement.`,
      command: {
        type: 'setSceneState',
        sceneId: sceneToLock.id,
        status: 'locked',
        lockSceneClips: true,
      },
      affectedSceneId: sceneToLock.id,
      affectedClipIds: project.tracks
        .flatMap((t) => t.clips)
        .filter((c) => c.sceneId === sceneToLock.id)
        .map((c) => c.id),
      affectedParameters: ['scene.status', 'clip.locked'],
      destructive: false,
    });

    // 2. Refine clips in scene X
    const refineClips = project.tracks
      .flatMap((t) => t.clips.map((c) => ({ clip: c, trackId: t.id })))
      .filter(({ clip }) => clip.sceneId === sceneToRefine.id && !clip.locked);

    for (const { clip, trackId } of refineClips) {
      if (clip.kind === 'text' || clip.kind === 'template-instance') {
        addOp({
          label: `Refine headline polish on "${clip.name}" (${sceneToRefine.title})`,
          rationale: `Enhance typography contrast and add smooth cross-dissolve transition in ${sceneToRefine.title} while ${sceneToLock.title} stays locked.`,
          command: {
            type: 'insertTransition',
            clipId: clip.id,
            edge: 'in',
            transition: {
              type: 'cross-dissolve',
              durationSec: Math.min(0.55, Number((clip.durationSec * 0.35).toFixed(2))),
              easingCurve: [0.22, 1, 0.36, 1],
              parameters: { softness: 0.85 },
            },
          },
          affectedTrackId: trackId,
          affectedClipIds: [clip.id],
          affectedSceneId: sceneToRefine.id,
          affectedParameters: ['clip.inTransition'],
          destructive: false,
        });

        addOp({
          label: `Add Optical Glow polish to "${clip.name}" (${sceneToRefine.title})`,
          rationale: `Add subtle accent glow in ${sceneToRefine.title} without touching locked ${sceneToLock.title}.`,
          command: {
            type: 'addEffect',
            clipId: clip.id,
            effect: {
              effectType: 'optical-glow',
              name: 'Scene Refinement Glow',
              enabled: true,
              rendererSupport: 'supported',
              supportedInAlightXml: true,
              parameters: {
                radiusPx: 22,
                intensity: 0.78,
                tintColor: '#F06424',
              },
            },
          },
          affectedTrackId: trackId,
          affectedClipIds: [clip.id],
          affectedSceneId: sceneToRefine.id,
          affectedParameters: ['clip.effects'],
          destructive: false,
        });
      }
    }
  }

  // ==========================================================================
  // ARCHETYPE 1: "Change title to specified text" / "Set headline to ..."
  // ==========================================================================
  if (
    operations.length === 0 &&
    /(?:change|set|update|edit)\s+(?:the\s+)?(?:title|headline|text)/i.test(rawPrompt)
  ) {
    const quotedMatch =
      rawPrompt.match(/["“”'‘’]([^"“”'‘’]+)["“”'‘’]/) ||
      rawPrompt.match(/(?:title|headline|text)\s+to\s+(.+)$/i);
    const newText = quotedMatch ? quotedMatch[1].trim() : '';

    if (!newText) {
      return {
        id: txId,
        prompt: rawPrompt,
        createdAt: now,
        status: 'needs-clarification',
        preconditions,
        clarifyingQuestions: [
          {
            id: 'q_missing_title_text',
            question: 'What exact text should the title be changed to?',
            suggestedAnswers: [
              'Change title to "Sowveil Mobile Pro 2.0"',
              'Change title to "Ship Motion Faster on Android"',
            ],
            contextHint: 'Put the desired title in quotes or after "Change title to ...".',
          },
        ],
        operations: [],
        proposedDiff: emptyDiff,
        requiresDestructiveConfirmation: false,
      };
    }

    const target = findPrimaryOrSelectedClip(project, selectedClipId, [
      'text',
      'template-instance',
    ]);
    if (!target) {
      return {
        id: txId,
        prompt: rawPrompt,
        createdAt: now,
        status: 'needs-clarification',
        preconditions,
        clarifyingQuestions: [
          {
            id: 'q_no_text_clip',
            question: 'No unlocked text or template clip was found. Would you like to create a new text clip at the playhead?',
            suggestedAnswers: [
              `Add text clip "${newText}" at playhead`,
            ],
            contextHint: 'Select a text clip or unlock the text track.',
          },
        ],
        operations: [],
        proposedDiff: emptyDiff,
        requiresDestructiveConfirmation: false,
      };
    }

    addOp({
      label: `Set title copy on "${target.clip.name}" to "${newText}"`,
      rationale: `Updated clip textData.content to "${newText}" via typed setTextProperties command.`,
      command: {
        type: 'setTextProperties',
        clipId: target.clip.id,
        textData: {
          content: newText,
        },
      },
      affectedTrackId: target.trackId,
      affectedClipIds: [target.clip.id],
      affectedSceneId: target.clip.sceneId,
      affectedParameters: ['clip.textData.content'],
      destructive: false,
    });

    if (target.clip.templateBinding) {
      const eff = target.clip.effects[0];
      if (eff) {
        addOp({
          label: `Sync template parameter override headline="${newText}"`,
          rationale: 'Keep templateBinding.parameterOverrides synchronized with textData.',
          command: {
            type: 'setEffectParameter',
            clipId: target.clip.id,
            effectId: eff.id,
            parameterKey: 'headline',
            value: newText,
          },
          affectedTrackId: target.trackId,
          affectedClipIds: [target.clip.id],
          affectedSceneId: target.clip.sceneId,
          affectedParameters: ['templateBinding.parameterOverrides.headline'],
          destructive: false,
        });
      }
    }
  }

  // ==========================================================================
  // ARCHETYPE 2: "Slow entrance from 0.3 to 0.7 seconds"
  // ==========================================================================
  if (
    operations.length === 0 &&
    (lower.includes('slow entrance') ||
      lower.includes('slow the entrance') ||
      lower.includes('entrance from') ||
      lower.includes('entrance animation') ||
      lower.includes('speed up entrance') ||
      lower.includes('entrance duration'))
  ) {
    const secMatches = Array.from(rawPrompt.matchAll(/(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)?/gi)).map(
      (m) => Number(m[1])
    );
    const targetDurationSec =
      secMatches.length >= 2
        ? secMatches[1]
        : secMatches.length === 1
        ? secMatches[0]
        : 0.7;

    const target = findPrimaryOrSelectedClip(project, selectedClipId);
    if (target) {
      const { clip, trackId } = target;
      const newKfTime = Number((clip.startTimeSec + targetDurationSec).toFixed(3));
      const settledKf =
        clip.keyframes.find((k) => k.timeSec > clip.startTimeSec) ||
        clip.keyframes[clip.keyframes.length - 1];

      if (settledKf) {
        addOp({
          label: `Retarget entrance keyframe "${settledKf.id}" (${settledKf.property}) to ${newKfTime}s`,
          rationale: `Adjusted entrance settle keyframe from ${settledKf.timeSec}s to ${newKfTime}s (${targetDurationSec}s entrance duration) with cubic-bezier easing.`,
          command: {
            type: 'updateKeyframe',
            clipId: clip.id,
            keyframeId: settledKf.id,
            patch: {
              timeSec: newKfTime,
              interpolation: 'cubic-bezier',
              cubicBezier: [0.16, 1, 0.3, 1],
              easingPresetId: 'expo-out',
            },
          },
          affectedTrackId: trackId,
          affectedClipIds: [clip.id],
          affectedSceneId: clip.sceneId,
          affectedParameters: ['clip.keyframes.timeSec', 'clip.keyframes.cubicBezier'],
          destructive: false,
        });
      } else {
        addOp({
          label: `Create entrance keyframe pair (0s → ${targetDurationSec}s) on "${clip.name}"`,
          rationale: `Added opacity entrance keyframe at ${newKfTime}s (${targetDurationSec}s entrance).`,
          command: {
            type: 'addKeyframe',
            clipId: clip.id,
            keyframe: {
              property: 'opacity',
              timeSec: newKfTime,
              value: 1,
              interpolation: 'cubic-bezier',
              cubicBezier: [0.16, 1, 0.3, 1],
              easingPresetId: 'expo-out',
            },
          },
          affectedTrackId: trackId,
          affectedClipIds: [clip.id],
          affectedSceneId: clip.sceneId,
          affectedParameters: ['clip.keyframes'],
          destructive: false,
        });
      }
    }
  }

  // ==========================================================================
  // ARCHETYPE 3: "Replace scene background"
  // ==========================================================================
  if (
    operations.length === 0 &&
    (lower.includes('replace scene background') ||
      lower.includes('replace the scene background') ||
      lower.includes('change scene background') ||
      lower.includes('change the scene background') ||
      lower.includes('replace background'))
  ) {
    const bgHex = extractColorHexFromPrompt(rawPrompt, '#141824');
    addOp({
      label: `Update canvas background color to ${bgHex}`,
      rationale: `Updated canonical canvas backgroundColorHex to ${bgHex}.`,
      command: {
        type: 'updateCanvas',
        canvas: {
          backgroundColorHex: bgHex,
        },
      },
      affectedClipIds: [],
      affectedParameters: ['canvas.backgroundColorHex'],
      destructive: false,
    });

    const vectorTrack =
      project.tracks.find((t) => t.kind === 'vector' && !t.locked) ||
      project.tracks.find((t) => !t.locked);
    if (vectorTrack) {
      const existingBgClip = vectorTrack.clips.find((c) => !c.locked && c.kind === 'vector');
      if (existingBgClip) {
        addOp({
          label: `Replace background vector plate asset on "${existingBgClip.name}"`,
          rationale: `Bound replacement background plate asset to clip "${existingBgClip.name}".`,
          command: {
            type: 'replaceAsset',
            clipId: existingBgClip.id,
            newAssetId: `asset_bg_plate_${bgHex.slice(1).toLowerCase()}`,
            slotKey: 'background_plate',
            assetTitle: `Scene Background Plate (${bgHex})`,
            mimeType: 'image/svg+xml',
            licenseType: 'Sowveil Original',
          },
          affectedTrackId: vectorTrack.id,
          affectedClipIds: [existingBgClip.id],
          affectedSceneId: existingBgClip.sceneId,
          affectedParameters: ['clip.assetId', 'project.assetReferences'],
          destructive: false,
        });
      } else {
        addOp({
          label: `Create scene background plate clip (${bgHex}) on "${vectorTrack.name}"`,
          rationale: `Created full-duration vector background plate on track "${vectorTrack.name}".`,
          command: {
            type: 'createClip',
            trackId: vectorTrack.id,
            clip: {
              name: `Scene Background Plate (${bgHex})`,
              kind: 'vector',
              sceneId: selectedSceneId || project.scenes[0]?.id,
              startTimeSec: 0,
              durationSec: project.canvas.durationSec,
              vectorData: {
                shapeType: 'liquid-glass-card',
                svgPathData: 'M 60 120 L 1020 120 L 1020 1800 L 60 1800 Z',
                fillColorHex: bgHex,
                strokeColorHex: '#F06424',
                strokeWidthPx: 2,
                cornerRadiusPx: 28,
              },
            },
          },
          affectedTrackId: vectorTrack.id,
          affectedClipIds: [],
          affectedSceneId: selectedSceneId || undefined,
          affectedParameters: ['track.clips'],
          destructive: false,
        });
      }
    }
  }

  // ==========================================================================
  // ARCHETYPE 4: "Adjust accent palette"
  // ==========================================================================
  if (
    operations.length === 0 &&
    (lower.includes('accent palette') ||
      lower.includes('accent color') ||
      lower.includes('brand palette'))
  ) {
    const accentHex = extractColorHexFromPrompt(rawPrompt, '#55B98B');
    for (const track of project.tracks) {
      if (track.locked) continue;
      for (const clip of track.clips) {
        if (clip.locked) continue;
        const scene = clip.sceneId
          ? project.scenes.find((s) => s.id === clip.sceneId)
          : undefined;
        if (scene?.status === 'locked') continue;

        if (clip.kind === 'text' || clip.kind === 'template-instance') {
          addOp({
            label: `Apply accent ${accentHex} to text clip "${clip.name}"`,
            rationale: `Updated text colorHex and strokeColorHex on "${clip.name}" to ${accentHex}.`,
            command: {
              type: 'setTextProperties',
              clipId: clip.id,
              textData: {
                colorHex: accentHex,
                strokeColorHex: accentHex,
              },
            },
            affectedTrackId: track.id,
            affectedClipIds: [clip.id],
            affectedSceneId: clip.sceneId,
            affectedParameters: ['clip.textData.colorHex', 'clip.textData.strokeColorHex'],
            destructive: false,
          });
        } else if (clip.kind === 'caption') {
          addOp({
            label: `Apply accent highlight ${accentHex} to caption "${clip.name}"`,
            rationale: `Updated caption highlightColorHex to ${accentHex}.`,
            command: {
              type: 'alterCaption',
              clipId: clip.id,
              highlightColorHex: accentHex,
            },
            affectedTrackId: track.id,
            affectedClipIds: [clip.id],
            affectedSceneId: clip.sceneId,
            affectedParameters: ['clip.captionData.highlightColorHex'],
            destructive: false,
          });
        }

        for (const eff of clip.effects) {
          if ('tintColor' in eff.parameters || 'accentColor' in eff.parameters) {
            const paramKey = 'accentColor' in eff.parameters ? 'accentColor' : 'tintColor';
            addOp({
              label: `Set ${eff.name} ${paramKey} to ${accentHex} on "${clip.name}"`,
              rationale: `Synchronized effect ${paramKey} with new accent palette ${accentHex}.`,
              command: {
                type: 'setEffectParameter',
                clipId: clip.id,
                effectId: eff.id,
                parameterKey: paramKey,
                value: accentHex,
              },
              affectedTrackId: track.id,
              affectedClipIds: [clip.id],
              affectedSceneId: clip.sceneId,
              affectedParameters: [`clip.effects.${paramKey}`],
              destructive: false,
            });
          }
        }
      }
    }
  }

  // ==========================================================================
  // ARCHETYPE 5: "Add a provided SFX at selected frame"
  // ==========================================================================
  if (
    operations.length === 0 &&
    (lower.includes('sfx') || lower.includes('sound effect') || lower.includes('whoosh') || lower.includes('riser'))
  ) {
    const frameMatch = lower.match(/frame\s+(\d+)/i);
    const secMatch = lower.match(/at\s+(\d+(?:\.\d+)?)\s*s/i);
    const targetSec = frameMatch
      ? Number((Number(frameMatch[1]) / project.canvas.fps).toFixed(3))
      : secMatch
      ? Number(Number(secMatch[1]).toFixed(3))
      : playheadSec;

    const sfxPreset = lower.includes('riser')
      ? 'cyber-riser-01'
      : lower.includes('sub') || lower.includes('drop')
      ? 'bass-sub-drop-01'
      : lower.includes('click') || lower.includes('pop')
      ? 'ui-tactile-pop-01'
      : 'cinematic-whoosh-hit';

    let audioTrack = project.tracks.find((t) => t.kind === 'audio' && !t.locked);
    const targetTrackId = audioTrack ? audioTrack.id : 'track_audio_auto';

    if (!audioTrack) {
      addOp({
        label: 'Create Audio & SFX Track',
        rationale: 'Created dedicated audio track for SFX cue placement.',
        command: {
          type: 'createTrack',
          trackId: targetTrackId,
          name: 'Audio & SFX',
          kind: 'audio',
        },
        affectedTrackId: targetTrackId,
        affectedClipIds: [],
        affectedParameters: ['project.tracks'],
        destructive: false,
      });
    }

    const frameNumber = Math.round(targetSec * project.canvas.fps);
    addOp({
      label: `Insert "${sfxPreset}" SFX at ${targetSec.toFixed(2)}s (Frame #${frameNumber})`,
      rationale: `Added procedural SFX clip "${sfxPreset}" at ${targetSec.toFixed(2)}s (Frame #${frameNumber}).`,
      command: {
        type: 'createClip',
        trackId: targetTrackId,
        clip: {
          name: `SFX · ${sfxPreset}`,
          kind: 'audio',
          sceneId: selectedSceneId || project.scenes[0]?.id,
          startTimeSec: targetSec,
          durationSec: 1.4,
          audioConfig: {
            gainDb: -1.0,
            linearGain: 0.8913,
            pan: 0,
            fadeInSec: 0.04,
            fadeOutSec: 0.2,
            muted: false,
            proceduralSfxPreset: sfxPreset,
            waveformPeaks: [0.12, 0.58, 0.96, 0.74, 0.41, 0.18, 0.06],
          },
        },
      },
      affectedTrackId: targetTrackId,
      affectedClipIds: [],
      affectedSceneId: selectedSceneId || undefined,
      affectedParameters: ['track.clips', 'clip.audioConfig'],
      destructive: false,
    });
  }

  // ==========================================================================
  // ARCHETYPE 6: "Re-time captions to selected narration"
  // ==========================================================================
  if (
    operations.length === 0 &&
    (lower.includes('re-time caption') ||
      lower.includes('retime caption') ||
      lower.includes('sync caption') ||
      lower.includes('align caption'))
  ) {
    const audioTarget = findPrimaryOrSelectedClip(project, selectedClipId, ['audio']);
    const windowStart = audioTarget ? audioTarget.clip.startTimeSec : 0;
    const windowDuration = audioTarget
      ? audioTarget.clip.durationSec
      : project.canvas.durationSec;

    const captionClips: Array<{ clip: CanonicalClip; trackId: string }> = [];
    for (const t of project.tracks) {
      if (t.locked) continue;
      for (const c of t.clips) {
        if (c.kind === 'caption' && !c.locked) {
          captionClips.push({ clip: c, trackId: t.id });
        }
      }
    }

    if (captionClips.length === 0) {
      const capTrack =
        project.tracks.find((t) => t.kind === 'caption' && !t.locked) ||
        project.tracks[0];
      if (capTrack) {
        addOp({
          label: `Create narration-synced caption cue (${windowStart.toFixed(2)}s → ${(windowStart + windowDuration).toFixed(2)}s)`,
          rationale: 'Created caption clip synchronized to narration window.',
          command: {
            type: 'createClip',
            trackId: capTrack.id,
            clip: {
              name: project.title,
              kind: 'caption',
              startTimeSec: windowStart,
              durationSec: Math.max(0.5, windowDuration),
              captionData: {
                cueIndex: 1,
                text: project.title,
                speaker: 'Narrator',
                stylePresetId: 'hormozi-highlight',
                highlightColorHex: '#F06424',
                maxCharsPerLine: 36,
              },
            },
          },
          affectedTrackId: capTrack.id,
          affectedClipIds: [],
          affectedParameters: ['track.clips', 'clip.captionData'],
          destructive: false,
        });
      }
    } else {
      const slotDur = Number((windowDuration / captionClips.length).toFixed(3));
      captionClips.forEach(({ clip, trackId }, idx) => {
        const nextStart = Number((windowStart + idx * slotDur).toFixed(3));
        const nextDur = Math.max(0.25, Number((slotDur - 0.04).toFixed(3)));
        addOp({
          label: `Re-time caption #${idx + 1} "${clip.captionData?.text || clip.name}" to ${nextStart.toFixed(2)}s (${nextDur.toFixed(2)}s)`,
          rationale: `Aligned caption cue #${idx + 1} to narration window (${windowStart.toFixed(2)}s..${(windowStart + windowDuration).toFixed(2)}s).`,
          command: {
            type: 'alterCaption',
            clipId: clip.id,
            startTimeSec: nextStart,
            durationSec: nextDur,
          },
          affectedTrackId: trackId,
          affectedClipIds: [clip.id],
          affectedSceneId: clip.sceneId,
          affectedParameters: ['clip.startTimeSec', 'clip.durationSec'],
          destructive: false,
        });
      });
    }
  }

  // ==========================================================================
  // ARCHETYPE 7: "Duplicate a scene but retain its source mapping"
  // ==========================================================================
  if (
    operations.length === 0 &&
    (lower.includes('duplicate scene') || lower.includes('duplicate a scene'))
  ) {
    const sceneNumMatch = lower.match(/scene\s+(\d+)/i);
    const targetScene =
      (sceneNumMatch &&
        (project.scenes.find(
          (s) =>
            s.id === `scene_${sceneNumMatch[1]}` ||
            s.id === `scene_${String(sceneNumMatch[1]).padStart(2, '0')}`
        ) ||
          project.scenes[Number(sceneNumMatch[1]) - 1])) ||
      project.scenes.find((s) => s.id === selectedSceneId) ||
      project.scenes[0];

    if (targetScene) {
      const retainMapping = !lower.includes('without source');
      addOp({
        label: `Duplicate "${targetScene.title}" (${targetScene.id}) retaining scriptSegmentIds [${targetScene.scriptSegmentIds.join(', ')}]`,
        rationale: `Duplicated scene ${targetScene.id} and its timeline clips while preserving scriptSegmentIds and sourceSegmentId mappings.`,
        command: {
          type: 'duplicateScene',
          sceneId: targetScene.id,
          retainSourceMapping: retainMapping,
        },
        affectedSceneId: targetScene.id,
        affectedClipIds: project.tracks
          .flatMap((t) => t.clips)
          .filter((c) => c.sceneId === targetScene.id)
          .map((c) => c.id),
        affectedParameters: ['project.scenes', 'track.clips', 'clip.sourceSegmentId'],
        destructive: false,
      });
    }
  }

  // ==========================================================================
  // ARCHETYPE 8: "Create a softer transition"
  // ==========================================================================
  if (
    operations.length === 0 &&
    (lower.includes('softer transition') ||
      lower.includes('soft transition') ||
      lower.includes('cross-dissolve') ||
      lower.includes('transition'))
  ) {
    const target = findPrimaryOrSelectedClip(project, selectedClipId);
    if (target) {
      const durMatch = lower.match(/(\d+(?:\.\d+)?)\s*s/);
      const desiredDur = durMatch ? Number(durMatch[1]) : 0.65;
      const safeDur = Math.max(
        0.15,
        Math.min(Number((target.clip.durationSec * 0.45).toFixed(2)), desiredDur)
      );
      addOp({
        label: `Insert ${safeDur}s Cross-Dissolve transition on "${target.clip.name}"`,
        rationale: `Applied soft cross-dissolve transition (${safeDur}s, cubic-bezier [0.25, 0.1, 0.25, 1.0]) on clip "${target.clip.name}".`,
        command: {
          type: 'insertTransition',
          clipId: target.clip.id,
          edge: lower.includes('out') ? 'out' : 'in',
          transition: {
            type: 'cross-dissolve',
            durationSec: safeDur,
            easingCurve: [0.25, 0.1, 0.25, 1.0],
            parameters: {
              softness: 0.9,
              feather: 0.75,
            },
          },
        },
        affectedTrackId: target.trackId,
        affectedClipIds: [target.clip.id],
        affectedSceneId: target.clip.sceneId,
        affectedParameters: ['clip.inTransition'],
        destructive: false,
      });
    }
  }

  // ==========================================================================
  // ARCHETYPE 9: "Change one effect's parameter"
  // ==========================================================================
  if (
    operations.length === 0 &&
    (lower.includes('effect') ||
      lower.includes('glow') ||
      lower.includes('blur') ||
      lower.includes('intensity') ||
      lower.includes('radius'))
  ) {
    const target = findPrimaryOrSelectedClip(project, selectedClipId);
    if (target) {
      const numMatch = rawPrompt.match(/(\d+(?:\.\d+)?)/);
      const val = numMatch ? Number(numMatch[1]) : 0.85;
      const paramKey = lower.includes('radius')
        ? 'radiusPx'
        : lower.includes('blur')
        ? 'blurLengthPx'
        : lower.includes('angle')
        ? 'angleDeg'
        : 'intensity';

      const existingEff = target.clip.effects[0];
      if (existingEff) {
        addOp({
          label: `Set effect "${existingEff.name}" parameter ${paramKey} = ${val} on "${target.clip.name}"`,
          rationale: `Updated effect parameter "${paramKey}" to ${val} via setEffectParameter.`,
          command: {
            type: 'setEffectParameter',
            clipId: target.clip.id,
            effectId: existingEff.id,
            parameterKey: paramKey,
            value: val,
            enabled: true,
          },
          affectedTrackId: target.trackId,
          affectedClipIds: [target.clip.id],
          affectedSceneId: target.clip.sceneId,
          affectedParameters: [`clip.effects.${paramKey}`],
          destructive: false,
        });
      } else {
        addOp({
          label: `Add Optical Glow (${paramKey} = ${val}) to "${target.clip.name}"`,
          rationale: `Added optical-glow effect with ${paramKey}=${val} because clip had no active effect.`,
          command: {
            type: 'addEffect',
            clipId: target.clip.id,
            effect: {
              effectType: 'optical-glow',
              name: 'Optical Neon Glow',
              enabled: true,
              rendererSupport: 'supported',
              supportedInAlightXml: true,
              parameters: {
                [paramKey]: val,
                tintColor: '#F06424',
              },
            },
          },
          affectedTrackId: target.trackId,
          affectedClipIds: [target.clip.id],
          affectedSceneId: target.clip.sceneId,
          affectedParameters: [`clip.effects.${paramKey}`],
          destructive: false,
        });
      }
    }
  }

  // ==========================================================================
  // AMBIGUOUS DELETE / DESTRUCTIVE TARGET CHECK
  // ==========================================================================
  if (
    operations.length === 0 &&
    (lower.includes('delete') || lower.includes('remove'))
  ) {
    const allClips = project.tracks.flatMap((t) => t.clips);
    if (!selectedClipId && allClips.length > 1) {
      return {
        id: txId,
        prompt: rawPrompt,
        createdAt: now,
        status: 'needs-clarification',
        preconditions,
        clarifyingQuestions: [
          {
            id: 'q_ambiguous_delete',
            question: `There are ${allClips.length} clips on the timeline and none is currently selected. Which clip should be deleted?`,
            suggestedAnswers: allClips
              .slice(0, 3)
              .map((c) => `Delete clip "${c.name}" (${c.id})`),
            contextHint: 'Select a clip on the timeline first or specify the clip ID.',
          },
        ],
        operations: [],
        proposedDiff: emptyDiff,
        requiresDestructiveConfirmation: true,
      };
    }
    const target = findPrimaryOrSelectedClip(project, selectedClipId);
    if (target) {
      addOp({
        label: `Delete clip "${target.clip.name}" (${target.clip.id})`,
        rationale: `Deleting selected clip "${target.clip.name}" from track ${target.trackId}.`,
        command: {
          type: 'deleteClip',
          clipId: target.clip.id,
        },
        affectedTrackId: target.trackId,
        affectedClipIds: [target.clip.id],
        affectedSceneId: target.clip.sceneId,
        affectedParameters: ['track.clips'],
        destructive: true,
      });
    }
  }

  // If still no operations matched, return clarifying question instead of faking!
  if (operations.length === 0) {
    return {
      id: txId,
      prompt: rawPrompt,
      createdAt: now,
      status: 'needs-clarification',
      preconditions,
      clarifyingQuestions: [
        {
          id: 'q_unrecognized_intent',
          question:
            'Could you clarify which clip, scene, or parameter you want to change?',
          suggestedAnswers: [
            'Change title to "Velocity 2.0 Launch"',
            'Slow entrance from 0.3 to 0.7 seconds',
            'Replace scene background with #141824',
            'Adjust accent palette to #55B98B',
            'Add whoosh SFX at selected frame',
            'Re-time captions to selected narration',
            'Duplicate scene 1 and retain its source mapping',
            'Create a softer transition',
            'Set glow intensity to 0.85',
          ],
          contextHint:
            'AI Co-Editor only executes verified canonical commands and never rewrites unvalidated project JSON.',
        },
      ],
      operations: [],
      proposedDiff: emptyDiff,
      requiresDestructiveConfirmation: false,
    };
  }

  const simulation = simulateOperationsDiff(project, operations);

  return {
    id: txId,
    prompt: rawPrompt,
    createdAt: now,
    status: 'proposed',
    preconditions,
    clarifyingQuestions: [],
    operations,
    proposedDiff: simulation.diff,
    requiresDestructiveConfirmation:
      operations.some((op) => op.destructive) || operations.length >= 3,
  };
}

/**
 * Applies the user-selected subset of operations in an `AiCoEditTransaction` atomically:
 * 1. Verifies preconditions (revision match).
 * 2. Creates a reversible snapshot checkpoint (`createSnapshot`).
 * 3. Dispatches each selected operation via `executeProjectCommand`.
 * 4. Validates the final project via `validateCanonicalProject` (rolls back on any failure).
 */
export function applyAiCoEditTransaction(params: {
  project: CanonicalProjectDocument;
  transaction: AiCoEditTransaction;
  selectedOperationIds?: string[];
  actorId?: string;
}): {
  ok: boolean;
  project: CanonicalProjectDocument;
  transaction: AiCoEditTransaction;
  logEntry?: AiCoEditLogEntry;
  receipts: ProjectCommandReceipt[];
  errors: string[];
} {
  const { project, transaction } = params;
  const actorId = params.actorId || project.ownerUid || 'user-local';
  const beforeRevision = project.revision;

  // 1. Precondition check
  if (transaction.preconditions.expectedRevision !== project.revision) {
    return {
      ok: false,
      project,
      transaction,
      receipts: [],
      errors: [
        `PRECONDITION_FAILED: Transaction was planned against revision r${transaction.preconditions.expectedRevision}, but current project is at r${project.revision}. Re-plan the transaction.`,
      ],
    };
  }

  const selectedSet = params.selectedOperationIds
    ? new Set(params.selectedOperationIds)
    : new Set(transaction.operations.filter((o) => o.selected).map((o) => o.id));

  const opsToRun = transaction.operations.filter((o) => selectedSet.has(o.id));
  if (opsToRun.length === 0) {
    return {
      ok: false,
      project,
      transaction,
      receipts: [],
      errors: ['NO_OPERATIONS_SELECTED: Select at least one proposed operation to apply.'],
    };
  }

  // 2. Create reversible checkpoint snapshot before applying AI transaction
  const checkpointId = `snap_aitx_${transaction.id}_r${beforeRevision}`;
  const snapRes = executeProjectCommand(
    project,
    {
      type: 'createSnapshot',
      snapshotId: checkpointId,
      label: `Pre-AI Co-Edit Checkpoint (r${beforeRevision}): ${transaction.prompt.slice(0, 48)}`,
    },
    {
      actorId,
      actorKind: 'ai-director',
      rationale: `Automatic checkpoint before AI transaction ${transaction.id}`,
      approvedByUser: true,
    }
  );

  if (!snapRes.receipt.ok) {
    return {
      ok: false,
      project,
      transaction,
      receipts: [snapRes.receipt],
      errors: snapRes.receipt.errors,
    };
  }

  let working = snapRes.project;
  const receipts: ProjectCommandReceipt[] = [snapRes.receipt];
  const errors: string[] = [];

  for (const op of opsToRun) {
    const res = executeProjectCommand(working, op.command, {
      actorId,
      actorKind: 'ai-director',
      rationale: `[AI Co-Edit: "${transaction.prompt}"] ${op.rationale}`,
      approvedByUser: true,
    });
    receipts.push(res.receipt);
    if (!res.receipt.ok) {
      errors.push(...res.receipt.errors);
      // Atomic rollback to original project if any operation fails
      return {
        ok: false,
        project,
        transaction,
        receipts,
        errors,
      };
    }
    working = res.project;
  }

  // 3. Final schema validation guard
  const validation = validateCanonicalProject(working);
  if (!validation.valid || !validation.project) {
    return {
      ok: false,
      project,
      transaction,
      receipts,
      errors: validation.errors,
    };
  }

  const finalDiff = diffCanonicalProjects(project, validation.project);
  const updatedTx: AiCoEditTransaction = {
    ...transaction,
    status: 'applied',
    checkpointSnapshotId: checkpointId,
    appliedRevision: validation.project.revision,
    operations: transaction.operations.map((o) => ({
      ...o,
      selected: selectedSet.has(o.id),
    })),
    proposedDiff: finalDiff,
  };

  const logEntry: AiCoEditLogEntry = {
    id: `ailog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    transactionId: transaction.id,
    timestamp: new Date().toISOString(),
    prompt: transaction.prompt,
    rationale: opsToRun.map((o) => o.rationale).join(' | '),
    acceptedOperationCount: opsToRun.length,
    rejectedOperationCount: transaction.operations.length - opsToRun.length,
    affectedClipIds: finalDiff.affectedClipIds,
    affectedTrackIds: finalDiff.affectedTrackIds,
    affectedParameters: finalDiff.affectedParameters,
    beforeRevision,
    afterRevision: validation.project.revision,
    checkpointSnapshotId: checkpointId,
    diffSummary: finalDiff.summaryText,
    rolledBack: false,
  };

  return {
    ok: true,
    project: validation.project,
    transaction: updatedTx,
    logEntry,
    receipts,
    errors: [],
  };
}
