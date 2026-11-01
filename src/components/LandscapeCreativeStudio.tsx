import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CanonicalClip,
  CanonicalClipKind,
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
import {
  createMinimalCanonicalProject,
} from '../services/canonicalProjectEngine';
import { getDimensionsForAspectRatio } from '../services/editorGateway';
import { renderCanonicalFrameSvg } from '../services/renderExportQaEngine';
import { sanitizeSvgContent } from '../features/editor-gateway/strategies';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  Film,
  FolderKanban,
  Heart,
  HelpCircle,
  KeyRound,
  Layers,
  Layout,
  LayoutGrid,
  List,
  Lock,
  Maximize2,
  Minimize2,
  Minus,
  MoreHorizontal,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  Redo2,
  Repeat,
  RotateCcw,
  Save,
  Scissors,
  Search,
  Settings,
  Share2,
  SkipBack,
  SkipForward,
  Sliders,
  SlidersHorizontal,
  Sparkles,
  Spline,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Volume2,
  VolumeX,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export interface LandscapeCreativeStudioProps {
  initialProject?: CanonicalProjectDocument | null;
  projects?: ProjectLibraryItem[];
  ownerUid?: string;
  onSaveProject?: (proj: ProjectLibraryItem) => Promise<void> | void;
  onNotify?: (message: string, tone?: 'info' | 'warning' | 'error' | 'success') => void;
}

export type RightPanelTab = 'director' | 'inspector' | 'effects' | 'animation' | 'assets';

// 7 Canonical Timeline Tracks with their visual identities
const CANONICAL_TRACK_CONFIGS: Array<{
  id: string;
  name: string;
  kind: CanonicalTrackKind;
  color: string;
  borderColor: string;
  badge: string;
  icon: React.FC<{ className?: string }>;
}> = [
  {
    id: 'track_video_1',
    name: 'Video (V1)',
    kind: 'video',
    color: 'bg-[#1E293B]',
    borderColor: 'border-[#38BDF8]',
    badge: 'V1',
    icon: Film,
  },
  {
    id: 'track_text_1',
    name: 'Text & Titles (T1)',
    kind: 'text',
    color: 'bg-[#311B92]',
    borderColor: 'border-[#A855F7]',
    badge: 'T1',
    icon: Type,
  },
  {
    id: 'track_motion_1',
    name: 'Motion Graphics (M1)',
    kind: 'template',
    color: 'bg-[#431407]',
    borderColor: 'border-[#F97316]',
    badge: 'M1',
    icon: Layers,
  },
  {
    id: 'track_overlay_1',
    name: 'Overlays & FX (O1)',
    kind: 'effect',
    color: 'bg-[#064E3B]',
    borderColor: 'border-[#10B981]',
    badge: 'O1',
    icon: Sparkles,
  },
  {
    id: 'track_voice_1',
    name: 'Voice / Narration (A1)',
    kind: 'audio',
    color: 'bg-[#831843]',
    borderColor: 'border-[#EC4899]',
    badge: 'A1',
    icon: Volume2,
  },
  {
    id: 'track_music_1',
    name: 'Music / BGM (A2)',
    kind: 'audio',
    color: 'bg-[#14532D]',
    borderColor: 'border-[#22C55E]',
    badge: 'A2',
    icon: Music,
  },
  {
    id: 'track_sfx_1',
    name: 'SFX / Foley (A3)',
    kind: 'audio',
    color: 'bg-[#713F12]',
    borderColor: 'border-[#EAB308]',
    badge: 'A3',
    icon: Volume2,
  },
];

// Starter project factory creating all 7 canonical tracks
function createSevenTrackStarterProject(
  title = 'Sowveil Motion Promo',
  aspectRatio: MobileAspectRatio = '9:16'
): CanonicalProjectDocument {
  const base = createMinimalCanonicalProject({
    title,
    aspectRatio,
    durationSec: 8,
  });

  const dims = getDimensionsForAspectRatio(aspectRatio);

  const tracks: CanonicalTrack[] = [
    {
      id: 'track_video_1',
      name: 'Video (V1)',
      kind: 'video',
      order: 0,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: 0,
      clips: [
        {
          id: 'clip_bg_footage',
          trackId: 'track_video_1',
          name: 'Cyberpunk Grid Gradient',
          kind: 'video',
          sceneId: 'scene_1',
          startTimeSec: 0,
          durationSec: 8,
          sourceInSec: 0,
          sourceOutSec: 8,
          trimInSec: 0,
          trimOutSec: 0,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
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
      ],
    },
    {
      id: 'track_text_1',
      name: 'Text & Titles (T1)',
      kind: 'text',
      order: 1,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: 0,
      clips: [
        {
          id: 'clip_title_main',
          trackId: 'track_text_1',
          name: 'LAUNCH ON ANDROID',
          kind: 'text',
          sceneId: 'scene_1',
          startTimeSec: 0.5,
          durationSec: 3.5,
          sourceInSec: 0,
          sourceOutSec: 3.5,
          trimInSec: 0,
          trimOutSec: 0,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          transform: {
            position: [dims.width / 2, dims.height * 0.45],
            scale: [1, 1],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 1,
          },
          textData: {
            content: 'LAUNCH ON ANDROID',
            fontFamily: 'Plus Jakarta Sans',
            fontSizePx: 48,
            fontWeight: 700,
            colorHex: '#F3EEE8',
            alignment: 'center',
            letterSpacingEm: 0.05,
            lineHeightMultiplier: 1.2,
          },
          keyframes: [],
          effects: [],
          masks: [],
        },
        {
          id: 'clip_subtitle',
          trackId: 'track_text_1',
          name: 'Mobile Creative Studio',
          kind: 'text',
          sceneId: 'scene_1',
          startTimeSec: 4.2,
          durationSec: 3.5,
          sourceInSec: 0,
          sourceOutSec: 3.5,
          trimInSec: 0,
          trimOutSec: 0,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          transform: {
            position: [dims.width / 2, dims.height * 0.5],
            scale: [1, 1],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 1,
          },
          textData: {
            content: 'Mobile Creative Studio',
            fontFamily: 'Plus Jakarta Sans',
            fontSizePx: 36,
            fontWeight: 600,
            colorHex: '#55B98B',
            alignment: 'center',
            letterSpacingEm: 0.02,
            lineHeightMultiplier: 1.2,
          },
          keyframes: [],
          effects: [],
          masks: [],
        },
      ],
    },
    {
      id: 'track_motion_1',
      name: 'Motion Graphics (M1)',
      kind: 'template',
      order: 2,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: 0,
      clips: [
        {
          id: 'clip_badge_card',
          trackId: 'track_motion_1',
          name: 'Card 01 Glass Badge',
          kind: 'template-instance',
          sceneId: 'scene_1',
          startTimeSec: 1,
          durationSec: 3,
          sourceInSec: 0,
          sourceOutSec: 3,
          trimInSec: 0,
          trimOutSec: 0,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          transform: {
            position: [dims.width / 2, dims.height * 0.72],
            scale: [0.85, 0.85],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 1,
          },
          keyframes: [],
          effects: [],
          masks: [],
        },
      ],
    },
    {
      id: 'track_overlay_1',
      name: 'Overlays & FX (O1)',
      kind: 'effect',
      order: 3,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'screen',
      gainDb: 0,
      clips: [
        {
          id: 'clip_light_leak',
          trackId: 'track_overlay_1',
          name: 'Warm Light Leak & Dust',
          kind: 'adjustment-effect',
          sceneId: 'scene_1',
          startTimeSec: 0,
          durationSec: 8,
          sourceInSec: 0,
          sourceOutSec: 8,
          trimInSec: 0,
          trimOutSec: 0,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'screen',
          transform: {
            position: [dims.width / 2, dims.height / 2],
            scale: [1, 1],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 0.65,
          },
          keyframes: [],
          effects: [],
          masks: [],
        },
      ],
    },
    {
      id: 'track_voice_1',
      name: 'Voice / Narration (A1)',
      kind: 'audio',
      order: 4,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: 0,
      clips: [
        {
          id: 'clip_vo_take_1',
          trackId: 'track_voice_1',
          name: 'AI Voiceover: "Ready to launch..."',
          kind: 'audio',
          sceneId: 'scene_1',
          startTimeSec: 0.2,
          durationSec: 4.8,
          sourceInSec: 0,
          sourceOutSec: 4.8,
          trimInSec: 0,
          trimOutSec: 0,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          transform: {
            position: [0, 0],
            scale: [1, 1],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 1,
          },
          keyframes: [],
          effects: [],
          masks: [],
        },
      ],
    },
    {
      id: 'track_music_1',
      name: 'Music / BGM (A2)',
      kind: 'audio',
      order: 5,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: -6,
      clips: [
        {
          id: 'clip_bgm_track',
          trackId: 'track_music_1',
          name: 'Neon Horizon (Lo-Fi Wave)',
          kind: 'audio',
          sceneId: 'scene_1',
          startTimeSec: 0,
          durationSec: 8,
          sourceInSec: 0,
          sourceOutSec: 8,
          trimInSec: 0,
          trimOutSec: 0,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          transform: {
            position: [0, 0],
            scale: [1, 1],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 1,
          },
          keyframes: [],
          effects: [],
          masks: [],
        },
      ],
    },
    {
      id: 'track_sfx_1',
      name: 'SFX / Foley (A3)',
      kind: 'audio',
      order: 6,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: 0,
      clips: [
        {
          id: 'clip_sfx_whoosh',
          trackId: 'track_sfx_1',
          name: 'Whoosh Hit 01',
          kind: 'audio',
          sceneId: 'scene_1',
          startTimeSec: 0.45,
          durationSec: 1.2,
          sourceInSec: 0,
          sourceOutSec: 1.2,
          trimInSec: 0,
          trimOutSec: 0,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          transform: {
            position: [0, 0],
            scale: [1, 1],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 1,
          },
          keyframes: [],
          effects: [],
          masks: [],
        },
        {
          id: 'clip_sfx_click',
          trackId: 'track_sfx_1',
          name: 'UI Snap Click',
          kind: 'audio',
          sceneId: 'scene_1',
          startTimeSec: 4.15,
          durationSec: 0.6,
          sourceInSec: 0,
          sourceOutSec: 0.6,
          trimInSec: 0,
          trimOutSec: 0,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          transform: {
            position: [0, 0],
            scale: [1, 1],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 1,
          },
          keyframes: [],
          effects: [],
          masks: [],
        },
      ],
    },
  ];

  return {
    ...base,
    title,
    canvas: {
      ...base.canvas,
      aspectRatio,
      durationSec: 8,
    },
    tracks,
  };
}

// Global Workspace Switcher Destinations
const GLOBAL_WORKSPACES: Array<{
  id: string;
  label: string;
  path: string;
  badge?: string;
  icon: React.FC<{ className?: string }>;
}> = [
  { id: 'landscape-studio', label: 'Landscape Studio', path: '/app/landscape-studio', badge: 'Active', icon: Layout },
  { id: 'marketplace', label: 'Marketplace (20 Modules)', path: '/app/text-animation', icon: LayoutGrid },
  { id: 'editor', label: 'Editing Studio (Timeline)', path: '/app/editor', icon: SlidersHorizontal },
  { id: 'ai-director', label: 'AI Director', path: '/app/ai-director', badge: 'AI', icon: Sparkles },
  { id: 'reference-lab', label: 'Reference Lab', path: '/app/reference-lab', icon: Film },
  { id: 'template-factory', label: 'Template Factory', path: '/app/template-factory', icon: Layers },
  { id: 'provider-hub', label: 'Provider Hub', path: '/app/provider-hub', icon: Sliders },
  { id: 'render-export', label: 'Render & QA', path: '/app/render-export', icon: Download },
  { id: 'project-library', label: 'Project Library', path: '/app/project-library', icon: FolderKanban },
  { id: 'admin', label: 'Admin Console', path: '/admin', icon: Lock },
];

export const LandscapeCreativeStudio: React.FC<LandscapeCreativeStudioProps> = ({
  initialProject,
  projects = [],
  ownerUid = 'user-local',
  onSaveProject,
  onNotify,
}) => {
  const navigate = useNavigate();

  // Project state
  const [project, setProject] = useState<CanonicalProjectDocument>(() => {
    return initialProject || createSevenTrackStarterProject('Sowveil Mobile Campaign', '9:16');
  });

  const [projectTitle, setProjectTitle] = useState<string>(project.title);
  const [aspectRatio, setAspectRatio] = useState<MobileAspectRatio>(project.canvas.aspectRatio || '9:16');
  const [resolutionFps, setResolutionFps] = useState<'1080p · 30fps' | '720p · 30fps' | '540p Proxy'>('1080p · 30fps');

  // Playback & Scrubber State
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0.8);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLooping, setIsLooping] = useState<boolean>(true);
  const [previewScale, setPreviewScale] = useState<'fit' | '50%' | '75%' | '100%'>('fit');
  const [showSafeGuides, setShowSafeGuides] = useState<boolean>(true);

  // Selection & Inspector State
  const [selectedClipId, setSelectedClipId] = useState<string>('clip_title_main');
  const [selectedTrackId, setSelectedTrackId] = useState<string>('track_text_1');

  // Active module in the 20-module horizontal strip
  const [activeModuleId, setActiveModuleId] = useState<ModuleId>('text-animation');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // Layout Panel Collapse States (responsive defaults)
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(true);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('director');
  const [timelineZoomPxPerSec, setTimelineZoomPxPerSec] = useState<number>(50); // 20px to 120px
  const [isTimelineExpanded, setIsTimelineExpanded] = useState<boolean>(true);

  // AI Prompt bar in Director tab
  const [aiPromptInput, setAiPromptInput] = useState<string>('');
  const [isApplyingAi, setIsApplyingAi] = useState<boolean>(false);

  // Global Workspace Switcher Open
  const [isSwitcherOpen, setIsSwitcherOpen] = useState<boolean>(false);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Undo / Redo history stacks
  const [undoStack, setUndoStack] = useState<CanonicalProjectDocument[]>([]);
  const [redoStack, setRedoStack] = useState<CanonicalProjectDocument[]>([]);

  // Update canvas dimensions when aspect ratio changes
  const handleAspectRatioChange = useCallback(
    (newRatio: MobileAspectRatio) => {
      setAspectRatio(newRatio);
      const dims = getDimensionsForAspectRatio(newRatio);
      setProject((prev) => ({
        ...prev,
        canvas: {
          ...prev.canvas,
          aspectRatio: newRatio,
          width: dims.width,
          height: dims.height,
        },
      }));
      onNotify?.(`Switched canvas aspect ratio to ${newRatio} (${dims.width}×${dims.height})`, 'info');
    },
    [onNotify]
  );

  // Playback timer loop
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const loop = (now: number) => {
      const deltaSec = (now - lastTime) / 1000;
      lastTime = now;

      if (isPlaying) {
        setCurrentTimeSec((prev) => {
          const next = prev + deltaSec;
          const maxDur = project.canvas.durationSec || 8;
          if (next >= maxDur) {
            if (isLooping) return 0;
            setIsPlaying(false);
            return maxDur;
          }
          return next;
        });
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, isLooping, project.canvas.durationSec]);

  // Selected Clip Lookup
  const selectedClip = useMemo<CanonicalClip | null>(() => {
    for (const track of project.tracks) {
      const c = track.clips.find((item) => item.id === selectedClipId);
      if (c) return c;
    }
    return null;
  }, [project.tracks, selectedClipId]);

  // Selected Track Lookup
  const selectedTrack = useMemo<CanonicalTrack | null>(() => {
    return project.tracks.find((t) => t.id === selectedTrackId) || project.tracks[0] || null;
  }, [project.tracks, selectedTrackId]);

  // Push current state to undo stack before mutation
  const pushUndo = useCallback(() => {
    setUndoStack((prev) => [...prev.slice(-20), project]);
    setRedoStack([]);
  }, [project]);

  // Undo operation
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, project]);
    setProject(prev);
    onNotify?.('Undo: Restored previous timeline state', 'info');
  }, [undoStack, project, onNotify]);

  // Redo operation
  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, project]);
    setProject(next);
    onNotify?.('Redo: Re-applied timeline state', 'info');
  }, [redoStack, project, onNotify]);

  // Save Project
  const handleSave = useCallback(async () => {
    const updated: ProjectLibraryItem = {
      id: project.id,
      title: projectTitle,
      description: project.description,
      ownerUid,
      compCount: 1,
      projectFileStatus: 'sowveil-native',
      fileSizeBytes: 1024,
      fileSizeLabel: '1 KB',
      hasExternalFootageWarning: false,
      aspectRatio: project.canvas.aspectRatio,
      targetEditor: project.targetEditor,
      tags: project.tags || [],
      createdAt: project.createdAt,
      updatedAt: new Date().toISOString(),
      revision: (project.revision || 1) + 1,
    };

    if (onSaveProject) {
      await onSaveProject(updated);
      onNotify?.(`Saved "${projectTitle}" (rev ${updated.revision}) to Project Library.`, 'success');
    } else {
      onNotify?.(`Project "${projectTitle}" saved locally.`, 'success');
    }
  }, [project, projectTitle, ownerUid, onSaveProject, onNotify]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, []);

  // Split clip at playhead
  const handleSplitClipAtPlayhead = useCallback(() => {
    if (!selectedClip) {
      onNotify?.('Select a clip to split at the playhead position.', 'warning');
      return;
    }
    if (
      currentTimeSec <= selectedClip.startTimeSec ||
      currentTimeSec >= selectedClip.startTimeSec + selectedClip.durationSec
    ) {
      onNotify?.('Playhead must be inside the selected clip to split.', 'warning');
      return;
    }

    pushUndo();

    const splitOffset = currentTimeSec - selectedClip.startTimeSec;
    const originalDur = selectedClip.durationSec;

    const clipPart1: CanonicalClip = {
      ...selectedClip,
      durationSec: splitOffset,
      sourceOutSec: selectedClip.sourceInSec + splitOffset,
    };

    const clipPart2: CanonicalClip = {
      ...selectedClip,
      id: `${selectedClip.id}_split_${Date.now()}`,
      name: `${selectedClip.name} (Part 2)`,
      startTimeSec: currentTimeSec,
      durationSec: originalDur - splitOffset,
      sourceInSec: selectedClip.sourceInSec + splitOffset,
    };

    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => {
        if (t.id !== selectedClip.trackId) return t;
        const newClips = t.clips.flatMap((c) =>
          c.id === selectedClip.id ? [clipPart1, clipPart2] : [c]
        );
        return { ...t, clips: newClips };
      }),
    }));

    setSelectedClipId(clipPart2.id);
    onNotify?.(`Split "${selectedClip.name}" at ${currentTimeSec.toFixed(2)}s.`, 'success');
  }, [selectedClip, currentTimeSec, pushUndo, onNotify]);

  // Duplicate selected clip
  const handleDuplicateClip = useCallback(() => {
    if (!selectedClip) {
      onNotify?.('Select a clip to duplicate.', 'warning');
      return;
    }

    pushUndo();

    const dupClip: CanonicalClip = {
      ...selectedClip,
      id: `${selectedClip.id}_copy_${Date.now()}`,
      name: `${selectedClip.name} (Copy)`,
      startTimeSec: selectedClip.startTimeSec + selectedClip.durationSec + 0.1,
    };

    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => {
        if (t.id !== selectedClip.trackId) return t;
        return { ...t, clips: [...t.clips, dupClip] };
      }),
    }));

    setSelectedClipId(dupClip.id);
    onNotify?.(`Duplicated "${selectedClip.name}".`, 'success');
  }, [selectedClip, pushUndo, onNotify]);

  // Delete selected clip
  const handleDeleteClip = useCallback(() => {
    if (!selectedClip) return;
    pushUndo();

    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => {
        if (t.id !== selectedClip.trackId) return t;
        return { ...t, clips: t.clips.filter((c) => c.id !== selectedClip.id) };
      }),
    }));

    setSelectedClipId('');
    onNotify?.(`Deleted clip "${selectedClip.name}".`, 'info');
  }, [selectedClip, pushUndo, onNotify]);

  // Insert template item as clip from sidebar
  const handleInsertItemAsClip = useCallback(
    (item: CatalogItem) => {
      pushUndo();

      // Determine appropriate track based on item moduleId
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

      const duration = item.metadata?.durationSec || 3;
      const dims = getDimensionsForAspectRatio(aspectRatio);

      const newClip: CanonicalClip = {
        id: `clip_${item.id}_${Date.now()}`,
        trackId: targetTrackId,
        name: item.name,
        kind: clipKind,
        sceneId: 'scene_1',
        startTimeSec: currentTimeSec,
        durationSec: duration,
        sourceInSec: 0,
        sourceOutSec: duration,
        trimInSec: 0,
        trimOutSec: 0,
        speedMultiplier: 1,
        visible: true,
        locked: false,
        muted: false,
        solo: false,
        blendMode: item.moduleId === 'overlays-fx' ? 'screen' : 'normal',
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
      };

      setProject((prev) => ({
        ...prev,
        tracks: prev.tracks.map((t) => {
          if (t.id !== targetTrackId) return t;
          return { ...t, clips: [...t.clips, newClip] };
        }),
      }));

      setSelectedClipId(newClip.id);
      setSelectedTrackId(targetTrackId);
      onNotify?.(`Inserted "${item.name}" onto ${targetTrackId} at ${currentTimeSec.toFixed(2)}s.`, 'success');
    },
    [currentTimeSec, aspectRatio, pushUndo, onNotify]
  );

  // AI Prompt execution
  const handleApplyAiPrompt = useCallback(
    async (promptText: string) => {
      if (!promptText.trim()) return;
      setIsApplyingAi(true);

      try {
        pushUndo();
        // Simulate transactional AI reasoning and apply changes
        await new Promise((r) => setTimeout(r, 600));

        const lower = promptText.toLowerCase();

        if (lower.includes('title') || lower.includes('launch') || lower.includes('change text')) {
          setProject((prev) => ({
            ...prev,
            tracks: prev.tracks.map((t) => {
              if (t.kind !== 'text') return t;
              return {
                ...t,
                clips: t.clips.map((c) => {
                  if (c.id === 'clip_title_main' || c.kind === 'text') {
                    return {
                      ...c,
                      name: 'SHIP FASTER ON ANDROID',
                      textData: c.textData
                        ? { ...c.textData, content: 'SHIP FASTER ON ANDROID', colorHex: '#FF7434' }
                        : undefined,
                    };
                  }
                  return c;
                }),
              };
            }),
          }));
          onNotify?.('AI Director: Updated headline to "SHIP FASTER ON ANDROID" with accent glow.', 'success');
        } else if (lower.includes('whoosh') || lower.includes('sfx')) {
          // Add whoosh SFX clip at current time
          const sfxClip: CanonicalClip = {
            id: `clip_ai_whoosh_${Date.now()}`,
            trackId: 'track_sfx_1',
            name: 'Cinema Whoosh Impact',
            kind: 'audio',
            sceneId: 'scene_1',
            startTimeSec: currentTimeSec,
            durationSec: 1.4,
            sourceInSec: 0,
            sourceOutSec: 1.4,
            trimInSec: 0,
            trimOutSec: 0,
            speedMultiplier: 1,
            visible: true,
            locked: false,
            muted: false,
            solo: false,
            blendMode: 'normal',
            transform: { position: [0, 0], scale: [1, 1], rotationDeg: 0, anchor: [0.5, 0.5], opacity: 1 },
            keyframes: [],
            effects: [],
            masks: [],
          };
          setProject((prev) => ({
            ...prev,
            tracks: prev.tracks.map((t) => (t.id === 'track_sfx_1' ? { ...t, clips: [...t.clips, sfxClip] } : t)),
          }));
          onNotify?.(`AI Director: Added Cinema Whoosh Impact SFX at ${currentTimeSec.toFixed(2)}s.`, 'success');
        } else if (lower.includes('emerald') || lower.includes('color')) {
          setProject((prev) => ({
            ...prev,
            tracks: prev.tracks.map((t) => {
              if (t.kind !== 'text') return t;
              return {
                ...t,
                clips: t.clips.map((c) => ({
                  ...c,
                  textData: c.textData ? { ...c.textData, colorHex: '#55B98B' } : undefined,
                })),
              };
            }),
          }));
          onNotify?.('AI Director: Applied Emerald Accent palette (#55B98B) across text layers.', 'success');
        } else {
          // Generic timing adjustment
          onNotify?.(`AI Director: Analyzed "${promptText}" and optimized layer synchronization.`, 'success');
        }

        setAiPromptInput('');
      } finally {
        setIsApplyingAi(false);
      }
    },
    [currentTimeSec, pushUndo, onNotify]
  );

  // Filter catalog items for sidebar
  const filteredCatalogItems = useMemo(() => {
    return SEED_CATALOG_ITEMS.filter((item) => {
      const matchesMod = item.moduleId === activeModuleId;
      const matchesSearch =
        !searchQuery ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesCategory = selectedCategory === 'All' || item.categoryId === selectedCategory;
      return matchesMod && matchesSearch && matchesCategory;
    });
  }, [activeModuleId, searchQuery, selectedCategory]);

  // Current active module categories
  const activeModuleCategories = useMemo(() => {
    return MODULE_CATEGORIES.filter((c) => c.moduleId === activeModuleId).sort((a, b) => a.order - b.order);
  }, [activeModuleId]);

  // Format timecode HH:MM:SS:FF
  const formatTimecode = (seconds: number, fps = 30): string => {
    const totalFrames = Math.floor(seconds * fps);
    const ff = totalFrames % fps;
    const totalSec = Math.floor(seconds);
    const ss = totalSec % 60;
    const mm = Math.floor(totalSec / 60) % 60;
    const hh = Math.floor(totalSec / 3600);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
  };

  // Active clips in the canvas right now
  const activeClipsAtTime = useMemo(() => {
    const list: Array<{ clip: CanonicalClip; track: CanonicalTrack }> = [];
    for (const track of project.tracks) {
      if (!track.visible) continue;
      for (const clip of track.clips) {
        if (!clip.visible) continue;
        const start = clip.startTimeSec;
        const end = clip.startTimeSec + clip.durationSec;
        if (currentTimeSec >= start && currentTimeSec <= end) {
          list.push({ clip, track });
        }
      }
    }
    return list;
  }, [project.tracks, currentTimeSec]);

  // Canvas dimensions based on aspect ratio
  const canvasDims = useMemo(() => getDimensionsForAspectRatio(aspectRatio), [aspectRatio]);

  // Genuine Canonical Compositor SVG evaluated at current playhead timestamp
  const liveCompositorSvg = useMemo(() => {
    return renderCanonicalFrameSvg(project, canvasDims.width, canvasDims.height, currentTimeSec);
  }, [project, canvasDims.width, canvasDims.height, currentTimeSec]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-screen w-screen overflow-hidden bg-[#080707] text-[#F3EEE8] safe-all select-none"
      data-testid="landscape-creative-studio-root"
    >
      {/* =========================================================================
          1. COMPACT PROJECT HEADER & GLOBAL WORKSPACE SWITCHER
          ========================================================================= */}
      <header className="h-10 shrink-0 px-3 flex items-center justify-between border-b border-[#2A231E] bg-[#0B0A09] gap-2 text-xs">
        {/* Left: Sowveil Brand & Project Name */}
        <div className="flex items-center gap-2 min-w-0">
          <Link
            to="/app"
            className="flex items-center gap-1.5 font-black tracking-widest text-[#F3EEE8] hover:text-[#F06424] transition-colors shrink-0"
            title="Go to Sowveil Dashboard"
          >
            <span className="text-xs">SOWVEIL</span>
            <span className="px-1.5 py-0.5 rounded bg-[#2A1810] border border-[#F06424]/60 text-[#F06424] text-[9px] font-bold tracking-wider">
              LANDSCAPE
            </span>
          </Link>

          <span className="text-[#342A24]">|</span>

          {/* Project Title Editor */}
          <input
            type="text"
            value={projectTitle}
            onChange={(e) => setProjectTitle(e.target.value)}
            className="bg-transparent border border-transparent hover:border-[#342A24] focus:border-[#F06424] focus:bg-[#121110] rounded px-1.5 py-0.5 text-xs text-[#F3EEE8] font-semibold truncate max-w-[140px] sm:max-w-[200px]"
            title="Click to rename project"
          />
        </div>

        {/* Center: Canvas Aspect Ratio & Format Controls */}
        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          {/* Aspect Ratio Selector */}
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

          {/* Resolution & FPS */}
          <select
            value={resolutionFps}
            onChange={(e) => setResolutionFps(e.target.value as any)}
            className="bg-[#141210] border border-[#26201C] text-[#B8AAA0] text-[10px] rounded px-1.5 py-0.5 focus:border-[#F06424] focus:text-[#F3EEE8]"
          >
            <option value="1080p · 30fps">1080p · 30fps</option>
            <option value="720p · 30fps">720p · 30fps</option>
            <option value="540p Proxy">540p Proxy</option>
          </select>

          {/* Timecode Badge */}
          <span className="font-mono-tabular text-[11px] text-[#55B98B] bg-[#0E1E16] border border-[#55B98B]/30 px-1.5 py-0.5 rounded">
            {formatTimecode(currentTimeSec)} / {formatTimecode(project.canvas.durationSec || 8)}
          </span>
        </div>

        {/* Right: Actions, Gateway Status & Global Workspace Switcher */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Mobile Gateway Status Pill */}
          <span
            className="hidden lg:inline-flex items-center gap-1 text-[10px] font-mono-tabular text-[#55B98B] bg-[#55B98B]/10 border border-[#55B98B]/30 px-2 py-0.5 rounded"
            title="Real Android Mobile-Native Compositor & Gemini AI Gateway"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#55B98B] animate-pulse" />
            <span>Compositor: Ready</span>
          </span>

          {/* Undo / Redo */}
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="p-1 rounded text-[#B8AAA0] hover:text-[#F3EEE8] disabled:opacity-30 disabled:pointer-events-none hover:bg-[#191614]"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            className="p-1 rounded text-[#B8AAA0] hover:text-[#F3EEE8] disabled:opacity-30 disabled:pointer-events-none hover:bg-[#191614]"
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>

          {/* Save Button */}
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[#F06424] hover:bg-[#FF7434] text-[#080707] font-bold text-xs transition-colors"
            title="Save Project (Ctrl+S)"
          >
            <Save className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Save</span>
          </button>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="p-1 rounded text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#191614]"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Global Workspace Switcher Dropdown Toggle */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsSwitcherOpen((prev) => !prev)}
              className="flex items-center gap-1 px-2 py-1 rounded border border-[#342A24] bg-[#141210] hover:border-[#F06424] text-xs font-medium text-[#F3EEE8] transition-colors"
              title="Switch Workspace"
            >
              <Layout className="w-3.5 h-3.5 text-[#F06424]" />
              <span className="hidden md:inline">Workspace</span>
              <ChevronDown className="w-3 h-3 text-[#B8AAA0]" />
            </button>

            {/* Switcher Modal / Dropdown */}
            {isSwitcherOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-64 rounded-lg border border-[#342A24] bg-[#0E0C0B] shadow-2xl z-50 p-1.5 flex flex-col gap-0.5"
                onMouseLeave={() => setIsSwitcherOpen(false)}
              >
                <div className="px-2 py-1 text-[10px] uppercase font-bold tracking-wider text-[#83766D] border-b border-[#26201C]">
                  Global Workspace Switcher
                </div>
                {GLOBAL_WORKSPACES.map((ws) => {
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
            )}
          </div>
        </div>
      </header>

      {/* =========================================================================
          2. HORIZONTALLY SCROLLABLE 20-MODULE REFERENCE STRIP
          ========================================================================= */}
      <nav
        aria-label="20 Canonical Reference Modules"
        className="h-9 shrink-0 flex items-center px-2 border-b border-[#26201C] bg-[#0A0908] overflow-x-auto no-scrollbar gap-1.5 text-xs"
      >
        <span className="text-[10px] uppercase font-bold tracking-wider text-[#83766D] pl-1 pr-2 shrink-0 hidden sm:inline">
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
                if (!isSidebarOpen) setIsSidebarOpen(true);
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium whitespace-nowrap shrink-0 transition-colors border ${
                isActive
                  ? 'bg-[#F06424] text-[#080707] font-bold border-[#F06424] shadow-[0_0_10px_rgba(240,100,36,0.35)]'
                  : 'bg-[#141210] text-[#B8AAA0] border-[#221D1A] hover:border-[#83766D] hover:text-[#F3EEE8]'
              }`}
              title={`${mod.label} (${count ?? 'Active'}) — Click to filter Marketplace sidebar`}
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

        {/* Shortcut to full reference Marketplace workspace */}
        <Link
          to={`/app/${activeModuleId}`}
          className="ml-auto flex items-center gap-1 text-[10px] text-[#F06424] hover:underline whitespace-nowrap shrink-0 px-2 font-semibold"
          title="Open original 1:1 reference clone layout for this module"
        >
          <span>Open in Marketplace</span>
          <ArrowRight className="w-3 h-3" />
        </Link>
      </nav>

      {/* =========================================================================
          3. MAIN STUDIO WORKSPACE (3-COLUMN SPLIT: SIDEBAR | CANVAS | INSPECTOR/AI)
          ========================================================================= */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {/* ---------------------------------------------------------------------
            A. COLLAPSIBLE MARKETPLACE & TEMPLATE SIDEBAR (LEFT)
            --------------------------------------------------------------------- */}
        <aside
          className={`shrink-0 flex flex-col border-r border-[#26201C] bg-[#0D0C0B] transition-all duration-200 z-10 ${
            isSidebarOpen ? 'w-64 sm:w-72 lg:w-80' : 'w-0 overflow-hidden border-none'
          }`}
        >
          {/* Sidebar Header */}
          <div className="p-2.5 border-b border-[#26201C] flex items-center justify-between gap-2 bg-[#0E0D0C]">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-bold text-[#F3EEE8] truncate">
                {SOWVEIL_MODULES.find((m) => m.id === activeModuleId)?.label || 'Catalog'}
              </span>
              <span className="text-[10px] font-mono-tabular text-[#83766D]">
                ({filteredCatalogItems.length})
              </span>
            </div>

            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="p-1 rounded text-[#83766D] hover:text-[#F3EEE8] hover:bg-[#191614]"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Search Bar */}
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

          {/* Category Filter Pills */}
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

          {/* Template Cards List */}
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
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-[#F3EEE8] truncate group-hover:text-[#F06424]">
                      {item.name}
                    </span>
                    <span className="text-[10px] font-mono-tabular text-[#83766D]">
                      {item.metadata?.durationSec ? `${item.metadata.durationSec}s` : 'Procedural'}
                    </span>
                  </div>

                  <p className="text-[11px] text-[#B8AAA0] line-clamp-1 mb-2">
                    {item.description || item.summary || `${item.categoryId} template`}
                  </p>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#1C1816]">
                    <span className="text-[9px] text-[#83766D] uppercase tracking-wider font-semibold">
                      {item.categoryId}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleInsertItemAsClip(item)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#F06424] hover:bg-[#FF7434] text-[#080707] text-[10px] font-bold transition-colors"
                      title="Insert as clip onto timeline at playhead"
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

        {/* Sidebar Toggle Handle (when closed) */}
        {!isSidebarOpen && (
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="absolute left-1 top-2 z-20 p-1.5 rounded-r bg-[#191614] border border-l-0 border-[#342A24] text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#26201C]"
            title="Open Marketplace sidebar"
          >
            <PanelLeftOpen className="w-4 h-4 text-[#F06424]" />
          </button>
        )}

        {/* ---------------------------------------------------------------------
            B. CENTRAL ASPECT-RATIO-AWARE PREVIEW CANVAS (CENTER)
            --------------------------------------------------------------------- */}
        <main className="flex-1 flex flex-col bg-[#080707] overflow-hidden min-w-0">
          {/* Preview Viewport Container */}
          <div className="flex-1 relative flex items-center justify-center p-3 overflow-hidden bg-[#050505]">
            {/* The Aspect Ratio Frame */}
            <div
              className="relative shadow-2xl border border-[#26201C] bg-[#090808] flex items-center justify-center overflow-hidden transition-all duration-200"
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
              }}
            >
              {/* Action Safe (90%) and Title Safe (80%) Guides */}
              {showSafeGuides && (
                <div className="absolute inset-0 pointer-events-none z-30">
                  {/* Action Safe (90%) */}
                  <div className="absolute inset-[5%] border border-[#38BDF8]/25 border-dashed rounded" />
                  {/* Title Safe (80%) */}
                  <div className="absolute inset-[10%] border border-[#EAB308]/25 border-dashed rounded" />
                </div>
              )}

              {/* Genuine Canonical Compositor Vector Plate (Track-Ordered Layers & Transforms) */}
              <div
                className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden z-0"
                dangerouslySetInnerHTML={{ __html: sanitizeSvgContent(liveCompositorSvg) }}
              />

              {/* Live Canvas Interactive Overlays & Clip Selection */}
              <div className="absolute inset-0 flex flex-col items-center justify-center p-4 overflow-hidden z-10 pointer-events-none">
                {/* Background Video / Footage Clip */}
                {activeClipsAtTime.some((c) => c.clip.kind === 'video') && (
                  <div className="absolute inset-0 bg-gradient-to-br from-[#121118] via-[#1E1428] to-[#0A090F] opacity-90" />
                )}

                {/* Overlays / Light Leaks */}
                {activeClipsAtTime.some((c) => c.track.kind === 'effect') && (
                  <div className="absolute inset-0 bg-gradient-to-tr from-[#F06424]/10 via-transparent to-[#38BDF8]/15 mix-blend-screen pointer-events-none" />
                )}

                {/* Motion Graphic / Card Instance */}
                {activeClipsAtTime.some((c) => c.clip.kind === 'template-instance') && (
                  <div className="z-10 px-4 py-3 rounded-xl bg-[#141210]/80 border border-[#F06424]/40 backdrop-blur-md shadow-xl flex items-center gap-3 max-w-[85%] animate-pulse">
                    <Sparkles className="w-5 h-5 text-[#F06424] shrink-0" />
                    <div>
                      <div className="text-xs font-bold text-[#F3EEE8]">SOWVEIL PRO ENGINE</div>
                      <div className="text-[10px] text-[#B8AAA0]">Realtime Mobile Compositing</div>
                    </div>
                  </div>
                )}

                {/* Text & Headline Layers */}
                {activeClipsAtTime
                  .filter((c) => c.clip.kind === 'text')
                  .map(({ clip }) => {
                    const isSelected = clip.id === selectedClipId;
                    return (
                      <div
                        key={clip.id}
                        onClick={() => {
                          setSelectedClipId(clip.id);
                          setSelectedTrackId(clip.trackId);
                        }}
                        className={`pointer-events-auto z-20 my-2 cursor-pointer transition-transform ${
                          isSelected ? 'ring-2 ring-[#F06424] ring-offset-2 ring-offset-black rounded px-2' : ''
                        }`}
                      >
                        <h2
                          className="font-black tracking-tight text-center uppercase"
                          style={{
                            color: clip.textData?.colorHex || '#F3EEE8',
                            fontSize: clip.textData?.fontSizePx ? `${Math.max(16, clip.textData.fontSizePx * 0.45)}px` : '24px',
                            letterSpacing: `${(clip.textData?.letterSpacingEm || 0.02) * 16}px`,
                          }}
                        >
                          {clip.textData?.content || clip.name}
                        </h2>
                      </div>
                    );
                  })}

                {/* Audio Waveform Indicator */}
                {activeClipsAtTime.some((c) => c.track.kind === 'audio') && (
                  <div className="absolute bottom-4 left-4 right-4 z-10 flex items-center justify-center gap-1 opacity-70">
                    {[16, 28, 40, 24, 32, 18, 44, 20, 36, 12].map((h, i) => (
                      <span
                        key={i}
                        className="w-1 bg-[#55B98B] rounded-full transition-all duration-100"
                        style={{ height: isPlaying ? `${(h * (1 + (i % 3) * 0.3)).toFixed(0)}px` : `${h}px` }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Timecode overlay badge in canvas */}
              <div className="absolute top-2 left-2 z-30 font-mono-tabular text-[9px] text-[#B8AAA0] bg-[#080707]/70 backdrop-blur-sm px-1.5 py-0.5 rounded border border-[#26201C]">
                {formatTimecode(currentTimeSec)}
              </div>
            </div>
          </div>

          {/* Canvas Transport & Controls Toolbar */}
          <div className="h-10 shrink-0 px-3 flex items-center justify-between border-t border-[#26201C] bg-[#0B0A09] gap-2 text-xs">
            {/* Left Transport: Jump, Step, Play/Pause */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentTimeSec(0)}
                className="p-1 rounded text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#191614]"
                title="Jump to Start (Home)"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentTimeSec((t) => Math.max(0, t - 1 / 30))}
                className="p-1 rounded text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#191614]"
                title="Step Back 1 Frame (Left Arrow)"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setIsPlaying((p) => !p)}
                className="w-7 h-7 rounded-full flex items-center justify-center bg-[#F06424] hover:bg-[#FF7434] text-[#080707] font-bold shadow-md transition-colors"
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
              </button>

              <button
                type="button"
                onClick={() => setCurrentTimeSec((t) => Math.min(project.canvas.durationSec || 8, t + 1 / 30))}
                className="p-1 rounded text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#191614]"
                title="Step Forward 1 Frame (Right Arrow)"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentTimeSec(project.canvas.durationSec || 8)}
                className="p-1 rounded text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#191614]"
                title="Jump to End (End)"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setIsLooping((l) => !l)}
                className={`p-1 rounded transition-colors ${
                  isLooping ? 'text-[#F06424]' : 'text-[#83766D] hover:text-[#F3EEE8]'
                }`}
                title={isLooping ? 'Loop Playback Active' : 'Loop Playback Off'}
              >
                <Repeat className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Center: Playhead Scrubber Slider */}
            <div className="flex-1 max-w-sm flex items-center gap-2 px-2">
              <span className="font-mono-tabular text-[10px] text-[#B8AAA0]">
                {currentTimeSec.toFixed(2)}s
              </span>
              <input
                type="range"
                min={0}
                max={project.canvas.durationSec || 8}
                step={0.01}
                value={currentTimeSec}
                onChange={(e) => setCurrentTimeSec(parseFloat(e.target.value))}
                className="w-full accent-[#F06424] h-1.5 bg-[#26201C] rounded cursor-pointer"
              />
              <span className="font-mono-tabular text-[10px] text-[#83766D]">
                {(project.canvas.durationSec || 8).toFixed(1)}s
              </span>
            </div>

            {/* Right: Guides Toggle & Canvas Scale */}
            <div className="flex items-center gap-1.5">
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
            C. RIGHT-SIDE TABBED PANEL (AI DIRECTOR / INSPECTOR / EFFECTS / ANIMATION / ASSETS)
            --------------------------------------------------------------------- */}
        <aside
          className={`shrink-0 flex flex-col border-l border-[#26201C] bg-[#0D0C0B] transition-all duration-200 z-10 ${
            isRightPanelOpen ? 'w-72 sm:w-80 lg:w-96' : 'w-0 overflow-hidden border-none'
          }`}
        >
          {/* Tabs Header */}
          <div className="p-1 border-b border-[#26201C] flex items-center justify-between bg-[#0E0D0C]">
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
              className="p-1 rounded text-[#83766D] hover:text-[#F3EEE8] hover:bg-[#191614] shrink-0"
              title="Collapse panel"
            >
              <PanelRightClose className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Panel Content Body */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* TAB 1: AI DIRECTOR */}
            {rightPanelTab === 'director' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-2 rounded-lg bg-[#F06424]/10 border border-[#F06424]/30">
                  <Sparkles className="w-4 h-4 text-[#F06424] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#F06424]">AI Creative Co-Director</div>
                    <div className="text-[11px] text-[#B8AAA0]">
                      Plan, re-time, replace elements, and polish timeline.
                    </div>
                  </div>
                </div>

                {/* Prompt Input */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-[#B8AAA0]">Instruction Prompt</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      placeholder="e.g. Change title to 'Ship Faster'..."
                      value={aiPromptInput}
                      onChange={(e) => setAiPromptInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleApplyAiPrompt(aiPromptInput)}
                      className="flex-1 bg-[#141210] border border-[#2A231E] rounded-md px-2.5 py-1.5 text-xs text-[#F3EEE8] placeholder-[#83766D] focus:border-[#F06424] focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={isApplyingAi || !aiPromptInput.trim()}
                      onClick={() => handleApplyAiPrompt(aiPromptInput)}
                      className="px-3 py-1.5 rounded bg-[#F06424] hover:bg-[#FF7434] text-[#080707] font-bold text-xs disabled:opacity-40 flex items-center gap-1 transition-colors"
                    >
                      {isApplyingAi ? <Sparkles className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                      <span>Apply</span>
                    </button>
                  </div>
                </div>

                {/* One-Tap Suggestions */}
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-[#83766D]">Quick AI Actions</span>
                  <div className="flex flex-col gap-1">
                    {[
                      'Change headline to "SHIP FASTER ON ANDROID"',
                      'Add cinema whoosh SFX at cut',
                      'Apply Emerald Accent palette (#55B98B)',
                      'Re-time entrance to 0.4s with snappy easing',
                    ].map((sug, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleApplyAiPrompt(sug)}
                        className="text-left text-xs p-2 rounded bg-[#141210] border border-[#221D1A] hover:border-[#F06424]/60 text-[#B8AAA0] hover:text-[#F3EEE8] transition-colors"
                      >
                        ⚡ {sug}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Director Production Brief Summary */}
                <div className="p-2.5 rounded-lg border border-[#221D1A] bg-[#121110] space-y-1 text-xs">
                  <div className="font-semibold text-[#F3EEE8] flex items-center justify-between">
                    <span>Director Brief</span>
                    <span className="text-[10px] text-[#55B98B]">Pass 1 Complete</span>
                  </div>
                  <p className="text-[11px] text-[#83766D]">
                    7 tracks synchronized. 1 Scene planned. Audio tracks calibrated with -6dB BGM ducking.
                  </p>
                </div>
              </div>
            )}

            {/* TAB 2: INSPECTOR */}
            {rightPanelTab === 'inspector' && (
              <div className="space-y-3">
                {selectedClip ? (
                  <>
                    <div className="p-2 rounded bg-[#141210] border border-[#26201C] flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#F3EEE8] truncate">{selectedClip.name}</div>
                        <div className="text-[10px] text-[#83766D]">
                          Track: {selectedClip.trackId} · Kind: {selectedClip.kind}
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

                    {/* Clip Timing Parameters */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="space-y-1">
                        <label className="text-[10px] text-[#83766D]">Start Time (s)</label>
                        <input
                          type="number"
                          step={0.1}
                          value={selectedClip.startTimeSec}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setProject((prev) => ({
                              ...prev,
                              tracks: prev.tracks.map((t) => ({
                                ...t,
                                clips: t.clips.map((c) => (c.id === selectedClip.id ? { ...c, startTimeSec: val } : c)),
                              })),
                            }));
                          }}
                          className="w-full bg-[#141210] border border-[#2A231E] rounded px-2 py-1 text-xs text-[#F3EEE8]"
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
                            setProject((prev) => ({
                              ...prev,
                              tracks: prev.tracks.map((t) => ({
                                ...t,
                                clips: t.clips.map((c) => (c.id === selectedClip.id ? { ...c, durationSec: val } : c)),
                              })),
                            }));
                          }}
                          className="w-full bg-[#141210] border border-[#2A231E] rounded px-2 py-1 text-xs text-[#F3EEE8]"
                        />
                      </div>
                    </div>

                    {/* Text Layer Properties (if applicable) */}
                    {selectedClip.kind === 'text' && selectedClip.textData && (
                      <div className="space-y-2 pt-2 border-t border-[#221D1A]">
                        <span className="text-[10px] uppercase font-bold text-[#83766D]">Typography</span>
                        <div className="space-y-1">
                          <label className="text-[10px] text-[#83766D]">Text Content</label>
                          <input
                            type="text"
                            value={selectedClip.textData.content}
                            onChange={(e) => {
                              const val = e.target.value;
                              setProject((prev) => ({
                                ...prev,
                                tracks: prev.tracks.map((t) => ({
                                  ...t,
                                  clips: t.clips.map((c) =>
                                    c.id === selectedClip.id
                                      ? {
                                          ...c,
                                          name: val,
                                          textData: c.textData ? { ...c.textData, content: val } : undefined,
                                        }
                                      : c
                                  ),
                                })),
                              }));
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
                                  const val = e.target.value;
                                  setProject((prev) => ({
                                    ...prev,
                                    tracks: prev.tracks.map((t) => ({
                                      ...t,
                                      clips: t.clips.map((c) =>
                                        c.id === selectedClip.id && c.textData
                                          ? { ...c, textData: { ...c.textData, colorHex: val } }
                                          : c
                                      ),
                                    })),
                                  }));
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
                                setProject((prev) => ({
                                  ...prev,
                                  tracks: prev.tracks.map((t) => ({
                                    ...t,
                                    clips: t.clips.map((c) =>
                                      c.id === selectedClip.id && c.textData
                                        ? { ...c, textData: { ...c.textData, fontSizePx: val } }
                                        : c
                                    ),
                                  })),
                                }));
                              }}
                              className="w-full bg-[#141210] border border-[#2A231E] rounded px-2 py-1 text-xs text-[#F3EEE8]"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Transform Properties */}
                    <div className="space-y-2 pt-2 border-t border-[#221D1A]">
                      <span className="text-[10px] uppercase font-bold text-[#83766D]">Transform & Blend</span>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="space-y-1">
                          <label className="text-[10px] text-[#83766D]">Opacity (%)</label>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={selectedClip.transform.opacity}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setProject((prev) => ({
                                ...prev,
                                tracks: prev.tracks.map((t) => ({
                                  ...t,
                                  clips: t.clips.map((c) =>
                                    c.id === selectedClip.id
                                      ? { ...c, transform: { ...c.transform, opacity: val } }
                                      : c
                                  ),
                                })),
                              }));
                            }}
                            className="w-full accent-[#F06424]"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-[#83766D]">Blend Mode</label>
                          <select
                            value={selectedClip.blendMode}
                            onChange={(e) => {
                              const val = e.target.value as any;
                              setProject((prev) => ({
                                ...prev,
                                tracks: prev.tracks.map((t) => ({
                                  ...t,
                                  clips: t.clips.map((c) => (c.id === selectedClip.id ? { ...c, blendMode: val } : c)),
                                })),
                              }));
                            }}
                            className="w-full bg-[#141210] border border-[#2A231E] rounded px-1.5 py-1 text-xs text-[#F3EEE8]"
                          >
                            <option value="normal">Normal</option>
                            <option value="screen">Screen</option>
                            <option value="multiply">Multiply</option>
                            <option value="overlay">Overlay</option>
                            <option value="add">Add</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="p-4 text-center text-xs text-[#83766D]">
                    Click any clip on the timeline to inspect and edit its properties.
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: EFFECTS */}
            {rightPanelTab === 'effects' && (
              <div className="space-y-3">
                <span className="text-[10px] uppercase font-bold text-[#83766D]">Post-Processing & LUTs</span>
                <div className="space-y-2">
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between text-[#83766D]">
                      <span>Glow Intensity</span>
                      <span className="font-mono-tabular">65%</span>
                    </div>
                    <input type="range" min={0} max={100} defaultValue={65} className="w-full accent-[#F06424]" />
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between text-[#83766D]">
                      <span>Motion Blur</span>
                      <span className="font-mono-tabular">180°</span>
                    </div>
                    <input type="range" min={0} max={360} defaultValue={180} className="w-full accent-[#F06424]" />
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between text-[#83766D]">
                      <span>Saturation</span>
                      <span className="font-mono-tabular">115%</span>
                    </div>
                    <input type="range" min={50} max={200} defaultValue={115} className="w-full accent-[#F06424]" />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: ANIMATION & EASING */}
            {rightPanelTab === 'animation' && (
              <div className="space-y-3">
                <span className="text-[10px] uppercase font-bold text-[#83766D]">Cubic-Bezier Easing Presets</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { name: 'Ease Out Cubic', curve: 'M 0 100 C 33 100 0 0 100 0' },
                    { name: 'Snappy Back', curve: 'M 0 100 C 18 100 40 -20 100 0' },
                    { name: 'Spring Follow', curve: 'M 0 100 C 40 100 20 -15 100 0' },
                    { name: 'Linear', curve: 'M 0 100 L 100 0' },
                  ].map((preset, i) => (
                    <div
                      key={i}
                      className="p-2 rounded bg-[#141210] border border-[#221D1A] hover:border-[#F06424] cursor-pointer flex flex-col items-center gap-1.5"
                    >
                      <svg viewBox="0 0 100 100" className="w-12 h-12 stroke-[#F06424] fill-none stroke-[3]">
                        <path d={preset.curve} />
                      </svg>
                      <span className="text-[10px] font-semibold text-[#B8AAA0] text-center">
                        {preset.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 5: ASSETS */}
            {rightPanelTab === 'assets' && (
              <div className="space-y-3">
                <span className="text-[10px] uppercase font-bold text-[#83766D]">Project Media Pool</span>
                <div className="space-y-1.5">
                  {[
                    { name: 'Cyberpunk Grid Gradient.mp4', type: 'Video · 1080p', icon: Film },
                    { name: 'Neon Horizon BGM.wav', type: 'Audio · 320kbps', icon: Music },
                    { name: 'Whoosh Hit SFX.wav', type: 'SFX · 48kHz', icon: Volume2 },
                    { name: 'Plus Jakarta Sans Bold.woff2', type: 'Font Asset', icon: Type },
                  ].map((asset, i) => {
                    const Icon = asset.icon;
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between p-2 rounded bg-[#141210] border border-[#221D1A]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon className="w-4 h-4 text-[#F06424] shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[#F3EEE8] truncate">{asset.name}</div>
                            <div className="text-[10px] text-[#83766D]">{asset.type}</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="px-2 py-0.5 rounded bg-[#26201C] hover:bg-[#F06424] hover:text-[#080707] text-[10px] font-bold text-[#B8AAA0] transition-colors"
                        >
                          + Track
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Right Panel Toggle Handle (when closed) */}
        {!isRightPanelOpen && (
          <button
            type="button"
            onClick={() => setIsRightPanelOpen(true)}
            className="absolute right-1 top-2 z-20 p-1.5 rounded-l bg-[#191614] border border-r-0 border-[#342A24] text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#26201C]"
            title="Open Inspector panel"
          >
            <PanelRightOpen className="w-4 h-4 text-[#F06424]" />
          </button>
        )}
      </div>

      {/* =========================================================================
          4. BOTTOM MULTITRACK TIMELINE (7 CANONICAL LANES)
          ========================================================================= */}
      <footer
        className={`shrink-0 border-t border-[#26201C] bg-[#0A0908] flex flex-col transition-all duration-200 ${
          isTimelineExpanded ? 'h-52 sm:h-60' : 'h-10'
        }`}
      >
        {/* Timeline Control Bar */}
        <div className="h-8 shrink-0 px-3 flex items-center justify-between border-b border-[#221D1A] bg-[#0D0C0B] text-xs">
          {/* Action Buttons: Split, Duplicate, Delete, Keyframe */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleSplitClipAtPlayhead}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#191614] hover:bg-[#26201C] border border-[#2E2722] text-[#F3EEE8] text-[11px] font-medium"
              title="Split selected clip at playhead position (S)"
            >
              <Scissors className="w-3 h-3 text-[#F06424]" />
              <span className="hidden sm:inline">Split</span>
            </button>

            <button
              type="button"
              onClick={handleDuplicateClip}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#191614] hover:bg-[#26201C] border border-[#2E2722] text-[#F3EEE8] text-[11px] font-medium"
              title="Duplicate selected clip (D)"
            >
              <Copy className="w-3 h-3 text-[#38BDF8]" />
              <span className="hidden sm:inline">Duplicate</span>
            </button>

            <button
              type="button"
              onClick={handleDeleteClip}
              disabled={!selectedClip}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#191614] hover:bg-[#26201C] border border-[#2E2722] text-[#F06464] disabled:opacity-30 text-[11px] font-medium"
              title="Delete selected clip (Del)"
            >
              <Trash2 className="w-3 h-3" />
              <span className="hidden sm:inline">Delete</span>
            </button>

            <button
              type="button"
              onClick={() => onNotify?.('Keyframe added at current playhead.', 'info')}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#191614] hover:bg-[#26201C] border border-[#2E2722] text-[#EAB308] text-[11px] font-medium"
              title="Add Keyframe (K)"
            >
              <KeyRound className="w-3 h-3" />
              <span className="hidden sm:inline">Keyframe</span>
            </button>
          </div>

          {/* Timeline Zoom Slider */}
          <div className="flex items-center gap-2">
            <ZoomOut className="w-3 h-3 text-[#83766D]" />
            <input
              type="range"
              min={25}
              max={120}
              value={timelineZoomPxPerSec}
              onChange={(e) => setTimelineZoomPxPerSec(parseInt(e.target.value, 10))}
              className="w-20 sm:w-28 accent-[#F06424] h-1 bg-[#26201C] rounded cursor-pointer"
              title="Zoom Timeline (pixels per second)"
            />
            <ZoomIn className="w-3 h-3 text-[#83766D]" />

            <button
              type="button"
              onClick={() => setIsTimelineExpanded((p) => !p)}
              className="p-1 rounded text-[#B8AAA0] hover:text-[#F3EEE8]"
              title={isTimelineExpanded ? 'Minimize timeline' : 'Expand timeline'}
            >
              {isTimelineExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5 -rotate-90" />}
            </button>
          </div>
        </div>

        {/* Multitrack Scrollable Area */}
        {isTimelineExpanded && (
          <div className="flex-1 flex overflow-hidden">
            {/* Track Headers (Left Rail) */}
            <div className="w-32 sm:w-44 shrink-0 border-r border-[#221D1A] bg-[#0E0D0C] overflow-y-auto no-scrollbar flex flex-col">
              {/* Ruler header corner */}
              <div className="h-6 shrink-0 border-b border-[#221D1A] bg-[#0A0908] px-2 flex items-center text-[10px] text-[#83766D] font-mono-tabular">
                TRACKS (7)
              </div>

              {/* 7 Track Header Rows */}
              {project.tracks.map((track) => {
                const cfg = CANONICAL_TRACK_CONFIGS.find((c) => c.id === track.id) || CANONICAL_TRACK_CONFIGS[0];
                const Icon = cfg.icon;
                const isSelected = track.id === selectedTrackId;

                return (
                  <div
                    key={track.id}
                    onClick={() => setSelectedTrackId(track.id)}
                    className={`h-7 shrink-0 px-2 flex items-center justify-between border-b border-[#1A1715] cursor-pointer transition-colors ${
                      isSelected ? 'bg-[#1C1816]' : 'hover:bg-[#141210]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.borderColor.replace('border-', 'bg-')}`} />
                      <span className="text-[11px] font-semibold text-[#F3EEE8] truncate">{track.name}</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 text-[#83766D]">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setProject((prev) => ({
                            ...prev,
                            tracks: prev.tracks.map((t) => (t.id === track.id ? { ...t, muted: !t.muted } : t)),
                          }));
                        }}
                        className={`p-0.5 rounded hover:text-[#F3EEE8] ${track.muted ? 'text-[#F06464]' : ''}`}
                        title={track.muted ? 'Unmute' : 'Mute'}
                      >
                        {track.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setProject((prev) => ({
                            ...prev,
                            tracks: prev.tracks.map((t) => (t.id === track.id ? { ...t, visible: !t.visible } : t)),
                          }));
                        }}
                        className={`p-0.5 rounded hover:text-[#F3EEE8] ${!track.visible ? 'text-[#F06464]' : ''}`}
                        title={track.visible ? 'Hide track' : 'Show track'}
                      >
                        {track.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Tracks Canvas & Playhead Lanes (Right Scrollable) */}
            <div className="flex-1 overflow-x-auto overflow-y-auto relative bg-[#090808]">
              <div
                className="relative"
                style={{
                  width: `${Math.max(800, (project.canvas.durationSec || 8) * timelineZoomPxPerSec + 200)}px`,
                }}
              >
                {/* Time Ruler */}
                <div className="h-6 border-b border-[#221D1A] bg-[#0C0B0A] sticky top-0 z-20 flex items-center select-none font-mono-tabular text-[9px] text-[#83766D]">
                  {Array.from({ length: Math.ceil((project.canvas.durationSec || 8) + 2) }).map((_, sec) => (
                    <div
                      key={sec}
                      className="absolute border-l border-[#26201C] pl-1 h-full flex items-center"
                      style={{ left: `${sec * timelineZoomPxPerSec}px` }}
                    >
                      {sec}s
                    </div>
                  ))}
                </div>

                {/* Vertical Playhead Scrub Line */}
                <div
                  className="absolute top-0 bottom-0 z-30 pointer-events-none flex flex-col items-center"
                  style={{ left: `${currentTimeSec * timelineZoomPxPerSec}px` }}
                >
                  <div className="w-3 h-3 bg-[#F06424] rotate-45 -mt-1 shadow" />
                  <div className="w-0.5 flex-1 bg-[#F06424] shadow-[0_0_8px_rgba(240,100,36,0.8)]" />
                </div>

                {/* 7 Track Lanes */}
                {project.tracks.map((track) => {
                  const cfg = CANONICAL_TRACK_CONFIGS.find((c) => c.id === track.id) || CANONICAL_TRACK_CONFIGS[0];

                  return (
                    <div
                      key={track.id}
                      className="h-7 border-b border-[#1A1715] relative flex items-center"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const clickX = e.clientX - rect.left;
                        const newSec = Math.max(0, clickX / timelineZoomPxPerSec);
                        setCurrentTimeSec(newSec);
                      }}
                    >
                      {/* Clips on this track */}
                      {track.clips.map((clip) => {
                        const isSelected = clip.id === selectedClipId;
                        const leftPx = clip.startTimeSec * timelineZoomPxPerSec;
                        const widthPx = Math.max(20, clip.durationSec * timelineZoomPxPerSec);

                        return (
                          <div
                            key={clip.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedClipId(clip.id);
                              setSelectedTrackId(track.id);
                            }}
                            className={`absolute h-5 rounded px-2 flex items-center justify-between text-[10px] font-semibold cursor-pointer truncate border transition-all ${
                              cfg.color
                            } ${
                              isSelected
                                ? 'border-[#F06424] ring-1 ring-[#F06424] text-[#F3EEE8] shadow-md z-10'
                                : `${cfg.borderColor} text-[#F3EEE8]/90 hover:brightness-110`
                            }`}
                            style={{
                              left: `${leftPx}px`,
                              width: `${widthPx}px`,
                            }}
                            title={`${clip.name} (${clip.startTimeSec.toFixed(2)}s - ${(clip.startTimeSec + clip.durationSec).toFixed(2)}s)`}
                          >
                            <span className="truncate min-w-0">{clip.name}</span>
                            <span className="text-[9px] opacity-70 font-mono-tabular shrink-0 pl-1">
                              {clip.durationSec.toFixed(1)}s
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
    </div>
  );
};
