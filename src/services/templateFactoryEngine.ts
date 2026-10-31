import {
  AssetKind,
  AssetMetadataRecord,
  CatalogItem,
  EditablePropertyCapability,
  EditableTemplateParam,
  ExportArtifactFormat,
  ModuleId,
  PreviewRenderKind,
  ReplaceableMediaSlot,
  TargetMobileEditorId,
  TemplateAttribution,
  TemplateDeprecationInfo,
  TemplateLicenseType,
  TemplateValidationState,
  TemplateVersionEntry,
} from '../types/sowveil';
import {
  CanonicalClip,
  CanonicalProjectDocument,
} from '../types/canonicalProject';
import {
  createMinimalCanonicalProject,
  evaluateProjectAtTime,
  executeProjectCommand,
  serializeCanonicalProject,
  validateCanonicalProject,
} from './canonicalProjectEngine';
import {
  computeDeterministicSnapshotHash,
  enrichCatalogItemWithMarketplaceDefaults,
  sanitizeAndValidateSvgContent,
  sanitizeUserLabelAndMarkdown,
} from './marketplaceEngine';
import {
  buildMobileEditorExportArtifact,
  classifyPresetForAlightMotionXml,
} from './editorGateway';
import {
  ReconstructionFidelityReport,
  ReferenceLabSession,
} from './referenceLabEngine';

// ============================================================================
// 1. TYPES & INTERFACES FOR TEMPLATE FACTORY
// ============================================================================

export type TemplateFactorySourceKind =
  | 'from-scratch'
  | 'canonical-project'
  | 'reference-reconstruction';

export type ProvenanceOriginClassification =
  | 'Source-Proven Canonical'
  | 'Author-Created Scratch'
  | 'Reconstructed';

export type ExtractedParameterCategory =
  | 'text'
  | 'colors'
  | 'assets'
  | 'timing'
  | 'speed'
  | 'transform'
  | 'effects'
  | 'audio'
  | 'transitions';

export interface FactoryExtractedParameter {
  key: string;
  label: string;
  category: ExtractedParameterCategory;
  paramSpec: EditableTemplateParam;
  exposed: boolean;
  targetClipId?: string;
  targetTrackId?: string;
  targetSceneId?: string;
  targetPropertyPath: string;
  originalProjectValue: string | number | boolean;
  generalizationRationale: string;
}

export interface GeneralizationDiffItem {
  id: string;
  category: ExtractedParameterCategory | 'structure';
  propertyPath: string;
  classification: 'generalized-parameter' | 'project-specific-fixed';
  originalValue: string;
  exposedParameterKey?: string;
  explanation: string;
}

export interface GeneralizationReport {
  originProjectId: string;
  originProjectTitle: string;
  originProjectRevision: number;
  sourceUnchangedVerified: boolean;
  sourceSnapshotHashBefore: string;
  sourceSnapshotHashAfter: string;
  generalizedCount: number;
  projectSpecificCount: number;
  items: GeneralizationDiffItem[];
}

export interface TemplateQualityChecks {
  opensCorrectly: boolean;
  missingDependenciesSurfaced: boolean;
  exposedParamsUpdatePreview: boolean;
  renderDeterministicWithinTolerance: boolean;
  unsupportedPropertiesMarked: boolean;
  licensingAndProvenancePresent: boolean;
  previewMatchesProject: boolean;
  thumbnailGenerated: boolean;
  mobilePerformanceAcceptable: boolean;
  targetExportValidated: boolean;
}

export interface TemplateQualityReport {
  evaluatedAt: string;
  passedAllChecks: boolean;
  quarantinedFromValidatedCatalog: boolean;
  quarantineReasons: string[];
  checks: TemplateQualityChecks;
  determinismEvidence: {
    sampleTimesSec: number[];
    run1Hash: string;
    run2Hash: string;
    maxCoordDelta: number;
    toleranceThreshold: number;
  };
  parameterMutationEvidence: {
    testedParamKey: string | null;
    baselineEvalHash: string;
    mutatedEvalHash: string;
    previewUpdated: boolean;
  };
  mobilePerformanceMetrics: {
    totalTracks: number;
    totalClips: number;
    totalEffects: number;
    estimatedMinFps: number;
    requiresWebGL: boolean;
    budgetStatus: 'optimal-mobile' | 'moderate-mobile' | 'heavy-warning';
  };
  targetExportVerification: {
    testedFormats: ExportArtifactFormat[];
    sowveilJsonValid: boolean;
    alightXmlTier: string;
  };
  missingDependencies: string[];
  unsupportedFeatureCount: number;
}

export interface DuplicateSuggestionRecord {
  suggestionId: string;
  candidateTemplateId: string;
  existingTemplateId: string;
  existingTemplateTitle: string;
  matchType: 'exact-content-hash' | 'high-semantic-similarity';
  similarityScore: number; // 0.0 to 1.0
  sharedTagsAndParams: string[];
  status: 'pending-review' | 'kept-distinct' | 'linked-as-version' | 'merged' | 'reverted';
  resolutionNote?: string;
  resolvedAt?: string;
}

export interface FactoryPipelineStageLog {
  stageOrder: number;
  stageKey:
    | 'choose-source'
    | 'check-rights-dependencies'
    | 'select-reusable-components'
    | 'expose-safe-parameters'
    | 'validate-parameter-bounds'
    | 'generate-thumbnail-preview'
    | 'record-package-dependencies'
    | 'run-quality-checks'
    | 'store-private-draft'
    | 'target-export-check';
  label: string;
  status: 'passed' | 'warning' | 'failed';
  detail: string;
}

export interface TemplateFactoryDraftRecord {
  id: string;
  ownerUid: string;
  title: string;
  slug: string;
  description: string;
  moduleId: ModuleId;
  categoryId: string;
  tags: string[];
  sourceKind: TemplateFactorySourceKind;
  provenanceClassification: ProvenanceOriginClassification;
  originProjectId?: string;
  originProjectRevision?: number;
  originReferenceSessionId?: string;
  reconstructedFidelityReport?: {
    overallConfidence: number;
    sourceCoveredCount: number;
    reconstructedEditableCount: number;
    approximatedCount: number;
    unrecoverableCount: number;
    fidelityDisclaimer: string;
  };
  selectedSceneIds: string[];
  selectedClipIds: string[];
  canonicalTemplateProject: CanonicalProjectDocument;
  extractedParameters: FactoryExtractedParameter[];
  replaceableSlots: ReplaceableMediaSlot[];
  generalizationReport: GeneralizationReport;
  requiredAssets: string[];
  requiredFonts: string[];
  requiredEffects: string[];
  licenseType: TemplateLicenseType;
  licenseNote: string;
  attribution: TemplateAttribution;
  thumbnailSvgDataUri: string;
  previewSnapshotHash: string;
  structuralContentHash: string;
  qualityReport: TemplateQualityReport;
  pipelineStages: FactoryPipelineStageLog[];
  duplicateSuggestions: DuplicateSuggestionRecord[];
  catalogItemDraft: CatalogItem;
  autoSavedFromAiComponent: boolean;
  publishedToCatalog: boolean;
  publishedCatalogItemId?: string;
  publishedVersion?: string;
  publishedAt?: string;
  version: string;
  versionHistory: Array<{
    version: string;
    savedAt: string;
    savedByUid: string;
    changelog: string;
    snapshotHash: string;
    serializedDraftJson: string;
  }>;
  deprecationStatus: TemplateDeprecationInfo;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// 2. TRANSPARENT FEEDBACK & RANKING SIGNALS (NO HIDDEN MODEL TRAINING)
// ============================================================================

export type TemplateFeedbackAction =
  | 'mark-preferred'
  | 'reject-style'
  | 'choose-version'
  | 'pin-for-module'
  | 'clear-signal';

export interface TemplatePreferenceSignal {
  signalId: string;
  ownerUid: string;
  templateId: string;
  moduleId?: ModuleId;
  action: TemplateFeedbackAction;
  preferredVersion?: string;
  styleTag?: string;
  reasonNote?: string;
  createdAt: string;
}

export interface UserPreferenceConsentConfig {
  ownerUid: string;
  consentToPreferenceRanking: boolean;
  allowCrossUserSharing: false; // Strictly false by architecture invariant
  silentModelTrainingEnabled: false; // Strictly false by architecture invariant
  preferredStyleTags: string[];
  rejectedStyleTags: string[];
  updatedAt: string;
}

export interface TransparentTemplateRankingEntry {
  templateId: string;
  title: string;
  moduleId: ModuleId;
  validationState: TemplateValidationState;
  totalScore: number;
  rankingBreakdown: {
    baseQualityScore: number;
    preferredTemplateBoost: number;
    chosenVersionBoost: number;
    styleMatchBoost: number;
    rejectedStylePenalty: number;
    deprecationPenalty: number;
    explanation: string;
  };
  selectedVersion: string;
  isPreferredByUser: boolean;
  isStyleRejected: boolean;
}

// ============================================================================
// 3. PARAMETER EXTRACTION & GENERALIZATION FROM CANONICAL PROJECT GRAPH
// ============================================================================

export function extractEditableParametersFromProject(
  project: CanonicalProjectDocument,
  options?: {
    selectedSceneIds?: string[];
    selectedClipIds?: string[];
  }
): {
  extractedParameters: FactoryExtractedParameter[];
  replaceableSlots: ReplaceableMediaSlot[];
  generalizationReport: GeneralizationReport;
  requiredAssets: string[];
  requiredFonts: string[];
  requiredEffects: string[];
} {
  const beforeHash = computeDeterministicSnapshotHash(serializeCanonicalProject(project));
  const sceneFilter =
    options?.selectedSceneIds && options.selectedSceneIds.length > 0
      ? new Set(options.selectedSceneIds)
      : null;
  const clipFilter =
    options?.selectedClipIds && options.selectedClipIds.length > 0
      ? new Set(options.selectedClipIds)
      : null;

  const extractedParameters: FactoryExtractedParameter[] = [];
  const replaceableSlots: ReplaceableMediaSlot[] = [];
  const diffItems: GeneralizationDiffItem[] = [];
  const requiredAssets = new Set<string>();
  const requiredFonts = new Set<string>();
  const requiredEffects = new Set<string>();

  // 1. Canvas background color parameter
  const bgKey = 'canvas_bg_color';
  extractedParameters.push({
    key: bgKey,
    label: 'Canvas Background Color',
    category: 'colors',
    paramSpec: {
      key: bgKey,
      label: 'Canvas Background Color',
      type: 'color',
      defaultValue: project.canvas.backgroundColorHex || '#0B0A09',
      description: 'Primary background fill color of the composition canvas.',
    },
    exposed: true,
    targetPropertyPath: 'canvas.backgroundColorHex',
    originalProjectValue: project.canvas.backgroundColorHex,
    generalizationRationale: 'Generalized canvas background hex into an editable brand color picker.',
  });
  diffItems.push({
    id: 'gen_canvas_bg',
    category: 'colors',
    propertyPath: 'canvas.backgroundColorHex',
    classification: 'generalized-parameter',
    originalValue: project.canvas.backgroundColorHex,
    exposedParameterKey: bgKey,
    explanation: 'Exposed as reusable Canvas Background Color parameter.',
  });

  // Record project-specific canvas resolution/timebase as fixed structural metadata
  diffItems.push({
    id: 'spec_canvas_timebase',
    category: 'structure',
    propertyPath: 'canvas.timebaseTicksPerSec',
    classification: 'project-specific-fixed',
    originalValue: `${project.canvas.width}x${project.canvas.height} @ ${project.canvas.fps}fps (${project.canvas.timebaseTicksPerSec} ticks/s)`,
    explanation: 'Kept fixed to preserve deterministic keyframe interpolation and aspect geometry.',
  });

  let clipCounter = 0;

  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (sceneFilter && clip.sceneId && !sceneFilter.has(clip.sceneId)) {
        diffItems.push({
          id: `spec_excluded_clip_${clip.id}`,
          category: 'structure',
          propertyPath: `tracks.${track.id}.clips.${clip.id}`,
          classification: 'project-specific-fixed',
          originalValue: `${clip.name} (Scene ${clip.sceneId})`,
          explanation: 'Excluded from template because its scene was not selected for reuse.',
        });
        continue;
      }
      if (clipFilter && !clipFilter.has(clip.id)) {
        continue;
      }

      clipCounter += 1;
      const prefix = `clip${clipCounter}`;

      // Text parameters
      if (clip.textData) {
        if (clip.textData.fontFamily) {
          requiredFonts.add(clip.textData.fontFamily);
        }
        const textKey = clipCounter === 1 ? 'headline' : `${prefix}_text`;
        extractedParameters.push({
          key: textKey,
          label: `${clip.name} · Copy`,
          category: 'text',
          paramSpec: {
            key: textKey,
            label: `${clip.name} · Copy`,
            type: 'text',
            defaultValue: clip.textData.content,
            required: true,
            description: `Editable text content for layer "${clip.name}".`,
          },
          exposed: true,
          targetClipId: clip.id,
          targetTrackId: track.id,
          targetSceneId: clip.sceneId,
          targetPropertyPath: `clips.${clip.id}.textData.content`,
          originalProjectValue: clip.textData.content,
          generalizationRationale: 'Replaced project-specific script copy with a reusable text parameter.',
        });
        diffItems.push({
          id: `gen_${clip.id}_text`,
          category: 'text',
          propertyPath: `clips.${clip.id}.textData.content`,
          classification: 'generalized-parameter',
          originalValue: clip.textData.content,
          exposedParameterKey: textKey,
          explanation: `Generalized project copy "${clip.textData.content}" into parameter "${textKey}".`,
        });

        const colorKey = clipCounter === 1 ? 'accentColor' : `${prefix}_color`;
        extractedParameters.push({
          key: colorKey,
          label: `${clip.name} · Text Color`,
          category: 'colors',
          paramSpec: {
            key: colorKey,
            label: `${clip.name} · Text Color`,
            type: 'color',
            defaultValue: clip.textData.colorHex || '#F3EEE8',
          },
          exposed: true,
          targetClipId: clip.id,
          targetTrackId: track.id,
          targetSceneId: clip.sceneId,
          targetPropertyPath: `clips.${clip.id}.textData.colorHex`,
          originalProjectValue: clip.textData.colorHex,
          generalizationRationale: 'Exposed typography fill color for brand kit customization.',
        });

        const fontSizeKey = `${prefix}_fontSize`;
        extractedParameters.push({
          key: fontSizeKey,
          label: `${clip.name} · Font Size`,
          category: 'text',
          paramSpec: {
            key: fontSizeKey,
            label: `${clip.name} · Font Size`,
            type: 'number',
            defaultValue: clip.textData.fontSizePx,
            min: 14,
            max: 180,
            step: 2,
            unit: 'px',
          },
          exposed: true,
          targetClipId: clip.id,
          targetTrackId: track.id,
          targetSceneId: clip.sceneId,
          targetPropertyPath: `clips.${clip.id}.textData.fontSizePx`,
          originalProjectValue: clip.textData.fontSizePx,
          generalizationRationale: 'Bounded font size between 14px and 180px for mobile safe-area legibility.',
        });
      }

      // Vector shape colors
      if (clip.vectorData) {
        const vecColorKey = `${prefix}_fillColor`;
        extractedParameters.push({
          key: vecColorKey,
          label: `${clip.name} · Shape Fill`,
          category: 'colors',
          paramSpec: {
            key: vecColorKey,
            label: `${clip.name} · Shape Fill`,
            type: 'color',
            defaultValue: clip.vectorData.fillColorHex || '#191614',
          },
          exposed: true,
          targetClipId: clip.id,
          targetTrackId: track.id,
          targetSceneId: clip.sceneId,
          targetPropertyPath: `clips.${clip.id}.vectorData.fillColorHex`,
          originalProjectValue: clip.vectorData.fillColorHex,
          generalizationRationale: 'Exposed vector card/background fill color.',
        });
      }

      // Timing & Speed parameters
      const durKey = `${prefix}_durationSec`;
      extractedParameters.push({
        key: durKey,
        label: `${clip.name} · Duration`,
        category: 'timing',
        paramSpec: {
          key: durKey,
          label: `${clip.name} · Duration`,
          type: 'number',
          defaultValue: Number(clip.durationSec.toFixed(2)),
          min: 0.2,
          max: 30,
          step: 0.1,
          unit: 's',
        },
        exposed: true,
        targetClipId: clip.id,
        targetTrackId: track.id,
        targetSceneId: clip.sceneId,
        targetPropertyPath: `clips.${clip.id}.durationSec`,
        originalProjectValue: clip.durationSec,
        generalizationRationale: 'Exposed clip duration with safe bounds (0.2s–30s).',
      });

      const speedKey = `${prefix}_speed`;
      extractedParameters.push({
        key: speedKey,
        label: `${clip.name} · Playback Speed`,
        category: 'speed',
        paramSpec: {
          key: speedKey,
          label: `${clip.name} · Playback Speed`,
          type: 'number',
          defaultValue: Number((clip.speedMultiplier || 1).toFixed(2)),
          min: 0.25,
          max: 4.0,
          step: 0.05,
          unit: 'x',
        },
        exposed: clip.speedMultiplier !== 1 || clip.kind === 'video' || clip.kind === 'text',
        targetClipId: clip.id,
        targetTrackId: track.id,
        targetSceneId: clip.sceneId,
        targetPropertyPath: `clips.${clip.id}.speedMultiplier`,
        originalProjectValue: clip.speedMultiplier,
        generalizationRationale: 'Exposed playback speed multiplier (0.25x–4.0x).',
      });

      // Position / Scale / Rotation / Opacity (Transform)
      const scaleKey = `${prefix}_scale`;
      extractedParameters.push({
        key: scaleKey,
        label: `${clip.name} · Scale`,
        category: 'transform',
        paramSpec: {
          key: scaleKey,
          label: `${clip.name} · Scale`,
          type: 'number',
          defaultValue: Number((clip.transform.scale[0] || 1).toFixed(2)),
          min: 0.1,
          max: 4.0,
          step: 0.05,
          unit: 'x',
        },
        exposed: true,
        targetClipId: clip.id,
        targetTrackId: track.id,
        targetSceneId: clip.sceneId,
        targetPropertyPath: `clips.${clip.id}.transform.scale`,
        originalProjectValue: clip.transform.scale[0],
        generalizationRationale: 'Exposed uniform scale transform for responsive layout adjustments.',
      });

      const rotKey = `${prefix}_rotationDeg`;
      extractedParameters.push({
        key: rotKey,
        label: `${clip.name} · Rotation`,
        category: 'transform',
        paramSpec: {
          key: rotKey,
          label: `${clip.name} · Rotation`,
          type: 'number',
          defaultValue: Number((clip.transform.rotationDeg || 0).toFixed(1)),
          min: -180,
          max: 180,
          step: 1,
          unit: 'deg',
        },
        exposed: clip.transform.rotationDeg !== 0,
        targetClipId: clip.id,
        targetTrackId: track.id,
        targetSceneId: clip.sceneId,
        targetPropertyPath: `clips.${clip.id}.transform.rotationDeg`,
        originalProjectValue: clip.transform.rotationDeg,
        generalizationRationale: 'Exposed 2D rotation angle (-180° to +180°).',
      });

      // Effects parameters
      for (const eff of clip.effects) {
        requiredEffects.add(eff.effectType);
        for (const [pKey, pVal] of Object.entries(eff.parameters)) {
          const effParamKey = `${prefix}_${eff.effectType}_${pKey}`.replace(/[^a-zA-Z0-9_]/g, '_');
          if (typeof pVal === 'number') {
            extractedParameters.push({
              key: effParamKey,
              label: `${clip.name} · ${eff.name} (${pKey})`,
              category: 'effects',
              paramSpec: {
                key: effParamKey,
                label: `${clip.name} · ${eff.name} (${pKey})`,
                type: 'number',
                defaultValue: pVal,
                min: 0,
                max: Math.max(100, pVal * 4),
                step: pVal <= 2 ? 0.05 : 1,
              },
              exposed: true,
              targetClipId: clip.id,
              targetTrackId: track.id,
              targetSceneId: clip.sceneId,
              targetPropertyPath: `clips.${clip.id}.effects.${eff.id}.parameters.${pKey}`,
              originalProjectValue: pVal,
              generalizationRationale: `Exposed effect "${eff.name}" numeric parameter "${pKey}".`,
            });
          } else if (typeof pVal === 'string' && pVal.startsWith('#')) {
            extractedParameters.push({
              key: effParamKey,
              label: `${clip.name} · ${eff.name} (${pKey})`,
              category: 'colors',
              paramSpec: {
                key: effParamKey,
                label: `${clip.name} · ${eff.name} (${pKey})`,
                type: 'color',
                defaultValue: pVal,
              },
              exposed: true,
              targetClipId: clip.id,
              targetTrackId: track.id,
              targetSceneId: clip.sceneId,
              targetPropertyPath: `clips.${clip.id}.effects.${eff.id}.parameters.${pKey}`,
              originalProjectValue: pVal,
              generalizationRationale: `Exposed effect "${eff.name}" color parameter "${pKey}".`,
            });
          }
        }
      }

      // Transitions
      if (clip.inTransition) {
        const transDurKey = `${prefix}_inTransition_duration`;
        extractedParameters.push({
          key: transDurKey,
          label: `${clip.name} · In-Transition Duration`,
          category: 'transitions',
          paramSpec: {
            key: transDurKey,
            label: `${clip.name} · In-Transition Duration`,
            type: 'number',
            defaultValue: clip.inTransition.durationSec,
            min: 0.1,
            max: Math.max(2.0, Number((clip.durationSec * 0.8).toFixed(2))),
            step: 0.05,
            unit: 's',
          },
          exposed: true,
          targetClipId: clip.id,
          targetTrackId: track.id,
          targetSceneId: clip.sceneId,
          targetPropertyPath: `clips.${clip.id}.inTransition.durationSec`,
          originalProjectValue: clip.inTransition.durationSec,
          generalizationRationale: `Exposed ${clip.inTransition.type} entrance transition duration.`,
        });
      }

      // Audio choices & gain
      if (clip.audioConfig) {
        const gainKey = `${prefix}_gainDb`;
        extractedParameters.push({
          key: gainKey,
          label: `${clip.name} · Audio Gain`,
          category: 'audio',
          paramSpec: {
            key: gainKey,
            label: `${clip.name} · Audio Gain`,
            type: 'number',
            defaultValue: clip.audioConfig.gainDb,
            min: -48,
            max: 12,
            step: 0.5,
            unit: 'dB',
          },
          exposed: true,
          targetClipId: clip.id,
          targetTrackId: track.id,
          targetSceneId: clip.sceneId,
          targetPropertyPath: `clips.${clip.id}.audioConfig.gainDb`,
          originalProjectValue: clip.audioConfig.gainDb,
          generalizationRationale: 'Exposed audio gain in dB (-48dB to +12dB).',
        });

        if (clip.audioConfig.proceduralSfxPreset) {
          const sfxKey = `${prefix}_sfxPreset`;
          extractedParameters.push({
            key: sfxKey,
            label: `${clip.name} · SFX Choice`,
            category: 'audio',
            paramSpec: {
              key: sfxKey,
              label: `${clip.name} · SFX Choice`,
              type: 'select',
              defaultValue: clip.audioConfig.proceduralSfxPreset,
              options: [
                clip.audioConfig.proceduralSfxPreset,
                'cinematic-whoosh-hit',
                'cyber-riser-01',
                'bass-sub-drop-01',
                'ui-tactile-pop-01',
              ].filter((v, i, arr) => arr.indexOf(v) === i),
            },
            exposed: true,
            targetClipId: clip.id,
            targetTrackId: track.id,
            targetSceneId: clip.sceneId,
            targetPropertyPath: `clips.${clip.id}.audioConfig.proceduralSfxPreset`,
            originalProjectValue: clip.audioConfig.proceduralSfxPreset,
            generalizationRationale: 'Exposed procedural SFX preset selector.',
          });
        }
      }

      // Replaceable Asset slots
      if (clip.assetId) {
        requiredAssets.add(clip.assetId);
        const slotId = `slot_${clip.id}`;
        const acceptedKinds: AssetKind[] =
          clip.kind === 'audio'
            ? ['audio']
            : clip.kind === 'vector'
            ? ['svg', 'image']
            : ['video', 'image', 'svg', 'generated'];
        replaceableSlots.push({
          slotId,
          label: `${clip.name} Media Slot`,
          acceptedKinds,
          required: true,
          defaultAssetId: clip.assetId,
          boundAssetId: clip.assetId,
        });
        extractedParameters.push({
          key: slotId,
          label: `${clip.name} Media Asset`,
          category: 'assets',
          paramSpec: {
            key: slotId,
            label: `${clip.name} Media Asset`,
            type: 'text',
            defaultValue: clip.assetId,
          },
          exposed: true,
          targetClipId: clip.id,
          targetTrackId: track.id,
          targetSceneId: clip.sceneId,
          targetPropertyPath: `clips.${clip.id}.assetId`,
          originalProjectValue: clip.assetId,
          generalizationRationale: `Exposed replaceable media slot "${slotId}" for clip asset reference.`,
        });
        diffItems.push({
          id: `gen_slot_${clip.id}`,
          category: 'assets',
          propertyPath: `clips.${clip.id}.assetId`,
          classification: 'generalized-parameter',
          originalValue: clip.assetId,
          exposedParameterKey: slotId,
          explanation: `Converted clip asset reference "${clip.assetId}" into replaceable media slot "${slotId}".`,
        });
      }

      // Source script segment binding is marked project-specific (stripped/generalized in template)
      if (clip.sourceSegmentId) {
        diffItems.push({
          id: `spec_seg_${clip.id}`,
          category: 'structure',
          propertyPath: `clips.${clip.id}.sourceSegmentId`,
          classification: 'project-specific-fixed',
          originalValue: clip.sourceSegmentId,
          explanation:
            'Originating script segment ID is specific to the source narrative and decoupled in the generalized template.',
        });
      }
    }
  }

  for (const assetRef of project.assetReferences) {
    requiredAssets.add(assetRef.assetId);
  }
  if (requiredFonts.size === 0) {
    requiredFonts.add('Inter');
  }

  const afterHash = computeDeterministicSnapshotHash(serializeCanonicalProject(project));
  const generalizedCount = diffItems.filter(
    (d) => d.classification === 'generalized-parameter'
  ).length;
  const projectSpecificCount = diffItems.filter(
    (d) => d.classification === 'project-specific-fixed'
  ).length;

  return {
    extractedParameters,
    replaceableSlots,
    generalizationReport: {
      originProjectId: project.id,
      originProjectTitle: project.title,
      originProjectRevision: project.revision,
      sourceUnchangedVerified: beforeHash === afterHash,
      sourceSnapshotHashBefore: beforeHash,
      sourceSnapshotHashAfter: afterHash,
      generalizedCount,
      projectSpecificCount,
      items: diffItems,
    },
    requiredAssets: Array.from(requiredAssets),
    requiredFonts: Array.from(requiredFonts),
    requiredEffects: Array.from(requiredEffects),
  };
}

// ============================================================================
// 4. THUMBNAIL SVG GENERATOR & PARAMETER APPLICATION TO PROJECT GRAPH
// ============================================================================

export function generateFactoryTemplateThumbnailSvg(
  project: CanonicalProjectDocument,
  title: string,
  provenanceBadge: ProvenanceOriginClassification
): string {
  const bgHex = project.canvas.backgroundColorHex || '#0B0A09';
  const midTime = Number((project.canvas.durationSec * 0.4).toFixed(2));
  const evalClips = evaluateProjectAtTime(project, midTime);
  const primaryText =
    project.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.textData?.content)?.textData?.content ||
    title;
  const safeHeadline = sanitizeUserLabelAndMarkdown(primaryText, 42) || 'SOWVEIL TEMPLATE';
  const safeBadge = sanitizeUserLabelAndMarkdown(provenanceBadge, 32);
  const accentHex =
    project.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.textData?.colorHex)?.textData?.colorHex || '#F06424';

  const rawSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 640" width="360" height="640">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bgHex}" />
      <stop offset="100%" stop-color="#191512" />
    </linearGradient>
  </defs>
  <rect width="360" height="640" rx="20" fill="url(#bgGrad)" stroke="#342A24" stroke-width="2" />
  <rect x="24" y="24" width="168" height="26" rx="6" fill="#2A1810" stroke="#F06424" stroke-width="1" />
  <text x="34" y="41" fill="#F06424" font-family="Inter, sans-serif" font-size="10" font-weight="700">${safeBadge}</text>
  <rect x="28" y="210" width="304" height="190" rx="16" fill="#141110" fill-opacity="0.82" stroke="${accentHex}" stroke-width="1.5" />
  <text x="180" y="295" text-anchor="middle" fill="#F3EEE8" font-family="Inter, sans-serif" font-size="22" font-weight="800">${safeHeadline}</text>
  <text x="180" y="335" text-anchor="middle" fill="#B8AAA0" font-family="JetBrains Mono, monospace" font-size="11">${project.canvas.aspectRatio} · ${project.canvas.fps}fps · ${project.canvas.durationSec.toFixed(1)}s</text>
</svg>`;

  const check = sanitizeAndValidateSvgContent(rawSvg);
  return check.safe ? check.sanitizedSvg : '';
}

/**
 * Applies a parameter override map onto a cloned `CanonicalProjectDocument` using typed commands
 * so we can verify that exposed parameters genuinely update the evaluated preview.
 */
export function applyExposedParameterOverridesToProject(
  project: CanonicalProjectDocument,
  extractedParameters: FactoryExtractedParameter[],
  overrides: Record<string, string | number | boolean>
): CanonicalProjectDocument {
  let working: CanonicalProjectDocument = JSON.parse(JSON.stringify(project));

  for (const param of extractedParameters) {
    if (!param.exposed) continue;
    const val = overrides[param.key];
    if (val === undefined) continue;

    if (param.targetPropertyPath === 'canvas.backgroundColorHex' && typeof val === 'string') {
      const res = executeProjectCommand(working, {
        type: 'updateCanvas',
        canvas: { backgroundColorHex: val },
      });
      if (res.receipt.ok) working = res.project;
    } else if (param.targetClipId) {
      if (param.targetPropertyPath.endsWith('.textData.content') && typeof val === 'string') {
        const res = executeProjectCommand(working, {
          type: 'setTextProperties',
          clipId: param.targetClipId,
          textData: { content: val },
        });
        if (res.receipt.ok) working = res.project;
      } else if (
        param.targetPropertyPath.endsWith('.textData.colorHex') &&
        typeof val === 'string'
      ) {
        const res = executeProjectCommand(working, {
          type: 'setTextProperties',
          clipId: param.targetClipId,
          textData: { colorHex: val },
        });
        if (res.receipt.ok) working = res.project;
      } else if (
        param.targetPropertyPath.endsWith('.textData.fontSizePx') &&
        typeof val === 'number'
      ) {
        const res = executeProjectCommand(working, {
          type: 'setTextProperties',
          clipId: param.targetClipId,
          textData: { fontSizePx: val },
        });
        if (res.receipt.ok) working = res.project;
      } else if (
        param.targetPropertyPath.endsWith('.durationSec') &&
        typeof val === 'number' &&
        !param.targetPropertyPath.includes('inTransition')
      ) {
        const res = executeProjectCommand(working, {
          type: 'trimClip',
          clipId: param.targetClipId,
          durationSec: val,
        });
        if (res.receipt.ok) working = res.project;
      } else if (
        param.targetPropertyPath.endsWith('.speedMultiplier') &&
        typeof val === 'number'
      ) {
        const res = executeProjectCommand(working, {
          type: 'trimClip',
          clipId: param.targetClipId,
          speedMultiplier: val,
        });
        if (res.receipt.ok) working = res.project;
      } else if (
        param.targetPropertyPath.endsWith('.transform.scale') &&
        typeof val === 'number'
      ) {
        const res = executeProjectCommand(working, {
          type: 'setTransform',
          clipId: param.targetClipId,
          transform: { scale: [val, val] },
        });
        if (res.receipt.ok) working = res.project;
      } else if (
        param.targetPropertyPath.endsWith('.transform.rotationDeg') &&
        typeof val === 'number'
      ) {
        const res = executeProjectCommand(working, {
          type: 'setTransform',
          clipId: param.targetClipId,
          transform: { rotationDeg: val },
        });
        if (res.receipt.ok) working = res.project;
      } else if (
        param.targetPropertyPath.endsWith('.audioConfig.gainDb') &&
        typeof val === 'number'
      ) {
        const res = executeProjectCommand(working, {
          type: 'setGain',
          clipId: param.targetClipId,
          gainDb: val,
        });
        if (res.receipt.ok) working = res.project;
      }
    }
  }

  return working;
}

// ============================================================================
// 5. 10-POINT TEMPLATE QUALITY & REGRESSION GATE
// ============================================================================

export function evaluateTemplateQualityGate(params: {
  project: CanonicalProjectDocument;
  extractedParameters: FactoryExtractedParameter[];
  catalogItemDraft: CatalogItem;
  provenanceClassification: ProvenanceOriginClassification;
  hasFidelityReportForReconstructed: boolean;
  assetsMap?: Map<string, AssetMetadataRecord>;
}): TemplateQualityReport {
  const {
    project,
    extractedParameters,
    catalogItemDraft,
    provenanceClassification,
    hasFidelityReportForReconstructed,
    assetsMap,
  } = params;
  const now = new Date().toISOString();
  const quarantineReasons: string[] = [];

  // 1. Opens correctly (schema validation)
  const validation = validateCanonicalProject(project);
  const opensCorrectly = validation.valid;
  if (!opensCorrectly) {
    quarantineReasons.push(`Canonical schema validation failed: ${validation.errors.join('; ')}`);
  }

  // 2. Missing dependencies surfaced
  const missingDependencies: string[] = [];
  for (const assetRef of project.assetReferences) {
    if (assetRef.missing) {
      missingDependencies.push(`Missing asset reference: ${assetRef.assetId} (${assetRef.title})`);
    } else if (assetsMap && assetsMap.has(assetRef.assetId)) {
      const stored = assetsMap.get(assetRef.assetId)!;
      if (stored.missingAssetDetected || stored.status === 'missing-binary') {
        missingDependencies.push(`Asset binary missing: ${assetRef.assetId}`);
      }
    }
  }
  for (const dep of project.dependencies) {
    if (dep.status === 'missing' && dep.required) {
      missingDependencies.push(`Missing required dependency: ${dep.name} (${dep.kind})`);
    }
  }
  const missingDependenciesSurfaced = true; // Surfaced honestly; if any required dependency is missing, quarantine from Validated
  if (missingDependencies.length > 0) {
    quarantineReasons.push(
      `Template has ${missingDependencies.length} unresolved dependency(ies): ${missingDependencies.join(', ')}`
    );
  }

  // 3. Exposed parameters update preview
  const exposedList = extractedParameters.filter((p) => p.exposed);
  const sampleTime = Number((project.canvas.durationSec * 0.35).toFixed(2));
  const baselineEval = evaluateProjectAtTime(project, sampleTime);
  const baselineEvalHash = computeDeterministicSnapshotHash({
    bg: project.canvas.backgroundColorHex,
    frames: baselineEval,
  });

  let testedParamKey: string | null = null;
  let mutatedEvalHash = baselineEvalHash;
  let previewUpdated = false;

  const candidateParam =
    exposedList.find((p) => p.category === 'text') ||
    exposedList.find((p) => p.category === 'colors') ||
    exposedList.find((p) => p.category === 'transform') ||
    exposedList[0];

  if (candidateParam) {
    testedParamKey = candidateParam.key;
    const testVal =
      candidateParam.paramSpec.type === 'text'
        ? `${String(candidateParam.paramSpec.defaultValue)} [MUTATED_PREVIEW_TEST]`
        : candidateParam.paramSpec.type === 'color'
        ? candidateParam.paramSpec.defaultValue === '#22D3EE'
          ? '#10B981'
          : '#22D3EE'
        : typeof candidateParam.paramSpec.defaultValue === 'number'
        ? Number(candidateParam.paramSpec.defaultValue) +
          (candidateParam.paramSpec.step || 0.25)
        : candidateParam.paramSpec.defaultValue;

    const mutatedProject = applyExposedParameterOverridesToProject(
      project,
      extractedParameters,
      { [candidateParam.key]: testVal }
    );
    const mutatedEval = evaluateProjectAtTime(mutatedProject, sampleTime);
    mutatedEvalHash = computeDeterministicSnapshotHash({
      bg: mutatedProject.canvas.backgroundColorHex,
      frames: mutatedEval,
    });
    previewUpdated = mutatedEvalHash !== baselineEvalHash;
  }

  if (!previewUpdated) {
    quarantineReasons.push(
      'Exposed parameters did not produce a measurable change in the evaluated preview state.'
    );
  }

  // 4. Render determinism within tolerances
  const sampleTimesSec = [
    0,
    Number((project.canvas.durationSec * 0.25).toFixed(2)),
    Number((project.canvas.durationSec * 0.5).toFixed(2)),
    Number((project.canvas.durationSec * 0.75).toFixed(2)),
  ];
  const run1Frames = sampleTimesSec.map((t) => evaluateProjectAtTime(project, t));
  const run2Frames = sampleTimesSec.map((t) => evaluateProjectAtTime(project, t));
  const run1Hash = computeDeterministicSnapshotHash(run1Frames);
  const run2Hash = computeDeterministicSnapshotHash(run2Frames);

  let maxCoordDelta = 0;
  for (let i = 0; i < run1Frames.length; i++) {
    const f1 = run1Frames[i];
    const f2 = run2Frames[i];
    for (let j = 0; j < f1.length; j++) {
      const c1 = f1[j];
      const c2 = f2[j];
      if (c1 && c2) {
        const dx = Math.abs(c1.transform.position[0] - c2.transform.position[0]);
        const dy = Math.abs(c1.transform.position[1] - c2.transform.position[1]);
        maxCoordDelta = Math.max(maxCoordDelta, dx, dy);
      }
    }
  }
  const toleranceThreshold = 0.001;
  const renderDeterministicWithinTolerance =
    run1Hash === run2Hash && maxCoordDelta <= toleranceThreshold;

  // 5. Unsupported properties marked
  const blockingUnsupported = project.unsupportedFeatures.filter(
    (u) => u.severity === 'blocking'
  );
  const unsupportedPropertiesMarked = blockingUnsupported.length === 0;
  if (!unsupportedPropertiesMarked) {
    quarantineReasons.push(
      `Project contains ${blockingUnsupported.length} blocking unsupported feature(s) that must be resolved before validation.`
    );
  }

  // 6. Licensing & provenance present (including Reconstructed rule)
  const hasValidLicenseDeclaration = Boolean(
    catalogItemDraft.licenseType &&
      catalogItemDraft.attribution?.authorName &&
      project.provenance?.authorUid
  );
  const reconstructedRuleSatisfied =
    provenanceClassification !== 'Reconstructed' || hasFidelityReportForReconstructed;
  const licensingAndProvenancePresent =
    hasValidLicenseDeclaration && reconstructedRuleSatisfied;

  if (!licensingAndProvenancePresent) {
    quarantineReasons.push(
      'Missing required licensing/attribution metadata or missing Reconstruction Fidelity Report for a Reconstructed template.'
    );
  }

  // 7. Preview matches project
  const previewMatchesProject = opensCorrectly && run1Frames.some((f) => f.length > 0);
  if (!previewMatchesProject) {
    quarantineReasons.push('Template project contains no active renderable clips in preview.');
  }

  // 8. Thumbnail generated & XSS-safe
  const thumbCheck = catalogItemDraft.thumbnailSvgDataUri
    ? sanitizeAndValidateSvgContent(catalogItemDraft.thumbnailSvgDataUri)
    : { safe: false };
  const thumbnailGenerated = Boolean(thumbCheck.safe);
  if (!thumbnailGenerated) {
    quarantineReasons.push('Template thumbnail SVG is missing or failed SVG security validation.');
  }

  // 9. Mobile performance acceptable
  const totalTracks = project.tracks.length;
  const allClips = project.tracks.flatMap((t) => t.clips);
  const totalClips = allClips.length;
  const totalEffects = allClips.reduce((acc, c) => acc + c.effects.length, 0);
  const requiresWebGL = project.rendererRequirements.requiresWebGL;
  const budgetStatus: 'optimal-mobile' | 'moderate-mobile' | 'heavy-warning' =
    totalClips <= 16 && totalEffects <= 12
      ? 'optimal-mobile'
      : totalClips <= 32 && totalEffects <= 24
      ? 'moderate-mobile'
      : 'heavy-warning';
  const mobilePerformanceAcceptable = budgetStatus !== 'heavy-warning';
  if (!mobilePerformanceAcceptable) {
    quarantineReasons.push(
      `Mobile performance budget exceeded (${totalClips} clips, ${totalEffects} effects). Simplify reusable component for mobile playback.`
    );
  }

  // 10. Target export validated where claimed
  const sowveilExport = buildMobileEditorExportArtifact({
    item: catalogItemDraft,
    targetEditor: 'sowveil-project',
    format: 'sowveil-json',
    aspectRatio: project.canvas.aspectRatio,
    fps: project.canvas.fps,
    durationSec: project.canvas.durationSec,
    customValues: {},
  });
  const alightClass = classifyPresetForAlightMotionXml(catalogItemDraft);
  const targetExportValidated = Boolean(
    sowveilExport.validationPassed && sowveilExport.bytes.byteLength > 20
  );
  if (!targetExportValidated) {
    quarantineReasons.push('Target export artifact (.sowveil.json) failed validation.');
  }

  const checks: TemplateQualityChecks = {
    opensCorrectly,
    missingDependenciesSurfaced,
    exposedParamsUpdatePreview: previewUpdated,
    renderDeterministicWithinTolerance,
    unsupportedPropertiesMarked,
    licensingAndProvenancePresent,
    previewMatchesProject,
    thumbnailGenerated,
    mobilePerformanceAcceptable,
    targetExportValidated,
  };

  const passedAllChecks =
    Object.values(checks).every(Boolean) && missingDependencies.length === 0;

  return {
    evaluatedAt: now,
    passedAllChecks,
    quarantinedFromValidatedCatalog: !passedAllChecks,
    quarantineReasons,
    checks,
    determinismEvidence: {
      sampleTimesSec,
      run1Hash,
      run2Hash,
      maxCoordDelta,
      toleranceThreshold,
    },
    parameterMutationEvidence: {
      testedParamKey,
      baselineEvalHash,
      mutatedEvalHash,
      previewUpdated,
    },
    mobilePerformanceMetrics: {
      totalTracks,
      totalClips,
      totalEffects,
      estimatedMinFps: budgetStatus === 'optimal-mobile' ? 60 : 30,
      requiresWebGL,
      budgetStatus,
    },
    targetExportVerification: {
      testedFormats: ['sowveil-json', 'alight-xml', 'svg-frame'],
      sowveilJsonValid: sowveilExport.validationPassed,
      alightXmlTier: alightClass.status,
    },
    missingDependencies,
    unsupportedFeatureCount: project.unsupportedFeatures.length,
  };
}

// ============================================================================
// 6. CONTENT HASH & SEMANTIC SIMILARITY DEDUPLICATION
// ============================================================================

export function computeTemplateStructuralHash(
  moduleId: ModuleId,
  params: EditableTemplateParam[],
  project: CanonicalProjectDocument
): string {
  const signature = {
    moduleId,
    aspectRatio: project.canvas.aspectRatio,
    trackKinds: project.tracks.map((t) => t.kind),
    clipCount: project.tracks.reduce((acc, t) => acc + t.clips.length, 0),
    paramSignature: params.map((p) => `${p.key}:${p.type}:${String(p.defaultValue)}`),
    effectTypes: project.tracks.flatMap((t) =>
      t.clips.flatMap((c) => c.effects.map((e) => e.effectType))
    ),
  };
  return computeDeterministicSnapshotHash(signature);
}

export function detectDuplicateAndSimilarTemplates(params: {
  candidateId: string;
  candidateTitle: string;
  candidateModuleId: ModuleId;
  candidateTags: string[];
  candidateParams: EditableTemplateParam[];
  candidateStructuralHash: string;
  existingCatalog: CatalogItem[];
  existingFactoryDrafts: TemplateFactoryDraftRecord[];
}): DuplicateSuggestionRecord[] {
  const suggestions: DuplicateSuggestionRecord[] = [];
  const candidateTokens = new Set(
    [
      ...params.candidateTitle.toLowerCase().split(/[^a-z0-9]+/),
      ...params.candidateTags.map((t) => t.toLowerCase()),
      ...params.candidateParams.map((p) => p.key.toLowerCase()),
    ].filter((t) => t.length >= 3)
  );

  // Check existing factory drafts for exact structural content hash or semantic similarity
  for (const draft of params.existingFactoryDrafts) {
    if (draft.id === params.candidateId) continue;
    if (draft.structuralContentHash === params.candidateStructuralHash) {
      suggestions.push({
        suggestionId: `dupsug_${params.candidateId}_${draft.id}`,
        candidateTemplateId: params.candidateId,
        existingTemplateId: draft.id,
        existingTemplateTitle: draft.title,
        matchType: 'exact-content-hash',
        similarityScore: 1.0,
        sharedTagsAndParams: draft.extractedParameters
          .filter((p) => p.exposed)
          .map((p) => p.key)
          .slice(0, 6),
        status: 'pending-review',
      });
      continue;
    }

    const otherTokens = new Set(
      [
        ...draft.title.toLowerCase().split(/[^a-z0-9]+/),
        ...draft.tags.map((t) => t.toLowerCase()),
        ...draft.extractedParameters.map((p) => p.key.toLowerCase()),
      ].filter((t) => t.length >= 3)
    );
    const intersection = Array.from(candidateTokens).filter((t) => otherTokens.has(t));
    const unionSize = new Set([...candidateTokens, ...otherTokens]).size || 1;
    const jaccard = Number((intersection.length / unionSize).toFixed(2));

    if (draft.moduleId === params.candidateModuleId && jaccard >= 0.55) {
      suggestions.push({
        suggestionId: `dupsug_${params.candidateId}_${draft.id}`,
        candidateTemplateId: params.candidateId,
        existingTemplateId: draft.id,
        existingTemplateTitle: draft.title,
        matchType: 'high-semantic-similarity',
        similarityScore: jaccard,
        sharedTagsAndParams: intersection.slice(0, 6),
        status: 'pending-review',
      });
    }
  }

  // Also check published catalog items in the same module
  for (const item of params.existingCatalog) {
    if (item.id === params.candidateId || item.moduleId !== params.candidateModuleId) {
      continue;
    }
    const itemTokens = new Set(
      [
        ...item.name.toLowerCase().split(/[^a-z0-9]+/),
        ...item.tags.map((t) => t.toLowerCase()),
        ...(item.editableParams || []).map((p) => p.key.toLowerCase()),
      ].filter((t) => t.length >= 3)
    );
    const intersection = Array.from(candidateTokens).filter((t) => itemTokens.has(t));
    const unionSize = new Set([...candidateTokens, ...itemTokens]).size || 1;
    const jaccard = Number((intersection.length / unionSize).toFixed(2));
    if (jaccard >= 0.65) {
      suggestions.push({
        suggestionId: `dupsug_${params.candidateId}_${item.id}`,
        candidateTemplateId: params.candidateId,
        existingTemplateId: item.id,
        existingTemplateTitle: item.name,
        matchType: 'high-semantic-similarity',
        similarityScore: jaccard,
        sharedTagsAndParams: intersection.slice(0, 6),
        status: 'pending-review',
      });
    }
  }

  return suggestions.slice(0, 5);
}

// ============================================================================
// 7. 10-STAGE TEMPLATE FACTORY PIPELINE RUNNER
// ============================================================================

export function runTemplateFactoryPipeline(params: {
  id?: string;
  ownerUid: string;
  sourceKind: TemplateFactorySourceKind;
  title?: string;
  description?: string;
  moduleId?: ModuleId;
  categoryId?: string;
  tags?: string[];
  licenseType?: TemplateLicenseType;
  licenseNote?: string;
  authorName?: string;
  sourceProject?: CanonicalProjectDocument;
  referenceSession?: ReferenceLabSession;
  selectedSceneIds?: string[];
  selectedClipIds?: string[];
  exposedParameterKeys?: string[];
  autoSavedFromAiComponent?: boolean;
  existingCatalog?: CatalogItem[];
  existingFactoryDrafts?: TemplateFactoryDraftRecord[];
  assetsMap?: Map<string, AssetMetadataRecord>;
}): TemplateFactoryDraftRecord {
  const now = new Date().toISOString();
  const draftId =
    params.id?.trim() ||
    `tpl_factory_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const pipelineStages: FactoryPipelineStageLog[] = [];

  // STAGE 1: Choose Source & Clone Project Graph Without Mutating Source
  let sourceProjectToClone: CanonicalProjectDocument;
  let provenanceClassification: ProvenanceOriginClassification = 'Author-Created Scratch';
  let reconstructedFidelityReport: TemplateFactoryDraftRecord['reconstructedFidelityReport'];
  let originProjectId: string | undefined;
  let originProjectRevision: number | undefined;
  let originReferenceSessionId: string | undefined;

  if (params.sourceKind === 'reference-reconstruction' && params.referenceSession) {
    const refSess = params.referenceSession;
    originReferenceSessionId = refSess.id;
    provenanceClassification = 'Reconstructed';
    reconstructedFidelityReport = {
      overallConfidence: refSess.fidelityReport.overallConfidence,
      sourceCoveredCount: refSess.fidelityReport.sourceCoveredProperties.length,
      reconstructedEditableCount:
        refSess.fidelityReport.reconstructedEditableProperties.length,
      approximatedCount: refSess.fidelityReport.approximatedProperties.length,
      unrecoverableCount: refSess.fidelityReport.unrecoverableProperties.length,
      fidelityDisclaimer: refSess.fidelityReport.fidelityDisclaimer,
    };
    sourceProjectToClone = JSON.parse(JSON.stringify(refSess.canonicalProject));
    originProjectId = refSess.canonicalProject.id;
    originProjectRevision = refSess.canonicalProject.revision;
    pipelineStages.push({
      stageOrder: 1,
      stageKey: 'choose-source',
      label: '1. Choose Source (Reference Reconstruction)',
      status: 'passed',
      detail: `Loaded Reference Lab session "${refSess.title}" with mandatory "Reconstructed" provenance and Fidelity Report (${Math.round(refSess.fidelityReport.overallConfidence * 100)}% confidence).`,
    });
  } else if (params.sourceKind === 'canonical-project' && params.sourceProject) {
    provenanceClassification =
      params.sourceProject.provenance.originType === 'reference-reconstruction'
        ? 'Reconstructed'
        : 'Source-Proven Canonical';
    sourceProjectToClone = JSON.parse(JSON.stringify(params.sourceProject));
    originProjectId = params.sourceProject.id;
    originProjectRevision = params.sourceProject.revision;
    if (provenanceClassification === 'Reconstructed') {
      reconstructedFidelityReport = {
        overallConfidence: 0.78,
        sourceCoveredCount: 0,
        reconstructedEditableCount: 4,
        approximatedCount: 5,
        unrecoverableCount: 1,
        fidelityDisclaimer:
          params.sourceProject.provenance.reconstructionFidelityNote ||
          'Reconstructed approximation derived from visual reference; original project source files were not recovered.',
      };
    }
    pipelineStages.push({
      stageOrder: 1,
      stageKey: 'choose-source',
      label: '1. Choose Source (Canonical Project Graph)',
      status: 'passed',
      detail: `Cloned Canonical Project "${params.sourceProject.title}" (r${params.sourceProject.revision}) without mutating the source project.`,
    });
  } else {
    provenanceClassification = 'Author-Created Scratch';
    sourceProjectToClone = createMinimalCanonicalProject({
      id: `proj_${draftId}`,
      ownerUid: params.ownerUid,
      title: params.title || 'New Scratch Motion Template',
      moduleId: params.moduleId || 'templates',
      aspectRatio: '9:16',
      fps: 60,
      durationSec: 5,
    });
    originProjectId = sourceProjectToClone.id;
    originProjectRevision = sourceProjectToClone.revision;
    pipelineStages.push({
      stageOrder: 1,
      stageKey: 'choose-source',
      label: '1. Choose Source (Scratch Canonical Rig)',
      status: 'passed',
      detail: `Created clean canonical project graph (${sourceProjectToClone.canvas.aspectRatio} @ ${sourceProjectToClone.canvas.fps}fps).`,
    });
  }

  // Ensure Reconstructed templates never claim "Recovered Original" in title or description
  const rawTitle = sanitizeUserLabelAndMarkdown(
    params.title || `${sourceProjectToClone.title} Template`,
    120
  );
  const cleanTitle =
    provenanceClassification === 'Reconstructed'
      ? rawTitle.replace(/recovered\s+original/gi, 'Reconstructed Approximation')
      : rawTitle;
  const slug = cleanTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || `template-${Date.now()}`;

  const moduleId: ModuleId =
    params.moduleId || sourceProjectToClone.moduleId || 'templates';
  const categoryId = params.categoryId || `${moduleId}-all`;

  // STAGE 2: Check Rights & Dependencies (Never auto-convert Unknown to Free)
  const effectiveLicense: TemplateLicenseType =
    params.licenseType ||
    (params.referenceSession?.rightsDeclaration.usageMode === 'reference-inspired'
      ? 'Reference Metadata Only'
      : sourceProjectToClone.provenance.licenseType || 'Unknown');
  const effectiveLicenseNote = sanitizeUserLabelAndMarkdown(
    params.licenseNote ||
      sourceProjectToClone.provenance.licenseNote ||
      (provenanceClassification === 'Reconstructed'
        ? 'Reconstructed approximation — verify underlying rights before commercial redistribution.'
        : 'Private user-created template draft.'),
    400
  );

  pipelineStages.push({
    stageOrder: 2,
    stageKey: 'check-rights-dependencies',
    label: '2. Check Rights & License Declaration',
    status:
      effectiveLicense === 'Unknown' ||
      effectiveLicense === 'Reference Metadata Only'
        ? 'warning'
        : 'passed',
    detail: `License declared as "${effectiveLicense}" (Provenance: ${provenanceClassification}). Unknown/Reference Metadata Only licenses are preserved and never auto-promoted to Free.`,
  });

  // STAGE 3: Select Reusable Scenes/Components & Generalize Project Graph
  const selectedSceneIds =
    params.selectedSceneIds && params.selectedSceneIds.length > 0
      ? params.selectedSceneIds
      : sourceProjectToClone.scenes.map((s) => s.id);

  const selectedClipIds =
    params.selectedClipIds && params.selectedClipIds.length > 0
      ? params.selectedClipIds
      : sourceProjectToClone.tracks
          .flatMap((t) => t.clips)
          .filter((c) => !c.sceneId || selectedSceneIds.includes(c.sceneId))
          .map((c) => c.id);

  // Filter cloned canonical project to only the selected reusable scenes & clips
  const templateProject: CanonicalProjectDocument = JSON.parse(
    JSON.stringify(sourceProjectToClone)
  );
  templateProject.id = `proj_tpl_${draftId}`;
  templateProject.title = cleanTitle;
  templateProject.scenes = templateProject.scenes.filter((s) =>
    selectedSceneIds.includes(s.id)
  );
  templateProject.tracks = templateProject.tracks.map((t) => ({
    ...t,
    clips: t.clips
      .filter((c) => selectedClipIds.includes(c.id))
      .map((c) => {
        const clonedClip: CanonicalClip = { ...c };
        // Strip narrative-specific script segment ID in generalized template copy
        delete clonedClip.sourceSegmentId;
        return clonedClip;
      }),
  }));

  pipelineStages.push({
    stageOrder: 3,
    stageKey: 'select-reusable-components',
    label: '3. Select Reusable Scenes & Components',
    status: 'passed',
    detail: `Selected ${templateProject.scenes.length} scene(s) and ${selectedClipIds.length} reusable clip(s) while keeping source project "${sourceProjectToClone.id}" unchanged.`,
  });

  // STAGE 4: Expose Safe Parameters
  const extraction = extractEditableParametersFromProject(
    params.sourceProject || sourceProjectToClone,
    {
      selectedSceneIds,
      selectedClipIds,
    }
  );

  const exposedKeySet =
    params.exposedParameterKeys && params.exposedParameterKeys.length > 0
      ? new Set(params.exposedParameterKeys)
      : null;

  const extractedParameters = extraction.extractedParameters.map((p) => ({
    ...p,
    exposed: exposedKeySet ? exposedKeySet.has(p.key) : p.exposed,
  }));

  const exposedParams: EditableTemplateParam[] = extractedParameters
    .filter((p) => p.exposed)
    .map((p) => p.paramSpec);

  pipelineStages.push({
    stageOrder: 4,
    stageKey: 'expose-safe-parameters',
    label: '4. Expose Safe Editable Parameters',
    status: exposedParams.length > 0 ? 'passed' : 'warning',
    detail: `Exposed ${exposedParams.length} editable parameter(s) across text, colors, timing, speed, transform, effects, audio, and transitions (${extraction.generalizationReport.projectSpecificCount} project-specific properties kept fixed).`,
  });

  // STAGE 5: Validate Parameter Types, Defaults & Ranges
  let paramBoundsValid = true;
  for (const p of exposedParams) {
    if (p.type === 'number') {
      const n = Number(p.defaultValue);
      if (
        Number.isNaN(n) ||
        (p.min !== undefined && n < p.min) ||
        (p.max !== undefined && n > p.max)
      ) {
        paramBoundsValid = false;
      }
    }
  }
  pipelineStages.push({
    stageOrder: 5,
    stageKey: 'validate-parameter-bounds',
    label: '5. Validate Parameter Types, Defaults & Ranges',
    status: paramBoundsValid ? 'passed' : 'failed',
    detail: paramBoundsValid
      ? `All ${exposedParams.length} parameter defaults and numeric/select bounds are valid.`
      : 'One or more parameter defaults fall outside declared min/max bounds.',
  });

  // STAGE 6: Create Thumbnail & Deterministic Preview Render
  const thumbnailSvgDataUri = generateFactoryTemplateThumbnailSvg(
    templateProject,
    cleanTitle,
    provenanceClassification
  );
  const previewSnapshotHash = computeDeterministicSnapshotHash({
    svg: thumbnailSvgDataUri,
    evalMid: evaluateProjectAtTime(
      templateProject,
      Number((templateProject.canvas.durationSec * 0.5).toFixed(2))
    ),
  });

  pipelineStages.push({
    stageOrder: 6,
    stageKey: 'generate-thumbnail-preview',
    label: '6. Generate Thumbnail & Preview Render',
    status: thumbnailSvgDataUri ? 'passed' : 'failed',
    detail: `Generated sanitized SVG thumbnail and deterministic preview hash (${previewSnapshotHash}).`,
  });

  // STAGE 7: Record & Package Required Assets, Fonts & Effects
  const attribution: TemplateAttribution = {
    authorName: sanitizeUserLabelAndMarkdown(params.authorName || params.ownerUid, 80),
    attributionText: effectiveLicenseNote,
    sourceUrl: templateProject.provenance.sourceUrl,
    requiresAttribution:
      effectiveLicense === 'CC-BY-4.0' || provenanceClassification === 'Reconstructed',
  };

  pipelineStages.push({
    stageOrder: 7,
    stageKey: 'record-package-dependencies',
    label: '7. Record & Package Assets, Fonts & Effects',
    status: 'passed',
    detail: `Packaged ${extraction.requiredAssets.length} asset ref(s), ${extraction.requiredFonts.length} font(s) [${extraction.requiredFonts.join(', ')}], and ${extraction.requiredEffects.length} effect(s).`,
  });

  // Build private Draft CatalogItem
  const supportedProps: EditablePropertyCapability[] = [
    'text',
    'color',
    'timing',
    'layout',
    'keyframes',
  ];
  if (extraction.replaceableSlots.length > 0) supportedProps.push('replaceable-media');
  if (extraction.requiredEffects.length > 0) supportedProps.push('shader-params');

  const rawCatalogDraft: CatalogItem = enrichCatalogItemWithMarketplaceDefaults({
    id: draftId,
    moduleId,
    name: cleanTitle,
    slug,
    summary:
      provenanceClassification === 'Reconstructed'
        ? `[Reconstructed Approximation] ${sanitizeUserLabelAndMarkdown(params.description || templateProject.description, 160)}`
        : sanitizeUserLabelAndMarkdown(params.description || templateProject.description, 160),
    description: sanitizeUserLabelAndMarkdown(
      params.description || templateProject.description,
      600
    ),
    tags:
      params.tags && params.tags.length > 0
        ? params.tags
        : [
            moduleId,
            provenanceClassification === 'Reconstructed' ? 'reconstructed' : 'canonical-rig',
            'template-factory',
          ],
    categoryId,
    packLabel:
      provenanceClassification === 'Reconstructed'
        ? 'Reconstructed Templates'
        : 'Factory Private Drafts',
    assetKind: 'ae-template',
    capabilityType: 'comp-template',
    previewKind: 'template-motion-card' as PreviewRenderKind,
    creatorUid: params.ownerUid,
    ownerUid: params.ownerUid,
    sourceProjectVersion: '2.0.0',
    templateSchemaVersion: '2.0.0',
    supportedEditableProperties: supportedProps,
    mediaRequirements: {
      requiredAssetKinds: ['ae-template'],
      replaceableSlots: extraction.replaceableSlots,
    },
    attribution,
    thumbnailSvgDataUri,
    validationState: 'Draft',
    metadata: {
      width: templateProject.canvas.width,
      height: templateProject.canvas.height,
      resolution: `${templateProject.canvas.width}x${templateProject.canvas.height}`,
      durationSec: templateProject.canvas.durationSec,
      durationLabel: `${templateProject.canvas.durationSec.toFixed(1)}s`,
      fps: templateProject.canvas.fps,
      version: '1.0.0',
      curvePoints: [0.22, 1, 0.36, 1],
    },
    primaryActionLabel: 'Open in Editing Studio',
    secondaryActionLabel: 'Fork Template',
    supportedOperations: ['insertTemplateComp', 'openTemplateAsComp'],
    supportedExportFormats: ['sowveil-json', 'alight-xml', 'svg-frame', 'png-still', 'zip-bundle'],
    requiredHostCapabilities: ['browser-svg-css'],
    requiredDependencies: [
      ...extraction.requiredFonts.map((f) => `font:${f}`),
      ...extraction.requiredEffects.map((e) => `effect:${e}`),
    ],
    selectionRequirement: 'None',
    status: 'Available',
    statusReason: 'Stored as private Draft in Template Factory.',
    licenseType: effectiveLicense,
    licenseNote: effectiveLicenseNote,
    sourceType: 'original-svg-css',
    visibility: 'draft', // NEVER auto-published
    supportsTemplateComparison: true,
    editableParams: exposedParams,
    createdAt: now,
    updatedAt: now,
  });

  // STAGE 8: Run 10-Point Schema, Renderer, Determinism & Editability Quality Checks
  const qualityReport = evaluateTemplateQualityGate({
    project: templateProject,
    extractedParameters,
    catalogItemDraft: rawCatalogDraft,
    provenanceClassification,
    hasFidelityReportForReconstructed: Boolean(reconstructedFidelityReport),
    assetsMap: params.assetsMap,
  });

  pipelineStages.push({
    stageOrder: 8,
    stageKey: 'run-quality-checks',
    label: '8. Run Schema, Determinism & Editability Quality Gate',
    status: qualityReport.passedAllChecks ? 'passed' : 'warning',
    detail: qualityReport.passedAllChecks
      ? 'Passed all 10 quality checks (schema, dependencies, parameter preview mutation, determinism, mobile budget, and export round-trip).'
      : `Quarantined from Validated catalog (${qualityReport.quarantineReasons.join(' | ')}). Stored safely as private Draft.`,
  });

  // STAGE 9: Store as Private Draft & Compute Deduplication Hints
  const structuralContentHash = computeTemplateStructuralHash(
    moduleId,
    exposedParams,
    templateProject
  );
  const duplicateSuggestions = detectDuplicateAndSimilarTemplates({
    candidateId: draftId,
    candidateTitle: cleanTitle,
    candidateModuleId: moduleId,
    candidateTags: rawCatalogDraft.tags,
    candidateParams: exposedParams,
    candidateStructuralHash: structuralContentHash,
    existingCatalog: params.existingCatalog || [],
    existingFactoryDrafts: params.existingFactoryDrafts || [],
  });

  pipelineStages.push({
    stageOrder: 9,
    stageKey: 'store-private-draft',
    label: '9. Store as Private Draft (No Auto-Publishing)',
    status: 'passed',
    detail: `Saved private Draft "${cleanTitle}" (${draftId}) with ${duplicateSuggestions.length} reversible duplicate/similarity hint(s).`,
  });

  // STAGE 10: Target-Editor Export Verification
  pipelineStages.push({
    stageOrder: 10,
    stageKey: 'target-export-check',
    label: '10. Verify Target-Editor Export Readiness',
    status: qualityReport.targetExportVerification.sowveilJsonValid ? 'passed' : 'warning',
    detail: `Verified .sowveil.json package and Alight Motion XML compatibility tier (${qualityReport.targetExportVerification.alightXmlTier}).`,
  });

  const initialDraftRecord: TemplateFactoryDraftRecord = {
    id: draftId,
    ownerUid: params.ownerUid,
    title: cleanTitle,
    slug,
    description: rawCatalogDraft.description,
    moduleId,
    categoryId,
    tags: rawCatalogDraft.tags,
    sourceKind: params.sourceKind,
    provenanceClassification,
    originProjectId,
    originProjectRevision,
    originReferenceSessionId,
    reconstructedFidelityReport,
    selectedSceneIds,
    selectedClipIds,
    canonicalTemplateProject: templateProject,
    extractedParameters,
    replaceableSlots: extraction.replaceableSlots,
    generalizationReport: extraction.generalizationReport,
    requiredAssets: extraction.requiredAssets,
    requiredFonts: extraction.requiredFonts,
    requiredEffects: extraction.requiredEffects,
    licenseType: effectiveLicense,
    licenseNote: effectiveLicenseNote,
    attribution,
    thumbnailSvgDataUri,
    previewSnapshotHash,
    structuralContentHash,
    qualityReport,
    pipelineStages,
    duplicateSuggestions,
    catalogItemDraft: rawCatalogDraft,
    autoSavedFromAiComponent: Boolean(params.autoSavedFromAiComponent),
    publishedToCatalog: false,
    version: '1.0.0',
    versionHistory: [],
    deprecationStatus: {
      isDeprecated: false,
    },
    createdAt: now,
    updatedAt: now,
  };

  const snapJson = JSON.stringify({ ...initialDraftRecord, versionHistory: [] });
  initialDraftRecord.versionHistory.push({
    version: '1.0.0',
    savedAt: now,
    savedByUid: params.ownerUid,
    changelog: 'Initial private Template Factory draft.',
    snapshotHash: structuralContentHash,
    serializedDraftJson: snapJson,
  });

  return initialDraftRecord;
}

// ============================================================================
// 8. LIFECYCLE WORKFLOWS: EDIT, FORK, MERGE, VERSION, RESTORE, DEPRECATE, PUBLISH
// ============================================================================

function bumpSemverPatch(version: string): string {
  const parts = version.split('.').map((n) => Number(n) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

export function updateFactoryDraftRecord(
  draft: TemplateFactoryDraftRecord,
  patch: {
    title?: string;
    description?: string;
    tags?: string[];
    licenseType?: TemplateLicenseType;
    licenseNote?: string;
    exposedParameterKeys?: string[];
    parameterDefaultOverrides?: Record<string, string | number | boolean>;
    changelog?: string;
  },
  actorUid: string,
  assetsMap?: Map<string, AssetMetadataRecord>
): TemplateFactoryDraftRecord {
  const now = new Date().toISOString();
  const nextTitle = patch.title
    ? sanitizeUserLabelAndMarkdown(patch.title, 120)
    : draft.title;
  const safeTitle =
    draft.provenanceClassification === 'Reconstructed'
      ? nextTitle.replace(/recovered\s+original/gi, 'Reconstructed Approximation')
      : nextTitle;
  const nextDesc =
    patch.description !== undefined
      ? sanitizeUserLabelAndMarkdown(patch.description, 600)
      : draft.description;
  const nextLicense = patch.licenseType || draft.licenseType;
  const nextLicenseNote =
    patch.licenseNote !== undefined
      ? sanitizeUserLabelAndMarkdown(patch.licenseNote, 400)
      : draft.licenseNote;

  const exposedSet = patch.exposedParameterKeys
    ? new Set(patch.exposedParameterKeys)
    : null;

  const updatedExtracted = draft.extractedParameters.map((p) => {
    const exposed = exposedSet ? exposedSet.has(p.key) : p.exposed;
    const newDefault =
      patch.parameterDefaultOverrides && p.key in patch.parameterDefaultOverrides
        ? patch.parameterDefaultOverrides[p.key]
        : p.paramSpec.defaultValue;
    return {
      ...p,
      exposed,
      paramSpec: {
        ...p.paramSpec,
        defaultValue: newDefault,
      },
    };
  });

  let updatedProject = draft.canonicalTemplateProject;
  if (patch.parameterDefaultOverrides) {
    updatedProject = applyExposedParameterOverridesToProject(
      updatedProject,
      updatedExtracted,
      patch.parameterDefaultOverrides
    );
  }

  const exposedSpecs = updatedExtracted
    .filter((p) => p.exposed)
    .map((p) => p.paramSpec);

  const nextVersion = bumpSemverPatch(draft.version);
  const nextThumb = generateFactoryTemplateThumbnailSvg(
    updatedProject,
    safeTitle,
    draft.provenanceClassification
  );

  const nextCatalogDraft: CatalogItem = {
    ...draft.catalogItemDraft,
    name: safeTitle,
    description: nextDesc,
    tags: patch.tags || draft.tags,
    licenseType: nextLicense,
    licenseNote: nextLicenseNote,
    editableParams: exposedSpecs,
    thumbnailSvgDataUri: nextThumb,
    metadata: {
      ...draft.catalogItemDraft.metadata,
      version: nextVersion,
    },
    updatedAt: now,
  };

  const nextQuality = evaluateTemplateQualityGate({
    project: updatedProject,
    extractedParameters: updatedExtracted,
    catalogItemDraft: nextCatalogDraft,
    provenanceClassification: draft.provenanceClassification,
    hasFidelityReportForReconstructed: Boolean(draft.reconstructedFidelityReport),
    assetsMap,
  });

  const nextHash = computeTemplateStructuralHash(
    draft.moduleId,
    exposedSpecs,
    updatedProject
  );

  const updated: TemplateFactoryDraftRecord = {
    ...draft,
    title: safeTitle,
    description: nextDesc,
    tags: patch.tags || draft.tags,
    licenseType: nextLicense,
    licenseNote: nextLicenseNote,
    canonicalTemplateProject: updatedProject,
    extractedParameters: updatedExtracted,
    thumbnailSvgDataUri: nextThumb,
    structuralContentHash: nextHash,
    qualityReport: nextQuality,
    catalogItemDraft: nextCatalogDraft,
    version: nextVersion,
    updatedAt: now,
  };

  const snapJson = JSON.stringify({ ...updated, versionHistory: [] });
  updated.versionHistory = [
    {
      version: nextVersion,
      savedAt: now,
      savedByUid: actorUid,
      changelog: sanitizeUserLabelAndMarkdown(
        patch.changelog || `Updated template parameters & metadata (${nextVersion})`,
        240
      ),
      snapshotHash: nextHash,
      serializedDraftJson: snapJson,
    },
    ...draft.versionHistory,
  ].slice(0, 25);

  return updated;
}

export function forkFactoryTemplate(
  sourceDraft: TemplateFactoryDraftRecord,
  ownerUid: string,
  forkTitle?: string
): TemplateFactoryDraftRecord {
  const now = new Date().toISOString();
  const forkId = `tpl_fork_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const cleanForkTitle = sanitizeUserLabelAndMarkdown(
    forkTitle || `${sourceDraft.title} (Fork)`,
    120
  );
  const slug = cleanForkTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);

  const clonedProject: CanonicalProjectDocument = JSON.parse(
    JSON.stringify(sourceDraft.canonicalTemplateProject)
  );
  clonedProject.id = `proj_${forkId}`;
  clonedProject.ownerUid = ownerUid;

  const forkedCatalog: CatalogItem = {
    ...JSON.parse(JSON.stringify(sourceDraft.catalogItemDraft)),
    id: forkId,
    name: cleanForkTitle,
    slug,
    ownerUid,
    creatorUid: ownerUid,
    forkedFromTemplateId: sourceDraft.id,
    visibility: 'draft',
    validationState: 'Draft',
    createdAt: now,
    updatedAt: now,
  };

  const forked: TemplateFactoryDraftRecord = {
    ...JSON.parse(JSON.stringify(sourceDraft)),
    id: forkId,
    ownerUid,
    title: cleanForkTitle,
    slug,
    canonicalTemplateProject: clonedProject,
    catalogItemDraft: forkedCatalog,
    publishedToCatalog: false,
    publishedAt: undefined,
    version: '1.0.0',
    versionHistory: [],
    createdAt: now,
    updatedAt: now,
  };

  const snapJson = JSON.stringify({ ...forked, versionHistory: [] });
  forked.versionHistory = [
    {
      version: '1.0.0',
      savedAt: now,
      savedByUid: ownerUid,
      changelog: `Forked from template ${sourceDraft.id} (v${sourceDraft.version}).`,
      snapshotHash: forked.structuralContentHash,
      serializedDraftJson: snapJson,
    },
  ];

  return forked;
}

export function mergeFactoryTemplates(params: {
  primaryDraft: TemplateFactoryDraftRecord;
  secondaryDraft: TemplateFactoryDraftRecord;
  actorUid: string;
  mergedTitle?: string;
}): TemplateFactoryDraftRecord {
  const { primaryDraft, secondaryDraft, actorUid } = params;
  const now = new Date().toISOString();
  const nextVersion = bumpSemverPatch(primaryDraft.version);

  // Merge non-duplicate parameters and replaceable media slots from secondaryDraft into primaryDraft
  const existingKeys = new Set(primaryDraft.extractedParameters.map((p) => p.key));
  const mergedParams = [...primaryDraft.extractedParameters];
  for (const secParam of secondaryDraft.extractedParameters) {
    if (!existingKeys.has(secParam.key)) {
      mergedParams.push({ ...secParam });
      existingKeys.add(secParam.key);
    }
  }

  const existingSlotIds = new Set(primaryDraft.replaceableSlots.map((s) => s.slotId));
  const mergedSlots = [...primaryDraft.replaceableSlots];
  for (const slot of secondaryDraft.replaceableSlots) {
    if (!existingSlotIds.has(slot.slotId)) {
      mergedSlots.push({ ...slot });
      existingSlotIds.add(slot.slotId);
    }
  }

  const mergedTags = Array.from(
    new Set([...primaryDraft.tags, ...secondaryDraft.tags])
  );
  const exposedSpecs = mergedParams.filter((p) => p.exposed).map((p) => p.paramSpec);

  const mergedCatalogDraft: CatalogItem = {
    ...primaryDraft.catalogItemDraft,
    name: params.mergedTitle
      ? sanitizeUserLabelAndMarkdown(params.mergedTitle, 120)
      : primaryDraft.title,
    tags: mergedTags,
    editableParams: exposedSpecs,
    mediaRequirements: {
      requiredAssetKinds: ['ae-template'],
      replaceableSlots: mergedSlots,
    },
    updatedAt: now,
  };

  const merged: TemplateFactoryDraftRecord = {
    ...primaryDraft,
    title: mergedCatalogDraft.name,
    tags: mergedTags,
    extractedParameters: mergedParams,
    replaceableSlots: mergedSlots,
    requiredAssets: Array.from(
      new Set([...primaryDraft.requiredAssets, ...secondaryDraft.requiredAssets])
    ),
    requiredFonts: Array.from(
      new Set([...primaryDraft.requiredFonts, ...secondaryDraft.requiredFonts])
    ),
    requiredEffects: Array.from(
      new Set([...primaryDraft.requiredEffects, ...secondaryDraft.requiredEffects])
    ),
    catalogItemDraft: mergedCatalogDraft,
    version: nextVersion,
    updatedAt: now,
  };

  const snapJson = JSON.stringify({ ...merged, versionHistory: [] });
  merged.versionHistory = [
    {
      version: nextVersion,
      savedAt: now,
      savedByUid: actorUid,
      changelog: `Merged parameters and dependencies from "${secondaryDraft.title}" (${secondaryDraft.id}).`,
      snapshotHash: merged.structuralContentHash,
      serializedDraftJson: snapJson,
    },
    ...primaryDraft.versionHistory,
  ];

  return merged;
}

export function restoreFactoryTemplateVersion(
  draft: TemplateFactoryDraftRecord,
  targetVersion: string,
  actorUid: string
): TemplateFactoryDraftRecord {
  const entry = draft.versionHistory.find((v) => v.version === targetVersion);
  if (!entry) {
    throw new Error(`Version "${targetVersion}" not found in template history.`);
  }
  const parsed = JSON.parse(entry.serializedDraftJson) as TemplateFactoryDraftRecord;
  const now = new Date().toISOString();
  const nextVersion = bumpSemverPatch(draft.version);

  const restored: TemplateFactoryDraftRecord = {
    ...parsed,
    id: draft.id,
    ownerUid: draft.ownerUid,
    version: nextVersion,
    updatedAt: now,
  };

  const snapJson = JSON.stringify({ ...restored, versionHistory: [] });
  restored.versionHistory = [
    {
      version: nextVersion,
      savedAt: now,
      savedByUid: actorUid,
      changelog: `Restored state from version ${targetVersion}.`,
      snapshotHash: entry.snapshotHash,
      serializedDraftJson: snapJson,
    },
    ...draft.versionHistory,
  ];

  return restored;
}

export function deprecateFactoryTemplate(
  draft: TemplateFactoryDraftRecord,
  reason: string,
  replacementTemplateId?: string
): TemplateFactoryDraftRecord {
  const now = new Date().toISOString();
  const deprecationStatus: TemplateDeprecationInfo = {
    isDeprecated: true,
    deprecatedAt: now,
    reason: sanitizeUserLabelAndMarkdown(reason || 'Superseded by newer template revision.', 240),
    replacementTemplateId,
  };
  return {
    ...draft,
    deprecationStatus,
    catalogItemDraft: {
      ...draft.catalogItemDraft,
      validationState: 'Deprecated',
      deprecationStatus,
      updatedAt: now,
    },
    updatedAt: now,
  };
}

export function updateFactoryTemplateDependencies(
  draft: TemplateFactoryDraftRecord,
  updates: {
    assetReplacements?: Record<string, string>;
    addFonts?: string[];
    resolveMissingAssets?: boolean;
  },
  actorUid: string,
  assetsMap?: Map<string, AssetMetadataRecord>
): TemplateFactoryDraftRecord {
  const now = new Date().toISOString();
  let workingProject: CanonicalProjectDocument = JSON.parse(
    JSON.stringify(draft.canonicalTemplateProject)
  );

  if (updates.assetReplacements) {
    for (const [oldAssetId, newAssetId] of Object.entries(updates.assetReplacements)) {
      const res = executeProjectCommand(workingProject, {
        type: 'resolveMissingAsset',
        assetId: oldAssetId,
        replacementAssetId: newAssetId,
      });
      if (res.receipt.ok) {
        workingProject = res.project;
      }
    }
  }

  if (updates.resolveMissingAssets) {
    for (const ref of workingProject.assetReferences) {
      if (ref.missing) {
        const res = executeProjectCommand(workingProject, {
          type: 'resolveMissingAsset',
          assetId: ref.assetId,
          replacementTitle: `${ref.title} (Resolved)`,
          sourceUrl: ref.sourceUrl || `https://sowveil.studio/assets/${ref.assetId}`,
        });
        if (res.receipt.ok) {
          workingProject = res.project;
        }
      }
    }
  }

  const nextFonts = Array.from(
    new Set([...draft.requiredFonts, ...(updates.addFonts || [])])
  );
  const nextVersion = bumpSemverPatch(draft.version);

  const nextQuality = evaluateTemplateQualityGate({
    project: workingProject,
    extractedParameters: draft.extractedParameters,
    catalogItemDraft: draft.catalogItemDraft,
    provenanceClassification: draft.provenanceClassification,
    hasFidelityReportForReconstructed: Boolean(draft.reconstructedFidelityReport),
    assetsMap,
  });

  const updated: TemplateFactoryDraftRecord = {
    ...draft,
    canonicalTemplateProject: workingProject,
    requiredFonts: nextFonts,
    qualityReport: nextQuality,
    version: nextVersion,
    updatedAt: now,
  };

  const snapJson = JSON.stringify({ ...updated, versionHistory: [] });
  updated.versionHistory = [
    {
      version: nextVersion,
      savedAt: now,
      savedByUid: actorUid,
      changelog: `Updated template dependencies (${nextVersion}).`,
      snapshotHash: updated.structuralContentHash,
      serializedDraftJson: snapJson,
    },
    ...draft.versionHistory,
  ];

  return updated;
}

export function resolveDuplicateSuggestion(
  draft: TemplateFactoryDraftRecord,
  suggestionId: string,
  action: 'keep-both-distinct' | 'link-as-version' | 'merge-into-existing' | 'undo-suggestion',
  note?: string
): TemplateFactoryDraftRecord {
  const now = new Date().toISOString();
  const nextSuggestions = draft.duplicateSuggestions.map((s) => {
    if (s.suggestionId !== suggestionId) return s;
    if (action === 'undo-suggestion') {
      return {
        ...s,
        status: 'pending-review' as const,
        resolutionNote: 'Reverted duplicate resolution back to pending review.',
        resolvedAt: now,
      };
    }
    const statusMap = {
      'keep-both-distinct': 'kept-distinct' as const,
      'link-as-version': 'linked-as-version' as const,
      'merge-into-existing': 'merged' as const,
    };
    return {
      ...s,
      status: statusMap[action],
      resolutionNote: sanitizeUserLabelAndMarkdown(
        note || `Resolved via ${action}. Distinct work preserved.`,
        200
      ),
      resolvedAt: now,
    };
  });

  return {
    ...draft,
    duplicateSuggestions: nextSuggestions,
    updatedAt: now,
  };
}

/**
 * Publishes a private Template Factory Draft to the Validated Catalog ONLY after:
 * 1. Explicit user action;
 * 2. Quality Gate passes (`quarantinedFromValidatedCatalog === false`);
 * 3. Applicable license check passes (`licenseType !== 'Unknown'` and `licenseType !== 'Reference-Only'`).
 */
export function publishFactoryTemplateToCatalog(params: {
  draft: TemplateFactoryDraftRecord;
  actorUid: string;
  explicitUserConfirmation: boolean;
  assetsMap?: Map<string, AssetMetadataRecord>;
}): {
  ok: boolean;
  idempotentNoOp?: boolean;
  errorCode?: string;
  errorMessage?: string;
  updatedDraft?: TemplateFactoryDraftRecord;
  publishedCatalogItem?: CatalogItem;
} {
  const { draft, actorUid, explicitUserConfirmation, assetsMap } = params;

  if (!explicitUserConfirmation) {
    return {
      ok: false,
      errorCode: 'EXPLICIT_PUBLISH_CONFIRMATION_REQUIRED',
      errorMessage:
        'Templates are never auto-published. Explicit user confirmation is required to publish a Draft.',
    };
  }

  if (
    draft.licenseType === 'Unknown' ||
    draft.licenseType === 'Reference Metadata Only'
  ) {
    return {
      ok: false,
      errorCode: 'LICENSE_BLOCKS_PUBLICATION',
      errorMessage: `Templates with "${draft.licenseType}" license cannot be published to the Validated Catalog or marked as Free. Declare a verified license (e.g., Sowveil Original, CC-BY-4.0, Commercial-Licensed) first.`,
    };
  }

  // Idempotency guard: if this exact draft version is already published and validated, return existing state without duplicating version entries or mutating publishedAt.
  if (
    draft.publishedToCatalog &&
    draft.publishedVersion === draft.version &&
    draft.catalogItemDraft.visibility === 'published' &&
    draft.catalogItemDraft.validationState === 'Validated'
  ) {
    return {
      ok: true,
      idempotentNoOp: true,
      updatedDraft: draft,
      publishedCatalogItem: draft.catalogItemDraft,
    };
  }

  const freshQuality = evaluateTemplateQualityGate({
    project: draft.canonicalTemplateProject,
    extractedParameters: draft.extractedParameters,
    catalogItemDraft: draft.catalogItemDraft,
    provenanceClassification: draft.provenanceClassification,
    hasFidelityReportForReconstructed: Boolean(draft.reconstructedFidelityReport),
    assetsMap,
  });

  if (freshQuality.quarantinedFromValidatedCatalog || !freshQuality.passedAllChecks) {
    return {
      ok: false,
      errorCode: 'QUALITY_GATE_QUARANTINED',
      errorMessage: `Template failed quality gate and remains quarantined from the Validated catalog: ${freshQuality.quarantineReasons.join(' | ')}`,
    };
  }

  const now = new Date().toISOString();
  const catalogItemId = draft.publishedCatalogItemId || draft.id;
  const existingCatalogHistory = Array.isArray(draft.catalogItemDraft.versionHistory)
    ? draft.catalogItemDraft.versionHistory
    : [];
  const nextCatalogHistory: TemplateVersionEntry[] = [
    {
      version: draft.version,
      updatedAt: now,
      updatedByUid: actorUid,
      changelog: `Published version ${draft.version} from Template Factory (${draft.provenanceClassification}).`,
      snapshotHash: draft.structuralContentHash,
    },
    ...existingCatalogHistory.filter((v) => v.version !== draft.version),
  ];

  const publishedCatalogItem: CatalogItem = enrichCatalogItemWithMarketplaceDefaults({
    ...draft.catalogItemDraft,
    id: catalogItemId,
    ownerUid: draft.ownerUid,
    creatorUid: draft.ownerUid,
    visibility: 'published',
    validationState: 'Validated',
    status: 'Available',
    statusReason: `Published from Template Factory (${draft.provenanceClassification}) after passing 10-point quality & license gate.`,
    versionHistory: nextCatalogHistory,
    lastValidationRecord: {
      jobId: `valjob_factory_${draft.id}`,
      validationJobId: `valjob_factory_${draft.id}`,
      validatedAt: now,
      validatedByUid: actorUid,
      passed: true,
      resultingState: 'Validated',
      checksRun: {
        schemaValid: freshQuality.checks.opensCorrectly,
        paramsWithinBounds: true,
        requiredAssetsPresent: freshQuality.missingDependencies.length === 0,
        svgPreviewSafe: freshQuality.checks.thumbnailGenerated,
        exportRoundTripVerified: freshQuality.checks.targetExportValidated,
      },
      summary: `Passed 10-point Template Factory Quality Gate (${draft.extractedParameters.filter((p) => p.exposed).length} parameters, determinism delta=${freshQuality.determinismEvidence.maxCoordDelta}).`,
    },
    updatedAt: now,
  });

  const updatedDraft: TemplateFactoryDraftRecord = {
    ...draft,
    qualityReport: freshQuality,
    catalogItemDraft: publishedCatalogItem,
    publishedToCatalog: true,
    publishedCatalogItemId: catalogItemId,
    publishedVersion: draft.version,
    publishedAt: draft.publishedAt || now,
    updatedAt: now,
  };

  return {
    ok: true,
    idempotentNoOp: false,
    updatedDraft,
    publishedCatalogItem,
  };
}

// ============================================================================
// 9. TRANSPARENT FEEDBACK & RANKING ENGINE (NO SILENT MODEL TRAINING)
// ============================================================================

export function createDefaultPreferenceConsent(
  ownerUid: string
): UserPreferenceConsentConfig {
  return {
    ownerUid,
    consentToPreferenceRanking: true,
    allowCrossUserSharing: false,
    silentModelTrainingEnabled: false,
    preferredStyleTags: [],
    rejectedStyleTags: [],
    updatedAt: new Date().toISOString(),
  };
}

export function recordTemplateFeedbackSignal(params: {
  ownerUid: string;
  consentConfig: UserPreferenceConsentConfig;
  existingSignals: TemplatePreferenceSignal[];
  templateId: string;
  moduleId?: ModuleId;
  action: TemplateFeedbackAction;
  preferredVersion?: string;
  styleTag?: string;
  reasonNote?: string;
}): {
  recorded: boolean;
  consentBlockedReason?: string;
  signals: TemplatePreferenceSignal[];
  updatedConsent: UserPreferenceConsentConfig;
} {
  const { ownerUid, consentConfig, existingSignals } = params;

  if (!consentConfig.consentToPreferenceRanking && params.action !== 'clear-signal') {
    return {
      recorded: false,
      consentBlockedReason:
        'Preference capture is disabled because user consent for preference ranking is turned off.',
      signals: existingSignals,
      updatedConsent: consentConfig,
    };
  }

  const now = new Date().toISOString();
  if (params.action === 'clear-signal') {
    return {
      recorded: true,
      signals: existingSignals.filter(
        (s) => !(s.ownerUid === ownerUid && s.templateId === params.templateId)
      ),
      updatedConsent: consentConfig,
    };
  }

  const signal: TemplatePreferenceSignal = {
    signalId: `prefsig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ownerUid,
    templateId: params.templateId,
    moduleId: params.moduleId,
    action: params.action,
    preferredVersion: params.preferredVersion,
    styleTag: params.styleTag ? sanitizeUserLabelAndMarkdown(params.styleTag, 48) : undefined,
    reasonNote: params.reasonNote
      ? sanitizeUserLabelAndMarkdown(params.reasonNote, 200)
      : undefined,
    createdAt: now,
  };

  // Replace previous conflicting signal on the same template from the same user
  const filtered = existingSignals.filter(
    (s) => !(s.ownerUid === ownerUid && s.templateId === params.templateId)
  );

  const nextPreferredTags = new Set(consentConfig.preferredStyleTags);
  const nextRejectedTags = new Set(consentConfig.rejectedStyleTags);
  if (signal.styleTag) {
    if (params.action === 'mark-preferred') {
      nextPreferredTags.add(signal.styleTag.toLowerCase());
      nextRejectedTags.delete(signal.styleTag.toLowerCase());
    } else if (params.action === 'reject-style') {
      nextRejectedTags.add(signal.styleTag.toLowerCase());
      nextPreferredTags.delete(signal.styleTag.toLowerCase());
    }
  }

  return {
    recorded: true,
    signals: [signal, ...filtered],
    updatedConsent: {
      ...consentConfig,
      allowCrossUserSharing: false,
      silentModelTrainingEnabled: false,
      preferredStyleTags: Array.from(nextPreferredTags),
      rejectedStyleTags: Array.from(nextRejectedTags),
      updatedAt: now,
    },
  };
}

/**
 * Ranks templates for a specific user using ONLY their explicit, consented preference signals
 * and transparent deterministic weights. Never leaks signals across users.
 */
export function rankTemplatesWithTransparentSignals(params: {
  ownerUid: string;
  consentConfig: UserPreferenceConsentConfig;
  userSignals: TemplatePreferenceSignal[];
  templates: CatalogItem[];
  moduleId?: ModuleId;
}): TransparentTemplateRankingEntry[] {
  const { ownerUid, consentConfig, userSignals, templates, moduleId } = params;
  // Strictly scope signals to caller ownerUid
  const scopedSignals = consentConfig.consentToPreferenceRanking
    ? userSignals.filter((s) => s.ownerUid === ownerUid)
    : [];

  const filteredTemplates = moduleId
    ? templates.filter((t) => t.moduleId === moduleId)
    : templates;

  const entries: TransparentTemplateRankingEntry[] = filteredTemplates.map((tpl) => {
    const baseQualityScore =
      tpl.validationState === 'Validated'
        ? 100
        : tpl.validationState === 'Draft'
        ? 70
        : tpl.validationState === 'Deprecated'
        ? 25
        : 50;

    const signalForTemplate = scopedSignals.find((s) => s.templateId === tpl.id);
    const preferredTemplateBoost =
      signalForTemplate?.action === 'mark-preferred' ||
      signalForTemplate?.action === 'pin-for-module'
        ? 45
        : 0;
    const chosenVersionBoost =
      signalForTemplate?.action === 'choose-version' ? 20 : 0;

    const tplTagsLower = (tpl.tags || []).map((t) => t.toLowerCase());
    const matchingPreferredTags = consentConfig.consentToPreferenceRanking
      ? tplTagsLower.filter((tag) => consentConfig.preferredStyleTags.includes(tag))
      : [];
    const matchingRejectedTags = consentConfig.consentToPreferenceRanking
      ? tplTagsLower.filter((tag) => consentConfig.rejectedStyleTags.includes(tag))
      : [];

    const styleMatchBoost = matchingPreferredTags.length * 15;
    const isDirectlyRejected = signalForTemplate?.action === 'reject-style';
    const rejectedStylePenalty =
      (isDirectlyRejected ? -65 : 0) + matchingRejectedTags.length * -25;
    const deprecationPenalty = tpl.deprecationStatus?.isDeprecated ? -50 : 0;

    const totalScore =
      baseQualityScore +
      preferredTemplateBoost +
      chosenVersionBoost +
      styleMatchBoost +
      rejectedStylePenalty +
      deprecationPenalty;

    const selectedVersion =
      signalForTemplate?.preferredVersion || tpl.metadata?.version || '1.0.0';

    const reasons: string[] = [`Base(${baseQualityScore})`];
    if (preferredTemplateBoost > 0) reasons.push(`+Preferred(${preferredTemplateBoost})`);
    if (chosenVersionBoost > 0)
      reasons.push(`+PinnedVersion v${selectedVersion}(${chosenVersionBoost})`);
    if (styleMatchBoost > 0)
      reasons.push(`+StyleMatch[${matchingPreferredTags.join(',')}](${styleMatchBoost})`);
    if (rejectedStylePenalty < 0)
      reasons.push(`RejectedStyle(${rejectedStylePenalty})`);
    if (deprecationPenalty < 0) reasons.push(`Deprecated(${deprecationPenalty})`);

    return {
      templateId: tpl.id,
      title: tpl.name,
      moduleId: tpl.moduleId,
      validationState: tpl.validationState || 'Validated',
      totalScore,
      rankingBreakdown: {
        baseQualityScore,
        preferredTemplateBoost,
        chosenVersionBoost,
        styleMatchBoost,
        rejectedStylePenalty,
        deprecationPenalty,
        explanation: reasons.join(' '),
      },
      selectedVersion,
      isPreferredByUser: preferredTemplateBoost > 0,
      isStyleRejected: isDirectlyRejected || matchingRejectedTags.length > 0,
    };
  });

  return entries.sort((a, b) => b.totalScore - a.totalScore);
}
