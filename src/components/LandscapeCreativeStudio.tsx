import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CanonicalAssetDependency,
  CanonicalClip,
  CanonicalClipKind,
  CanonicalKeyframe,
  CanonicalKeyframeInterpolation,
  CanonicalProjectDocument,
  CanonicalTrack,
  CanonicalTrackKind,
} from '../types/canonicalProject';
import {
  CatalogItem,
  MobileAspectRatio,
  ModuleId,
  ProjectLibraryItem,
} from '../types/sowveil';
import { SOWVEIL_MODULES, MODULE_CATEGORIES } from '../data/modules';
import { SEED_CATALOG_ITEMS } from '../data/catalogSeeds';
import { getDimensionsForAspectRatio } from '../services/editorGateway';
import { renderCanonicalFrameSvg } from '../services/renderExportQaEngine';
import { sanitizeSvgContent } from '../features/editor-gateway/strategies';
import {
  buildCubicBezierSvgPath,
  EASING_CURVE_PRESETS,
} from '../services/coEditingEngine';
import {
  AnimatablePropertyKey,
  CanonicalEditorSessionManager,
  CanonicalSaveState,
  createNewUserCanonicalProject,
  createSevenTrackDemoCanonicalProject,
  sharedCanonicalEditorSession,
  useCanonicalEditorSession,
} from '../services/canonicalEditorSession';
import { executeAuthenticatedApiRequest, getFirebaseIdToken } from '../services/apiClient';
import {
  DETERMINISTIC_NO_PROVIDER_BANNER,
  DIRECTOR_12_STEP_WORKFLOW_DEFINITIONS,
  type AiDirectorProviderInvocationEvidence,
  type AiDirectorSessionRecord,
} from '../services/aiDirectorProductionEngine';
import type { ProviderConnectionPublicView } from '../types/providerHub';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Copy,
  Diamond,
  Download,
  Eye,
  EyeOff,
  Film,
  Flag,
  FolderKanban,
  FolderOpen,
  KeyRound,
  Layers,
  Layout,
  LayoutGrid,
  Lock,
  Magnet,
  Maximize2,
  Minimize2,
  Monitor,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Repeat,
  Save,
  Scissors,
  Search,
  SkipBack,
  SkipForward,
  Sliders,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Spline,
  Tablet,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export interface LandscapeCreativeStudioProps {
  projectId?: string | null;
  initialProject?: CanonicalProjectDocument | null;
  catalogItems?: CatalogItem[];
  projects?: ProjectLibraryItem[];
  ownerUid?: string;
  initialViewportWidth?: number;
  initialViewportHeight?: number;
  initialRightPanelTab?: RightPanelTab;
  sessionManager?: CanonicalEditorSessionManager;
  onFetchCanonicalProject?: (projectId: string) => Promise<{
    project: CanonicalProjectDocument;
    canUndo?: boolean;
    canRedo?: boolean;
  } | null>;
  onSaveProject?: (
    proj: ProjectLibraryItem,
    expectedRevision?: number
  ) => Promise<ProjectLibraryItem | void> | void;
  onNotify?: (message: string, tone?: 'info' | 'warning' | 'error' | 'success') => void;
}

export type RightPanelTab = 'director' | 'inspector' | 'effects' | 'animation' | 'assets';
export type StudioViewportMode = 'phone-portrait' | 'phone-landscape' | 'tablet' | 'desktop';
export type PortraitPrimaryPane = 'stage' | 'marketplace' | 'inspector' | 'director' | 'assets';
export type TimelineHeightPreset = 'collapsed' | 'compact' | 'expanded';

export interface StudioViewportLayoutMetrics {
  width: number;
  height: number;
  mode: StudioViewportMode;
  isPortrait: boolean;
  orientationBadge: 'PORTRAIT' | 'LANDSCAPE' | 'TABLET' | 'DESKTOP';
  showRotateHint: boolean;
  drawerPresentation:
    | 'portrait-sheet'
    | 'landscape-overlay'
    | 'tablet-single-dock'
    | 'desktop-dual-dock';
  allowSimultaneousSidebars: boolean;
  effectiveLeftOpen: boolean;
  effectiveRightOpen: boolean;
  leftDockedWidthPx: number;
  rightDockedWidthPx: number;
  timelineHeightPx: number;
  previewBoundingBox: {
    width: number;
    height: number;
    minWidthPx: number;
    minHeightPx: number;
  };
}

/**
 * Pure deterministic layout solver for the Creative Studio across
 * Phone Portrait, Phone Landscape, Tablet, and Wide Desktop viewports.
 * Guarantees the central preview bounding box never collapses to 0px.
 */
export function computeStudioViewportLayout(
  rawWidth: number,
  rawHeight: number,
  options?: {
    requestedLeftOpen?: boolean;
    requestedRightOpen?: boolean;
    lastInteractedDrawer?: 'left' | 'right' | null;
    timelinePreset?: TimelineHeightPreset;
  }
): StudioViewportLayoutMetrics {
  const width = Math.max(320, Math.round(rawWidth || 1024));
  const height = Math.max(280, Math.round(rawHeight || 768));
  const isPortrait = height > width;

  let mode: StudioViewportMode;
  if (width < 768 && isPortrait) {
    mode = 'phone-portrait';
  } else if (!isPortrait && (width < 1024 || height < 520)) {
    mode = 'phone-landscape';
  } else if (width < 1200) {
    mode = 'tablet';
  } else {
    mode = 'desktop';
  }

  const orientationBadge: StudioViewportLayoutMetrics['orientationBadge'] =
    mode === 'phone-portrait'
      ? 'PORTRAIT'
      : mode === 'phone-landscape'
      ? 'LANDSCAPE'
      : mode === 'tablet'
      ? 'TABLET'
      : 'DESKTOP';

  const showRotateHint = mode === 'phone-portrait';
  const allowSimultaneousSidebars = width >= 1024 && height >= 520;

  const reqLeft =
    options?.requestedLeftOpen ?? (mode === 'desktop' || (mode === 'tablet' && width >= 1024));
  const reqRight = options?.requestedRightOpen ?? (mode === 'desktop' || mode === 'tablet');
  const lastDrawer = options?.lastInteractedDrawer ?? 'right';

  let effectiveLeftOpen = reqLeft;
  let effectiveRightOpen = reqRight;

  if (!allowSimultaneousSidebars && effectiveLeftOpen && effectiveRightOpen) {
    if (lastDrawer === 'left') {
      effectiveRightOpen = false;
    } else {
      effectiveLeftOpen = false;
    }
  }

  const drawerPresentation: StudioViewportLayoutMetrics['drawerPresentation'] =
    mode === 'phone-portrait'
      ? 'portrait-sheet'
      : mode === 'phone-landscape'
      ? 'landscape-overlay'
      : allowSimultaneousSidebars
      ? 'desktop-dual-dock'
      : 'tablet-single-dock';

  const leftDockedWidthPx =
    (drawerPresentation === 'desktop-dual-dock' || drawerPresentation === 'tablet-single-dock') &&
    effectiveLeftOpen
      ? width >= 1280
        ? 288
        : 256
      : 0;

  const rightDockedWidthPx =
    (drawerPresentation === 'desktop-dual-dock' || drawerPresentation === 'tablet-single-dock') &&
    effectiveRightOpen
      ? width >= 1280
        ? 336
        : 288
      : 0;

  const preset: TimelineHeightPreset =
    options?.timelinePreset ??
    (mode === 'phone-landscape' || mode === 'phone-portrait' ? 'compact' : 'expanded');

  const timelineHeightPx =
    preset === 'collapsed'
      ? 32
      : preset === 'compact'
      ? mode === 'phone-landscape' && height < 440
        ? 96
        : 116
      : height < 520
      ? 124
      : 196;

  const chromeHeightPx = 40 + 36 + 36 + (mode === 'phone-portrait' ? 44 : 0);
  const previewWidth = Math.max(240, width - leftDockedWidthPx - rightDockedWidthPx);
  const previewHeight = Math.max(120, height - chromeHeightPx - timelineHeightPx);

  return {
    width,
    height,
    mode,
    isPortrait,
    orientationBadge,
    showRotateHint,
    drawerPresentation,
    allowSimultaneousSidebars,
    effectiveLeftOpen,
    effectiveRightOpen,
    leftDockedWidthPx,
    rightDockedWidthPx,
    timelineHeightPx,
    previewBoundingBox: {
      width: previewWidth,
      height: previewHeight,
      minWidthPx: mode === 'desktop' ? 420 : mode === 'tablet' ? 360 : 240,
      minHeightPx: mode === 'phone-landscape' ? 120 : 180,
    },
  };
}

export function createSevenTrackStarterProject(
  title = 'Sowveil Mobile Campaign',
  aspectRatio: MobileAspectRatio = '9:16',
  ownerUid = 'user-local'
): CanonicalProjectDocument {
  return createSevenTrackDemoCanonicalProject(ownerUid, undefined, title, aspectRatio);
}

// 7 Canonical Timeline Tracks with visual identities matching the supplied landscape design reference
const CANONICAL_TRACK_CONFIGS: Array<{
  id: string;
  name: string;
  shortLabel: string;
  kind: CanonicalTrackKind;
  color: string;
  borderColor: string;
  accentHex: string;
  badge: string;
  icon: React.FC<{ className?: string }>;
}> = [
  {
    id: 'track_video_1',
    name: 'Video (V1)',
    shortLabel: 'Video Track 1',
    kind: 'video',
    color: 'bg-[#0C4A6E]/85',
    borderColor: 'border-[#38BDF8]',
    accentHex: '#38BDF8',
    badge: 'V1',
    icon: Film,
  },
  {
    id: 'track_text_1',
    name: 'Text & Titles (T1)',
    shortLabel: 'Caption / Titles',
    kind: 'text',
    color: 'bg-[#581C87]/85',
    borderColor: 'border-[#C084FC]',
    accentHex: '#C084FC',
    badge: 'T1',
    icon: Type,
  },
  {
    id: 'track_motion_1',
    name: 'Motion Graphics (M1)',
    shortLabel: 'Motion Layer',
    kind: 'template',
    color: 'bg-[#4C1D95]/85',
    borderColor: 'border-[#818CF8]',
    accentHex: '#818CF8',
    badge: 'M1',
    icon: Layers,
  },
  {
    id: 'track_overlay_1',
    name: 'Overlays & FX (O1)',
    shortLabel: 'Adjustment FX',
    kind: 'effect',
    color: 'bg-[#1E3A8A]/85',
    borderColor: 'border-[#60A5FA]',
    accentHex: '#60A5FA',
    badge: 'O1',
    icon: Sparkles,
  },
  {
    id: 'track_voice_1',
    name: 'Voice / Narration (A1)',
    shortLabel: 'Audio 1 · Voice',
    kind: 'audio',
    color: 'bg-[#065F46]/85',
    borderColor: 'border-[#34D399]',
    accentHex: '#34D399',
    badge: 'A1',
    icon: Volume2,
  },
  {
    id: 'track_music_1',
    name: 'Music / BGM (A2)',
    shortLabel: 'Audio 2 · BGM',
    kind: 'audio',
    color: 'bg-[#047857]/85',
    borderColor: 'border-[#10B981]',
    accentHex: '#10B981',
    badge: 'A2',
    icon: Music,
  },
  {
    id: 'track_sfx_1',
    name: 'SFX / Foley (A3)',
    shortLabel: 'Audio 3 · SFX',
    kind: 'audio',
    color: 'bg-[#115E59]/85',
    borderColor: 'border-[#2DD4BF]',
    accentHex: '#2DD4BF',
    badge: 'A3',
    icon: Volume2,
  },
];

interface ActiveTimelineGesture {
  kind: 'move' | 'trim-head' | 'trim-tail';
  clipId: string;
  trackId: string;
  pointerId: number;
  startClientX: number;
  initialStartTimeSec: number;
  initialDurationSec: number;
  initialTrimInSec: number;
  initialTrimOutSec: number;
  liveStartTimeSec: number;
  liveDurationSec: number;
  liveTrimInSec: number;
  liveTrimOutSec: number;
}

const ANIMATABLE_PROPERTIES: Array<{ id: AnimatablePropertyKey; label: string }> = [
  { id: 'opacity', label: 'Opacity' },
  { id: 'positionX', label: 'Position X' },
  { id: 'positionY', label: 'Position Y' },
  { id: 'scaleX', label: 'Scale X' },
  { id: 'scaleY', label: 'Scale Y' },
  { id: 'rotationDeg', label: 'Rotation (°)' },
  { id: 'audioGainDb', label: 'Audio Gain (dB)' },
];

export const LandscapeCreativeStudio: React.FC<LandscapeCreativeStudioProps> = ({
  projectId,
  initialProject,
  catalogItems,
  projects = [],
  ownerUid = 'user-local',
  initialViewportWidth,
  initialViewportHeight,
  initialRightPanelTab = 'inspector',
  sessionManager = sharedCanonicalEditorSession,
  onFetchCanonicalProject,
  onSaveProject,
  onNotify,
}) => {
  const navigate = useNavigate();
  const { state: sessionState, session } = useCanonicalEditorSession(sessionManager);

  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>(() => ({
    width:
      initialViewportWidth ?? (typeof window !== 'undefined' ? window.innerWidth || 1024 : 1024),
    height:
      initialViewportHeight ?? (typeof window !== 'undefined' ? window.innerHeight || 768 : 768),
  }));

  const [newProjTitle, setNewProjTitle] = useState<string>('Untitled Sowveil Campaign');
  const [newProjAspectRatio, setNewProjAspectRatio] = useState<MobileAspectRatio>('16:9');

  const [newAssetLabel, setNewAssetLabel] = useState<string>('');
  const [newAssetMime, setNewAssetMime] = useState<string>('video/mp4');
  const [newAssetRole, setNewAssetRole] = useState<CanonicalAssetDependency['role']>('primary-media');

  const [activeGesture, setActiveGesture] = useState<ActiveTimelineGesture | null>(null);

  useEffect(() => {
    if (initialProject) {
      session.openProjectDocument(initialProject, {
        isDemoMode: false,
        savedRevision: initialProject.revision,
      });
      return;
    }

    if (projectId) {
      void session.loadProjectById(projectId, {
        ownerUid,
        localProjects: projects,
        fetchCanonicalFromServer: onFetchCanonicalProject,
      });
    }
  }, [initialProject, projectId, ownerUid, projects, onFetchCanonicalProject, session]);

  const emptyStageFallback = useMemo(
    () =>
      createNewUserCanonicalProject({
        id: 'proj_stage_standby',
        ownerUid,
        title: 'Select or Create a Project',
        aspectRatio: '16:9',
      }),
    [ownerUid]
  );

  const project: CanonicalProjectDocument = sessionState.project || emptyStageFallback;
  const sceneTracks: CanonicalTrack[] = useMemo(
    () => [...(project.tracks || [])].sort((a, b) => a.order - b.order),
    [project.tracks]
  );
  const sceneDurationSec = project.canvas.durationSec || 8;
  const aspectRatio: MobileAspectRatio = project.canvas.aspectRatio || '16:9';

  const currentTimeSec = sessionState.playheadSec;
  const isPlaying = sessionState.isPlaying;
  const isLooping = sessionState.loopEnabled;
  const snapEnabled = sessionState.snapEnabled;
  const timelineZoomPxPerSec = sessionState.timelineZoomPxPerSec;
  const selectedClipId = sessionState.selectedClipId;
  const multiSelectedClipIds = sessionState.multiSelectedClipIds;
  const selectedTrackId = sessionState.selectedTrackId;
  const selectedKeyframeId = sessionState.selectedKeyframeId;
  const selectedProperty = sessionState.selectedProperty;

  const [resolutionFps, setResolutionFps] = useState<
    '1080p · 30fps' | '720p · 30fps' | '540p Proxy'
  >('1080p · 30fps');
  const [previewScale, setPreviewScale] = useState<'fit' | '50%' | '75%' | '100%'>('fit');
  const [showSafeGuides, setShowSafeGuides] = useState<boolean>(true);

  const [activeModuleId, setActiveModuleId] = useState<ModuleId>('text-animation');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  const initialLayout = useMemo(
    () => computeStudioViewportLayout(viewportSize.width, viewportSize.height),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(initialLayout.effectiveLeftOpen);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(
    initialLayout.effectiveRightOpen
  );
  const [lastInteractedDrawer, setLastInteractedDrawer] = useState<'left' | 'right' | null>(
    'right'
  );
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>(initialRightPanelTab);
  const [timelinePreset, setTimelinePreset] = useState<TimelineHeightPreset>(() =>
    initialLayout.mode === 'phone-landscape' || initialLayout.mode === 'phone-portrait'
      ? 'compact'
      : 'expanded'
  );
  const [rotateHintDismissed, setRotateHintDismissed] = useState<boolean>(false);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialViewportWidth && initialViewportHeight) {
      setViewportSize({ width: initialViewportWidth, height: initialViewportHeight });
    }
  }, [initialViewportWidth, initialViewportHeight]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      const nextW = window.innerWidth || 1024;
      const nextH = window.innerHeight || 768;
      setViewportSize((prev) =>
        prev.width === nextW && prev.height === nextH ? prev : { width: nextW, height: nextH }
      );
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const rect = entry.contentRect;
          if (rect.width > 0 && rect.height > 0) {
            setViewportSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
          }
        }
      });
      observer.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      observer?.disconnect();
    };
  }, []);

  const studioLayout = useMemo(
    () =>
      computeStudioViewportLayout(viewportSize.width, viewportSize.height, {
        requestedLeftOpen: isSidebarOpen,
        requestedRightOpen: isRightPanelOpen,
        lastInteractedDrawer,
        timelinePreset,
      }),
    [
      viewportSize.width,
      viewportSize.height,
      isSidebarOpen,
      isRightPanelOpen,
      lastInteractedDrawer,
      timelinePreset,
    ]
  );

  useEffect(() => {
    if (!studioLayout.allowSimultaneousSidebars && isSidebarOpen && isRightPanelOpen) {
      if (lastInteractedDrawer === 'left') {
        setIsRightPanelOpen(false);
      } else {
        setIsSidebarOpen(false);
      }
    }
    if (studioLayout.mode === 'phone-landscape' || studioLayout.mode === 'phone-portrait') {
      setTimelinePreset((prev) => (prev === 'expanded' ? 'compact' : prev));
    }
  }, [
    studioLayout.allowSimultaneousSidebars,
    studioLayout.mode,
    isSidebarOpen,
    isRightPanelOpen,
    lastInteractedDrawer,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeGesture) {
          setActiveGesture(null);
          onNotify?.('Timeline gesture cancelled — restored original clip timing.', 'info');
          return;
        }
        if (isSwitcherOpen) {
          setIsSwitcherOpen(false);
          return;
        }
        if (studioLayout.mode === 'phone-landscape' || studioLayout.mode === 'phone-portrait') {
          if (isSidebarOpen) setIsSidebarOpen(false);
          if (isRightPanelOpen) setIsRightPanelOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeGesture,
    isSwitcherOpen,
    isSidebarOpen,
    isRightPanelOpen,
    studioLayout.mode,
    onNotify,
  ]);

  // Embedded AI Director Orchestration state (shared with AiDirectorWorkspace)
  const [directorScriptInput, setDirectorScriptInput] = useState<string>(
    'Stop fighting desktop keyframe timelines on a 6-inch screen.\nMeet Sowveil Studio 2.0: 20 specialized motion design modules built for mobile creators.'
  );
  const [directorActiveSession, setDirectorActiveSession] =
    useState<AiDirectorSessionRecord | null>(null);
  const [directorConnections, setDirectorConnections] = useState<
    ProviderConnectionPublicView[]
  >([]);
  const [directorSelectedConnectionId, setDirectorSelectedConnectionId] =
    useState<string>('');
  const [directorUseLiveProvider, setDirectorUseLiveProvider] =
    useState<boolean>(false);
  const [directorBusy, setDirectorBusy] = useState<boolean>(false);
  const [directorStatusMsg, setDirectorStatusMsg] = useState<string | null>(null);
  const [directorErrorMsg, setDirectorErrorMsg] = useState<string | null>(null);

  const loadEmbeddedDirectorState = useCallback(async () => {
    try {
      const [sessionsRes, connsRes] = await Promise.all([
        executeAuthenticatedApiRequest<{ items: AiDirectorSessionRecord[] }>(
          '/api/v1/ai-director/sessions',
          { getAuthToken: getFirebaseIdToken }
        ),
        executeAuthenticatedApiRequest<{ connections: ProviderConnectionPublicView[] }>(
          '/api/v1/provider-hub/connections',
          { getAuthToken: getFirebaseIdToken }
        ),
      ]);
      if (sessionsRes.ok && Array.isArray(sessionsRes.data?.items) && sessionsRes.data.items.length > 0) {
        setDirectorActiveSession((prev) => prev || sessionsRes.data!.items[0]);
      }
      if (connsRes.ok && Array.isArray(connsRes.data?.connections)) {
        setDirectorConnections(connsRes.data.connections);
        const ready = connsRes.data.connections.find(
          (c) =>
            c.credentialStatus === 'active' ||
            (c.authMode === 'server-env' &&
              !String(c.maskedCredential || '').includes('not set'))
        );
        if (ready) {
          setDirectorSelectedConnectionId((prev) => prev || ready.id);
        }
      }
    } catch {
      // Non-blocking background sync
    }
  }, []);

  useEffect(() => {
    if (rightPanelTab === 'director') {
      void loadEmbeddedDirectorState();
    }
  }, [rightPanelTab, loadEmbeddedDirectorState]);

  const handleEmbeddedDirectorCreateOrOrchestrate = useCallback(async () => {
    if (!directorScriptInput.trim()) {
      setDirectorErrorMsg('Enter a script passage before running AI Director orchestration.');
      return;
    }
    setDirectorBusy(true);
    setDirectorErrorMsg(null);
    setDirectorStatusMsg(null);
    try {
      const res = await executeAuthenticatedApiRequest<{ session: AiDirectorSessionRecord }>(
        '/api/v1/ai-director/sessions',
        {
          method: 'POST',
          getAuthToken: getFirebaseIdToken,
          body: {
            title: project.title || 'Landscape Studio Script Session',
            rawScriptText: directorScriptInput,
            intake: {
              title: project.title || 'Landscape Studio Script Session',
              aspectRatio: project.canvas.aspectRatio,
              fps: project.canvas.fps === 24 || project.canvas.fps === 30 ? project.canvas.fps : 60,
              noQuestionsWorkflow: true,
              autonomyMode: 'require-approval',
            },
            useLiveProvider: directorUseLiveProvider,
            connectionId: directorSelectedConnectionId || undefined,
          },
        }
      );
      if (!res.ok || !res.data?.session) {
        throw new Error(res.errorMessage || 'Failed to run AI Director orchestration');
      }
      const created = res.data.session;
      setDirectorActiveSession(created);
      setDirectorStatusMsg(
        `Segmented ${created.segments.length} script spans (${created.coverageLedger.coveragePercent}% coverage · ${created.providerStatusBanner || DETERMINISTIC_NO_PROVIDER_BANNER}).`
      );
    } catch (err) {
      setDirectorErrorMsg(err instanceof Error ? err.message : 'Orchestration failed');
    } finally {
      setDirectorBusy(false);
    }
  }, [
    directorScriptInput,
    project.title,
    project.canvas.aspectRatio,
    project.canvas.fps,
    directorUseLiveProvider,
    directorSelectedConnectionId,
  ]);

  const handleEmbeddedDirectorLiveProbe = useCallback(async () => {
    if (!directorActiveSession) return;
    setDirectorBusy(true);
    setDirectorErrorMsg(null);
    setDirectorStatusMsg(null);
    try {
      const res = await executeAuthenticatedApiRequest<{
        session: AiDirectorSessionRecord;
        latestInvocation: AiDirectorProviderInvocationEvidence;
      }>(`/api/v1/ai-director/sessions/${directorActiveSession.id}/orchestrate-live`, {
        method: 'POST',
        getAuthToken: getFirebaseIdToken,
        body: {
          connectionId: directorSelectedConnectionId || undefined,
          taskType: 'planning',
        },
      });
      if (!res.ok || !res.data?.session) {
        throw new Error(res.errorMessage || 'Live model orchestration failed');
      }
      setDirectorActiveSession(res.data.session);
      const inv = res.data.latestInvocation;
      if (inv.status === 'succeeded') {
        setDirectorStatusMsg(
          `Live model "${inv.actualContactedModelId}" succeeded in ${inv.latencyMs}ms (${inv.usage.totalTokens} tokens).`
        );
      } else {
        setDirectorErrorMsg(
          `Provider returned [${inv.status}]: ${inv.sanitizedError?.message || 'No live model configured'}. Retained 100% deterministic coverage.`
        );
      }
    } catch (err) {
      setDirectorErrorMsg(err instanceof Error ? err.message : 'Live model call failed');
    } finally {
      setDirectorBusy(false);
    }
  }, [directorActiveSession, directorSelectedConnectionId]);

  const handleEmbeddedDirectorCompileTimeline = useCallback(async () => {
    if (!directorActiveSession) return;
    setDirectorBusy(true);
    setDirectorErrorMsg(null);
    setDirectorStatusMsg(null);
    try {
      await executeAuthenticatedApiRequest<{ session: AiDirectorSessionRecord }>(
        `/api/v1/ai-director/sessions/${directorActiveSession.id}/plan`,
        {
          method: 'POST',
          getAuthToken: getFirebaseIdToken,
          body: { action: 'approve-all' },
        }
      );
      const prodRes = await executeAuthenticatedApiRequest<{ session: AiDirectorSessionRecord }>(
        `/api/v1/ai-director/sessions/${directorActiveSession.id}/produce`,
        {
          method: 'POST',
          getAuthToken: getFirebaseIdToken,
          body: {},
        }
      );
      if (!prodRes.ok || !prodRes.data?.session) {
        throw new Error(prodRes.errorMessage || 'Failed to compile canonical timeline');
      }
      const updated = prodRes.data.session;
      setDirectorActiveSession(updated);
      if (updated.canonicalProject) {
        session.openProjectDocument(updated.canonicalProject, {
          isDemoMode: false,
          savedRevision: updated.canonicalProject.revision,
          saveState: 'Saved',
          forceReplace: true,
        });
      }
      setDirectorStatusMsg(
        `Compiled ${updated.commandReceipts.length} typed commands into shared Canonical Project (rev r${updated.canonicalProject?.revision || 1}).`
      );
    } catch (err) {
      setDirectorErrorMsg(err instanceof Error ? err.message : 'Compile failed');
    } finally {
      setDirectorBusy(false);
    }
  }, [directorActiveSession, session]);

  const handleEmbeddedDirectorApproveRefinement = useCallback(
    async (suggestionId: string) => {
      if (!directorActiveSession) return;
      setDirectorBusy(true);
      setDirectorErrorMsg(null);
      setDirectorStatusMsg(null);
      try {
        const res = await executeAuthenticatedApiRequest<{ session: AiDirectorSessionRecord }>(
          `/api/v1/ai-director/sessions/${directorActiveSession.id}/refine`,
          {
            method: 'POST',
            getAuthToken: getFirebaseIdToken,
            body: { suggestionId, approvedByUser: true },
          }
        );
        if (!res.ok || !res.data?.session) {
          throw new Error(res.errorMessage || 'Refinement blocked');
        }
        const updated = res.data.session;
        setDirectorActiveSession(updated);
        if (updated.canonicalProject) {
          session.openProjectDocument(updated.canonicalProject, {
            isDemoMode: false,
            savedRevision: updated.canonicalProject.revision,
            saveState: 'Saved',
            forceReplace: true,
          });
        }
        setDirectorStatusMsg(
          `Approved & executed canonical command proposal (${suggestionId}) via shared command bus.`
        );
      } catch (err) {
        setDirectorErrorMsg(err instanceof Error ? err.message : 'Refinement failed');
      } finally {
        setDirectorBusy(false);
      }
    },
    [directorActiveSession, session]
  );

  const openLeftDrawer = useCallback(() => {
    setLastInteractedDrawer('left');
    setIsSidebarOpen(true);
    if (!studioLayout.allowSimultaneousSidebars) {
      setIsRightPanelOpen(false);
    }
  }, [studioLayout.allowSimultaneousSidebars]);

  const toggleLeftDrawer = useCallback(() => {
    if (studioLayout.effectiveLeftOpen) {
      setIsSidebarOpen(false);
    } else {
      openLeftDrawer();
    }
  }, [studioLayout.effectiveLeftOpen, openLeftDrawer]);

  const openRightDrawerTab = useCallback(
    (tab?: RightPanelTab) => {
      if (tab) setRightPanelTab(tab);
      setLastInteractedDrawer('right');
      setIsRightPanelOpen(true);
      if (!studioLayout.allowSimultaneousSidebars) {
        setIsSidebarOpen(false);
      }
    },
    [studioLayout.allowSimultaneousSidebars]
  );

  const toggleRightDrawer = useCallback(() => {
    if (studioLayout.effectiveRightOpen) {
      setIsRightPanelOpen(false);
    } else {
      openRightDrawerTab();
    }
  }, [studioLayout.effectiveRightOpen, openRightDrawerTab]);

  // Aspect Ratio update via Canonical Command
  const handleAspectRatioChange = useCallback(
    (newRatio: MobileAspectRatio) => {
      if (!sessionState.project) return;
      const dims = getDimensionsForAspectRatio(newRatio);
      const receipt = session.dispatchCommand(
        {
          type: 'updateCanvas',
          canvas: {
            aspectRatio: newRatio,
            width: dims.width,
            height: dims.height,
          },
        },
        { rationale: `Switch canvas aspect ratio to ${newRatio}` }
      );
      if (receipt.ok) {
        onNotify?.(
          `Switched canvas aspect ratio to ${newRatio} (${dims.width}×${dims.height})`,
          'info'
        );
      }
    },
    [session, sessionState.project, onNotify]
  );

  useEffect(() => {
    if (!isPlaying) return;
    let animId: number;
    let lastTime = performance.now();

    const loop = (now: number) => {
      const deltaSec = (now - lastTime) / 1000;
      lastTime = now;

      const current = session.getState().playheadSec;
      const next = current + deltaSec;
      if (next >= sceneDurationSec) {
        if (session.getState().loopEnabled) {
          session.setTransport({ playheadSec: 0 });
        } else {
          session.setTransport({ playheadSec: sceneDurationSec, isPlaying: false });
        }
      } else {
        session.setTransport({ playheadSec: next });
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, sceneDurationSec, session]);

  const selectedClip = useMemo<CanonicalClip | null>(() => {
    for (const track of sceneTracks) {
      const c = track.clips.find((item) => item.id === selectedClipId);
      if (c) return c;
    }
    return null;
  }, [sceneTracks, selectedClipId]);

  const selectedTrack = useMemo<CanonicalTrack | null>(() => {
    return sceneTracks.find((t) => t.id === selectedTrackId) || sceneTracks[0] || null;
  }, [sceneTracks, selectedTrackId]);

  const selectedKeyframe = useMemo<CanonicalKeyframe | null>(() => {
    if (!selectedClip) return null;
    return (
      selectedClip.keyframes.find((kf) => kf.id === selectedKeyframeId) ||
      selectedClip.keyframes[selectedClip.keyframes.length - 1] ||
      null
    );
  }, [selectedClip, selectedKeyframeId]);

  const handleUndo = useCallback(() => {
    if (!sessionState.canUndo) return;
    const receipt = session.undo(ownerUid);
    if (receipt.ok) {
      onNotify?.(`Undo: Restored revision ${receipt.revision}`, 'info');
    }
  }, [session, sessionState.canUndo, ownerUid, onNotify]);

  const handleRedo = useCallback(() => {
    if (!sessionState.canRedo) return;
    const receipt = session.redo(ownerUid);
    if (receipt.ok) {
      onNotify?.(`Redo: Applied revision ${receipt.revision}`, 'info');
    }
  }, [session, sessionState.canRedo, ownerUid, onNotify]);

  const handleSave = useCallback(async () => {
    if (!sessionState.project) {
      onNotify?.('Create or open a project before saving.', 'warning');
      return;
    }

    const result = await session.saveProject(async (record, expectedRevision) => {
      if (!onSaveProject) {
        return record;
      }
      return await onSaveProject(record, expectedRevision);
    });

    if (result.ok && result.record) {
      onNotify?.(
        `Saved "${result.record.title}" (rev ${result.record.revision}, ${result.record.fileSizeLabel}) to Project Library.`,
        'success'
      );
      if (projectId !== result.record.id) {
        navigate(`/app/landscape-studio/${encodeURIComponent(result.record.id)}`, {
          replace: true,
        });
      }
    } else if (result.saveState === 'Offline Draft') {
      onNotify?.('Device is offline. Saved locally as Offline Draft.', 'warning');
    } else if (result.saveState === 'Conflict') {
      onNotify?.(
        `Revision conflict detected: ${result.error || 'Server has a newer revision.'}`,
        'error'
      );
    } else {
      onNotify?.(`Save failed: ${result.error || 'Unable to persist project.'}`, 'error');
    }
  }, [session, sessionState.project, onSaveProject, onNotify, projectId, navigate]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, []);

  const handleSplitClipAtPlayhead = useCallback(() => {
    if (!selectedClip) {
      onNotify?.('Select a clip to split at the playhead position.', 'warning');
      return;
    }
    const receipt = session.dispatchCommand(
      {
        type: 'splitClip',
        clipId: selectedClip.id,
        splitTimeSec: currentTimeSec,
      },
      { rationale: `Split "${selectedClip.name}" at ${currentTimeSec.toFixed(2)}s` }
    );
    if (receipt.ok) {
      onNotify?.(`Split "${selectedClip.name}" at ${currentTimeSec.toFixed(2)}s.`, 'success');
    } else {
      onNotify?.(receipt.errors[0] || 'Playhead must be inside the selected clip to split.', 'warning');
    }
  }, [selectedClip, currentTimeSec, session, onNotify]);

  const handleDuplicateClip = useCallback(() => {
    if (!selectedClip) {
      onNotify?.('Select a clip to duplicate.', 'warning');
      return;
    }
    const receipt = session.dispatchCommand(
      {
        type: 'duplicateClip',
        clipId: selectedClip.id,
        startTimeSec: Number(
          (selectedClip.startTimeSec + selectedClip.durationSec + 0.1).toFixed(2)
        ),
      },
      { rationale: `Duplicate "${selectedClip.name}"` }
    );
    if (receipt.ok) {
      onNotify?.(`Duplicated "${selectedClip.name}".`, 'success');
    } else {
      onNotify?.(receipt.errors[0] || 'Could not duplicate clip.', 'warning');
    }
  }, [selectedClip, session, onNotify]);

  const handleDeleteClip = useCallback(() => {
    const targets =
      multiSelectedClipIds.length > 0
        ? multiSelectedClipIds
        : selectedClip
        ? [selectedClip.id]
        : [];
    if (targets.length === 0) return;

    let deletedCount = 0;
    for (const cid of targets) {
      const receipt = session.dispatchCommand(
        {
          type: 'deleteClip',
          clipId: cid,
        },
        { rationale: `Delete clip ${cid}` }
      );
      if (receipt.ok) deletedCount += 1;
    }
    if (deletedCount > 0) {
      onNotify?.(`Deleted ${deletedCount} clip(s) from timeline.`, 'info');
    }
  }, [multiSelectedClipIds, selectedClip, session, onNotify]);

  const handleToolbarKeyframe = useCallback(() => {
    if (!selectedClip) {
      onNotify?.('Select a clip on the timeline to add or update a keyframe.', 'warning');
      return;
    }
    const receipt = session.upsertKeyframeAtPlayhead({
      clipId: selectedClip.id,
      property: selectedProperty,
      actorId: ownerUid,
    });
    if (receipt?.ok) {
      onNotify?.(
        `Keyframe (${selectedProperty}) recorded on "${selectedClip.name}" at ${currentTimeSec.toFixed(2)}s.`,
        'success'
      );
    } else if (receipt) {
      onNotify?.(receipt.errors[0] || 'Unable to set keyframe on clip.', 'warning');
    }
  }, [selectedClip, selectedProperty, session, ownerUid, currentTimeSec, onNotify]);

  const handleAddMarkerAtPlayhead = useCallback(() => {
    const receipt = session.dispatchCommand(
      {
        type: 'addMarker',
        marker: {
          timeSec: Number(currentTimeSec.toFixed(2)),
          label: `Cue ${project.markers.length + 1}`,
          colorHex: '#F06424',
          kind: 'beat',
        },
      },
      { rationale: `Add timeline marker at ${currentTimeSec.toFixed(2)}s` }
    );
    if (receipt.ok) {
      onNotify?.(`Added timeline marker at ${currentTimeSec.toFixed(2)}s.`, 'info');
    }
  }, [project.markers.length, currentTimeSec, session, onNotify]);

  const handleReorderTrack = useCallback(
    (track: CanonicalTrack, direction: -1 | 1) => {
      const idx = sceneTracks.findIndex((t) => t.id === track.id);
      const swapIdx = idx + direction;
      if (idx < 0 || swapIdx < 0 || swapIdx >= sceneTracks.length) return;
      const neighbor = sceneTracks[swapIdx];
      session.dispatchCommand(
        {
          type: 'setTrackState',
          trackId: track.id,
          order: neighbor.order,
        },
        { rationale: `Move track "${track.name}" ${direction < 0 ? 'up' : 'down'}` }
      );
      session.dispatchCommand(
        {
          type: 'setTrackState',
          trackId: neighbor.id,
          order: track.order,
        },
        { rationale: `Swap track order with "${neighbor.name}"` }
      );
    },
    [sceneTracks, session]
  );

  const handleInsertItemAsClip = useCallback(
    (item: CatalogItem) => {
      if (!sessionState.project) {
        session.createNewProject({
          ownerUid,
          title: newProjTitle,
          aspectRatio: newProjAspectRatio,
        });
      }

      let targetTrackId = 'track_motion_1';
      let clipKind: CanonicalClipKind = 'template-instance';

      if (item.moduleId === 'text-animation') {
        targetTrackId = 'track_text_1';
        clipKind = 'text';
      } else if (item.moduleId === 'sfx') {
        targetTrackId = 'track_sfx_1';
        clipKind = 'audio';
      } else if (item.moduleId === 'backgrounds') {
        targetTrackId = 'track_video_1';
        clipKind = 'video';
      } else if (item.moduleId === 'overlays-fx') {
        targetTrackId = 'track_overlay_1';
        clipKind = 'adjustment-effect';
      }

      const currentDoc = session.getState().project;
      if (currentDoc && !currentDoc.tracks.some((t) => t.id === targetTrackId)) {
        targetTrackId = currentDoc.tracks[0]?.id || targetTrackId;
      }

      const duration = item.metadata?.durationSec || 3;
      const dims = getDimensionsForAspectRatio(aspectRatio);
      const receipt = session.dispatchCommand(
        {
          type: 'createClip',
          trackId: targetTrackId,
          clip: {
            name: item.name,
            kind: clipKind,
            sceneId: 'scene_1',
            startTimeSec: Number(currentTimeSec.toFixed(2)),
            durationSec: duration,
            sourceInSec: 0,
            sourceOutSec: duration,
            trimInSec: 0,
            trimOutSec: duration,
            speedMultiplier: 1,
            visible: true,
            locked: false,
            muted: false,
            solo: false,
            blendMode: item.moduleId === 'overlays-fx' ? 'screen' : 'normal',
            templateBinding: {
              baseTemplateId: item.id,
              baseTemplateVersion: '1.0.0',
              moduleId: item.moduleId,
              parameterOverrides: {},
              assetSlotBindings: {},
              editabilityLevel: 'parameter-rig',
            },
            transform: {
              position: [dims.width / 2, dims.height / 2],
              scale: [1, 1],
              rotationDeg: 0,
              anchor: [0.5, 0.5],
              opacity: 1,
            },
            textData:
              clipKind === 'text'
                ? {
                    content: item.name,
                    fontFamily: 'Plus Jakarta Sans',
                    fontSizePx: 42,
                    fontWeight: 700,
                    colorHex: '#F3EEE8',
                    alignment: 'center',
                    letterSpacingEm: 0.02,
                    lineHeightMultiplier: 1.2,
                  }
                : undefined,
            keyframes: [],
            effects: [],
            masks: [],
          },
        },
        { rationale: `Insert catalog item "${item.name}" onto ${targetTrackId}` }
      );

      if (receipt.ok) {
        onNotify?.(
          `Inserted "${item.name}" onto ${targetTrackId} at ${currentTimeSec.toFixed(2)}s.`,
          'success'
        );
        if (studioLayout.mode === 'phone-portrait' || studioLayout.mode === 'phone-landscape') {
          setIsSidebarOpen(false);
        }
      } else {
        onNotify?.(receipt.errors[0] || 'Could not insert clip.', 'warning');
      }
    },
    [
      session,
      sessionState.project,
      ownerUid,
      newProjTitle,
      newProjAspectRatio,
      aspectRatio,
      currentTimeSec,
      onNotify,
      studioLayout.mode,
    ]
  );

  const snapTimelineTime = useCallback(
    (rawSec: number, excludeClipId?: string): number => {
      const clamped = Math.max(0, Math.min(sceneDurationSec, rawSec));
      if (!snapEnabled) return Number(clamped.toFixed(2));

      const snapPoints: number[] = [0, currentTimeSec, sceneDurationSec];
      for (const m of project.markers) {
        snapPoints.push(m.timeSec);
      }
      for (const trk of sceneTracks) {
        for (const c of trk.clips) {
          if (c.id === excludeClipId) continue;
          snapPoints.push(c.startTimeSec, c.startTimeSec + c.durationSec);
        }
      }

      const thresholdSec = Math.max(0.08, 6 / timelineZoomPxPerSec);
      for (const pt of snapPoints) {
        if (Math.abs(clamped - pt) <= thresholdSec) {
          return Number(pt.toFixed(2));
        }
      }
      return Number(clamped.toFixed(2));
    },
    [snapEnabled, sceneDurationSec, currentTimeSec, project.markers, sceneTracks, timelineZoomPxPerSec]
  );

  const handleStartClipGesture = useCallback(
    (
      e: React.PointerEvent,
      clip: CanonicalClip,
      track: CanonicalTrack,
      kind: 'move' | 'trim-head' | 'trim-tail'
    ) => {
      e.stopPropagation();
      if (track.locked || clip.locked) {
        onNotify?.('Track or clip is locked. Unlock to move or trim.', 'warning');
        return;
      }

      if (e.shiftKey) {
        session.toggleClipInMultiSelection(clip.id);
      } else {
        session.setSelection({
          selectedClipId: clip.id,
          selectedTrackId: track.id,
        });
      }

      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        // ignore in synthetic environments
      }

      setActiveGesture({
        kind,
        clipId: clip.id,
        trackId: track.id,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        initialStartTimeSec: clip.startTimeSec,
        initialDurationSec: clip.durationSec,
        initialTrimInSec: clip.trimInSec,
        initialTrimOutSec: clip.trimOutSec,
        liveStartTimeSec: clip.startTimeSec,
        liveDurationSec: clip.durationSec,
        liveTrimInSec: clip.trimInSec,
        liveTrimOutSec: clip.trimOutSec,
      });
    },
    [session, onNotify]
  );

  const handlePointerMoveTimeline = useCallback(
    (e: React.PointerEvent) => {
      if (!activeGesture) return;
      const deltaSec = (e.clientX - activeGesture.startClientX) / timelineZoomPxPerSec;

      if (activeGesture.kind === 'move') {
        const nextStart = snapTimelineTime(
          activeGesture.initialStartTimeSec + deltaSec,
          activeGesture.clipId
        );
        const boundedStart = Math.max(
          0,
          Math.min(sceneDurationSec - activeGesture.initialDurationSec, nextStart)
        );
        setActiveGesture((prev) =>
          prev ? { ...prev, liveStartTimeSec: Number(boundedStart.toFixed(2)) } : null
        );
      } else if (activeGesture.kind === 'trim-head') {
        const originalEnd =
          activeGesture.initialStartTimeSec + activeGesture.initialDurationSec;
        const rawNewStart = snapTimelineTime(
          activeGesture.initialStartTimeSec + deltaSec,
          activeGesture.clipId
        );
        const clampedStart = Math.max(0, Math.min(originalEnd - 0.2, rawNewStart));
        const newDuration = Number((originalEnd - clampedStart).toFixed(2));
        const trimShift = Number(
          (clampedStart - activeGesture.initialStartTimeSec).toFixed(2)
        );
        setActiveGesture((prev) =>
          prev
            ? {
                ...prev,
                liveStartTimeSec: Number(clampedStart.toFixed(2)),
                liveDurationSec: newDuration,
                liveTrimInSec: Math.max(
                  0,
                  Number((activeGesture.initialTrimInSec + trimShift).toFixed(2))
                ),
              }
            : null
        );
      } else if (activeGesture.kind === 'trim-tail') {
        const rawNewEnd = snapTimelineTime(
          activeGesture.initialStartTimeSec + activeGesture.initialDurationSec + deltaSec,
          activeGesture.clipId
        );
        const clampedEnd = Math.max(
          activeGesture.initialStartTimeSec + 0.2,
          Math.min(sceneDurationSec, rawNewEnd)
        );
        const newDuration = Number(
          (clampedEnd - activeGesture.initialStartTimeSec).toFixed(2)
        );
        setActiveGesture((prev) =>
          prev
            ? {
                ...prev,
                liveDurationSec: newDuration,
                liveTrimOutSec: Number(
                  (activeGesture.initialTrimInSec + newDuration).toFixed(2)
                ),
              }
            : null
        );
      }
    },
    [activeGesture, timelineZoomPxPerSec, snapTimelineTime, sceneDurationSec]
  );

  const handlePointerUpTimeline = useCallback(() => {
    if (!activeGesture) return;
    const g = activeGesture;
    setActiveGesture(null);

    if (
      g.kind === 'move' &&
      Math.abs(g.liveStartTimeSec - g.initialStartTimeSec) >= 0.01
    ) {
      session.dispatchCommand(
        {
          type: 'moveClip',
          clipId: g.clipId,
          targetTrackId: g.trackId,
          startTimeSec: g.liveStartTimeSec,
        },
        { rationale: `Move clip to ${g.liveStartTimeSec.toFixed(2)}s` }
      );
    } else if (
      (g.kind === 'trim-head' || g.kind === 'trim-tail') &&
      (Math.abs(g.liveStartTimeSec - g.initialStartTimeSec) >= 0.01 ||
        Math.abs(g.liveDurationSec - g.initialDurationSec) >= 0.01)
    ) {
      session.dispatchCommand(
        {
          type: 'trimClip',
          clipId: g.clipId,
          startTimeSec: g.liveStartTimeSec,
          durationSec: g.liveDurationSec,
          trimInSec: g.liveTrimInSec,
          trimOutSec: g.liveTrimOutSec,
        },
        {
          rationale: `Trim clip (${g.kind}) to ${g.liveStartTimeSec.toFixed(2)}s – ${(
            g.liveStartTimeSec + g.liveDurationSec
          ).toFixed(2)}s`,
        }
      );
    }
  }, [activeGesture, session]);

  const sourceCatalogItems = useMemo(
    () => (catalogItems && catalogItems.length > 0 ? catalogItems : SEED_CATALOG_ITEMS),
    [catalogItems]
  );

  const filteredCatalogItems = useMemo(() => {
    return sourceCatalogItems.filter((item) => {
      const matchesMod = item.moduleId === activeModuleId;
      const matchesSearch =
        !searchQuery ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesCategory =
        selectedCategory === 'All' || item.categoryId === selectedCategory;
      return matchesMod && matchesSearch && matchesCategory;
    });
  }, [sourceCatalogItems, activeModuleId, searchQuery, selectedCategory]);

  const activeModuleCategories = useMemo(() => {
    return MODULE_CATEGORIES.filter((c) => c.moduleId === activeModuleId).sort(
      (a, b) => a.order - b.order
    );
  }, [activeModuleId]);

  const formatTimecode = (seconds: number, fps = 30): string => {
    const totalFrames = Math.floor(seconds * fps);
    const ff = totalFrames % fps;
    const totalSec = Math.floor(seconds);
    const ss = totalSec % 60;
    const mm = Math.floor(totalSec / 60) % 60;
    const hh = Math.floor(totalSec / 3600);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(
      ss
    ).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
  };

  const activeClipsAtTime = useMemo(() => {
    const list: Array<{ clip: CanonicalClip; track: CanonicalTrack }> = [];
    for (const track of sceneTracks) {
      if (!track.visible) continue;
      for (const clip of track.clips) {
        if (!clip.visible) continue;
        const start =
          activeGesture && activeGesture.clipId === clip.id
            ? activeGesture.liveStartTimeSec
            : clip.startTimeSec;
        const dur =
          activeGesture && activeGesture.clipId === clip.id
            ? activeGesture.liveDurationSec
            : clip.durationSec;
        if (currentTimeSec >= start && currentTimeSec <= start + dur) {
          list.push({ clip, track });
        }
      }
    }
    return list;
  }, [sceneTracks, currentTimeSec, activeGesture]);

  const canvasDims = useMemo(() => getDimensionsForAspectRatio(aspectRatio), [aspectRatio]);

  const liveCompositorSvg = useMemo(() => {
    return renderCanonicalFrameSvg(project, canvasDims.width, canvasDims.height, currentTimeSec);
  }, [project, canvasDims.width, canvasDims.height, currentTimeSec]);

  const numericPreviewScale = useMemo(() => {
    if (previewScale === '50%') return 0.5;
    if (previewScale === '75%') return 0.75;
    if (previewScale === '100%') return 1;
    return 1;
  }, [previewScale]);

  const handleCycleTimelinePreset = useCallback(() => {
    setTimelinePreset((prev) => {
      if (prev === 'expanded') return 'compact';
      if (prev === 'compact') return 'collapsed';
      return 'expanded';
    });
  }, []);

  const activePortraitNav: PortraitPrimaryPane = useMemo(() => {
    if (studioLayout.effectiveLeftOpen) return 'marketplace';
    if (studioLayout.effectiveRightOpen) {
      if (rightPanelTab === 'director') return 'director';
      if (rightPanelTab === 'inspector') return 'inspector';
      return 'assets';
    }
    return 'stage';
  }, [studioLayout.effectiveLeftOpen, studioLayout.effectiveRightOpen, rightPanelTab]);

  const audioMeterChannels = useMemo(() => {
    const audioTracks = sceneTracks.filter((t) => t.kind === 'audio');
    return audioTracks.map((t) => {
      const hasActiveClip = t.clips.some(
        (c) =>
          c.visible &&
          !c.muted &&
          currentTimeSec >= c.startTimeSec &&
          currentTimeSec <= c.startTimeSec + c.durationSec
      );
      const gainDb = t.gainDb ?? 0;
      const isMuted = t.muted || !t.visible;
      const rawPct = isMuted
        ? 0
        : hasActiveClip
        ? Math.min(98, Math.max(18, 78 + gainDb * 2.5))
        : 8;
      return {
        id: t.id,
        label:
          t.id === 'track_voice_1'
            ? 'Voice 1'
            : t.id === 'track_music_1'
            ? 'Music 2'
            : 'SFX 3',
        gainDb,
        isMuted,
        levelPct: Math.round(rawPct),
      };
    });
  }, [sceneTracks, currentTimeSec]);

  const isOverlayDrawerMode =
    studioLayout.drawerPresentation === 'landscape-overlay' ||
    studioLayout.drawerPresentation === 'portrait-sheet';

  const activeProjectIdSuffix = sessionState.project?.id
    ? `/${encodeURIComponent(sessionState.project.id)}`
    : '';

  const globalWorkspaces = useMemo(
    () => [
      {
        id: 'landscape-studio',
        label: 'Landscape Studio',
        path: `/app/landscape-studio${activeProjectIdSuffix}`,
        badge: 'Active',
        icon: Layout,
      },
      {
        id: 'marketplace',
        label: 'Marketplace (20 Modules)',
        path: '/app/text-animation',
        icon: LayoutGrid,
      },
      {
        id: 'editor',
        label: 'Editing Studio (Timeline)',
        path: `/app/editor${activeProjectIdSuffix}`,
        icon: SlidersHorizontal,
      },
      {
        id: 'ai-director',
        label: 'AI Director',
        path: '/app/ai-director',
        badge: 'AI',
        icon: Sparkles,
      },
      {
        id: 'reference-lab',
        label: 'Reference Lab',
        path: '/app/reference-lab',
        icon: Film,
      },
      {
        id: 'template-factory',
        label: 'Template Factory',
        path: '/app/template-factory',
        icon: Layers,
      },
      {
        id: 'provider-hub',
        label: 'Provider Hub',
        path: '/app/provider-hub',
        icon: Sliders,
      },
      {
        id: 'render-export',
        label: 'Render & QA',
        path: '/app/render-export',
        icon: Download,
      },
      {
        id: 'project-library',
        label: 'Project Library',
        path: '/app/project-library',
        icon: FolderKanban,
      },
      {
        id: 'admin',
        label: 'Admin Console',
        path: '/admin',
        icon: Lock,
      },
    ],
    [activeProjectIdSuffix]
  );

  const renderSaveStateBadge = (saveState: CanonicalSaveState) => {
    const styles: Record<CanonicalSaveState, string> = {
      Saved: 'bg-[#14291F] border-[#55B98B]/40 text-[#55B98B]',
      Saving: 'bg-[#38BDF8]/15 border-[#38BDF8]/40 text-[#38BDF8]',
      'Offline Draft': 'bg-[#EAB308]/15 border-[#EAB308]/40 text-[#EAB308]',
      'Unsaved Changes': 'bg-[#F06424]/15 border-[#F06424]/40 text-[#F06424]',
      Conflict: 'bg-[#EF4444]/20 border-[#EF4444]/60 text-[#EF4444]',
      Failed: 'bg-[#EF4444]/20 border-[#EF4444]/60 text-[#EF4444]',
    };
    return (
      <span
        data-testid="studio-save-status-badge"
        data-save-state={saveState}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold tracking-wide shrink-0 ${styles[saveState]}`}
        title={
          sessionState.saveError
            ? `${saveState}: ${sessionState.saveError}`
            : `Project Save Status: ${saveState} (rev ${project.revision})`
        }
      >
        {saveState === 'Saved' && <CheckCircle2 className="w-2.5 h-2.5" />}
        {saveState === 'Saving' && <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
        {saveState === 'Offline Draft' && <CloudOff className="w-2.5 h-2.5" />}
        {(saveState === 'Conflict' || saveState === 'Failed') && (
          <AlertTriangle className="w-2.5 h-2.5" />
        )}
        <span>{`${saveState} · r${project.revision}`}</span>
      </span>
    );
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-[100dvh] w-screen overflow-hidden bg-[#080707] text-[#F3EEE8] safe-all select-none relative"
      data-testid="landscape-creative-studio-root"
      data-viewport-mode={studioLayout.mode}
      data-drawer-presentation={studioLayout.drawerPresentation}
      data-editor-mode={sessionState.mode}
      data-project-id={sessionState.project?.id || ''}
      data-project-revision={sessionState.project?.revision || 1}
    >
      {/* =========================================================================
          0. PROJECT CHOOSER / NEW PROJECT / EXPLICIT DEMO MODE GATE
          ========================================================================= */}
      {sessionState.mode === 'chooser' && (
        <div
          data-testid="studio-project-chooser"
          className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="w-full max-w-2xl rounded-xl border border-[#342A24] bg-[#0E0C0B] shadow-2xl p-4 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-[#24201D] pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-[#F06424]/15 border border-[#F06424]/40 text-[#F06424] text-[10px] font-bold uppercase tracking-wider">
                    Canonical Creative Studio
                  </span>
                  <span className="text-[11px] font-mono-tabular text-[#83766D]">
                    Shared Core v2.0
                  </span>
                </div>
                <h2 className="text-base sm:text-lg font-bold text-[#F3EEE8] mt-1">
                  Open Saved Project or Start New Timeline
                </h2>
                <p className="text-xs text-[#B8AAA0]">
                  Landscape Studio and Standard Editor share one canonical timeline document, undo history, and authoritative revision store.
                </p>
              </div>
              {sessionState.project && (
                <button
                  type="button"
                  onClick={() => session.resumeActiveProjectFromChooser()}
                  className="px-2.5 py-1 rounded border border-[#342A24] bg-[#141210] text-xs text-[#B8AAA0] hover:text-[#F3EEE8]"
                >
                  Resume Current
                </button>
              )}
            </div>

            {sessionState.loadError && (
              <div
                data-testid="studio-project-load-error"
                className="p-2.5 rounded-lg bg-[#EF4444]/15 border border-[#EF4444]/40 text-xs text-[#FCA5A5] flex items-center gap-2"
              >
                <AlertTriangle className="w-4 h-4 text-[#EF4444] shrink-0" />
                <span>{sessionState.loadError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Column: Create New Canonical Project or Explicit Demo */}
              <div className="p-3.5 rounded-lg border border-[#26201C] bg-[#141210] space-y-3">
                <div className="text-xs font-bold text-[#F3EEE8] uppercase tracking-wider">
                  1. Create New Canonical Project
                </div>
                <div className="space-y-2">
                  <label className="block text-[11px] text-[#B8AAA0]">Project Title</label>
                  <input
                    type="text"
                    data-testid="chooser-new-project-title-input"
                    value={newProjTitle}
                    onChange={(e) => setNewProjTitle(e.target.value)}
                    placeholder="Enter project title..."
                    className="w-full bg-[#0B0A09] border border-[#2A231E] rounded px-2.5 py-1.5 text-xs text-[#F3EEE8] focus:border-[#F06424] focus:outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[11px] text-[#B8AAA0]">Canvas Aspect Ratio</label>
                  <div className="grid grid-cols-4 gap-1">
                    {(['16:9', '9:16', '1:1', '4:5'] as MobileAspectRatio[]).map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => setNewProjAspectRatio(ratio)}
                        className={`py-1 rounded text-xs font-mono-tabular border ${
                          newProjAspectRatio === ratio
                            ? 'bg-[#F06424] text-[#080707] border-[#F06424] font-bold'
                            : 'bg-[#0B0A09] text-[#B8AAA0] border-[#26201C]'
                        }`}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="chooser-new-project-btn"
                  onClick={() => {
                    const created = session.createNewProject({
                      ownerUid,
                      title: newProjTitle,
                      aspectRatio: newProjAspectRatio,
                    });
                    onNotify?.(
                      `Created new canonical project "${created.title}" (${newProjAspectRatio}).`,
                      'success'
                    );
                  }}
                  className="w-full py-2 rounded-lg bg-[#F06424] hover:bg-[#FF7434] text-[#080707] font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create New Project</span>
                </button>

                <div className="pt-2 border-t border-[#221D1A] space-y-1.5">
                  <div className="text-[11px] text-[#83766D]">
                    Want to explore a pre-populated 7-track showcase first?
                  </div>
                  <button
                    type="button"
                    data-testid="chooser-load-demo-btn"
                    onClick={() => {
                      const demo = session.enterExplicitDemoMode(ownerUid);
                      onNotify?.(
                        `Loaded explicit 7-Track Sample Demo ("${demo.title}"). Save to persist a copy to your library.`,
                        'info'
                      );
                    }}
                    className="w-full py-1.5 rounded-lg border border-[#38BDF8]/40 bg-[#38BDF8]/10 hover:bg-[#38BDF8]/20 text-[#38BDF8] font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Enter Explicit 7-Track Sample Demo Mode</span>
                  </button>
                </div>
              </div>

              {/* Right Column: Saved Projects from Authoritative Repository */}
              <div className="p-3.5 rounded-lg border border-[#26201C] bg-[#141210] flex flex-col max-h-72">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[#F3EEE8] uppercase tracking-wider">
                    2. Saved Projects ({projects.length})
                  </span>
                  <Link
                    to="/app/project-library"
                    className="text-[11px] text-[#F06424] hover:underline"
                  >
                    Manage Library
                  </Link>
                </div>
                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                  {projects.length === 0 ? (
                    <div className="p-4 text-center text-xs text-[#83766D]">
                      No saved projects in your workspace yet. Create a new project on the left.
                    </div>
                  ) : (
                    projects.map((p) => (
                      <div
                        key={p.id}
                        className="p-2 rounded border border-[#221D1A] bg-[#0B0A09] hover:border-[#F06424]/50 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#F3EEE8] truncate">
                            {p.title}
                          </div>
                          <div className="text-[10px] text-[#83766D] font-mono-tabular">
                            {p.aspectRatio || '16:9'} · rev {p.revision || 1} ·{' '}
                            {p.fileSizeLabel || 'Canonical'}
                          </div>
                        </div>
                        <button
                          type="button"
                          data-testid={`chooser-open-project-btn-${p.id}`}
                          onClick={async () => {
                            const loaded = await session.loadProjectById(p.id, {
                              ownerUid,
                              localProjects: projects,
                              fetchCanonicalFromServer: onFetchCanonicalProject,
                            });
                            if (loaded) {
                              navigate(`/app/landscape-studio/${encodeURIComponent(loaded.id)}`, {
                                replace: true,
                              });
                              onNotify?.(
                                `Opened "${loaded.title}" (rev ${loaded.revision}).`,
                                'info'
                              );
                            }
                          }}
                          className="px-2.5 py-1 rounded bg-[#F06424] hover:bg-[#FF7434] text-[#080707] text-[10px] font-bold shrink-0"
                        >
                          Open
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          1. COMPACT PROJECT HEADER & GLOBAL WORKSPACE SWITCHER
          ========================================================================= */}
      <header className="h-10 shrink-0 px-2.5 sm:px-3 flex items-center justify-between border-b border-[#24201D] bg-[#0B0A09] gap-1.5 sm:gap-2 text-xs z-30">
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <button
            type="button"
            onClick={toggleLeftDrawer}
            aria-label={
              studioLayout.effectiveLeftOpen
                ? 'Close Marketplace Drawer'
                : 'Open Marketplace Drawer'
            }
            className={`p-1 rounded border transition-colors shrink-0 ${
              studioLayout.effectiveLeftOpen
                ? 'bg-[#F06424]/15 border-[#F06424]/60 text-[#F06424]'
                : 'bg-[#141210] border-[#26201C] text-[#B8AAA0] hover:text-[#F3EEE8]'
            }`}
            title={
              studioLayout.effectiveLeftOpen
                ? 'Hide Marketplace & Assets Panel'
                : 'Open Marketplace & Assets Panel'
            }
          >
            {studioLayout.effectiveLeftOpen ? (
              <PanelLeftClose className="w-3.5 h-3.5" />
            ) : (
              <PanelLeftOpen className="w-3.5 h-3.5" />
            )}
          </button>

          <Link
            to="/app"
            className="flex items-center gap-1.5 font-black tracking-widest text-[#F3EEE8] hover:text-[#F06424] transition-colors shrink-0"
            title="Go to Sowveil Dashboard"
          >
            <span className="text-xs">SOWVEIL</span>
          </Link>

          <span
            data-testid="studio-viewport-badge"
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold tracking-wider shrink-0 ${
              studioLayout.isPortrait
                ? 'bg-[#38BDF8]/15 border-[#38BDF8]/50 text-[#38BDF8]'
                : 'bg-[#2A1810] border-[#F06424]/60 text-[#F06424]'
            }`}
            title={`Measured Viewport: ${studioLayout.width}×${studioLayout.height}px (${studioLayout.mode})`}
          >
            {studioLayout.mode === 'phone-portrait' ||
            studioLayout.mode === 'phone-landscape' ? (
              <Smartphone className="w-2.5 h-2.5" />
            ) : studioLayout.mode === 'tablet' ? (
              <Tablet className="w-2.5 h-2.5" />
            ) : (
              <Monitor className="w-2.5 h-2.5" />
            )}
            <span>{studioLayout.orientationBadge}</span>
          </span>

          {sessionState.isDemoMode && (
            <span
              data-testid="studio-demo-mode-badge"
              className="px-1.5 py-0.5 rounded bg-[#38BDF8]/15 border border-[#38BDF8]/50 text-[#38BDF8] text-[9px] font-bold uppercase tracking-wider shrink-0"
              title="Explicit Sample Demo Mode — Save to persist a copy into your personal Project Library"
            >
              DEMO MODE
            </span>
          )}

          <span className="text-[#342A24] hidden xs:inline">|</span>

          <input
            type="text"
            value={project.title}
            onChange={(e) => {
              if (!sessionState.project) return;
              session.dispatchCommand(
                {
                  type: 'renameProject',
                  title: e.target.value,
                },
                { rationale: 'Rename project from header' }
              );
            }}
            className="bg-transparent border border-transparent hover:border-[#342A24] focus:border-[#F06424] focus:bg-[#121110] rounded px-1.5 py-0.5 text-xs text-[#F3EEE8] font-semibold truncate max-w-[100px] sm:max-w-[160px] md:max-w-[200px]"
            title="Click to rename canonical project"
          />

          <button
            type="button"
            data-testid="studio-open-chooser-btn"
            onClick={() => session.openProjectChooser()}
            className="p-1 rounded border border-[#26201C] bg-[#141210] text-[#B8AAA0] hover:text-[#F3EEE8] hover:border-[#F06424]/50 shrink-0"
            title="Switch Project, Create New Project, or Load Demo"
          >
            <FolderOpen className="w-3.5 h-3.5 text-[#F06424]" />
          </button>
        </div>

        <div className="hidden md:flex items-center gap-1.5 shrink-0">
          <div className="flex items-center bg-[#141210] border border-[#26201C] rounded-md p-0.5 text-[10px]">
            {(['9:16', '16:9', '1:1', '4:5'] as MobileAspectRatio[]).map((ratio) => (
              <button
                key={ratio}
                type="button"
                onClick={() => handleAspectRatioChange(ratio)}
                className={`px-1.5 py-0.5 rounded transition-colors font-mono-tabular ${
                  aspectRatio === ratio
                    ? 'bg-[#F06424] text-[#080707] font-bold'
                    : 'text-[#B8AAA0] hover:text-[#F3EEE8]'
                }`}
                title={`Switch Canvas to ${ratio}`}
              >
                {ratio}
              </button>
            ))}
          </div>

          <select
            value={resolutionFps}
            onChange={(e) => setResolutionFps(e.target.value as any)}
            aria-label="Preview Resolution and Frame Rate"
            className="bg-[#141210] border border-[#26201C] text-[#B8AAA0] text-[10px] rounded px-1.5 py-0.5 focus:border-[#F06424] focus:text-[#F3EEE8]"
          >
            <option value="1080p · 30fps">1080p · 30fps</option>
            <option value="720p · 30fps">720p · 30fps</option>
            <option value="540p Proxy">540p Proxy</option>
          </select>

          <span className="font-mono-tabular text-[11px] text-[#55B98B] bg-[#0E1E16] border border-[#55B98B]/30 px-1.5 py-0.5 rounded">
            {formatTimecode(currentTimeSec)} / {formatTimecode(sceneDurationSec)}
          </span>
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {renderSaveStateBadge(sessionState.saveState)}

          <button
            type="button"
            data-testid="studio-undo-btn"
            onClick={handleUndo}
            disabled={!sessionState.canUndo}
            className="p-1 rounded text-[#B8AAA0] hover:text-[#F3EEE8] disabled:opacity-30 disabled:pointer-events-none hover:bg-[#191614]"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            data-testid="studio-redo-btn"
            onClick={handleRedo}
            disabled={!sessionState.canRedo}
            className="p-1 rounded text-[#B8AAA0] hover:text-[#F3EEE8] disabled:opacity-30 disabled:pointer-events-none hover:bg-[#191614]"
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            data-testid="studio-save-btn"
            onClick={handleSave}
            disabled={sessionState.saveState === 'Saving'}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[#F06424] hover:bg-[#FF7434] disabled:opacity-50 text-[#080707] font-bold text-xs transition-colors"
            title="Save Canonical Project to Authoritative Repository (Ctrl+S)"
          >
            <Save className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {sessionState.saveState === 'Saving' ? 'Saving...' : 'Save'}
            </span>
          </button>

          <button
            type="button"
            onClick={toggleRightDrawer}
            aria-label={
              studioLayout.effectiveRightOpen ? 'Close Inspector Panel' : 'Open Inspector Panel'
            }
            className={`p-1 rounded border transition-colors ${
              studioLayout.effectiveRightOpen
                ? 'bg-[#F06424]/15 border-[#F06424]/60 text-[#F06424]'
                : 'bg-[#141210] border-[#26201C] text-[#B8AAA0] hover:text-[#F3EEE8]'
            }`}
            title={
              studioLayout.effectiveRightOpen
                ? 'Hide Inspector & AI Director'
                : 'Open Inspector & AI Director'
            }
          >
            {studioLayout.effectiveRightOpen ? (
              <PanelRightClose className="w-3.5 h-3.5" />
            ) : (
              <PanelRightOpen className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            className="hidden sm:inline-flex p-1 rounded text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#191614]"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>

          <div className="relative">
            <button
              type="button"
              aria-expanded={isSwitcherOpen}
              aria-haspopup="menu"
              onClick={() => setIsSwitcherOpen((prev) => !prev)}
              className="flex items-center gap-1 px-2 py-1 rounded border border-[#342A24] bg-[#141210] hover:border-[#F06424] text-xs font-medium text-[#F3EEE8] transition-colors"
              title="Switch Workspace"
            >
              <Layout className="w-3.5 h-3.5 text-[#F06424]" />
              <span className="hidden lg:inline">Workspace</span>
              <ChevronDown className="w-3 h-3 text-[#B8AAA0]" />
            </button>

            {isSwitcherOpen && (
              <>
                <div
                  data-testid="workspace-switcher-backdrop"
                  className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
                  onClick={() => setIsSwitcherOpen(false)}
                />
                <div
                  role="menu"
                  aria-label="Global Workspace Switcher"
                  className="absolute right-0 top-full mt-1.5 w-64 max-h-[80dvh] overflow-y-auto rounded-lg border border-[#342A24] bg-[#0E0C0B] shadow-2xl z-50 p-1.5 flex flex-col gap-0.5"
                >
                  <div className="px-2 py-1 flex items-center justify-between text-[10px] uppercase font-bold tracking-wider text-[#83766D] border-b border-[#26201C]">
                    <span>Global Workspace Switcher</span>
                    <button
                      type="button"
                      onClick={() => setIsSwitcherOpen(false)}
                      className="p-0.5 rounded text-[#83766D] hover:text-[#F3EEE8]"
                      title="Close menu (Esc)"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {globalWorkspaces.map((ws) => {
                    const Icon = ws.icon;
                    const isActive = ws.id === 'landscape-studio';
                    return (
                      <Link
                        key={ws.id}
                        to={ws.path}
                        onClick={() => setIsSwitcherOpen(false)}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors ${
                          isActive
                            ? 'bg-[#F06424]/15 text-[#F06424] font-semibold border border-[#F06424]/40'
                            : 'text-[#B8AAA0] hover:bg-[#191614] hover:text-[#F3EEE8]'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span>{ws.label}</span>
                        </span>
                        {ws.badge && (
                          <span
                            className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                              ws.badge === 'Active'
                                ? 'bg-[#F06424] text-[#080707]'
                                : 'bg-[#55B98B]/20 text-[#55B98B]'
                            }`}
                          >
                            {ws.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* =========================================================================
          2. HORIZONTALLY SCROLLABLE 20-MODULE REFERENCE STRIP
          ========================================================================= */}
      <nav
        aria-label="20 Canonical Reference Modules"
        className="h-9 shrink-0 flex items-center px-2 border-b border-[#221D1A] bg-[#0A0908] overflow-x-auto no-scrollbar gap-1.5 text-xs z-20"
      >
        <span className="text-[10px] uppercase font-bold tracking-wider text-[#83766D] pl-1 pr-1.5 shrink-0 hidden sm:inline">
          Modules:
        </span>

        {SOWVEIL_MODULES.map((mod) => {
          const isActive = mod.id === activeModuleId;
          const count = mod.referenceReportedCount;

          return (
            <button
              key={mod.id}
              type="button"
              onClick={() => {
                setActiveModuleId(mod.id);
                setSelectedCategory('All');
                openLeftDrawer();
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium whitespace-nowrap shrink-0 transition-colors border ${
                isActive
                  ? 'bg-[#F06424] text-[#080707] font-bold border-[#F06424] shadow-[0_0_10px_rgba(240,100,36,0.35)]'
                  : 'bg-[#141210] text-[#B8AAA0] border-[#221D1A] hover:border-[#83766D] hover:text-[#F3EEE8]'
              }`}
              title={`${mod.label} (${count ?? 'Active'}) — Click to browse in Marketplace drawer`}
            >
              <span>{mod.label}</span>
              {count !== undefined && (
                <span
                  className={`text-[10px] font-mono-tabular px-1 rounded ${
                    isActive ? 'bg-[#080707]/30 text-[#080707]' : 'text-[#83766D]'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}

        <Link
          to={`/app/${activeModuleId}`}
          className="ml-auto flex items-center gap-1 text-[10px] text-[#F06424] hover:underline whitespace-nowrap shrink-0 px-2 font-semibold"
          title="Open original 1:1 reference Marketplace layout for this module"
        >
          <span>Open in Marketplace</span>
          <ArrowRight className="w-3 h-3" />
        </Link>
      </nav>

      {/* =========================================================================
          3. MAIN STUDIO WORKSPACE (RESPONSIVE MULTI-PANEL STAGE)
          ========================================================================= */}
      <div className="flex-1 flex overflow-hidden min-h-0 min-w-0 relative">
        {isOverlayDrawerMode &&
          (studioLayout.effectiveLeftOpen || studioLayout.effectiveRightOpen) && (
            <div
              data-testid="studio-drawer-backdrop"
              className="absolute inset-0 bg-black/55 backdrop-blur-[1px] z-20"
              onClick={() => {
                setIsSidebarOpen(false);
                setIsRightPanelOpen(false);
              }}
            />
          )}

        {/* ---------------------------------------------------------------------
            A. MARKETPLACE & ASSET BROWSER DRAWER (LEFT)
            --------------------------------------------------------------------- */}
        <aside
          aria-label="Marketplace and Assets Drawer"
          data-testid="studio-left-drawer"
          data-open={studioLayout.effectiveLeftOpen ? 'true' : 'false'}
          className={`flex flex-col border-r border-[#26201C] bg-[#0D0C0B] transition-all duration-200 ${
            studioLayout.drawerPresentation === 'portrait-sheet'
              ? studioLayout.effectiveLeftOpen
                ? 'absolute inset-0 z-30 w-full'
                : 'hidden'
              : studioLayout.drawerPresentation === 'landscape-overlay'
              ? studioLayout.effectiveLeftOpen
                ? 'absolute left-0 top-0 bottom-0 z-30 w-72 max-w-[82vw] shadow-2xl'
                : 'hidden'
              : studioLayout.effectiveLeftOpen
              ? 'shrink-0 w-64 lg:w-72 z-10'
              : 'w-0 overflow-hidden border-none shrink-0'
          }`}
        >
          <div className="p-2.5 border-b border-[#26201C] flex items-center justify-between gap-2 bg-[#0E0D0C]">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-bold text-[#F3EEE8] truncate">
                {SOWVEIL_MODULES.find((m) => m.id === activeModuleId)?.label || 'Catalog'}
              </span>
              <span className="text-[10px] font-mono-tabular text-[#55B98B] bg-[#55B98B]/10 border border-[#55B98B]/30 px-1.5 py-0.2 rounded">
                {filteredCatalogItems.length} loaded
              </span>
            </div>

            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="flex items-center gap-1 px-1.5 py-1 rounded text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#191614] text-[10px] font-medium"
              title="Close Marketplace drawer"
            >
              {isOverlayDrawerMode && <span>Back to Stage</span>}
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-2 border-b border-[#221D1A]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#83766D] absolute left-2 top-2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search templates & assets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#141210] border border-[#2A231E] rounded-md pl-7 pr-7 py-1 text-xs text-[#F3EEE8] placeholder-[#83766D] focus:border-[#F06424] focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-2 text-[#83766D] hover:text-[#F3EEE8]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {activeModuleCategories.length > 0 && (
            <div className="px-2 py-1.5 border-b border-[#221D1A] flex items-center gap-1 overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setSelectedCategory('All')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${
                  selectedCategory === 'All'
                    ? 'bg-[#F06424] text-[#080707] font-bold'
                    : 'bg-[#141210] text-[#B8AAA0] hover:text-[#F3EEE8]'
                }`}
              >
                All
              </button>
              {activeModuleCategories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${
                    selectedCategory === cat.id
                      ? 'bg-[#F06424] text-[#080707] font-bold'
                      : 'bg-[#141210] text-[#B8AAA0] hover:text-[#F3EEE8]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {filteredCatalogItems.length === 0 ? (
              <div className="p-4 text-center text-xs text-[#83766D]">
                No items match your filter.
              </div>
            ) : (
              filteredCatalogItems.map((item) => (
                <div
                  key={item.id}
                  className="group rounded-lg border border-[#221D1A] bg-[#141210] hover:border-[#F06424]/60 p-2 transition-all"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold text-[#F3EEE8] truncate group-hover:text-[#F06424]">
                      {item.name}
                    </span>
                    <span className="text-[10px] font-mono-tabular px-1.5 py-0.2 rounded bg-[#0B0A09] border border-[#26201C] text-[#B8AAA0]">
                      {item.metadata?.durationSec ? `${item.metadata.durationSec}s` : '2.5s'}
                    </span>
                  </div>

                  <p className="text-[11px] text-[#B8AAA0] line-clamp-1 mb-2">
                    {item.description || item.summary || `${item.categoryId} template`}
                  </p>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#1C1816]">
                    <span className="text-[9px] text-[#83766D] uppercase tracking-wider font-semibold truncate">
                      {item.categoryId}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleInsertItemAsClip(item)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#F06424] hover:bg-[#FF7434] text-[#080707] text-[10px] font-bold transition-colors shrink-0"
                      title="Insert as clip onto canonical timeline at playhead"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Insert Clip</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {!studioLayout.effectiveLeftOpen && studioLayout.mode !== 'phone-portrait' && (
          <button
            type="button"
            onClick={openLeftDrawer}
            className="absolute left-1 top-2 z-20 p-1.5 rounded-r bg-[#191614] border border-l-0 border-[#342A24] text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#26201C]"
            title="Open Marketplace sidebar"
          >
            <PanelLeftOpen className="w-4 h-4 text-[#F06424]" />
          </button>
        )}

        {/* ---------------------------------------------------------------------
            B. CENTRAL ASPECT-RATIO-AWARE PREVIEW STAGE (CENTER — ALWAYS VISIBLE)
            --------------------------------------------------------------------- */}
        <main
          data-testid="studio-center-stage"
          style={{
            minWidth: `${studioLayout.previewBoundingBox.minWidthPx}px`,
            minHeight: `${studioLayout.previewBoundingBox.minHeightPx}px`,
          }}
          className="flex-1 flex flex-col bg-[#050505] overflow-hidden min-w-0 min-h-0"
        >
          <div className="h-7 shrink-0 px-3 flex items-center justify-between border-b border-[#181513] bg-[#080707] text-[10px] text-[#83766D]">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono-tabular text-[#B8AAA0] font-semibold truncate">
                || Scene {resolutionFps.split(' ')[0]} — {project.title} (rev {project.revision})
              </span>
              <span className="px-1.5 py-0.2 rounded bg-[#14291F] border border-[#55B98B]/40 text-[#55B98B] font-bold text-[9px]">
                Active
              </span>
              <div className="flex md:hidden items-center gap-0.5 bg-[#141210] border border-[#26201C] rounded p-0.5">
                {(['9:16', '16:9', '1:1', '4:5'] as MobileAspectRatio[]).map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    onClick={() => handleAspectRatioChange(ratio)}
                    className={`px-1 py-0.2 rounded font-mono-tabular text-[9px] ${
                      aspectRatio === ratio
                        ? 'bg-[#F06424] text-[#080707] font-bold'
                        : 'text-[#83766D]'
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {studioLayout.showRotateHint && !rotateHintDismissed && (
                <button
                  type="button"
                  onClick={() => setRotateHintDismissed(true)}
                  data-testid="portrait-rotate-hint"
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#38BDF8]/10 border border-[#38BDF8]/30 text-[#38BDF8] text-[9px]"
                  title="Dismiss landscape hint"
                >
                  <span>Rotate for multi-panel landscape view</span>
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
              <Link
                to={`/app/editor${activeProjectIdSuffix}`}
                data-testid="switch-to-standard-editor-link"
                className="text-[10px] text-[#38BDF8] hover:underline font-semibold hidden sm:inline"
                title="Switch to Standard Editor layout with the exact same canonical session"
              >
                Standard Layout
              </Link>
              <span className="font-mono-tabular text-[#B8AAA0]">
                {canvasDims.width}×{canvasDims.height} · {formatTimecode(currentTimeSec)}
              </span>
            </div>
          </div>

          <div
            data-testid="studio-preview-viewport"
            data-preview-width={studioLayout.previewBoundingBox.width}
            data-preview-height={studioLayout.previewBoundingBox.height}
            className="flex-1 relative flex items-center justify-center p-2 sm:p-3 overflow-hidden bg-[#050505] min-h-0 min-w-0"
          >
            <div
              data-testid="studio-preview-canvas"
              className="relative shadow-[0_12px_40px_rgba(0,0,0,0.85)] border border-[#26201C] bg-[#090808] flex items-center justify-center overflow-hidden transition-transform duration-200"
              style={{
                aspectRatio:
                  aspectRatio === '9:16'
                    ? '9 / 16'
                    : aspectRatio === '16:9'
                    ? '16 / 9'
                    : aspectRatio === '1:1'
                    ? '1 / 1'
                    : '4 / 5',
                maxHeight: '100%',
                maxWidth: '100%',
                width: aspectRatio === '9:16' ? 'auto' : '100%',
                height: aspectRatio === '9:16' ? '100%' : 'auto',
                transform: previewScale === 'fit' ? undefined : `scale(${numericPreviewScale})`,
              }}
            >
              {showSafeGuides && (
                <div className="absolute inset-0 pointer-events-none z-30">
                  <div className="absolute inset-[5%] border border-[#38BDF8]/25 border-dashed rounded" />
                  <div className="absolute inset-[10%] border border-[#EAB308]/25 border-dashed rounded" />
                </div>
              )}

              <div
                className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden z-0"
                dangerouslySetInnerHTML={{ __html: sanitizeSvgContent(liveCompositorSvg) }}
              />

              <div className="absolute inset-0 flex flex-col items-center justify-center p-4 overflow-hidden z-10 pointer-events-none">
                {activeClipsAtTime
                  .filter((c) => c.clip.kind === 'text')
                  .map(({ clip }) => {
                    const isSelected = clip.id === selectedClipId;
                    return (
                      <div
                        key={clip.id}
                        onClick={() => {
                          session.setSelection({
                            selectedClipId: clip.id,
                            selectedTrackId: clip.trackId,
                          });
                        }}
                        className={`pointer-events-auto z-20 my-1.5 cursor-pointer transition-transform ${
                          isSelected
                            ? 'ring-2 ring-[#F06424] ring-offset-2 ring-offset-black rounded px-2'
                            : ''
                        }`}
                      >
                        <h2
                          className="font-black tracking-tight text-center uppercase"
                          style={{
                            color: clip.textData?.colorHex || '#F3EEE8',
                            fontSize: clip.textData?.fontSizePx
                              ? `${Math.max(15, clip.textData.fontSizePx * 0.44)}px`
                              : '22px',
                            letterSpacing: `${(clip.textData?.letterSpacingEm || 0.02) * 16}px`,
                          }}
                        >
                          {clip.textData?.content || clip.name}
                        </h2>
                      </div>
                    );
                  })}

                {activeClipsAtTime.some((c) => c.track.id === 'track_voice_1') && (
                  <div
                    data-testid="preview-caption-bar"
                    className="absolute bottom-3 px-2.5 py-0.5 rounded bg-black/75 border border-white/10 text-[10px] text-[#F3EEE8] font-medium z-20"
                  >
                    Ready to launch on Android Creative Studio.
                  </div>
                )}
              </div>

              <div className="absolute top-2 left-2 z-30 font-mono-tabular text-[9px] text-[#B8AAA0] bg-[#080707]/75 backdrop-blur-sm px-1.5 py-0.5 rounded border border-[#26201C]">
                {formatTimecode(currentTimeSec)}
              </div>
            </div>
          </div>

          <div className="h-9 shrink-0 px-2.5 sm:px-3 flex items-center justify-between border-t border-[#1D1917] bg-[#0B0A09] gap-2 text-xs">
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => session.setTransport({ playheadSec: 0 })}
                className="p-1 rounded text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#191614]"
                title="Jump to Start (Home)"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  session.setTransport({ playheadSec: Math.max(0, currentTimeSec - 1 / 30) })
                }
                className="p-1 rounded text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#191614]"
                title="Step Back 1 Frame (Left Arrow)"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                data-testid="studio-play-pause-btn"
                onClick={() => session.setTransport({ isPlaying: !isPlaying })}
                className="w-6 h-6 rounded-full flex items-center justify-center bg-[#F06424] hover:bg-[#FF7434] text-[#080707] font-bold shadow-md transition-colors"
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? (
                  <Pause className="w-3 h-3 fill-current" />
                ) : (
                  <Play className="w-3 h-3 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  session.setTransport({
                    playheadSec: Math.min(sceneDurationSec, currentTimeSec + 1 / 30),
                  })
                }
                className="p-1 rounded text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#191614]"
                title="Step Forward 1 Frame (Right Arrow)"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => session.setTransport({ playheadSec: sceneDurationSec })}
                className="p-1 rounded text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#191614]"
                title="Jump to End (End)"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => session.setTransport({ loopEnabled: !isLooping })}
                className={`p-1 rounded transition-colors ${
                  isLooping ? 'text-[#F06424]' : 'text-[#83766D] hover:text-[#F3EEE8]'
                }`}
                title={isLooping ? 'Loop Playback Active' : 'Loop Playback Off'}
              >
                <Repeat className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 max-w-md flex items-center gap-2 px-1">
              <span className="font-mono-tabular text-[10px] text-[#B8AAA0]">
                {currentTimeSec.toFixed(2)}s
              </span>
              <input
                type="range"
                min={0}
                max={sceneDurationSec}
                step={0.01}
                value={currentTimeSec}
                onChange={(e) =>
                  session.setTransport({ playheadSec: parseFloat(e.target.value) })
                }
                aria-label="Timeline Playhead Scrubber"
                className="w-full accent-[#F06424] h-1.5 bg-[#26201C] rounded cursor-pointer"
              />
              <span className="font-mono-tabular text-[10px] text-[#83766D]">
                {sceneDurationSec.toFixed(1)}s
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setShowSafeGuides((g) => !g)}
                className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                  showSafeGuides
                    ? 'border-[#38BDF8] text-[#38BDF8] bg-[#38BDF8]/10'
                    : 'border-[#26201C] text-[#83766D] hover:text-[#F3EEE8]'
                }`}
                title="Toggle Title & Action Safe Guides"
              >
                Guides
              </button>

              <select
                value={previewScale}
                onChange={(e) => setPreviewScale(e.target.value as any)}
                aria-label="Canvas Zoom Scale"
                className="bg-[#141210] border border-[#26201C] text-[#B8AAA0] text-[10px] rounded px-1.5 py-0.5"
              >
                <option value="fit">Fit View</option>
                <option value="50%">50%</option>
                <option value="75%">75%</option>
                <option value="100%">100%</option>
              </select>
            </div>
          </div>
        </main>

        {/* ---------------------------------------------------------------------
            C. RIGHT-SIDE TABBED EDITOR PANEL (AI DIRECTOR / INSPECTOR / EFFECTS / ANIMATION / ASSETS)
            --------------------------------------------------------------------- */}
        <aside
          aria-label="Inspector and AI Director Panel"
          data-testid="studio-right-drawer"
          data-open={studioLayout.effectiveRightOpen ? 'true' : 'false'}
          className={`flex flex-col border-l border-[#26201C] bg-[#0D0C0B] transition-all duration-200 ${
            studioLayout.drawerPresentation === 'portrait-sheet'
              ? studioLayout.effectiveRightOpen
                ? 'absolute inset-0 z-30 w-full'
                : 'hidden'
              : studioLayout.drawerPresentation === 'landscape-overlay'
              ? studioLayout.effectiveRightOpen
                ? 'absolute right-0 top-0 bottom-0 z-30 w-80 max-w-[85vw] shadow-2xl'
                : 'hidden'
              : studioLayout.effectiveRightOpen
              ? 'shrink-0 w-72 lg:w-80 xl:w-96 z-10'
              : 'w-0 overflow-hidden border-none shrink-0'
          }`}
        >
          <div className="p-1 border-b border-[#26201C] flex items-center justify-between bg-[#0E0D0C] gap-1">
            <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
              {(
                [
                  { id: 'director', label: 'AI Director', icon: Sparkles },
                  { id: 'inspector', label: 'Inspector', icon: Sliders },
                  { id: 'effects', label: 'Effects', icon: Sparkles },
                  { id: 'animation', label: 'Animation', icon: Spline },
                  { id: 'assets', label: 'Assets', icon: Layers },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const isActive = rightPanelTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    data-testid={`right-tab-btn-${tab.id}`}
                    onClick={() => setRightPanelTab(tab.id)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                      isActive
                        ? 'bg-[#F06424] text-[#080707] font-bold shadow'
                        : 'text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#191614]'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setIsRightPanelOpen(false)}
              className="flex items-center gap-1 px-1.5 py-1 rounded text-[#83766D] hover:text-[#F3EEE8] hover:bg-[#191614] shrink-0 text-[10px]"
              title="Close Inspector panel"
            >
              {isOverlayDrawerMode && <span>Stage</span>}
              <PanelRightClose className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* TAB 1: AI DIRECTOR (Connected to Shared AiDirectorWorkspace Orchestration Service & Command Bus) */}
            {rightPanelTab === 'director' && (() => {
              const configuredConns = directorConnections.filter(
                (c) =>
                  c.credentialStatus === 'active' ||
                  (c.authMode === 'server-env' &&
                    !String(c.maskedCredential || '').includes('not set'))
              );
              const hasLiveInvocation = Boolean(
                directorActiveSession?.providerInvocations?.some(
                  (inv) => inv.status === 'succeeded' && inv.actualContactedModelId
                )
              );
              const bannerText =
                directorActiveSession?.providerStatusBanner ||
                (configuredConns.length === 0 || !hasLiveInvocation
                  ? DETERMINISTIC_NO_PROVIDER_BANNER
                  : `Live AI Provider Verified (${directorActiveSession?.actualContactedModels?.join(', ')})`);
              const workflowSteps =
                directorActiveSession?.workflowSteps &&
                directorActiveSession.workflowSteps.length === 12
                  ? directorActiveSession.workflowSteps
                  : DIRECTOR_12_STEP_WORKFLOW_DEFINITIONS.map((def) => ({
                      ...def,
                      status: 'pending' as const,
                      executionMode: 'not-started' as const,
                      summary: 'Pending script intake',
                      updatedAt: '',
                    }));

              return (
                <div className="space-y-3" data-testid="right-tab-director">
                  <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#F06424]/10 border border-[#F06424]/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <Sparkles className="w-4 h-4 text-[#F06424] shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#F06424]">
                          Authenticated AI Director Orchestration
                        </div>
                        <div
                          className="text-[10px] font-medium text-[#E4B45A] truncate"
                          data-testid="embedded-director-provider-banner"
                        >
                          {bannerText}
                        </div>
                      </div>
                    </div>
                    <span className="px-1.5 py-0.5 rounded bg-[#55B98B]/15 border border-[#55B98B]/40 text-[#55B98B] text-[9px] font-bold shrink-0">
                      Rev r{project.revision}
                    </span>
                  </div>

                  {/* 12-Step Production Workflow Compact Status */}
                  <div
                    className="p-2.5 rounded-lg border border-[#26201C] bg-[#141210] space-y-1.5"
                    data-testid="embedded-director-12-step-workflow"
                  >
                    <div className="flex items-center justify-between text-[10px] font-bold text-[#F3EEE8]">
                      <span>12-Step Production Pipeline</span>
                      <span className="font-mono text-[#83766D]">
                        {
                          workflowSteps.filter(
                            (s) =>
                              s.status === 'completed-live-ai' ||
                              s.status === 'completed-deterministic-baseline'
                          ).length
                        }
                        /12
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {workflowSteps.map((step) => {
                        const isLive = step.status === 'completed-live-ai';
                        const isDet = step.status === 'completed-deterministic-baseline';
                        return (
                          <div
                            key={step.stepId}
                            title={step.summary}
                            className={`px-1.5 py-1 rounded border text-[9px] truncate ${
                              isLive
                                ? 'bg-[#55B98B]/15 border-[#55B98B]/40 text-[#55B98B]'
                                : isDet
                                ? 'bg-[#F06424]/15 border-[#F06424]/40 text-[#F3EEE8]'
                                : 'bg-[#0B0A09] border-[#221D1A] text-[#83766D]'
                            }`}
                          >
                            {step.stepNumber}. {step.label}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Script & Provider Orchestration Controls */}
                  <div className="p-2.5 rounded-lg border border-[#26201C] bg-[#141210] space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#F3EEE8]">Script & Model Router</span>
                      <label className="flex items-center gap-1 text-[10px] text-[#B8AAA0] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={directorUseLiveProvider}
                          onChange={(e) => setDirectorUseLiveProvider(e.target.checked)}
                        />
                        Live Model
                      </label>
                    </div>

                    <select
                      aria-label="Embedded AI Director Provider Connection"
                      value={directorSelectedConnectionId}
                      onChange={(e) => setDirectorSelectedConnectionId(e.target.value)}
                      className="w-full px-2 py-1 rounded bg-[#0B0A09] border border-[#26201C] text-[11px] text-[#F3EEE8]"
                    >
                      <option value="">Auto-route (Argon Planning / Flash Fast)</option>
                      {directorConnections.map((conn) => (
                        <option key={conn.id} value={conn.id}>
                          {conn.label} · {conn.modelId} ({conn.credentialStatus})
                        </option>
                      ))}
                    </select>

                    <textarea
                      rows={3}
                      value={directorScriptInput}
                      onChange={(e) => setDirectorScriptInput(e.target.value)}
                      data-testid="embedded-director-script-input"
                      placeholder="Paste script for offset-exact segmentation & shot planning..."
                      className="w-full px-2 py-1.5 rounded bg-[#0B0A09] border border-[#26201C] text-[11px] text-[#F3EEE8] font-mono"
                    />

                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        disabled={directorBusy}
                        onClick={handleEmbeddedDirectorCreateOrOrchestrate}
                        data-testid="embedded-director-analyze-btn"
                        className="py-1.5 px-2 rounded bg-[#F06424] hover:bg-[#FF7434] disabled:opacity-50 text-[#080707] font-bold text-[11px]"
                      >
                        {directorBusy ? 'Running...' : '1. Analyze & Plan'}
                      </button>
                      <button
                        type="button"
                        disabled={directorBusy || !directorActiveSession}
                        onClick={handleEmbeddedDirectorCompileTimeline}
                        data-testid="embedded-director-compile-btn"
                        className="py-1.5 px-2 rounded bg-[#55B98B] hover:bg-[#66CA9C] disabled:opacity-40 text-[#080707] font-bold text-[11px]"
                      >
                        2. Compile Timeline
                      </button>
                    </div>

                    {directorActiveSession && (
                      <button
                        type="button"
                        disabled={directorBusy}
                        onClick={handleEmbeddedDirectorLiveProbe}
                        data-testid="embedded-director-live-orchestrate-btn"
                        className="w-full py-1 px-2 rounded border border-[#F06424]/40 bg-[#F06424]/10 hover:bg-[#F06424]/20 text-[#F06424] font-semibold text-[10px]"
                      >
                        Invoke Configured Provider Hub Model (/orchestrate-live)
                      </button>
                    )}

                    {directorErrorMsg && (
                      <div className="p-2 rounded bg-red-950/50 border border-red-500/40 text-[10px] text-red-200">
                        {directorErrorMsg}
                      </div>
                    )}
                    {directorStatusMsg && (
                      <div className="p-2 rounded bg-emerald-950/50 border border-emerald-500/40 text-[10px] text-emerald-200">
                        {directorStatusMsg}
                      </div>
                    )}
                  </div>

                  {/* Canonical Command Proposals Preview/Diff & Approval Gate */}
                  {directorActiveSession &&
                    directorActiveSession.refinementSuggestions.length > 0 && (
                      <div
                        className="p-2.5 rounded-lg border border-[#26201C] bg-[#141210] space-y-2 text-xs"
                        data-testid="embedded-director-proposals-list"
                      >
                        <div className="font-bold text-[#F3EEE8] flex items-center justify-between">
                          <span>Canonical Command Proposals</span>
                          <span className="text-[10px] font-mono text-[#F06424]">
                            {directorActiveSession.refinementSuggestions.length} proposals
                          </span>
                        </div>
                        {directorActiveSession.refinementSuggestions.map((ref) => {
                          const prop = ref.canonicalCommandProposal;
                          return (
                            <div
                              key={ref.suggestionId}
                              className="p-2 rounded bg-[#0B0A09] border border-[#221D1A] space-y-1 text-[10px]"
                            >
                              <div className="flex items-center justify-between font-semibold text-[#F3EEE8]">
                                <span>{ref.title}</span>
                                <span className="font-mono text-[#F06424]">{ref.status}</span>
                              </div>
                              <div className="text-[#B8AAA0]">{ref.reason}</div>
                              {prop &&
                                prop.propertyChanges.map((chg, idx) => (
                                  <div key={idx} className="font-mono text-[#D5D8E0]">
                                    {chg.clipName}.{chg.propertyPath}:{' '}
                                    <span className="text-red-300">
                                      {JSON.stringify(chg.beforeValue)}
                                    </span>{' '}
                                    →{' '}
                                    <span className="text-emerald-300">
                                      {JSON.stringify(chg.afterValue)}
                                    </span>
                                  </div>
                                ))}
                              {ref.status === 'proposed' && (
                                <button
                                  type="button"
                                  disabled={directorBusy || ref.blockedByUserLock}
                                  onClick={() =>
                                    handleEmbeddedDirectorApproveRefinement(ref.suggestionId)
                                  }
                                  data-testid={`embedded-director-approve-${ref.suggestionId}`}
                                  className="w-full mt-1 py-1 px-2 rounded bg-[#F06424] text-[#080707] font-bold text-[10px]"
                                >
                                  Approve & Execute on Shared Command Bus
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                  <div className="pt-1 flex flex-col gap-1.5">
                    <Link
                      to="/app/ai-director"
                      data-testid="open-authenticated-ai-director-link"
                      className="w-full py-2 px-3 rounded bg-[#F06424] hover:bg-[#FF7434] text-[#080707] font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Open Full AI Director Workspace</span>
                    </Link>
                    <Link
                      to="/app/provider-hub"
                      className="w-full py-1.5 px-3 rounded border border-[#26201C] bg-[#0B0A09] hover:border-[#F06424]/50 text-[#B8AAA0] hover:text-[#F3EEE8] text-[11px] font-medium text-center"
                    >
                      Configure Model Connections in Provider Hub
                    </Link>
                  </div>

                  <div className="p-2.5 rounded-lg border border-[#221D1A] bg-[#121110] space-y-1 text-xs">
                    <div className="font-semibold text-[#F3EEE8] flex items-center justify-between">
                      <span>Recent Command Audit</span>
                      <span className="text-[10px] font-mono-tabular text-[#55B98B]">
                        {sessionState.receiptHistory.length} receipts
                      </span>
                    </div>
                    {sessionState.lastReceipt ? (
                      <div className="text-[11px] text-[#B8AAA0] font-mono-tabular">
                        Last: {sessionState.lastReceipt.commandType} (rev{' '}
                        {sessionState.lastReceipt.beforeRevision} →{' '}
                        {sessionState.lastReceipt.revision})
                      </div>
                    ) : (
                      <p className="text-[11px] text-[#83766D]">
                        Every manual or AI command is validated and recorded with undo/redo receipts.
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* TAB 2: INSPECTOR (Canonical Command-Backed Clip, Keyframe & Audio Controls) */}
            {rightPanelTab === 'inspector' && (
              <div className="space-y-3" data-testid="right-tab-inspector">
                {selectedClip ? (
                  <>
                    <div className="p-2 rounded bg-[#141210] border border-[#26201C] flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#F3EEE8] truncate">
                          {selectedClip.name}
                        </div>
                        <div className="text-[10px] text-[#83766D]">
                          Track: {selectedClip.trackId} · Kind: {selectedClip.kind}
                          {multiSelectedClipIds.length > 1 &&
                            ` · (${multiSelectedClipIds.length} selected)`}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleDeleteClip}
                        className="p-1 rounded text-[#83766D] hover:text-[#F06464] hover:bg-[#191614]"
                        title="Delete selected clip"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Section 1: Time & Trim */}
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between text-[10px] uppercase font-bold text-[#83766D]">
                        <span>Time & Trim</span>
                        <span className="font-mono-tabular text-[#B8AAA0]">
                          {selectedClip.speedMultiplier}x
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 text-xs">
                        <div className="space-y-1">
                          <label className="text-[10px] text-[#83766D]">Start (s)</label>
                          <input
                            type="number"
                            step={0.1}
                            value={selectedClip.startTimeSec}
                            onChange={(e) => {
                              const val = Math.max(0, parseFloat(e.target.value) || 0);
                              session.dispatchCommand({
                                type: 'moveClip',
                                clipId: selectedClip.id,
                                targetTrackId: selectedClip.trackId,
                                startTimeSec: val,
                              });
                            }}
                            className="w-full bg-[#141210] border border-[#2A231E] rounded px-2 py-1 text-xs text-[#F3EEE8] font-mono-tabular"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-[#83766D]">Duration (s)</label>
                          <input
                            type="number"
                            step={0.1}
                            min={0.1}
                            value={selectedClip.durationSec}
                            onChange={(e) => {
                              const val = Math.max(0.1, parseFloat(e.target.value) || 1);
                              session.dispatchCommand({
                                type: 'trimClip',
                                clipId: selectedClip.id,
                                durationSec: val,
                                trimOutSec: selectedClip.trimInSec + val,
                              });
                            }}
                            className="w-full bg-[#141210] border border-[#2A231E] rounded px-2 py-1 text-xs text-[#F3EEE8] font-mono-tabular"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-[#83766D]">State</label>
                          <button
                            type="button"
                            onClick={() =>
                              session.dispatchCommand({
                                type: 'setClipState',
                                clipId: selectedClip.id,
                                visible: !selectedClip.visible,
                              })
                            }
                            className={`w-full py-1 rounded border text-[10px] font-semibold ${
                              !selectedClip.visible
                                ? 'bg-[#EF4444]/15 border-[#EF4444]/40 text-[#EF4444]'
                                : 'bg-[#14291F] border-[#55B98B]/40 text-[#55B98B]'
                            }`}
                          >
                            {selectedClip.visible ? 'Visible' : 'Hidden'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Section 2: Transform (Position X/Y, Scale & Rotation) */}
                    <div className="space-y-2 pt-2 border-t border-[#221D1A]">
                      <span className="text-[10px] uppercase font-bold text-[#83766D]">
                        Transform
                      </span>
                      <div className="grid grid-cols-3 gap-1.5 text-xs">
                        <div className="space-y-1">
                          <label className="text-[10px] text-[#83766D]">Pos X</label>
                          <input
                            type="number"
                            data-testid="inspector-pos-x-input"
                            value={Math.round(selectedClip.transform.position[0])}
                            onChange={(e) => {
                              const x = parseFloat(e.target.value) || 0;
                              session.dispatchCommand({
                                type: 'setTransform',
                                clipId: selectedClip.id,
                                transform: {
                                  position: [x, selectedClip.transform.position[1]],
                                },
                              });
                            }}
                            className="w-full bg-[#141210] border border-[#2A231E] rounded px-2 py-1 text-xs text-[#F3EEE8] font-mono-tabular"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-[#83766D]">Pos Y</label>
                          <input
                            type="number"
                            data-testid="inspector-pos-y-input"
                            value={Math.round(selectedClip.transform.position[1])}
                            onChange={(e) => {
                              const y = parseFloat(e.target.value) || 0;
                              session.dispatchCommand({
                                type: 'setTransform',
                                clipId: selectedClip.id,
                                transform: {
                                  position: [selectedClip.transform.position[0], y],
                                },
                              });
                            }}
                            className="w-full bg-[#141210] border border-[#2A231E] rounded px-2 py-1 text-xs text-[#F3EEE8] font-mono-tabular"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-[#83766D]">Rotate (°)</label>
                          <input
                            type="number"
                            value={Math.round(selectedClip.transform.rotationDeg)}
                            onChange={(e) => {
                              const rot = parseFloat(e.target.value) || 0;
                              session.dispatchCommand({
                                type: 'setTransform',
                                clipId: selectedClip.id,
                                transform: { rotationDeg: rot },
                              });
                            }}
                            className="w-full bg-[#141210] border border-[#2A231E] rounded px-2 py-1 text-xs text-[#F3EEE8] font-mono-tabular"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Section 3: Keyframes on Selected Clip */}
                    <div
                      className="space-y-2 pt-2 border-t border-[#221D1A]"
                      data-testid="inspector-keyframes-section"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-bold text-[#83766D]">
                          Keyframes ({selectedClip.keyframes.length})
                        </span>
                        <div className="flex items-center gap-1">
                          <select
                            value={selectedProperty}
                            onChange={(e) =>
                              session.setSelection({
                                selectedProperty: e.target.value as AnimatablePropertyKey,
                              })
                            }
                            aria-label="Keyframe Property"
                            className="bg-[#141210] border border-[#2A231E] rounded px-1.5 py-0.5 text-[10px] text-[#F3EEE8]"
                          >
                            {ANIMATABLE_PROPERTIES.map((prop) => (
                              <option key={prop.id} value={prop.id}>
                                {prop.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            data-testid="inspector-add-keyframe-btn"
                            onClick={handleToolbarKeyframe}
                            className="px-2 py-0.5 rounded bg-[#EAB308]/20 border border-[#EAB308]/50 text-[#EAB308] text-[10px] font-bold hover:bg-[#EAB308]/30"
                            title="Add or update keyframe at current playhead"
                          >
                            + Keyframe
                          </button>
                        </div>
                      </div>

                      {selectedClip.keyframes.length === 0 ? (
                        <div className="text-[11px] text-[#83766D]">
                          No keyframes on this clip yet. Move the playhead and click Keyframe.
                        </div>
                      ) : (
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {selectedClip.keyframes.map((kf) => {
                            const isKfSelected = kf.id === selectedKeyframe?.id;
                            return (
                              <div
                                key={kf.id}
                                data-testid={`inspector-keyframe-row-${kf.id}`}
                                onClick={() => {
                                  session.setSelection({
                                    selectedKeyframeId: kf.id,
                                    selectedProperty: kf.property as AnimatablePropertyKey,
                                  });
                                  session.setTransport({ playheadSec: kf.timeSec });
                                }}
                                className={`p-1.5 rounded border flex items-center justify-between gap-1.5 text-[11px] cursor-pointer ${
                                  isKfSelected
                                    ? 'bg-[#EAB308]/15 border-[#EAB308]/60 text-[#F3EEE8]'
                                    : 'bg-[#141210] border-[#221D1A] text-[#B8AAA0]'
                                }`}
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <Diamond className="w-3 h-3 text-[#EAB308] shrink-0 fill-current" />
                                  <span className="font-semibold truncate">{kf.property}</span>
                                  <span className="font-mono-tabular text-[10px] text-[#83766D]">
                                    @{kf.timeSec.toFixed(2)}s
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <input
                                    type="number"
                                    step={0.1}
                                    value={Number(kf.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      const nextVal = parseFloat(e.target.value);
                                      if (Number.isNaN(nextVal)) return;
                                      session.dispatchCommand({
                                        type: 'updateKeyframe',
                                        clipId: selectedClip.id,
                                        keyframeId: kf.id,
                                        patch: { value: nextVal },
                                      });
                                    }}
                                    className="w-14 bg-[#0B0A09] border border-[#2A231E] rounded px-1 py-0.5 text-[10px] font-mono-tabular text-[#F3EEE8]"
                                  />
                                  <button
                                    type="button"
                                    data-testid={`delete-keyframe-btn-${kf.id}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      session.dispatchCommand({
                                        type: 'removeKeyframe',
                                        clipId: selectedClip.id,
                                        keyframeId: kf.id,
                                      });
                                    }}
                                    className="p-0.5 rounded text-[#83766D] hover:text-[#F06464]"
                                    title="Delete keyframe"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Section 4: Text Layer Properties */}
                    {selectedClip.kind === 'text' && selectedClip.textData && (
                      <div className="space-y-2 pt-2 border-t border-[#221D1A]">
                        <span className="text-[10px] uppercase font-bold text-[#83766D]">
                          Typography
                        </span>
                        <div className="space-y-1">
                          <label className="text-[10px] text-[#83766D]">Text Content</label>
                          <input
                            type="text"
                            data-testid="inspector-text-content-input"
                            value={selectedClip.textData.content}
                            onChange={(e) => {
                              const val = e.target.value;
                              session.dispatchCommand({
                                type: 'setTextProperties',
                                clipId: selectedClip.id,
                                textData: { content: val },
                              });
                            }}
                            className="w-full bg-[#141210] border border-[#2A231E] rounded px-2 py-1 text-xs text-[#F3EEE8]"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="space-y-1">
                            <label className="text-[10px] text-[#83766D]">Color Hex</label>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="color"
                                value={selectedClip.textData.colorHex || '#F3EEE8'}
                                onChange={(e) => {
                                  session.dispatchCommand({
                                    type: 'setTextProperties',
                                    clipId: selectedClip.id,
                                    textData: { colorHex: e.target.value },
                                  });
                                }}
                                className="w-6 h-6 rounded cursor-pointer border border-[#342A24] bg-transparent"
                              />
                              <span className="font-mono-tabular text-[10px] text-[#B8AAA0]">
                                {selectedClip.textData.colorHex}
                              </span>
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-[#83766D]">Font Size (px)</label>
                            <input
                              type="number"
                              value={selectedClip.textData.fontSizePx || 36}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10) || 24;
                                session.dispatchCommand({
                                  type: 'setTextProperties',
                                  clipId: selectedClip.id,
                                  textData: { fontSizePx: val },
                                });
                              }}
                              className="w-full bg-[#141210] border border-[#2A231E] rounded px-2 py-1 text-xs text-[#F3EEE8]"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Section 5: Appearance (Opacity) */}
                    <div className="space-y-2 pt-2 border-t border-[#221D1A]">
                      <span className="text-[10px] uppercase font-bold text-[#83766D]">
                        Appearance
                      </span>
                      <div className="space-y-1 text-xs">
                        <label className="text-[10px] text-[#83766D]">
                          Opacity ({Math.round(selectedClip.transform.opacity * 100)}%)
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={selectedClip.transform.opacity}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            session.dispatchCommand({
                              type: 'setTransform',
                              clipId: selectedClip.id,
                              transform: { opacity: val },
                            });
                          }}
                          className="w-full accent-[#F06424]"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="p-4 text-center text-xs text-[#83766D]">
                    Click any clip on the timeline to inspect and edit its canonical properties.
                  </div>
                )}

                {/* Section 6: Audio Mixer & dB Meters */}
                <div
                  className="space-y-2 pt-2 border-t border-[#221D1A]"
                  data-testid="inspector-audio-meters"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-[#83766D]">
                      Audio Mixer (dB)
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 p-2 rounded-lg bg-[#11100F] border border-[#221D1A]">
                    {audioMeterChannels.map((ch) => (
                      <div key={ch.id} className="flex flex-col items-center gap-1">
                        <span className="font-mono-tabular text-[9px] text-[#B8AAA0]">
                          {ch.isMuted
                            ? 'MUTE'
                            : `${ch.gainDb >= 0 ? `+${ch.gainDb}` : ch.gainDb}dB`}
                        </span>
                        <div className="h-16 w-4 rounded bg-[#080707] border border-[#26201C] p-0.5 flex flex-col justify-end overflow-hidden">
                          <div
                            className="w-full rounded-sm transition-all duration-150 bg-gradient-to-t from-[#10B981] via-[#EAB308] to-[#EF4444]"
                            style={{ height: `${ch.levelPct}%` }}
                          />
                        </div>
                        <span className="text-[9px] text-[#83766D] truncate">{ch.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: EFFECTS */}
            {rightPanelTab === 'effects' && (
              <div className="space-y-3" data-testid="right-tab-effects">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-[#83766D]">
                    Clip Effects Stack
                  </span>
                  {selectedClip && (
                    <button
                      type="button"
                      data-testid="effects-add-glow-btn"
                      onClick={() => {
                        session.dispatchCommand({
                          type: 'addEffect',
                          clipId: selectedClip.id,
                          effect: {
                            effectType: 'glow',
                            name: 'Warm Glow',
                            enabled: true,
                            rendererSupport: 'supported',
                            supportedInAlightXml: true,
                            parameters: { intensity: 0.65, radiusPx: 24 },
                          },
                        });
                        onNotify?.(`Added Warm Glow effect to "${selectedClip.name}".`, 'success');
                      }}
                      className="px-2 py-0.5 rounded bg-[#F06424] text-[#080707] text-[10px] font-bold"
                    >
                      + Add Glow FX
                    </button>
                  )}
                </div>

                {selectedClip && selectedClip.effects.length > 0 ? (
                  <div className="space-y-1.5">
                    {selectedClip.effects.map((fx) => (
                      <div
                        key={fx.id}
                        className="p-2 rounded bg-[#141210] border border-[#221D1A] flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-semibold text-[#F3EEE8]">{fx.name}</div>
                          <div className="text-[10px] text-[#83766D]">{fx.effectType}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            session.dispatchCommand({
                              type: 'removeEffect',
                              clipId: selectedClip.id,
                              effectId: fx.id,
                            })
                          }
                          className="p-1 text-[#83766D] hover:text-[#F06464]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-[#83766D]">
                    Select a clip to attach canonical effects (Glow, Blur, Vignette).
                  </p>
                )}
              </div>
            )}

            {/* TAB 4: ANIMATION & EASING (Wired to EASING_CURVE_PRESETS & Selected Keyframe Segment) */}
            {rightPanelTab === 'animation' && (
              <div className="space-y-3" data-testid="right-tab-animation">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-[#83766D]">
                    Keyframe Easing & Curve Presets
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-[#14291F] border border-[#55B98B]/40 text-[#55B98B] text-[9px] font-bold">
                    {selectedKeyframe ? `Active: ${selectedKeyframe.interpolation}` : 'Ready'}
                  </span>
                </div>

                {selectedClip ? (
                  <>
                    <div className="space-y-1">
                      <label className="text-[10px] text-[#83766D]">
                        Interpolation Mode ({selectedKeyframe ? selectedKeyframe.property : selectedProperty})
                      </label>
                      <div className="grid grid-cols-3 gap-1">
                        {(
                          [
                            'linear',
                            'ease-in',
                            'ease-out',
                            'ease-in-out',
                            'cubic-bezier',
                            'hold',
                          ] as CanonicalKeyframeInterpolation[]
                        ).map((mode) => {
                          const isCurrent = selectedKeyframe?.interpolation === mode;
                          return (
                            <button
                              key={mode}
                              type="button"
                              data-testid={`interpolation-mode-btn-${mode}`}
                              onClick={() => {
                                if (selectedKeyframe) {
                                  session.dispatchCommand({
                                    type: 'updateKeyframe',
                                    clipId: selectedClip.id,
                                    keyframeId: selectedKeyframe.id,
                                    patch: { interpolation: mode },
                                  });
                                } else {
                                  session.upsertKeyframeAtPlayhead({
                                    clipId: selectedClip.id,
                                    property: selectedProperty,
                                    interpolation: mode,
                                  });
                                }
                              }}
                              className={`px-1.5 py-1 rounded text-[10px] font-mono-tabular border ${
                                isCurrent
                                  ? 'bg-[#F06424] text-[#080707] border-[#F06424] font-bold'
                                  : 'bg-[#141210] text-[#B8AAA0] border-[#221D1A] hover:text-[#F3EEE8]'
                              }`}
                            >
                              {mode}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      {EASING_CURVE_PRESETS.map((preset) => {
                        const isActivePreset =
                          selectedKeyframe?.easingPresetId === preset.id;
                        const svgPath = buildCubicBezierSvgPath(
                          preset.points,
                          64,
                          48,
                          6
                        );
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            data-testid={`easing-preset-card-${preset.id}`}
                            onClick={() => {
                              const receipt = session.applyEasingPresetToSelection(
                                preset.id,
                                ownerUid
                              );
                              if (receipt?.ok) {
                                onNotify?.(
                                  `Applied "${preset.label}" easing curve to "${selectedClip.name}".`,
                                  'success'
                                );
                              }
                            }}
                            className={`p-2 rounded border flex flex-col items-center gap-1 transition-all ${
                              isActivePreset
                                ? 'bg-[#F06424]/15 border-[#F06424] ring-1 ring-[#F06424]'
                                : 'bg-[#141210] border-[#221D1A] hover:border-[#F06424]/60'
                            }`}
                          >
                            <svg
                              viewBox="0 0 64 48"
                              className="w-14 h-10 stroke-[#F06424] fill-none stroke-[2.5]"
                            >
                              <path d={svgPath.curvePath} />
                            </svg>
                            <span className="text-[10px] font-semibold text-[#F3EEE8] text-center truncate w-full">
                              {preset.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="p-3 text-center text-xs text-[#83766D]">
                    Select a clip on the timeline to apply cubic-bezier easing presets to its keyframes.
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: ASSETS (Wired to Actual Project Asset Repository — project.assetReferences & dependencies) */}
            {rightPanelTab === 'assets' && (
              <div className="space-y-3" data-testid="right-tab-assets">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-[#83766D]">
                    Canonical Project Assets
                  </span>
                  <span
                    data-testid="project-asset-count-badge"
                    className="text-[10px] font-mono-tabular text-[#55B98B]"
                  >
                    {project.assetReferences.length} Referenced
                  </span>
                </div>

                {sessionState.isDemoMode && (
                  <div className="p-2 rounded bg-[#38BDF8]/10 border border-[#38BDF8]/30 text-[10px] text-[#38BDF8]">
                    Showing Demo Mode sample assets. In user projects, only your project’s actual asset references appear here.
                  </div>
                )}

                {project.assetReferences.length === 0 ? (
                  <div
                    data-testid="project-assets-empty-state"
                    className="p-3 rounded border border-[#221D1A] bg-[#141210] text-[11px] text-[#83766D]"
                  >
                    No external media assets referenced in this project yet. Register an asset below or insert templates from the left catalog.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {project.assetReferences.map((asset: CanonicalAssetDependency) => {
                      const isAudio = asset.mimeType.startsWith('audio/');
                      const Icon = isAudio ? Music : Film;
                      const dims = getDimensionsForAspectRatio(aspectRatio);
                      return (
                        <div
                          key={asset.assetId}
                          data-testid={`project-asset-row-${asset.assetId}`}
                          className="p-2 rounded bg-[#141210] border border-[#221D1A] space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Icon className="w-3.5 h-3.5 text-[#F06424] shrink-0" />
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-[#F3EEE8] truncate">
                                  {asset.title}
                                </div>
                                <div className="text-[10px] text-[#83766D] font-mono-tabular">
                                  {asset.role} · {asset.mimeType} · {asset.licenseType}
                                </div>
                              </div>
                            </div>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${
                                !asset.missing
                                  ? 'bg-[#14291F] text-[#55B98B]'
                                  : 'bg-[#EF4444]/20 text-[#EF4444]'
                              }`}
                            >
                              {asset.missing ? 'missing' : 'available'}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 pt-1 border-t border-[#1C1816]">
                            <button
                              type="button"
                              data-testid={`asset-add-to-timeline-btn-${asset.assetId}`}
                              onClick={() => {
                                const targetTrackId = isAudio
                                  ? 'track_sfx_1'
                                  : 'track_video_1';
                                const receipt = session.dispatchCommand({
                                  type: 'createClip',
                                  trackId: targetTrackId,
                                  clip: {
                                    name: asset.title,
                                    kind: isAudio ? 'audio' : 'video',
                                    sceneId: 'scene_1',
                                    startTimeSec: Number(currentTimeSec.toFixed(2)),
                                    durationSec: 4,
                                    sourceInSec: 0,
                                    sourceOutSec: 4,
                                    trimInSec: 0,
                                    trimOutSec: 4,
                                    speedMultiplier: 1,
                                    visible: true,
                                    locked: false,
                                    muted: false,
                                    solo: false,
                                    assetId: asset.assetId,
                                    blendMode: 'normal',
                                    transform: {
                                      position: [dims.width / 2, dims.height / 2],
                                      scale: [1, 1],
                                      rotationDeg: 0,
                                      anchor: [0.5, 0.5],
                                      opacity: 1,
                                    },
                                    keyframes: [],
                                    effects: [],
                                    masks: [],
                                  },
                                });
                                if (receipt.ok) {
                                  onNotify?.(
                                    `Added "${asset.title}" to ${targetTrackId}.`,
                                    'success'
                                  );
                                }
                              }}
                              className="px-2 py-0.5 rounded bg-[#F06424] text-[#080707] text-[10px] font-bold"
                            >
                              + Add to Timeline
                            </button>

                            {selectedClip && (
                              <button
                                type="button"
                                data-testid={`asset-replace-clip-btn-${asset.assetId}`}
                                onClick={() => {
                                  const receipt = session.dispatchCommand({
                                    type: 'replaceAsset',
                                    clipId: selectedClip.id,
                                    newAssetId: asset.assetId,
                                    assetTitle: asset.title,
                                    mimeType: asset.mimeType,
                                    licenseType: asset.licenseType,
                                  });
                                  if (receipt.ok) {
                                    onNotify?.(
                                      `Bound asset "${asset.title}" to clip "${selectedClip.name}".`,
                                      'success'
                                    );
                                  }
                                }}
                                className="px-2 py-0.5 rounded border border-[#342A24] bg-[#0B0A09] text-[#B8AAA0] hover:text-[#F3EEE8] text-[10px]"
                              >
                                Replace on Clip
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Register New Asset Reference into Canonical Project */}
                <div className="p-2.5 rounded border border-[#26201C] bg-[#121110] space-y-2">
                  <div className="text-[10px] uppercase font-bold text-[#83766D]">
                    Register Project Asset Reference
                  </div>
                  <input
                    type="text"
                    data-testid="register-asset-label-input"
                    value={newAssetLabel}
                    onChange={(e) => setNewAssetLabel(e.target.value)}
                    placeholder="Asset filename (e.g. Hero_Take_01.mp4)"
                    className="w-full bg-[#0B0A09] border border-[#2A231E] rounded px-2 py-1 text-xs text-[#F3EEE8]"
                  />
                  <div className="grid grid-cols-2 gap-1.5">
                    <select
                      value={newAssetMime}
                      onChange={(e) => setNewAssetMime(e.target.value)}
                      className="bg-[#0B0A09] border border-[#2A231E] rounded px-1.5 py-1 text-[10px] text-[#F3EEE8]"
                    >
                      <option value="video/mp4">video/mp4</option>
                      <option value="audio/wav">audio/wav</option>
                      <option value="image/png">image/png</option>
                    </select>
                    <select
                      value={newAssetRole}
                      onChange={(e) =>
                        setNewAssetRole(e.target.value as CanonicalAssetDependency['role'])
                      }
                      className="bg-[#0B0A09] border border-[#2A231E] rounded px-1.5 py-1 text-[10px] text-[#F3EEE8]"
                    >
                      <option value="primary-media">primary-media</option>
                      <option value="audio-sfx">audio-sfx</option>
                      <option value="vector-graphic">vector-graphic</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    data-testid="register-asset-submit-btn"
                    onClick={() => {
                      const trimmed = newAssetLabel.trim();
                      if (!trimmed) return;
                      const assetId = `asset_${Date.now()}`;
                      const targetClip =
                        selectedClip ||
                        sceneTracks.flatMap((t) => t.clips)[0] ||
                        null;
                      if (targetClip) {
                        session.dispatchCommand({
                          type: 'replaceAsset',
                          clipId: targetClip.id,
                          newAssetId: assetId,
                          assetTitle: trimmed,
                          mimeType: newAssetMime,
                          licenseType: 'User Owned',
                        });
                        setNewAssetLabel('');
                        onNotify?.(
                          `Registered asset "${trimmed}" and linked to "${targetClip.name}".`,
                          'success'
                        );
                      }
                    }}
                    className="w-full py-1 rounded bg-[#1D1916] hover:bg-[#26201C] border border-[#342A24] text-xs font-semibold text-[#F3EEE8]"
                  >
                    + Register & Bind Asset
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>

        {!studioLayout.effectiveRightOpen && studioLayout.mode !== 'phone-portrait' && (
          <button
            type="button"
            onClick={() => openRightDrawerTab()}
            className="absolute right-1 top-2 z-20 p-1.5 rounded-l bg-[#191614] border border-r-0 border-[#342A24] text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#26201C]"
            title="Open Inspector panel"
          >
            <PanelRightOpen className="w-4 h-4 text-[#F06424]" />
          </button>
        )}
      </div>

      {/* =========================================================================
          4. BOTTOM MULTITRACK TIMELINE (CANONICAL LANES, KEYFRAMES, MARKERS & POINTER GESTURES)
          ========================================================================= */}
      <footer
        data-testid="studio-timeline-footer"
        data-timeline-preset={timelinePreset}
        style={{ height: `${studioLayout.timelineHeightPx}px` }}
        onPointerMove={handlePointerMoveTimeline}
        onPointerUp={handlePointerUpTimeline}
        onPointerCancel={() => setActiveGesture(null)}
        className="shrink-0 border-t border-[#26201C] bg-[#0A0908] flex flex-col transition-all duration-200 z-20"
      >
        <div className="h-8 shrink-0 px-2.5 sm:px-3 flex items-center justify-between border-b border-[#221D1A] bg-[#0D0C0B] text-xs">
          <div className="flex items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              data-testid="timeline-split-btn"
              onClick={handleSplitClipAtPlayhead}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#191614] hover:bg-[#26201C] border border-[#2E2722] text-[#F3EEE8] text-[11px] font-medium"
              title="Split selected clip at playhead position (S)"
            >
              <Scissors className="w-3 h-3 text-[#F06424]" />
              <span className="hidden sm:inline">Split</span>
            </button>

            <button
              type="button"
              data-testid="timeline-duplicate-btn"
              onClick={handleDuplicateClip}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#191614] hover:bg-[#26201C] border border-[#2E2722] text-[#F3EEE8] text-[11px] font-medium"
              title="Duplicate selected clip (D)"
            >
              <Copy className="w-3 h-3 text-[#38BDF8]" />
              <span className="hidden sm:inline">Duplicate</span>
            </button>

            <button
              type="button"
              data-testid="timeline-delete-btn"
              onClick={handleDeleteClip}
              disabled={!selectedClip && multiSelectedClipIds.length === 0}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#191614] hover:bg-[#26201C] border border-[#2E2722] text-[#F06464] disabled:opacity-30 text-[11px] font-medium"
              title="Delete selected clip (Del)"
            >
              <Trash2 className="w-3 h-3" />
              <span className="hidden sm:inline">Delete</span>
            </button>

            <button
              type="button"
              data-testid="timeline-keyframe-btn"
              onClick={handleToolbarKeyframe}
              disabled={!selectedClip}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#191614] hover:bg-[#26201C] border border-[#EAB308]/40 text-[#EAB308] disabled:opacity-35 text-[11px] font-medium"
              title={`Add or update ${selectedProperty} keyframe at playhead`}
            >
              <KeyRound className="w-3 h-3 text-[#EAB308]" />
              <span className="hidden sm:inline">Keyframe</span>
            </button>

            <button
              type="button"
              data-testid="timeline-add-marker-btn"
              onClick={handleAddMarkerAtPlayhead}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#191614] hover:bg-[#26201C] border border-[#2E2722] text-[#B8AAA0] hover:text-[#F3EEE8] text-[11px] font-medium"
              title="Add timeline cue marker at playhead"
            >
              <Flag className="w-3 h-3 text-[#F06424]" />
              <span className="hidden md:inline">Marker</span>
            </button>

            <button
              type="button"
              data-testid="timeline-snap-toggle-btn"
              onClick={() => session.setTransport({ snapEnabled: !snapEnabled })}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${
                snapEnabled
                  ? 'bg-[#F06424]/15 border-[#F06424]/50 text-[#F06424]'
                  : 'bg-[#141210] border-[#221D1A] text-[#83766D]'
              }`}
              title="Toggle magnetic timeline snapping"
            >
              <Magnet className="w-3 h-3" />
              <span className="hidden lg:inline">Snap</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <ZoomOut className="w-3 h-3 text-[#83766D] hidden xs:inline" />
            <input
              type="range"
              min={28}
              max={160}
              value={timelineZoomPxPerSec}
              onChange={(e) =>
                session.setTransport({ timelineZoomPxPerSec: parseInt(e.target.value, 10) })
              }
              aria-label="Timeline Horizontal Zoom"
              className="w-16 sm:w-24 accent-[#F06424] h-1 bg-[#26201C] rounded cursor-pointer"
              title="Zoom Timeline (pixels per second)"
            />
            <ZoomIn className="w-3 h-3 text-[#83766D] hidden xs:inline" />

            <button
              type="button"
              onClick={handleCycleTimelinePreset}
              className="px-1.5 py-0.5 rounded border border-[#26201C] bg-[#141210] text-[10px] font-mono-tabular text-[#B8AAA0] hover:text-[#F3EEE8] flex items-center gap-1"
              title="Cycle timeline height (Expanded / Compact / Collapsed)"
            >
              <span className="capitalize hidden sm:inline">{timelinePreset}</span>
              {timelinePreset === 'collapsed' ? (
                <ChevronRight className="w-3 h-3 -rotate-90" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>

        {timelinePreset !== 'collapsed' && (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="w-36 sm:w-48 shrink-0 border-r border-[#221D1A] bg-[#0E0D0C] overflow-y-auto no-scrollbar flex flex-col">
              <div className="h-5 shrink-0 border-b border-[#221D1A] bg-[#0A0908] px-2 flex items-center justify-between text-[9px] text-[#83766D] font-mono-tabular">
                <span>TRACKS ({sceneTracks.length})</span>
                <span>M / V / L / ↕</span>
              </div>

              {sceneTracks.map((track, idx) => {
                const cfg =
                  CANONICAL_TRACK_CONFIGS.find((c) => c.id === track.id) ||
                  CANONICAL_TRACK_CONFIGS[idx % CANONICAL_TRACK_CONFIGS.length];
                const isSelected = track.id === selectedTrackId;

                return (
                  <div
                    key={track.id}
                    onClick={() => session.setSelection({ selectedTrackId: track.id })}
                    className={`h-6 shrink-0 px-2 flex items-center justify-between border-b border-[#1A1715] cursor-pointer transition-colors ${
                      isSelected ? 'bg-[#1C1816]' : 'hover:bg-[#141210]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: cfg.accentHex }}
                      />
                      <span className="text-[10px] font-semibold text-[#F3EEE8] truncate">
                        {track.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0 text-[#83766D]">
                      <button
                        type="button"
                        data-testid={`track-mute-btn-${track.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          session.dispatchCommand({
                            type: 'setTrackState',
                            trackId: track.id,
                            muted: !track.muted,
                          });
                        }}
                        className={`p-0.5 rounded hover:text-[#F3EEE8] ${
                          track.muted ? 'text-[#F06464]' : ''
                        }`}
                        title={track.muted ? 'Unmute track' : 'Mute track'}
                      >
                        {track.muted ? (
                          <VolumeX className="w-2.5 h-2.5" />
                        ) : (
                          <Volume2 className="w-2.5 h-2.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        data-testid={`track-visible-btn-${track.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          session.dispatchCommand({
                            type: 'setTrackState',
                            trackId: track.id,
                            visible: !track.visible,
                          });
                        }}
                        className={`p-0.5 rounded hover:text-[#F3EEE8] ${
                          !track.visible ? 'text-[#F06464]' : ''
                        }`}
                        title={track.visible ? 'Hide track' : 'Show track'}
                      >
                        {track.visible ? (
                          <Eye className="w-2.5 h-2.5" />
                        ) : (
                          <EyeOff className="w-2.5 h-2.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        data-testid={`track-lock-btn-${track.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          session.dispatchCommand({
                            type: 'setTrackState',
                            trackId: track.id,
                            locked: !track.locked,
                          });
                        }}
                        className={`p-0.5 rounded hover:text-[#F3EEE8] ${
                          track.locked ? 'text-[#EAB308]' : ''
                        }`}
                        title={track.locked ? 'Unlock track' : 'Lock track'}
                      >
                        {track.locked ? (
                          <Lock className="w-2.5 h-2.5" />
                        ) : (
                          <Unlock className="w-2.5 h-2.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        data-testid={`track-move-up-${track.id}`}
                        disabled={idx === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReorderTrack(track, -1);
                        }}
                        className="p-0.5 rounded hover:text-[#F3EEE8] disabled:opacity-25"
                        title="Move track up"
                      >
                        <ArrowUp className="w-2.5 h-2.5" />
                      </button>

                      <button
                        type="button"
                        data-testid={`track-move-down-${track.id}`}
                        disabled={idx === sceneTracks.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReorderTrack(track, 1);
                        }}
                        className="p-0.5 rounded hover:text-[#F3EEE8] disabled:opacity-25"
                        title="Move track down"
                      >
                        <ArrowDown className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex-1 overflow-x-auto overflow-y-auto relative bg-[#080707]">
              <div
                className="relative"
                style={{
                  width: `${Math.max(
                    760,
                    sceneDurationSec * timelineZoomPxPerSec + 200
                  )}px`,
                }}
              >
                <div className="h-5 border-b border-[#221D1A] bg-[#0C0B0A] sticky top-0 z-20 flex items-center select-none font-mono-tabular text-[9px] text-[#83766D]">
                  {Array.from({ length: Math.ceil(sceneDurationSec + 2) }).map((_, sec) => (
                    <div
                      key={sec}
                      className="absolute border-l border-[#26201C] pl-1 h-full flex items-center"
                      style={{ left: `${sec * timelineZoomPxPerSec}px` }}
                    >
                      {sec}s
                    </div>
                  ))}

                  {project.markers.map((m) => (
                    <div
                      key={m.id}
                      data-testid={`timeline-marker-${m.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        session.setTransport({ playheadSec: m.timeSec });
                      }}
                      style={{ left: `${m.timeSec * timelineZoomPxPerSec}px` }}
                      className="absolute top-0 bottom-0 z-30 flex items-center gap-0.5 px-1 bg-[#F06424]/25 border-l-2 border-[#F06424] text-[#F3EEE8] text-[9px] cursor-pointer"
                      title={`${m.label} (${m.timeSec.toFixed(2)}s)`}
                    >
                      <span>{m.label}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          session.dispatchCommand({
                            type: 'removeMarker',
                            markerId: m.id,
                          });
                        }}
                        className="hover:text-[#EF4444]"
                        title="Remove marker"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <div
                  className="absolute top-0 bottom-0 z-30 pointer-events-none flex flex-col items-center"
                  style={{ left: `${currentTimeSec * timelineZoomPxPerSec}px` }}
                >
                  <div className="w-2.5 h-2.5 bg-[#F06424] rotate-45 -mt-1 shadow" />
                  <div className="w-0.5 flex-1 bg-[#F06424] shadow-[0_0_8px_rgba(240,100,36,0.85)]" />
                </div>

                {sceneTracks.map((track, idx) => {
                  const cfg =
                    CANONICAL_TRACK_CONFIGS.find((c) => c.id === track.id) ||
                    CANONICAL_TRACK_CONFIGS[idx % CANONICAL_TRACK_CONFIGS.length];
                  const isAudioTrack = track.kind === 'audio';

                  return (
                    <div
                      key={track.id}
                      className="h-6 border-b border-[#161311] relative flex items-center"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const clickX = e.clientX - rect.left;
                        const newSec = Math.max(0, clickX / timelineZoomPxPerSec);
                        session.setTransport({ playheadSec: newSec });
                      }}
                    >
                      {track.clips.map((clip) => {
                        const isSelected =
                          clip.id === selectedClipId ||
                          multiSelectedClipIds.includes(clip.id);
                        const isBeingDragged =
                          activeGesture && activeGesture.clipId === clip.id;
                        const effectiveStart = isBeingDragged
                          ? activeGesture.liveStartTimeSec
                          : clip.startTimeSec;
                        const effectiveDuration = isBeingDragged
                          ? activeGesture.liveDurationSec
                          : clip.durationSec;

                        const leftPx = effectiveStart * timelineZoomPxPerSec;
                        const widthPx = Math.max(
                          24,
                          effectiveDuration * timelineZoomPxPerSec
                        );

                        return (
                          <div
                            key={clip.id}
                            data-testid={`timeline-clip-${clip.id}`}
                            onPointerDown={(e) =>
                              handleStartClipGesture(e, clip, track, 'move')
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              if (e.shiftKey) {
                                session.toggleClipInMultiSelection(clip.id);
                              } else {
                                session.setSelection({
                                  selectedClipId: clip.id,
                                  selectedTrackId: track.id,
                                });
                              }
                            }}
                            className={`absolute h-5 rounded px-2 flex items-center justify-between text-[10px] font-semibold cursor-grab active:cursor-grabbing overflow-hidden border transition-colors ${
                              cfg.color
                            } ${
                              isSelected
                                ? 'border-[#F06424] ring-1 ring-[#F06424] text-[#F3EEE8] shadow-md z-10'
                                : `${cfg.borderColor} text-[#F3EEE8]/95 hover:brightness-110`
                            }`}
                            style={{
                              left: `${leftPx}px`,
                              width: `${widthPx}px`,
                            }}
                            title={`${clip.name} (${effectiveStart.toFixed(2)}s - ${(
                              effectiveStart + effectiveDuration
                            ).toFixed(2)}s)`}
                          >
                            <div
                              data-testid={`clip-trim-head-${clip.id}`}
                              onPointerDown={(e) =>
                                handleStartClipGesture(e, clip, track, 'trim-head')
                              }
                              className="absolute left-0 top-0 bottom-0 w-1.5 bg-white/25 hover:bg-[#F06424] cursor-ew-resize z-20"
                              title="Drag to trim clip head (In point)"
                            />

                            <div
                              data-testid={`clip-trim-tail-${clip.id}`}
                              onPointerDown={(e) =>
                                handleStartClipGesture(e, clip, track, 'trim-tail')
                              }
                              className="absolute right-0 top-0 bottom-0 w-1.5 bg-white/25 hover:bg-[#F06424] cursor-ew-resize z-20"
                              title="Drag to trim clip tail (Out point)"
                            />

                            {isAudioTrack && (
                              <div className="absolute inset-x-1 bottom-0.5 h-2 flex items-end gap-0.5 opacity-30 pointer-events-none overflow-hidden">
                                {Array.from({ length: 18 }).map((_, barIdx) => (
                                  <span
                                    key={barIdx}
                                    className="w-1 bg-[#6EE7B7] rounded-t"
                                    style={{ height: `${30 + ((barIdx * 37) % 70)}%` }}
                                  />
                                ))}
                              </div>
                            )}

                            {clip.keyframes.map((kf) => {
                              const offsetSec = Math.max(
                                0,
                                Math.min(
                                  effectiveDuration,
                                  kf.timeSec - effectiveStart
                                )
                              );
                              const kfLeftPx = offsetSec * timelineZoomPxPerSec;
                              const isKfSelected = kf.id === selectedKeyframeId;
                              return (
                                <button
                                  key={kf.id}
                                  type="button"
                                  data-testid="clip-keyframe-diamond"
                                  data-keyframe-id={kf.id}
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    session.setSelection({
                                      selectedClipId: clip.id,
                                      selectedTrackId: track.id,
                                      selectedKeyframeId: kf.id,
                                      selectedProperty: kf.property as AnimatablePropertyKey,
                                    });
                                    session.setTransport({ playheadSec: kf.timeSec });
                                  }}
                                  style={{ left: `${Math.max(4, kfLeftPx)}px` }}
                                  className={`absolute top-1 z-30 w-2.5 h-2.5 rotate-45 border ${
                                    isKfSelected
                                      ? 'bg-[#F06424] border-white scale-125'
                                      : 'bg-[#EAB308] border-[#080707]'
                                  }`}
                                  title={`Keyframe: ${kf.property} = ${kf.value} @ ${kf.timeSec.toFixed(
                                    2
                                  )}s (${kf.interpolation})`}
                                />
                              );
                            })}

                            <span className="truncate min-w-0 relative z-10">{clip.name}</span>
                            <span className="text-[9px] opacity-80 font-mono-tabular shrink-0 pl-1 relative z-10">
                              {effectiveDuration.toFixed(1)}s
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </footer>

      {/* =========================================================================
          5. PHONE PORTRAIT ACCESSIBLE BOTTOM NAVIGATION BAR
          ========================================================================= */}
      {studioLayout.mode === 'phone-portrait' && (
        <nav
          aria-label="Portrait Studio Mode Switcher"
          data-testid="portrait-bottom-nav"
          className="h-11 shrink-0 border-t border-[#26201C] bg-[#0B0A09] px-2 flex items-center justify-around z-40"
        >
          {(
            [
              {
                id: 'stage' as const,
                label: 'Stage',
                icon: Monitor,
                onSelect: () => {
                  setIsSidebarOpen(false);
                  setIsRightPanelOpen(false);
                },
              },
              {
                id: 'marketplace' as const,
                label: 'Catalog',
                icon: LayoutGrid,
                onSelect: () => openLeftDrawer(),
              },
              {
                id: 'inspector' as const,
                label: 'Inspector',
                icon: Sliders,
                onSelect: () => openRightDrawerTab('inspector'),
              },
              {
                id: 'director' as const,
                label: 'AI Director',
                icon: Sparkles,
                onSelect: () => openRightDrawerTab('director'),
              },
              {
                id: 'assets' as const,
                label: 'Assets & FX',
                icon: Layers,
                onSelect: () => openRightDrawerTab('assets'),
              },
            ]
          ).map((item) => {
            const Icon = item.icon;
            const isActive = activePortraitNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={item.onSelect}
                className={`flex flex-col items-center justify-center min-w-[56px] min-h-[38px] px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                  isActive
                    ? 'text-[#F06424] bg-[#F06424]/10'
                    : 'text-[#B8AAA0] hover:text-[#F3EEE8]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
};
