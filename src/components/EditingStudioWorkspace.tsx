import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CanonicalBlendMode,
  CanonicalClip,
  CanonicalClipKind,
  CanonicalKeyframeInterpolation,
  CanonicalProjectCommand,
  CanonicalProjectDocument,
  CanonicalTrackKind,
  CanonicalTransitionSpec,
  ProjectCommandReceipt,
} from '../types/canonicalProject';
import {
  CatalogItem,
  MobileAspectRatio,
  ProjectLibraryItem,
  TargetMobileEditorId,
  TemplateVariantInstance,
} from '../types/sowveil';
import {
  CanonicalProjectStore,
  canonicalProjectToLibraryRecord,
  createCanonicalProjectFromTemplate,
  createMinimalCanonicalProject,
  evaluateProjectAtTime,
  migrateToCanonicalProject,
  serializeCanonicalProject,
  validateCanonicalProject,
} from '../services/canonicalProjectEngine';
import {
  AiCoEditLogEntry,
  AiCoEditTransaction,
  applyAiCoEditTransaction,
  buildCubicBezierSvgPath,
  diffCanonicalProjects,
  EASING_CURVE_PRESETS,
  planAiCoEditTransaction,
  simulateOperationsDiff,
} from '../services/coEditingEngine';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  EyeOff,
  Flag,
  FolderOpen,
  GitBranch,
  GitCompare,
  History,
  KeyRound,
  Layers,
  Link2,
  Lock,
  Magnet,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Scissors,
  ShieldAlert,
  SkipBack,
  SkipForward,
  Sliders,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Unlink2,
  Unlock,
  Volume2,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export type EditingDisclosureMode = 'quick' | 'pro' | 'ai';
export type ProxyRenderQuality = 'full-1080p' | 'mobile-proxy-540p' | 'ultra-light-360p';
export type ProInspectorTab =
  | 'transform'
  | 'content'
  | 'keyframes'
  | 'effects'
  | 'audio-assets'
  | 'snapshots'
  | 'validation';

export interface EditingStudioWorkspaceProps {
  mode?: 'standalone-route' | 'modal';
  onClose?: () => void;
  initialProject?: CanonicalProjectDocument | null;
  sourceLibraryProject?: ProjectLibraryItem | null;
  sourceTemplate?: CatalogItem | null;
  sourceVariant?: TemplateVariantInstance | null;
  availableProjects?: ProjectLibraryItem[];
  ownerUid?: string;
  onSaveToProjectLibrary: (
    record: Omit<ProjectLibraryItem, 'id' | 'updatedAt'> & { id?: string },
    existingProjectId?: string
  ) => Promise<void> | void;
  onNotify: (
    message: string,
    tone?: 'info' | 'warning' | 'error' | 'success'
  ) => void;
}

const AI_PROMPT_EXAMPLES: Array<{ label: string; prompt: string }> = [
  {
    label: 'Change Title',
    prompt: 'Change title to "Ship Faster on Android"',
  },
  {
    label: 'Slow Entrance (0.3s → 0.7s)',
    prompt: 'Slow entrance from 0.3 to 0.7 seconds',
  },
  {
    label: 'Replace Background',
    prompt: 'Replace scene background with #141824',
  },
  {
    label: 'Emerald Accent Palette',
    prompt: 'Adjust accent palette to #55B98B',
  },
  {
    label: 'Add Whoosh SFX @ Frame',
    prompt: 'Add whoosh SFX at selected frame',
  },
  {
    label: 'Re-time Captions',
    prompt: 'Re-time captions to selected narration',
  },
  {
    label: 'Duplicate Scene + Mapping',
    prompt: 'Duplicate scene 1 and retain its source mapping',
  },
  {
    label: 'Softer Transition',
    prompt: 'Create a softer transition',
  },
  {
    label: 'Glow Intensity 0.9',
    prompt: 'Set glow intensity to 0.9',
  },
  {
    label: 'Lock Scene 1 & Refine Scene 2',
    prompt: 'Refine scene 2 while locking scene 1',
  },
];

export const EditingStudioWorkspace: React.FC<EditingStudioWorkspaceProps> = ({
  mode = 'standalone-route',
  onClose,
  initialProject,
  sourceLibraryProject,
  sourceTemplate,
  sourceVariant,
  availableProjects = [],
  ownerUid = 'user-local',
  onSaveToProjectLibrary,
  onNotify,
}) => {
  // Resolve initial CanonicalProjectDocument with localStorage autosave recovery
  const initialCanonicalDoc = useMemo<CanonicalProjectDocument>(() => {
    const safeOwnerUid = ownerUid || 'user-local';
    if (initialProject) {
      try {
        const savedDraft = window.localStorage.getItem(
          `sowveil.canonical.autosave.${safeOwnerUid}.${initialProject.id}`
        );
        if (savedDraft) {
          const parsed = JSON.parse(savedDraft);
          const validated = validateCanonicalProject(parsed);
          if (
            validated.valid &&
            validated.project &&
            validated.project.revision >= initialProject.revision
          ) {
            return validated.project;
          }
        }
      } catch {
        // Fallback to initialProject
      }
      return initialProject;
    }

    if (sourceLibraryProject) {
      try {
        const savedDraft = window.localStorage.getItem(
          `sowveil.canonical.autosave.${safeOwnerUid}.${sourceLibraryProject.id}`
        );
        if (savedDraft) {
          const parsed = JSON.parse(savedDraft);
          const validated = validateCanonicalProject(parsed);
          if (validated.valid && validated.project) {
            return validated.project;
          }
        }
        const migrated = migrateToCanonicalProject(sourceLibraryProject, safeOwnerUid);
        return migrated.project;
      } catch {
        // Fallback below
      }
    }

    if (sourceTemplate) {
      return createCanonicalProjectFromTemplate({
        template: sourceTemplate,
        variant: sourceVariant,
        ownerUid: safeOwnerUid,
      });
    }

    // Try recovering last active project in standalone route mode (user-scoped)
    try {
      const lastActiveRaw = window.localStorage.getItem(
        `sowveil.canonical.lastActiveProject.${safeOwnerUid}`
      );
      if (lastActiveRaw) {
        const parsed = JSON.parse(lastActiveRaw);
        const validated = validateCanonicalProject(parsed);
        if (validated.valid && validated.project) {
          return validated.project;
        }
      }
    } catch {
      // Ignore storage read errors
    }

    return createMinimalCanonicalProject({
      ownerUid: safeOwnerUid,
      title: 'Sowveil Editing Studio Composition',
      aspectRatio: '9:16',
      fps: 60,
      durationSec: 6,
    });
  }, [initialProject, sourceLibraryProject, sourceTemplate, sourceVariant, ownerUid]);

  const storeRef = useRef<CanonicalProjectStore>(
    new CanonicalProjectStore(initialCanonicalDoc)
  );
  const [project, setProject] = useState<CanonicalProjectDocument>(() =>
    storeRef.current.getProject()
  );
  const [disclosureMode, setDisclosureMode] =
    useState<EditingDisclosureMode>('pro');
  const [proxyQuality, setProxyQuality] =
    useState<ProxyRenderQuality>('mobile-proxy-540p');

  const [lastReceipt, setLastReceipt] = useState<ProjectCommandReceipt | null>(null);
  const [receiptHistory, setReceiptHistory] = useState<ProjectCommandReceipt[]>([]);

  // Reset store when initialCanonicalDoc identity changes
  useEffect(() => {
    const nextStore = new CanonicalProjectStore(initialCanonicalDoc);
    storeRef.current = nextStore;
    const doc = nextStore.getProject();
    setProject(doc);
    setSelectedClipId(doc.tracks[0]?.clips[0]?.id || null);
    setSelectedTrackId(doc.tracks[0]?.id || null);
    setSelectedSceneId(doc.scenes[0]?.id || null);
    setMultiSelectedClipIds([]);
    setPlayheadSec(0);
    setIsPlaying(false);
    setReceiptHistory([]);
    setLastReceipt(null);
  }, [initialCanonicalDoc]);

  const [playheadSec, setPlayheadSec] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [loopEnabled, setLoopEnabled] = useState<boolean>(true);
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [timelineZoom, setTimelineZoom] = useState<number>(1.0);

  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(
    project.tracks[0]?.id || null
  );
  const [selectedClipId, setSelectedClipId] = useState<string | null>(
    project.tracks[0]?.clips[0]?.id || null
  );
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(
    project.scenes[0]?.id || null
  );
  const [multiSelectedClipIds, setMultiSelectedClipIds] = useState<string[]>([]);

  const [openInspectorSection, setOpenInspectorSection] =
    useState<ProInspectorTab>('transform');
  const [autosaveState, setAutosaveState] = useState<'saved' | 'saving' | 'recovered'>(
    'saved'
  );
  const [titleInput, setTitleInput] = useState<string>(project.title);
  const [snapshotLabelInput, setSnapshotLabelInput] = useState<string>('');
  const [branchNameInput, setBranchNameInput] = useState<string>('');
  const [compareSnapshotId, setCompareSnapshotId] = useState<string>('');

  // Keyframe & Easing Curve inputs
  const [newKfProperty, setNewKfProperty] = useState<string>('opacity');
  const [newKfValue, setNewKfValue] = useState<string>('1');
  const [newKfInterpolation, setNewKfInterpolation] =
    useState<CanonicalKeyframeInterpolation>('cubic-bezier');
  const [customBezier, setCustomBezier] = useState<[number, number, number, number]>([
    0.22, 1, 0.36, 1,
  ]);

  // AI Co-Edit state
  const [aiPromptInput, setAiPromptInput] = useState<string>('');
  const [activeAiTransaction, setActiveAiTransaction] =
    useState<AiCoEditTransaction | null>(null);
  const [aiCoEditLogs, setAiCoEditLogs] = useState<AiCoEditLogEntry[]>([]);

  // Drag state for timeline clip scrub/drag
  const timelineDragRef = useRef<{
    clipId: string;
    mode: 'move' | 'trim-end';
    initialX: number;
    initialStartSec: number;
    initialDurationSec: number;
    containerWidthPx: number;
  } | null>(null);

  useEffect(() => {
    setTitleInput(project.title);
  }, [project.title]);

  // Playback loop via requestAnimationFrame
  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    let lastTs = performance.now();
    const tick = (nowTs: number) => {
      const dt = (nowTs - lastTs) / 1000;
      lastTs = nowTs;
      setPlayheadSec((prev) => {
        const nextTime = prev + dt;
        if (nextTime >= project.canvas.durationSec) {
          if (loopEnabled) return 0;
          setIsPlaying(false);
          return project.canvas.durationSec;
        }
        return Number(nextTime.toFixed(3));
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, loopEnabled, project.canvas.durationSec]);

  // Frequent autosave to localStorage + recovery snapshot (user-scoped)
  useEffect(() => {
    setAutosaveState('saving');
    const safeOwnerUid = ownerUid || 'user-local';
    const timer = window.setTimeout(() => {
      try {
        const serialized = serializeCanonicalProject(project);
        window.localStorage.setItem(
          `sowveil.canonical.autosave.${safeOwnerUid}.${project.id}`,
          serialized
        );
        window.localStorage.setItem(
          `sowveil.canonical.lastActiveProject.${safeOwnerUid}`,
          serialized
        );
      } catch {
        // Ignore storage quota
      }
      setAutosaveState('saved');
    }, 220);
    return () => window.clearTimeout(timer);
  }, [project, ownerUid]);

  const dispatchCommand = (
    cmd: CanonicalProjectCommand,
    options?: {
      actorKind?: 'user' | 'ai-director';
      rationale?: string;
      silent?: boolean;
    }
  ): ProjectCommandReceipt => {
    const receipt = storeRef.current.dispatch(cmd, {
      actorId: ownerUid,
      actorKind: options?.actorKind || 'user',
      rationale: options?.rationale,
    });
    const updatedDoc = storeRef.current.getProject();
    setProject(updatedDoc);
    setLastReceipt(receipt);
    setReceiptHistory((prev) => [receipt, ...prev].slice(0, 35));

    if (!receipt.ok) {
      onNotify(
        `Command rejected (${cmd.type}): ${receipt.errors.join('; ')}`,
        'error'
      );
    } else if (!options?.silent && receipt.warnings.length > 0) {
      onNotify(receipt.warnings[0], 'warning');
    }
    return receipt;
  };

  const handleUndo = () => {
    const receipt = storeRef.current.undo(ownerUid);
    setProject(storeRef.current.getProject());
    setLastReceipt(receipt);
    setReceiptHistory((prev) => [receipt, ...prev].slice(0, 35));
    if (receipt.ok) {
      onNotify(`Undid edit → Revision r${receipt.revision}`, 'info');
    } else {
      onNotify(receipt.errors[0] || 'Nothing to undo.', 'warning');
    }
  };

  const handleRedo = () => {
    const receipt = storeRef.current.redo(ownerUid);
    setProject(storeRef.current.getProject());
    setLastReceipt(receipt);
    setReceiptHistory((prev) => [receipt, ...prev].slice(0, 35));
    if (receipt.ok) {
      onNotify(`Redid edit → Revision r${receipt.revision}`, 'info');
    } else {
      onNotify(receipt.errors[0] || 'Nothing to redo.', 'warning');
    }
  };

  const selectedClipInfo = useMemo<{
    clip: CanonicalClip;
    trackId: string;
  } | null>(() => {
    if (!selectedClipId) return null;
    for (const track of project.tracks) {
      const found = track.clips.find((c) => c.id === selectedClipId);
      if (found) return { clip: found, trackId: track.id };
    }
    return null;
  }, [project, selectedClipId]);

  const selectedClip = selectedClipInfo?.clip || null;

  const evaluatedFrames = useMemo(
    () => evaluateProjectAtTime(project, playheadSec),
    [project, playheadSec]
  );

  const liveValidation = useMemo(
    () => validateCanonicalProject(project),
    [project]
  );

  // Compute snap points (0s, scenes, markers, clip start/end edges)
  const snapPointsSec = useMemo(() => {
    const pts = new Set<number>([0, project.canvas.durationSec]);
    for (const s of project.scenes) {
      pts.add(s.startTimeSec);
      pts.add(Number((s.startTimeSec + s.durationSec).toFixed(3)));
    }
    for (const m of project.markers) pts.add(m.timeSec);
    for (const t of project.tracks) {
      for (const c of t.clips) {
        pts.add(c.startTimeSec);
        pts.add(Number((c.startTimeSec + c.durationSec).toFixed(3)));
      }
    }
    return Array.from(pts).sort((a, b) => a - b);
  }, [project]);

  const snapTime = (rawSec: number): number => {
    const clamped = Math.max(0, Number(rawSec.toFixed(2)));
    if (!snapEnabled) return clamped;
    const threshold = 0.12;
    for (const pt of snapPointsSec) {
      if (Math.abs(clamped - pt) <= threshold) {
        return pt;
      }
    }
    return clamped;
  };

  const currentFrameNumber = Math.round(playheadSec * project.canvas.fps);
  const frameStepSec = Number((1 / project.canvas.fps).toFixed(4));

  const stepFrame = (deltaFrames: number) => {
    setIsPlaying(false);
    setPlayheadSec((prev) => {
      const next = Math.max(
        0,
        Math.min(
          project.canvas.durationSec,
          Number((prev + deltaFrames * frameStepSec).toFixed(3))
        )
      );
      return next;
    });
  };

  // Pointer drag handlers for timeline clips
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const drag = timelineDragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.initialX;
      const deltaSec =
        (dx / Math.max(120, drag.containerWidthPx)) * project.canvas.durationSec;
      if (drag.mode === 'move') {
        const nextStart = snapTime(Math.max(0, drag.initialStartSec + deltaSec));
        dispatchCommand(
          {
            type: 'moveClip',
            clipId: drag.clipId,
            startTimeSec: nextStart,
            moveGroup: true,
          },
          { silent: true }
        );
      } else if (drag.mode === 'trim-end') {
        const nextDur = Math.max(
          0.15,
          Number((drag.initialDurationSec + deltaSec).toFixed(2))
        );
        dispatchCommand(
          {
            type: 'trimClip',
            clipId: drag.clipId,
            durationSec: nextDur,
          },
          { silent: true }
        );
      }
    };

    const handlePointerUp = () => {
      timelineDragRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  });

  const handleSaveProjectToLibrary = async () => {
    const record = canonicalProjectToLibraryRecord(project);
    await onSaveToProjectLibrary(record, sourceLibraryProject?.id || project.id);
    onNotify(
      `Saved canonical project "${project.title}" (v2.0 · rev r${project.revision}) to Project Library.`,
      'success'
    );
  };

  const handleDownloadCanonicalJson = () => {
    const json = serializeCanonicalProject(project);
    const slug = project.title.replace(/[^a-z0-9\-]/gi, '-').toLowerCase();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.canonical.sowveil.json`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify(`Exported "${slug}.canonical.sowveil.json" (schema v2.0.0).`, 'success');
  };

  // Snapshot comparison diff
  const snapshotComparisonDiff = useMemo(() => {
    if (!compareSnapshotId) {
      return diffCanonicalProjects(initialCanonicalDoc, project);
    }
    const snap = project.snapshots.find((s) => s.id === compareSnapshotId);
    if (!snap) return diffCanonicalProjects(initialCanonicalDoc, project);
    try {
      const parsed = JSON.parse(snap.serializedStateJson) as CanonicalProjectDocument;
      return diffCanonicalProjects(parsed, project);
    } catch {
      return diffCanonicalProjects(initialCanonicalDoc, project);
    }
  }, [compareSnapshotId, initialCanonicalDoc, project]);

  // AI Co-Edit handlers
  const handlePlanAiPrompt = (overridePrompt?: string) => {
    const promptToUse = (overridePrompt ?? aiPromptInput).trim();
    if (overridePrompt !== undefined) {
      setAiPromptInput(overridePrompt);
    }
    const tx = planAiCoEditTransaction({
      project,
      prompt: promptToUse,
      selectedClipId,
      selectedSceneId,
      playheadSec,
    });
    setActiveAiTransaction(tx);
  };

  const handleToggleAiOperation = (opId: string) => {
    if (!activeAiTransaction) return;
    const nextOps = activeAiTransaction.operations.map((o) =>
      o.id === opId ? { ...o, selected: !o.selected } : o
    );
    const sim = simulateOperationsDiff(project, nextOps);
    setActiveAiTransaction({
      ...activeAiTransaction,
      operations: nextOps,
      proposedDiff: sim.diff,
    });
  };

  const handleApplyAiTransaction = () => {
    if (!activeAiTransaction) return;
    const selectedIds = activeAiTransaction.operations
      .filter((o) => o.selected)
      .map((o) => o.id);
    const res = applyAiCoEditTransaction({
      project,
      transaction: activeAiTransaction,
      selectedOperationIds: selectedIds,
      actorId: ownerUid,
    });

    if (!res.ok) {
      onNotify(
        `AI Transaction blocked: ${res.errors.join('; ')}`,
        'error'
      );
      return;
    }

    storeRef.current.commitValidatedProjectState(res.project, 'createSnapshot');
    setProject(storeRef.current.getProject());
    if (res.receipts.length > 0) {
      setLastReceipt(res.receipts[res.receipts.length - 1]);
      setReceiptHistory((prev) => [...res.receipts.reverse(), ...prev].slice(0, 35));
    }
    if (res.logEntry) {
      setAiCoEditLogs((prev) => [res.logEntry!, ...prev]);
    }
    setActiveAiTransaction(res.transaction);
    onNotify(
      `Applied ${res.logEntry?.acceptedOperationCount || 1} AI Co-Edit operation(s) → Revision r${res.project.revision} (Checkpoint saved).`,
      'success'
    );
  };

  const handleRollbackAiLog = (log: AiCoEditLogEntry) => {
    const receipt = dispatchCommand(
      {
        type: 'restoreSnapshot',
        snapshotId: log.checkpointSnapshotId,
      },
      {
        actorKind: 'user',
        rationale: `Rolled back AI transaction "${log.prompt}" to checkpoint ${log.checkpointSnapshotId}`,
      }
    );
    if (receipt.ok) {
      setAiCoEditLogs((prev) =>
        prev.map((item) =>
          item.id === log.id ? { ...item, rolledBack: true } : item
        )
      );
      onNotify(
        `Rolled back AI edit "${log.prompt}" to checkpoint ${log.checkpointSnapshotId}.`,
        'info'
      );
    }
  };

  const bezierSvg = useMemo(
    () => buildCubicBezierSvgPath(customBezier, 180, 100, 14),
    [customBezier]
  );

  // Determine unsupported/degraded effects currently on timeline
  const unsupportedEffectsList = useMemo(() => {
    const list: Array<{ clipName: string; effectName: string; support: string }> = [];
    for (const t of project.tracks) {
      for (const c of t.clips) {
        for (const e of c.effects) {
          if (e.enabled && e.rendererSupport !== 'supported') {
            list.push({
              clipName: c.name,
              effectName: e.name,
              support: e.rendererSupport,
            });
          }
        }
      }
    }
    return list;
  }, [project]);

  const missingAssetsList = useMemo(
    () => project.assetReferences.filter((a) => a.missing),
    [project.assetReferences]
  );

  return (
    <div
      role={mode === 'modal' ? 'dialog' : 'region'}
      aria-modal={mode === 'modal' ? 'true' : undefined}
      aria-label="Sowveil Professional Mobile Editing Studio & AI Co-Editor"
      className={
        mode === 'modal'
          ? 'fixed inset-0 z-50 bg-[#080707]/95 backdrop-blur-md flex flex-col text-[#F3EEE8] overflow-hidden'
          : 'min-h-[calc(100vh-110px)] bg-[#080707] flex flex-col text-[#F3EEE8]'
      }
    >
      {/* Top Bar: Project Selector, Title, Progressive Disclosure Mode Switcher, Undo/Redo, Save */}
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-5 py-2.5 border-b border-[#2A231E] bg-[#0B0A09] shrink-0">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="text-[11px] font-mono-tabular font-bold uppercase tracking-wider text-[#F06424]">
            Editing Studio v2.0
          </span>
          <span aria-hidden="true" className="text-[#4A4039]">
            ·
          </span>

          {/* Switch project from Project Library if available */}
          {availableProjects.length > 0 && (
            <select
              aria-label="Load Project from Library"
              value={project.id}
              onChange={(e) => {
                const chosen = availableProjects.find((p) => p.id === e.target.value);
                if (chosen) {
                  try {
                    const migrated = migrateToCanonicalProject(chosen, ownerUid);
                    const nextStore = new CanonicalProjectStore(migrated.project);
                    storeRef.current = nextStore;
                    setProject(nextStore.getProject());
                    setSelectedClipId(
                      nextStore.getProject().tracks[0]?.clips[0]?.id || null
                    );
                    onNotify(`Opened project "${chosen.title}" in Editing Studio.`, 'info');
                  } catch (err) {
                    onNotify(
                      `Failed to open project: ${err instanceof Error ? err.message : 'Error'}`,
                      'error'
                    );
                  }
                }
              }}
              className="min-h-[40px] max-w-[160px] rounded-lg border border-[#2A231E] bg-[#141210] px-2 text-xs text-[#D8CFC8]"
            >
              <option value={project.id}>Active: {project.title.slice(0, 22)}</option>
              {availableProjects
                .filter((p) => p.id !== project.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
            </select>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (titleInput.trim() && titleInput.trim() !== project.title) {
                dispatchCommand({
                  type: 'renameProject',
                  title: titleInput.trim(),
                });
              }
            }}
            className="flex items-center gap-1.5 min-w-0"
          >
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={() => {
                if (titleInput.trim() && titleInput.trim() !== project.title) {
                  dispatchCommand({
                    type: 'renameProject',
                    title: titleInput.trim(),
                  });
                }
              }}
              aria-label="Canonical Project Title"
              className="min-h-[40px] w-36 sm:w-52 rounded-lg border border-[#2A231E] bg-[#141210] px-2.5 py-1 text-xs font-semibold text-[#F3EEE8] focus:border-[#F06424] outline-none"
            />
          </form>

          <span
            data-testid="editor-autosave-status"
            className="hidden xl:inline text-[11px] font-mono-tabular text-[#55B98B]"
          >
            {autosaveState === 'saving'
              ? 'Autosaving…'
              : `Autosaved · r${project.revision} · ${project.activeBranch}`}
          </span>
        </div>

        {/* Progressive Disclosure Mode Switcher: Quick | Pro | AI Co-Edit */}
        <div
          role="tablist"
          aria-label="Editing Studio Disclosure Mode"
          className="flex items-center gap-1 p-1 rounded-xl bg-[#141210] border border-[#2A231E]"
        >
          {(
            [
              { id: 'quick', label: 'Quick Mode' },
              { id: 'pro', label: 'Pro Timeline' },
              { id: 'ai', label: 'AI Co-Edit' },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={disclosureMode === m.id}
              data-testid={`editor-mode-${m.id}`}
              onClick={() => setDisclosureMode(m.id)}
              className={`min-h-[38px] px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                disclosureMode === m.id
                  ? 'bg-[#F06424] text-[#080707]'
                  : 'text-[#B8AAA0] hover:text-[#F3EEE8]'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Touch-Safe Undo / Redo / Save / Export / Close Controls (>= 44px height) */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!storeRef.current.canUndo()}
            aria-label="Undo command"
            title="Undo last command"
            data-testid="editor-undo-btn"
            className="min-h-[44px] min-w-[44px] px-2.5 rounded-lg border border-[#2A231E] bg-[#141210] hover:border-[#F06424] disabled:opacity-40 inline-flex items-center justify-center gap-1 text-xs font-medium text-[#F3EEE8]"
          >
            <Undo2 className="w-4 h-4 text-[#F06424]" />
            <span className="hidden sm:inline">Undo</span>
          </button>

          <button
            type="button"
            onClick={handleRedo}
            disabled={!storeRef.current.canRedo()}
            aria-label="Redo command"
            title="Redo command"
            data-testid="editor-redo-btn"
            className="min-h-[44px] min-w-[44px] px-2.5 rounded-lg border border-[#2A231E] bg-[#141210] hover:border-[#F06424] disabled:opacity-40 inline-flex items-center justify-center gap-1 text-xs font-medium text-[#F3EEE8]"
          >
            <Redo2 className="w-4 h-4 text-[#F06424]" />
            <span className="hidden sm:inline">Redo</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadCanonicalJson}
            className="min-h-[44px] px-3 rounded-lg border border-[#2A231E] bg-[#141210] hover:border-[#F06424] inline-flex items-center gap-1.5 text-xs font-medium text-[#D8CFC8]"
          >
            <Download className="w-3.5 h-3.5 text-[#F06424]" />
            <span className="hidden lg:inline">.sowveil.json</span>
          </button>

          <button
            type="button"
            onClick={handleSaveProjectToLibrary}
            data-testid="editor-save-project-btn"
            className="min-h-[44px] px-3.5 rounded-lg bg-[#F06424] hover:bg-[#FF7434] text-[#080707] font-bold text-xs inline-flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Project</span>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Editing Studio"
              className="min-h-[44px] min-w-[44px] rounded-lg border border-[#2A231E] bg-[#141210] hover:border-[#F06464] text-[#B8AAA0] hover:text-[#F3EEE8] inline-flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Main Split Workspace: Left Preview + Multi-Track Timeline, Right Progressive Inspector / AI Co-Editor */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-y-auto lg:overflow-hidden">
        {/* Left Column (7 cols on lg): Canvas Preview + Transport + Scene Bar + Multi-Track Timeline */}
        <div className="lg:col-span-7 flex flex-col border-b lg:border-b-0 lg:border-r border-[#2A231E] bg-[#0B0A09] min-h-0">
          {/* Canvas Subbar: Aspect Ratio, Proxy Quality Mode, Preview Fidelity Notice, Timecode & Frame */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-[#1E1C1A] text-xs font-mono-tabular">
            <div className="flex flex-wrap items-center gap-1.5">
              {(['9:16', '1:1', '16:9'] as MobileAspectRatio[]).map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() =>
                    dispatchCommand({
                      type: 'updateCanvas',
                      canvas: { aspectRatio: ratio },
                    })
                  }
                  className={`min-h-[36px] px-2.5 py-1 rounded border text-[11px] font-semibold ${
                    project.canvas.aspectRatio === ratio
                      ? 'border-[#F06424] bg-[#2A1810] text-[#F06424]'
                      : 'border-[#2A231E] bg-[#141210] text-[#9E958E]'
                  }`}
                >
                  {ratio}
                </button>
              ))}

              {/* Proxy Quality Selector for Mobile GPU / Memory Efficiency */}
              <select
                aria-label="Preview Proxy Quality Mode"
                value={proxyQuality}
                onChange={(e) =>
                  setProxyQuality(e.target.value as ProxyRenderQuality)
                }
                className="min-h-[36px] rounded border border-[#2A231E] bg-[#141210] px-2 text-[11px] text-[#D8CFC8]"
              >
                <option value="mobile-proxy-540p">Proxy 540p (Mobile Fast)</option>
                <option value="ultra-light-360p">Draft 360p (Low-End Phone)</option>
                <option value="full-1080p">Full {project.canvas.width}×{project.canvas.height}</option>
              </select>

              <span
                title="Distinguishes interactive browser preview from final rendered export"
                className="text-[10.5px] text-[#E4B45A]"
              >
                Interactive Preview · Not Final Render
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span
                data-testid="editor-timecode-display"
                className="px-2 py-1 rounded bg-[#141210] border border-[#2A231E] text-[#F06424] font-bold"
              >
                {playheadSec.toFixed(2)}s / {project.canvas.durationSec.toFixed(2)}s
              </span>
              <span
                data-testid="editor-frame-display"
                className="text-[11px] text-[#B8AAA0]"
              >
                Frame #{currentFrameNumber} ({project.canvas.fps}fps)
              </span>
            </div>
          </div>

          {/* Honest Unsupported Feature / Missing Asset Banner on Preview */}
          {(unsupportedEffectsList.length > 0 ||
            project.unsupportedFeatures.length > 0 ||
            missingAssetsList.length > 0) && (
            <div className="px-3 py-1.5 bg-[#241B12] border-b border-[#E4B45A]/30 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#E4B45A]">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {missingAssetsList.length > 0 &&
                    `${missingAssetsList.length} missing asset(s) · `}
                  {unsupportedEffectsList.length > 0 &&
                    `${unsupportedEffectsList.length} effect(s) using 2D proxy fallback · `}
                  {project.unsupportedFeatures.length > 0 &&
                    `${project.unsupportedFeatures.length} feature notice(s)`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDisclosureMode('pro');
                  setOpenInspectorSection(
                    missingAssetsList.length > 0 ? 'audio-assets' : 'validation'
                  );
                }}
                className="underline font-semibold hover:text-[#F3EEE8]"
              >
                Open Recovery Options →
              </button>
            </div>
          )}

          {/* Interactive 2D/Vector Preview Stage */}
          <div className="flex-1 flex items-center justify-center p-3 sm:p-4 bg-[#070606] min-h-[210px] relative overflow-hidden">
            <div
              style={{
                backgroundColor:
                  project.canvas.backgroundAlphaMode === 'chroma-key-green'
                    ? '#00FF00'
                    : project.canvas.backgroundColorHex,
                aspectRatio:
                  project.canvas.aspectRatio === '9:16'
                    ? '9 / 16'
                    : project.canvas.aspectRatio === '1:1'
                    ? '1 / 1'
                    : '16 / 9',
                filter:
                  proxyQuality === 'ultra-light-360p'
                    ? 'contrast(0.98)'
                    : undefined,
              }}
              className="relative h-full max-h-[260px] sm:max-h-[300px] w-auto max-w-full rounded-xl border border-[#2A231E] shadow-2xl overflow-hidden flex items-center justify-center"
            >
              {/* Safe-Area Guides */}
              <div className="pointer-events-none absolute inset-3 border border-dashed border-[#F3EEE8]/10 rounded-lg" />

              {evaluatedFrames.length === 0 ? (
                <div className="text-center p-4 text-[11px] font-mono-tabular text-[#6E665F]">
                  No visible clips at {playheadSec.toFixed(2)}s (Frame #{currentFrameNumber})
                </div>
              ) : (
                evaluatedFrames.map(({ clip, transform }) => {
                  const normX =
                    ((transform.position[0] - project.canvas.width / 2) /
                      project.canvas.width) *
                    100;
                  const normY =
                    ((transform.position[1] - project.canvas.height / 2) /
                      project.canvas.height) *
                    100;
                  const glowEffect = clip.effects.find(
                    (e) =>
                      e.enabled &&
                      e.rendererSupport === 'supported' &&
                      e.effectType.includes('glow')
                  );
                  const unimplementedEffect = clip.effects.find(
                    (e) => e.enabled && e.rendererSupport === 'unsupported'
                  );
                  const isSelected = clip.id === selectedClipId;

                  return (
                    <div
                      key={clip.id}
                      onClick={() => {
                        setSelectedClipId(clip.id);
                        setSelectedTrackId(clip.trackId);
                        if (clip.sceneId) setSelectedSceneId(clip.sceneId);
                      }}
                      style={{
                        opacity: transform.opacity,
                        transform: `translate(${normX}%, ${normY}%) scale(${transform.scale[0]}, ${transform.scale[1]}) rotate(${transform.rotationDeg}deg)`,
                      }}
                      className={`cursor-pointer transition-shadow px-3 py-2 rounded-xl ${
                        isSelected ? 'ring-2 ring-[#F06424]' : ''
                      }`}
                    >
                      {clip.kind === 'vector' && clip.vectorData && (
                        <div
                          style={{
                            backgroundColor: `${clip.vectorData.fillColorHex}CC`,
                            borderColor: clip.vectorData.strokeColorHex,
                            borderWidth: `${Math.max(1, clip.vectorData.strokeWidthPx)}px`,
                            borderRadius: `${Math.min(28, clip.vectorData.cornerRadiusPx)}px`,
                          }}
                          className="w-36 h-20 backdrop-blur-md flex items-center justify-center text-[11px] font-mono-tabular text-[#F3EEE8]"
                        >
                          {clip.name}
                        </div>
                      )}

                      {(clip.kind === 'text' || clip.kind === 'template-instance') && (
                        <div
                          style={{
                            color: clip.textData?.colorHex || '#F3EEE8',
                            fontSize: `${Math.max(
                              13,
                              Math.min(28, Math.round((clip.textData?.fontSizePx || 60) * 0.32))
                            )}px`,
                            fontWeight: clip.textData?.fontWeight || 800,
                            textAlign: clip.textData?.alignment || 'center',
                            textTransform: clip.textData?.textTransform || 'none',
                            textShadow: glowEffect
                              ? `0 0 18px ${String(
                                  glowEffect.parameters.tintColor || '#F06424'
                                )}`
                              : '0 2px 10px rgba(0,0,0,0.65)',
                          }}
                          className="tracking-tight select-none max-w-[220px] break-words"
                        >
                          {clip.textData?.content || clip.name}
                          {clip.templateBinding && (
                            <div className="mt-1 text-[9px] font-mono-tabular uppercase tracking-wider text-[#F06424]">
                              {clip.templateBinding.baseTemplateId} · {clip.templateBinding.editabilityLevel}
                            </div>
                          )}
                          {unimplementedEffect && (
                            <div className="mt-1 text-[9px] font-mono-tabular text-[#E4B45A]">
                              [Unrendered FX: {unimplementedEffect.name}]
                            </div>
                          )}
                        </div>
                      )}

                      {clip.kind === 'caption' && clip.captionData && (
                        <div
                          style={{
                            borderColor: clip.captionData.highlightColorHex,
                          }}
                          className="mt-12 px-3 py-1.5 rounded-lg border-2 bg-[#0B0A09]/90 text-xs font-extrabold text-[#F3EEE8] text-center shadow-lg"
                        >
                          {clip.captionData.speaker && (
                            <span className="text-[10px] font-mono-tabular text-[#F06424] mr-1">
                              {clip.captionData.speaker}:
                            </span>
                          )}
                          {clip.captionData.text}
                        </div>
                      )}

                      {clip.kind === 'audio' && (
                        <div className="px-2.5 py-1 rounded bg-[#191614]/90 border border-[#55B98B]/50 text-[10px] font-mono-tabular text-[#55B98B] flex items-center gap-1">
                          <Volume2 className="w-3 h-3" />
                          <span>
                            {clip.name} ({clip.audioConfig?.gainDb ?? 0} dB)
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Transport Bar: Jump Start, -1f, Play/Pause, +1f, Loop, Scrub Slider, Split/Duplicate/Delete */}
          <div className="px-3 py-2 border-t border-[#2A231E] bg-[#11100F] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setPlayheadSec(0);
                }}
                aria-label="Jump to start"
                className="min-h-[44px] min-w-[40px] rounded-lg border border-[#2A231E] bg-[#181615] hover:border-[#F06424] inline-flex items-center justify-center text-[#D8CFC8]"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => stepFrame(-1)}
                aria-label="Previous frame"
                title="Step back 1 frame"
                className="min-h-[44px] min-w-[40px] rounded-lg border border-[#2A231E] bg-[#181615] hover:border-[#F06424] inline-flex items-center justify-center text-[#D8CFC8]"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setIsPlaying((p) => !p)}
                aria-label={isPlaying ? 'Pause playback' : 'Start playback'}
                data-testid="editor-play-pause-btn"
                className="min-h-[44px] px-3.5 rounded-lg bg-[#F06424] hover:bg-[#FF7434] text-[#080707] font-bold text-xs inline-flex items-center gap-1.5"
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-4 h-4" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    <span>Play</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => stepFrame(1)}
                aria-label="Next frame"
                title="Step forward 1 frame"
                className="min-h-[44px] min-w-[40px] rounded-lg border border-[#2A231E] bg-[#181615] hover:border-[#F06424] inline-flex items-center justify-center text-[#D8CFC8]"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setLoopEnabled((v) => !v)}
                className={`min-h-[44px] px-2.5 rounded-lg border text-xs font-medium ${
                  loopEnabled
                    ? 'border-[#F06424] bg-[#2A1810] text-[#F06424]'
                    : 'border-[#2A231E] bg-[#181615] text-[#9E958E]'
                }`}
              >
                Loop
              </button>
            </div>

            {/* Playhead Scrub Range */}
            <div className="flex-1 min-w-[140px] flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={project.canvas.durationSec}
                step={0.01}
                value={playheadSec}
                onChange={(e) => {
                  setIsPlaying(false);
                  setPlayheadSec(snapTime(Number(e.target.value)));
                }}
                aria-label="Scrub timeline playhead"
                className="w-full accent-[#F06424] h-2 cursor-pointer"
              />
            </div>

            {/* Quick Clip Actions at Playhead */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!selectedClip}
                onClick={() => {
                  if (!selectedClip) return;
                  dispatchCommand({
                    type: 'splitClip',
                    clipId: selectedClip.id,
                    splitTimeSec: playheadSec,
                  });
                }}
                title="Split selected clip at playhead"
                data-testid="editor-split-clip-btn"
                className="min-h-[44px] px-2.5 rounded-lg border border-[#2A231E] bg-[#181615] hover:border-[#F06424] disabled:opacity-40 text-xs font-medium text-[#F3EEE8] inline-flex items-center gap-1"
              >
                <Scissors className="w-3.5 h-3.5 text-[#F06424]" />
                <span>Split</span>
              </button>

              <button
                type="button"
                disabled={!selectedClip}
                onClick={() => {
                  if (!selectedClip) return;
                  const r = dispatchCommand({
                    type: 'duplicateClip',
                    clipId: selectedClip.id,
                    retainSourceMapping: true,
                  });
                  if (r.ok && r.changedIds[0]) {
                    setSelectedClipId(r.changedIds[0]);
                  }
                }}
                title="Duplicate selected clip"
                data-testid="editor-duplicate-clip-btn"
                className="min-h-[44px] px-2.5 rounded-lg border border-[#2A231E] bg-[#181615] hover:border-[#F06424] disabled:opacity-40 text-xs font-medium text-[#F3EEE8] inline-flex items-center gap-1"
              >
                <Copy className="w-3.5 h-3.5 text-[#F06424]" />
                <span className="hidden sm:inline">Duplicate</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  dispatchCommand({
                    type: 'addMarker',
                    marker: {
                      timeSec: playheadSec,
                      label: `Cue @ ${playheadSec.toFixed(1)}s`,
                      colorHex: '#F06424',
                      kind: 'beat',
                    },
                  })
                }
                title="Add marker at playhead"
                className="min-h-[44px] px-2.5 rounded-lg border border-[#2A231E] bg-[#181615] hover:border-[#F06424] text-xs font-medium text-[#F3EEE8] inline-flex items-center gap-1"
              >
                <Flag className="w-3.5 h-3.5 text-[#F06424]" />
                <span className="hidden xl:inline">+ Marker</span>
              </button>

              <button
                type="button"
                disabled={!selectedClip}
                onClick={() => {
                  if (!selectedClip) return;
                  const idToDelete = selectedClip.id;
                  const r = dispatchCommand({
                    type: 'deleteClip',
                    clipId: idToDelete,
                  });
                  if (r.ok) setSelectedClipId(null);
                }}
                aria-label="Delete selected clip"
                data-testid="editor-delete-clip-btn"
                className="min-h-[44px] min-w-[44px] rounded-lg border border-[#2A231E] bg-[#181615] hover:border-[#F06464] disabled:opacity-40 text-[#F06464] inline-flex items-center justify-center"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Scene / Shot Navigation Bar */}
          <div className="px-3 py-2 border-t border-[#2A231E] bg-[#0D0C0B] flex items-center gap-2 overflow-x-auto">
            <span className="text-[10px] font-mono-tabular uppercase tracking-wider text-[#8E857E] shrink-0">
              Scenes ({project.scenes.length}):
            </span>
            {project.scenes.map((scene) => {
              const isSelected = scene.id === selectedSceneId;
              const isLocked = scene.status === 'locked';
              return (
                <div
                  key={scene.id}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs shrink-0 ${
                    isSelected
                      ? 'border-[#F06424] bg-[#2A1810] text-[#F3EEE8]'
                      : 'border-[#24211F] bg-[#141210] text-[#B8AAA0]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSceneId(scene.id);
                      setPlayheadSec(scene.startTimeSec);
                    }}
                    className="font-semibold text-left"
                  >
                    {scene.title} ({scene.startTimeSec.toFixed(1)}s)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      dispatchCommand({
                        type: 'setSceneState',
                        sceneId: scene.id,
                        status: isLocked ? 'draft' : 'locked',
                        lockSceneClips: !isLocked,
                      })
                    }
                    title={isLocked ? 'Unlock scene' : 'Lock scene against edits'}
                    aria-label={isLocked ? `Unlock ${scene.title}` : `Lock ${scene.title}`}
                    className={`p-1 rounded ${
                      isLocked ? 'text-[#E4B45A]' : 'text-[#787069] hover:text-[#F3EEE8]'
                    }`}
                  >
                    {isLocked ? (
                      <Lock className="w-3 h-3" />
                    ) : (
                      <Unlock className="w-3 h-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      dispatchCommand({
                        type: 'duplicateScene',
                        sceneId: scene.id,
                        retainSourceMapping: true,
                      })
                    }
                    title="Duplicate scene and retain source segment mapping"
                    aria-label={`Duplicate ${scene.title}`}
                    className="p-1 rounded text-[#787069] hover:text-[#F06424]"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Multi-Track Timeline Area */}
          <div className="border-t border-[#2A231E] bg-[#0E0D0C] p-3 space-y-2.5 overflow-y-auto max-h-[320px]">
            {/* Timeline Toolbar: Add Clip, Add Track, Group/Ungroup, Snap, Zoom & Zoom-to-Fit */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const targetTrack =
                      project.tracks.find((t) => t.id === selectedTrackId) ||
                      project.tracks[0];
                    if (!targetTrack) return;
                    const kindMap: Record<CanonicalTrackKind, CanonicalClipKind> = {
                      text: 'text',
                      vector: 'vector',
                      caption: 'caption',
                      audio: 'audio',
                      template: 'template-instance',
                      video: 'video',
                      effect: 'adjustment-effect',
                      camera3d: 'camera-3d',
                    };
                    const r = dispatchCommand({
                      type: 'createClip',
                      trackId: targetTrack.id,
                      clip: {
                        name: `New ${targetTrack.kind} Clip`,
                        kind: kindMap[targetTrack.kind] || 'text',
                        sceneId: selectedSceneId || project.scenes[0]?.id,
                        startTimeSec: playheadSec,
                        durationSec: 2,
                      },
                    });
                    if (r.ok && r.changedIds[0]) {
                      setSelectedClipId(r.changedIds[0]);
                    }
                  }}
                  data-testid="editor-add-clip-btn"
                  className="min-h-[40px] px-3 rounded-lg bg-[#2A1810] border border-[#F06424]/60 text-[#F06424] font-semibold text-xs inline-flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Clip</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    dispatchCommand({
                      type: 'createTrack',
                      name: `Track ${project.tracks.length + 1}`,
                      kind: 'text',
                    })
                  }
                  className="min-h-[40px] px-2.5 rounded-lg border border-[#2A231E] bg-[#141210] hover:border-[#F06424] text-xs text-[#D8CFC8] inline-flex items-center gap-1"
                >
                  <Layers className="w-3.5 h-3.5 text-[#F06424]" />
                  <span>+ Track</span>
                </button>

                {/* Group / Ungroup Controls */}
                <button
                  type="button"
                  disabled={multiSelectedClipIds.length < 2}
                  onClick={() => {
                    const r = dispatchCommand({
                      type: 'groupClips',
                      clipIds: multiSelectedClipIds,
                    });
                    if (r.ok) {
                      onNotify(
                        `Grouped ${multiSelectedClipIds.length} clips together.`,
                        'success'
                      );
                    }
                  }}
                  title="Select 2+ clips using their checkboxes to group them"
                  className="min-h-[40px] px-2.5 rounded-lg border border-[#2A231E] bg-[#141210] hover:border-[#F06424] disabled:opacity-40 text-xs text-[#D8CFC8] inline-flex items-center gap-1"
                >
                  <Link2 className="w-3.5 h-3.5 text-[#F06424]" />
                  <span>Group ({multiSelectedClipIds.length})</span>
                </button>

                {selectedClip?.groupId && (
                  <button
                    type="button"
                    onClick={() =>
                      dispatchCommand({
                        type: 'ungroupClips',
                        groupId: selectedClip.groupId,
                      })
                    }
                    className="min-h-[40px] px-2.5 rounded-lg border border-[#E4B45A]/50 bg-[#241B12] text-xs text-[#E4B45A] inline-flex items-center gap-1"
                  >
                    <Unlink2 className="w-3.5 h-3.5" />
                    <span>Ungroup</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSnapEnabled((s) => !s)}
                  className={`min-h-[40px] px-2.5 rounded-lg border text-xs inline-flex items-center gap-1 ${
                    snapEnabled
                      ? 'border-[#55B98B] bg-[#55B98B]/15 text-[#55B98B]'
                      : 'border-[#2A231E] bg-[#141210] text-[#8E857E]'
                  }`}
                >
                  <Magnet className="w-3.5 h-3.5" />
                  <span>Snap</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setTimelineZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))
                  }
                  aria-label="Zoom out timeline"
                  className="min-h-[40px] min-w-[38px] rounded-lg border border-[#2A231E] bg-[#141210] inline-flex items-center justify-center text-[#B8AAA0]"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setTimelineZoom(1.0)}
                  title="Zoom to Fit (100%)"
                  className="min-h-[40px] px-2 rounded-lg border border-[#2A231E] bg-[#141210] hover:border-[#F06424] text-[11px] font-mono-tabular text-[#D8CFC8]"
                >
                  {Math.round(timelineZoom * 100)}% Fit
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setTimelineZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))
                  }
                  aria-label="Zoom in timeline"
                  className="min-h-[40px] min-w-[38px] rounded-lg border border-[#2A231E] bg-[#141210] inline-flex items-center justify-center text-[#B8AAA0]"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Time Ruler with Markers */}
            <div className="relative h-7 rounded bg-[#141210] border border-[#24211F] px-2 flex items-center justify-between text-[10px] font-mono-tabular text-[#787069] select-none">
              {Array.from({ length: Math.ceil(project.canvas.durationSec) + 1 }).map(
                (_, secIdx) => (
                  <button
                    key={secIdx}
                    type="button"
                    onClick={() => setPlayheadSec(secIdx)}
                    className="hover:text-[#F06424]"
                  >
                    {secIdx}s
                  </button>
                )
              )}
              {project.markers.map((m) => {
                const leftPct = Math.min(
                  98,
                  Math.max(1, (m.timeSec / project.canvas.durationSec) * 100)
                );
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPlayheadSec(m.timeSec)}
                    style={{ left: `${leftPct}%` }}
                    title={`Marker: ${m.label} (${m.timeSec}s)`}
                    className="absolute top-0.5 px-1 rounded bg-[#F06424] text-[#080707] text-[9px] font-bold"
                  >
                    ⚑ {m.label.slice(0, 8)}
                  </button>
                );
              })}
            </div>

            {/* Track Rows */}
            <div className="space-y-1.5">
              {project.tracks.map((track) => {
                const isTrackSelected = track.id === selectedTrackId;
                return (
                  <div
                    key={track.id}
                    onClick={() => setSelectedTrackId(track.id)}
                    className={`rounded-lg border p-2 transition-colors ${
                      isTrackSelected
                        ? 'border-[#F06424]/60 bg-[#171412]'
                        : 'border-[#24211F] bg-[#121110]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono-tabular uppercase text-[#F06424]">
                          {track.kind}
                        </span>
                        <span aria-hidden="true" className="text-[#4A4039]">
                          ·
                        </span>
                        <span className="text-xs font-semibold text-[#F3EEE8]">
                          {track.name}
                        </span>
                      </div>

                      {/* Track Vis / Lock / Mute / Solo Buttons */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            dispatchCommand({
                              type: 'setTrackState',
                              trackId: track.id,
                              visible: !track.visible,
                            });
                          }}
                          aria-label={`Toggle ${track.name} visibility`}
                          className={`min-h-[34px] min-w-[34px] rounded border inline-flex items-center justify-center ${
                            track.visible
                              ? 'border-[#2A231E] bg-[#181615] text-[#D8CFC8]'
                              : 'border-[#F06464]/50 bg-[#F06464]/10 text-[#F06464]'
                          }`}
                        >
                          {track.visible ? (
                            <Eye className="w-3.5 h-3.5" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            dispatchCommand({
                              type: 'setTrackState',
                              trackId: track.id,
                              locked: !track.locked,
                            });
                          }}
                          aria-label={`Toggle ${track.name} lock`}
                          className={`min-h-[34px] min-w-[34px] rounded border inline-flex items-center justify-center ${
                            track.locked
                              ? 'border-[#E4B45A] bg-[#E4B45A]/15 text-[#E4B45A]'
                              : 'border-[#2A231E] bg-[#181615] text-[#8E857E]'
                          }`}
                        >
                          {track.locked ? (
                            <Lock className="w-3.5 h-3.5" />
                          ) : (
                            <Unlock className="w-3.5 h-3.5" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            dispatchCommand({
                              type: 'setTrackState',
                              trackId: track.id,
                              muted: !track.muted,
                            });
                          }}
                          aria-label={`Toggle ${track.name} mute`}
                          className={`min-h-[34px] px-2 rounded border text-[10px] font-mono-tabular ${
                            track.muted
                              ? 'border-[#F06464] bg-[#F06464]/15 text-[#F06464]'
                              : 'border-[#2A231E] bg-[#181615] text-[#8E857E]'
                          }`}
                        >
                          M
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            dispatchCommand({
                              type: 'setTrackState',
                              trackId: track.id,
                              solo: !track.solo,
                            });
                          }}
                          aria-label={`Toggle ${track.name} solo`}
                          className={`min-h-[34px] px-2 rounded border text-[10px] font-mono-tabular ${
                            track.solo
                              ? 'border-[#55B98B] bg-[#55B98B]/15 text-[#55B98B] font-bold'
                              : 'border-[#2A231E] bg-[#181615] text-[#8E857E]'
                          }`}
                        >
                          S
                        </button>
                      </div>
                    </div>

                    {/* Clips Bar inside Track */}
                    <div
                      style={{
                        width: `${Math.max(100, Math.round(timelineZoom * 100))}%`,
                      }}
                      className="relative h-12 rounded bg-[#090808] border border-[#1E1C1A] overflow-hidden"
                    >
                      {/* Playhead vertical line */}
                      <div
                        style={{
                          left: `${Math.min(
                            100,
                            Math.max(0, (playheadSec / project.canvas.durationSec) * 100)
                          )}%`,
                        }}
                        className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-[#F06424] z-20"
                      />

                      {track.clips.map((clip) => {
                        const leftPct = Math.max(
                          0,
                          Math.min(
                            100,
                            (clip.startTimeSec / project.canvas.durationSec) * 100
                          )
                        );
                        const widthPct = Math.max(
                          7,
                          Math.min(
                            100 - leftPct,
                            (clip.durationSec / project.canvas.durationSec) * 100
                          )
                        );
                        const isClipSelected = clip.id === selectedClipId;
                        const isMultiChecked = multiSelectedClipIds.includes(clip.id);

                        return (
                          <div
                            key={clip.id}
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedClipId(clip.id);
                              setSelectedTrackId(track.id);
                              if (clip.sceneId) setSelectedSceneId(clip.sceneId);
                            }}
                            onPointerDown={(e) => {
                              if (clip.locked || track.locked) return;
                              const rect =
                                e.currentTarget.parentElement?.getBoundingClientRect();
                              timelineDragRef.current = {
                                clipId: clip.id,
                                mode: 'move',
                                initialX: e.clientX,
                                initialStartSec: clip.startTimeSec,
                                initialDurationSec: clip.durationSec,
                                containerWidthPx: rect?.width || 400,
                              };
                            }}
                            style={{
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                            }}
                            className={`absolute top-1 bottom-1 rounded px-2 text-left text-[10.5px] font-medium truncate transition-all flex items-center justify-between select-none cursor-grab active:cursor-grabbing ${
                              isClipSelected
                                ? 'bg-[#F06424] text-[#080707] font-bold ring-2 ring-[#F3EEE8]'
                                : clip.locked
                                ? 'bg-[#221D1A] border border-[#E4B45A]/50 text-[#B8AAA0]'
                                : 'bg-[#2A1810] border border-[#F06424]/50 text-[#F3EEE8] hover:border-[#F06424]'
                            }`}
                          >
                            <div className="flex items-center gap-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={isMultiChecked}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setMultiSelectedClipIds((prev) =>
                                    checked
                                      ? [...new Set([...prev, clip.id])]
                                      : prev.filter((id) => id !== clip.id)
                                  );
                                }}
                                aria-label={`Select ${clip.name} for grouping`}
                                className="accent-[#080707] w-3 h-3 shrink-0"
                              />
                              {clip.locked && <Lock className="w-3 h-3 shrink-0" />}
                              {clip.groupId && (
                                <span title={`Grouped: ${clip.groupId}`} className="inline-flex shrink-0">
                                  <Link2 className="w-3 h-3 shrink-0" />
                                </span>
                              )}
                              <span className="truncate">{clip.name}</span>
                            </div>

                            <div className="flex items-center gap-1 shrink-0 ml-1">
                              <span className="text-[9px] font-mono-tabular opacity-85">
                                {clip.durationSec.toFixed(1)}s
                              </span>
                              {/* Touch-friendly right trim handle */}
                              <span
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  if (clip.locked || track.locked) return;
                                  const rect =
                                    e.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
                                  timelineDragRef.current = {
                                    clipId: clip.id,
                                    mode: 'trim-end',
                                    initialX: e.clientX,
                                    initialStartSec: clip.startTimeSec,
                                    initialDurationSec: clip.durationSec,
                                    containerWidthPx: rect?.width || 400,
                                  };
                                }}
                                title="Drag right edge to trim duration"
                                className="w-2 h-6 rounded bg-[#080707]/40 hover:bg-[#080707]/80 cursor-ew-resize inline-block"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column (5 cols on lg): Progressive Disclosure Panels (Quick | Pro | AI Co-Edit) */}
        <div className="lg:col-span-5 flex flex-col bg-[#11100F] overflow-y-auto p-3 sm:p-4 space-y-3">
          {/* ================================================================
              MODE 1: QUICK MODE (TEMPLATE & SCENE LEVEL OVERRIDES)
             ================================================================ */}
          {disclosureMode === 'quick' && (
            <div className="space-y-3" data-testid="editor-quick-mode-panel">
              <div className="rounded-xl border border-[#2A231E] bg-[#161413] p-3.5 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono-tabular uppercase font-bold text-[#F06424]">
                    Quick Mode · Template &amp; Brand Overrides
                  </span>
                  <span className="text-[11px] text-[#8E857E]">
                    Shared Canonical v2.0
                  </span>
                </div>
                <p className="text-[#9E958E] leading-relaxed">
                  Edit headlines, brand accent colors, canvas background, and scene durations in one place. All changes write directly to the canonical project.
                </p>

                {/* All Text / Template Clips Quick Copy Editor */}
                <div className="space-y-2 pt-1">
                  <div className="text-[10px] font-mono-tabular uppercase text-[#B8AAA0]">
                    Headlines &amp; Titles
                  </div>
                  {project.tracks
                    .flatMap((t) => t.clips)
                    .filter(
                      (c) => c.kind === 'text' || c.kind === 'template-instance'
                    )
                    .map((clip) => (
                      <label key={clip.id} className="block space-y-1">
                        <span className="text-[11px] text-[#9E958E]">
                          {clip.name} ({clip.startTimeSec.toFixed(1)}s)
                        </span>
                        <input
                          type="text"
                          disabled={clip.locked}
                          value={clip.textData?.content || ''}
                          onFocus={(e) =>
                            e.currentTarget.scrollIntoView({
                              behavior: 'smooth',
                              block: 'nearest',
                            })
                          }
                          onChange={(e) =>
                            dispatchCommand({
                              type: 'setTextProperties',
                              clipId: clip.id,
                              textData: { content: e.target.value },
                            })
                          }
                          className="w-full min-h-[42px] rounded-lg border border-[#2A231E] bg-[#0E0D0C] px-3 text-xs text-[#F3EEE8] disabled:opacity-40"
                        />
                      </label>
                    ))}
                </div>

                {/* Quick Brand Accent Swatches */}
                <div className="space-y-1.5 pt-2 border-t border-[#24211F]">
                  <div className="text-[10px] font-mono-tabular uppercase text-[#B8AAA0]">
                    1-Tap Brand Accent Palette
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      { label: 'Sowveil Orange', hex: '#F06424' },
                      { label: 'Emerald Mint', hex: '#55B98B' },
                      { label: 'Amber Gold', hex: '#E4B45A' },
                      { label: 'Electric Cyan', hex: '#38BDF8' },
                      { label: 'Royal Violet', hex: '#A855F7' },
                    ].map((swatch) => (
                      <button
                        key={swatch.hex}
                        type="button"
                        onClick={() => {
                          const target =
                            selectedClip ||
                            project.tracks.flatMap((t) => t.clips)[0];
                          if (!target) return;
                          dispatchCommand({
                            type: 'setTextProperties',
                            clipId: target.id,
                            textData: {
                              colorHex: swatch.hex,
                              strokeColorHex: swatch.hex,
                            },
                          });
                        }}
                        className="min-h-[40px] px-2.5 rounded-lg border border-[#2A231E] bg-[#0E0D0C] hover:border-[#F06424] inline-flex items-center gap-1.5 text-xs text-[#F3EEE8]"
                      >
                        <span
                          style={{ backgroundColor: swatch.hex }}
                          className="w-3.5 h-3.5 rounded-full border border-white/20"
                        />
                        <span>{swatch.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quick Canvas Background Color */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#24211F]">
                  <label className="space-y-1">
                    <span className="text-[10px] text-[#9E958E]">
                      Canvas Background
                    </span>
                    <input
                      type="color"
                      value={project.canvas.backgroundColorHex}
                      onChange={(e) =>
                        dispatchCommand({
                          type: 'updateCanvas',
                          canvas: { backgroundColorHex: e.target.value },
                        })
                      }
                      className="w-full min-h-[42px] rounded border border-[#2A231E] bg-[#0E0D0C] p-1 cursor-pointer"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-[#9E958E]">
                      Duration (sec)
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={300}
                      step={0.5}
                      value={project.canvas.durationSec}
                      onChange={(e) =>
                        dispatchCommand({
                          type: 'updateCanvas',
                          canvas: {
                            durationSec: Math.max(1, Number(e.target.value) || 5),
                          },
                        })
                      }
                      className="w-full min-h-[42px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2.5 text-xs font-mono-tabular text-[#F3EEE8]"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              MODE 2: PRO MODE (7 DETAILED INSPECTOR TABS)
             ================================================================ */}
          {disclosureMode === 'pro' && (
            <>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1 rounded-xl bg-[#0B0A09] p-1 border border-[#2A231E] text-[10.5px] font-medium">
                {(
                  [
                    { id: 'transform', label: 'Transform', icon: Sliders },
                    { id: 'content', label: 'Text/Cap', icon: Type },
                    { id: 'keyframes', label: 'Keyframes', icon: KeyRound },
                    { id: 'effects', label: 'FX/Trans', icon: Sparkles },
                    { id: 'audio-assets', label: 'Audio/Asset', icon: Volume2 },
                    { id: 'snapshots', label: 'Diff/Hist', icon: GitCompare },
                    { id: 'validation', label: 'Validate', icon: ShieldAlert },
                  ] as const
                ).map((tab) => {
                  const Icon = tab.icon;
                  const active = openInspectorSection === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setOpenInspectorSection(tab.id)}
                      data-testid={`pro-tab-${tab.id}`}
                      className={`min-h-[42px] rounded-lg px-1 py-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                        active
                          ? 'bg-[#F06424] text-[#080707] font-bold'
                          : 'text-[#B8AAA0] hover:text-[#F3EEE8]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span className="text-[9.5px] truncate">{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {!selectedClip &&
                openInspectorSection !== 'snapshots' &&
                openInspectorSection !== 'validation' &&
                openInspectorSection !== 'audio-assets' && (
                  <div className="rounded-xl border border-[#2A231E] bg-[#161413] p-5 text-center space-y-2 text-xs text-[#9E958E]">
                    <p className="font-semibold text-[#F3EEE8]">
                      No Timeline Clip Selected
                    </p>
                    <p>
                      Tap any clip on the multi-track timeline or tap{' '}
                      <strong className="text-[#F06424]">+ Clip</strong> to inspect
                      and edit properties.
                    </p>
                  </div>
                )}

              {/* TAB 1: TRANSFORM, NON-DRAG PRECISION TIMING, CLIP STATE & REORDER */}
              {selectedClip && openInspectorSection === 'transform' && (
                <div className="rounded-xl border border-[#2A231E] bg-[#161413] p-3.5 space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#24211F] pb-2">
                    <div>
                      <span className="text-[10px] font-mono-tabular uppercase text-[#F06424]">
                        {selectedClip.kind} · {selectedClip.id}
                        {selectedClip.sourceSegmentId
                          ? ` · seg:${selectedClip.sourceSegmentId}`
                          : ''}
                      </span>
                      <h3 className="font-bold text-sm text-[#F3EEE8]">
                        {selectedClip.name}
                      </h3>
                    </div>

                    {/* Per-Clip Lock / Hide / Mute / Solo controls */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          dispatchCommand({
                            type: 'setClipState',
                            clipId: selectedClip.id,
                            locked: !selectedClip.locked,
                          })
                        }
                        title={selectedClip.locked ? 'Unlock clip' : 'Lock clip'}
                        className={`min-h-[36px] px-2 rounded border text-[10px] inline-flex items-center gap-1 ${
                          selectedClip.locked
                            ? 'border-[#E4B45A] bg-[#E4B45A]/15 text-[#E4B45A]'
                            : 'border-[#2A231E] bg-[#0E0D0C] text-[#9E958E]'
                        }`}
                      >
                        {selectedClip.locked ? (
                          <Lock className="w-3 h-3" />
                        ) : (
                          <Unlock className="w-3 h-3" />
                        )}
                        <span>{selectedClip.locked ? 'Locked' : 'Lock'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          dispatchCommand({
                            type: 'setClipState',
                            clipId: selectedClip.id,
                            visible: !selectedClip.visible,
                          })
                        }
                        className={`min-h-[36px] px-2 rounded border text-[10px] ${
                          selectedClip.visible
                            ? 'border-[#2A231E] bg-[#0E0D0C] text-[#D8CFC8]'
                            : 'border-[#F06464] bg-[#F06464]/15 text-[#F06464]'
                        }`}
                      >
                        {selectedClip.visible ? 'Visible' : 'Hidden'}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          dispatchCommand({
                            type: 'setClipState',
                            clipId: selectedClip.id,
                            muted: !selectedClip.muted,
                          })
                        }
                        className={`min-h-[36px] px-2 rounded border text-[10px] ${
                          selectedClip.muted
                            ? 'border-[#F06464] bg-[#F06464]/15 text-[#F06464]'
                            : 'border-[#2A231E] bg-[#0E0D0C] text-[#9E958E]'
                        }`}
                      >
                        {selectedClip.muted ? 'Muted' : 'Mute'}
                      </button>
                    </div>
                  </div>

                  {/* Accessible Non-Drag Precision Nudge & Trim Buttons (Mobile Ergonomics) */}
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-mono-tabular uppercase text-[#9E958E]">
                      Accessible Touch Nudge &amp; Trim Controls
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          dispatchCommand({
                            type: 'moveClip',
                            clipId: selectedClip.id,
                            startTimeSec: Math.max(
                              0,
                              Number((selectedClip.startTimeSec - 0.1).toFixed(2))
                            ),
                            moveGroup: true,
                          })
                        }
                        className="min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] hover:border-[#F06424] text-[11px] font-mono-tabular"
                      >
                        Move -0.1s
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          dispatchCommand({
                            type: 'moveClip',
                            clipId: selectedClip.id,
                            startTimeSec: Number(
                              (selectedClip.startTimeSec + 0.1).toFixed(2)
                            ),
                            moveGroup: true,
                          })
                        }
                        className="min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] hover:border-[#F06424] text-[11px] font-mono-tabular"
                      >
                        Move +0.1s
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          dispatchCommand({
                            type: 'trimClip',
                            clipId: selectedClip.id,
                            durationSec: Math.max(
                              0.1,
                              Number((selectedClip.durationSec - 0.1).toFixed(2))
                            ),
                          })
                        }
                        className="min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] hover:border-[#F06424] text-[11px] font-mono-tabular"
                      >
                        Trim -0.1s
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          dispatchCommand({
                            type: 'trimClip',
                            clipId: selectedClip.id,
                            durationSec: Number(
                              (selectedClip.durationSec + 0.1).toFixed(2)
                            ),
                          })
                        }
                        className="min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] hover:border-[#F06424] text-[11px] font-mono-tabular"
                      >
                        Trim +0.1s
                      </button>
                    </div>
                  </div>

                  {/* Timing: Start, Duration, Trim In/Out, Speed */}
                  <div className="grid grid-cols-3 gap-2">
                    <label className="space-y-1">
                      <span className="text-[10px] font-mono-tabular text-[#9E958E]">
                        Start (s)
                      </span>
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        value={selectedClip.startTimeSec}
                        onChange={(e) =>
                          dispatchCommand({
                            type: 'moveClip',
                            clipId: selectedClip.id,
                            startTimeSec: snapTime(Number(e.target.value) || 0),
                          })
                        }
                        className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2 text-xs font-mono-tabular text-[#F3EEE8]"
                      />
                    </label>

                    <label className="space-y-1">
                      <span className="text-[10px] font-mono-tabular text-[#9E958E]">
                        Duration (s)
                      </span>
                      <input
                        type="number"
                        step={0.1}
                        min={0.1}
                        value={selectedClip.durationSec}
                        onChange={(e) =>
                          dispatchCommand({
                            type: 'trimClip',
                            clipId: selectedClip.id,
                            durationSec: Math.max(0.1, Number(e.target.value) || 1),
                          })
                        }
                        className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2 text-xs font-mono-tabular text-[#F3EEE8]"
                      />
                    </label>

                    <label className="space-y-1">
                      <span className="text-[10px] font-mono-tabular text-[#9E958E]">
                        Speed (x)
                      </span>
                      <input
                        type="number"
                        step={0.25}
                        min={0.25}
                        max={8}
                        value={selectedClip.speedMultiplier}
                        onChange={(e) =>
                          dispatchCommand({
                            type: 'trimClip',
                            clipId: selectedClip.id,
                            speedMultiplier: Math.max(
                              0.25,
                              Number(e.target.value) || 1
                            ),
                          })
                        }
                        className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2 text-xs font-mono-tabular text-[#F3EEE8]"
                      />
                    </label>
                  </div>

                  {/* Spatial 2D Transform: Position X/Y, Scale, Opacity, Rotation, Blend Mode */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#24211F]">
                    <label className="space-y-1">
                      <span className="text-[10px] font-mono-tabular text-[#9E958E]">
                        Position X (px)
                      </span>
                      <input
                        type="number"
                        step={10}
                        value={selectedClip.transform.position[0]}
                        onChange={(e) =>
                          dispatchCommand({
                            type: 'setTransform',
                            clipId: selectedClip.id,
                            transform: {
                              position: [
                                Number(e.target.value) || 0,
                                selectedClip.transform.position[1],
                              ],
                            },
                          })
                        }
                        className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2 text-xs font-mono-tabular text-[#F3EEE8]"
                      />
                    </label>

                    <label className="space-y-1">
                      <span className="text-[10px] font-mono-tabular text-[#9E958E]">
                        Position Y (px)
                      </span>
                      <input
                        type="number"
                        step={10}
                        value={selectedClip.transform.position[1]}
                        onChange={(e) =>
                          dispatchCommand({
                            type: 'setTransform',
                            clipId: selectedClip.id,
                            transform: {
                              position: [
                                selectedClip.transform.position[0],
                                Number(e.target.value) || 0,
                              ],
                            },
                          })
                        }
                        className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2 text-xs font-mono-tabular text-[#F3EEE8]"
                      />
                    </label>

                    <label className="space-y-1">
                      <span className="text-[10px] font-mono-tabular text-[#9E958E]">
                        Scale ({selectedClip.transform.scale[0].toFixed(2)}x)
                      </span>
                      <input
                        type="range"
                        min={0.2}
                        max={3}
                        step={0.05}
                        value={selectedClip.transform.scale[0]}
                        onChange={(e) => {
                          const s = Number(e.target.value);
                          dispatchCommand({
                            type: 'setTransform',
                            clipId: selectedClip.id,
                            transform: { scale: [s, s] },
                          });
                        }}
                        className="w-full accent-[#F06424] min-h-[40px]"
                      />
                    </label>

                    <label className="space-y-1">
                      <span className="text-[10px] font-mono-tabular text-[#9E958E]">
                        Opacity ({Math.round(selectedClip.transform.opacity * 100)}%)
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={selectedClip.transform.opacity}
                        onChange={(e) =>
                          dispatchCommand({
                            type: 'setTransform',
                            clipId: selectedClip.id,
                            transform: { opacity: Number(e.target.value) },
                          })
                        }
                        className="w-full accent-[#F06424] min-h-[40px]"
                      />
                    </label>

                    <label className="space-y-1">
                      <span className="text-[10px] font-mono-tabular text-[#9E958E]">
                        Rotation ({selectedClip.transform.rotationDeg}°)
                      </span>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={selectedClip.transform.rotationDeg}
                        onChange={(e) =>
                          dispatchCommand({
                            type: 'setTransform',
                            clipId: selectedClip.id,
                            transform: { rotationDeg: Number(e.target.value) },
                          })
                        }
                        className="w-full accent-[#F06424]"
                      />
                    </label>

                    <label className="space-y-1">
                      <span className="text-[10px] font-mono-tabular text-[#9E958E]">
                        Blend Mode
                      </span>
                      <select
                        value={selectedClip.blendMode}
                        onChange={(e) =>
                          dispatchCommand({
                            type: 'setClipState',
                            clipId: selectedClip.id,
                            blendMode: e.target.value as CanonicalBlendMode,
                          })
                        }
                        className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2 text-xs text-[#F3EEE8]"
                      >
                        <option value="normal">Normal</option>
                        <option value="screen">Screen</option>
                        <option value="multiply">Multiply</option>
                        <option value="overlay">Overlay</option>
                        <option value="add">Add</option>
                      </select>
                    </label>
                  </div>

                  {/* Reorder / Move Track */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#24211F]">
                    <span className="text-[10px] font-mono-tabular text-[#9E958E]">
                      Layer / Track Order
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          dispatchCommand({
                            type: 'reorderClip',
                            clipId: selectedClip.id,
                            targetTrackId: selectedClip.trackId,
                            newIndex: 0,
                          })
                        }
                        className="min-h-[36px] px-2.5 rounded border border-[#2A231E] bg-[#0E0D0C] hover:border-[#F06424] inline-flex items-center gap-1 text-[11px]"
                      >
                        <ArrowUp className="w-3 h-3 text-[#F06424]" />
                        <span>Send to Front</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          dispatchCommand({
                            type: 'reorderClip',
                            clipId: selectedClip.id,
                            targetTrackId: selectedClip.trackId,
                            newIndex: 99,
                          })
                        }
                        className="min-h-[36px] px-2.5 rounded border border-[#2A231E] bg-[#0E0D0C] hover:border-[#F06424] inline-flex items-center gap-1 text-[11px]"
                      >
                        <ArrowDown className="w-3 h-3 text-[#F06424]" />
                        <span>Send to Back</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: TEXT & CAPTION INSPECTOR */}
              {selectedClip && openInspectorSection === 'content' && (
                <div className="rounded-xl border border-[#2A231E] bg-[#161413] p-3.5 space-y-3 text-xs">
                  <div className="text-[10px] font-mono-tabular uppercase text-[#F06424]">
                    Typography &amp; Caption Inspector
                  </div>

                  {(selectedClip.kind === 'text' ||
                    selectedClip.kind === 'template-instance') && (
                    <div className="space-y-2.5">
                      <label className="block space-y-1">
                        <span className="text-[10px] text-[#9E958E]">
                          Headline / Text Copy
                        </span>
                        <input
                          type="text"
                          value={selectedClip.textData?.content || ''}
                          onFocus={(e) =>
                            e.currentTarget.scrollIntoView({
                              behavior: 'smooth',
                              block: 'nearest',
                            })
                          }
                          onChange={(e) =>
                            dispatchCommand({
                              type: 'setTextProperties',
                              clipId: selectedClip.id,
                              textData: { content: e.target.value },
                            })
                          }
                          className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2.5 text-xs text-[#F3EEE8]"
                        />
                      </label>

                      <div className="grid grid-cols-3 gap-2">
                        <label className="space-y-1">
                          <span className="text-[10px] text-[#9E958E]">
                            Font Size (px)
                          </span>
                          <input
                            type="number"
                            min={12}
                            max={240}
                            value={selectedClip.textData?.fontSizePx || 64}
                            onChange={(e) =>
                              dispatchCommand({
                                type: 'setTextProperties',
                                clipId: selectedClip.id,
                                textData: {
                                  fontSizePx: Number(e.target.value) || 64,
                                },
                              })
                            }
                            className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2 text-xs font-mono-tabular text-[#F3EEE8]"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-[10px] text-[#9E958E]">
                            Weight
                          </span>
                          <select
                            value={selectedClip.textData?.fontWeight || 800}
                            onChange={(e) =>
                              dispatchCommand({
                                type: 'setTextProperties',
                                clipId: selectedClip.id,
                                textData: {
                                  fontWeight: Number(e.target.value),
                                },
                              })
                            }
                            className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2 text-xs text-[#F3EEE8]"
                          >
                            <option value={400}>400 Regular</option>
                            <option value={600}>600 SemiBold</option>
                            <option value={700}>700 Bold</option>
                            <option value={800}>800 ExtraBold</option>
                            <option value={900}>900 Black</option>
                          </select>
                        </label>

                        <label className="space-y-1">
                          <span className="text-[10px] text-[#9E958E]">
                            Color Hex
                          </span>
                          <input
                            type="color"
                            value={selectedClip.textData?.colorHex || '#F3EEE8'}
                            onChange={(e) =>
                              dispatchCommand({
                                type: 'setTextProperties',
                                clipId: selectedClip.id,
                                textData: { colorHex: e.target.value },
                              })
                            }
                            className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] p-1 cursor-pointer"
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1">
                          <span className="text-[10px] text-[#9E958E]">
                            Alignment
                          </span>
                          <select
                            value={selectedClip.textData?.alignment || 'center'}
                            onChange={(e) =>
                              dispatchCommand({
                                type: 'setTextProperties',
                                clipId: selectedClip.id,
                                textData: {
                                  alignment: e.target.value as
                                    | 'left'
                                    | 'center'
                                    | 'right',
                                },
                              })
                            }
                            className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2 text-xs text-[#F3EEE8]"
                          >
                            <option value="left">Left</option>
                            <option value="center">Center</option>
                            <option value="right">Right</option>
                          </select>
                        </label>

                        <label className="space-y-1">
                          <span className="text-[10px] text-[#9E958E]">
                            Case Transform
                          </span>
                          <select
                            value={selectedClip.textData?.textTransform || 'none'}
                            onChange={(e) =>
                              dispatchCommand({
                                type: 'setTextProperties',
                                clipId: selectedClip.id,
                                textData: {
                                  textTransform: e.target.value as
                                    | 'none'
                                    | 'uppercase'
                                    | 'lowercase',
                                },
                              })
                            }
                            className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2 text-xs text-[#F3EEE8]"
                          >
                            <option value="none">Normal Case</option>
                            <option value="uppercase">UPPERCASE</option>
                            <option value="lowercase">lowercase</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  )}

                  {selectedClip.kind === 'caption' && (
                    <div className="space-y-2.5">
                      <label className="block space-y-1">
                        <span className="text-[10px] text-[#9E958E]">
                          Caption Subtitle Text
                        </span>
                        <input
                          type="text"
                          value={selectedClip.captionData?.text || selectedClip.name}
                          onChange={(e) =>
                            dispatchCommand({
                              type: 'alterCaption',
                              clipId: selectedClip.id,
                              text: e.target.value,
                            })
                          }
                          className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2.5 text-xs text-[#F3EEE8]"
                        />
                      </label>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1">
                          <span className="text-[10px] text-[#9E958E]">
                            Speaker Label
                          </span>
                          <input
                            type="text"
                            value={selectedClip.captionData?.speaker || ''}
                            onChange={(e) =>
                              dispatchCommand({
                                type: 'alterCaption',
                                clipId: selectedClip.id,
                                speaker: e.target.value,
                              })
                            }
                            className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2 text-xs text-[#F3EEE8]"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-[10px] text-[#9E958E]">
                            Highlight Color
                          </span>
                          <input
                            type="color"
                            value={
                              selectedClip.captionData?.highlightColorHex ||
                              '#F06424'
                            }
                            onChange={(e) =>
                              dispatchCommand({
                                type: 'alterCaption',
                                clipId: selectedClip.id,
                                highlightColorHex: e.target.value,
                              })
                            }
                            className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] p-1 cursor-pointer"
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: KEYFRAME EDITOR & INTERACTIVE CUBIC-BEZIER EASING CURVE UI */}
              {selectedClip && openInspectorSection === 'keyframes' && (
                <div className="rounded-xl border border-[#2A231E] bg-[#161413] p-3.5 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono-tabular uppercase text-[#F06424]">
                      Keyframes &amp; Cubic-Bezier Easing Curve
                    </span>
                    <span className="text-[10px] font-mono-tabular text-[#8E857E]">
                      {selectedClip.keyframes.length} active
                    </span>
                  </div>

                  {/* Interactive Cubic-Bezier Curve Preview + Preset Selector */}
                  <div className="rounded-lg border border-[#24211F] bg-[#0E0D0C] p-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <svg
                        width={180}
                        height={100}
                        viewBox="0 0 180 100"
                        className="rounded border border-[#2A231E] bg-[#080707] shrink-0"
                      >
                        <line
                          x1={14}
                          y1={86}
                          x2={166}
                          y2={14}
                          stroke="#2A231E"
                          strokeDasharray="3 3"
                        />
                        <line
                          x1={bezierSvg.handle1.x1}
                          y1={bezierSvg.handle1.y1}
                          x2={bezierSvg.handle1.x2}
                          y2={bezierSvg.handle1.y2}
                          stroke="#55B98B"
                          strokeWidth={1.5}
                        />
                        <line
                          x1={bezierSvg.handle2.x1}
                          y1={bezierSvg.handle2.y1}
                          x2={bezierSvg.handle2.x2}
                          y2={bezierSvg.handle2.y2}
                          stroke="#E4B45A"
                          strokeWidth={1.5}
                        />
                        <path
                          d={bezierSvg.curvePath}
                          fill="none"
                          stroke="#F06424"
                          strokeWidth={2.5}
                        />
                        <circle
                          cx={bezierSvg.handle1.x2}
                          cy={bezierSvg.handle1.y2}
                          r={4}
                          fill="#55B98B"
                        />
                        <circle
                          cx={bezierSvg.handle2.x2}
                          cy={bezierSvg.handle2.y2}
                          r={4}
                          fill="#E4B45A"
                        />
                      </svg>

                      <div className="flex-1 space-y-1.5">
                        <div className="text-[10px] font-mono-tabular text-[#B8AAA0]">
                          cubic-bezier({customBezier.join(', ')})
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          {EASING_CURVE_PRESETS.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => {
                                setCustomBezier(preset.points);
                                setNewKfInterpolation('cubic-bezier');
                              }}
                              className="px-2 py-1 rounded border border-[#2A231E] bg-[#141210] hover:border-[#F06424] text-[10px] text-left truncate text-[#D8CFC8]"
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Add Keyframe at Playhead */}
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      value={newKfProperty}
                      onChange={(e) => setNewKfProperty(e.target.value)}
                      aria-label="Keyframe property"
                      className="min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2 text-xs text-[#F3EEE8]"
                    >
                      <option value="opacity">opacity</option>
                      <option value="positionX">positionX</option>
                      <option value="positionY">positionY</option>
                      <option value="scaleX">scaleX</option>
                      <option value="scaleY">scaleY</option>
                      <option value="rotationDeg">rotationDeg</option>
                      <option value="audioGainDb">audioGainDb</option>
                    </select>

                    <input
                      type="number"
                      step={0.1}
                      value={newKfValue}
                      onChange={(e) => setNewKfValue(e.target.value)}
                      aria-label="Keyframe value"
                      className="min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2 text-xs font-mono-tabular text-[#F3EEE8]"
                    />

                    <button
                      type="button"
                      onClick={() =>
                        dispatchCommand({
                          type: 'addKeyframe',
                          clipId: selectedClip.id,
                          keyframe: {
                            property: newKfProperty,
                            timeSec: playheadSec,
                            value: Number(newKfValue) || 0,
                            interpolation: newKfInterpolation,
                            cubicBezier:
                              newKfInterpolation === 'cubic-bezier'
                                ? customBezier
                                : undefined,
                          },
                        })
                      }
                      data-testid="editor-add-keyframe-btn"
                      className="min-h-[40px] rounded bg-[#F06424] text-[#080707] font-bold text-xs"
                    >
                      + Keyframe @ {playheadSec.toFixed(1)}s
                    </button>
                  </div>

                  {/* Keyframes List */}
                  <div className="space-y-1.5 max-h-44 overflow-y-auto">
                    {selectedClip.keyframes.map((kf) => (
                      <div
                        key={kf.id}
                        className="flex items-center justify-between gap-2 rounded border border-[#24211F] bg-[#0E0D0C] px-2.5 py-1.5 font-mono-tabular text-[11px]"
                      >
                        <div>
                          <span className="text-[#F06424] font-semibold">
                            {kf.property}
                          </span>{' '}
                          @ {kf.timeSec}s ={' '}
                          <span className="text-[#F3EEE8]">
                            {String(kf.value)}
                          </span>{' '}
                          <span className="text-[#787069]">
                            ({kf.interpolation})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            dispatchCommand({
                              type: 'removeKeyframe',
                              clipId: selectedClip.id,
                              keyframeId: kf.id,
                            })
                          }
                          aria-label={`Remove keyframe ${kf.id}`}
                          className="text-[#F06464] hover:underline text-[10px]"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 4: EFFECT STACK & TRANSITION SELECTOR */}
              {selectedClip && openInspectorSection === 'effects' && (
                <div className="rounded-xl border border-[#2A231E] bg-[#161413] p-3.5 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono-tabular uppercase text-[#F06424]">
                      Effects Stack &amp; Transitions
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          dispatchCommand({
                            type: 'addEffect',
                            clipId: selectedClip.id,
                            effect: {
                              effectType: 'optical-glow',
                              name: 'Optical Neon Glow',
                              enabled: true,
                              rendererSupport: 'supported',
                              supportedInAlightXml: true,
                              parameters: {
                                radiusPx: 24,
                                intensity: 0.85,
                                tintColor: '#F06424',
                              },
                            },
                          })
                        }
                        className="min-h-[34px] px-2.5 rounded bg-[#2A1810] border border-[#F06424]/50 text-[#F06424] font-semibold text-[11px]"
                      >
                        + Glow FX
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          dispatchCommand({
                            type: 'addEffect',
                            clipId: selectedClip.id,
                            effect: {
                              effectType: 'directional-blur',
                              name: 'Motion Blur',
                              enabled: true,
                              rendererSupport: 'supported',
                              supportedInAlightXml: true,
                              parameters: {
                                angleDeg: 90,
                                blurLengthPx: 14,
                              },
                            },
                          })
                        }
                        className="min-h-[34px] px-2.5 rounded border border-[#2A231E] bg-[#0E0D0C] text-[#D8CFC8] text-[11px]"
                      >
                        + Blur FX
                      </button>
                    </div>
                  </div>

                  {/* Effects List */}
                  <div className="space-y-2">
                    {selectedClip.effects.map((eff) => (
                      <div
                        key={eff.id}
                        className="rounded-lg border border-[#24211F] bg-[#0E0D0C] p-2.5 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#F3EEE8]">
                            {eff.name}{' '}
                            <span className="text-[10px] font-mono-tabular text-[#8E857E]">
                              · {eff.rendererSupport}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              dispatchCommand({
                                type: 'removeEffect',
                                clipId: selectedClip.id,
                                effectId: eff.id,
                              })
                            }
                            className="text-[10px] text-[#F06464] hover:underline"
                          >
                            Remove
                          </button>
                        </div>

                        {Object.entries(eff.parameters).map(([pKey, pVal]) => (
                          <div
                            key={pKey}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="text-[11px] font-mono-tabular text-[#9E958E]">
                              {pKey}
                            </span>
                            {typeof pVal === 'number' ? (
                              <input
                                type="number"
                                step={0.1}
                                value={pVal}
                                onChange={(e) =>
                                  dispatchCommand({
                                    type: 'setEffectParameter',
                                    clipId: selectedClip.id,
                                    effectId: eff.id,
                                    parameterKey: pKey,
                                    value: Number(e.target.value),
                                  })
                                }
                                className="w-24 min-h-[34px] rounded border border-[#2A231E] bg-[#141210] px-2 text-xs font-mono-tabular text-[#F3EEE8]"
                              />
                            ) : (
                              <input
                                type="text"
                                value={String(pVal)}
                                onChange={(e) =>
                                  dispatchCommand({
                                    type: 'setEffectParameter',
                                    clipId: selectedClip.id,
                                    effectId: eff.id,
                                    parameterKey: pKey,
                                    value: e.target.value,
                                  })
                                }
                                className="w-28 min-h-[34px] rounded border border-[#2A231E] bg-[#141210] px-2 text-xs font-mono-tabular text-[#F3EEE8]"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>

                  {/* In Transition Selector */}
                  <div className="pt-2 border-t border-[#24211F] space-y-2">
                    <div className="text-[10px] font-mono-tabular uppercase text-[#9E958E]">
                      In-Transition Preset
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          'cross-dissolve',
                          'slide-up',
                          'zoom-blur',
                          'whip-pan',
                        ] as Array<CanonicalTransitionSpec['type']>
                      ).map((tType) => (
                        <button
                          key={tType}
                          type="button"
                          onClick={() =>
                            dispatchCommand({
                              type: 'insertTransition',
                              clipId: selectedClip.id,
                              edge: 'in',
                              transition: {
                                type: tType,
                                durationSec: Math.min(
                                  0.5,
                                  Number((selectedClip.durationSec * 0.4).toFixed(2))
                                ),
                                easingCurve: [0.22, 1, 0.36, 1],
                                parameters: { intensity: 0.8 },
                              },
                            })
                          }
                          className={`min-h-[36px] px-2.5 rounded border text-[11px] font-mono-tabular ${
                            selectedClip.inTransition?.type === tType
                              ? 'border-[#F06424] bg-[#2A1810] text-[#F06424]'
                              : 'border-[#2A231E] bg-[#0E0D0C] text-[#B8AAA0]'
                          }`}
                        >
                          {tType}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: AUDIO GAIN/FADE & MISSING ASSET RESOLUTION */}
              {openInspectorSection === 'audio-assets' && (
                <div className="rounded-xl border border-[#2A231E] bg-[#161413] p-3.5 space-y-3 text-xs">
                  <div className="text-[10px] font-mono-tabular uppercase text-[#F06424]">
                    Audio Gain / Fade &amp; Asset Resolution
                  </div>

                  {selectedClip && (
                    <div className="space-y-2.5 pb-3 border-b border-[#24211F]">
                      <label className="block space-y-1">
                        <span className="text-[10px] font-mono-tabular text-[#9E958E]">
                          Clip Audio Gain ({selectedClip.audioConfig?.gainDb ?? 0} dB)
                        </span>
                        <input
                          type="range"
                          min={-36}
                          max={12}
                          step={0.5}
                          value={selectedClip.audioConfig?.gainDb ?? 0}
                          onChange={(e) =>
                            dispatchCommand({
                              type: 'setGain',
                              clipId: selectedClip.id,
                              gainDb: Number(e.target.value),
                            })
                          }
                          className="w-full accent-[#F06424]"
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1">
                          <span className="text-[10px] text-[#9E958E]">
                            Fade In (s)
                          </span>
                          <input
                            type="number"
                            min={0}
                            step={0.05}
                            value={selectedClip.audioConfig?.fadeInSec ?? 0}
                            onChange={(e) =>
                              dispatchCommand({
                                type: 'setGain',
                                clipId: selectedClip.id,
                                gainDb: selectedClip.audioConfig?.gainDb ?? 0,
                                fadeInSec: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                            className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2 text-xs font-mono-tabular text-[#F3EEE8]"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] text-[#9E958E]">
                            Fade Out (s)
                          </span>
                          <input
                            type="number"
                            min={0}
                            step={0.05}
                            value={selectedClip.audioConfig?.fadeOutSec ?? 0}
                            onChange={(e) =>
                              dispatchCommand({
                                type: 'setGain',
                                clipId: selectedClip.id,
                                gainDb: selectedClip.audioConfig?.gainDb ?? 0,
                                fadeOutSec: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                            className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2 text-xs font-mono-tabular text-[#F3EEE8]"
                          />
                        </label>
                      </div>

                      {/* Replace Asset on Selected Clip */}
                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={() =>
                            dispatchCommand({
                              type: 'replaceAsset',
                              clipId: selectedClip.id,
                              newAssetId: `asset_svg_plate_${Date.now().toString(36)}`,
                              slotKey: 'primary_slot',
                              assetTitle: 'Sowveil Vector Plate Asset',
                              mimeType: 'image/svg+xml',
                            })
                          }
                          className="min-h-[40px] px-3 rounded-lg border border-[#2A231E] bg-[#0E0D0C] hover:border-[#F06424] text-xs font-medium text-[#F3EEE8]"
                        >
                          Replace Bound Clip Asset ({selectedClip.assetId || 'default'})
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Project Asset Dependencies & Missing Asset Resolution */}
                  <div className="space-y-2">
                    <div className="text-[10px] font-mono-tabular uppercase text-[#B8AAA0]">
                      Project Asset References ({project.assetReferences.length})
                    </div>
                    {project.assetReferences.length === 0 ? (
                      <p className="text-[11px] text-[#787069]">
                        All clips use procedural vector/text rendering with zero external missing assets.
                      </p>
                    ) : (
                      project.assetReferences.map((asset) => (
                        <div
                          key={asset.assetId}
                          className="flex items-center justify-between gap-2 rounded border border-[#24211F] bg-[#0E0D0C] p-2"
                        >
                          <div>
                            <div className="font-semibold text-[#F3EEE8]">
                              {asset.title}
                            </div>
                            <div className="text-[10px] font-mono-tabular text-[#8E857E]">
                              {asset.assetId} · {asset.mimeType} ·{' '}
                              {asset.missing ? (
                                <span className="text-[#F06464]">MISSING</span>
                              ) : (
                                <span className="text-[#55B98B]">RESOLVED</span>
                              )}
                            </div>
                          </div>
                          {asset.missing && (
                            <button
                              type="button"
                              onClick={() =>
                                dispatchCommand({
                                  type: 'resolveMissingAsset',
                                  assetId: asset.assetId,
                                  replacementAssetId: `resolved_${asset.assetId}`,
                                  replacementTitle: `${asset.title} (Resolved SVG Proxy)`,
                                  mimeType: 'image/svg+xml',
                                  licenseType: 'Sowveil Original',
                                })
                              }
                              className="min-h-[36px] px-2.5 rounded bg-[#F06424] text-[#080707] font-bold text-[11px]"
                            >
                              Resolve Asset
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TAB 6: SNAPSHOTS, VERSION COMPARE DIFF & RESTORE */}
              {openInspectorSection === 'snapshots' && (
                <div className="rounded-xl border border-[#2A231E] bg-[#161413] p-3.5 space-y-3 text-xs">
                  <div className="text-[10px] font-mono-tabular uppercase text-[#F06424]">
                    Snapshots, Branches &amp; Version Compare Diff
                  </div>

                  {/* Create Snapshot */}
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      placeholder="Snapshot label (e.g., Before Hook Trim)"
                      value={snapshotLabelInput}
                      onChange={(e) => setSnapshotLabelInput(e.target.value)}
                      className="flex-1 min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2.5 text-xs text-[#F3EEE8]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        dispatchCommand({
                          type: 'createSnapshot',
                          label:
                            snapshotLabelInput.trim() ||
                            `Snapshot r${project.revision}`,
                        });
                        setSnapshotLabelInput('');
                      }}
                      data-testid="editor-create-snapshot-btn"
                      className="min-h-[40px] px-3 rounded bg-[#F06424] text-[#080707] font-bold text-xs"
                    >
                      Save Snapshot
                    </button>
                  </div>

                  {/* Create Branch */}
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      placeholder="New branch name (e.g., alt-pacing)"
                      value={branchNameInput}
                      onChange={(e) => setBranchNameInput(e.target.value)}
                      className="flex-1 min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2.5 text-xs text-[#F3EEE8]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!branchNameInput.trim()) return;
                        dispatchCommand({
                          type: 'createBranch',
                          branchName: branchNameInput.trim(),
                        });
                        setBranchNameInput('');
                      }}
                      className="min-h-[40px] px-3 rounded border border-[#2A231E] bg-[#0E0D0C] hover:border-[#F06424] text-xs text-[#F3EEE8] inline-flex items-center gap-1"
                    >
                      <GitBranch className="w-3.5 h-3.5 text-[#F06424]" />
                      <span>Branch</span>
                    </button>
                  </div>

                  {/* Saved Snapshots List */}
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {project.snapshots.map((snap) => (
                      <div
                        key={snap.id}
                        className="flex items-center justify-between gap-2 rounded border border-[#24211F] bg-[#0E0D0C] px-2.5 py-1.5"
                      >
                        <div>
                          <div className="font-semibold text-[#F3EEE8]">
                            {snap.label}
                          </div>
                          <div className="text-[10px] font-mono-tabular text-[#787069]">
                            r{snap.revision} · {snap.branchName}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setCompareSnapshotId(snap.id)}
                            className="px-2 py-1 rounded border border-[#2A231E] bg-[#141210] text-[10px] text-[#D8CFC8]"
                          >
                            Compare
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              dispatchCommand({
                                type: 'restoreSnapshot',
                                snapshotId: snap.id,
                              })
                            }
                            data-testid={`restore-snapshot-${snap.id}`}
                            className="px-2 py-1 rounded bg-[#2A1810] border border-[#F06424]/50 text-[10px] font-semibold text-[#F06424]"
                          >
                            Restore
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Live Canonical Diff Viewer */}
                  <div
                    data-testid="editor-project-diff-panel"
                    className="rounded-lg border border-[#24211F] bg-[#0B0A09] p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono-tabular text-[#B8AAA0]">
                      <span>
                        DIFF (r{snapshotComparisonDiff.beforeRevision} → r
                        {snapshotComparisonDiff.afterRevision})
                      </span>
                      <span className="text-[#F06424]">
                        {snapshotComparisonDiff.totalChanges} change(s)
                      </span>
                    </div>
                    <p className="text-[11px] text-[#9E958E]">
                      {snapshotComparisonDiff.summaryText}
                    </p>
                    <div className="space-y-1 max-h-36 overflow-y-auto">
                      {snapshotComparisonDiff.entries.map((d) => (
                        <div
                          key={d.id}
                          className="text-[10.5px] font-mono-tabular border-b border-[#1E1C1A] pb-1"
                        >
                          <span className="text-[#F06424]">[{d.changeKind}]</span>{' '}
                          <span className="text-[#F3EEE8]">{d.humanSummary}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 7: EXPORT SETTINGS & PROJECT VALIDATION PANEL */}
              {openInspectorSection === 'validation' && (
                <div className="rounded-xl border border-[#2A231E] bg-[#161413] p-3.5 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono-tabular uppercase text-[#F06424]">
                      Export Settings &amp; Canonical Schema Validation
                    </span>
                    <span
                      className={`text-[10px] font-mono-tabular font-bold ${
                        liveValidation.valid ? 'text-[#55B98B]' : 'text-[#F06464]'
                      }`}
                    >
                      {liveValidation.valid ? 'VALID v2.0.0' : 'SCHEMA ERRORS'}
                    </span>
                  </div>

                  {/* Export Target & Alpha Mode */}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[10px] text-[#9E958E]">
                        Target Mobile Editor
                      </span>
                      <select
                        value={project.targetEditor}
                        onChange={(e) => {
                          const targetEditor = e.target
                            .value as TargetMobileEditorId;
                          const next = { ...project, targetEditor };
                          storeRef.current.commitValidatedProjectState(next);
                          setProject(storeRef.current.getProject());
                        }}
                        className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2 text-xs text-[#F3EEE8]"
                      >
                        <option value="sowveil-project">
                          Sowveil Native (.sowveil.json) — Verified
                        </option>
                        <option value="alight-motion">
                          Alight Motion XML — Tested Subset
                        </option>
                        <option value="universal-bundle">
                          Universal Mobile Bundle — Verified
                        </option>
                        <option value="capcut">
                          CapCut — Media Handoff Only
                        </option>
                        <option value="node-video">
                          Node Video — Experimental
                        </option>
                      </select>
                    </label>

                    <label className="space-y-1">
                      <span className="text-[10px] text-[#9E958E]">
                        Background Alpha Mode
                      </span>
                      <select
                        value={project.canvas.backgroundAlphaMode}
                        onChange={(e) =>
                          dispatchCommand({
                            type: 'updateCanvas',
                            canvas: {
                              backgroundAlphaMode: e.target.value as
                                | 'solid'
                                | 'transparent'
                                | 'chroma-key-green',
                            },
                          })
                        }
                        className="w-full min-h-[40px] rounded border border-[#2A231E] bg-[#0E0D0C] px-2 text-xs text-[#F3EEE8]"
                      >
                        <option value="solid">Solid Background</option>
                        <option value="transparent">Transparent Alpha</option>
                        <option value="chroma-key-green">Chroma Key Green</option>
                      </select>
                    </label>
                  </div>

                  {/* Unsupported Features Recovery */}
                  {project.unsupportedFeatures.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-[#24211F]">
                      <div className="text-[10px] font-mono-tabular uppercase text-[#E4B45A]">
                        Unsupported Feature Recovery
                      </div>
                      {project.unsupportedFeatures.map((uf) => (
                        <div
                          key={uf.id}
                          className="rounded border border-[#E4B45A]/30 bg-[#0E0D0C] p-2 space-y-1.5"
                        >
                          <div className="text-[11px] text-[#F3EEE8]">
                            [{uf.featureKey}] {uf.message}
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                dispatchCommand({
                                  type: 'resolveUnsupportedFeature',
                                  featureId: uf.id,
                                  resolutionStrategy:
                                    'convert-to-2d-approximation',
                                })
                              }
                              className="px-2 py-1 rounded bg-[#2A1810] border border-[#F06424]/50 text-[10px] text-[#F06424]"
                            >
                              Convert to 2D Approximation
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                dispatchCommand({
                                  type: 'resolveUnsupportedFeature',
                                  featureId: uf.id,
                                  resolutionStrategy: 'omit-from-export',
                                })
                              }
                              className="px-2 py-1 rounded border border-[#2A231E] bg-[#141210] text-[10px] text-[#B8AAA0]"
                            >
                              Omit on Export
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Warnings & Preserved Unknown Keys */}
                  <div className="rounded border border-[#24211F] bg-[#0E0D0C] p-2.5 space-y-1 font-mono-tabular text-[10.5px]">
                    <div className="text-[#55B98B]">
                      ✓ Schema v2.0.0 validated ({project.tracks.length} tracks,{' '}
                      {project.tracks.reduce((a, t) => a + t.clips.length, 0)} clips,{' '}
                      {project.scenes.length} scenes)
                    </div>
                    {liveValidation.warnings.map((w, i) => (
                      <div key={i} className="text-[#E4B45A]">
                        ⚠ {w}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ================================================================
              MODE 3: AI CO-EDIT MODE (TRANSACTIONAL DIFF, SELECTIVE ACCEPT/REJECT & AUDIT LOG)
             ================================================================ */}
          {disclosureMode === 'ai' && (
            <div className="space-y-3" data-testid="editor-ai-mode-panel">
              <div className="rounded-xl border border-[#2A231E] bg-[#161413] p-3.5 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono-tabular uppercase font-bold text-[#F06424] flex items-center gap-1.5">
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>AI Co-Editing Transaction Planner</span>
                  </span>
                  <span className="text-[10px] font-mono-tabular text-[#8E857E]">
                    Context: {selectedClip ? selectedClip.name : 'All Clips'} ·{' '}
                    Frame #{currentFrameNumber}
                  </span>
                </div>

                {/* Quick Prompt Chips */}
                <div className="flex flex-wrap gap-1.5">
                  {AI_PROMPT_EXAMPLES.map((ex) => (
                    <button
                      key={ex.label}
                      type="button"
                      onClick={() => handlePlanAiPrompt(ex.prompt)}
                      className="px-2 py-1 rounded border border-[#2A231E] bg-[#0E0D0C] hover:border-[#F06424] text-[10.5px] text-[#D8CFC8]"
                    >
                      {ex.label}
                    </button>
                  ))}
                </div>

                {/* Natural-Language Prompt Input */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handlePlanAiPrompt();
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    value={aiPromptInput}
                    onFocus={(e) =>
                      e.currentTarget.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest',
                      })
                    }
                    onChange={(e) => setAiPromptInput(e.target.value)}
                    placeholder='e.g. Change title to "Velocity 2.0" or Slow entrance from 0.3 to 0.7 seconds'
                    aria-label="AI Co-Editing Prompt"
                    data-testid="ai-coedit-prompt-input"
                    className="flex-1 min-h-[42px] rounded-lg border border-[#2A231E] bg-[#0E0D0C] px-3 text-xs text-[#F3EEE8] focus:border-[#F06424] outline-none"
                  />
                  <button
                    type="submit"
                    data-testid="ai-coedit-plan-btn"
                    className="min-h-[42px] px-3.5 rounded-lg bg-[#F06424] hover:bg-[#FF7434] text-[#080707] font-bold text-xs shrink-0"
                  >
                    Plan Diff
                  </button>
                </form>

                {/* Clarifying Questions Card */}
                {activeAiTransaction?.status === 'needs-clarification' && (
                  <div
                    data-testid="ai-coedit-clarification-box"
                    className="rounded-lg border border-[#E4B45A]/50 bg-[#241B12] p-3 space-y-2"
                  >
                    {activeAiTransaction.clarifyingQuestions.map((q) => (
                      <div key={q.id} className="space-y-2">
                        <div className="font-semibold text-[#F3EEE8]">
                          Clarification Needed: {q.question}
                        </div>
                        <div className="text-[11px] text-[#B8AAA0]">
                          {q.contextHint}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {q.suggestedAnswers.map((ans) => (
                            <button
                              key={ans}
                              type="button"
                              onClick={() => handlePlanAiPrompt(ans)}
                              className="px-2.5 py-1 rounded bg-[#0E0D0C] border border-[#E4B45A]/40 text-[11px] text-[#E4B45A] hover:border-[#F06424]"
                            >
                              {ans}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Honest Unsupported Capability Card */}
                {activeAiTransaction?.status === 'unsupported-operation' && (
                  <div className="rounded-lg border border-[#F06464]/50 bg-[#2A1414] p-3 space-y-1 text-[#F06464]">
                    <div className="font-bold">Unsupported Operation</div>
                    <p className="text-[11px] text-[#F3EEE8]">
                      {activeAiTransaction.unsupportedReason}
                    </p>
                  </div>
                )}

                {/* Proposed Edit Transaction Preview with Selective Accept/Reject & Diff */}
                {activeAiTransaction &&
                  (activeAiTransaction.status === 'proposed' ||
                    activeAiTransaction.status === 'applied') && (
                    <div
                      data-testid="ai-coedit-transaction-card"
                      className="rounded-lg border border-[#2A231E] bg-[#0E0D0C] p-3 space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono-tabular text-[10.5px] uppercase text-[#F06424]">
                          Transaction {activeAiTransaction.id} ·{' '}
                          {activeAiTransaction.status.toUpperCase()}
                        </span>
                        <span className="font-mono-tabular text-[10px] text-[#8E857E]">
                          Base r{activeAiTransaction.preconditions.expectedRevision}
                        </span>
                      </div>

                      {/* Selective Accept/Reject Operations */}
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-mono-tabular uppercase text-[#9E958E]">
                          Proposed Typed Commands (Toggle to Selective Accept/Reject)
                        </div>
                        {activeAiTransaction.operations.map((op) => (
                          <label
                            key={op.id}
                            className="flex items-start gap-2 rounded border border-[#24211F] bg-[#141210] p-2 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={op.selected}
                              disabled={activeAiTransaction.status === 'applied'}
                              onChange={() => handleToggleAiOperation(op.id)}
                              className="mt-0.5 accent-[#F06424]"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-[#F3EEE8]">
                                {op.label}
                              </div>
                              <div className="text-[10.5px] text-[#9E958E]">
                                {op.rationale}
                              </div>
                              <div className="text-[10px] font-mono-tabular text-[#787069]">
                                Command: {op.command.type} · Clips:{' '}
                                {op.affectedClipIds.join(', ') || 'canvas/track'} ·
                                Params: {op.affectedParameters.join(', ')}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>

                      {/* Proposed Diff Preview */}
                      <div className="rounded border border-[#24211F] bg-[#090808] p-2 space-y-1">
                        <div className="text-[10px] font-mono-tabular uppercase text-[#55B98B]">
                          Proposed Canonical Diff ({activeAiTransaction.proposedDiff.totalChanges}{' '}
                          change(s))
                        </div>
                        {activeAiTransaction.proposedDiff.entries.map((entry) => (
                          <div
                            key={entry.id}
                            className="text-[10.5px] font-mono-tabular text-[#D8CFC8]"
                          >
                            • {entry.humanSummary} ({entry.beforeValue} →{' '}
                            {entry.afterValue})
                          </div>
                        ))}
                      </div>

                      {activeAiTransaction.status === 'proposed' && (
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() =>
                              setActiveAiTransaction({
                                ...activeAiTransaction,
                                status: 'cancelled',
                              })
                            }
                            className="min-h-[40px] px-3 rounded-lg border border-[#2A231E] bg-[#141210] text-xs text-[#B8AAA0]"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleApplyAiTransaction}
                            data-testid="ai-coedit-apply-btn"
                            className="min-h-[40px] px-3.5 rounded-lg bg-[#F06424] hover:bg-[#FF7434] text-[#080707] font-bold text-xs inline-flex items-center gap-1.5"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Apply Selected &amp; Create Checkpoint</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                {/* Visible AI Change Log with Rollback */}
                <div className="pt-2 border-t border-[#24211F] space-y-2">
                  <div className="text-[10px] font-mono-tabular uppercase text-[#B8AAA0]">
                    Visible AI Change Log ({aiCoEditLogs.length})
                  </div>
                  {aiCoEditLogs.length === 0 ? (
                    <p className="text-[11px] text-[#787069]">
                      No AI Co-Edit transactions applied in this session yet.
                    </p>
                  ) : (
                    aiCoEditLogs.map((log) => (
                      <div
                        key={log.id}
                        data-testid="ai-coedit-log-entry"
                        className="rounded-lg border border-[#24211F] bg-[#0E0D0C] p-2.5 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[#F3EEE8]">
                            “{log.prompt}”
                          </span>
                          <span className="text-[10px] font-mono-tabular text-[#55B98B]">
                            r{log.beforeRevision} → r{log.afterRevision}
                          </span>
                        </div>
                        <div className="text-[10.5px] text-[#9E958E]">
                          {log.diffSummary} · Clips:{' '}
                          {log.affectedClipIds.join(', ') || 'canvas'} · Params:{' '}
                          {log.affectedParameters.join(', ')}
                        </div>
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[10px] font-mono-tabular text-[#787069]">
                            Accepted {log.acceptedOperationCount} op(s), Rejected{' '}
                            {log.rejectedOperationCount}
                          </span>
                          <button
                            type="button"
                            disabled={log.rolledBack}
                            onClick={() => handleRollbackAiLog(log)}
                            className="px-2.5 py-1 rounded border border-[#F06424]/50 bg-[#2A1810] disabled:opacity-40 text-[10px] font-semibold text-[#F06424]"
                          >
                            {log.rolledBack
                              ? 'Rolled Back'
                              : 'Rollback to Checkpoint'}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Command Receipt Audit Footer (Always Visible across Quick / Pro / AI Modes) */}
          <div className="rounded-xl border border-[#2A231E] bg-[#0B0A09] p-3 space-y-1.5 text-[11px] font-mono-tabular mt-auto">
            <div className="flex items-center justify-between text-[#8E857E]">
              <span>TYPED COMMAND RECEIPT LEDGER</span>
              <span>
                r{project.revision} · {receiptHistory.length} receipts
              </span>
            </div>
            {lastReceipt ? (
              <div
                className={`p-2 rounded border ${
                  lastReceipt.ok
                    ? 'border-[#55B98B]/40 bg-[#55B98B]/10 text-[#55B98B]'
                    : 'border-[#F06464]/40 bg-[#F06464]/10 text-[#F06464]'
                }`}
              >
                <div>
                  [{lastReceipt.commandType}] {lastReceipt.ok ? 'OK' : 'REJECTED'} ·
                  r{lastReceipt.beforeRevision}→r{lastReceipt.revision} ·{' '}
                  {lastReceipt.reversible !== false
                    ? `UndoRef: ${lastReceipt.undoRef}`
                    : `Irreversible: ${lastReceipt.irreversibleReason}`}
                </div>
                <div className="text-[10px] text-[#D8CFC8] truncate">
                  {lastReceipt.rationale}
                </div>
              </div>
            ) : (
              <div className="text-[#6E665F]">
                Ready. All manual and AI edits execute through shared typed commands.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
