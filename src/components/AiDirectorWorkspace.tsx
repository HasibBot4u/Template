import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  Film,
  Layers,
  Lock,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sliders,
  Sparkles,
  Unlock,
  Upload,
} from 'lucide-react';
import type {
  AiDirectorSessionRecord,
  BudgetLatencyPreferenceMode,
  DirectorAutonomyMode,
  DirectorShotPlanItem,
  IntendedPlatformId,
  ShotEditableParameters,
} from '../services/aiDirectorProductionEngine';
import type { MobileAspectRatio } from '../types/sowveil';
import { MobileProEditorModal } from './MobileProEditorModal';
import { executeAuthenticatedApiRequest } from '../services/apiClient';

interface SampleScriptItem {
  id: string;
  title: string;
  intendedPlatform: IntendedPlatformId;
  aspectRatio: MobileAspectRatio;
  audience: string;
  visualGoals: string;
  scriptText: string;
}

export interface AiDirectorWorkspaceProps {
  authToken?: string | null;
  userUid?: string;
  onBackToReference: () => void;
  onOpenProjectLibrary?: () => void;
  getAuthToken?: (forceRefresh?: boolean) => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

type DirectorStageTab =
  | 'intake'
  | 'coverage'
  | 'questions'
  | 'brief-plan'
  | 'production'
  | 'refinement-gate';

export const AiDirectorWorkspace: React.FC<AiDirectorWorkspaceProps> = ({
  authToken,
  userUid,
  onBackToReference,
  onOpenProjectLibrary,
  getAuthToken,
  fetchImpl,
}) => {
  const [activeTab, setActiveTab] = useState<DirectorStageTab>('intake');
  const [samples, setSamples] = useState<SampleScriptItem[]>([]);
  const [sessions, setSessions] = useState<AiDirectorSessionRecord[]>([]);
  const [activeSession, setActiveSession] = useState<AiDirectorSessionRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Stage 1: Intake form state
  const [title, setTitle] = useState('Sowveil Studio 2.0 Mobile Motion Launch Reel');
  const [scriptText, setScriptText] = useState('');
  const [intendedPlatform, setIntendedPlatform] =
    useState<IntendedPlatformId>('youtube-shorts');
  const [targetDurationSec, setTargetDurationSec] = useState<number>(30);
  const [aspectRatio, setAspectRatio] = useState<MobileAspectRatio>('9:16');
  const [fps, setFps] = useState<24 | 30 | 60>(60);
  const [language, setLanguage] = useState('en-US');
  const [audience, setAudience] = useState(
    'Mobile motion designers, SaaS founders, and short-form video editors'
  );
  const [visualGoals, setVisualGoals] = useState(
    'High-contrast obsidian & ember kinetic typography, liquid glass SaaS cards, and snappy cubic-bezier transitions.'
  );
  const [brandPrimaryColor, setBrandPrimaryColor] = useState('#F06424');
  const [brandSecondaryColor, setBrandSecondaryColor] = useState('#E4B45A');
  const [brandFontFamily, setBrandFontFamily] = useState('Inter');
  const [budgetLatencyPreference, setBudgetLatencyPreference] =
    useState<BudgetLatencyPreferenceMode>('quality-first-argon');
  const [maxBudgetUsd, setMaxBudgetUsd] = useState<number>(2.5);
  const [preserveEveryRepetition, setPreserveEveryRepetition] = useState(true);
  const [noQuestionsWorkflow, setNoQuestionsWorkflow] = useState(false);
  const [autonomyMode, setAutonomyMode] =
    useState<DirectorAutonomyMode>('require-approval');
  const [mustPreserveInput, setMustPreserveInput] = useState(
    'Sowveil Studio, Alight Motion XML'
  );

  // Stage 3: Questions draft answers
  const [questionDrafts, setQuestionDrafts] = useState<
    Record<string, { answer: string; lockDecision: boolean }>
  >({});

  // Stage 4: Shot plan inline editing
  const [editingShotId, setEditingShotId] = useState<string | null>(null);
  const [shotEditDraft, setShotEditDraft] = useState<Partial<ShotEditableParameters> | null>(
    null
  );
  const [omitReasonDraft, setOmitReasonDraft] = useState<Record<string, string>>({});

  // Stage 5: Production options & timeline modal
  const [simulateFailShotIds] = useState<string[]>([]);
  const [isTimelineModalOpen, setIsTimelineModalOpen] = useState(false);

  const resolveToken = useCallback(
    async (forceRefresh = false) => {
      if (getAuthToken) return await getAuthToken(forceRefresh);
      if (authToken) return authToken;
      return null;
    },
    [getAuthToken, authToken]
  );

  const apiRequest = useCallback(
    async <T,>(
      path: string,
      options: {
        method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        body?: unknown;
      } = {}
    ) => {
      return executeAuthenticatedApiRequest<T>(path, {
        ...options,
        getAuthToken: getAuthToken || authToken ? resolveToken : undefined,
        fetchImpl,
      });
    },
    [resolveToken, getAuthToken, authToken, fetchImpl]
  );

  const fetchSamplesAndSessions = async () => {
    try {
      const fetchFn = fetchImpl || globalThis.fetch;
      const samplesPromise = fetchFn('/api/v1/ai-director/samples')
        .then((r) => r.json())
        .catch(() => null);
      const sessionsPromise = apiRequest<{ items: AiDirectorSessionRecord[] }>(
        '/api/v1/ai-director/sessions'
      );

      const [samplesJson, sessionsRes] = await Promise.all([
        samplesPromise,
        sessionsPromise,
      ]);

      if (samplesJson?.ok && Array.isArray(samplesJson.data?.samples)) {
        const loadedSamples: SampleScriptItem[] = samplesJson.data.samples;
        setSamples(loadedSamples);
        if (!scriptText && loadedSamples.length > 0) {
          const first = loadedSamples[0];
          setTitle(first.title);
          setScriptText(first.scriptText);
          setIntendedPlatform(first.intendedPlatform);
          setAspectRatio(first.aspectRatio);
          setAudience(first.audience);
          setVisualGoals(first.visualGoals);
        }
      }

      if (sessionsRes.ok && sessionsRes.data?.items) {
        const items = sessionsRes.data.items;
        setSessions(items);
        if (!activeSession && items.length > 0) {
          setActiveSession(items[0]);
        }
      }
    } catch {
      // Ignore transient network errors on initial load
    }
  };

  useEffect(() => {
    fetchSamplesAndSessions();
  }, [authToken, userUid]);

  const handleLoadSample = (sample: SampleScriptItem) => {
    setTitle(sample.title);
    setScriptText(sample.scriptText);
    setIntendedPlatform(sample.intendedPlatform);
    setAspectRatio(sample.aspectRatio);
    setAudience(sample.audience);
    setVisualGoals(sample.visualGoals);
    setStatusBanner(`Loaded sample script "${sample.title}" (${sample.scriptText.length} chars).`);
    setErrorBanner(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setScriptText(text);
      if (!title.trim()) {
        setTitle(file.name.replace(/\.[^.]+$/, ''));
      }
      setStatusBanner(`Loaded script file "${file.name}" (${text.length} chars).`);
    } catch {
      setErrorBanner('Failed to read uploaded script file.');
    }
  };

  const handleCreateSession = async () => {
    if (!scriptText.trim()) {
      setErrorBanner('Please paste or upload a script before running AI Director analysis.');
      return;
    }
    setLoading(true);
    setErrorBanner(null);
    setStatusBanner(null);
    try {
      const res = await apiRequest<{ session: AiDirectorSessionRecord }>(
        '/api/v1/ai-director/sessions',
        {
          method: 'POST',
          body: {
            title,
            rawScriptText: scriptText,
            intake: {
              title,
              intendedPlatform,
              targetDurationSec,
              aspectRatio,
              fps,
              language,
              audience,
              visualGoals,
              brandKit: {
                brandName: 'Sowveil Studio',
                primaryColorHex: brandPrimaryColor,
                secondaryColorHex: brandSecondaryColor,
                backgroundColorHex: '#0B0A09',
                headingFont: brandFontFamily,
                bodyFont: brandFontFamily,
              },
              prohibitedContent: mustPreserveInput
                ? [`Must preserve exact phrases: ${mustPreserveInput}`]
                : [],
              budgetLatencyPreference,
              maxBudgetUsd,
              preserveEveryRepetition,
              noQuestionsWorkflow,
              autonomyMode,
            },
          },
        }
      );
      if (!res.ok || !res.data?.session) {
        throw new Error(res.errorMessage || 'Failed to create AI Director session');
      }
      const created: AiDirectorSessionRecord = res.data.session;
      setActiveSession(created);
      setSessions((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
      setStatusBanner(
        `Analyzed ${created.segments.length} offset-exact script segments (${created.coverageLedger.coveragePercent}% planned coverage).`
      );
      setActiveTab('coverage');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerQuestions = async (applyDefaultsToUnanswered: boolean) => {
    if (!activeSession) return;
    setLoading(true);
    setErrorBanner(null);
    try {
      const answersMap: Record<string, { answer: string; lockDecision?: boolean }> = {};
      for (const [qId, val] of Object.entries(questionDrafts)) {
        if (val.answer.trim()) {
          answersMap[qId] = {
            answer: val.answer.trim(),
            lockDecision: val.lockDecision,
          };
        }
      }

      const res = await apiRequest<{ session: AiDirectorSessionRecord }>(
        `/api/v1/ai-director/sessions/${activeSession.id}/questions`,
        {
          method: 'POST',
          body: {
            answers: answersMap,
            applyDefaultsToUnanswered,
          },
        }
      );
      if (!res.ok || !res.data?.session) {
        throw new Error(res.errorMessage || 'Failed to submit question answers');
      }
      const updated: AiDirectorSessionRecord = res.data.session;
      setActiveSession(updated);
      setSessions((prev) => [updated, ...prev.filter((s) => s.id !== updated.id)]);
      setStatusBanner(
        `Clarifications saved (${updated.answeredQuestionFingerprints.length} fingerprints remembered). Production Brief & Shot Plan updated.`
      );
      setActiveTab('brief-plan');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to submit answers');
    } finally {
      setLoading(false);
    }
  };

  const handlePlanMutation = async (
    payload: Record<string, unknown>,
    successMsg: string
  ) => {
    if (!activeSession) return;
    setLoading(true);
    setErrorBanner(null);
    try {
      const res = await apiRequest<{ session: AiDirectorSessionRecord }>(
        `/api/v1/ai-director/sessions/${activeSession.id}/plan`,
        {
          method: 'POST',
          body: payload,
        }
      );
      if (!res.ok || !res.data?.session) {
        throw new Error(res.errorMessage || 'Failed to update shot plan');
      }
      const updated: AiDirectorSessionRecord = res.data.session;
      setActiveSession(updated);
      setSessions((prev) => [updated, ...prev.filter((s) => s.id !== updated.id)]);
      setStatusBanner(successMsg);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Plan update failed');
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteProduction = async () => {
    if (!activeSession) return;
    setLoading(true);
    setErrorBanner(null);
    try {
      const res = await apiRequest<{ session: AiDirectorSessionRecord }>(
        `/api/v1/ai-director/sessions/${activeSession.id}/produce`,
        {
          method: 'POST',
          body: {
            simulateFailedShotIds: simulateFailShotIds,
          },
        }
      );
      if (!res.ok || !res.data?.session) {
        throw new Error(res.errorMessage || 'Production compilation blocked');
      }
      const updated: AiDirectorSessionRecord = res.data.session;
      setActiveSession(updated);
      setSessions((prev) => [updated, ...prev.filter((s) => s.id !== updated.id)]);
      setStatusBanner(
        `Compiled Canonical Project v2.0.0 via ${updated.commandReceipts.length} typed commands. Coverage: ${updated.coverageLedger.coveragePercent}%.`
      );
      setActiveTab('production');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to execute production plan');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToProjectLibrary = async () => {
    if (!activeSession) return;
    setLoading(true);
    setErrorBanner(null);
    try {
      const res = await apiRequest<{
        session: AiDirectorSessionRecord;
        project: { id: string; name: string };
      }>(`/api/v1/ai-director/sessions/${activeSession.id}/save-project`, {
        method: 'POST',
      });
      if (!res.ok || !res.data?.session) {
        throw new Error(res.errorMessage || 'Failed to save to Project Library');
      }
      const updated: AiDirectorSessionRecord = res.data.session;
      setActiveSession(updated);
      setSessions((prev) => [updated, ...prev.filter((s) => s.id !== updated.id)]);
      setStatusBanner(
        `Saved project "${res.data.project.name}" (ID: ${res.data.project.id}) to Project Library.`
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to save project');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyRefinement = async (suggestionId: string) => {
    if (!activeSession) return;
    setLoading(true);
    setErrorBanner(null);
    try {
      const res = await apiRequest<{ session: AiDirectorSessionRecord }>(
        `/api/v1/ai-director/sessions/${activeSession.id}/refine`,
        {
          method: 'POST',
          body: { suggestionId },
        }
      );
      if (!res.ok || !res.data?.session) {
        throw new Error(res.errorMessage || 'Refinement action blocked');
      }
      const updated: AiDirectorSessionRecord = res.data.session;
      setActiveSession(updated);
      setSessions((prev) => [updated, ...prev.filter((s) => s.id !== updated.id)]);
      setStatusBanner('Applied adaptive refinement and saved pre-refinement checkpoint.');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to process refinement');
    } finally {
      setLoading(false);
    }
  };

  const handleRollbackCheckpoint = async (checkpointId: string) => {
    if (!activeSession) return;
    setLoading(true);
    setErrorBanner(null);
    try {
      const res = await apiRequest<{ session: AiDirectorSessionRecord }>(
        `/api/v1/ai-director/sessions/${activeSession.id}/rollback`,
        {
          method: 'POST',
          body: { checkpointId },
        }
      );
      if (!res.ok || !res.data?.session) {
        throw new Error(res.errorMessage || 'Rollback failed');
      }
      const updated: AiDirectorSessionRecord = res.data.session;
      setActiveSession(updated);
      setSessions((prev) => [updated, ...prev.filter((s) => s.id !== updated.id)]);
      setStatusBanner(`Rolled back session to checkpoint ${checkpointId}.`);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Rollback failed');
    } finally {
      setLoading(false);
    }
  };

  const startEditingShot = (shot: DirectorShotPlanItem) => {
    setEditingShotId(shot.shotId);
    setShotEditDraft({
      headlineText: shot.editableParameters.headlineText,
      subheadText: shot.editableParameters.subheadText,
      durationSec: shot.editableParameters.durationSec,
      accentColorHex: shot.editableParameters.accentColorHex,
      cameraMotion: shot.editableParameters.cameraMotion,
      selectedTemplateId: shot.editableParameters.selectedTemplateId,
    });
  };

  const saveShotEdit = async (shotId: string) => {
    if (!shotEditDraft) return;
    await handlePlanMutation(
      {
        action: 'edit-shot',
        shotId,
        editablePatch: shotEditDraft,
      },
      `Updated shot ${shotId} and recorded plan revision.`
    );
    setEditingShotId(null);
    setShotEditDraft(null);
  };

  return (
    <div
      className="min-h-screen bg-[#0B0C0E] text-[#F4F5F8] flex flex-col"
      data-testid="ai-director-workspace"
    >
      {/* Top Header */}
      <header className="border-b border-[#22252D] bg-[#111318] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToReference}
            className="px-3 py-1.5 rounded-lg bg-[#1A1D24] hover:bg-[#242832] border border-[#2C313D] text-xs font-medium text-[#D5D8E0] flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-[#FF6B1A]" />
            Back to Studio
          </button>
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#FF6B1A]" />
              <h1 className="text-sm md:text-base font-semibold tracking-tight text-white">
                Sowveil AI Director — Durable Script-to-Timeline Production Engine
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-[#FF6B1A]/15 text-[#FF6B1A] border border-[#FF6B1A]/30">
                Canonical v2.0.0
              </span>
            </div>
            <p className="text-[11px] text-[#8E95A5]">
              Immutable Script Segmentation · Complete Coverage Ledger · 20-Field Brief · 22-Field Shot Plan · 4-Tier Asset Ranking · Reversible Checkpoints
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {sessions.length > 0 && (
            <select
              aria-label="Select AI Director Session"
              value={activeSession?.id || ''}
              onChange={(e) => {
                const found = sessions.find((s) => s.id === e.target.value);
                if (found) setActiveSession(found);
              }}
              className="px-2.5 py-1.5 rounded-lg bg-[#161920] border border-[#2A2F3C] text-xs text-[#E4E6ED]"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.intake.title} ({s.segments.length} segs · {s.stage})
                </option>
              ))}
            </select>
          )}
          {activeSession?.canonicalProject && (
            <button
              type="button"
              onClick={() => setIsTimelineModalOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-[#FF6B1A] hover:bg-[#FF7B33] text-black font-semibold text-xs flex items-center gap-1.5"
              data-testid="director-open-timeline-btn"
            >
              <Film className="w-3.5 h-3.5" />
              Open Pro Timeline Editor
            </button>
          )}
          {onOpenProjectLibrary && (
            <button
              type="button"
              onClick={onOpenProjectLibrary}
              className="px-3 py-1.5 rounded-lg bg-[#1A1D24] hover:bg-[#242832] border border-[#2C313D] text-xs text-[#D5D8E0]"
            >
              Project Library
            </button>
          )}
        </div>
      </header>

      {/* Stage Navigation Bar */}
      <nav
        aria-label="AI Director State Machine Stages"
        className="border-b border-[#1E2129] bg-[#0E1015] px-4 py-2 flex items-center gap-1.5 overflow-x-auto"
      >
        {(
          [
            { id: 'intake', label: '1. Intake & Script', icon: FileText },
            {
              id: 'coverage',
              label: `2. Coverage & Analysis (${activeSession ? `${activeSession.coverageLedger.coveragePercent}%` : '—'})`,
              icon: Layers,
            },
            {
              id: 'questions',
              label: `3. Questions & Assumptions (${activeSession ? activeSession.questions.length : 0})`,
              icon: Sliders,
            },
            {
              id: 'brief-plan',
              label: `4. Brief, Shot Plan & Assets (${activeSession ? activeSession.shots.length : 0})`,
              icon: Film,
            },
            {
              id: 'production',
              label: `5. Production & Traceability (${activeSession?.canonicalProject ? 'Compiled' : 'Pending'})`,
              icon: Play,
            },
            {
              id: 'refinement-gate',
              label: `6. Refinement, Rollback & Gate (${
                activeSession?.acceptanceGate
                  ? activeSession.acceptanceGate.passed
                    ? 'PASSED'
                    : 'ATTN'
                  : '—'
              })`,
              icon: ShieldCheck,
            },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              data-testid={`director-stage-tab-${tab.id}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex items-center gap-1.5 transition-colors ${
                isActive
                  ? 'bg-[#FF6B1A] text-black font-semibold'
                  : 'bg-[#161920] text-[#A2A8B8] hover:text-white hover:bg-[#1E222B] border border-[#252A35]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Status / Error Alerts */}
      {errorBanner && (
        <div
          role="alert"
          className="mx-4 mt-3 px-3.5 py-2.5 rounded-lg bg-red-950/60 border border-red-500/40 text-xs text-red-200 flex items-center justify-between"
        >
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-red-300 hover:text-white ml-4"
          >
            Dismiss
          </button>
        </div>
      )}
      {statusBanner && (
        <div
          role="status"
          className="mx-4 mt-3 px-3.5 py-2.5 rounded-lg bg-emerald-950/50 border border-emerald-500/40 text-xs text-emerald-200 flex items-center justify-between"
        >
          <span>{statusBanner}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-emerald-300 hover:text-white ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Stage Content */}
      <main className="flex-1 p-4 max-w-7xl w-full mx-auto space-y-4">
        {/* ================================================================
            STAGE 1: INTAKE & SCRIPT
           ================================================================ */}
        {activeTab === 'intake' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-[#12141A] border border-[#222631] rounded-xl p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Script Input & Immutable Source Preservation
                  </h2>
                  <p className="text-xs text-[#8E95A5]">
                    Paste your script, upload a text/document file, or load a preset. Every paragraph, sentence, line, and deliberate repetition is preserved with exact character offsets.
                  </p>
                </div>
                <label className="px-3 py-1.5 rounded-lg bg-[#1B1F29] hover:bg-[#252A37] border border-[#2F3646] text-xs text-[#D5D8E0] cursor-pointer flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5 text-[#FF6B1A]" />
                  Upload Script (.txt/.md/.srt)
                  <input
                    type="file"
                    accept=".txt,.md,.srt,.json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Sample Script Presets */}
              {samples.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-[#8E95A5]">
                    Built-in Production Script Presets:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {samples.map((sample) => (
                      <button
                        key={sample.id}
                        type="button"
                        onClick={() => handleLoadSample(sample)}
                        className="px-2.5 py-1 rounded-md bg-[#181B24] hover:bg-[#222734] border border-[#2C3242] text-xs text-[#D5D8E0]"
                      >
                        {sample.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#B8BECB] mb-1">
                  Production Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  data-testid="director-title-input"
                  className="w-full px-3 py-2 rounded-lg bg-[#0D0F14] border border-[#262B38] text-xs text-white"
                  placeholder="Enter production title..."
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-[#B8BECB]">
                    Original Script Text (Preserved Immutably with SHA-256 Checksum)
                  </label>
                  <span className="text-[11px] text-[#8E95A5]">
                    {scriptText.length} characters ·{' '}
                    {scriptText.trim() ? scriptText.trim().split(/\s+/).length : 0} words
                  </span>
                </div>
                <textarea
                  rows={10}
                  value={scriptText}
                  onChange={(e) => setScriptText(e.target.value)}
                  data-testid="director-script-textarea"
                  className="w-full px-3 py-2.5 rounded-lg bg-[#0D0F14] border border-[#262B38] text-xs text-[#E8EAF0] font-mono leading-relaxed"
                  placeholder="Paste full script here..."
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#20242F]">
                <div className="flex flex-wrap items-center gap-4 text-xs text-[#B8BECB]">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preserveEveryRepetition}
                      onChange={(e) => setPreserveEveryRepetition(e.target.checked)}
                    />
                    Preserve Repeated Lines & Refrains
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={noQuestionsWorkflow}
                      onChange={(e) => setNoQuestionsWorkflow(e.target.checked)}
                      data-testid="director-no-questions-checkbox"
                    />
                    Proceed Without Questions (Record Assumptions)
                  </label>
                </div>

                <button
                  type="button"
                  disabled={loading}
                  onClick={handleCreateSession}
                  data-testid="director-analyze-script-btn"
                  className="px-4 py-2 rounded-lg bg-[#FF6B1A] hover:bg-[#FF7B33] disabled:opacity-50 text-black font-semibold text-xs flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  {loading ? 'Analyzing Script...' : 'Analyze Script & Build Shot Plan'}
                </button>
              </div>
            </div>

            {/* Right Column: Production Parameters & Defaults */}
            <div className="bg-[#12141A] border border-[#222631] rounded-xl p-4 space-y-3">
              <h2 className="text-sm font-semibold text-white">
                Production Context & Sensible Defaults
              </h2>
              <p className="text-[11px] text-[#8E95A5]">
                Optional fields automatically receive safe production defaults and are tracked in the session ledger.
              </p>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-[#A2A8B8] mb-1">Aspect Ratio</label>
                  <select
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value as MobileAspectRatio)}
                    className="w-full px-2.5 py-1.5 rounded bg-[#0D0F14] border border-[#262B38] text-xs text-white"
                  >
                    <option value="9:16">9:16 Vertical (1080×1920)</option>
                    <option value="16:9">16:9 Landscape (1920×1080)</option>
                    <option value="1:1">1:1 Square (1080×1080)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-[#A2A8B8] mb-1">Frame Rate</label>
                  <select
                    value={fps}
                    onChange={(e) => setFps(Number(e.target.value) as 24 | 30 | 60)}
                    className="w-full px-2.5 py-1.5 rounded bg-[#0D0F14] border border-[#262B38] text-xs text-white"
                  >
                    <option value={24}>24 fps (Cinematic)</option>
                    <option value={30}>30 fps (Social Standard)</option>
                    <option value={60}>60 fps (High Motion)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-[#A2A8B8] mb-1">
                    Target Duration (sec)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={600}
                    value={targetDurationSec}
                    onChange={(e) => setTargetDurationSec(Number(e.target.value) || 30)}
                    className="w-full px-2.5 py-1.5 rounded bg-[#0D0F14] border border-[#262B38] text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#A2A8B8] mb-1">Language</label>
                  <input
                    type="text"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded bg-[#0D0F14] border border-[#262B38] text-xs text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-[#A2A8B8] mb-1">Intended Platform</label>
                <select
                  value={intendedPlatform}
                  onChange={(e) => setIntendedPlatform(e.target.value as IntendedPlatformId)}
                  className="w-full px-2.5 py-1.5 rounded bg-[#0D0F14] border border-[#262B38] text-xs text-white"
                >
                  <option value="youtube-shorts">YouTube Shorts</option>
                  <option value="instagram-reels">Instagram Reels</option>
                  <option value="tiktok">TikTok</option>
                  <option value="youtube-longform">YouTube Longform</option>
                  <option value="linkedin-saas">LinkedIn SaaS</option>
                  <option value="product-launch">Product Launch</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-[#A2A8B8] mb-1">Target Audience</label>
                <input
                  type="text"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded bg-[#0D0F14] border border-[#262B38] text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[#A2A8B8] mb-1">Visual Goals</label>
                <textarea
                  rows={2}
                  value={visualGoals}
                  onChange={(e) => setVisualGoals(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded bg-[#0D0F14] border border-[#262B38] text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] text-[#A2A8B8] mb-1">Brand Accent</label>
                  <input
                    type="text"
                    value={brandPrimaryColor}
                    onChange={(e) => setBrandPrimaryColor(e.target.value)}
                    className="w-full px-2 py-1 rounded bg-[#0D0F14] border border-[#262B38] text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#A2A8B8] mb-1">Secondary Hex</label>
                  <input
                    type="text"
                    value={brandSecondaryColor}
                    onChange={(e) => setBrandSecondaryColor(e.target.value)}
                    className="w-full px-2 py-1 rounded bg-[#0D0F14] border border-[#262B38] text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#A2A8B8] mb-1">Font Family</label>
                  <input
                    type="text"
                    value={brandFontFamily}
                    onChange={(e) => setBrandFontFamily(e.target.value)}
                    className="w-full px-2 py-1 rounded bg-[#0D0F14] border border-[#262B38] text-xs text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] text-[#A2A8B8] mb-1">Autonomy Policy</label>
                  <select
                    value={autonomyMode}
                    onChange={(e) =>
                      setAutonomyMode(e.target.value as DirectorAutonomyMode)
                    }
                    className="w-full px-2 py-1.5 rounded bg-[#0D0F14] border border-[#262B38] text-xs text-white"
                  >
                    <option value="require-approval">Require Plan Approval</option>
                    <option value="bounded-autonomy">Bounded Autonomy</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-[#A2A8B8] mb-1">Model Routing</label>
                  <select
                    value={budgetLatencyPreference}
                    onChange={(e) =>
                      setBudgetLatencyPreference(
                        e.target.value as BudgetLatencyPreferenceMode
                      )
                    }
                    className="w-full px-2 py-1.5 rounded bg-[#0D0F14] border border-[#262B38] text-xs text-white"
                  >
                    <option value="quality-first-argon">Argon Quality</option>
                    <option value="balanced">Balanced</option>
                    <option value="low-cost-fast-flash">Flash Fast</option>
                    <option value="strict-budget-cap">Strict Budget</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-[#A2A8B8] mb-1">
                    Budget Cap (USD)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min={0.5}
                    value={maxBudgetUsd}
                    onChange={(e) => setMaxBudgetUsd(Number(e.target.value) || 2.5)}
                    className="w-full px-2 py-1.5 rounded bg-[#0D0F14] border border-[#262B38] text-xs text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-[#A2A8B8] mb-1">
                  Must-Preserve Phrases / Brand Entities
                </label>
                <input
                  type="text"
                  value={mustPreserveInput}
                  onChange={(e) => setMustPreserveInput(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded bg-[#0D0F14] border border-[#262B38] text-xs text-white"
                />
              </div>
            </div>
          </div>
        )}

        {/* ================================================================
            STAGE 2: COVERAGE LEDGER & SEMANTIC ANALYSIS
           ================================================================ */}
        {activeTab === 'coverage' && activeSession && (
          <div className="space-y-4" data-testid="director-coverage-panel">
            {/* Summary Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <div className="bg-[#12141A] border border-[#222631] rounded-xl p-3">
                <div className="text-[11px] text-[#8E95A5]">Total Segments</div>
                <div className="text-lg font-bold text-white">
                  {activeSession.coverageLedger.totalSegments}
                </div>
                <div className="text-[10px] text-[#8E95A5]">
                  {activeSession.analysisReport.chunkCountProcessed} chunk(s) reconciled
                </div>
              </div>
              <div className="bg-[#12141A] border border-[#222631] rounded-xl p-3">
                <div className="text-[11px] text-[#8E95A5]">Coverage Rate</div>
                <div className="text-lg font-bold text-[#FF6B1A]">
                  {activeSession.coverageLedger.coveragePercent}%
                </div>
                <div className="text-[10px] text-emerald-400">
                  {activeSession.coverageLedger.isReadyForProduction
                    ? '100% Accounted For'
                    : `${activeSession.coverageLedger.uncoveredSegments} Uncovered`}
                </div>
              </div>
              <div className="bg-[#12141A] border border-[#222631] rounded-xl p-3">
                <div className="text-[11px] text-[#8E95A5]">Planned / Produced</div>
                <div className="text-lg font-bold text-white">
                  {activeSession.coverageLedger.plannedSegments} /{' '}
                  {activeSession.coverageLedger.producedSegments}
                </div>
                <div className="text-[10px] text-[#8E95A5]">Shots mapped</div>
              </div>
              <div className="bg-[#12141A] border border-[#222631] rounded-xl p-3">
                <div className="text-[11px] text-[#8E95A5]">User-Approved Omissions</div>
                <div className="text-lg font-bold text-amber-400">
                  {activeSession.coverageLedger.omittedWithApprovalSegments}
                </div>
                <div className="text-[10px] text-[#8E95A5]">Explicitly recorded</div>
              </div>
              <div className="bg-[#12141A] border border-[#222631] rounded-xl p-3">
                <div className="text-[11px] text-[#8E95A5]">Repetition Groups</div>
                <div className="text-lg font-bold text-white">
                  {activeSession.analysisReport.meaningfulRepetitions.length}
                </div>
                <div className="text-[10px] text-[#8E95A5]">Preserved without collapse</div>
              </div>
              <div className="bg-[#12141A] border border-[#222631] rounded-xl p-3">
                <div className="text-[11px] text-[#8E95A5]">Immutable SHA-256</div>
                <div
                  className="text-xs font-mono text-[#D5D8E0] truncate mt-1"
                  title={activeSession.analysisReport.originalScriptSha256}
                >
                  {activeSession.analysisReport.originalScriptSha256.slice(0, 16)}…
                </div>
                <div className="text-[10px] text-[#8E95A5]">
                  {activeSession.originalScriptText.length} chars exact
                </div>
              </div>
            </div>

            {/* Semantic Extraction Summary */}
            <div className="bg-[#12141A] border border-[#222631] rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <h3 className="text-xs font-semibold text-[#FF6B1A] uppercase tracking-wider mb-1.5">
                  Core Claims & Key Concepts
                </h3>
                <ul className="space-y-1 text-xs text-[#D5D8E0]">
                  {activeSession.analysisReport.coreClaims.slice(0, 4).map((c) => (
                    <li key={c.segmentId} className="truncate">
                      • {c.claim}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-1 mt-2">
                  {activeSession.analysisReport.keyConcepts.slice(0, 8).map((kw) => (
                    <span
                      key={kw}
                      className="px-2 py-0.5 rounded bg-[#1C202B] text-[10px] text-[#B8BECB]"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-[#FF6B1A] uppercase tracking-wider mb-1.5">
                  Named Entities & Must-Preserve Phrases
                </h3>
                <div className="flex flex-wrap gap-1 mb-2">
                  {activeSession.analysisReport.namedEntities.map((ent) => (
                    <span
                      key={ent}
                      className="px-2 py-0.5 rounded bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 text-[10px] text-[#FF6B1A]"
                    >
                      {ent}
                    </span>
                  ))}
                </div>
                <div className="text-[11px] text-[#8E95A5]">
                  Must-Preserve Exact Phrases:{' '}
                  {activeSession.analysisReport.mustPreservePhrases.length > 0
                    ? activeSession.analysisReport.mustPreservePhrases
                        .map((p) => p.phrase)
                        .join(' | ')
                    : 'None quoted'}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-[#FF6B1A] uppercase tracking-wider mb-1.5">
                  Tone, Analyzer Model & Defaulted Fields
                </h3>
                <p className="text-xs text-[#D5D8E0] mb-1">
                  Tone:{' '}
                  <span className="font-medium">{activeSession.analysisReport.overallTone}</span>
                </p>
                <p className="text-[11px] text-[#8E95A5] mb-1">
                  Analyzer: <span className="font-mono text-white">{activeSession.analysisReport.analyzerModelUsed}</span>
                </p>
                <p className="text-[11px] text-[#8E95A5]">
                  Defaulted Intake Fields:{' '}
                  {activeSession.intake.defaultedFields.length > 0
                    ? activeSession.intake.defaultedFields.join(', ')
                    : 'All explicitly provided'}
                </p>
              </div>
            </div>

            {/* Offset-Exact Script Segment Table */}
            <div className="bg-[#12141A] border border-[#222631] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#222631] flex items-center justify-between">
                <h3 className="text-xs font-semibold text-white">
                  Offset-Exact Script Segmentation & Coverage Ledger ({activeSession.segments.length} segments)
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveTab('brief-plan')}
                  className="px-3 py-1 rounded bg-[#FF6B1A] text-black font-semibold text-xs"
                >
                  Proceed to Shot Plan →
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#222631] bg-[#0E1015] text-[11px] text-[#8E95A5]">
                      <th className="py-2 px-3">Segment ID</th>
                      <th className="py-2 px-3">Offsets</th>
                      <th className="py-2 px-3">Role / Emotion</th>
                      <th className="py-2 px-3">Exact Source Passage</th>
                      <th className="py-2 px-3">Shot / Clips</th>
                      <th className="py-2 px-3">Coverage Status</th>
                      <th className="py-2 px-3">Explicit Omission Control</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1C2029]">
                    {activeSession.segments.map((seg) => (
                      <tr key={seg.segmentId} className="hover:bg-[#161922]">
                        <td className="py-2.5 px-3 font-mono text-[11px] text-[#FF6B1A]">
                          {seg.segmentId}
                          {seg.isRepetitionOfSegmentId && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-purple-950/80 border border-purple-500/40 text-[9px] text-purple-200">
                              Repeat of {seg.isRepetitionOfSegmentId}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-[#8E95A5]">
                          [{seg.startOffset}..{seg.endOffset}]
                          <div className="text-[10px]">
                            P{seg.paragraphIndex + 1} · {seg.estimatedDurationSec}s
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="uppercase text-[10px] font-semibold px-2 py-0.5 rounded bg-[#1E222D] text-[#D5D8E0]">
                            {seg.kind}
                          </span>
                          <div className="text-[10px] text-[#8E95A5] mt-1">
                            {seg.emotionalTone.trim()}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 max-w-md text-[#E8EAF0] font-mono text-[11px]">
                          {seg.exactOriginalText}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-[#B8BECB]">
                          <div>Shots: {seg.plannedShotIds.join(', ') || '—'}</div>
                          {seg.timelineClipIds.length > 0 && (
                            <div className="text-emerald-400 text-[10px]">
                              Clips: {seg.timelineClipIds.length}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              seg.status === 'produced-on-timeline'
                                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
                                : seg.status === 'planned'
                                ? 'bg-blue-950/80 text-blue-300 border border-blue-500/30'
                                : seg.status === 'omitted-by-user-approval'
                                ? 'bg-amber-950/80 text-amber-300 border border-amber-500/30'
                                : 'bg-red-950/80 text-red-300 border border-red-500/30'
                            }`}
                          >
                            {seg.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          {seg.status === 'omitted-by-user-approval' ? (
                            <span className="text-[10px] text-amber-300">
                              Omitted ({seg.omissionReason})
                            </span>
                          ) : (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                placeholder="Reason to omit..."
                                value={omitReasonDraft[seg.segmentId] || ''}
                                onChange={(e) =>
                                  setOmitReasonDraft((prev) => ({
                                    ...prev,
                                    [seg.segmentId]: e.target.value,
                                  }))
                                }
                                className="px-2 py-1 rounded bg-[#0D0F14] border border-[#262B38] text-[10px] text-white w-28"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  handlePlanMutation(
                                    {
                                      action: 'omit-segment-with-consent',
                                      segmentIdToOmit: seg.segmentId,
                                      omissionReason:
                                        omitReasonDraft[seg.segmentId] ||
                                        'Explicitly omitted by user in coverage review',
                                    },
                                    `Omitted segment ${seg.segmentId} with explicit user approval.`
                                  )
                                }
                                className="px-2 py-1 rounded bg-amber-950/60 hover:bg-amber-900/70 border border-amber-500/30 text-[10px] text-amber-200"
                              >
                                Omit
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================
            STAGE 3: CLARIFICATION QUESTIONS & UNCERTAINTY CLASSIFICATION
           ================================================================ */}
        {activeTab === 'questions' && activeSession && (
          <div className="space-y-4" data-testid="director-questions-panel">
            <div className="bg-[#12141A] border border-[#222631] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Targeted Clarification Questions & Uncertainty Classification
                </h2>
                <p className="text-xs text-[#8E95A5]">
                  Uncertainties are classified as <span className="text-red-300">blocking</span>,{' '}
                  <span className="text-amber-300">important</span>,{' '}
                  <span className="text-blue-300">optional</span>, or{' '}
                  <span className="text-emerald-300">assumed</span>. Answered question fingerprints ({activeSession.answeredQuestionFingerprints.length}) are remembered and never re-asked.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleAnswerQuestions(true)}
                  data-testid="director-submit-questions-btn"
                  className="px-3.5 py-2 rounded-lg bg-[#FF6B1A] hover:bg-[#FF7B33] text-black font-semibold text-xs"
                >
                  Save Answers & Proceed with Defaults for Unanswered →
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeSession.questions.map((q) => {
                const draft = questionDrafts[q.id] || {
                  answer: q.selectedAnswer || '',
                  lockDecision: q.lockedByUser,
                };
                return (
                  <div
                    key={q.id}
                    className="bg-[#12141A] border border-[#222631] rounded-xl p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          q.classification === 'blocking'
                            ? 'bg-red-950/80 text-red-300 border border-red-500/40'
                            : q.classification === 'important'
                            ? 'bg-amber-950/80 text-amber-300 border border-amber-500/40'
                            : q.classification === 'optional'
                            ? 'bg-blue-950/80 text-blue-300 border border-blue-500/40'
                            : 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/40'
                        }`}
                      >
                        {q.classification} · {q.status}
                      </span>
                      <span className="text-[11px] font-mono text-[#8E95A5]">
                        {q.category}
                      </span>
                    </div>

                    <p className="text-xs font-medium text-white">{q.questionText}</p>
                    <p className="text-[11px] text-[#8E95A5]">{q.whyItMatters}</p>

                    <div className="flex flex-wrap gap-1.5">
                      {q.options.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() =>
                            setQuestionDrafts((prev) => ({
                              ...prev,
                              [q.id]: {
                                answer: opt,
                                lockDecision: prev[q.id]?.lockDecision ?? true,
                              },
                            }))
                          }
                          className={`px-2.5 py-1 rounded text-[11px] border ${
                            draft.answer === opt
                              ? 'bg-[#FF6B1A]/20 border-[#FF6B1A] text-white font-medium'
                              : 'bg-[#171A22] border-[#272C3A] text-[#B8BECB] hover:text-white'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={draft.answer}
                        onChange={(e) =>
                          setQuestionDrafts((prev) => ({
                            ...prev,
                            [q.id]: {
                              answer: e.target.value,
                              lockDecision: prev[q.id]?.lockDecision ?? false,
                            },
                          }))
                        }
                        placeholder={`Default: ${q.recommendedDefault}`}
                        className="flex-1 px-2.5 py-1.5 rounded bg-[#0D0F14] border border-[#262B38] text-xs text-white"
                      />
                      <label className="flex items-center gap-1 text-[11px] text-[#B8BECB] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={draft.lockDecision}
                          onChange={(e) =>
                            setQuestionDrafts((prev) => ({
                              ...prev,
                              [q.id]: {
                                answer: prev[q.id]?.answer || q.recommendedDefault,
                                lockDecision: e.target.checked,
                              },
                            }))
                          }
                        />
                        Lock
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================================================================
            STAGE 4: 20-FIELD PRODUCTION BRIEF & 22-FIELD SHOT PLAN
           ================================================================ */}
        {activeTab === 'brief-plan' && activeSession && (
          <div className="space-y-4" data-testid="director-brief-plan-panel">
            {/* 20-Field Production Brief */}
            <div className="bg-[#12141A] border border-[#222631] rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Production Brief (20 Canonical Fields) · Revisions: {activeSession.planRevisions.length}
                  </h2>
                  <p className="text-xs text-[#8E95A5]">
                    Goal: {activeSession.productionBrief.productionGoal}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() =>
                      handlePlanMutation(
                        { action: 'approve-all' },
                        'Approved whole production plan across all active shots.'
                      )
                    }
                    data-testid="director-approve-whole-plan-btn"
                    className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-xs flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Approve Whole Plan
                  </button>

                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleExecuteProduction}
                    data-testid="director-execute-production-btn"
                    className="px-3.5 py-1.5 rounded-lg bg-[#FF6B1A] hover:bg-[#FF7B33] text-black font-semibold text-xs flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Execute Production & Compile Timeline →
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-xs">
                <div className="p-2.5 rounded bg-[#0E1015] border border-[#1E222D]">
                  <span className="text-[10px] text-[#8E95A5] block">Audience & Style</span>
                  <span className="text-white font-medium">
                    {activeSession.productionBrief.targetAudience}
                  </span>
                  <span className="block text-[10px] text-[#FF6B1A] truncate">
                    {activeSession.productionBrief.visualStyle}
                  </span>
                </div>
                <div className="p-2.5 rounded bg-[#0E1015] border border-[#1E222D]">
                  <span className="text-[10px] text-[#8E95A5] block">Target Spec & Runtime</span>
                  <span className="text-white font-medium">
                    {activeSession.productionBrief.aspectRatio} @{' '}
                    {activeSession.productionBrief.frameRate}fps
                  </span>
                  <span className="block text-[10px] text-[#8E95A5]">
                    Planned Runtime: {activeSession.productionBrief.runtimeSec}s
                  </span>
                </div>
                <div className="p-2.5 rounded bg-[#0E1015] border border-[#1E222D]">
                  <span className="text-[10px] text-[#8E95A5] block">Typography & Palette</span>
                  <span className="text-white font-medium">
                    {activeSession.productionBrief.typographySpec.headingFont}
                  </span>
                  <span className="block text-[10px] text-[#8E95A5] font-mono">
                    {activeSession.productionBrief.colorPalette.primaryHex} ·{' '}
                    {activeSession.productionBrief.colorPalette.secondaryHex}
                  </span>
                </div>
                <div className="p-2.5 rounded bg-[#0E1015] border border-[#1E222D]">
                  <span className="text-[10px] text-[#8E95A5] block">Pacing & Caption Policy</span>
                  <span className="text-white font-medium">
                    {activeSession.productionBrief.pacingProfile}
                  </span>
                  <span className="block text-[10px] text-[#8E95A5] truncate">
                    {activeSession.productionBrief.captionsPolicy}
                  </span>
                </div>
              </div>

              {activeSession.productionBrief.deliverablesAndRestrictions.recordedAssumptions
                .length > 0 && (
                <div className="p-2.5 rounded bg-amber-950/30 border border-amber-500/30 text-[11px] text-amber-200">
                  <span className="font-semibold">Recorded Assumptions: </span>
                  {activeSession.productionBrief.deliverablesAndRestrictions.recordedAssumptions.join(
                    ' · '
                  )}
                </div>
              )}
            </div>

            {/* 22-Field Shot-by-Shot Plan */}
            <div className="space-y-3">
              {activeSession.shots.map((shot) => {
                const isEditing = editingShotId === shot.shotId;
                return (
                  <div
                    key={shot.shotId}
                    data-testid={`director-shot-card-${shot.shotId}`}
                    className="bg-[#12141A] border border-[#222631] rounded-xl p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-[#FF6B1A]/20 text-[#FF6B1A] font-mono text-xs font-semibold">
                          {shot.shotId}
                        </span>
                        <span className="text-xs font-semibold text-white">
                          {shot.editableParameters.headlineText}
                        </span>
                        <span className="text-[11px] font-mono text-[#8E95A5]">
                          [{shot.startTimeSec}s · {shot.estimatedDurationSec}s]
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            shot.approvalState === 'approved' || shot.approvalState === 'locked'
                              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
                              : shot.approvalState === 'rejected'
                              ? 'bg-red-950/80 text-red-300 border border-red-500/30'
                              : 'bg-amber-950/80 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {shot.approvalState}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            handlePlanMutation(
                              { action: 'approve-selected', shotIds: [shot.shotId] },
                              `Approved shot ${shot.shotId}.`
                            )
                          }
                          className="px-2.5 py-1 rounded bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-500/30 text-[11px] text-emerald-200"
                        >
                          Approve Shot
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handlePlanMutation(
                              {
                                action: 'lock-shot',
                                shotId: shot.shotId,
                                lockFields: [
                                  'durationSec',
                                  'headlineText',
                                  'selectedTemplateId',
                                  'cameraMotion',
                                ],
                              },
                              `Locked shot ${shot.shotId} against autonomous overwrites.`
                            )
                          }
                          className="px-2.5 py-1 rounded bg-[#1B1F2A] hover:bg-[#252B3A] border border-[#2E3546] text-[11px] text-[#D5D8E0] flex items-center gap-1"
                        >
                          {shot.lockedFields.length > 0 ? (
                            <>
                              <Lock className="w-3 h-3 text-[#FF6B1A]" />
                              Locked ({shot.lockedFields.length})
                            </>
                          ) : (
                            <>
                              <Unlock className="w-3 h-3" />
                              Lock Shot Fields
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handlePlanMutation(
                              {
                                action: 'reject-or-switch-alternative',
                                shotId: shot.shotId,
                              },
                              `Switched ${shot.shotId} to alternative/fallback template.`
                            )
                          }
                          className="px-2.5 py-1 rounded bg-[#1B1F2A] hover:bg-[#252B3A] border border-[#2E3546] text-[11px] text-[#D5D8E0]"
                        >
                          Switch Alternative
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            isEditing ? setEditingShotId(null) : startEditingShot(shot)
                          }
                          className="px-2.5 py-1 rounded bg-[#1B1F2A] hover:bg-[#252B3A] border border-[#2E3546] text-[11px] text-[#D5D8E0]"
                        >
                          {isEditing ? 'Cancel Edit' : 'Edit Shot'}
                        </button>
                      </div>
                    </div>

                    {/* Inline Shot Edit Form */}
                    {isEditing && shotEditDraft && (
                      <div className="p-3 rounded-lg bg-[#0D0F14] border border-[#2B3140] grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
                        <div>
                          <label className="block text-[10px] text-[#8E95A5] mb-1">
                            Headline Text
                          </label>
                          <input
                            type="text"
                            value={shotEditDraft.headlineText || ''}
                            onChange={(e) =>
                              setShotEditDraft({
                                ...shotEditDraft,
                                headlineText: e.target.value,
                              })
                            }
                            className="w-full px-2 py-1 rounded bg-[#141720] border border-[#2B3140] text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-[#8E95A5] mb-1">
                            Duration (sec)
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min={1.0}
                            value={shotEditDraft.durationSec || 3}
                            onChange={(e) =>
                              setShotEditDraft({
                                ...shotEditDraft,
                                durationSec: Number(e.target.value) || 3,
                              })
                            }
                            className="w-full px-2 py-1 rounded bg-[#141720] border border-[#2B3140] text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-[#8E95A5] mb-1">
                            Accent Color Hex
                          </label>
                          <input
                            type="text"
                            value={shotEditDraft.accentColorHex || '#F06424'}
                            onChange={(e) =>
                              setShotEditDraft({
                                ...shotEditDraft,
                                accentColorHex: e.target.value,
                              })
                            }
                            className="w-full px-2 py-1 rounded bg-[#141720] border border-[#2B3140] text-white font-mono"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-[10px] text-[#8E95A5] mb-1">
                            Subhead / Caption Text
                          </label>
                          <input
                            type="text"
                            value={shotEditDraft.subheadText || ''}
                            onChange={(e) =>
                              setShotEditDraft({
                                ...shotEditDraft,
                                subheadText: e.target.value,
                              })
                            }
                            className="w-full px-2 py-1 rounded bg-[#141720] border border-[#2B3140] text-white"
                          />
                        </div>
                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => saveShotEdit(shot.shotId)}
                            className="w-full px-3 py-1.5 rounded bg-[#FF6B1A] text-black font-semibold text-xs"
                          >
                            Save Shot Changes
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Shot Details & 4-Tier Asset Candidate Switcher */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <div className="space-y-1">
                        <div className="text-[11px] text-[#8E95A5]">
                          Source Segment:{' '}
                          <span className="text-white font-mono">
                            {shot.scriptSegmentIds.join(', ')} [{shot.characterStartOffset}..
                            {shot.characterEndOffset}]
                          </span>
                        </div>
                        <div className="text-[#D5D8E0] font-mono text-[11px] bg-[#0D0F14] p-2 rounded border border-[#1E222D]">
                          “{shot.exactTextCoverage}”
                        </div>
                        <div className="text-[10px] text-[#8E95A5]">
                          Framing: {shot.compositionFramingCameraMovement.framing} · Camera:{' '}
                          {shot.editableParameters.cameraMotion} · Transition:{' '}
                          {shot.transitionInOut.transitionIn} → {shot.transitionInOut.transitionOut}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="text-[11px] text-[#8E95A5]">
                          Selected Sowveil Template:{' '}
                          <span className="text-[#FF6B1A] font-mono">
                            {shot.editableParameters.selectedTemplateId}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#B8BECB]">{shot.subjectAndAction}</p>
                        <div className="text-[10px] text-emerald-300">
                          Fallback: {shot.fallbackApproach.strategyName} (
                          {shot.fallbackApproach.fallbackTemplateId})
                        </div>
                      </div>

                      {/* 4-Tier Asset Ranking Switcher */}
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-medium text-[#B8BECB]">
                          4-Tier Asset Candidates (
                          {shot.assetsRequiredAndPreferredSource.rankedCandidates.length})
                        </div>
                        <div className="space-y-1">
                          {shot.assetsRequiredAndPreferredSource.rankedCandidates.map((cand) => {
                            const isSelected =
                              cand.catalogItemId === shot.editableParameters.selectedTemplateId ||
                              cand.candidateId ===
                                shot.assetsRequiredAndPreferredSource.selectedCandidateId;
                            return (
                              <div
                                key={cand.candidateId}
                                className={`w-full text-left px-2.5 py-1.5 rounded border text-[11px] flex items-center justify-between ${
                                  isSelected
                                    ? 'bg-[#FF6B1A]/15 border-[#FF6B1A] text-white'
                                    : 'bg-[#0E1015] border-[#222631] text-[#A2A8B8]'
                                }`}
                              >
                                <span className="truncate">
                                  <strong className="text-[#FF6B1A]">T{cand.tierRank}</strong> ·{' '}
                                  {cand.title}
                                </span>
                                <span className="text-[10px] font-mono ml-2">
                                  {cand.motionDesignSuitabilityScore}pts
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================================================================
            STAGE 5: PRODUCTION EXECUTION & 4-WAY TRACEABILITY
           ================================================================ */}
        {activeTab === 'production' && activeSession && (
          <div className="space-y-4" data-testid="director-production-panel">
            <div className="bg-[#12141A] border border-[#222631] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Canonical Project (v2.0.0) Compilation & 4-Way Traceability
                </h2>
                <p className="text-xs text-[#8E95A5]">
                  All timeline edits execute through typed Canonical Project Command services (`instantiateTemplate`, `createClip`, `addMarker`) with full provenance and per-shot dependency failure isolation.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleExecuteProduction}
                  className="px-3.5 py-1.5 rounded-lg bg-[#FF6B1A] hover:bg-[#FF7B33] text-black font-semibold text-xs flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {activeSession.canonicalProject ? 'Re-Compile Timeline' : 'Compile Timeline Now'}
                </button>
                {activeSession.canonicalProject && (
                  <>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={handleSaveToProjectLibrary}
                      data-testid="director-save-project-btn"
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-xs flex items-center gap-1.5"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Save to Project Library
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsTimelineModalOpen(true)}
                      className="px-3.5 py-1.5 rounded-lg bg-[#1C202B] hover:bg-[#262B3A] border border-[#31384A] text-white text-xs flex items-center gap-1.5"
                    >
                      <Film className="w-3.5 h-3.5 text-[#FF6B1A]" />
                      Inspect in Pro Timeline Editor
                    </button>
                  </>
                )}
              </div>
            </div>

            {activeSession.canonicalProject ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* 4-Way Traceability Matrix */}
                <div className="bg-[#12141A] border border-[#222631] rounded-xl p-4 space-y-3">
                  <h3 className="text-xs font-semibold text-[#FF6B1A] uppercase tracking-wider">
                    4-Way Traceability Ledger (Script ↔ Shot ↔ Template/Asset ↔ Timeline Clips)
                  </h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {activeSession.shots.map((shot) => {
                      const clipIds =
                        activeSession.traceability.shotToTimelineClipsMap[shot.shotId] || [];
                      const assetIds =
                        activeSession.traceability.shotToAssetsMap[shot.shotId] || [];
                      const tplId =
                        activeSession.traceability.shotToTemplateMap[shot.shotId] || '—';
                      return (
                        <div
                          key={shot.shotId}
                          className="p-2.5 rounded bg-[#0E1015] border border-[#1E222D] text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-semibold text-white">
                              {shot.shotId} ← {shot.scriptSegmentIds.join(', ')}
                            </span>
                            <span className="text-[10px] font-mono text-emerald-400">
                              {clipIds.length} timeline items
                            </span>
                          </div>
                          <div className="text-[11px] text-[#8E95A5] font-mono">
                            Template: <span className="text-[#FF6B1A]">{tplId}</span> · Asset:{' '}
                            {assetIds.join(', ')}
                          </div>
                          <div className="text-[10px] text-[#A2A8B8] font-mono truncate">
                            Clips: {clipIds.join(', ')}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Typed Command Receipts & Provenance */}
                <div className="bg-[#12141A] border border-[#222631] rounded-xl p-4 space-y-3">
                  <h3 className="text-xs font-semibold text-[#FF6B1A] uppercase tracking-wider">
                    Typed Command Receipts ({activeSession.commandReceipts.length}) & Asset Provenance ({activeSession.generatedAssetRecords.length})
                  </h3>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="p-2 rounded bg-[#0E1015] border border-[#1E222D]">
                      <span className="text-[10px] text-[#8E95A5] block">Scenes</span>
                      <span className="text-sm font-bold text-white">
                        {activeSession.canonicalProject.scenes.length}
                      </span>
                    </div>
                    <div className="p-2 rounded bg-[#0E1015] border border-[#1E222D]">
                      <span className="text-[10px] text-[#8E95A5] block">Tracks</span>
                      <span className="text-sm font-bold text-white">
                        {activeSession.canonicalProject.tracks.length}
                      </span>
                    </div>
                    <div className="p-2 rounded bg-[#0E1015] border border-[#1E222D]">
                      <span className="text-[10px] text-[#8E95A5] block">Markers Linked</span>
                      <span className="text-sm font-bold text-white">
                        {activeSession.canonicalProject.markers.length}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {activeSession.commandReceipts.slice(0, 25).map((rec, idx) => (
                      <div
                        key={`${rec.undoRef || rec.timestamp}-${idx}`}
                        className="px-2.5 py-1.5 rounded bg-[#0E1015] border border-[#1E222D] text-[11px] flex items-center justify-between"
                      >
                        <span className="font-mono text-[#D5D8E0]">
                          {rec.commandType}: {rec.rationale}
                        </span>
                        <span className="text-[10px] font-mono text-emerald-400">
                          rev #{rec.revision}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-[#12141A] border border-[#222631] rounded-xl p-6 text-center space-y-3">
                <p className="text-xs text-[#B8BECB]">
                  Approve the Production Brief & Shot Plan in Stage 4, then click{' '}
                  <strong>Compile Timeline Now</strong> to generate the Canonical Project v2.0.0.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ================================================================
            STAGE 6: ADAPTIVE REFINEMENT, CHECKPOINTS & 10-POINT ACCEPTANCE GATE
           ================================================================ */}
        {activeTab === 'refinement-gate' && activeSession && (
          <div className="space-y-4" data-testid="director-refinement-gate-panel">
            {/* 10-Point Acceptance Gate */}
            <div className="bg-[#12141A] border border-[#222631] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#FF6B1A]" />
                    10-Point Final Acceptance Gate
                  </h2>
                  <p className="text-xs text-[#8E95A5]">
                    {activeSession.acceptanceGate.summary}
                  </p>
                </div>
                <span
                  data-testid="director-acceptance-gate-badge"
                  className={`px-3 py-1 rounded-lg text-xs font-bold uppercase ${
                    activeSession.acceptanceGate.passed
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  }`}
                >
                  {activeSession.acceptanceGate.passed
                    ? 'ALL 10 CHECKS PASSED ✓'
                    : `${activeSession.acceptanceGate.blockingReasons.length} PENDING CHECK(S)`}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {Object.entries(activeSession.acceptanceGate.checks).map(([key, passed]) => (
                  <div
                    key={key}
                    className={`p-2.5 rounded-lg border text-xs flex items-center gap-2.5 ${
                      passed
                        ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-100'
                        : 'bg-red-950/30 border-red-500/40 text-red-200'
                    }`}
                  >
                    {passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                    )}
                    <div className="font-semibold">{key}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Adaptive Refinement Proposals */}
              <div className="bg-[#12141A] border border-[#222631] rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-semibold text-[#FF6B1A] uppercase tracking-wider">
                  Adaptive Refinement Proposals ({activeSession.refinementSuggestions.length})
                </h3>
                <p className="text-[11px] text-[#8E95A5]">
                  Every refinement states its concrete reason, expected benefit, risk/cost, and affected IDs. User-locked shots or fields cannot be overwritten.
                </p>
                <div className="space-y-2.5">
                  {activeSession.refinementSuggestions.map((ref) => (
                    <div
                      key={ref.suggestionId}
                      className="p-3 rounded-lg bg-[#0E1015] border border-[#1E222D] space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white">{ref.title}</span>
                        <span className="px-2 py-0.5 rounded bg-[#1C202B] text-[10px] font-mono text-[#FF6B1A]">
                          {ref.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#B8BECB]">
                        <strong>Reason:</strong> {ref.reason}
                      </p>
                      <p className="text-[11px] text-emerald-300">
                        <strong>Benefit:</strong> {ref.expectedBenefit}
                      </p>
                      <p className="text-[10px] text-[#8E95A5]">
                        <strong>Risk/Cost:</strong> {ref.riskAndCost.riskLevel} ($
                        {ref.riskAndCost.estimatedCostUsd}) · Affected Shots:{' '}
                        {ref.affectedShotIds.join(', ')}
                      </p>
                      {ref.blockedByUserLock && (
                        <div className="text-[11px] text-amber-300 flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          {ref.lockBlockReason}
                        </div>
                      )}
                      {ref.status === 'proposed' && (
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={loading || ref.blockedByUserLock}
                            onClick={() => handleApplyRefinement(ref.suggestionId)}
                            data-testid={`director-apply-refinement-${ref.suggestionId}`}
                            className="px-3 py-1 rounded bg-[#FF6B1A] disabled:opacity-40 text-black font-semibold text-[11px]"
                          >
                            Apply Refinement (Save Checkpoint)
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Reversible Production Checkpoints */}
              <div className="bg-[#12141A] border border-[#222631] rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-semibold text-[#FF6B1A] uppercase tracking-wider">
                  Reversible Checkpoints & Rollback History ({activeSession.productionCheckpoints.length})
                </h3>
                <p className="text-[11px] text-[#8E95A5]">
                  Every compile and refinement automatically snapshots the shot plan, coverage ledger, and Canonical Project v2.0.0 so you can roll back with one click.
                </p>
                <div className="space-y-2">
                  {activeSession.productionCheckpoints.map((cp) => (
                    <div
                      key={cp.checkpointId}
                      className="p-3 rounded-lg bg-[#0E1015] border border-[#1E222D] flex items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <div className="font-semibold text-white flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-[#FF6B1A]" />
                          {cp.label}
                        </div>
                        <div className="text-[11px] text-[#8E95A5]">{cp.reason}</div>
                        <div className="text-[10px] font-mono text-[#6E7585]">
                          {cp.checkpointId} · {cp.createdAt}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => handleRollbackCheckpoint(cp.checkpointId)}
                        data-testid={`director-rollback-${cp.checkpointId}`}
                        className="px-3 py-1.5 rounded bg-[#1C202B] hover:bg-[#272D3D] border border-[#31384A] text-xs text-[#FF6B1A] font-medium flex items-center gap-1 shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Rollback
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Canonical Timeline Editor Modal */}
      {isTimelineModalOpen && activeSession?.canonicalProject && (
        <MobileProEditorModal
          isOpen={isTimelineModalOpen}
          onClose={() => setIsTimelineModalOpen(false)}
          initialProject={activeSession.canonicalProject}
          ownerUid={activeSession.ownerUid}
          onSaveToProjectLibrary={async () => {
            await handleSaveToProjectLibrary();
          }}
          onNotify={(msg) => {
            setStatusBanner(msg);
          }}
        />
      )}
    </div>
  );
};
