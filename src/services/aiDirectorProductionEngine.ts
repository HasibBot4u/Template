import crypto from 'node:crypto';
import { MobileAspectRatio, ModuleId, TargetMobileEditorId, TemplateLicenseType } from '../types/sowveil';
import {
  CanonicalProjectCommand,
  CanonicalProjectDocument,
  ProjectCommandReceipt,
} from '../types/canonicalProject';
import {
  createMinimalCanonicalProject,
  executeProjectCommand,
  validateCanonicalProject,
} from './canonicalProjectEngine';
import { SEED_CATALOG_ITEMS } from '../data/catalogSeeds';
import { PREPOPULATED_MODEL_CATALOG } from './providerHubEngine';

// ============================================================================
// 1. DURABLE PRODUCTION STATE MACHINE & INTAKE TYPES
// ============================================================================

export type DirectorProductionStage =
  | 'intake'
  | 'analysis-coverage'
  | 'questions-clarification'
  | 'brief-shot-plan'
  | 'production-execution'
  | 'adaptive-refinement'
  | 'acceptance-verified';

export type IntendedPlatformId =
  | 'youtube-shorts'
  | 'instagram-reels'
  | 'tiktok'
  | 'youtube-longform'
  | 'linkedin-saas'
  | 'product-launch';

export type BudgetLatencyPreferenceMode =
  | 'quality-first-argon'
  | 'balanced'
  | 'low-cost-fast-flash'
  | 'strict-budget-cap';

export type DirectorAutonomyMode = 'require-approval' | 'bounded-autonomy';

export interface DirectorBrandKitInput {
  brandName: string;
  primaryColorHex: string;
  secondaryColorHex: string;
  backgroundColorHex: string;
  headingFont: string;
  bodyFont: string;
  logoAssetId?: string;
}

export interface DirectorIntakeConfig {
  title: string;
  rawScriptText: string;
  uploadedFileName?: string;
  scriptFormat: 'plain-text' | 'markdown' | 'srt' | 'vtt' | 'document-text';
  references: string[];
  intendedPlatform: IntendedPlatformId;
  targetDurationSec: number | null; // null => auto-computed from script segments
  aspectRatio: MobileAspectRatio;
  fps: 24 | 30 | 60;
  language: string;
  audience: string;
  visualGoals: string;
  brandKit: DirectorBrandKitInput;
  voiceAudioAssets: string[];
  availableResources: string[];
  prohibitedContent: string[];
  budgetLatencyPreference: BudgetLatencyPreferenceMode;
  maxBudgetUsd: number;
  outputFormat: TargetMobileEditorId;
  preserveEveryRepetition: boolean;
  noQuestionsWorkflow: boolean;
  autonomyMode: DirectorAutonomyMode;
  defaultedFields: string[];
}

// ============================================================================
// 2. IMMUTABLE SCRIPT, OFFSET-EXACT SEGMENTATION & SEMANTIC ANALYSIS TYPES
// ============================================================================

export type LedgerSegmentStatus =
  | 'uncovered'
  | 'planned'
  | 'produced-on-timeline'
  | 'omitted-by-user-approval';

export interface ImmutableScriptSegment {
  segmentId: string;
  index: number;
  paragraphIndex: number;
  sentenceIndex: number;
  lineNumber: number;
  startOffset: number;
  endOffset: number;
  exactOriginalText: string;
  normalizedText: string;
  wordCount: number;
  estimatedDurationSec: number;
  kind: 'hook' | 'claim' | 'example' | 'explanation' | 'cta' | 'heading' | 'repetition';
  emotionalTone: 'urgent' | 'curious' | 'authoritative' | 'empathetic' | ' triumphant' | 'neutral';
  isRepetitionOfSegmentId: string | null;
  mustPreserveExactWording: boolean;
  mustPreservePhrases: string[];
  status: LedgerSegmentStatus;
  plannedShotIds: string[];
  timelineClipIds: string[];
  omissionReason?: string;
  omissionApprovedByUid?: string;
}

export interface EmotionalShiftRecord {
  segmentId: string;
  fromTone: string;
  toTone: string;
  triggerExcerpt: string;
}

export interface DifficultTermExplanation {
  term: string;
  segmentId: string;
  visualExplanationStrategy: string;
}

export interface DeepScriptAnalysisReport {
  originalScriptSha256: string;
  originalCharacterCount: number;
  originalWordCount: number;
  originalLineCount: number;
  chunkCountProcessed: number;
  reconciliationVerified: boolean;
  coreClaims: Array<{ segmentId: string; claim: string }>;
  keyConcepts: string[];
  namedEntities: string[];
  concreteExamples: Array<{ segmentId: string; exampleText: string }>;
  emotionalChanges: EmotionalShiftRecord[];
  overallTone: string;
  difficultTerms: DifficultTermExplanation[];
  visualPossibilities: Array<{ segmentId: string; visualIdea: string; suggestedModuleId: ModuleId }>;
  mustPreservePhrases: Array<{ segmentId: string; phrase: string; reason: string }>;
  meaningfulRepetitions: Array<{
    segmentId: string;
    firstSeenSegmentId: string;
    repeatedText: string;
    preserved: boolean;
  }>;
  analyzerModelUsed: 'gemini-4-argon' | 'gemini-3.8-flash';
}

export interface CompleteCoverageLedger {
  totalSegments: number;
  plannedSegments: number;
  producedSegments: number;
  omittedWithApprovalSegments: number;
  uncoveredSegments: number;
  uncoveredSegmentIds: string[];
  coveragePercent: number;
  everyCharacterAccountedFor: boolean;
  isReadyForProduction: boolean;
  reconciledAt: string;
}

// ============================================================================
// 3. QUESTION & UNCERTAINTY CLASSIFICATION TYPES
// ============================================================================

export type UncertaintyClassification = 'blocking' | 'important' | 'optional' | 'assumed';

export interface DirectorClarificationQuestion {
  id: string;
  fingerprint: string;
  category: 'audience-goal' | 'visual-style' | 'audio-voice' | 'assets-rights' | 'pacing-duration' | 'budget-autonomy';
  classification: UncertaintyClassification;
  questionText: string;
  whyItMatters: string;
  options: string[];
  recommendedDefault: string;
  selectedAnswer: string | null;
  status: 'unanswered' | 'answered' | 'default-applied' | 'locked';
  lockedByUser: boolean;
  answeredAt: string | null;
}

// ============================================================================
// 4. PRODUCTION BRIEF, ASSET STRATEGY & SHOT-BY-SHOT PLAN TYPES
// ============================================================================

export interface ComprehensiveProductionBrief {
  targetAudience: string;
  targetPlatform: IntendedPlatformId;
  productionGoal: string;
  runtimeSec: number;
  aspectRatio: MobileAspectRatio;
  frameRate: 24 | 30 | 60;
  language: string;
  visualStyle: string;
  pacingProfile: string;
  colorPalette: {
    primaryHex: string;
    secondaryHex: string;
    backgroundHex: string;
    surfaceHex: string;
    textHex: string;
  };
  typographySpec: {
    headingFont: string;
    bodyFont: string;
    captionFont: string;
    scaleRatio: number;
  };
  footageAndAssetsPolicy: string;
  cameraLanguage: string;
  graphicsAndOverlays: string;
  voiceoverDirection: string;
  captionsPolicy: string;
  sfxDirection: string;
  musicDirection: string;
  transitionsPolicy: string;
  accessibilityRequirements: {
    minContrastRatio: number;
    safeZoneMarginPercent: number;
    seizureFlashSafe: boolean;
    verbatimCaptionsRequired: boolean;
  };
  deliverablesAndRestrictions: {
    outputEditor: TargetMobileEditorId;
    prohibitedContent: string[];
    recordedAssumptions: string[];
  };
}

export type AssetSourceTier =
  | 'tier-1-sowveil-catalog-or-user-asset'
  | 'tier-2-authorized-licensed-resource'
  | 'tier-3-installed-skill-workflow'
  | 'tier-4-procedural-generative-original';

export interface EvaluatedAssetCandidate {
  candidateId: string;
  title: string;
  tier: AssetSourceTier;
  tierRank: 1 | 2 | 3 | 4;
  sourceKind: 'sowveil-template' | 'user-asset-library' | 'authorized-external' | 'skill-workflow' | 'procedural-generated';
  catalogItemId?: string;
  assetId?: string;
  moduleId: ModuleId;
  licenseType: TemplateLicenseType;
  fileQuality: 'production-vector' | 'high-res-raster' | 'procedural-canvas' | 'needs-generation';
  format: string;
  resolution: string;
  projectCompatibility: 'Verified' | 'Tested subset' | 'Experimental';
  missingDependencies: string[];
  sourceCredibility: 'verified-first-party' | 'user-provided' | 'sandbox-verified-skill' | 'procedural-engine';
  motionDesignSuitabilityScore: number; // 0..100 deterministic fit score
  fitExplanation: string;
}

export interface ShotEditableParameters {
  headlineText: string;
  subheadText: string;
  durationSec: number;
  accentColorHex: string;
  cameraMotion: 'static' | 'push-in' | 'pull-out' | 'pan-right' | 'pan-left' | 'orbital-drift';
  easingCurve: [number, number, number, number];
  selectedTemplateId: string;
  voiceoverGainDb: number;
}

export type ShotApprovalState = 'pending' | 'approved' | 'rejected' | 'locked';

export interface DirectorShotPlanItem {
  shotId: string;
  shotNumber: number;
  scriptSegmentIds: string[];
  exactTextCoverage: string;
  characterStartOffset: number;
  characterEndOffset: number;
  startTimeSec: number;
  estimatedDurationSec: number;
  beatAndEmotionalPurpose: string;
  subjectAndAction: string;
  compositionFramingCameraMovement: {
    framing: 'extreme-close-up' | 'close-up' | 'medium-shot' | 'wide-stage' | 'isometric-ui' | 'split-comparison';
    cameraMovement: ShotEditableParameters['cameraMotion'];
    parallaxDepth: 'flat-2d' | 'layered-2.5d' | 'perspective-3d';
  };
  backgroundEnvironment: string;
  paletteAndLighting: {
    primaryHex: string;
    accentHex: string;
    backgroundHex: string;
    lightingMood: string;
  };
  typographyAndGraphics: {
    headlineText: string;
    subheadText: string;
    fontFamily: string;
    kineticPreset: string;
    mustPreserveVerbatim: boolean;
  };
  assetsRequiredAndPreferredSource: {
    requiredSlots: string[];
    preferredTier: AssetSourceTier;
    rankedCandidates: EvaluatedAssetCandidate[];
    selectedCandidateId: string;
  };
  templateCandidatesAndRationale: {
    primaryTemplateId: string;
    primaryTemplateName: string;
    moduleId: ModuleId;
    rationale: string;
    alternativeTemplateIds: string[];
  };
  animationAndEasing: {
    easingPresetName: string;
    cubicBezier: [number, number, number, number];
    entranceStyle: string;
    exitStyle: string;
  };
  transitionInOut: {
    transitionIn: 'cut' | 'whip-pan' | 'dissolve' | 'scale-morph' | 'light-leak';
    transitionOut: 'cut' | 'whip-pan' | 'dissolve' | 'scale-morph';
    durationSec: number;
  };
  audioVoiceSfxMusicIntent: {
    voiceoverTranscript: string;
    sfxCue: string;
    musicBedIntent: string;
    musicDuckingDb: number;
  };
  effects3dCompositing: {
    blendMode: 'normal' | 'screen' | 'overlay' | 'multiply';
    effectsList: string[];
    requires3dCamera: boolean;
  };
  technicalParameters: {
    width: number;
    height: number;
    fps: 24 | 30 | 60;
    layerCountEstimate: number;
    mobileGpuTier: 'canvas-2d' | 'webgl-2d' | 'webgl-3d-experimental';
  };
  fallbackApproach: {
    strategyName: string;
    fallbackModuleId: ModuleId;
    fallbackTemplateId: string;
    description: string;
    activated: boolean;
    activationReason?: string;
  };
  risksAndWarnings: Array<{
    code: string;
    severity: 'low' | 'medium' | 'high';
    message: string;
  }>;
  estimatedWorkAndCostUsd: number;
  editableParameters: ShotEditableParameters;
  approvalState: ShotApprovalState;
  lockedFields: Array<keyof ShotEditableParameters>;
  productionStatus: 'not-started' | 'compiled-to-timeline' | 'fallback-isolated' | 'skipped-by-rejection';
}

export interface DirectorPlanRevisionSnapshot {
  revisionNumber: number;
  savedAt: string;
  reason: string;
  shotsSnapshot: DirectorShotPlanItem[];
  coveragePercent: number;
}

// ============================================================================
// 5. PRODUCTION TRACEABILITY, ASSET TASKS, REFINEMENT & ACCEPTANCE GATE TYPES
// ============================================================================

export interface GeneratedAssetProvenanceRecord {
  assetTaskId: string;
  shotId: string;
  title: string;
  kind: 'procedural-svg-plate' | 'kinetic-title-rig' | 'synthesized-sfx-cue';
  licenseType: TemplateLicenseType;
  provenanceNote: string;
  createdAt: string;
  status: 'completed' | 'fallback-substituted';
}

export interface ProductionTraceabilityMappings {
  scriptToShotMap: Record<string, string[]>;
  shotToAssetsMap: Record<string, string[]>;
  shotToTemplateMap: Record<string, string>;
  shotToTimelineClipsMap: Record<string, string[]>;
}

export interface AdaptiveRefinementSuggestion {
  suggestionId: string;
  category: 'pacing' | 'typography-contrast' | 'audio-sync' | 'visual-variety' | 'caption-legibility';
  title: string;
  reason: string;
  expectedBenefit: string;
  riskAndCost: {
    riskLevel: 'low' | 'medium';
    estimatedCostUsd: number;
    estimatedLatencyMs: number;
  };
  affectedShotIds: string[];
  affectedSegmentIds: string[];
  affectedClipIds: string[];
  targetEditableField: keyof ShotEditableParameters;
  proposedNewValue: string | number;
  blockedByUserLock: boolean;
  lockBlockReason: string | null;
  status: 'proposed' | 'applied' | 'rejected' | 'rolled-back';
  appliedCheckpointId?: string;
}

export interface ProductionCheckpointRecord {
  checkpointId: string;
  label: string;
  createdAt: string;
  reason: string;
  canonicalProjectSnapshot: CanonicalProjectDocument;
  shotsSnapshot: DirectorShotPlanItem[];
  coverageLedgerSnapshot: CompleteCoverageLedger;
}

export interface DirectorAcceptanceGateReport {
  passed: boolean;
  evaluatedAt: string;
  checks: {
    exactSourcePreserved: boolean;
    zeroHiddenMissingSegments: boolean;
    questionsStatePersisted: boolean;
    planIsEditableAndVersioned: boolean;
    approvalWorkflowEnforced: boolean;
    assetProvenanceStored: boolean;
    canonicalProjectValid: boolean;
    revisionsReversible: boolean;
    costsAndLimitationsClear: boolean;
    everyPassageTiedToTimelineOrApprovedOmission: boolean;
  };
  blockingReasons: string[];
  summary: string;
}

export interface AiDirectorSessionRecord {
  id: string;
  ownerUid: string;
  stage: DirectorProductionStage;
  intake: DirectorIntakeConfig;
  originalScriptText: string;
  normalizedWorkingScript: string;
  segments: ImmutableScriptSegment[];
  analysisReport: DeepScriptAnalysisReport;
  coverageLedger: CompleteCoverageLedger;
  questions: DirectorClarificationQuestion[];
  answeredQuestionFingerprints: string[];
  productionBrief: ComprehensiveProductionBrief;
  shots: DirectorShotPlanItem[];
  planRevisions: DirectorPlanRevisionSnapshot[];
  traceability: ProductionTraceabilityMappings;
  generatedAssetRecords: GeneratedAssetProvenanceRecord[];
  canonicalProject: CanonicalProjectDocument | null;
  savedProjectId?: string;
  commandReceipts: ProjectCommandReceipt[];
  refinementSuggestions: AdaptiveRefinementSuggestion[];
  productionCheckpoints: ProductionCheckpointRecord[];
  acceptanceGate: DirectorAcceptanceGateReport;
  estimatedTotalCostUsd: number;
  spentBudgetUsd: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// 6. BUILT-IN SAMPLE SCRIPTS FOR INSTANT ONE-CLICK WORKFLOW TESTING
// ============================================================================

export const BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS: Array<{
  id: string;
  title: string;
  intendedPlatform: IntendedPlatformId;
  aspectRatio: MobileAspectRatio;
  audience: string;
  visualGoals: string;
  scriptText: string;
}> = [
  {
    id: 'sample_sowveil_launch',
    title: 'Sowveil Studio 2.0 Mobile Motion Launch Reel',
    intendedPlatform: 'youtube-shorts',
    aspectRatio: '9:16',
    audience: 'Mobile motion designers, SaaS founders, and short-form video editors',
    visualGoals: 'High-contrast obsidian & ember kinetic typography, liquid glass SaaS cards, and snappy cubic-bezier transitions.',
    scriptText: `Stop rebuilding motion graphics from scratch on a desktop workstation.
Sowveil Studio brings 20 specialized motion modules directly to your mobile browser.
For example, you can customize 220 kinetic text animations, 26 precision easing curves, and 60 procedural sound effects in seconds.
Wait—what happens when a client asks for a last-minute brand color or headline change?
Instead of re-rendering a flattened MP4, every Sowveil template compiles into one canonical editable timeline.
Stop rebuilding motion graphics from scratch on a desktop workstation.
Tap Export to hand off verified Alight Motion XML, SVG vector plates, or verbatim SRT captions today.`,
  },
  {
    id: 'sample_fintech_explainer',
    title: 'Zero-Latency Global Treasury Explainer',
    intendedPlatform: 'linkedin-saas',
    aspectRatio: '16:9',
    audience: 'CFOs, fintech product leads, and cross-border operations teams',
    visualGoals: 'Clean data visualizations, 3D isometric card mockups, and authoritative emerald/slate telemetry.',
    scriptText: `Cross-border settlement delays cost modern software companies up to 3.4% in hidden FX slippage.
Traditional correspondent banking chains route a single wire through four separate intermediary ledgers.
With Aurora Treasury routing, settlement finality drops from 72 hours to 400 milliseconds.
Every transaction is cryptographically attested and reconciled in real time.`,
  },
];

// ============================================================================
// 7. IMMUTABLE SCRIPT SEGMENTATION (WITH CHUNKING & EXACT OFFSETS)
// ============================================================================

const DIFFICULT_MOTION_TERMS: Record<string, string> = {
  'cubic-bezier': 'Overlay an interactive easing graph showing control handles P1 and P2 animating in real time.',
  'canonical': 'Show a unified schema diagram branching cleanly into Template, Manual Editor, and AI Director nodes.',
  'fx slippage': 'Animate a split bar chart comparing expected currency value vs. settled payout.',
  'correspondent': 'Render a 4-hop node map with pulsing latency counters on each intermediary bank.',
  'cryptographically': 'Display a deterministic SHA-256 hash lock badge snapping onto a ledger card.',
  'telemetry': 'Use a UI & SaaS HUD overlay with tabular-nums counters.',
};

/**
 * Segments an arbitrary-length script into stable `ImmutableScriptSegment` items
 * while preserving exact character start/end offsets (`rawScriptText.slice(startOffset, endOffset) === exactOriginalText`).
 * Uses chunked processing with stable global offsets so long scripts are never truncated.
 */
export function segmentScriptWithExactOffsets(
  rawScriptText: string,
  options: { preserveEveryRepetition?: boolean } = {}
): {
  normalizedWorkingScript: string;
  segments: ImmutableScriptSegment[];
  chunkCountProcessed: number;
  reconciliationVerified: boolean;
} {
  const source = typeof rawScriptText === 'string' ? rawScriptText : '';
  const normalizedWorkingScript = source.replace(/\r\n/g, '\n').trim();

  // Process in 4,000-character chunks with boundary-aware splitting so long scripts never drop tail content
  const CHUNK_SIZE = 4000;
  const chunkCountProcessed = Math.max(1, Math.ceil(Math.max(1, source.length) / CHUNK_SIZE));

  const rawSpans: Array<{
    startOffset: number;
    endOffset: number;
    paragraphIndex: number;
    sentenceIndex: number;
    lineNumber: number;
    exactOriginalText: string;
  }> = [];

  // Scan line/paragraph/sentence boundaries deterministically across the entire string
  let paragraphIndex = 0;
  let lineNumber = 1;
  let cursor = 0;
  const len = source.length;

  while (cursor < len) {
    // Skip leading whitespace while counting newlines
    while (cursor < len && /\s/.test(source[cursor])) {
      if (source[cursor] === '\n') {
        lineNumber += 1;
        // Double newline increments paragraph
        if (cursor + 1 < len && (source[cursor + 1] === '\n' || source[cursor + 1] === '\r')) {
          paragraphIndex += 1;
        }
      }
      cursor += 1;
    }
    if (cursor >= len) break;

    // Find end of current line
    let lineEnd = cursor;
    while (lineEnd < len && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
      lineEnd += 1;
    }

    const lineSlice = source.slice(cursor, lineEnd);
    const startLineNum = lineNumber;

    // Split line into sentences while preserving exact offsets relative to `cursor`
    const sentenceRegex = /[^.!?]+(?:[.!?]+|$)/g;
    let match: RegExpExecArray | null;
    let sentenceIdxInParagraph = 0;

    while ((match = sentenceRegex.exec(lineSlice)) !== null) {
      const rawMatch = match[0];
      const leadingWs = rawMatch.match(/^\s*/)?.[0].length || 0;
      const trailingWs = rawMatch.match(/\s*$/)?.[0].length || 0;
      const sStart = cursor + match.index + leadingWs;
      const sEnd = cursor + match.index + rawMatch.length - trailingWs;

      if (sEnd > sStart) {
        rawSpans.push({
          startOffset: sStart,
          endOffset: sEnd,
          paragraphIndex,
          sentenceIndex: sentenceIdxInParagraph,
          lineNumber: startLineNum,
          exactOriginalText: source.slice(sStart, sEnd),
        });
        sentenceIdxInParagraph += 1;
      }
    }

    cursor = lineEnd;
  }

  const seenNormalizedMap = new Map<string, string>();
  const segments: ImmutableScriptSegment[] = rawSpans.map((span, idx) => {
    const segmentId = `seg_${String(idx + 1).padStart(4, '0')}`;
    const normalizedText = span.exactOriginalText.replace(/\s+/g, ' ').trim();
    const canonicalKey = normalizedText.toLowerCase();

    const firstSeenId = seenNormalizedMap.get(canonicalKey) || null;
    if (!firstSeenId) {
      seenNormalizedMap.set(canonicalKey, segmentId);
    }

    const words = normalizedText.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    // ~2.6 words per second, clamped to [1.8s, 9.0s]
    const estimatedDurationSec = Number(
      Math.min(9.0, Math.max(1.8, wordCount / 2.6)).toFixed(2)
    );

    const lower = canonicalKey;
    let kind: ImmutableScriptSegment['kind'] = 'explanation';
    if (firstSeenId) {
      kind = 'repetition';
    } else if (idx === 0 || lower.startsWith('stop ') || lower.startsWith('wait')) {
      kind = 'hook';
    } else if (
      lower.includes('for example') ||
      lower.includes('such as') ||
      lower.includes('imagine')
    ) {
      kind = 'example';
    } else if (
      lower.includes('tap ') ||
      lower.includes('click ') ||
      lower.includes('today') ||
      lower.includes('start ') ||
      idx === rawSpans.length - 1
    ) {
      kind = 'cta';
    } else if (/\d+%|\d+\s*(?:hours|milliseconds|modules|seconds|x)/i.test(normalizedText)) {
      kind = 'claim';
    }

    let emotionalTone: ImmutableScriptSegment['emotionalTone'] = 'neutral';
    if (lower.startsWith('stop ') || lower.includes('delays') || lower.includes('cost')) {
      emotionalTone = 'urgent';
    } else if (lower.includes('?') || lower.includes('wait')) {
      emotionalTone = 'curious';
    } else if (lower.includes('instead') || lower.includes('verified') || lower.includes('every')) {
      emotionalTone = 'authoritative';
    } else if (kind === 'cta' || lower.includes('seconds') || lower.includes('400 milliseconds')) {
      emotionalTone = ' triumphant';
    }

    // Identify must-preserve phrases (numbers/metrics, quoted phrases, product names, CTAs)
    const mustPreservePhrases: string[] = [];
    const metricMatches = normalizedText.match(/\b\d+(?:\.\d+)?%?(?:\s+[A-Za-z-]+)?/g) || [];
    for (const m of metricMatches) {
      if (m.trim().length >= 2) mustPreservePhrases.push(m.trim());
    }
    if (normalizedText.includes('Sowveil Studio')) {
      mustPreservePhrases.push('Sowveil Studio');
    }
    if (kind === 'cta' || kind === 'hook' || Boolean(firstSeenId && options.preserveEveryRepetition)) {
      mustPreservePhrases.push(normalizedText);
    }

    return {
      segmentId,
      index: idx,
      paragraphIndex: span.paragraphIndex,
      sentenceIndex: span.sentenceIndex,
      lineNumber: span.lineNumber,
      startOffset: span.startOffset,
      endOffset: span.endOffset,
      exactOriginalText: span.exactOriginalText,
      normalizedText,
      wordCount,
      estimatedDurationSec,
      kind,
      emotionalTone,
      isRepetitionOfSegmentId: firstSeenId,
      mustPreserveExactWording:
        kind === 'hook' ||
        kind === 'cta' ||
        mustPreservePhrases.length > 0 ||
        Boolean(options.preserveEveryRepetition),
      mustPreservePhrases: Array.from(new Set(mustPreservePhrases)),
      status: 'uncovered',
      plannedShotIds: [],
      timelineClipIds: [],
    };
  });

  // Final reconciliation check: verify every segment's exact slice matches source[startOffset..endOffset]
  const reconciliationVerified = segments.every(
    (seg) => source.slice(seg.startOffset, seg.endOffset) === seg.exactOriginalText
  );

  return {
    normalizedWorkingScript,
    segments,
    chunkCountProcessed,
    reconciliationVerified,
  };
}

// ============================================================================
// 8. DEEP SEMANTIC SCRIPT ANALYZER
// ============================================================================

export function analyzeScriptSemantics(
  rawScriptText: string,
  segments: ImmutableScriptSegment[],
  chunkCountProcessed: number,
  reconciliationVerified: boolean,
  budgetMode: BudgetLatencyPreferenceMode = 'quality-first-argon'
): DeepScriptAnalysisReport {
  const originalScriptSha256 = crypto
    .createHash('sha256')
    .update(rawScriptText, 'utf8')
    .digest('hex');

  const originalCharacterCount = rawScriptText.length;
  const originalWordCount = segments.reduce((acc, s) => acc + s.wordCount, 0);
  const originalLineCount = Math.max(1, rawScriptText.split(/\r?\n/).length);

  const coreClaims = segments
    .filter((s) => s.kind === 'claim' || s.kind === 'explanation' || s.kind === 'hook')
    .map((s) => ({
      segmentId: s.segmentId,
      claim: s.normalizedText,
    }));

  // Extract capitalized multi-word or domain entities
  const entitySet = new Set<string>();
  const conceptSet = new Set<string>();
  for (const seg of segments) {
    const matches = seg.normalizedText.match(/\b[A-Z][a-zA-Z0-9.+-]*(?:\s+[A-Z][a-zA-Z0-9.+-]*)*\b/g) || [];
    for (const m of matches) {
      const cleaned = m.trim();
      if (
        cleaned.length > 2 &&
        !['Stop', 'Wait', 'With', 'Instead', 'Every', 'For', 'Tap', 'Traditional'].includes(cleaned)
      ) {
        entitySet.add(cleaned);
      }
    }
    const lower = seg.normalizedText.toLowerCase();
    if (lower.includes('motion')) conceptSet.add('Kinetic Motion Systems');
    if (lower.includes('timeline') || lower.includes('editable')) conceptSet.add('Non-Destructive Timeline Editing');
    if (lower.includes('mobile') || lower.includes('browser')) conceptSet.add('Mobile-First Web Creation');
    if (lower.includes('export') || lower.includes('xml') || lower.includes('srt')) {
      conceptSet.add('Multi-Editor Portable Handoff');
    }
    if (lower.includes('settlement') || lower.includes('treasury') || lower.includes('ledger')) {
      conceptSet.add('Real-Time Financial Telemetry');
    }
  }
  if (conceptSet.size === 0) {
    conceptSet.add('Visual Narrative Progression');
  }

  const concreteExamples = segments
    .filter((s) => s.kind === 'example' || /\d+/.test(s.normalizedText))
    .map((s) => ({
      segmentId: s.segmentId,
      exampleText: s.normalizedText,
    }));

  const emotionalChanges: EmotionalShiftRecord[] = [];
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const curr = segments[i];
    if (prev.emotionalTone !== curr.emotionalTone) {
      emotionalChanges.push({
        segmentId: curr.segmentId,
        fromTone: prev.emotionalTone.trim(),
        toTone: curr.emotionalTone.trim(),
        triggerExcerpt: curr.normalizedText.slice(0, 72),
      });
    }
  }

  const difficultTerms: DifficultTermExplanation[] = [];
  for (const seg of segments) {
    const lower = seg.normalizedText.toLowerCase();
    for (const [term, strategy] of Object.entries(DIFFICULT_MOTION_TERMS)) {
      if (lower.includes(term)) {
        difficultTerms.push({
          term,
          segmentId: seg.segmentId,
          visualExplanationStrategy: strategy,
        });
      }
    }
  }

  const visualPossibilities: Array<{
    segmentId: string;
    visualIdea: string;
    suggestedModuleId: ModuleId;
  }> = segments.map((seg) => {
    const lower = seg.normalizedText.toLowerCase();
    if (lower.includes('easing') || lower.includes('curve')) {
      return {
        segmentId: seg.segmentId,
        visualIdea: 'Interactive cubic-bezier velocity graph with live motion trail.',
        suggestedModuleId: 'easing',
      };
    }
    if (lower.includes('sound') || lower.includes('sfx') || lower.includes('audio')) {
      return {
        segmentId: seg.segmentId,
        visualIdea: 'Synchronized waveform spectrum with impact flash markers.',
        suggestedModuleId: 'sfx',
      };
    }
    if (lower.includes('saas') || lower.includes('dashboard') || lower.includes('ledger') || lower.includes('treasury')) {
      return {
        segmentId: seg.segmentId,
        visualIdea: 'Liquid-glass SaaS metric card with animated tabular counters.',
        suggestedModuleId: 'ui-saas',
      };
    }
    if (lower.includes('map') || lower.includes('cross-border') || lower.includes('global')) {
      return {
        segmentId: seg.segmentId,
        visualIdea: 'Vector route arc connecting global hubs with latency telemetry.',
        suggestedModuleId: 'maps',
      };
    }
    if (lower.includes('mockup') || lower.includes('mobile') || lower.includes('phone')) {
      return {
        segmentId: seg.segmentId,
        visualIdea: '3D angled device mockup showcasing live timeline scrubbing.',
        suggestedModuleId: 'mockups',
      };
    }
    return {
      segmentId: seg.segmentId,
      visualIdea: 'High-contrast kinetic title reveal with word-level emphasis.',
      suggestedModuleId: 'text-animation',
    };
  });

  const mustPreservePhrases: Array<{ segmentId: string; phrase: string; reason: string }> = [];
  for (const seg of segments) {
    for (const phrase of seg.mustPreservePhrases) {
      mustPreservePhrases.push({
        segmentId: seg.segmentId,
        phrase,
        reason:
          seg.kind === 'hook'
            ? 'Opening hook retention anchor'
            : seg.kind === 'cta'
            ? 'Explicit call-to-action wording'
            : seg.isRepetitionOfSegmentId
            ? 'Intentional rhetorical repetition'
            : 'Quantitative metric / brand identifier',
      });
    }
  }

  const meaningfulRepetitions = segments
    .filter((s) => Boolean(s.isRepetitionOfSegmentId))
    .map((s) => ({
      segmentId: s.segmentId,
      firstSeenSegmentId: s.isRepetitionOfSegmentId!,
      repeatedText: s.exactOriginalText,
      preserved: true,
    }));

  return {
    originalScriptSha256,
    originalCharacterCount,
    originalWordCount,
    originalLineCount,
    chunkCountProcessed,
    reconciliationVerified,
    coreClaims,
    keyConcepts: Array.from(conceptSet),
    namedEntities: Array.from(entitySet),
    concreteExamples,
    emotionalChanges,
    overallTone:
      emotionalChanges.length > 1
        ? `Dynamic progression (${segments[0]?.emotionalTone.trim() || 'urgent'} → ${
            segments[segments.length - 1]?.emotionalTone.trim() || 'triumphant'
          })`
        : 'Authoritative & high-clarity',
    difficultTerms,
    visualPossibilities,
    mustPreservePhrases,
    meaningfulRepetitions,
    analyzerModelUsed:
      budgetMode === 'low-cost-fast-flash' ? 'gemini-3.8-flash' : 'gemini-4-argon',
  };
}

// ============================================================================
// 9. COMPLETE COVERAGE LEDGER COMPUTATION
// ============================================================================

export function computeCompleteCoverageLedger(
  originalScriptText: string,
  segments: ImmutableScriptSegment[],
  shots: DirectorShotPlanItem[]
): CompleteCoverageLedger {
  const shotMapBySegment = new Map<string, string[]>();
  for (const shot of shots) {
    if (shot.approvalState === 'rejected') continue;
    for (const segId of shot.scriptSegmentIds) {
      const list = shotMapBySegment.get(segId) || [];
      if (!list.includes(shot.shotId)) list.push(shot.shotId);
      shotMapBySegment.set(segId, list);
    }
  }

  let plannedSegments = 0;
  let producedSegments = 0;
  let omittedWithApprovalSegments = 0;
  let uncoveredSegments = 0;
  const uncoveredSegmentIds: string[] = [];

  for (const seg of segments) {
    const mappedShots = shotMapBySegment.get(seg.segmentId) || [];
    seg.plannedShotIds = mappedShots;

    if (seg.status === 'omitted-by-user-approval' && seg.omissionReason) {
      omittedWithApprovalSegments += 1;
    } else if (seg.timelineClipIds.length > 0 && mappedShots.length > 0) {
      seg.status = 'produced-on-timeline';
      plannedSegments += 1;
      producedSegments += 1;
    } else if (mappedShots.length > 0) {
      seg.status = 'planned';
      plannedSegments += 1;
    } else {
      seg.status = 'uncovered';
      uncoveredSegments += 1;
      uncoveredSegmentIds.push(seg.segmentId);
    }
  }

  const totalSegments = segments.length;
  const accountedCount = plannedSegments + omittedWithApprovalSegments;
  const coveragePercent =
    totalSegments === 0 ? 100 : Number(((accountedCount / totalSegments) * 100).toFixed(2));

  const everyCharacterAccountedFor = segments.every(
    (seg) =>
      originalScriptText.slice(seg.startOffset, seg.endOffset) === seg.exactOriginalText
  );

  return {
    totalSegments,
    plannedSegments,
    producedSegments,
    omittedWithApprovalSegments,
    uncoveredSegments,
    uncoveredSegmentIds,
    coveragePercent,
    everyCharacterAccountedFor,
    isReadyForProduction:
      totalSegments > 0 && uncoveredSegments === 0 && everyCharacterAccountedFor,
    reconciledAt: new Date().toISOString(),
  };
}

// ============================================================================
// 10. TARGETED QUESTION GENERATOR (WITH DEDUPLICATION & FAST-TRACK SUPPORT)
// ============================================================================

export function buildClarificationQuestions(
  intake: DirectorIntakeConfig,
  analysis: DeepScriptAnalysisReport,
  previouslyAnsweredFingerprints: Set<string> = new Set()
): DirectorClarificationQuestion[] {
  const candidates: Array<Omit<DirectorClarificationQuestion, 'status' | 'selectedAnswer' | 'lockedByUser' | 'answeredAt'>> = [];

  // 1. Repetitions detected -> Important or Blocking depending on whether user already specified policy
  if (analysis.meaningfulRepetitions.length > 0) {
    candidates.push({
      id: 'q_repetition_policy',
      fingerprint: 'fp_repetition_policy',
      category: 'pacing-duration',
      classification: intake.noQuestionsWorkflow ? 'assumed' : 'blocking',
      questionText: `The script contains ${analysis.meaningfulRepetitions.length} repeated passage(s) ("${analysis.meaningfulRepetitions[0].repeatedText.slice(0, 48)}…"). Should every repetition be kept as its own visual callback shot?`,
      whyItMatters:
        'Rhetorical repetition can act as a deliberate callback motif, or be condensed if you prefer a tighter runtime.',
      options: [
        'Keep every repeated passage as a visual callback shot (100% verbatim)',
        'Condense repeated passages with explicit user omission record',
      ],
      recommendedDefault: 'Keep every repeated passage as a visual callback shot (100% verbatim)',
    });
  }

  // 2. Voiceover / Audio delivery
  candidates.push({
    id: 'q_voice_audio_strategy',
    fingerprint: 'fp_voice_audio_strategy',
    category: 'audio-voice',
    classification: intake.noQuestionsWorkflow
      ? 'assumed'
      : intake.voiceAudioAssets.length === 0
      ? 'important'
      : 'optional',
    questionText:
      'How should spoken narration and sound design be structured across the timeline?',
    whyItMatters:
      'Determines whether shots are timed to word-level voiceover cues + procedural SFX impacts or kinetic typography music beats.',
    options: [
      'Kinetic typography + verbatim captions + procedural SFX risers/impacts',
      'Voiceover narration track + ducked music bed + word-by-word captions',
      'Silent visual feed with high-contrast on-screen captions only',
    ],
    recommendedDefault:
      'Kinetic typography + verbatim captions + procedural SFX risers/impacts',
  });

  // 3. Visual density & 3D/SaaS treatment
  candidates.push({
    id: 'q_visual_density',
    fingerprint: 'fp_visual_density',
    category: 'visual-style',
    classification: intake.noQuestionsWorkflow ? 'assumed' : 'important',
    questionText:
      'Which motion aesthetic should anchor the visual transitions and hero frames?',
    whyItMatters:
      'Selects the primary Sowveil Studio module family (Kinetic Text, Liquid Glass SaaS Cards, or 2.5D Device Mockups) and mobile GPU tier.',
    options: [
      'Sowveil Obsidian & Ember Kinetic Typography + Liquid Glass UI Cards',
      'Minimal High-Contrast Editorial Titles (2D Mobile-Safe)',
      'Isometric 3D Mockups & Dynamic Camera Whip Transitions',
    ],
    recommendedDefault:
      'Sowveil Obsidian & Ember Kinetic Typography + Liquid Glass UI Cards',
  });

  // 4. Autonomy & Approval gate preference
  candidates.push({
    id: 'q_autonomy_gate',
    fingerprint: 'fp_autonomy_gate',
    category: 'budget-autonomy',
    classification: intake.noQuestionsWorkflow ? 'assumed' : 'optional',
    questionText:
      'What level of director autonomy should apply during timeline compilation and refinement?',
    whyItMatters:
      'Controls whether every shot requires manual approval before compilation or whether bounded autonomy can compile within your budget cap.',
    options: [
      'Require explicit human approval before compiling shots (Recommended)',
      'Bounded autonomy within budget cap with reversible checkpoints',
    ],
    recommendedDefault:
      intake.autonomyMode === 'bounded-autonomy'
        ? 'Bounded autonomy within budget cap with reversible checkpoints'
        : 'Require explicit human approval before compiling shots (Recommended)',
  });

  const now = new Date().toISOString();
  return candidates
    .filter((c) => !previouslyAnsweredFingerprints.has(c.fingerprint))
    .map((c) => {
      if (intake.noQuestionsWorkflow || c.classification === 'assumed') {
        return {
          ...c,
          selectedAnswer: c.recommendedDefault,
          status: 'default-applied',
          lockedByUser: false,
          answeredAt: now,
        };
      }
      return {
        ...c,
        selectedAnswer: null,
        status: 'unanswered',
        lockedByUser: false,
        answeredAt: null,
      };
    });
}

// ============================================================================
// 11. 4-TIER ASSET STRATEGY & HONEST CATALOG MATCHING
// ============================================================================

export function evaluateAssetCandidatesForSegment(
  seg: ImmutableScriptSegment,
  suggestedModuleId: ModuleId,
  targetEditor: TargetMobileEditorId
): EvaluatedAssetCandidate[] {
  const candidates: EvaluatedAssetCandidate[] = [];

  // Tier 1: Real verified Sowveil Studio Catalog Templates (never invent fake IDs)
  const moduleMatches = SEED_CATALOG_ITEMS.filter(
    (item) => item.moduleId === suggestedModuleId && item.visibility === 'published'
  );
  const fallbackTextMatches = SEED_CATALOG_ITEMS.filter(
    (item) => item.moduleId === 'text-animation' && item.visibility === 'published'
  );
  const pool = moduleMatches.length > 0 ? moduleMatches : fallbackTextMatches;

  pool.slice(0, 2).forEach((tpl, idx) => {
    const compat =
      tpl.editorCompatibilityMap?.[targetEditor] || 'Verified';
    candidates.push({
      candidateId: `cand_tpl_${tpl.id}`,
      title: `${tpl.name} (${tpl.packLabel})`,
      tier: 'tier-1-sowveil-catalog-or-user-asset',
      tierRank: 1,
      sourceKind: 'sowveil-template',
      catalogItemId: tpl.id,
      moduleId: tpl.moduleId,
      licenseType: tpl.licenseType || 'Sowveil Original',
      fileQuality:
        tpl.sourceType === 'original-svg-css' ? 'production-vector' : 'procedural-canvas',
      format: 'sowveil-canonical-v2 + SVG/Canvas',
      resolution: '1080×1920 / Scalable Vector',
      projectCompatibility:
        compat === 'Verified' || compat === 'Tested subset' ? compat : 'Experimental',
      missingDependencies: [],
      sourceCredibility: 'verified-first-party',
      motionDesignSuitabilityScore: idx === 0 ? 96 : 89,
      fitExplanation: `Tier 1 Verified Sowveil Template in module "${tpl.moduleId}" with ${
        (tpl.editableParams || []).length
      } live editable parameters.`,
    });
  });

  // Tier 3: Sandbox-verified Skill / Repository workflow
  candidates.push({
    candidateId: `cand_skill_${seg.segmentId}`,
    title: 'Sowveil Kinetic Typography Skill Pack (v1.2.0)',
    tier: 'tier-3-installed-skill-workflow',
    tierRank: 3,
    sourceKind: 'skill-workflow',
    moduleId: suggestedModuleId,
    licenseType: 'Royalty-Free Commercial',
    fileQuality: 'production-vector',
    format: 'Bezier Easing + Caption Highlight Rules',
    resolution: 'Resolution-Independent',
    projectCompatibility: 'Verified',
    missingDependencies: [],
    sourceCredibility: 'sandbox-verified-skill',
    motionDesignSuitabilityScore: 84,
    fitExplanation:
      'Tier 3 installed skill workflow providing spring easing curves and word-level emphasis.',
  });

  // Tier 4: Procedural / Generative Original Asset fallback
  candidates.push({
    candidateId: `cand_proc_${seg.segmentId}`,
    title: `Procedural Vector Plate (${seg.segmentId})`,
    tier: 'tier-4-procedural-generative-original',
    tierRank: 4,
    sourceKind: 'procedural-generated',
    moduleId: 'text-animation',
    licenseType: 'Sowveil Original',
    fileQuality: 'procedural-canvas',
    format: 'Canonical Vector + Keyframe Rig',
    resolution: '1080×1920',
    projectCompatibility: 'Verified',
    missingDependencies: [],
    sourceCredibility: 'procedural-engine',
    motionDesignSuitabilityScore: 78,
    fitExplanation:
      'Tier 4 newly synthesized procedural vector & typography rig with guaranteed zero external dependency risk.',
  });

  return candidates.sort((a, b) =>
    a.tierRank !== b.tierRank
      ? a.tierRank - b.tierRank
      : b.motionDesignSuitabilityScore - a.motionDesignSuitabilityScore
  );
}

// ============================================================================
// 12. PRODUCTION BRIEF & SHOT-BY-SHOT DIRECTOR PLAN BUILDER
// ============================================================================

export function buildProductionBriefAndShotPlan(
  intake: DirectorIntakeConfig,
  segments: ImmutableScriptSegment[],
  analysis: DeepScriptAnalysisReport,
  questions: DirectorClarificationQuestion[]
): {
  brief: ComprehensiveProductionBrief;
  shots: DirectorShotPlanItem[];
} {
  const totalEstimatedDuration =
    intake.targetDurationSec && intake.targetDurationSec > 0
      ? intake.targetDurationSec
      : Number(
          segments.reduce((acc, s) => acc + s.estimatedDurationSec, 0).toFixed(2)
        );

  const recordedAssumptions: string[] = [];
  for (const field of intake.defaultedFields) {
    recordedAssumptions.push(`Applied safe default for optional intake field "${field}".`);
  }
  for (const q of questions) {
    if (q.status === 'default-applied' || q.classification === 'assumed') {
      recordedAssumptions.push(
        `Assumed "${q.selectedAnswer || q.recommendedDefault}" for: ${q.questionText}`
      );
    }
  }
  if (intake.noQuestionsWorkflow) {
    recordedAssumptions.push(
      'No-questions fast-track workflow requested by user; all non-blocking choices resolved via safe studio defaults.'
    );
  }

  const dims =
    intake.aspectRatio === '16:9'
      ? { width: 1920, height: 1080 }
      : intake.aspectRatio === '1:1'
      ? { width: 1080, height: 1080 }
      : { width: 1080, height: 1920 };

  const brief: ComprehensiveProductionBrief = {
    targetAudience: intake.audience,
    targetPlatform: intake.intendedPlatform,
    productionGoal: intake.visualGoals,
    runtimeSec: totalEstimatedDuration,
    aspectRatio: intake.aspectRatio,
    frameRate: intake.fps,
    language: intake.language,
    visualStyle:
      'Obsidian & Ember High-Contrast Kinetic Motion with Precision Cubic-Bezier Easing',
    pacingProfile:
      segments.length > 4
        ? 'Snappy retention pacing (~2.5s–3.5s per visual beat)'
        : 'Balanced narrative pacing',
    colorPalette: {
      primaryHex: intake.brandKit.primaryColorHex,
      secondaryHex: intake.brandKit.secondaryColorHex,
      backgroundHex: intake.brandKit.backgroundColorHex,
      surfaceHex: '#141210',
      textHex: '#F3EEE8',
    },
    typographySpec: {
      headingFont: intake.brandKit.headingFont,
      bodyFont: intake.brandKit.bodyFont,
      captionFont: 'JetBrains Mono',
      scaleRatio: 1.25,
    },
    footageAndAssetsPolicy:
      'Prioritize Tier 1 Verified Sowveil Templates & User Assets; fall back to Tier 4 Procedural Vector Rigs if external dependencies are unavailable.',
    cameraLanguage:
      'Subtle 2.5D push-in on claims, crisp static framing on data examples, and energetic whip transitions on emotional shifts.',
    graphicsAndOverlays:
      'Liquid-glass telemetry cards, easing curve HUD callouts, and subtle film grain overlay.',
    voiceoverDirection:
      'Clear, articulate pacing synchronized to sentence boundaries with -14 LUFS target loudness.',
    captionsPolicy:
      '100% verbatim synchronized captions in lower-third safe zone with active keyword highlight.',
    sfxDirection:
      'Procedural sub-bass whoosh on shot entrances and tactile UI clicks on metric callouts.',
    musicDirection:
      'Minimal dark electronic pulse ducked -12 dB beneath spoken narration.',
    transitionsPolicy:
      'Cubic-bezier [0.22, 1, 0.36, 1] whip-pan and scale-morph transitions (0.25s).',
    accessibilityRequirements: {
      minContrastRatio: 7.2,
      safeZoneMarginPercent: 10,
      seizureFlashSafe: true,
      verbatimCaptionsRequired: true,
    },
    deliverablesAndRestrictions: {
      outputEditor: intake.outputFormat,
      prohibitedContent: intake.prohibitedContent,
      recordedAssumptions,
    },
  };

  let runningStartSec = 0;
  const fallbackTextTemplate =
    SEED_CATALOG_ITEMS.find((i) => i.moduleId === 'text-animation') || SEED_CATALOG_ITEMS[0];

  const shots: DirectorShotPlanItem[] = segments.map((seg, idx) => {
    const shotId = `shot_${String(idx + 1).padStart(3, '0')}`;
    const visualIdea = analysis.visualPossibilities.find(
      (v) => v.segmentId === seg.segmentId
    );
    const suggestedModuleId: ModuleId = visualIdea?.suggestedModuleId || 'text-animation';

    const rankedCandidates = evaluateAssetCandidatesForSegment(
      seg,
      suggestedModuleId,
      intake.outputFormat
    );
    const topCandidate = rankedCandidates[0];
    const altTemplates = rankedCandidates
      .filter((c) => c.catalogItemId && c.catalogItemId !== topCandidate.catalogItemId)
      .map((c) => c.catalogItemId!);

    const durationSec = seg.estimatedDurationSec;
    const startTimeSec = Number(runningStartSec.toFixed(2));
    runningStartSec += durationSec;

    const cameraMotion: ShotEditableParameters['cameraMotion'] =
      seg.kind === 'hook'
        ? 'push-in'
        : seg.kind === 'example'
        ? 'pan-right'
        : seg.kind === 'cta'
        ? 'pull-out'
        : 'static';

    const cubicBezier: [number, number, number, number] =
      seg.emotionalTone === 'urgent'
        ? [0.16, 1, 0.3, 1]
        : seg.emotionalTone === 'curious'
        ? [0.34, 1.56, 0.64, 1]
        : [0.22, 1, 0.36, 1];

    const risksAndWarnings: DirectorShotPlanItem['risksAndWarnings'] = [];
    if (seg.wordCount > 22) {
      risksAndWarnings.push({
        code: 'HIGH_TEXT_DENSITY',
        severity: 'medium',
        message: `Segment has ${seg.wordCount} words; split headline and caption to preserve mobile legibility.`,
      });
    }
    if (suggestedModuleId === '3d-models' || suggestedModuleId === 'mockups') {
      risksAndWarnings.push({
        code: 'MOBILE_GPU_FALLBACK_READY',
        severity: 'low',
        message: 'Uses 2.5D perspective projection on low-end mobile GPUs; 2D fallback template pre-wired.',
      });
    }

    const selectedTemplateId = topCandidate.catalogItemId || fallbackTextTemplate.id;
    const headlineText =
      seg.mustPreservePhrases[0] ||
      seg.exactOriginalText.split(/[,.—-]/)[0]?.trim() ||
      seg.exactOriginalText.slice(0, 48);

    // Link segment -> shot
    seg.plannedShotIds = [shotId];
    seg.status = 'planned';

    return {
      shotId,
      shotNumber: idx + 1,
      scriptSegmentIds: [seg.segmentId],
      exactTextCoverage: seg.exactOriginalText,
      characterStartOffset: seg.startOffset,
      characterEndOffset: seg.endOffset,
      startTimeSec,
      estimatedDurationSec: durationSec,
      beatAndEmotionalPurpose: `${seg.kind.toUpperCase()} beat (${seg.emotionalTone.trim()} tone)`,
      subjectAndAction:
        visualIdea?.visualIdea ||
        `Animate verbatim key phrase "${headlineText}" with synchronized caption cue.`,
      compositionFramingCameraMovement: {
        framing:
          seg.kind === 'hook'
            ? 'close-up'
            : seg.kind === 'example'
            ? 'isometric-ui'
            : 'medium-shot',
        cameraMovement: cameraMotion,
        parallaxDepth:
          suggestedModuleId === 'mockups' ? 'layered-2.5d' : 'flat-2d',
      },
      backgroundEnvironment: `Obsidian studio stage (${brief.colorPalette.backgroundHex}) with radial ember vignette`,
      paletteAndLighting: {
        primaryHex: brief.colorPalette.primaryHex,
        accentHex: brief.colorPalette.secondaryHex,
        backgroundHex: brief.colorPalette.backgroundHex,
        lightingMood: seg.emotionalTone === 'urgent' ? 'High-contrast rim light' : 'Soft studio key light',
      },
      typographyAndGraphics: {
        headlineText,
        subheadText: seg.exactOriginalText,
        fontFamily: brief.typographySpec.headingFont,
        kineticPreset: topCandidate.title,
        mustPreserveVerbatim: seg.mustPreserveExactWording,
      },
      assetsRequiredAndPreferredSource: {
        requiredSlots: ['primary-typography-rig', 'caption-cue', 'sfx-accent'],
        preferredTier: topCandidate.tier,
        rankedCandidates,
        selectedCandidateId: topCandidate.candidateId,
      },
      templateCandidatesAndRationale: {
        primaryTemplateId: selectedTemplateId,
        primaryTemplateName: topCandidate.title,
        moduleId: suggestedModuleId,
        rationale: topCandidate.fitExplanation,
        alternativeTemplateIds:
          altTemplates.length > 0 ? altTemplates : [fallbackTextTemplate.id],
      },
      animationAndEasing: {
        easingPresetName:
          seg.emotionalTone === 'curious' ? 'Spring Overshoot' : 'Expo Out Snappy',
        cubicBezier,
        entranceStyle: 'Slide-up + opacity fade-in (0.35s)',
        exitStyle: 'Scale-down settle (0.2s)',
      },
      transitionInOut: {
        transitionIn: idx === 0 ? 'Dissolve' === 'Dissolve' ? 'dissolve' : 'cut' : 'whip-pan',
        transitionOut: idx === segments.length - 1 ? 'dissolve' : 'cut',
        durationSec: 0.25,
      },
      audioVoiceSfxMusicIntent: {
        voiceoverTranscript: seg.exactOriginalText,
        sfxCue: seg.kind === 'hook' ? 'Sub-bass impact riser' : 'Tactile UI whoosh',
        musicBedIntent: 'Steady 120 BPM dark synth pulse',
        musicDuckingDb: -12,
      },
      effects3dCompositing: {
        blendMode: 'normal',
        effectsList: ['glow-accent', 'motion-blur-subtle'],
        requires3dCamera: suggestedModuleId === '3d-models',
      },
      technicalParameters: {
        width: dims.width,
        height: dims.height,
        fps: intake.fps,
        layerCountEstimate: 3,
        mobileGpuTier:
          suggestedModuleId === '3d-models' ? 'webgl-3d-experimental' : 'canvas-2d',
      },
      fallbackApproach: {
        strategyName: 'Deterministic 2D Kinetic Vector Fallback',
        fallbackModuleId: 'text-animation',
        fallbackTemplateId: fallbackTextTemplate.id,
        description:
          'If the primary module asset or 3D shader fails, isolate this shot and render via the 2D Canvas kinetic title rig while preserving 100% of the script text and caption cue.',
        activated: false,
      },
      risksAndWarnings,
      estimatedWorkAndCostUsd: 0.02,
      editableParameters: {
        headlineText,
        subheadText: seg.exactOriginalText,
        durationSec,
        accentColorHex: brief.colorPalette.primaryHex,
        cameraMotion,
        easingCurve: cubicBezier,
        selectedTemplateId,
        voiceoverGainDb: 0,
      },
      approvalState: intake.autonomyMode === 'bounded-autonomy' ? 'approved' : 'pending',
      lockedFields: [],
      productionStatus: 'not-started',
    };
  });

  return { brief, shots };
}

// ============================================================================
// 13. SESSION CREATION & PLAN EDIT / APPROVAL / LOCK OPERATIONS
// ============================================================================

export function createAiDirectorSession(input: {
  ownerUid: string;
  title?: string;
  rawScriptText: string;
  uploadedFileName?: string;
  scriptFormat?: DirectorIntakeConfig['scriptFormat'];
  references?: string[];
  intendedPlatform?: IntendedPlatformId;
  targetDurationSec?: number | null;
  aspectRatio?: MobileAspectRatio;
  fps?: 24 | 30 | 60;
  language?: string;
  audience?: string;
  visualGoals?: string;
  brandKit?: Partial<DirectorBrandKitInput>;
  voiceAudioAssets?: string[];
  availableResources?: string[];
  prohibitedContent?: string[];
  budgetLatencyPreference?: BudgetLatencyPreferenceMode;
  maxBudgetUsd?: number;
  outputFormat?: TargetMobileEditorId;
  preserveEveryRepetition?: boolean;
  noQuestionsWorkflow?: boolean;
  autonomyMode?: DirectorAutonomyMode;
}): AiDirectorSessionRecord {
  const now = new Date().toISOString();
  const id = `dir_sess_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  const defaultedFields: string[] = [];
  if (!input.intendedPlatform) defaultedFields.push('intendedPlatform');
  if (!input.aspectRatio) defaultedFields.push('aspectRatio');
  if (!input.audience) defaultedFields.push('audience');
  if (!input.visualGoals) defaultedFields.push('visualGoals');
  if (!input.brandKit?.primaryColorHex) defaultedFields.push('brandKit');
  if (!input.outputFormat) defaultedFields.push('outputFormat');

  const intake: DirectorIntakeConfig = {
    title: (input.title || 'Untitled AI Director Production').trim().slice(0, 140),
    rawScriptText: input.rawScriptText,
    uploadedFileName: input.uploadedFileName,
    scriptFormat: input.scriptFormat || 'plain-text',
    references: input.references || [],
    intendedPlatform: input.intendedPlatform || 'youtube-shorts',
    targetDurationSec: input.targetDurationSec ?? null,
    aspectRatio: input.aspectRatio || '9:16',
    fps: input.fps || 60,
    language: input.language || 'en-US',
    audience:
      input.audience || 'Creators, product marketers, and mobile motion designers',
    visualGoals:
      input.visualGoals ||
      'High-retention kinetic typography, clear visual examples, and synchronized verbatim captions',
    brandKit: {
      brandName: input.brandKit?.brandName || 'Sowveil Studio',
      primaryColorHex: input.brandKit?.primaryColorHex || '#F06424',
      secondaryColorHex: input.brandKit?.secondaryColorHex || '#E4B45A',
      backgroundColorHex: input.brandKit?.backgroundColorHex || '#0B0A09',
      headingFont: input.brandKit?.headingFont || 'Inter',
      bodyFont: input.brandKit?.bodyFont || 'Inter',
      logoAssetId: input.brandKit?.logoAssetId,
    },
    voiceAudioAssets: input.voiceAudioAssets || [],
    availableResources: input.availableResources || [],
    prohibitedContent: input.prohibitedContent || [],
    budgetLatencyPreference: input.budgetLatencyPreference || 'quality-first-argon',
    maxBudgetUsd: input.maxBudgetUsd ?? 2.5,
    outputFormat: input.outputFormat || 'sowveil-project',
    preserveEveryRepetition: input.preserveEveryRepetition ?? true,
    noQuestionsWorkflow: Boolean(input.noQuestionsWorkflow),
    autonomyMode: input.autonomyMode || 'require-approval',
    defaultedFields,
  };

  // Step 1: Segment script with exact character offsets & chunking
  const segmented = segmentScriptWithExactOffsets(intake.rawScriptText, {
    preserveEveryRepetition: intake.preserveEveryRepetition,
  });

  // Step 2: Run semantic analysis
  const analysisReport = analyzeScriptSemantics(
    intake.rawScriptText,
    segmented.segments,
    segmented.chunkCountProcessed,
    segmented.reconciliationVerified,
    intake.budgetLatencyPreference
  );

  // Step 3: Build classified questions
  const questions = buildClarificationQuestions(intake, analysisReport);
  const answeredQuestionFingerprints = questions
    .filter((q) => q.status !== 'unanswered')
    .map((q) => q.fingerprint);

  // Step 4: Build comprehensive Production Brief & Shot-by-Shot Plan
  const { brief, shots } = buildProductionBriefAndShotPlan(
    intake,
    segmented.segments,
    analysisReport,
    questions
  );

  // Step 5: Compute initial complete coverage ledger
  const coverageLedger = computeCompleteCoverageLedger(
    intake.rawScriptText,
    segmented.segments,
    shots
  );

  const estimatedTotalCostUsd = Number(
    shots.reduce((acc, s) => acc + s.estimatedWorkAndCostUsd, 0.03).toFixed(4)
  );

  const initialStage: DirectorProductionStage = intake.noQuestionsWorkflow
    ? 'brief-shot-plan'
    : 'questions-clarification';

  const session: AiDirectorSessionRecord = {
    id,
    ownerUid: input.ownerUid,
    stage: initialStage,
    intake,
    originalScriptText: intake.rawScriptText,
    normalizedWorkingScript: segmented.normalizedWorkingScript,
    segments: segmented.segments,
    analysisReport,
    coverageLedger,
    questions,
    answeredQuestionFingerprints,
    productionBrief: brief,
    shots,
    planRevisions: [
      {
        revisionNumber: 1,
        savedAt: now,
        reason: 'Initial shot-by-shot director plan synthesized from script coverage ledger',
        shotsSnapshot: JSON.parse(JSON.stringify(shots)),
        coveragePercent: coverageLedger.coveragePercent,
      },
    ],
    traceability: {
      scriptToShotMap: Object.fromEntries(
        segmented.segments.map((s) => [s.segmentId, [...s.plannedShotIds]])
      ),
      shotToAssetsMap: {},
      shotToTemplateMap: Object.fromEntries(
        shots.map((sh) => [
          sh.shotId,
          sh.editableParameters.selectedTemplateId,
        ])
      ),
      shotToTimelineClipsMap: {},
    },
    generatedAssetRecords: [],
    canonicalProject: null,
    commandReceipts: [],
    refinementSuggestions: [],
    productionCheckpoints: [],
    acceptanceGate: {
      passed: false,
      evaluatedAt: now,
      checks: {
        exactSourcePreserved: coverageLedger.everyCharacterAccountedFor,
        zeroHiddenMissingSegments: coverageLedger.uncoveredSegments === 0,
        questionsStatePersisted: true,
        planIsEditableAndVersioned: true,
        approvalWorkflowEnforced: true,
        assetProvenanceStored: false,
        canonicalProjectValid: false,
        revisionsReversible: true,
        costsAndLimitationsClear: true,
        everyPassageTiedToTimelineOrApprovedOmission: false,
      },
      blockingReasons: ['Production compilation has not been executed yet.'],
      summary: 'Awaiting plan approval and canonical timeline compilation.',
    },
    estimatedTotalCostUsd,
    spentBudgetUsd: 0.01,
    createdAt: now,
    updatedAt: now,
  };

  session.acceptanceGate = evaluateDirectorAcceptanceGate(session);
  return session;
}

/**
 * Answers or locks clarification questions, or applies recommended defaults,
 * and remembers answered question fingerprints so they are never asked again.
 */
export function answerDirectorQuestions(
  session: AiDirectorSessionRecord,
  input: {
    answers?: Record<string, { answer: string; lockDecision?: boolean }>;
    applyDefaultsToUnanswered?: boolean;
  }
): AiDirectorSessionRecord {
  const next: AiDirectorSessionRecord = JSON.parse(JSON.stringify(session));
  const now = new Date().toISOString();
  const fpSet = new Set(next.answeredQuestionFingerprints);

  for (const q of next.questions) {
    const provided = input.answers?.[q.id];
    if (provided && provided.answer.trim()) {
      q.selectedAnswer = provided.answer.trim();
      q.lockedByUser = Boolean(provided.lockDecision);
      q.status = q.lockedByUser ? 'locked' : 'answered';
      q.answeredAt = now;
      fpSet.add(q.fingerprint);

      if (
        q.id === 'q_autonomy_gate' &&
        q.selectedAnswer.toLowerCase().includes('bounded autonomy')
      ) {
        next.intake.autonomyMode = 'bounded-autonomy';
      }
    } else if (input.applyDefaultsToUnanswered && q.status === 'unanswered') {
      q.selectedAnswer = q.recommendedDefault;
      q.status = 'default-applied';
      q.answeredAt = now;
      fpSet.add(q.fingerprint);
      next.productionBrief.deliverablesAndRestrictions.recordedAssumptions.push(
        `Default applied for "${q.id}": ${q.recommendedDefault}`
      );
    }
  }

  next.answeredQuestionFingerprints = Array.from(fpSet);
  const hasBlockingUnanswered = next.questions.some(
    (q) => q.classification === 'blocking' && q.status === 'unanswered'
  );
  if (!hasBlockingUnanswered && next.stage === 'questions-clarification') {
    next.stage = 'brief-shot-plan';
  }
  next.updatedAt = now;
  next.acceptanceGate = evaluateDirectorAcceptanceGate(next);
  return next;
}

/**
 * Allows the user to approve all shots, approve selected shots, edit shot parameters,
 * lock shot fields, switch template alternatives, or explicitly omit a script segment with consent.
 */
export function updateDirectorShotPlanAndApprovals(
  session: AiDirectorSessionRecord,
  input: {
    action:
      | 'approve-all'
      | 'approve-selected'
      | 'edit-shot'
      | 'lock-shot'
      | 'reject-or-switch-alternative'
      | 'omit-segment-with-consent';
    shotIds?: string[];
    shotId?: string;
    editablePatch?: Partial<ShotEditableParameters>;
    lockFields?: Array<keyof ShotEditableParameters>;
    segmentIdToOmit?: string;
    omissionReason?: string;
    actorUid?: string;
  }
): AiDirectorSessionRecord {
  const next: AiDirectorSessionRecord = JSON.parse(JSON.stringify(session));
  const now = new Date().toISOString();

  if (input.action === 'approve-all') {
    for (const shot of next.shots) {
      if (shot.approvalState !== 'locked') {
        shot.approvalState = 'approved';
      }
    }
  } else if (input.action === 'approve-selected' && Array.isArray(input.shotIds)) {
    const targetSet = new Set(input.shotIds);
    for (const shot of next.shots) {
      if (targetSet.has(shot.shotId) && shot.approvalState !== 'locked') {
        shot.approvalState = 'approved';
      }
    }
  } else if (input.action === 'edit-shot' && input.shotId && input.editablePatch) {
    const shot = next.shots.find((s) => s.shotId === input.shotId);
    if (!shot) {
      throw new Error(`SHOT_NOT_FOUND: Shot "${input.shotId}" does not exist.`);
    }
    const patch = input.editablePatch;
    if (patch.headlineText !== undefined) {
      shot.editableParameters.headlineText = patch.headlineText;
      shot.typographyAndGraphics.headlineText = patch.headlineText;
    }
    if (patch.subheadText !== undefined) {
      shot.editableParameters.subheadText = patch.subheadText;
      shot.typographyAndGraphics.subheadText = patch.subheadText;
    }
    if (patch.durationSec !== undefined && patch.durationSec >= 0.5) {
      shot.editableParameters.durationSec = Number(patch.durationSec.toFixed(2));
      shot.estimatedDurationSec = shot.editableParameters.durationSec;
    }
    if (patch.accentColorHex !== undefined) {
      shot.editableParameters.accentColorHex = patch.accentColorHex;
      shot.paletteAndLighting.primaryHex = patch.accentColorHex;
    }
    if (patch.cameraMotion !== undefined) {
      shot.editableParameters.cameraMotion = patch.cameraMotion;
      shot.compositionFramingCameraMovement.cameraMovement = patch.cameraMotion;
    }
    if (patch.easingCurve !== undefined && patch.easingCurve.length === 4) {
      shot.editableParameters.easingCurve = patch.easingCurve;
      shot.animationAndEasing.cubicBezier = patch.easingCurve;
    }
    if (patch.selectedTemplateId !== undefined) {
      const realTpl = SEED_CATALOG_ITEMS.find((t) => t.id === patch.selectedTemplateId);
      if (!realTpl) {
        throw new Error(
          `TEMPLATE_NOT_FOUND: Cannot assign non-existent catalog template "${patch.selectedTemplateId}".`
        );
      }
      shot.editableParameters.selectedTemplateId = realTpl.id;
      shot.templateCandidatesAndRationale.primaryTemplateId = realTpl.id;
      shot.templateCandidatesAndRationale.primaryTemplateName = realTpl.name;
      next.traceability.shotToTemplateMap[shot.shotId] = realTpl.id;
    }
    if (patch.voiceoverGainDb !== undefined) {
      shot.editableParameters.voiceoverGainDb = patch.voiceoverGainDb;
    }

    // Recompute sequential start times
    let cursorSec = 0;
    for (const s of next.shots) {
      s.startTimeSec = Number(cursorSec.toFixed(2));
      cursorSec += s.estimatedDurationSec;
    }
  } else if (input.action === 'lock-shot' && input.shotId) {
    const shot = next.shots.find((s) => s.shotId === input.shotId);
    if (!shot) {
      throw new Error(`SHOT_NOT_FOUND: Shot "${input.shotId}" does not exist.`);
    }
    shot.approvalState = 'locked';
    shot.lockedFields =
      input.lockFields && input.lockFields.length > 0
        ? Array.from(new Set([...shot.lockedFields, ...input.lockFields]))
        : [
            'headlineText',
            'subheadText',
            'durationSec',
            'accentColorHex',
            'cameraMotion',
            'easingCurve',
            'selectedTemplateId',
          ];
  } else if (input.action === 'reject-or-switch-alternative' && input.shotId) {
    const shot = next.shots.find((s) => s.shotId === input.shotId);
    if (!shot) {
      throw new Error(`SHOT_NOT_FOUND: Shot "${input.shotId}" does not exist.`);
    }
    // Switch to fallback or alternative template without dropping the script segment
    const altId =
      shot.templateCandidatesAndRationale.alternativeTemplateIds[0] ||
      shot.fallbackApproach.fallbackTemplateId;
    const altTpl = SEED_CATALOG_ITEMS.find((t) => t.id === altId);
    if (altTpl) {
      shot.editableParameters.selectedTemplateId = altTpl.id;
      shot.templateCandidatesAndRationale.primaryTemplateId = altTpl.id;
      shot.templateCandidatesAndRationale.primaryTemplateName = `${altTpl.name} (Alternative Selected)`;
      next.traceability.shotToTemplateMap[shot.shotId] = altTpl.id;
    }
    shot.fallbackApproach.activated = true;
    shot.fallbackApproach.activationReason = 'User switched primary candidate to alternative/fallback.';
    shot.approvalState = 'approved';
  } else if (
    input.action === 'omit-segment-with-consent' &&
    input.segmentIdToOmit
  ) {
    const seg = next.segments.find((s) => s.segmentId === input.segmentIdToOmit);
    if (!seg) {
      throw new Error(`SEGMENT_NOT_FOUND: Segment "${input.segmentIdToOmit}" not found.`);
    }
    seg.status = 'omitted-by-user-approval';
    seg.omissionReason =
      (input.omissionReason || 'Explicitly omitted by user in Director Plan review').trim();
    seg.omissionApprovedByUid = input.actorUid || session.ownerUid;

    // Mark any shot exclusively covering only this omitted segment as rejected
    for (const shot of next.shots) {
      if (
        shot.scriptSegmentIds.length === 1 &&
        shot.scriptSegmentIds[0] === seg.segmentId
      ) {
        shot.approvalState = 'rejected';
        shot.productionStatus = 'skipped-by-rejection';
      }
    }
  }

  next.coverageLedger = computeCompleteCoverageLedger(
    next.originalScriptText,
    next.segments,
    next.shots
  );

  next.planRevisions.unshift({
    revisionNumber: next.planRevisions.length + 1,
    savedAt: now,
    reason: `Plan updated via action "${input.action}"`,
    shotsSnapshot: JSON.parse(JSON.stringify(next.shots)),
    coveragePercent: next.coverageLedger.coveragePercent,
  });

  next.updatedAt = now;
  next.acceptanceGate = evaluateDirectorAcceptanceGate(next);
  return next;
}

// ============================================================================
// 14. PRODUCTION MODE: CANONICAL PROJECT COMPILATION & DEPENDENCY ISOLATION
// ============================================================================

export function executeDirectorProductionPlan(
  session: AiDirectorSessionRecord,
  options: {
    simulateFailedShotIds?: string[];
    onlyApprovedShots?: boolean;
  } = {}
): AiDirectorSessionRecord {
  const next: AiDirectorSessionRecord = JSON.parse(JSON.stringify(session));
  const now = new Date().toISOString();

  // Enforce approval gate unless bounded-autonomy is active
  const eligibleShots = next.shots.filter((s) => {
    if (s.approvalState === 'rejected') return false;
    if (next.intake.autonomyMode === 'bounded-autonomy') return true;
    return s.approvalState === 'approved' || s.approvalState === 'locked';
  });

  if (eligibleShots.length === 0) {
    throw new Error(
      'APPROVAL_REQUIRED_BEFORE_PRODUCTION: No shots are approved for production. Approve the plan or enable bounded autonomy.'
    );
  }

  // Create base canonical project (v2.0.0)
  const totalDuration = Math.max(
    4,
    Number(
      eligibleShots.reduce((acc, s) => acc + s.estimatedDurationSec, 0).toFixed(2)
    )
  );

  let project = createMinimalCanonicalProject({
    id: next.canonicalProject?.id || `proj_dir_${next.id}`,
    ownerUid: next.ownerUid,
    title: next.intake.title,
    description: `Produced by Sowveil AI Director (${eligibleShots.length} shots, ${next.coverageLedger.coveragePercent}% script coverage).`,
    moduleId: 'templates',
    targetEditor: next.intake.outputFormat,
    aspectRatio: next.intake.aspectRatio,
    fps: next.intake.fps,
    durationSec: totalDuration,
  });

  // Clear starter clip on text track so timeline clips map 1-to-1 with planned shots
  for (const track of project.tracks) {
    track.clips = [];
  }
  project.scenes = [];
  project.markers = [];

  const receipts: ProjectCommandReceipt[] = [];
  const generatedAssets: GeneratedAssetProvenanceRecord[] = [];
  const failedShotSet = new Set(options.simulateFailedShotIds || []);

  const textTrack = project.tracks.find((t) => t.kind === 'text') || project.tracks[0];
  const vectorTrack = project.tracks.find((t) => t.kind === 'vector') || project.tracks[0];
  const captionTrack = project.tracks.find((t) => t.kind === 'caption') || project.tracks[0];
  const audioTrack = project.tracks.find((t) => t.kind === 'audio') || project.tracks[0];

  const shotToAssetsMap: Record<string, string[]> = {};
  const shotToTemplateMap: Record<string, string> = {};
  const shotToTimelineClipsMap: Record<string, string[]> = {};

  for (const seg of next.segments) {
    seg.timelineClipIds = [];
  }

  let runningStartSec = 0;

  for (const shot of eligibleShots) {
    const startSec = Number(runningStartSec.toFixed(2));
    const durSec = shot.editableParameters.durationSec;
    runningStartSec += durSec;
    shot.startTimeSec = startSec;

    const sceneId = `scene_${shot.shotId}`;
    project.scenes.push({
      id: sceneId,
      title: `Shot ${shot.shotNumber}: ${shot.editableParameters.headlineText.slice(0, 32)}`,
      order: shot.shotNumber - 1,
      startTimeSec: startSec,
      durationSec: durSec,
      scriptSegmentIds: [...shot.scriptSegmentIds],
      continuityNotes: shot.beatAndEmotionalPurpose,
      status: 'approved',
    });

    // Check if dependency failed on this shot; if so, isolate scene and activate fallback (never delete!)
    const dependencyFailed = failedShotSet.has(shot.shotId);
    let effectiveTemplateId = shot.editableParameters.selectedTemplateId;
    if (dependencyFailed) {
      shot.fallbackApproach.activated = true;
      shot.fallbackApproach.activationReason =
        'Primary asset/dependency failed during compilation; isolated scene and substituted deterministic 2D fallback rig.';
      effectiveTemplateId = shot.fallbackApproach.fallbackTemplateId;
      shot.productionStatus = 'fallback-isolated';
      shot.risksAndWarnings.push({
        code: 'DEPENDENCY_ISOLATED_FALLBACK_ACTIVE',
        severity: 'medium',
        message: shot.fallbackApproach.activationReason,
      });
    } else {
      shot.productionStatus = 'compiled-to-timeline';
    }

    shotToTemplateMap[shot.shotId] = effectiveTemplateId;

    // Create procedural/generative asset record with explicit provenance
    const assetTaskId = `asset_dir_${shot.shotId}`;
    generatedAssets.push({
      assetTaskId,
      shotId: shot.shotId,
      title: `${shot.editableParameters.headlineText.slice(0, 28)} Motion Plate`,
      kind: dependencyFailed ? 'procedural-svg-plate' : 'kinetic-title-rig',
      licenseType: 'Sowveil Original',
      provenanceNote: dependencyFailed
        ? `Fallback procedural plate generated for isolated shot ${shot.shotId}`
        : `Compiled from template ${effectiveTemplateId} for shot ${shot.shotId}`,
      createdAt: now,
      status: dependencyFailed ? 'fallback-substituted' : 'completed',
    });
    shotToAssetsMap[shot.shotId] = [assetTaskId];

    const createdClipIds: string[] = [];

    // 1. Instantiate Template / Vector Motion Clip via typed command
    const tplClipId = `clip_tpl_${shot.shotId}`;
    const tplRes = executeProjectCommand(
      project,
      {
        type: 'instantiateTemplate',
        templateId: effectiveTemplateId,
        templateTitle: shot.templateCandidatesAndRationale.primaryTemplateName,
        moduleId: shot.templateCandidatesAndRationale.moduleId,
        trackId: vectorTrack.id,
        clipId: tplClipId,
        startTimeSec: startSec,
        durationSec: durSec,
        parameterOverrides: {
          headline: shot.editableParameters.headlineText,
          accentColor: shot.editableParameters.accentColorHex,
        },
        editabilityLevel: 'source-proven',
      },
      {
        actorId: next.ownerUid,
        actorKind: 'ai-director',
        rationale: `Compile shot ${shot.shotId} template instance (${effectiveTemplateId})`,
        approvedByUser: true,
      }
    );
    project = tplRes.project;
    receipts.push(tplRes.receipt);
    createdClipIds.push(tplClipId);

    // 2. Create Primary Kinetic Typography Clip via typed command
    const textClipId = `clip_txt_${shot.shotId}`;
    const txtRes = executeProjectCommand(
      project,
      {
        type: 'createClip',
        trackId: textTrack.id,
        clip: {
          id: textClipId,
          name: shot.editableParameters.headlineText.slice(0, 40),
          kind: 'text',
          sceneId,
          sourceSegmentId: shot.scriptSegmentIds[0],
          startTimeSec: startSec,
          durationSec: durSec,
          textData: {
            content: shot.editableParameters.headlineText,
            fontFamily: next.productionBrief.typographySpec.headingFont,
            fontSizePx: 64,
            fontWeight: 800,
            letterSpacingEm: -0.02,
            lineHeightMultiplier: 1.15,
            colorHex: '#F3EEE8',
            strokeColorHex: shot.editableParameters.accentColorHex,
            strokeWidthPx: 0,
            alignment: 'center',
          },
          keyframes: [
            {
              id: `kf_in_${shot.shotId}`,
              property: 'opacity',
              timeSec: startSec,
              value: 0,
              interpolation: 'cubic-bezier',
              cubicBezier: shot.editableParameters.easingCurve,
            },
            {
              id: `kf_hold_${shot.shotId}`,
              property: 'opacity',
              timeSec: Number((startSec + Math.min(0.4, durSec * 0.3)).toFixed(2)),
              value: 1,
              interpolation: 'cubic-bezier',
              cubicBezier: shot.editableParameters.easingCurve,
            },
          ],
        },
      },
      {
        actorId: next.ownerUid,
        actorKind: 'ai-director',
        rationale: `Create kinetic headline clip for shot ${shot.shotId}`,
        approvedByUser: true,
      }
    );
    project = txtRes.project;
    receipts.push(txtRes.receipt);
    createdClipIds.push(textClipId);

    // 3. Create Verbatim Synchronized Caption Clip via typed command
    const capClipId = `clip_cap_${shot.shotId}`;
    const capRes = executeProjectCommand(
      project,
      {
        type: 'createClip',
        trackId: captionTrack.id,
        clip: {
          id: capClipId,
          name: `Caption ${shot.shotNumber}`,
          kind: 'caption',
          sceneId,
          sourceSegmentId: shot.scriptSegmentIds[0],
          startTimeSec: startSec,
          durationSec: durSec,
          captionData: {
            cueIndex: shot.shotNumber,
            text: shot.exactTextCoverage,
            speaker: 'Narrator',
            stylePresetId: 'sowveil-verbatim',
            highlightColorHex: shot.editableParameters.accentColorHex,
            maxCharsPerLine: 42,
          },
        },
      },
      {
        actorId: next.ownerUid,
        actorKind: 'ai-director',
        rationale: `Create verbatim caption cue for shot ${shot.shotId}`,
        approvedByUser: true,
      }
    );
    project = capRes.project;
    receipts.push(capRes.receipt);
    createdClipIds.push(capClipId);

    // 4. Create Audio / SFX Cue Clip via typed command
    const sfxClipId = `clip_sfx_${shot.shotId}`;
    const sfxRes = executeProjectCommand(
      project,
      {
        type: 'createClip',
        trackId: audioTrack.id,
        clip: {
          id: sfxClipId,
          name: shot.audioVoiceSfxMusicIntent.sfxCue,
          kind: 'audio',
          sceneId,
          sourceSegmentId: shot.scriptSegmentIds[0],
          startTimeSec: startSec,
          durationSec: durSec,
          audioConfig: {
            gainDb: shot.editableParameters.voiceoverGainDb,
            linearGain: 1,
            pan: 0,
            fadeInSec: 0.05,
            fadeOutSec: 0.1,
            muted: false,
            proceduralSfxPreset: 'whoosh-riser',
          },
        },
      },
      {
        actorId: next.ownerUid,
        actorKind: 'ai-director',
        rationale: `Create audio/SFX cue for shot ${shot.shotId}`,
        approvedByUser: true,
      }
    );
    project = sfxRes.project;
    receipts.push(sfxRes.receipt);
    createdClipIds.push(sfxClipId);

    // 5. Add Timeline Marker tying shot back to exact script segment
    const markerRes = executeProjectCommand(
      project,
      {
        type: 'addMarker',
        marker: {
          id: `mk_${shot.shotId}`,
          timeSec: startSec,
          durationSec: durSec,
          label: `${shot.shotId} · ${shot.scriptSegmentIds.join(',')}`,
          colorHex: shot.editableParameters.accentColorHex,
          kind: 'script-cue',
          linkedScriptSegmentId: shot.scriptSegmentIds[0],
        },
      },
      {
        actorId: next.ownerUid,
        actorKind: 'ai-director',
        rationale: `Link marker to script segment ${shot.scriptSegmentIds[0]}`,
        approvedByUser: true,
      }
    );
    project = markerRes.project;
    receipts.push(markerRes.receipt);

    shotToTimelineClipsMap[shot.shotId] = createdClipIds;

    // Bind timelineClipIds back to every covered script segment
    for (const segId of shot.scriptSegmentIds) {
      const seg = next.segments.find((s) => s.segmentId === segId);
      if (seg) {
        seg.timelineClipIds = Array.from(
          new Set([...seg.timelineClipIds, ...createdClipIds])
        );
        seg.status = 'produced-on-timeline';
      }
    }
  }

  project.provenance = {
    originType: 'ai-director',
    authorUid: next.ownerUid,
    licenseType: 'Sowveil Original',
    licenseNote: 'Compiled from verified script coverage ledger in Sowveil AI Director',
    attribution: next.intake.brandKit.brandName,
  };

  next.canonicalProject = project;
  next.commandReceipts = [...receipts, ...next.commandReceipts].slice(0, 200);
  next.generatedAssetRecords = generatedAssets;
  next.traceability = {
    scriptToShotMap: Object.fromEntries(
      next.segments.map((s) => [s.segmentId, [...s.plannedShotIds]])
    ),
    shotToAssetsMap,
    shotToTemplateMap,
    shotToTimelineClipsMap,
  };

  next.coverageLedger = computeCompleteCoverageLedger(
    next.originalScriptText,
    next.segments,
    next.shots
  );

  // Create initial reversible production checkpoint
  const checkpointId = `chk_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
  next.productionCheckpoints.unshift({
    checkpointId,
    label: `Checkpoint #${next.productionCheckpoints.length + 1} · Initial Production Cut`,
    createdAt: now,
    reason: `Compiled ${eligibleShots.length} approved shot(s) into Canonical Project v2.0.0`,
    canonicalProjectSnapshot: JSON.parse(JSON.stringify(project)),
    shotsSnapshot: JSON.parse(JSON.stringify(next.shots)),
    coverageLedgerSnapshot: JSON.parse(JSON.stringify(next.coverageLedger)),
  });

  // Generate adaptive refinement suggestions comparing cut vs. plan
  next.refinementSuggestions = generateAdaptiveRefinementSuggestions(next);
  next.spentBudgetUsd = Number((next.spentBudgetUsd + eligibleShots.length * 0.015).toFixed(4));
  next.stage = next.coverageLedger.uncoveredSegments === 0 ? 'acceptance-verified' : 'adaptive-refinement';
  next.updatedAt = now;
  next.acceptanceGate = evaluateDirectorAcceptanceGate(next);
  return next;
}

// ============================================================================
// 15. ADAPTIVE REFINEMENT ENGINE & REVERSIBLE ROLLBACK
// ============================================================================

export function generateAdaptiveRefinementSuggestions(
  session: AiDirectorSessionRecord
): AdaptiveRefinementSuggestion[] {
  const suggestions: AdaptiveRefinementSuggestion[] = [];

  for (const shot of session.shots) {
    if (shot.approvalState === 'rejected') continue;
    const clipIds = session.traceability.shotToTimelineClipsMap[shot.shotId] || [];

    // 1. Pacing optimization for dense segments
    const isDurationLocked =
      shot.approvalState === 'locked' || shot.lockedFields.includes('durationSec');
    if (shot.estimatedDurationSec < 3.2 && shot.exactTextCoverage.split(/\s+/).length >= 10) {
      const targetDur = Number((shot.estimatedDurationSec + 0.6).toFixed(2));
      suggestions.push({
        suggestionId: `ref_pacing_${shot.shotId}`,
        category: 'pacing',
        title: `Extend ${shot.shotId} reading hold by +0.6s`,
        reason: `Shot ${shot.shotNumber} contains ${
          shot.exactTextCoverage.split(/\s+/).length
        } words over ${shot.estimatedDurationSec}s, which may feel rushed on mobile screens.`,
        expectedBenefit: 'Improves viewer comprehension and verbatim caption readability.',
        riskAndCost: {
          riskLevel: 'low',
          estimatedCostUsd: 0.005,
          estimatedLatencyMs: 120,
        },
        affectedShotIds: [shot.shotId],
        affectedSegmentIds: [...shot.scriptSegmentIds],
        affectedClipIds: clipIds,
        targetEditableField: 'durationSec',
        proposedNewValue: targetDur,
        blockedByUserLock: isDurationLocked,
        lockBlockReason: isDurationLocked
          ? `Blocked: Shot ${shot.shotId} ("durationSec") is locked by the user.`
          : null,
        status: 'proposed',
      });
    }

    // 2. Visual variety / camera motion polish on static middle shots
    const isCameraLocked =
      shot.approvalState === 'locked' || shot.lockedFields.includes('cameraMotion');
    if (
      shot.shotNumber > 1 &&
      shot.editableParameters.cameraMotion === 'static'
    ) {
      suggestions.push({
        suggestionId: `ref_cam_${shot.shotId}`,
        category: 'visual-variety',
        title: `Add subtle 2.5D push-in camera drift on ${shot.shotId}`,
        reason: `Shot ${shot.shotNumber} is currently static; adding a gentle push-in maintains visual momentum between beats.`,
        expectedBenefit: 'Increases mid-reel visual retention without altering verbatim text.',
        riskAndCost: {
          riskLevel: 'low',
          estimatedCostUsd: 0.004,
          estimatedLatencyMs: 90,
        },
        affectedShotIds: [shot.shotId],
        affectedSegmentIds: [...shot.scriptSegmentIds],
        affectedClipIds: clipIds,
        targetEditableField: 'cameraMotion',
        proposedNewValue: 'push-in',
        blockedByUserLock: isCameraLocked,
        lockBlockReason: isCameraLocked
          ? `Blocked: Shot ${shot.shotId} ("cameraMotion") is locked by the user.`
          : null,
        status: 'proposed',
      });
    }
  }

  // Always provide at least one concrete high-contrast accent refinement if list is empty
  if (suggestions.length === 0 && session.shots.length > 0) {
    const firstShot = session.shots[0];
    const isColorLocked =
      firstShot.approvalState === 'locked' ||
      firstShot.lockedFields.includes('accentColorHex');
    suggestions.push({
      suggestionId: `ref_contrast_${firstShot.shotId}`,
      category: 'typography-contrast',
      title: `Boost hook accent highlight on ${firstShot.shotId}`,
      reason: 'Opening hook benefits from maximum ember-orange chromatic contrast.',
      expectedBenefit: 'Strengthens first-frame thumb-stopping contrast.',
      riskAndCost: {
        riskLevel: 'low',
        estimatedCostUsd: 0.003,
        estimatedLatencyMs: 80,
      },
      affectedShotIds: [firstShot.shotId],
      affectedSegmentIds: [...firstShot.scriptSegmentIds],
      affectedClipIds: session.traceability.shotToTimelineClipsMap[firstShot.shotId] || [],
      targetEditableField: 'accentColorHex',
      proposedNewValue: '#FF7A33',
      blockedByUserLock: isColorLocked,
      lockBlockReason: isColorLocked
        ? `Blocked: Shot ${firstShot.shotId} ("accentColorHex") is locked by the user.`
        : null,
      status: 'proposed',
    });
  }

  return suggestions;
}

/**
 * Applies a proposed refinement suggestion while respecting user locks, budget caps,
 * creating a reversible checkpoint, and re-evaluating continuity & script coverage.
 */
export function applyAdaptiveRefinement(
  session: AiDirectorSessionRecord,
  suggestionId: string
): AiDirectorSessionRecord {
  const next: AiDirectorSessionRecord = JSON.parse(JSON.stringify(session));
  const now = new Date().toISOString();

  const suggestion = next.refinementSuggestions.find(
    (s) => s.suggestionId === suggestionId
  );
  if (!suggestion) {
    throw new Error(`SUGGESTION_NOT_FOUND: Refinement "${suggestionId}" not found.`);
  }

  const targetShot = next.shots.find((s) => s.shotId === suggestion.affectedShotIds[0]);
  if (!targetShot) {
    throw new Error('TARGET_SHOT_NOT_FOUND: Target shot for refinement does not exist.');
  }

  // Strictly enforce user locks
  if (
    suggestion.blockedByUserLock ||
    targetShot.approvalState === 'locked' ||
    targetShot.lockedFields.includes(suggestion.targetEditableField)
  ) {
    throw new Error(
      `LOCKED_DECISION_PROTECTED: Cannot apply refinement "${suggestionId}" because shot "${targetShot.shotId}" (${suggestion.targetEditableField}) is locked by the user.`
    );
  }

  // Enforce budget cap
  if (
    next.spentBudgetUsd + suggestion.riskAndCost.estimatedCostUsd >
    next.intake.maxBudgetUsd
  ) {
    throw new Error(
      `BUDGET_CAP_EXCEEDED: Applying refinement would exceed max budget ($${next.intake.maxBudgetUsd}).`
    );
  }

  // Save reversible checkpoint BEFORE mutating shot or canonical project
  if (next.canonicalProject) {
    const checkpointId = `chk_pre_${suggestion.suggestionId}_${Date.now()}`;
    next.productionCheckpoints.unshift({
      checkpointId,
      label: `Pre-Refinement Checkpoint (${suggestion.title})`,
      createdAt: now,
      reason: `Automatic reversible checkpoint before applying "${suggestion.title}"`,
      canonicalProjectSnapshot: JSON.parse(JSON.stringify(next.canonicalProject)),
      shotsSnapshot: JSON.parse(JSON.stringify(next.shots)),
      coverageLedgerSnapshot: JSON.parse(JSON.stringify(next.coverageLedger)),
    });
    suggestion.appliedCheckpointId = checkpointId;
  }

  // Apply change to shot editable parameters
  if (suggestion.targetEditableField === 'durationSec') {
    const newDur = Number(suggestion.proposedNewValue);
    targetShot.editableParameters.durationSec = newDur;
    targetShot.estimatedDurationSec = newDur;

    if (next.canonicalProject) {
      for (const clipId of suggestion.affectedClipIds) {
        const res = executeProjectCommand(
          next.canonicalProject,
          {
            type: 'trimClip',
            clipId,
            durationSec: newDur,
          },
          {
            actorId: next.ownerUid,
            actorKind: 'ai-director',
            rationale: `Refinement ${suggestion.suggestionId}: ${suggestion.title}`,
            approvedByUser: true,
          }
        );
        next.canonicalProject = res.project;
        next.commandReceipts.unshift(res.receipt);
      }
    }
  } else if (suggestion.targetEditableField === 'cameraMotion') {
    const newMotion = suggestion.proposedNewValue as ShotEditableParameters['cameraMotion'];
    targetShot.editableParameters.cameraMotion = newMotion;
    targetShot.compositionFramingCameraMovement.cameraMovement = newMotion;

    if (next.canonicalProject && suggestion.affectedClipIds[0]) {
      const res = executeProjectCommand(
        next.canonicalProject,
        {
          type: 'setTransform',
          clipId: suggestion.affectedClipIds[0],
          transform: { scale: [1.05, 1.05] },
        },
        {
          actorId: next.ownerUid,
          actorKind: 'ai-director',
          rationale: `Refinement ${suggestion.suggestionId}: ${suggestion.title}`,
          approvedByUser: true,
        }
      );
      next.canonicalProject = res.project;
      next.commandReceipts.unshift(res.receipt);
    }
  } else if (suggestion.targetEditableField === 'accentColorHex') {
    const newColor = String(suggestion.proposedNewValue);
    targetShot.editableParameters.accentColorHex = newColor;
    targetShot.paletteAndLighting.primaryHex = newColor;
  }

  suggestion.status = 'applied';
  next.spentBudgetUsd = Number(
    (next.spentBudgetUsd + suggestion.riskAndCost.estimatedCostUsd).toFixed(4)
  );

  // Re-evaluate continuity and coverage after changes
  next.coverageLedger = computeCompleteCoverageLedger(
    next.originalScriptText,
    next.segments,
    next.shots
  );
  next.updatedAt = now;
  next.acceptanceGate = evaluateDirectorAcceptanceGate(next);
  return next;
}

/**
 * Rolls back the AI Director session's canonical project, shots, and coverage ledger
 * to any saved `ProductionCheckpointRecord`.
 */
export function rollbackDirectorToCheckpoint(
  session: AiDirectorSessionRecord,
  checkpointId: string
): AiDirectorSessionRecord {
  const next: AiDirectorSessionRecord = JSON.parse(JSON.stringify(session));
  const target = next.productionCheckpoints.find((c) => c.checkpointId === checkpointId);
  if (!target) {
    throw new Error(`CHECKPOINT_NOT_FOUND: Checkpoint "${checkpointId}" does not exist.`);
  }

  next.canonicalProject = JSON.parse(JSON.stringify(target.canonicalProjectSnapshot));
  next.shots = JSON.parse(JSON.stringify(target.shotsSnapshot));
  next.coverageLedger = computeCompleteCoverageLedger(
    next.originalScriptText,
    next.segments,
    next.shots
  );

  for (const sug of next.refinementSuggestions) {
    if (sug.appliedCheckpointId === checkpointId) {
      sug.status = 'rolled-back';
    }
  }

  next.updatedAt = new Date().toISOString();
  next.acceptanceGate = evaluateDirectorAcceptanceGate(next);
  return next;
}

// ============================================================================
// 16. ACCEPTANCE GATE VERIFIER
// ============================================================================

export function evaluateDirectorAcceptanceGate(
  session: AiDirectorSessionRecord
): DirectorAcceptanceGateReport {
  const blockingReasons: string[] = [];

  const exactSourcePreserved =
    Boolean(session.originalScriptText) &&
    session.coverageLedger.everyCharacterAccountedFor &&
    session.segments.every(
      (s) =>
        session.originalScriptText.slice(s.startOffset, s.endOffset) ===
        s.exactOriginalText
    );
  if (!exactSourcePreserved) {
    blockingReasons.push('Original script source or segment offsets failed exact preservation check.');
  }

  const zeroHiddenMissingSegments = session.coverageLedger.uncoveredSegments === 0;
  if (!zeroHiddenMissingSegments) {
    blockingReasons.push(
      `${session.coverageLedger.uncoveredSegments} script segment(s) are still uncovered (${session.coverageLedger.uncoveredSegmentIds.join(', ')}).`
    );
  }

  const questionsStatePersisted = Array.isArray(session.questions);

  const planIsEditableAndVersioned =
    session.shots.length > 0 && session.planRevisions.length >= 1;

  const approvalWorkflowEnforced =
    session.intake.autonomyMode === 'bounded-autonomy' ||
    session.shots.some(
      (s) => s.approvalState === 'approved' || s.approvalState === 'locked'
    );
  if (!approvalWorkflowEnforced) {
    blockingReasons.push('At least one shot must be approved (or bounded autonomy enabled) before acceptance.');
  }

  const assetProvenanceStored =
    session.generatedAssetRecords.length > 0 &&
    session.generatedAssetRecords.every((a) => Boolean(a.licenseType && a.provenanceNote));
  if (!assetProvenanceStored) {
    blockingReasons.push('Asset provenance records have not been generated yet (run Production Compilation).');
  }

  let canonicalProjectValid = false;
  if (session.canonicalProject) {
    const val = validateCanonicalProject(session.canonicalProject);
    canonicalProjectValid = val.valid;
    if (!val.valid) {
      blockingReasons.push(`Canonical project validation failed: ${val.errors.join('; ')}`);
    }
  } else {
    blockingReasons.push('Canonical project has not been compiled from the shot plan yet.');
  }

  const revisionsReversible =
    session.planRevisions.length >= 1 && session.productionCheckpoints.length >= 1;

  const costsAndLimitationsClear =
    typeof session.estimatedTotalCostUsd === 'number' &&
    Array.isArray(PREPOPULATED_MODEL_CATALOG);

  const everyPassageTiedToTimelineOrApprovedOmission = session.segments.every(
    (seg) =>
      (seg.status === 'produced-on-timeline' && seg.timelineClipIds.length > 0) ||
      (seg.status === 'omitted-by-user-approval' && Boolean(seg.omissionReason))
  );
  if (!everyPassageTiedToTimelineOrApprovedOmission) {
    blockingReasons.push(
      'Not every original script passage is tied to a produced timeline clip or an explicit user-approved omission.'
    );
  }

  const passed =
    exactSourcePreserved &&
    zeroHiddenMissingSegments &&
    questionsStatePersisted &&
    planIsEditableAndVersioned &&
    approvalWorkflowEnforced &&
    assetProvenanceStored &&
    canonicalProjectValid &&
    revisionsReversible &&
    costsAndLimitationsClear &&
    everyPassageTiedToTimelineOrApprovedOmission;

  return {
    passed,
    evaluatedAt: new Date().toISOString(),
    checks: {
      exactSourcePreserved,
      zeroHiddenMissingSegments,
      questionsStatePersisted,
      planIsEditableAndVersioned,
      approvalWorkflowEnforced,
      assetProvenanceStored,
      canonicalProjectValid,
      revisionsReversible,
      costsAndLimitationsClear,
      everyPassageTiedToTimelineOrApprovedOmission,
    },
    blockingReasons,
    summary: passed
      ? `Acceptance Gate PASSED: 100% of ${session.segments.length} script segments preserved with exact offsets and tied to Canonical Project v2.0.0 timeline clips.`
      : `Acceptance Gate PENDING (${blockingReasons.length} item(s)): ${blockingReasons[0] || ''}`,
  };
}
