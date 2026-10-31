import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  Film,
  FolderCheck,
  Layers,
  Lock,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Sliders,
  Sparkles,
  Upload,
  Wand2,
} from 'lucide-react';
import {
  applyReferenceCorrectionAction,
  BUILT_IN_REFERENCE_PRESETS,
  buildDraftTemplateFromReferenceSession,
  convertReferenceSessionToProjectRecord,
  createReferenceLabSession,
  inspectReferenceSourceUrl,
  PropertyProvenanceSource,
  ReferenceCorrectionActionRecord,
  ReferenceInputSourceKind,
  ReferenceLabSession,
  ReferenceUrlInspectionResult,
  ReferenceUsageMode,
  validateAndPromoteReferenceTemplate,
} from '../services/referenceLabEngine';
import {
  evaluateProjectAtTime,
  serializeCanonicalProject,
} from '../services/canonicalProjectEngine';
import { MobileProEditorModal } from './MobileProEditorModal';
import { CatalogItem, ProjectLibraryItem } from '../types/sowveil';
import { executeAuthenticatedApiRequest } from '../services/apiClient';

interface ReferenceLabWorkspaceProps {
  idToken?: string | null;
  userUid?: string | null;
  onProjectSaved?: (project: ProjectLibraryItem) => void;
  onTemplateSaved?: (template: CatalogItem) => void;
  onCatalogChanged?: () => void;
  getAuthToken?: (forceRefresh?: boolean) => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

const PROVENANCE_BADGE_STYLES: Record<
  PropertyProvenanceSource,
  { bg: string; border: string; text: string; label: string }
> = {
  'provided source project': {
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/40',
    text: 'text-emerald-300',
    label: 'Provided Source Project',
  },
  'measured from frame': {
    bg: 'bg-sky-500/15',
    border: 'border-sky-500/40',
    text: 'text-sky-300',
    label: 'Measured from Frame',
  },
  inferred: {
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/40',
    text: 'text-amber-300',
    label: 'Inferred',
  },
  'generated approximation': {
    bg: 'bg-purple-500/15',
    border: 'border-purple-500/40',
    text: 'text-purple-300',
    label: 'Generated Approximation',
  },
  unknown: {
    bg: 'bg-zinc-800',
    border: 'border-zinc-600',
    text: 'text-zinc-300',
    label: 'Unknown / Unrecoverable',
  },
};

export const ReferenceLabWorkspace: React.FC<ReferenceLabWorkspaceProps> = ({
  idToken,
  userUid,
  onProjectSaved,
  onTemplateSaved,
  onCatalogChanged,
  getAuthToken,
  fetchImpl,
}) => {
  const apiRequest = React.useCallback(
    async <T,>(
      path: string,
      options: {
        method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        body?: unknown;
      } = {}
    ) => {
      return executeAuthenticatedApiRequest<T>(path, {
        ...options,
        getAuthToken:
          getAuthToken || (idToken ? async () => idToken : undefined),
        fetchImpl,
      });
    },
    [getAuthToken, idToken, fetchImpl]
  );
  // 1. Rights & Usage Mode State (Mandatory at start)
  const [usageMode, setUsageMode] = useState<ReferenceUsageMode | null>(
    'authorized-reconstruction'
  );
  const [rightsDeclarationChecked, setRightsDeclarationChecked] = useState<boolean>(true);
  const [attributionText, setAttributionText] = useState<string>(
    'Authorized kinetic typography reel for Sowveil Studio template reconstruction.'
  );
  const [allowRemoteModelUpload, setAllowRemoteModelUpload] = useState<boolean>(false);
  const [cancelledBeforeRemoteUpload, setCancelledBeforeRemoteUpload] =
    useState<boolean>(false);

  // 2. Ingestion Source State
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    BUILT_IN_REFERENCE_PRESETS[0].id
  );
  const [sessionTitle, setSessionTitle] = useState<string>(
    BUILT_IN_REFERENCE_PRESETS[0].title
  );
  const [sourceKind, setSourceKind] = useState<ReferenceInputSourceKind>('uploaded-video');
  const [sourceUrlInput, setSourceUrlInput] = useState<string>('');
  const [urlInspection, setUrlInspection] =
    useState<ReferenceUrlInspectionResult | null>(null);
  const [suppliedFileNames, setSuppliedFileNames] = useState<string[]>([]);
  const [uploadedSizeBytes, setUploadedSizeBytes] = useState<number | null>(null);

  // 3. Active Session
  const [session, setSession] = useState<ReferenceLabSession>(() =>
    createReferenceLabSession({
      ownerUid: userUid || 'local-studio-user',
      title: BUILT_IN_REFERENCE_PRESETS[0].title,
      usageMode: 'authorized-reconstruction',
      sourceKind: 'uploaded-video',
      presetId: BUILT_IN_REFERENCE_PRESETS[0].id,
      allowRemoteModelUpload: false,
      cancelledBeforeRemoteUpload: false,
      attributionText:
        'Authorized kinetic typography reel for Sowveil Studio template reconstruction.',
    })
  );
  const [statusBanner, setStatusBanner] = useState<{
    tone: 'ok' | 'warn' | 'error';
    message: string;
  } | null>(null);

  // 4. Scrub-able Player & Shot Comparison State
  const [playheadSec, setPlayheadSec] = useState<number>(0.4);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [selectedShotId, setSelectedShotId] = useState<string>('shot_01');
  const [editingObservationId, setEditingObservationId] = useState<string | null>(null);
  const [editingObservationValue, setEditingObservationValue] = useState<string>('');
  const [customColorHex, setCustomColorHex] = useState<string>('#F06424');
  const [selectedTransitionType, setSelectedTransitionType] = useState<
    'cut' | 'cross-dissolve' | 'slide-left' | 'slide-up' | 'zoom-blur' | 'whip-pan'
  >('whip-pan');
  const [selectedBackdropHex, setSelectedBackdropHex] = useState<string>('#141824');
  const [isProEditorOpen, setIsProEditorOpen] = useState<boolean>(false);
  const [activeReportTab, setActiveReportTab] = useState<
    'comparison' | 'fidelity' | 'audio' | 'canonical'
  >('comparison');

  // Playback loop for scrub-able Reference vs. Reconstruction player
  useEffect(() => {
    if (!isPlaying) return;
    const maxDuration = session.mediaSpecs.durationSec || 6.0;
    const interval = window.setInterval(() => {
      setPlayheadSec((prev) => {
        const next = prev + 0.1;
        return next >= maxDuration ? 0 : Number(next.toFixed(2));
      });
    }, 100);
    return () => window.clearInterval(interval);
  }, [isPlaying, session.mediaSpecs.durationSec]);

  // Keep activeShot synced with playhead
  const activeShot = useMemo(() => {
    if (session.shots.length === 0) return null;
    const byTime = session.shots.find(
      (s) => playheadSec >= s.startTimeSec && playheadSec <= s.endTimeSec
    );
    return (
      byTime ||
      session.shots.find((s) => s.id === selectedShotId) ||
      session.shots[0]
    );
  }, [session.shots, playheadSec, selectedShotId]);

  const activeShotObservations = useMemo(() => {
    if (!activeShot) return [];
    return session.observations.filter((o) => o.shotId === activeShot.id);
  }, [session.observations, activeShot]);

  const handleInspectUrl = async () => {
    if (!sourceUrlInput.trim()) {
      setStatusBanner({
        tone: 'warn',
        message:
          'Enter a public URL (YouTube, Instagram, Pinterest, Vimeo, or HTTPS media) to inspect.',
      });
      return;
    }

    const localResult = inspectReferenceSourceUrl(sourceUrlInput);
    setUrlInspection(localResult);
    if (!localResult.allowedForIngestion) {
      setStatusBanner({
        tone: 'error',
        message: `[${localResult.errorCode}] ${localResult.lawfulFallbackInstruction}`,
      });
      return;
    }

    setSourceKind('public-url');
    const res = await apiRequest<{ inspection: ReferenceUrlInspectionResult }>(
      '/api/v1/reference-lab/inspect-url',
      {
        method: 'POST',
        body: { url: sourceUrlInput },
      }
    );
    if (res.ok && res.data?.inspection) {
      setUrlInspection(res.data.inspection);
    }

    setStatusBanner({
      tone: localResult.requiresUserMediaUpload ? 'warn' : 'ok',
      message: `${localResult.statusSummary} — ${localResult.lawfulFallbackInstruction}`,
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isStill = file.type.startsWith('image/');
    const isAudio = file.type.startsWith('audio/');
    const isJson = file.name.endsWith('.json');

    const detectedKind: ReferenceInputSourceKind = isJson
      ? 'uploaded-project-file'
      : isStill
        ? 'uploaded-screenshots'
        : isAudio
          ? 'uploaded-audio'
          : 'uploaded-video';

    setSourceKind(detectedKind);
    setSelectedPresetId('');
    setSessionTitle(file.name.replace(/\.[^.]+$/, ''));
    setSuppliedFileNames([file.name]);
    setUploadedSizeBytes(file.size);

    setStatusBanner({
      tone: 'ok',
      message: `Selected lawful file "${file.name}" (${Math.round(file.size / 1024)} KB) as ${detectedKind}. Ready to run analysis pipeline.`,
    });
  };

  const handleCancelBeforeRemoteUpload = () => {
    setAllowRemoteModelUpload(false);
    setCancelledBeforeRemoteUpload(true);
    setStatusBanner({
      tone: 'warn',
      message:
        'Remote model upload cancelled. Reference Lab is locked to 100% local deterministic frame & audio analysis. No third-party media will leave your device.',
    });
  };

  const handleRunAnalysisPipeline = async () => {
    if (!usageMode) {
      setStatusBanner({
        tone: 'error',
        message:
          'Select a Usage Mode (Authorized Reconstruction or Reference-Inspired) before running the pipeline.',
      });
      return;
    }
    if (!rightsDeclarationChecked) {
      setStatusBanner({
        tone: 'error',
        message: 'Acknowledge the usage declaration before ingesting reference material.',
      });
      return;
    }

    try {
      const payload = {
        title: sessionTitle.trim() || 'Reference Reconstruction',
        usageMode,
        sourceKind,
        sourceUrl: sourceUrlInput.trim() || undefined,
        presetId: selectedPresetId,
        suppliedFileNames,
        allowRemoteModelUpload: cancelledBeforeRemoteUpload
          ? false
          : allowRemoteModelUpload,
        cancelledBeforeRemoteUpload,
        attributionText,
      };

      const res = await apiRequest<{ session: ReferenceLabSession }>(
        '/api/v1/reference-lab/sessions',
        {
          method: 'POST',
          body: payload,
        }
      );

      let activeSession: ReferenceLabSession;
      if (res.ok && res.data?.session) {
        activeSession = res.data.session;
      } else {
        activeSession = createReferenceLabSession({
          ownerUid: userUid || 'local-studio-user',
          ...payload,
        });
        if (!res.ok && res.status !== 401) {
          setStatusBanner({
            tone: 'warn',
            message: `Server analysis rejected: ${res.errorMessage || 'Using local reconstruction session.'}`,
          });
        }
      }

      setSession(activeSession);
      setPlayheadSec(activeSession.shots[0]?.representativeTimestampsSec[0] || 0.2);
      setSelectedShotId(activeSession.shots[0]?.id || 'shot_01');

      setStatusBanner({
        tone: 'ok',
        message:
          usageMode === 'authorized-reconstruction'
            ? `Authorized Reconstruction complete: ${activeSession.shots.length} shots segmented, ${activeSession.fidelityReport.reconstructedEditableProperties.length} editable properties mapped to Canonical Project v2.0.0.`
            : `Reference-Inspired synthesis complete: Preserved broad pacing/contrast lessons and generated an independent editable composition with original copy, shifted timing, and Sowveil original audio.`,
      });
    } catch (err: any) {
      setStatusBanner({
        tone: 'error',
        message: err?.message || 'Failed to run Reference Lab pipeline.',
      });
    }
  };

  const handleApplyCorrection = async (input: {
    actionType: ReferenceCorrectionActionRecord['actionType'];
    shotId: string;
    targetClipId?: string;
    transitionType?: 'cut' | 'cross-dissolve' | 'slide-left' | 'slide-up' | 'zoom-blur' | 'whip-pan';
    transitionDurationSec?: number;
    slowdownFactor?: number;
    newBackgroundColorHex?: string;
    newAssetId?: string;
    colorHexToMatch?: string;
    observationId?: string;
    correctedValue?: string | number | boolean;
  }) => {
    const updated = applyReferenceCorrectionAction(session, input);
    setSession(updated);

    const res = await apiRequest<{ session: ReferenceLabSession }>(
      `/api/v1/reference-lab/sessions/${session.id}/actions`,
      {
        method: 'POST',
        body: input,
      }
    );
    if (res.ok && res.data?.session) {
      setSession(res.data.session);
    }

    setStatusBanner({
      tone: updated.fidelityReport.localCheckResult.passed ? 'ok' : 'warn',
      message: `Applied "${input.actionType}" on ${input.shotId}. Local check: ${
        updated.fidelityReport.localCheckResult.passed
          ? 'Canonical v2.0.0 Valid & Render Smoke Test Passed'
          : 'Check warnings'
      }.`,
    });
  };

  const handleSaveToProjectLibrary = async () => {
    const res = await apiRequest<{
      project: ProjectLibraryItem;
      session: ReferenceLabSession;
    }>(`/api/v1/reference-lab/sessions/${session.id}/save-project`, {
      method: 'POST',
    });

    if (res.ok && res.data?.project) {
      const projectRecord = res.data.project;
      onProjectSaved?.(projectRecord);
      setSession(res.data.session || {
        ...session,
        savedProjectId: projectRecord.id,
        updatedAt: projectRecord.updatedAt,
      });
      setStatusBanner({
        tone: 'ok',
        message: `Saved "${projectRecord.title}" to Project Library (${projectRecord.id}) with full Canonical Project v2.0.0 timeline and provenance metadata.`,
      });
    } else {
      setStatusBanner({
        tone: 'error',
        message: `Failed to save project to server: ${res.errorMessage || 'Server rejected project save.'}`,
      });
    }
  };

  const handleSaveTemplate = async (promoteToValidated: boolean) => {
    const res = await apiRequest<{
      template: CatalogItem;
      promotionResult?: unknown;
      session: ReferenceLabSession;
    }>(`/api/v1/reference-lab/sessions/${session.id}/save-template`, {
      method: 'POST',
      body: { promoteToValidated },
    });

    if (res.ok && res.data?.template) {
      const templateItem = res.data.template;
      onTemplateSaved?.(templateItem);
      onCatalogChanged?.();
      setSession(res.data.session || {
        ...session,
        savedDraftTemplateId: templateItem.id,
        ...(promoteToValidated ? { promotedValidatedTemplateId: templateItem.id } : {}),
        updatedAt: new Date().toISOString(),
      });
      setStatusBanner({
        tone: 'ok',
        message: `Saved reusable private template "${templateItem.name}" (${templateItem.id}, license: ${templateItem.licenseType}) to catalog.`,
      });
    } else {
      setStatusBanner({
        tone: 'error',
        message: `Failed to save template to server: ${res.errorMessage || 'Server rejected template save.'}`,
      });
    }
  };

  // Evaluate reconstructed clips at current playheadSec for live side-by-side preview
  const evaluatedVisualClips = useMemo(() => {
    try {
      return evaluateProjectAtTime(session.canonicalProject, playheadSec).filter(
        (f) => f.clip.kind !== 'audio'
      );
    } catch {
      return [];
    }
  }, [session.canonicalProject, playheadSec]);

  return (
    <div className="min-h-screen bg-[#070709] text-zinc-100 flex flex-col">
      {/* Top Workspace Bar */}
      <header className="border-b border-zinc-800/90 bg-[#0B0B0F]/95 backdrop-blur px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/app/text-animation"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-orange-400" />
            20-Module Reference Studio
          </Link>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
            <h1 className="text-sm sm:text-base font-semibold tracking-tight text-white">
              Reference Lab — Video / Link / Screenshot to Editable Template Reconstruction
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsProEditorOpen(true)}
            data-testid="reflab-open-pro-editor"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/40 text-orange-300 text-xs font-semibold transition-colors"
          >
            <Sliders className="w-3.5 h-3.5" />
            Open in Pro Timeline Editor (v2.0)
          </button>
          <Link
            to="/app/project-library"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-medium transition-colors"
          >
            <FolderCheck className="w-3.5 h-3.5 text-emerald-400" />
            Project Library
          </Link>
        </div>
      </header>

      {/* Status Banner */}
      {statusBanner && (
        <div
          data-testid="reflab-status-banner"
          className={`px-4 py-2.5 text-xs border-b flex items-center justify-between gap-3 ${
            statusBanner.tone === 'ok'
              ? 'bg-emerald-950/50 border-emerald-500/30 text-emerald-200'
              : statusBanner.tone === 'warn'
                ? 'bg-amber-950/50 border-amber-500/30 text-amber-200'
                : 'bg-rose-950/60 border-rose-500/40 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusBanner.tone === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <span>{statusBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-[11px] underline opacity-80 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="flex-1 max-w-[1600px] w-full mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT COLUMN (4 cols): Step 1 Rights Gate + Step 2 Source Ingestion */}
        <div className="lg:col-span-4 space-y-4">
          {/* STEP 1: Mandatory Usage Mode & Rights Gate */}
          <section
            aria-label="Usage Mode & Rights Declaration"
            className="rounded-xl border border-zinc-800 bg-[#0D0E12] p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-orange-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                  1. Usage Mode & Rights Gate
                </h2>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-orange-500/15 border border-orange-500/30 text-orange-300 font-medium">
                Required at Start
              </span>
            </div>

            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Select how Reference Lab should treat the source material. A rights checkbox is recorded as your user declaration, not legal proof of ownership.
            </p>

            <div className="space-y-2">
              <label
                data-testid="mode-authorized-reconstruction"
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  usageMode === 'authorized-reconstruction'
                    ? 'bg-orange-500/10 border-orange-500/50 text-white'
                    : 'bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                }`}
              >
                <input
                  type="radio"
                  name="usageMode"
                  checked={usageMode === 'authorized-reconstruction'}
                  onChange={() => setUsageMode('authorized-reconstruction')}
                  className="mt-0.5 accent-orange-500"
                />
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold text-zinc-100">
                    I own this content / I have permission / this is public-domain or licensed media
                  </div>
                  <div className="text-[11px] text-orange-300/90 font-medium">
                    → Authorized Reconstruction Mode
                  </div>
                  <div className="text-[10px] text-zinc-400">
                    Reconstructs shot-by-shot editable text, vector shapes, keyframed 2D transforms, transitions, and audio timing cues as closely as possible.
                  </div>
                </div>
              </label>

              <label
                data-testid="mode-reference-inspired"
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  usageMode === 'reference-inspired'
                    ? 'bg-sky-500/10 border-sky-500/50 text-white'
                    : 'bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                }`}
              >
                <input
                  type="radio"
                  name="usageMode"
                  checked={usageMode === 'reference-inspired'}
                  onChange={() => setUsageMode('reference-inspired')}
                  className="mt-0.5 accent-sky-400"
                />
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold text-zinc-100">
                    Use as visual reference only
                  </div>
                  <div className="text-[11px] text-sky-300 font-medium">
                    → Reference-Inspired Mode
                  </div>
                  <div className="text-[10px] text-zinc-400">
                    Extracts broad pacing, contrast, and motion-curve lessons to generate an independently-created editable template without copying source wording, assets, or audio.
                  </div>
                </div>
              </label>
            </div>

            <div className="pt-1 space-y-2 border-t border-zinc-800/80">
              <label className="flex items-start gap-2 text-[11px] text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rightsDeclarationChecked}
                  onChange={(e) => setRightsDeclarationChecked(e.target.checked)}
                  className="mt-0.5 accent-orange-500"
                />
                <span>
                  I understand this selection is recorded as my declaration in the project & template audit trail, and unknown-rights items are never published as Free.
                </span>
              </label>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">
                  Source & Rights Provenance Note
                </label>
                <input
                  type="text"
                  value={attributionText}
                  onChange={(e) => setAttributionText(e.target.value)}
                  placeholder="e.g., Client-owned product launch reel / CC0 reference"
                  className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-orange-500"
                />
              </div>

              {/* Remote Model Upload Consent & Cancel Option */}
              <div className="rounded-lg bg-zinc-900/90 border border-zinc-800 p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-[11px] text-zinc-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowRemoteModelUpload && !cancelledBeforeRemoteUpload}
                      onChange={(e) => {
                        setAllowRemoteModelUpload(e.target.checked);
                        if (e.target.checked) setCancelledBeforeRemoteUpload(false);
                      }}
                      className="accent-orange-500"
                    />
                    <span>Allow uploading frames to remote AI vision models</span>
                  </label>
                  <button
                    type="button"
                    data-testid="cancel-remote-upload-btn"
                    onClick={handleCancelBeforeRemoteUpload}
                    className="px-2 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-[10px] font-medium transition-colors"
                  >
                    Cancel Remote Upload (Keep Local)
                  </button>
                </div>
                <p className="text-[10px] text-zinc-400">
                  {cancelledBeforeRemoteUpload || !allowRemoteModelUpload
                    ? 'Local-Only Mode Active: Third-party material stays in your browser/workspace and is analyzed deterministically without remote model upload.'
                    : 'Remote Model Upload Enabled: Sampled frames may be sent to the configured multimodal provider.'}
                </p>
              </div>
            </div>
          </section>

          {/* STEP 2: Source Ingestion (Public URL, Upload, or Built-in Reference) */}
          <section
            aria-label="Reference Source Ingestion"
            className="rounded-xl border border-zinc-800 bg-[#0D0E12] p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-orange-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                  2. Source Ingestion
                </h2>
              </div>
              <span className="text-[10px] text-zinc-400">
                No DRM / Login / Paywall Bypass
              </span>
            </div>

            {/* Built-in Reference Presets */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">
                Reference Sample / Preset Pack
              </label>
              <select
                data-testid="reflab-preset-select"
                value={selectedPresetId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setSelectedPresetId(nextId);
                  const found = BUILT_IN_REFERENCE_PRESETS.find((p) => p.id === nextId);
                  if (found) {
                    setSessionTitle(found.title);
                    setSourceKind(found.sourceKind);
                  }
                }}
                className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-orange-500"
              >
                {BUILT_IN_REFERENCE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.title} ({preset.aspectRatio} · {preset.durationSec}s @{' '}
                    {preset.fps}fps)
                  </option>
                ))}
              </select>
            </div>

            {/* Public URL Inspector */}
            <div className="space-y-1.5 pt-2 border-t border-zinc-800/80">
              <label className="block text-[10px] uppercase tracking-wider text-zinc-400">
                Public Page or Direct HTTPS Media URL (YouTube, Instagram, Pinterest, Web)
              </label>
              <div className="flex gap-1.5">
                <input
                  type="url"
                  data-testid="reflab-url-input"
                  value={sourceUrlInput}
                  onChange={(e) => setSourceUrlInput(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=... or https://cdn.example.com/reel.mp4"
                  className="flex-1 rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-orange-500"
                />
                <button
                  type="button"
                  data-testid="reflab-inspect-url-btn"
                  onClick={handleInspectUrl}
                  className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-medium text-zinc-200 shrink-0 transition-colors"
                >
                  Inspect URL
                </button>
              </div>

              {urlInspection && (
                <div
                  data-testid="reflab-url-inspection-card"
                  className={`p-2.5 rounded-lg border text-[11px] space-y-1 ${
                    !urlInspection.allowedForIngestion
                      ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                      : urlInspection.requiresUserMediaUpload
                        ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                        : 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold">
                    <span>
                      Platform: {urlInspection.platformCategory.toUpperCase()} ·{' '}
                      {urlInspection.allowedForIngestion ? 'URL Permitted' : 'Blocked'}
                    </span>
                    {urlInspection.requiresUserMediaUpload && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-[10px]">
                        Requires Lawful Upload / Screenshots
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] opacity-90">
                    {urlInspection.lawfulFallbackInstruction}
                  </p>
                </div>
              )}
            </div>

            {/* Lawful File / Screenshot / Project Upload */}
            <div className="space-y-1.5 pt-2 border-t border-zinc-800/80">
              <label className="block text-[10px] uppercase tracking-wider text-zinc-400">
                Upload Lawful Video, Screenshots, Audio, or .sowveil.json Project
              </label>
              <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-dashed border-zinc-700 hover:border-orange-500/60 bg-zinc-900/50 cursor-pointer text-xs text-zinc-300 transition-colors">
                <span className="flex items-center gap-2 truncate">
                  <Upload className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                  {suppliedFileNames.length > 0
                    ? `${suppliedFileNames.join(', ')} (${Math.round(
                        (uploadedSizeBytes || 2048) / 1024
                      )} KB)`
                    : 'Choose MP4/WebM, PNG/JPG screenshots, WAV, or .json...'}
                </span>
                <input
                  type="file"
                  accept="video/*,image/*,audio/*,.json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Session Title & Run Pipeline Button */}
            <div className="pt-2 border-t border-zinc-800/80 space-y-2">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">
                  Reconstruction Title
                </label>
                <input
                  type="text"
                  value={sessionTitle}
                  onChange={(e) => setSessionTitle(e.target.value)}
                  className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-orange-500"
                />
              </div>

              <button
                type="button"
                data-testid="reflab-run-pipeline-btn"
                onClick={handleRunAnalysisPipeline}
                className="w-full py-2.5 px-3 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-orange-500/10 transition-all"
              >
                <Wand2 className="w-4 h-4" />
                {usageMode === 'reference-inspired'
                  ? 'Synthesize Reference-Inspired Editable Template'
                  : 'Run Authorized Shot & Layer Reconstruction'}
              </button>
            </div>
          </section>

          {/* Pipeline Reproducibility & Local Check Diagnostics */}
          <section className="rounded-xl border border-zinc-800 bg-[#0D0E12] p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                Pipeline Provenance & Local Verification
              </span>
              <span
                data-testid="reflab-local-check-badge"
                className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                  session.fidelityReport.localCheckResult.passed
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                }`}
              >
                {session.fidelityReport.localCheckResult.passed
                  ? 'Canonical v2.0.0 Verified'
                  : 'Needs Review'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 rounded bg-zinc-900/80 border border-zinc-800">
                <div className="text-zinc-400 text-[10px]">Analyzer Version</div>
                <div className="font-mono text-zinc-200 truncate">
                  {session.pipelineMetadata.analyzerVersion}
                </div>
              </div>
              <div className="p-2 rounded bg-zinc-900/80 border border-zinc-800">
                <div className="text-zinc-400 text-[10px]">Model / Execution</div>
                <div className="font-mono text-zinc-200 truncate">
                  {session.pipelineMetadata.modelId}
                </div>
              </div>
              <div className="p-2 rounded bg-zinc-900/80 border border-zinc-800">
                <div className="text-zinc-400 text-[10px]">Detected Source</div>
                <div className="text-zinc-200">
                  {session.mediaSpecs.width}×{session.mediaSpecs.height} ·{' '}
                  {session.mediaSpecs.frameRateDetected
                    ? `${session.mediaSpecs.durationSec}s @ ${session.mediaSpecs.fps}fps`
                    : 'Still Image Pack'}
                </div>
              </div>
              <div className="p-2 rounded bg-zinc-900/80 border border-zinc-800">
                <div className="text-zinc-400 text-[10px]">Evaluated Frames</div>
                <div className="text-zinc-200">
                  {session.fidelityReport.localCheckResult.evaluatedFrameCount} smoke-test frames ·{' '}
                  {session.shots.length} shots
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN (8 cols): Scrub-able Side-by-Side Comparison, Shot Editor, Correction Queue & Fidelity Report */}
        <div className="lg:col-span-8 space-y-4">
          {activeShot && (
            <>
              {/* Mode & Save Actions Header Card */}
              <div className="rounded-xl border border-zinc-800 bg-[#0D0E12] p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      data-testid="active-session-mode-badge"
                      className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                        session.rightsDeclaration.usageMode === 'authorized-reconstruction'
                          ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                          : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                      }`}
                    >
                      {session.rightsDeclaration.usageMode === 'authorized-reconstruction'
                        ? 'Authorized Reconstruction Mode'
                        : 'Reference-Inspired Mode (Independent Synthesis)'}
                    </span>
                    <span className="text-xs font-semibold text-white">
                      {session.title}
                    </span>
                    <span className="text-[11px] text-zinc-400">
                      (Overall Confidence:{' '}
                      {Math.round(session.fidelityReport.overallConfidence * 100)}%)
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    {session.fidelityReport.fidelityDisclaimer}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="reflab-save-project-btn"
                    onClick={handleSaveToProjectLibrary}
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-semibold text-zinc-100 transition-colors"
                  >
                    Save to Project Library
                  </button>
                  <button
                    type="button"
                    data-testid="reflab-save-draft-template-btn"
                    onClick={() => handleSaveTemplate(false)}
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-semibold text-zinc-100 transition-colors"
                  >
                    Save Private Draft Template
                  </button>
                  <button
                    type="button"
                    data-testid="reflab-promote-validated-template-btn"
                    onClick={() => handleSaveTemplate(true)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-xs font-semibold text-emerald-200 transition-colors"
                  >
                    Validate & Promote Template
                  </button>
                </div>
              </div>

              {/* Reference-Inspired Independence Manifest Banner */}
              {session.fidelityReport.independenceManifest && (
                <div
                  data-testid="reflab-independence-manifest"
                  className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-3.5 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-sky-300 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4" />
                      Reference-Inspired Creative Independence Manifest
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-sky-500/20 text-sky-200">
                      Distinct Expressive Content Not Copied
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                    <div>
                      <div className="font-semibold text-zinc-300 mb-1">
                        Broad Creative Lessons Preserved:
                      </div>
                      <ul className="list-disc list-inside text-zinc-400 space-y-0.5">
                        {session.fidelityReport.independenceManifest.keptCreativeLessons.map(
                          (item, i) => (
                            <li key={i}>{item}</li>
                          )
                        )}
                      </ul>
                    </div>
                    <div>
                      <div className="font-semibold text-zinc-300 mb-1">
                        Independently Synthesized Differences:
                      </div>
                      <ul className="list-disc list-inside text-zinc-400 space-y-0.5">
                        {session.fidelityReport.independenceManifest.replacedDistinctiveElements.map(
                          (item, i) => (
                            <li key={i}>{item}</li>
                          )
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Scrub-able Side-by-Side Player & Shot Timeline */}
              <section
                aria-label="Scrub-able Reference vs Reconstruction Comparison"
                className="rounded-xl border border-zinc-800 bg-[#0D0E12] p-4 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsPlaying((p) => !p)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-black font-bold text-xs transition-colors"
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="w-3.5 h-3.5" /> Pause
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" /> Play Sync
                        </>
                      )}
                    </button>
                    <span className="text-xs font-mono text-zinc-300">
                      Timecode: {playheadSec.toFixed(2)}s /{' '}
                      {session.mediaSpecs.durationSec.toFixed(2)}s
                    </span>
                    <span className="text-xs text-orange-300 font-medium">
                      · Active {activeShot.title} ({activeShot.startTimeSec.toFixed(2)}s–
                      {activeShot.endTimeSec.toFixed(2)}s)
                    </span>
                  </div>

                  {/* Workspace Sub-tabs */}
                  <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
                    {(
                      [
                        ['comparison', 'Side-by-Side & Refinement'],
                        ['fidelity', 'Fidelity Report'],
                        ['audio', 'Audio & Beat Map'],
                        ['canonical', 'Canonical JSON (v2.0)'],
                      ] as const
                    ).map(([tabKey, tabLabel]) => (
                      <button
                        key={tabKey}
                        type="button"
                        data-testid={`reflab-tab-${tabKey}`}
                        onClick={() => setActiveReportTab(tabKey)}
                        className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                          activeReportTab === tabKey
                            ? 'bg-orange-500 text-black font-semibold'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {tabLabel}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Timeline Scrubber with Shot Markers & Dense Change Samples */}
                <div className="space-y-2">
                  <input
                    type="range"
                    min={0}
                    max={session.mediaSpecs.durationSec}
                    step={0.05}
                    value={playheadSec}
                    onChange={(e) => {
                      setIsPlaying(false);
                      setPlayheadSec(Number(e.target.value));
                    }}
                    className="w-full accent-orange-500 cursor-pointer"
                  />

                  {/* Shot Segment Pills */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {session.shots.map((shot) => {
                      const isCurrent = shot.id === activeShot.id;
                      return (
                        <button
                          key={shot.id}
                          type="button"
                          data-testid={`reflab-shot-pill-${shot.id}`}
                          onClick={() => {
                            setSelectedShotId(shot.id);
                            setPlayheadSec(shot.representativeTimestampsSec[0] || shot.startTimeSec);
                          }}
                          className={`p-2.5 rounded-lg border text-left transition-all ${
                            isCurrent
                              ? 'bg-orange-500/15 border-orange-500/60 text-white'
                              : 'bg-zinc-900/70 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs font-semibold">
                            <span className="truncate">{shot.title}</span>
                            <span className="text-[10px] font-mono text-orange-300 shrink-0 ml-1">
                              {Math.round(shot.confidenceScore * 100)}% conf
                            </span>
                          </div>
                          <div className="text-[10px] text-zinc-400 mt-0.5 flex items-center justify-between">
                            <span>
                              {shot.startTimeSec.toFixed(1)}s – {shot.endTimeSec.toFixed(1)}s ·{' '}
                              {shot.transitionIn}
                            </span>
                            <span>
                              {shot.denseSampleTimestampsSec.length} dense samples
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {activeReportTab === 'comparison' && (
                  <>
                    {/* Side-by-Side Viewports: Reference Frame vs Reconstructed Editable Canvas */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* LEFT VIEWPORT: Reference Frame & Measured Telemetry */}
                      <div className="rounded-xl border border-zinc-800 bg-[#08090D] p-3 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                            <Eye className="w-3.5 h-3.5 text-sky-400" />
                            Reference Source Frame ({playheadSec.toFixed(2)}s)
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
                            Rep Frame:{' '}
                            {(activeShot.representativeTimestampsSec[0] || 0).toFixed(2)}s
                          </span>
                        </div>

                        <div
                          className="relative h-56 rounded-lg border border-zinc-800/90 overflow-hidden flex flex-col items-center justify-center p-4 text-center"
                          style={{
                            background: `radial-gradient(circle at 50% 35%, ${
                              activeShot.colorPaletteHex[1] || '#F06424'
                            }33, ${activeShot.colorPaletteHex[0] || '#080707'} 78%)`,
                          }}
                        >
                          <div className="absolute top-2 left-2 flex flex-wrap gap-1">
                            {activeShot.colorPaletteHex.map((hex) => (
                              <span
                                key={hex}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/70 border border-white/15 text-[10px] font-mono text-zinc-200"
                              >
                                <span
                                  className="w-2.5 h-2.5 rounded-sm"
                                  style={{ backgroundColor: hex }}
                                />
                                {hex}
                              </span>
                            ))}
                          </div>
                          <div className="text-[10px] uppercase tracking-widest text-zinc-400 mb-1">
                            {activeShot.cameraMotion} · {activeShot.apparentDepth}
                          </div>
                          <div
                            className="text-lg font-extrabold tracking-tight px-3 py-1 rounded"
                            style={{
                              color: activeShot.typographyAnalysis.textColorHex,
                            }}
                          >
                            {activeShot.typographyAnalysis.detectedText || activeShot.title}
                          </div>
                          <div className="mt-2 text-[11px] text-zinc-300 max-w-xs">
                            {activeShot.visualSummary}
                          </div>
                          <div className="absolute bottom-2 right-2 text-[10px] font-mono px-2 py-0.5 rounded bg-black/70 text-zinc-300">
                            Objects: {activeShot.objectCount} · In: {activeShot.transitionIn}
                          </div>
                        </div>

                        <div className="text-[11px] text-zinc-400 bg-zinc-900/70 border border-zinc-800/80 rounded-lg p-2">
                          <span className="font-semibold text-zinc-200">
                            Shot Mismatch & Approximation Note:{' '}
                          </span>
                          {activeShot.mismatchNotes[0] ||
                            'All primary properties aligned within threshold.'}
                        </div>
                      </div>

                      {/* RIGHT VIEWPORT: Reconstructed Editable Canonical Project v2.0.0 Preview */}
                      <div className="rounded-xl border border-orange-500/30 bg-[#08090D] p-3 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-orange-300 flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-orange-400" />
                            Reconstructed Editable Canvas (Canonical v2.0.0)
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-orange-500/15 text-orange-300 font-mono">
                            {evaluatedVisualClips.length} Active Editable Layers
                          </span>
                        </div>

                        <div
                          data-testid="reflab-reconstructed-canvas"
                          className="relative h-56 rounded-lg border border-orange-500/20 overflow-hidden flex flex-col items-center justify-center p-4 text-center"
                          style={{
                            background: `radial-gradient(circle at 50% 45%, ${
                              activeShot.colorPaletteHex[1] || '#F06424'
                            }2E, ${
                              session.canonicalProject.canvas.backgroundColorHex || '#080707'
                            } 80%)`,
                          }}
                        >
                          {evaluatedVisualClips.map((frame) => (
                            <div
                              key={frame.clip.id}
                              style={{
                                transform: `scale(${frame.transform.scale[0]}, ${frame.transform.scale[1]}) rotate(${frame.transform.rotationDeg}deg)`,
                                opacity: frame.transform.opacity,
                              }}
                              className="transition-transform duration-75"
                            >
                              {frame.clip.kind === 'text' && (
                                <div
                                  className="text-lg font-black tracking-tight drop-shadow"
                                  style={{
                                    color: activeShot.typographyAnalysis.textColorHex,
                                  }}
                                >
                                  {frame.clip.textData?.content || frame.clip.name}
                                </div>
                              )}
                              {frame.clip.kind === 'caption' && (
                                <div className="mt-2 px-2.5 py-0.5 rounded bg-black/80 border border-orange-500/40 text-xs font-bold text-orange-300">
                                  {frame.clip.captionData?.text || frame.clip.name}
                                </div>
                              )}
                            </div>
                          ))}

                          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[10px] font-mono text-zinc-300 bg-black/70 px-2 py-1 rounded">
                            <span>
                              Transition: {activeShot.transitionIn} · Easing:{' '}
                              {activeShot.motionTiming.easingFamily}
                            </span>
                            <span className="text-emerald-300">100% Parametric</span>
                          </div>
                        </div>

                        <div className="text-[11px] text-zinc-300 bg-zinc-900/70 border border-zinc-800/80 rounded-lg p-2 flex items-center justify-between gap-2">
                          <span>
                            All layers use shared{' '}
                            <code className="text-orange-300">CanonicalProjectDocument</code>{' '}
                            commands.
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsProEditorOpen(true)}
                            className="text-orange-400 hover:text-orange-300 font-semibold underline shrink-0"
                          >
                            Edit Keyframes
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Interactive Correction Queue & Targeted Refinement Controls */}
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3.5 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200 flex items-center gap-1.5">
                          <Sliders className="w-3.5 h-3.5 text-orange-400" />
                          Interactive Correction Queue — {activeShot.title}
                        </h3>
                        <span className="text-[10px] text-zinc-400">
                          Re-runs local canonical verification after every adjustment
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {/* 1. Adjust this transition */}
                        <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1.5">
                          <div className="text-[11px] font-semibold text-zinc-200">
                            Adjust This Transition
                          </div>
                          <div className="flex gap-1.5">
                            <select
                              value={selectedTransitionType}
                              onChange={(e) =>
                                setSelectedTransitionType(e.target.value as any)
                              }
                              className="flex-1 rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-[11px] text-zinc-200"
                            >
                              <option value="whip-pan">Whip-Pan</option>
                              <option value="cross-dissolve">Cross-Dissolve</option>
                              <option value="zoom-blur">Zoom-Blur</option>
                              <option value="slide-up">Slide-Up</option>
                              <option value="cut">Hard Cut</option>
                            </select>
                            <button
                              type="button"
                              data-testid="action-adjust-transition"
                              onClick={() =>
                                handleApplyCorrection({
                                  actionType: 'adjust-transition',
                                  shotId: activeShot.id,
                                  transitionType: selectedTransitionType,
                                  transitionDurationSec: 0.4,
                                })
                              }
                              className="px-2.5 py-1 rounded bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/40 text-orange-300 text-[11px] font-semibold"
                            >
                              Apply
                            </button>
                          </div>
                        </div>

                        {/* 2. Make this title's entrance slower */}
                        <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1.5 flex flex-col justify-between">
                          <div>
                            <div className="text-[11px] font-semibold text-zinc-200">
                              Make This Title&apos;s Entrance Slower
                            </div>
                            <div className="text-[10px] text-zinc-400">
                              Extends entrance keyframe ramp by 1.5× with smooth deceleration
                            </div>
                          </div>
                          <button
                            type="button"
                            data-testid="action-slow-title-entrance"
                            onClick={() =>
                              handleApplyCorrection({
                                actionType: 'slow-title-entrance',
                                shotId: activeShot.id,
                                slowdownFactor: 1.5,
                              })
                            }
                            className="w-full py-1 rounded bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/40 text-orange-300 text-[11px] font-semibold"
                          >
                            Slow Title Entrance (1.5×)
                          </button>
                        </div>

                        {/* 3. Replace this background asset */}
                        <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1.5">
                          <div className="text-[11px] font-semibold text-zinc-200">
                            Replace This Background Asset
                          </div>
                          <div className="flex gap-1.5">
                            <input
                              type="text"
                              value={selectedBackdropHex}
                              onChange={(e) => setSelectedBackdropHex(e.target.value)}
                              className="flex-1 rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-[11px] font-mono text-zinc-200"
                            />
                            <button
                              type="button"
                              data-testid="action-replace-background"
                              onClick={() =>
                                handleApplyCorrection({
                                  actionType: 'replace-background-asset',
                                  shotId: activeShot.id,
                                  newBackgroundColorHex: selectedBackdropHex,
                                })
                              }
                              className="px-2.5 py-1 rounded bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/40 text-orange-300 text-[11px] font-semibold"
                            >
                              Replace
                            </button>
                          </div>
                        </div>

                        {/* 4. Match this color */}
                        <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1.5">
                          <div className="text-[11px] font-semibold text-zinc-200">
                            Match This Color
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={customColorHex}
                              onChange={(e) => setCustomColorHex(e.target.value)}
                              className="flex-1 rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-[11px] font-mono text-zinc-200"
                            />
                            <button
                              type="button"
                              data-testid="action-match-color"
                              onClick={() =>
                                handleApplyCorrection({
                                  actionType: 'match-color',
                                  shotId: activeShot.id,
                                  colorHexToMatch: customColorHex,
                                })
                              }
                              className="px-2.5 py-1 rounded bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/40 text-orange-300 text-[11px] font-semibold"
                            >
                              Match Color
                            </button>
                          </div>
                        </div>

                        {/* 5. Preserve this layer */}
                        <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1.5 flex flex-col justify-between">
                          <div>
                            <div className="text-[11px] font-semibold text-zinc-200 flex items-center justify-between">
                              <span>Preserve This Layer</span>
                              {activeShotObservations.some((o) => o.preservedByUser) && (
                                <Lock className="w-3 h-3 text-emerald-400" />
                              )}
                            </div>
                            <div className="text-[10px] text-zinc-400">
                              Locks shot layers against automated overrides
                            </div>
                          </div>
                          <button
                            type="button"
                            data-testid="action-preserve-layer"
                            onClick={() =>
                              handleApplyCorrection({
                                actionType: 'preserve-layer',
                                shotId: activeShot.id,
                              })
                            }
                            className="w-full py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold"
                          >
                            {activeShotObservations.some((o) => o.preservedByUser)
                              ? 'Layer Locked & Preserved'
                              : 'Preserve & Lock Shot Layer'}
                          </button>
                        </div>

                        {/* 6. Re-analyze selected segment */}
                        <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1.5 flex flex-col justify-between">
                          <div>
                            <div className="text-[11px] font-semibold text-zinc-200">
                              Re-Analyze Selected Segment
                            </div>
                            <div className="text-[10px] text-zinc-400">
                              Re-runs dense frame sampling while respecting preserved layers
                            </div>
                          </div>
                          <button
                            type="button"
                            data-testid="action-reanalyze-segment"
                            onClick={() =>
                              handleApplyCorrection({
                                actionType: 'reanalyze-segment',
                                shotId: activeShot.id,
                              })
                            }
                            className="w-full py-1 rounded bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-300 text-[11px] font-semibold flex items-center justify-center gap-1"
                          >
                            <RefreshCw className="w-3 h-3" /> Re-Analyze Segment
                          </button>
                        </div>
                      </div>

                      {/* Shot Property Provenance & Uncertain Label Editor */}
                      <div className="pt-2 border-t border-zinc-800 space-y-2">
                        <div className="text-[11px] font-semibold text-zinc-300">
                          {activeShot.title} Property Provenance & Uncertain Label Corrections:
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {activeShotObservations.map((obs) => {
                            const badge = PROVENANCE_BADGE_STYLES[obs.provenanceSource];
                            const isEditing = editingObservationId === obs.id;
                            const displayVal = String(
                              obs.userCorrectedValue ?? obs.observedValue
                            );
                            return (
                              <div
                                key={obs.id}
                                className="p-2.5 rounded-lg bg-zinc-950/90 border border-zinc-800 flex flex-col justify-between gap-1.5 text-xs"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-zinc-200">
                                    {obs.label}
                                  </span>
                                  <span
                                    className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.bg} ${badge.border} ${badge.text}`}
                                  >
                                    {badge.label} ({Math.round(obs.confidence * 100)}%)
                                  </span>
                                </div>

                                {isEditing ? (
                                  <div className="flex gap-1.5 mt-1">
                                    <input
                                      type="text"
                                      value={editingObservationValue}
                                      onChange={(e) =>
                                        setEditingObservationValue(e.target.value)
                                      }
                                      className="flex-1 rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs text-white"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleApplyCorrection({
                                          actionType: 'correct-observation',
                                          shotId: activeShot.id,
                                          observationId: obs.id,
                                          correctedValue: editingObservationValue,
                                        });
                                        setEditingObservationId(null);
                                      }}
                                      className="px-2 py-1 rounded bg-emerald-500 text-black font-semibold text-[11px]"
                                    >
                                      Save
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between gap-2 text-[11px]">
                                    <span className="font-mono text-zinc-300 truncate">
                                      {displayVal}
                                    </span>
                                    {obs.editableInCanonicalProject && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingObservationId(obs.id);
                                          setEditingObservationValue(displayVal);
                                        }}
                                        className="text-[10px] text-orange-400 hover:underline shrink-0"
                                      >
                                        {obs.uncertain
                                          ? 'Review Uncertain Label'
                                          : 'Correct'}
                                      </button>
                                    )}
                                  </div>
                                )}

                                {obs.uncertaintyReason && (
                                  <div className="text-[10px] text-amber-300/90">
                                    Note: {obs.uncertaintyReason}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {activeReportTab === 'fidelity' && (
                  <div
                    data-testid="reflab-fidelity-report"
                    className="space-y-3 text-xs"
                  >
                    <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/30 text-amber-200 text-[11px]">
                      <strong>Honest Reconstruction Disclosure:</strong>{' '}
                      {session.fidelityReport.fidelityDisclaimer}
                    </div>

                    {/* Media Analysis State & Field Classification Summary */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                      <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                        <div className="text-[10px] uppercase font-mono text-zinc-400">Analysis State</div>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              session.mediaSpecs.sourceMediaParsed
                                ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                                : 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                            }`}
                          >
                            {session.mediaSpecs.mediaAnalysisState || (session.mediaSpecs.sourceMediaParsed ? 'parsed-from-media' : 'filename-only-unparsed')}
                          </span>
                        </div>
                        <div className="text-[10px] text-zinc-400">
                          {session.mediaSpecs.sourceMediaParsed
                            ? 'Media stream inspected & measured.'
                            : 'Unparsed stream: filename only; no frame metrics claimed.'}
                        </div>
                      </div>

                      <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                        <div className="text-[10px] uppercase font-mono text-zinc-400">Observed / Source-Proven</div>
                        <div className="text-lg font-bold text-sky-400">
                          {session.fidelityReport.fieldClassificationSummary?.observed.length ?? session.fidelityReport.reconstructedEditableProperties.length}
                        </div>
                        <div className="text-[10px] text-zinc-400">Verified from stream / source project</div>
                      </div>

                      <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                        <div className="text-[10px] uppercase font-mono text-zinc-400">Inferred & Approximated</div>
                        <div className="text-lg font-bold text-purple-400">
                          {(session.fidelityReport.fieldClassificationSummary?.inferred.length ?? 0) +
                            (session.fidelityReport.fieldClassificationSummary?.generated.length ?? session.fidelityReport.approximatedProperties.length)}
                        </div>
                        <div className="text-[10px] text-zinc-400">Inferred motion / generated proxies</div>
                      </div>

                      <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                        <div className="text-[10px] uppercase font-mono text-zinc-400">Unknown / Unrecoverable</div>
                        <div className="text-lg font-bold text-rose-400">
                          {session.fidelityReport.fieldClassificationSummary?.unknown.length ?? session.fidelityReport.unrecoverableProperties.length}
                        </div>
                        <div className="text-[10px] text-zinc-400">Flattened video boundaries / unparsed</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 space-y-1.5">
                        <div className="font-bold text-emerald-300">
                          Reconstructed Editable Properties (
                          {session.fidelityReport.reconstructedEditableProperties.length})
                        </div>
                        <ul className="list-disc list-inside text-[11px] text-zinc-300 space-y-1">
                          {session.fidelityReport.reconstructedEditableProperties.map(
                            (p, idx) => (
                              <li key={idx}>
                                {p.label} ({p.provenanceSource})
                              </li>
                            )
                          )}
                        </ul>
                      </div>

                      <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 space-y-1.5">
                        <div className="font-bold text-purple-300">
                          Approximated Properties (
                          {session.fidelityReport.approximatedProperties.length})
                        </div>
                        <ul className="list-disc list-inside text-[11px] text-zinc-300 space-y-1">
                          {session.fidelityReport.approximatedProperties.map((p, idx) => (
                            <li key={idx}>
                              {p.label}: {p.reason}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 space-y-1.5">
                        <div className="font-bold text-rose-300">
                          Unrecoverable from Flattened Video (
                          {session.fidelityReport.unrecoverableProperties.length})
                        </div>
                        <ul className="list-disc list-inside text-[11px] text-zinc-300 space-y-1">
                          {session.fidelityReport.unrecoverableProperties.map((p, idx) => (
                            <li key={idx}>
                              {p.label}: {p.reason}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 space-y-1.5">
                        <div className="font-bold text-amber-300">
                          Known Differences & Required User Decisions
                        </div>
                        <ul className="list-disc list-inside text-[11px] text-zinc-300 space-y-1">
                          {session.fidelityReport.knownDifferences.map((d, idx) => (
                            <li key={`diff_${idx}`}>{d}</li>
                          ))}
                          {session.fidelityReport.requiredUserDecisions.map((u) => (
                            <li key={u.id} className="text-orange-300">
                              [{u.resolved ? 'Resolved' : 'Decision'}] {u.prompt}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {activeReportTab === 'audio' && (
                  <div className="space-y-3 text-xs">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                      {session.shots.map((shot) => (
                        <div
                          key={shot.id}
                          className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1"
                        >
                          <div className="font-semibold text-zinc-200">{shot.title}</div>
                          <div className="text-[11px] text-zinc-400">
                            Speech Cue: {shot.audioAnalysis.speechTranscriptCue || 'None'}
                          </div>
                          <div className="text-[11px] text-zinc-400">
                            SFX / Music: {shot.audioAnalysis.musicOrSfxCue || 'None'}
                          </div>
                          <div className="text-[10px] font-mono text-orange-300">
                            Loudness: {shot.audioAnalysis.loudnessLufs ?? 'N/A'} LUFS · Peak:{' '}
                            {shot.audioAnalysis.peakDb ?? 'N/A'} dBFS
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeReportTab === 'canonical' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">
                        Shared Canonical Project Document (
                        <code className="text-orange-300">schemaVersion: 2.0.0</code>)
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsProEditorOpen(true)}
                        className="px-2.5 py-1 rounded bg-orange-500 text-black font-semibold text-[11px]"
                      >
                        Open Interactive Timeline Editor
                      </button>
                    </div>
                    <pre className="max-h-96 overflow-auto rounded-lg bg-zinc-950 border border-zinc-800 p-3 text-[11px] font-mono text-zinc-300">
                      {serializeCanonicalProject(session.canonicalProject)}
                    </pre>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {/* Shared Canonical Project v2.0.0 Pro Timeline Editor Modal */}
      {isProEditorOpen && (
        <MobileProEditorModal
          isOpen={isProEditorOpen}
          onClose={() => setIsProEditorOpen(false)}
          initialProject={session.canonicalProject}
          sourceTemplate={buildDraftTemplateFromReferenceSession(session)}
          ownerUid={session.ownerUid}
          onSaveToProjectLibrary={(partialProj) => {
            onProjectSaved?.({
              ...partialProj,
              id: partialProj.id || `proj_ref_${session.id}`,
              updatedAt: new Date().toISOString(),
            });
            setIsProEditorOpen(false);
          }}
          onNotify={(message, tone) => {
            setStatusBanner({
              tone: tone === 'error' ? 'error' : tone === 'warning' ? 'warn' : 'ok',
              message,
            });
          }}
        />
      )}
    </div>
  );
};
