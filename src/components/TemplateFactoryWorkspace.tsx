import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Factory,
  Layers,
  CheckCircle2,
  ShieldAlert,
  Sparkles,
  GitFork,
  GitMerge,
  History,
  Archive,
  RefreshCw,
  UploadCloud,
  Sliders,
  Eye,
  FileCode2,
  CopyCheck,
  ThumbsUp,
  ThumbsDown,
  Pin,
  Lock,
  Unlock,
  Play,
  ArrowRight,
  ExternalLink,
  Check,
  X,
  RotateCcw,
} from 'lucide-react';
import { SOWVEIL_MODULES } from '../data/modules';
import {
  ModuleId,
  ProjectLibraryItem,
  TemplateLicenseType,
} from '../types/sowveil';
import { CanonicalProjectDocument } from '../types/canonicalProject';
import {
  buildCanonicalProjectFixtures,
  validateCanonicalProject,
} from '../services/canonicalProjectEngine';
import {
  TemplateFactorySourceKind,
  ExtractedParameterCategory,
  TemplateFactoryDraftRecord,
  UserPreferenceConsentConfig,
  TemplatePreferenceSignal,
  TemplateFeedbackAction,
  extractEditableParametersFromProject,
  runTemplateFactoryPipeline,
  applyExposedParameterOverridesToProject,
  generateFactoryTemplateThumbnailSvg,
  updateFactoryDraftRecord,
  forkFactoryTemplate,
  mergeFactoryTemplates,
  restoreFactoryTemplateVersion,
  deprecateFactoryTemplate,
  updateFactoryTemplateDependencies,
  resolveDuplicateSuggestion,
  publishFactoryTemplateToCatalog,
  createDefaultPreferenceConsent,
  recordTemplateFeedbackSignal,
  rankTemplatesWithTransparentSignals,
} from '../services/templateFactoryEngine';
import { EditingStudioWorkspace } from './EditingStudioWorkspace';

interface TemplateFactoryWorkspaceProps {
  userUid?: string;
  projects: ProjectLibraryItem[];
  onSaveProjectToLibrary?: (
    proj: Omit<ProjectLibraryItem, 'id' | 'updatedAt'>
  ) => Promise<void>;
  onNotify: (
    message: string,
    tone?: 'info' | 'warning' | 'error' | 'success'
  ) => void;
}

const PARAMETER_CATEGORIES: {
  id: ExtractedParameterCategory;
  label: string;
}[] = [
  { id: 'text', label: 'Text' },
  { id: 'colors', label: 'Colors' },
  { id: 'assets', label: 'Assets' },
  { id: 'timing', label: 'Timing' },
  { id: 'speed', label: 'Speed' },
  { id: 'transform', label: 'Transform' },
  { id: 'effects', label: 'Effects' },
  { id: 'audio', label: 'Audio' },
  { id: 'transitions', label: 'Transitions' },
];

const LICENSE_OPTIONS: TemplateLicenseType[] = [
  'Sowveil Original',
  'User Owned',
  'CC0-Public-Domain',
  'CC-BY-4.0',
  'Commercial-Licensed',
  'Reference Metadata Only',
  'Unknown',
];

export const TemplateFactoryWorkspace: React.FC<TemplateFactoryWorkspaceProps> = ({
  userUid = 'user-local',
  projects,
  onSaveProjectToLibrary,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<
    'pipeline' | 'drafts' | 'deduplication' | 'preferences'
  >('pipeline');

  const [drafts, setDrafts] = useState<TemplateFactoryDraftRecord[]>([]);
  const [preferenceConsent, setPreferenceConsent] =
    useState<UserPreferenceConsentConfig>(() =>
      createDefaultPreferenceConsent(userUid)
    );
  const [preferenceSignals, setPreferenceSignals] = useState<
    TemplatePreferenceSignal[]
  >([]);
  const [loading, setLoading] = useState(false);

  // Tab 1: Creation Pipeline state
  const [sourceKind, setSourceKind] =
    useState<TemplateFactorySourceKind>('canonical-project');
  const [selectedLibraryProjectId, setSelectedLibraryProjectId] =
    useState<string>('');
  const [templateTitle, setTemplateTitle] = useState<string>(
    'Kinetic SaaS Headline & Metric Reveal'
  );
  const [templateDescription, setTemplateDescription] = useState<string>(
    'Reusable multi-track canonical template with parameterized typography, color tokens, transform keyframes, and audio bed.'
  );
  const [targetModuleId, setTargetModuleId] =
    useState<ModuleId>('text-animation');
  const [tagsText, setTagsText] = useState<string>(
    'kinetic, headline, saas, metric, reusable'
  );
  const [licenseType, setLicenseType] =
    useState<TemplateLicenseType>('Sowveil Original');
  const [licenseNote, setLicenseNote] = useState<string>(
    'Created by Workspace Owner in Sowveil Template Factory'
  );

  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([]);
  const [excludedParamKeys, setExcludedParamKeys] = useState<string[]>([]);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<
    ExtractedParameterCategory | 'all'
  >('all');
  const [lastCreatedDraft, setLastCreatedDraft] =
    useState<TemplateFactoryDraftRecord | null>(null);

  // Tab 2: Selected Draft & Live Parameter Override Inspector
  const [selectedDraftId, setSelectedDraftId] = useState<string>('');
  const [liveParamValues, setLiveParamValues] = useState<
    Record<string, string | number | boolean>
  >({});
  const [mergeTargetId, setMergeTargetId] = useState<string>('');
  const [deprecateReason, setDeprecateReason] = useState<string>(
    'Superseded by updated brand typography template'
  );
  const [openInEditingStudioDraft, setOpenInEditingStudioDraft] =
    useState<TemplateFactoryDraftRecord | null>(null);

  const sourceCanonicalProject = useMemo<CanonicalProjectDocument>(() => {
    if (sourceKind === 'canonical-project' && selectedLibraryProjectId) {
      const found = projects.find((p) => p.id === selectedLibraryProjectId);
      if (found?.canonicalProjectJson) {
        try {
          const parsed = validateCanonicalProject(
            JSON.parse(found.canonicalProjectJson)
          );
          if (parsed.valid && parsed.project) {
            return parsed.project;
          }
        } catch {
          // Fallback to showcase project
        }
      }
    }
    return buildCanonicalProjectFixtures().multiTrackProject;
  }, [sourceKind, selectedLibraryProjectId, projects]);

  const extractionPreview = useMemo(() => {
    const raw = extractEditableParametersFromProject(sourceCanonicalProject, {
      selectedSceneIds:
        selectedSceneIds.length > 0 ? selectedSceneIds : undefined,
    });
    const parameters = raw.extractedParameters.map((p) => ({
      ...p,
      exposed: !excludedParamKeys.includes(p.key),
    }));
    return {
      ...raw,
      parameters,
    };
  }, [sourceCanonicalProject, selectedSceneIds, excludedParamKeys]);

  const loadDraftsFromServer = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/template-factory/drafts', {
        headers: {
          'x-sowveil-dev-uid': userUid,
        },
      });
      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        if (Array.isArray(data.items)) {
          setDrafts(data.items);
          if (!selectedDraftId && data.items.length > 0) {
            setSelectedDraftId(data.items[0].id);
          }
        }
        if (data.preferenceConsent) {
          setPreferenceConsent(data.preferenceConsent);
        }
        if (Array.isArray(data.preferenceSignals)) {
          setPreferenceSignals(data.preferenceSignals);
        }
      }
    } catch {
      // Fallback to local state if offline
    } finally {
      setLoading(false);
    }
  }, [userUid, selectedDraftId]);

  useEffect(() => {
    loadDraftsFromServer();
  }, [loadDraftsFromServer]);

  const selectedDraft = useMemo(
    () => drafts.find((d) => d.id === selectedDraftId) || drafts[0] || null,
    [drafts, selectedDraftId]
  );

  useEffect(() => {
    if (!selectedDraft) {
      setLiveParamValues({});
      return;
    }
    const defaults: Record<string, string | number | boolean> = {};
    for (const p of selectedDraft.extractedParameters) {
      if (p.exposed) {
        defaults[p.key] = p.paramSpec.defaultValue;
      }
    }
    setLiveParamValues(defaults);
  }, [selectedDraft]);

  const evaluatedDraftPreview = useMemo(() => {
    if (!selectedDraft) return null;
    const mutatedProject = applyExposedParameterOverridesToProject(
      selectedDraft.canonicalTemplateProject,
      selectedDraft.extractedParameters,
      liveParamValues
    );
    const svg = generateFactoryTemplateThumbnailSvg(
      mutatedProject,
      selectedDraft.title,
      selectedDraft.provenanceClassification
    );
    return {
      project: mutatedProject,
      svg,
    };
  }, [selectedDraft, liveParamValues]);

  const handleRunCreationPipeline = async () => {
    const exposedParameterKeys = extractionPreview.parameters
      .filter((p) => p.exposed)
      .map((p) => p.key);
    const tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      const res = await fetch('/api/v1/template-factory/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sowveil-dev-uid': userUid,
        },
        body: JSON.stringify({
          sourceKind,
          title: templateTitle,
          description: templateDescription,
          moduleId: targetModuleId,
          tags,
          licenseType,
          licenseNote,
          project: sourceCanonicalProject,
          selectedSceneIds:
            selectedSceneIds.length > 0 ? selectedSceneIds : undefined,
          exposedParameterKeys,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const created: TemplateFactoryDraftRecord = (json.data || json).draft;
        setLastCreatedDraft(created);
        await loadDraftsFromServer();
        setSelectedDraftId(created.id);
        onNotify(
          `Completed 10-stage Template Factory pipeline: "${created.title}" saved as private Draft.`,
          'success'
        );
        return;
      }
    } catch {
      // Offline / local fallback
    }

    const localDraft = runTemplateFactoryPipeline({
      ownerUid: userUid,
      sourceKind,
      title: templateTitle,
      description: templateDescription,
      moduleId: targetModuleId,
      tags,
      licenseType,
      licenseNote,
      sourceProject: sourceCanonicalProject,
      selectedSceneIds:
        selectedSceneIds.length > 0 ? selectedSceneIds : undefined,
      exposedParameterKeys,
      existingFactoryDrafts: drafts,
    });
    setLastCreatedDraft(localDraft);
    setDrafts((prev) => [localDraft, ...prev]);
    setSelectedDraftId(localDraft.id);
    onNotify(
      `Completed 10-stage Template Factory pipeline: "${localDraft.title}" saved as private Draft.`,
      'success'
    );
  };

  const handleSaveParameterOverridesToDraft = async () => {
    if (!selectedDraft) return;
    try {
      const res = await fetch(
        `/api/v1/template-factory/drafts/${selectedDraft.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-sowveil-dev-uid': userUid,
          },
          body: JSON.stringify({
            parameterDefaultOverrides: liveParamValues,
            changelog:
              'Updated exposed parameter defaults in Template Factory',
          }),
        }
      );
      if (res.ok) {
        await loadDraftsFromServer();
        onNotify(
          `Saved new version for "${selectedDraft.title}".`,
          'success'
        );
        return;
      }
    } catch {
      // Local fallback
    }

    const updated = updateFactoryDraftRecord(
      selectedDraft,
      {
        parameterDefaultOverrides: liveParamValues,
        changelog: 'Updated exposed parameter defaults in Template Factory',
      },
      userUid
    );
    setDrafts((prev) =>
      prev.map((d) => (d.id === updated.id ? updated : d))
    );
    onNotify(
      `Saved new version v${updated.version} for "${updated.title}".`,
      'success'
    );
  };

  const handleForkDraft = async (draft: TemplateFactoryDraftRecord) => {
    try {
      const res = await fetch(
        `/api/v1/template-factory/drafts/${draft.id}/fork`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-sowveil-dev-uid': userUid,
          },
          body: JSON.stringify({
            forkTitle: `${draft.title} (Fork)`,
          }),
        }
      );
      if (res.ok) {
        const json = await res.json();
        const forked: TemplateFactoryDraftRecord = (json.data || json).draft;
        await loadDraftsFromServer();
        setSelectedDraftId(forked.id);
        onNotify(`Forked "${draft.title}" into "${forked.title}".`, 'success');
        return;
      }
    } catch {
      // Local fallback
    }

    const forked = forkFactoryTemplate(draft, userUid, `${draft.title} (Fork)`);
    setDrafts((prev) => [forked, ...prev]);
    setSelectedDraftId(forked.id);
    onNotify(`Forked "${draft.title}" into "${forked.title}".`, 'success');
  };

  const handleMergeDrafts = async () => {
    if (!selectedDraft || !mergeTargetId) return;
    const secondary = drafts.find((d) => d.id === mergeTargetId);
    if (!secondary) return;

    try {
      const res = await fetch(
        `/api/v1/template-factory/drafts/${selectedDraft.id}/merge`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-sowveil-dev-uid': userUid,
          },
          body: JSON.stringify({
            secondaryDraftId: secondary.id,
          }),
        }
      );
      if (res.ok) {
        await loadDraftsFromServer();
        onNotify(
          `Merged parameters and dependencies from "${secondary.title}" into "${selectedDraft.title}".`,
          'success'
        );
        return;
      }
    } catch {
      // Local fallback
    }

    const merged = mergeFactoryTemplates({
      primaryDraft: selectedDraft,
      secondaryDraft: secondary,
      actorUid: userUid,
    });
    setDrafts((prev) => prev.map((d) => (d.id === merged.id ? merged : d)));
    onNotify(
      `Merged parameters and dependencies from "${secondary.title}" into "${selectedDraft.title}".`,
      'success'
    );
  };

  const handleRestoreVersion = async (targetVersion: string) => {
    if (!selectedDraft) return;
    try {
      const res = await fetch(
        `/api/v1/template-factory/drafts/${selectedDraft.id}/restore-version`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-sowveil-dev-uid': userUid,
          },
          body: JSON.stringify({ targetVersion }),
        }
      );
      if (res.ok) {
        await loadDraftsFromServer();
        onNotify(`Restored template version v${targetVersion}.`, 'success');
        return;
      }
    } catch {
      // Local fallback
    }

    const restored = restoreFactoryTemplateVersion(
      selectedDraft,
      targetVersion,
      userUid
    );
    setDrafts((prev) =>
      prev.map((d) => (d.id === restored.id ? restored : d))
    );
    onNotify(`Restored template version v${targetVersion}.`, 'success');
  };

  const handleDeprecateDraft = async () => {
    if (!selectedDraft) return;
    try {
      const res = await fetch(
        `/api/v1/template-factory/drafts/${selectedDraft.id}/deprecate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-sowveil-dev-uid': userUid,
          },
          body: JSON.stringify({
            reason: deprecateReason,
          }),
        }
      );
      if (res.ok) {
        await loadDraftsFromServer();
        onNotify(`Deprecated template "${selectedDraft.title}".`, 'warning');
        return;
      }
    } catch {
      // Local fallback
    }

    const deprecated = deprecateFactoryTemplate(
      selectedDraft,
      deprecateReason
    );
    setDrafts((prev) =>
      prev.map((d) => (d.id === deprecated.id ? deprecated : d))
    );
    onNotify(`Deprecated template "${selectedDraft.title}".`, 'warning');
  };

  const handleUpdateDependencies = async () => {
    if (!selectedDraft) return;
    try {
      const res = await fetch(
        `/api/v1/template-factory/drafts/${selectedDraft.id}/update-dependencies`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-sowveil-dev-uid': userUid,
          },
          body: JSON.stringify({
            resolveMissingAssets: true,
          }),
        }
      );
      if (res.ok) {
        await loadDraftsFromServer();
        onNotify(
          `Updated dependencies and re-ran 10-point quality gate for "${selectedDraft.title}".`,
          'success'
        );
        return;
      }
    } catch {
      // Local fallback
    }

    const updated = updateFactoryTemplateDependencies(
      selectedDraft,
      { resolveMissingAssets: true },
      userUid
    );
    setDrafts((prev) =>
      prev.map((d) => (d.id === updated.id ? updated : d))
    );
    onNotify(
      `Updated dependencies and re-ran 10-point quality gate for "${selectedDraft.title}".`,
      'success'
    );
  };

  const handlePublishDraft = async () => {
    if (!selectedDraft) return;
    try {
      const res = await fetch(
        `/api/v1/template-factory/drafts/${selectedDraft.id}/publish`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-sowveil-dev-uid': userUid,
          },
          body: JSON.stringify({
            explicitUserConfirmation: true,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        onNotify(
          `Publish blocked: ${json.error?.message || json.message || 'Quality or license gate blocked publication.'}`,
          'error'
        );
        return;
      }
      await loadDraftsFromServer();
      onNotify(
        `Published "${selectedDraft.title}" to Validated Catalog!`,
        'success'
      );
      return;
    } catch {
      // Local fallback
    }

    const result = publishFactoryTemplateToCatalog({
      draft: selectedDraft,
      actorUid: userUid,
      explicitUserConfirmation: true,
    });
    if (!result.ok || !result.updatedDraft) {
      onNotify(
        `Publish blocked: ${result.errorMessage || 'Failed publication check.'}`,
        'error'
      );
      return;
    }
    const updatedDraft = result.updatedDraft;
    setDrafts((prev) =>
      prev.map((d) => (d.id === updatedDraft.id ? updatedDraft : d))
    );
    onNotify(
      `Published "${selectedDraft.title}" to Validated Catalog!`,
      'success'
    );
  };

  const handleResolveDuplicateSuggestion = async (
    draftId: string,
    suggestionId: string,
    action:
      | 'keep-both-distinct'
      | 'link-as-version'
      | 'merge-into-existing'
      | 'undo-suggestion'
  ) => {
    try {
      const res = await fetch(
        `/api/v1/template-factory/drafts/${draftId}/duplicate-suggestion`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-sowveil-dev-uid': userUid,
          },
          body: JSON.stringify({
            suggestionId,
            action,
          }),
        }
      );
      if (res.ok) {
        await loadDraftsFromServer();
        onNotify(
          `Applied reversible deduplication action "${action}" without deleting any work.`,
          'info'
        );
        return;
      }
    } catch {
      // Local fallback
    }

    const target = drafts.find((d) => d.id === draftId);
    if (!target) return;
    const updated = resolveDuplicateSuggestion(target, suggestionId, action);
    setDrafts((prev) =>
      prev.map((d) => (d.id === updated.id ? updated : d))
    );
    onNotify(
      `Applied reversible deduplication action "${action}" without deleting any work.`,
      'info'
    );
  };

  const handleTogglePreferenceConsent = async (consent: boolean) => {
    try {
      const res = await fetch('/api/v1/template-factory/feedback/consent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sowveil-dev-uid': userUid,
        },
        body: JSON.stringify({
          consentToPreferenceRanking: consent,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        if (data.preferenceConsent) {
          setPreferenceConsent(data.preferenceConsent);
        }
        onNotify(
          consent
            ? 'Enabled workspace-scoped transparent preference ranking.'
            : 'Disabled preference ranking signals.',
          'info'
        );
        return;
      }
    } catch {
      // Local fallback
    }

    setPreferenceConsent((prev) => ({
      ...prev,
      consentToPreferenceRanking: consent,
      allowCrossUserSharing: false,
      silentModelTrainingEnabled: false,
      updatedAt: new Date().toISOString(),
    }));
    onNotify(
      consent
        ? 'Enabled workspace-scoped transparent preference ranking.'
        : 'Disabled preference ranking signals.',
      'info'
    );
  };

  const handleRecordSignal = async (
    draft: TemplateFactoryDraftRecord,
    action: TemplateFeedbackAction
  ) => {
    try {
      const res = await fetch('/api/v1/template-factory/feedback/signal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sowveil-dev-uid': userUid,
        },
        body: JSON.stringify({
          templateId: draft.id,
          moduleId: draft.moduleId,
          action,
          styleTag: draft.tags[0],
        }),
      });
      if (res.ok) {
        await loadDraftsFromServer();
        onNotify(
          `Recorded transparent signal "${action}" on "${draft.title}".`,
          'success'
        );
        return;
      }
    } catch {
      // Local fallback
    }

    const resLocal = recordTemplateFeedbackSignal({
      ownerUid: userUid,
      consentConfig: preferenceConsent,
      existingSignals: preferenceSignals,
      templateId: draft.id,
      moduleId: draft.moduleId,
      action,
      styleTag: draft.tags[0],
    });
    if (!resLocal.recorded) {
      onNotify(
        resLocal.consentBlockedReason || 'Preference consent is disabled.',
        'warning'
      );
      return;
    }
    setPreferenceSignals(resLocal.signals);
    setPreferenceConsent(resLocal.updatedConsent);
    onNotify(
      `Recorded transparent signal "${action}" on "${draft.title}".`,
      'success'
    );
  };

  const rankedTemplates = useMemo(
    () =>
      rankTemplatesWithTransparentSignals({
        ownerUid: userUid,
        consentConfig: preferenceConsent,
        userSignals: preferenceSignals,
        templates: drafts.map((d) => d.catalogItemDraft),
      }),
    [userUid, preferenceConsent, preferenceSignals, drafts]
  );

  if (openInEditingStudioDraft) {
    return (
      <EditingStudioWorkspace
        mode="standalone-route"
        onClose={() => setOpenInEditingStudioDraft(null)}
        initialProject={openInEditingStudioDraft.canonicalTemplateProject}
        ownerUid={userUid}
        onSaveToProjectLibrary={async (proj) => {
          if (onSaveProjectToLibrary) {
            await onSaveProjectToLibrary(proj);
          }
          onNotify(
            `Saved template project "${proj.title}" to Project Library.`,
            'success'
          );
        }}
        onNotify={onNotify}
      />
    );
  }

  return (
    <div
      className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6"
      data-testid="template-factory-workspace"
    >
      {/* Header */}
      <div className="rounded-2xl border border-[#2A231E] bg-[#11100F] p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-mono-tabular uppercase tracking-wider text-[#F06424]">
            <Factory className="w-4 h-4" />
            <span>Template Factory · Canonical Graph Generalizer & Quality Gate</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-[#F3EEE8]">
            Template Factory, Automatic Reuse & Continuous Improvement
          </h1>
          <p className="text-xs text-[#B8AAA0] max-w-3xl leading-relaxed">
            Generate reusable templates from scratch, authorized canonical projects, or Reference Lab reconstructions. Every template runs through a 10-stage pipeline and 10-point quality & determinism gate before entering your private Draft catalog.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="px-3 py-1.5 rounded-lg border border-[#342A24] bg-[#191614] text-xs font-mono-tabular text-[#B8AAA0]">
            Private Drafts:{' '}
            <span className="text-[#F3EEE8] font-bold">
              {drafts.filter((d) => !d.publishedToCatalog).length}
            </span>
          </div>
          <div className="px-3 py-1.5 rounded-lg border border-[#55B98B]/40 bg-[#13261E] text-xs font-mono-tabular text-[#55B98B]">
            Validated Catalog:{' '}
            <span className="font-bold">
              {
                drafts.filter(
                  (d) =>
                    d.publishedToCatalog &&
                    !d.qualityReport.quarantinedFromValidatedCatalog
                ).length
              }
            </span>
          </div>
          <button
            type="button"
            onClick={loadDraftsFromServer}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#342A24] bg-[#191614] hover:border-[#83766D] text-xs font-medium text-[#F3EEE8]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#2A231E] pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('pipeline')}
          data-testid="tab-factory-pipeline"
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'pipeline'
              ? 'bg-[#F06424] text-[#080707]'
              : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24] hover:text-[#F3EEE8]'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>1. 10-Stage Creation Pipeline</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('drafts')}
          data-testid="tab-factory-drafts"
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'drafts'
              ? 'bg-[#F06424] text-[#080707]'
              : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24] hover:text-[#F3EEE8]'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>2. Private Drafts, Quality Gate & Lifecycle ({drafts.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('deduplication')}
          data-testid="tab-factory-deduplication"
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'deduplication'
              ? 'bg-[#F06424] text-[#080707]'
              : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24] hover:text-[#F3EEE8]'
          }`}
        >
          <CopyCheck className="w-3.5 h-3.5" />
          <span>3. Content-Hash & Similarity Review</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('preferences')}
          data-testid="tab-factory-preferences"
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'preferences'
              ? 'bg-[#F06424] text-[#080707]'
              : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24] hover:text-[#F3EEE8]'
          }`}
        >
          <ThumbsUp className="w-3.5 h-3.5" />
          <span>4. Transparent Ranking & Preference Signals</span>
        </button>
      </div>

      {/* TAB 1: 10-STAGE CREATION PIPELINE */}
      {activeTab === 'pipeline' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Source, Metadata, Rights & Scene Selection */}
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-2xl border border-[#2A231E] bg-[#11100F] p-4 space-y-4">
              <h2 className="text-sm font-bold text-[#F3EEE8] flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#F06424]" />
                <span>Stage 1–3: Source, Rights & Reusable Components</span>
              </h2>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#B8AAA0]">
                  Template Creation Source
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'from-scratch', label: 'From Scratch' },
                      { id: 'canonical-project', label: 'Canonical Project' },
                      {
                        id: 'reference-reconstruction',
                        label: 'Reference Lab',
                      },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSourceKind(opt.id)}
                      data-testid={`source-kind-${opt.id}`}
                      className={`px-2.5 py-2 rounded-lg text-xs font-semibold border text-center transition-colors ${
                        sourceKind === opt.id
                          ? 'border-[#F06424] bg-[#2A1810] text-[#F06424]'
                          : 'border-[#342A24] bg-[#191614] text-[#B8AAA0] hover:text-[#F3EEE8]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {sourceKind === 'canonical-project' && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[#B8AAA0]">
                    Authorized User Project (Source Remains Untouched)
                  </label>
                  <select
                    value={selectedLibraryProjectId}
                    onChange={(e) => setSelectedLibraryProjectId(e.target.value)}
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-xs text-[#F3EEE8]"
                  >
                    <option value="">
                      Canonical Multi-Track Showcase Project (v2.0.0)
                    </option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} ({p.resolution})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {sourceKind === 'reference-reconstruction' && (
                <div className="rounded-xl border border-[#E4B45A]/40 bg-[#292012]/60 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#E4B45A]">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>Honest Reconstructed Provenance Enforced</span>
                  </div>
                  <p className="text-[11px] text-[#F3EEE8]/90 leading-relaxed">
                    Templates derived from flattened video or Reference Lab sessions are automatically labeled{' '}
                    <code className="text-[#E4B45A] font-bold">Reconstructed</code> with an attached property-level fidelity report. They never claim &ldquo;Recovered Original&rdquo;.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-[#B8AAA0]">
                    Template Title
                  </label>
                  <input
                    type="text"
                    value={templateTitle}
                    onChange={(e) => setTemplateTitle(e.target.value)}
                    data-testid="input-template-name"
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-xs text-[#F3EEE8]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-[#B8AAA0]">
                    Target Sowveil Module
                  </label>
                  <select
                    value={targetModuleId}
                    onChange={(e) => setTargetModuleId(e.target.value as ModuleId)}
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-xs text-[#F3EEE8]"
                  >
                    {SOWVEIL_MODULES.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-[#B8AAA0]">
                    License Classification
                  </label>
                  <select
                    value={licenseType}
                    onChange={(e) =>
                      setLicenseType(e.target.value as TemplateLicenseType)
                    }
                    data-testid="select-template-license"
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-xs text-[#F3EEE8]"
                  >
                    {LICENSE_OPTIONS.map((lic) => (
                      <option key={lic} value={lic}>
                        {lic}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-[#B8AAA0]">
                    Attribution / Provenance Note
                  </label>
                  <input
                    type="text"
                    value={licenseNote}
                    onChange={(e) => setLicenseNote(e.target.value)}
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-xs text-[#F3EEE8]"
                  />
                </div>
              </div>

              {/* Scene Selector */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#B8AAA0]">
                  Select Reusable Scenes ({sourceCanonicalProject.scenes.length} available)
                </label>
                <div className="flex flex-wrap gap-2">
                  {sourceCanonicalProject.scenes.map((scene) => {
                    const isSelected =
                      selectedSceneIds.length === 0 ||
                      selectedSceneIds.includes(scene.id);
                    return (
                      <button
                        key={scene.id}
                        type="button"
                        onClick={() => {
                          setSelectedSceneIds((prev) =>
                            prev.includes(scene.id)
                              ? prev.filter((id) => id !== scene.id)
                              : [...prev, scene.id]
                          );
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono-tabular border ${
                          isSelected
                            ? 'border-[#55B98B] bg-[#13261E] text-[#55B98B]'
                            : 'border-[#342A24] bg-[#191614] text-[#83766D]'
                        }`}
                      >
                        {scene.title} ({scene.startTimeSec}s–
                        {scene.startTimeSec + scene.durationSec}s)
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={handleRunCreationPipeline}
                data-testid="btn-run-template-pipeline"
                className="w-full py-2.5 px-4 rounded-xl bg-[#F06424] hover:bg-[#ff7638] text-[#080707] font-bold text-xs flex items-center justify-center gap-2 transition-colors"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Run 10-Stage Pipeline & Save Private Draft</span>
              </button>
            </div>

            {/* Generalization Report Card */}
            <div
              className="rounded-2xl border border-[#2A231E] bg-[#11100F] p-4 space-y-3"
              data-testid="generalization-report-card"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#F3EEE8]">
                  Generalization vs. Project-Specific Report
                </h3>
                <span className="px-2 py-0.5 rounded bg-[#13261E] border border-[#55B98B]/40 text-[#55B98B] text-[10px] font-mono-tabular">
                  {extractionPreview.generalizationReport.sourceUnchangedVerified
                    ? 'Source Project Untouched ✓'
                    : 'Mutated'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl border border-[#342A24] bg-[#191614] p-2.5">
                  <div className="text-[11px] text-[#83766D]">
                    Generalized Parameters
                  </div>
                  <div className="text-base font-extrabold text-[#55B98B] font-mono-tabular">
                    {extractionPreview.generalizationReport.generalizedCount}
                  </div>
                </div>
                <div className="rounded-xl border border-[#342A24] bg-[#191614] p-2.5">
                  <div className="text-[11px] text-[#83766D]">
                    Project-Specific Fixed
                  </div>
                  <div className="text-base font-extrabold text-[#E4B45A] font-mono-tabular">
                    {
                      extractionPreview.generalizationReport
                        .projectSpecificCount
                    }
                  </div>
                </div>
              </div>

              <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                {extractionPreview.generalizationReport.items
                  .slice(0, 8)
                  .map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 text-[11px] py-1 border-b border-[#241E1B]"
                    >
                      <span className="text-[#F3EEE8] truncate">
                        {item.propertyPath}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded font-mono-tabular text-[10px] shrink-0 ${
                          item.classification === 'generalized-parameter'
                            ? 'bg-[#13261E] text-[#55B98B]'
                            : 'bg-[#292012] text-[#E4B45A]'
                        }`}
                      >
                        {item.classification === 'generalized-parameter'
                          ? 'Generalized'
                          : 'Project-Specific'}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* Right Column: Extracted Parameters across all 9 Categories & Pipeline Stage Receipts */}
          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-2xl border border-[#2A231E] bg-[#11100F] p-4 space-y-4">
              <div>
                <h2 className="text-sm font-bold text-[#F3EEE8]">
                  Stage 4–5: Extracted Canonical Graph Parameters (
                  {extractionPreview.parameters.length})
                </h2>
                <p className="text-xs text-[#83766D]">
                  Toggle which parameters are exposed to template users vs. kept internal to the project structure.
                </p>
              </div>

              {/* Category Filter Pills */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveCategoryFilter('all')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
                    activeCategoryFilter === 'all'
                      ? 'border-[#F06424] bg-[#2A1810] text-[#F06424]'
                      : 'border-[#342A24] bg-[#191614] text-[#B8AAA0]'
                  }`}
                >
                  All ({extractionPreview.parameters.length})
                </button>
                {PARAMETER_CATEGORIES.map((cat) => {
                  const count = extractionPreview.parameters.filter(
                    (p) => p.category === cat.id
                  ).length;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setActiveCategoryFilter(cat.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
                        activeCategoryFilter === cat.id
                          ? 'border-[#F06424] bg-[#2A1810] text-[#F06424]'
                          : 'border-[#342A24] bg-[#191614] text-[#B8AAA0]'
                      }`}
                    >
                      {cat.label} ({count})
                    </button>
                  );
                })}
              </div>

              {/* Parameter List */}
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                {extractionPreview.parameters
                  .filter(
                    (p) =>
                      activeCategoryFilter === 'all' ||
                      p.category === activeCategoryFilter
                  )
                  .map((param) => {
                    const isExposed = !excludedParamKeys.includes(param.key);
                    return (
                      <div
                        key={param.key}
                        className="rounded-xl border border-[#2A231E] bg-[#161311] p-3 flex items-center justify-between gap-3"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded border border-[#342A24] bg-[#241E1B] text-[10px] font-mono-tabular uppercase text-[#F06424]">
                              {param.category}
                            </span>
                            <span className="text-xs font-semibold text-[#F3EEE8] truncate">
                              {param.label}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono-tabular text-[#83766D] truncate">
                            Path: <code>{param.targetPropertyPath}</code> · Default:{' '}
                            <code className="text-[#B8AAA0]">
                              {String(param.paramSpec.defaultValue)}
                            </code>
                            {param.paramSpec.min !== undefined &&
                            param.paramSpec.max !== undefined
                              ? ` · Range [${param.paramSpec.min}..${param.paramSpec.max}${param.paramSpec.unit || ''}]`
                              : ''}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setExcludedParamKeys((prev) =>
                              prev.includes(param.key)
                                ? prev.filter((k) => k !== param.key)
                                : [...prev, param.key]
                            );
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border shrink-0 flex items-center gap-1.5 ${
                            isExposed
                              ? 'border-[#55B98B]/50 bg-[#13261E] text-[#55B98B]'
                              : 'border-[#342A24] bg-[#191614] text-[#83766D]'
                          }`}
                        >
                          {isExposed ? (
                            <>
                              <Unlock className="w-3.5 h-3.5" />
                              <span>Exposed</span>
                            </>
                          ) : (
                            <>
                              <Lock className="w-3.5 h-3.5" />
                              <span>Locked</span>
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* 10-Stage Pipeline Execution Receipt */}
            {lastCreatedDraft && (
              <div
                className="rounded-2xl border border-[#55B98B]/40 bg-[#11100F] p-4 space-y-3"
                data-testid="pipeline-stage-receipts"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#55B98B] flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      10-Stage Template Factory Pipeline Completed (
                      {lastCreatedDraft.pipelineStages.length}/10 Stages)
                    </span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveTab('drafts')}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#F06424] hover:underline"
                  >
                    <span>Inspect Draft & Quality Gate</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {lastCreatedDraft.pipelineStages.map((st) => (
                    <div
                      key={st.stageKey}
                      className="rounded-lg border border-[#2A231E] bg-[#161311] p-2.5 flex items-start gap-2 text-xs"
                    >
                      <span className="w-5 h-5 rounded-full bg-[#13261E] text-[#55B98B] font-mono-tabular text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                        {st.stageOrder}
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold text-[#F3EEE8] font-mono-tabular">
                          {st.label}
                        </div>
                        <div className="text-[11px] text-[#B8AAA0] leading-snug">
                          {st.detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: PRIVATE DRAFTS, LIVE PREVIEW, 10-POINT QUALITY GATE & LIFECYCLE */}
      {activeTab === 'drafts' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#B8AAA0]">
              Workspace Templates & Auto-Saved AI Drafts ({drafts.length})
            </h2>

            {drafts.length === 0 ? (
              <div className="rounded-2xl border border-[#2A231E] bg-[#11100F] p-6 text-center space-y-3">
                <p className="text-xs text-[#B8AAA0]">
                  No template drafts yet. Run the 10-stage pipeline in Tab 1 or compile a timeline in AI Director to auto-capture reusable drafts.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('pipeline')}
                  className="px-4 py-2 rounded-lg bg-[#F06424] text-[#080707] font-bold text-xs"
                >
                  Create First Template Draft
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-[680px] overflow-y-auto pr-1">
                {drafts.map((d) => {
                  const isSelected = selectedDraft?.id === d.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setSelectedDraftId(d.id)}
                      data-testid={`draft-card-${d.id}`}
                      className={`w-full text-left rounded-xl border p-3 space-y-2 transition-colors ${
                        isSelected
                          ? 'border-[#F06424] bg-[#1D1612]'
                          : 'border-[#2A231E] bg-[#11100F] hover:border-[#83766D]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-bold text-xs text-[#F3EEE8] line-clamp-1">
                          {d.title}
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono-tabular uppercase shrink-0 ${
                            d.publishedToCatalog
                              ? 'bg-[#13261E] text-[#55B98B] border border-[#55B98B]/40'
                              : d.deprecationStatus.isDeprecated
                              ? 'bg-[#2A1515] text-[#F06464] border border-[#F06464]/40'
                              : 'bg-[#292012] text-[#E4B45A] border border-[#E4B45A]/40'
                          }`}
                        >
                          {d.publishedToCatalog
                            ? 'Published'
                            : d.deprecationStatus.isDeprecated
                            ? 'Deprecated'
                            : 'Draft'}{' '}
                          · v{d.version}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono-tabular text-[#B8AAA0]">
                        <span>{d.moduleId}</span>
                        <span>·</span>
                        <span
                          className={
                            d.provenanceClassification === 'Reconstructed'
                              ? 'text-[#E4B45A]'
                              : 'text-[#55B98B]'
                          }
                        >
                          {d.provenanceClassification}
                        </span>
                        <span>·</span>
                        <span>{d.licenseType}</span>
                        {d.autoSavedFromAiComponent && (
                          <span className="px-1.5 py-0.5 rounded bg-[#2A1810] text-[#F06424]">
                            AI Auto-Reuse
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="lg:col-span-8 space-y-4">
            {selectedDraft && evaluatedDraftPreview ? (
              <>
                <div className="rounded-2xl border border-[#2A231E] bg-[#11100F] p-4 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-extrabold text-[#F3EEE8]">
                          {selectedDraft.title}
                        </h3>
                        <span className="px-2 py-0.5 rounded bg-[#241E1B] border border-[#342A24] text-xs font-mono-tabular text-[#F06424]">
                          v{selectedDraft.version}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-mono-tabular ${
                            selectedDraft.provenanceClassification ===
                            'Reconstructed'
                              ? 'bg-[#292012] text-[#E4B45A] border border-[#E4B45A]/40'
                              : 'bg-[#13261E] text-[#55B98B] border border-[#55B98B]/40'
                          }`}
                        >
                          Provenance: {selectedDraft.provenanceClassification}
                        </span>
                      </div>
                      <p className="text-xs text-[#B8AAA0]">
                        {selectedDraft.description}
                      </p>
                      <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono-tabular text-[#83766D] pt-1">
                        <span>
                          Origin Project:{' '}
                          <code className="text-[#F3EEE8]">
                            {selectedDraft.originProjectId || 'From Scratch'}
                          </code>{' '}
                          (rev {selectedDraft.originProjectRevision ?? 1})
                        </span>
                        <span>·</span>
                        <span>
                          Content Hash:{' '}
                          <code className="text-[#F3EEE8]">
                            {selectedDraft.structuralContentHash}
                          </code>
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenInEditingStudioDraft(selectedDraft)
                        }
                        data-testid="btn-open-draft-in-editor"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#F06424]/50 bg-[#2A1810] text-xs font-bold text-[#F06424] hover:bg-[#F06424] hover:text-[#080707] transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Open in Editing Studio</span>
                      </button>

                      <button
                        type="button"
                        onClick={handlePublishDraft}
                        data-testid="btn-publish-template"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#55B98B] text-[#080707] text-xs font-bold hover:opacity-90 transition-opacity"
                      >
                        <UploadCloud className="w-3.5 h-3.5" />
                        <span>Publish to Validated Catalog</span>
                      </button>
                    </div>
                  </div>

                  {/* Live Thumbnail SVG & Interactive Parameter Overrides */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-2 border-t border-[#241E1B]">
                    <div className="md:col-span-5 space-y-2">
                      <div className="text-xs font-semibold text-[#B8AAA0] flex items-center gap-1.5">
                        <Eye className="w-3.5 h-3.5 text-[#F06424]" />
                        <span>Live Parameterized Preview</span>
                      </div>
                      <div
                        className="rounded-xl overflow-hidden border border-[#342A24] bg-[#080707] aspect-video flex items-center justify-center"
                        data-testid="live-template-svg-preview"
                      >
                        <img
                          src={evaluatedDraftPreview.svg}
                          alt={selectedDraft.title}
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <div className="text-[11px] font-mono-tabular text-[#83766D] flex items-center justify-between">
                        <span>
                          Alight Motion XML Tier:{' '}
                          {
                            selectedDraft.qualityReport
                              .targetExportVerification.alightXmlTier
                          }
                        </span>
                      </div>
                    </div>

                    <div className="md:col-span-7 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#F3EEE8]">
                          Interactive Exposed Parameters (
                          {
                            selectedDraft.extractedParameters.filter(
                              (p) => p.exposed
                            ).length
                          }
                          )
                        </span>
                        <button
                          type="button"
                          onClick={handleSaveParameterOverridesToDraft}
                          data-testid="btn-save-param-overrides"
                          className="px-2.5 py-1 rounded-lg bg-[#F06424] text-[#080707] font-bold text-[11px]"
                        >
                          Save Overrides as New Version
                        </button>
                      </div>

                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {selectedDraft.extractedParameters
                          .filter((p) => p.exposed)
                          .map((param) => {
                            const val =
                              liveParamValues[param.key] ??
                              param.paramSpec.defaultValue;
                            return (
                              <div
                                key={param.key}
                                className="rounded-lg border border-[#2A231E] bg-[#161311] p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <div className="text-xs font-medium text-[#F3EEE8] truncate">
                                    {param.label}
                                  </div>
                                  <div className="text-[10px] font-mono-tabular text-[#83766D]">
                                    {param.category} · {param.paramSpec.type}
                                  </div>
                                </div>

                                <div className="w-full sm:w-48 shrink-0">
                                  {param.paramSpec.type === 'color' ? (
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        type="color"
                                        value={String(val)}
                                        onChange={(e) =>
                                          setLiveParamValues((prev) => ({
                                            ...prev,
                                            [param.key]: e.target.value,
                                          }))
                                        }
                                        className="w-7 h-7 rounded border border-[#342A24] bg-transparent cursor-pointer"
                                      />
                                      <input
                                        type="text"
                                        value={String(val)}
                                        onChange={(e) =>
                                          setLiveParamValues((prev) => ({
                                            ...prev,
                                            [param.key]: e.target.value,
                                          }))
                                        }
                                        className="w-full rounded border border-[#342A24] bg-[#0B0A09] px-2 py-1 text-xs font-mono-tabular text-[#F3EEE8]"
                                      />
                                    </div>
                                  ) : param.paramSpec.type === 'number' ? (
                                    <input
                                      type="number"
                                      min={param.paramSpec.min}
                                      max={param.paramSpec.max}
                                      step={param.paramSpec.step || 1}
                                      value={Number(val)}
                                      onChange={(e) =>
                                        setLiveParamValues((prev) => ({
                                          ...prev,
                                          [param.key]: Number(e.target.value),
                                        }))
                                      }
                                      className="w-full rounded border border-[#342A24] bg-[#0B0A09] px-2.5 py-1 text-xs font-mono-tabular text-[#F3EEE8]"
                                    />
                                  ) : param.paramSpec.options &&
                                    param.paramSpec.options.length > 0 ? (
                                    <select
                                      value={String(val)}
                                      onChange={(e) =>
                                        setLiveParamValues((prev) => ({
                                          ...prev,
                                          [param.key]: e.target.value,
                                        }))
                                      }
                                      className="w-full rounded border border-[#342A24] bg-[#0B0A09] px-2 py-1 text-xs text-[#F3EEE8]"
                                    >
                                      {param.paramSpec.options.map((av) => (
                                        <option key={av} value={av}>
                                          {av}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input
                                      type="text"
                                      value={String(val)}
                                      onChange={(e) =>
                                        setLiveParamValues((prev) => ({
                                          ...prev,
                                          [param.key]: e.target.value,
                                        }))
                                      }
                                      className="w-full rounded border border-[#342A24] bg-[#0B0A09] px-2.5 py-1 text-xs text-[#F3EEE8]"
                                    />
                                  )}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 10-Point Quality & Regression Gate Panel */}
                <div
                  className="rounded-2xl border border-[#2A231E] bg-[#11100F] p-4 space-y-3"
                  data-testid="quality-gate-panel"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[#F3EEE8] flex items-center gap-2">
                      <FileCode2 className="w-4 h-4 text-[#F06424]" />
                      <span>10-Point Template Quality & Determinism Gate</span>
                    </h3>
                    <span
                      className={`px-2.5 py-0.5 rounded text-xs font-mono-tabular font-bold ${
                        selectedDraft.qualityReport
                          .quarantinedFromValidatedCatalog
                          ? 'bg-[#2A1515] text-[#F06464] border border-[#F06464]/40'
                          : 'bg-[#13261E] text-[#55B98B] border border-[#55B98B]/40'
                      }`}
                    >
                      {selectedDraft.qualityReport
                        .quarantinedFromValidatedCatalog
                        ? 'Quarantined from Validated Catalog'
                        : 'All 10 Quality Checks Passed ✓'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    {[
                      {
                        label: '1. Opens Strictly',
                        ok: selectedDraft.qualityReport.checks.opensCorrectly,
                      },
                      {
                        label: '2. Deps Surfaced',
                        ok:
                          selectedDraft.qualityReport.checks
                            .missingDependenciesSurfaced &&
                          selectedDraft.qualityReport.missingDependencies
                            .length === 0,
                      },
                      {
                        label: '3. Params Mutate Preview',
                        ok: selectedDraft.qualityReport.checks
                          .exposedParamsUpdatePreview,
                      },
                      {
                        label: `4. Deterministic (Δ=${selectedDraft.qualityReport.determinismEvidence.maxCoordDelta})`,
                        ok: selectedDraft.qualityReport.checks
                          .renderDeterministicWithinTolerance,
                      },
                      {
                        label: '5. Fallbacks Marked',
                        ok: selectedDraft.qualityReport.checks
                          .unsupportedPropertiesMarked,
                      },
                      {
                        label: '6. License & Provenance',
                        ok: selectedDraft.qualityReport.checks
                          .licensingAndProvenancePresent,
                      },
                      {
                        label: '7. Preview Matches Graph',
                        ok: selectedDraft.qualityReport.checks
                          .previewMatchesProject,
                      },
                      {
                        label: '8. Sanitized SVG Thumb',
                        ok: selectedDraft.qualityReport.checks
                          .thumbnailGenerated,
                      },
                      {
                        label: `9. Mobile (${selectedDraft.qualityReport.mobilePerformanceMetrics.budgetStatus})`,
                        ok: selectedDraft.qualityReport.checks
                          .mobilePerformanceAcceptable,
                      },
                      {
                        label: '10. Target Export Check',
                        ok: selectedDraft.qualityReport.checks
                          .targetExportValidated,
                      },
                    ].map((chk) => (
                      <div
                        key={chk.label}
                        className={`rounded-lg border p-2 flex items-center gap-1.5 ${
                          chk.ok
                            ? 'border-[#55B98B]/30 bg-[#13261E]/50 text-[#55B98B]'
                            : 'border-[#F06464]/40 bg-[#2A1515]/60 text-[#F06464]'
                        }`}
                      >
                        {chk.ok ? (
                          <Check className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <X className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span className="text-[11px] font-medium leading-tight">
                          {chk.label}
                        </span>
                      </div>
                    ))}
                  </div>

                  {selectedDraft.qualityReport.quarantineReasons.length > 0 && (
                    <div className="rounded-xl border border-[#F06464]/40 bg-[#2A1515]/50 p-3 space-y-1">
                      <div className="text-xs font-bold text-[#F06464]">
                        Quarantine / Publish Gate Reasons:
                      </div>
                      <ul className="list-disc list-inside text-[11px] text-[#F3EEE8] space-y-0.5">
                        {selectedDraft.qualityReport.quarantineReasons.map(
                          (r, i) => (
                            <li key={i}>{r}</li>
                          )
                        )}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Lifecycle Actions: Fork, Merge, Version History Restore, Deprecate, Dependency Update */}
                <div className="rounded-2xl border border-[#2A231E] bg-[#11100F] p-4 space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#F3EEE8]">
                    Template Lifecycle: Fork, Merge, Versions, Deprecation & Dependency Update
                  </h3>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleForkDraft(selectedDraft)}
                      data-testid="btn-fork-template"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#342A24] bg-[#191614] hover:border-[#F06424] text-xs font-semibold text-[#F3EEE8]"
                    >
                      <GitFork className="w-3.5 h-3.5 text-[#F06424]" />
                      <span>Fork Template</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleUpdateDependencies}
                      data-testid="btn-update-dependencies"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#342A24] bg-[#191614] hover:border-[#55B98B] text-xs font-semibold text-[#F3EEE8]"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-[#55B98B]" />
                      <span>Resolve & Update Dependencies</span>
                    </button>

                    <div className="flex items-center gap-1.5">
                      <select
                        value={mergeTargetId}
                        onChange={(e) => setMergeTargetId(e.target.value)}
                        className="rounded-lg border border-[#342A24] bg-[#191614] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
                      >
                        <option value="">Select template to merge…</option>
                        {drafts
                          .filter((d) => d.id !== selectedDraft.id)
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.title} (v{d.version})
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        disabled={!mergeTargetId}
                        onClick={handleMergeDrafts}
                        data-testid="btn-merge-template"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#342A24] bg-[#191614] disabled:opacity-40 hover:border-[#F06424] text-xs font-semibold text-[#F3EEE8]"
                      >
                        <GitMerge className="w-3.5 h-3.5 text-[#F06424]" />
                        <span>Merge</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={deprecateReason}
                        onChange={(e) => setDeprecateReason(e.target.value)}
                        placeholder="Deprecation reason"
                        className="rounded-lg border border-[#342A24] bg-[#191614] px-2.5 py-1.5 text-xs text-[#F3EEE8] w-48"
                      />
                      <button
                        type="button"
                        onClick={handleDeprecateDraft}
                        data-testid="btn-deprecate-template"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#F06464]/40 bg-[#2A1515] text-xs font-semibold text-[#F06464]"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        <span>Deprecate</span>
                      </button>
                    </div>
                  </div>

                  {/* Version History List */}
                  <div className="space-y-1.5 pt-2 border-t border-[#241E1B]">
                    <div className="text-xs font-semibold text-[#B8AAA0] flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5 text-[#F06424]" />
                      <span>
                        Version History ({selectedDraft.versionHistory.length} checkpoints)
                      </span>
                    </div>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {selectedDraft.versionHistory.map((ver) => (
                        <div
                          key={`${ver.version}-${ver.savedAt}`}
                          className="rounded-lg border border-[#241E1B] bg-[#161311] px-3 py-2 flex items-center justify-between gap-2 text-xs"
                        >
                          <div>
                            <span className="font-mono-tabular font-bold text-[#F06424]">
                              v{ver.version}
                            </span>{' '}
                            <span className="text-[#F3EEE8]">{ver.changelog}</span>{' '}
                            <span className="text-[10px] font-mono-tabular text-[#83766D]">
                              · hash {ver.snapshotHash}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRestoreVersion(ver.version)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#342A24] bg-[#191614] hover:border-[#F06424] text-[11px] text-[#F3EEE8]"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Restore</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-[#2A231E] bg-[#11100F] p-8 text-center text-xs text-[#B8AAA0]">
                Select or create a template draft to inspect its 10-point quality gate, live parameter preview, and version lifecycle.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: CONTENT-HASH & SEMANTIC SIMILARITY DEDUPLICATION */}
      {activeTab === 'deduplication' && (
        <div className="rounded-2xl border border-[#2A231E] bg-[#11100F] p-5 space-y-4">
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-[#F3EEE8] flex items-center gap-2">
              <CopyCheck className="w-4 h-4 text-[#F06424]" />
              <span>
                Content-Hash & Semantic Similarity Deduplication (Zero Automatic Deletion)
              </span>
            </h2>
            <p className="text-xs text-[#B8AAA0]">
              Sowveil computes a deterministic SHA-256 structural content hash and parameter/tag Jaccard similarity for every draft. When a template resembles an existing item, it suggests linking as a version or merging — never deleting distinct user work automatically.
            </p>
          </div>

          <div className="space-y-3">
            {drafts.flatMap((d) =>
              d.duplicateSuggestions.map((sug) => ({ draft: d, sug }))
            ).length === 0 ? (
              <div className="rounded-xl border border-[#241E1B] bg-[#161311] p-6 text-center text-xs text-[#B8AAA0]">
                No unresolved duplicate or similarity collisions detected across your current {drafts.length} template drafts. Create a second similar template in Tab 1 to test content-hash & semantic similarity detection.
              </div>
            ) : (
              drafts.map((d) =>
                d.duplicateSuggestions.map((sug) => (
                  <div
                    key={sug.suggestionId}
                    className="rounded-xl border border-[#E4B45A]/40 bg-[#161311] p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold text-[#F3EEE8]">
                          {d.title}
                        </span>
                        <span className="text-[#83766D]">matches</span>
                        <span className="font-bold text-[#E4B45A]">
                          {sug.existingTemplateTitle}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-[#292012] text-[#E4B45A] font-mono-tabular text-[10px]">
                          {sug.matchType === 'exact-content-hash'
                            ? 'Exact Structural Hash Match (100%)'
                            : `Semantic Similarity ${Math.round(
                                sug.similarityScore * 100
                              )}%`}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-[#241E1B] text-[#B8AAA0] font-mono-tabular text-[10px]">
                          Status: {sug.status}
                        </span>
                      </div>
                      <p className="text-xs text-[#B8AAA0]">
                        Shared keys/tags: {sug.sharedTagsAndParams.join(', ')}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          handleResolveDuplicateSuggestion(
                            d.id,
                            sug.suggestionId,
                            'keep-both-distinct'
                          )
                        }
                        className="px-2.5 py-1.5 rounded-lg border border-[#342A24] bg-[#191614] hover:border-[#F3EEE8] text-xs text-[#F3EEE8]"
                      >
                        Keep Both Distinct
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleResolveDuplicateSuggestion(
                            d.id,
                            sug.suggestionId,
                            'link-as-version'
                          )
                        }
                        className="px-2.5 py-1.5 rounded-lg border border-[#55B98B]/40 bg-[#13261E] text-xs font-semibold text-[#55B98B]"
                      >
                        Link as New Version
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleResolveDuplicateSuggestion(
                            d.id,
                            sug.suggestionId,
                            'merge-into-existing'
                          )
                        }
                        className="px-2.5 py-1.5 rounded-lg border border-[#F06424]/40 bg-[#2A1810] text-xs font-semibold text-[#F06424]"
                      >
                        Merge Variants
                      </button>
                      {sug.status !== 'pending-review' && (
                        <button
                          type="button"
                          onClick={() =>
                            handleResolveDuplicateSuggestion(
                              d.id,
                              sug.suggestionId,
                              'undo-suggestion'
                            )
                          }
                          className="px-2.5 py-1.5 rounded-lg border border-[#342A24] bg-[#191614] text-xs text-[#B8AAA0]"
                        >
                          Undo
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )
            )}
          </div>
        </div>
      )}

      {/* TAB 4: TRANSPARENT PREFERENCE & RANKING SIGNALS */}
      {activeTab === 'preferences' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#2A231E] bg-[#11100F] p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-sm font-bold text-[#F3EEE8]">
                Continuous Improvement via Transparent Workspace Preference Signals
              </h2>
              <p className="text-xs text-[#B8AAA0] max-w-2xl leading-relaxed">
                Preference signals adjust template ranking scores inside your workspace only when explicit consent is enabled. Private projects and media never silently train shared models (
                <code className="text-[#55B98B]">
                  allowCrossUserSharing: false
                </code>
                ,{' '}
                <code className="text-[#55B98B]">
                  silentModelTrainingEnabled: false
                </code>
                ).
              </p>
            </div>

            <label className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-[#342A24] bg-[#191614] cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={preferenceConsent.consentToPreferenceRanking}
                onChange={(e) =>
                  handleTogglePreferenceConsent(e.target.checked)
                }
                data-testid="toggle-preference-consent"
                className="rounded border-[#342A24] text-[#F06424]"
              />
              <span className="text-xs font-semibold text-[#F3EEE8]">
                Enable Workspace Preference Ranking
              </span>
            </label>
          </div>

          <div className="rounded-2xl border border-[#2A231E] bg-[#11100F] p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#B8AAA0]">
              Transparent Template Ranking Breakdown
            </h3>

            <div className="space-y-2">
              {rankedTemplates.map((item, index) => {
                const matchingDraft = drafts.find(
                  (d) => d.id === item.templateId
                );
                return (
                  <div
                    key={item.templateId}
                    className="rounded-xl border border-[#241E1B] bg-[#161311] p-3 flex flex-col md:flex-row md:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-[#241E1B] text-[#F06424] font-mono-tabular text-xs font-bold flex items-center justify-center">
                          #{index + 1}
                        </span>
                        <span className="text-xs font-bold text-[#F3EEE8]">
                          {item.title}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-[#13261E] text-[#55B98B] font-mono-tabular text-xs font-bold">
                          Score: {item.totalScore}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono-tabular text-[#B8AAA0]">
                        {item.rankingBreakdown.explanation}
                      </p>
                    </div>

                    {matchingDraft && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            handleRecordSignal(matchingDraft, 'mark-preferred')
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#55B98B]/40 bg-[#13261E] text-xs font-semibold text-[#55B98B]"
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                          <span>Prefer (+45)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleRecordSignal(matchingDraft, 'pin-for-module')
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#F06424]/40 bg-[#2A1810] text-xs font-semibold text-[#F06424]"
                        >
                          <Pin className="w-3.5 h-3.5" />
                          <span>Pin (+45)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleRecordSignal(matchingDraft, 'reject-style')
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#F06464]/40 bg-[#2A1515] text-xs font-semibold text-[#F06464]"
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                          <span>Reject Style (-65)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleRecordSignal(matchingDraft, 'clear-signal')
                          }
                          className="px-2.5 py-1.5 rounded-lg border border-[#342A24] bg-[#191614] text-xs text-[#B8AAA0]"
                        >
                          Reset
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
