import { MobileAspectRatio } from '../../types/sowveil';
import { getDimensionsForAspectRatio } from '../../services/editorGateway';
import {
  CommandExecutionResult,
  SowveilTimelineProject,
  TimelineClip,
  TimelineCommand,
  TimelineTrack,
} from './types';

/**
 * Creates an initial clean multi-track Sowveil Timeline Project (v3.0.0-timeline)
 */
export function createEmptyTimelineProject(params: {
  id?: string;
  title: string;
  aspectRatio: MobileAspectRatio;
  fps?: 24 | 30 | 60;
  durationSec?: number;
}): SowveilTimelineProject {
  const { title, aspectRatio, fps = 60, durationSec = 15 } = params;
  const dims = getDimensionsForAspectRatio(aspectRatio);
  const now = new Date().toISOString();

  // Starter default multi-track layout
  const defaultTracks: TimelineTrack[] = [
    {
      id: 'track_captions',
      name: 'Captions Track',
      kind: 'captions',
      order: 0,
      muted: false,
      locked: false,
      solo: false,
      opacity: 1,
      blendMode: 'normal',
    },
    {
      id: 'track_text_overlay',
      name: 'Text & Typography',
      kind: 'text',
      order: 1,
      muted: false,
      locked: false,
      solo: false,
      opacity: 1,
      blendMode: 'normal',
    },
    {
      id: 'track_motion_graphics',
      name: 'Motion Graphics & Templates',
      kind: 'motion-graphic',
      order: 2,
      muted: false,
      locked: false,
      solo: false,
      opacity: 1,
      blendMode: 'normal',
    },
    {
      id: 'track_video_main',
      name: 'Main Video Plate',
      kind: 'video',
      order: 3,
      muted: false,
      locked: false,
      solo: false,
      opacity: 1,
      blendMode: 'normal',
    },
    {
      id: 'track_audio_sfx',
      name: 'SFX & Sound Design',
      kind: 'audio',
      order: 4,
      muted: false,
      locked: false,
      solo: false,
      opacity: 1,
      blendMode: 'normal',
    },
    {
      id: 'track_audio_voice',
      name: 'Voiceover & Narration',
      kind: 'audio',
      order: 5,
      muted: false,
      locked: false,
      solo: false,
      opacity: 1,
      blendMode: 'normal',
    },
  ];

  return {
    schemaVersion: '3.0.0-timeline',
    id: params.id || `proj_${Date.now()}`,
    title,
    aspectRatio,
    width: dims.width,
    height: dims.height,
    fps,
    durationSec,
    tracks: defaultTracks,
    clips: [],
    keyframes: [],
    captions: [],
    masterVolume: 1,
    undoStackSize: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Validates a timeline project for temporal coherence and track integrity.
 */
export function validateTimelineProject(project: SowveilTimelineProject): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (project.schemaVersion !== '3.0.0-timeline') {
    errors.push(`Unsupported schema version "${project.schemaVersion}". Expected "3.0.0-timeline".`);
  }
  if (!project.title || project.title.trim().length === 0) {
    errors.push('Timeline project must have a non-empty title.');
  }
  if (project.width <= 0 || project.height <= 0) {
    errors.push(`Invalid dimensions ${project.width}x${project.height}. Must be positive.`);
  }
  if (project.durationSec <= 0) {
    errors.push('Timeline project duration must be greater than 0.');
  }

  const trackIds = new Set(project.tracks.map((t) => t.id));
  for (const clip of project.clips) {
    if (!trackIds.has(clip.trackId)) {
      errors.push(`Clip "${clip.id}" references non-existent track "${clip.trackId}".`);
    }
    if (clip.startSec < 0) {
      errors.push(`Clip "${clip.id}" has negative start time ${clip.startSec}s.`);
    }
    if (clip.durationSec <= 0) {
      errors.push(`Clip "${clip.id}" has non-positive duration ${clip.durationSec}s.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Executes an auditable, reversible command on a Sowveil Timeline Project.
 */
export function applyTimelineCommand(
  project: SowveilTimelineProject,
  command: TimelineCommand
): CommandExecutionResult {
  const now = new Date().toISOString();
  // Deep clone project for rollback and history
  const next: SowveilTimelineProject = JSON.parse(JSON.stringify(project));

  try {
    switch (command.type) {
      case 'AddTrack': {
        if (next.tracks.some((t) => t.id === command.track.id)) {
          return {
            success: false,
            commandId: command.commandId,
            appliedAt: now,
            undoable: false,
            projectSnapshot: project,
            error: `Track "${command.track.id}" already exists.`,
          };
        }
        next.tracks.push(command.track);
        next.tracks.sort((a, b) => a.order - b.order);
        break;
      }

      case 'AddClip': {
        const trackExists = next.tracks.some((t) => t.id === command.clip.trackId);
        if (!trackExists) {
          return {
            success: false,
            commandId: command.commandId,
            appliedAt: now,
            undoable: false,
            projectSnapshot: project,
            error: `Track "${command.clip.trackId}" not found.`,
          };
        }
        next.clips.push(command.clip);
        break;
      }

      case 'TrimClip': {
        const clip = next.clips.find((c) => c.id === command.clipId);
        if (!clip) {
          return {
            success: false,
            commandId: command.commandId,
            appliedAt: now,
            undoable: false,
            projectSnapshot: project,
            error: `Clip "${command.clipId}" not found for trimming.`,
          };
        }
        clip.startSec = Math.max(0, command.newStartSec);
        clip.durationSec = Math.max(0.1, command.newDurationSec);
        clip.trimInSec = Math.max(0, command.newTrimInSec);
        clip.trimOutSec = Math.max(0, command.newTrimOutSec);
        break;
      }

      case 'MoveClip': {
        const clip = next.clips.find((c) => c.id === command.clipId);
        if (!clip) {
          return {
            success: false,
            commandId: command.commandId,
            appliedAt: now,
            undoable: false,
            projectSnapshot: project,
            error: `Clip "${command.clipId}" not found for moving.`,
          };
        }
        clip.trackId = command.targetTrackId;
        clip.startSec = Math.max(0, command.newStartSec);
        break;
      }

      case 'SetTransform': {
        const clip = next.clips.find((c) => c.id === command.clipId);
        if (!clip) {
          return {
            success: false,
            commandId: command.commandId,
            appliedAt: now,
            undoable: false,
            projectSnapshot: project,
            error: `Clip "${command.clipId}" not found for transform update.`,
          };
        }
        clip.transform = {
          ...clip.transform,
          ...command.transform,
        };
        break;
      }

      case 'AddKeyframe': {
        let kfTrack = next.keyframes.find(
          (k) => k.clipId === command.clipId && k.propertyPath === command.propertyPath
        );
        if (!kfTrack) {
          kfTrack = {
            id: `kf_${Date.now()}`,
            clipId: command.clipId,
            propertyPath: command.propertyPath,
            keys: [],
          };
          next.keyframes.push(kfTrack);
        }
        kfTrack.keys = kfTrack.keys.filter((k) => Math.abs(k.timeSec - command.keyframe.timeSec) > 0.001);
        kfTrack.keys.push(command.keyframe);
        kfTrack.keys.sort((a, b) => a.timeSec - b.timeSec);
        break;
      }

      case 'AddCaption': {
        next.captions = next.captions.filter((c) => c.id !== command.cue.id);
        next.captions.push(command.cue);
        next.captions.sort((a, b) => a.startSec - b.startSec);
        break;
      }

      default:
        return {
          success: false,
          commandId: (command as any).commandId,
          appliedAt: now,
          undoable: false,
          projectSnapshot: project,
          error: `Unsupported command type "${(command as any).type}".`,
        };
    }

    next.updatedAt = now;
    next.undoStackSize += 1;

    return {
      success: true,
      commandId: command.commandId,
      appliedAt: now,
      undoable: true,
      projectSnapshot: next,
    };
  } catch (err) {
    return {
      success: false,
      commandId: command.commandId,
      appliedAt: now,
      undoable: false,
      projectSnapshot: project,
      error: err instanceof Error ? err.message : 'Unknown command execution failure.',
    };
  }
}
