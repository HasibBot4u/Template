import { JobRecord, JobStatus } from '../types/sowveil';

export const VALID_JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  draft: ['queued', 'uploading', 'cancelled', 'needs-setup', 'quota-reached'],
  queued: [
    'uploading',
    'claimed',
    'running',
    'finalizing',
    'ready',
    'cancelled',
    'needs-setup',
    'quota-reached',
    'expired',
  ],
  uploading: ['running', 'finalizing', 'failed', 'cancelled', 'quota-reached', 'expired'],
  claimed: ['running', 'failed', 'cancelled', 'expired'],
  running: ['finalizing', 'ready', 'succeeded', 'failed', 'cancelled', 'needs-setup', 'expired'],
  finalizing: ['ready', 'succeeded', 'failed', 'cancelled', 'expired'],
  ready: ['downloaded', 'succeeded', 'cancelled'],
  downloaded: [], // Terminal state once downloaded/shared on mobile
  succeeded: [], // Terminal state — duplicate completion blocked
  failed: ['queued', 'draft'], // Safe retry creates new attempt
  cancelled: ['queued', 'draft'], // Safe retry
  'needs-setup': ['queued', 'draft', 'cancelled'],
  'quota-reached': ['queued', 'draft', 'cancelled'],
  expired: ['queued'],
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return VALID_JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionJobRecord(
  job: JobRecord,
  nextStatus: JobStatus,
  options?: {
    redactedMessage?: string;
    errorCode?: string;
    deviceId?: string | null;
    processedBytes?: number;
    totalBytes?: number;
    completedStageIndex?: number;
    totalStages?: number;
    stageLabel?: string;
    progressPercent?: number;
    nowIso?: string;
  }
): JobRecord {
  if (!canTransitionJob(job.status, nextStatus)) {
    throw new Error(
      `Invalid job state transition from "${job.status}" to "${nextStatus}" for job ${job.id}`
    );
  }

  const now = options?.nowIso || new Date().toISOString();
  const isRetry =
    nextStatus === 'queued' &&
    (job.status === 'failed' ||
      job.status === 'cancelled' ||
      job.status === 'needs-setup' ||
      job.status === 'quota-reached' ||
      job.status === 'expired');

  const processedBytes =
    options?.processedBytes !== undefined ? options.processedBytes : job.processedBytes;
  const totalBytes = options?.totalBytes !== undefined ? options.totalBytes : job.totalBytes;
  const completedStageIndex =
    options?.completedStageIndex !== undefined
      ? options.completedStageIndex
      : job.completedStageIndex;
  const totalStages =
    options?.totalStages !== undefined ? options.totalStages : job.totalStages;

  let computedProgress = options?.progressPercent ?? job.progressPercent;
  if (options?.progressPercent === undefined) {
    if (
      typeof processedBytes === 'number' &&
      typeof totalBytes === 'number' &&
      totalBytes > 0
    ) {
      computedProgress = Math.min(100, Math.max(0, Math.round((processedBytes / totalBytes) * 100)));
    } else if (
      typeof completedStageIndex === 'number' &&
      typeof totalStages === 'number' &&
      totalStages > 0
    ) {
      computedProgress = Math.min(
        100,
        Math.max(0, Math.round((completedStageIndex / totalStages) * 100))
      );
    } else if (
      nextStatus === 'ready' ||
      nextStatus === 'downloaded' ||
      nextStatus === 'succeeded'
    ) {
      computedProgress = 100;
    }
  }

  return {
    ...job,
    status: nextStatus,
    updatedAt: now,
    startedAt:
      nextStatus === 'running' || nextStatus === 'uploading'
        ? job.startedAt || now
        : job.startedAt,
    finishedAt:
      nextStatus === 'ready' ||
      nextStatus === 'downloaded' ||
      nextStatus === 'succeeded' ||
      nextStatus === 'failed' ||
      nextStatus === 'cancelled' ||
      nextStatus === 'expired'
        ? now
        : job.finishedAt,
    attemptCount: isRetry ? job.attemptCount + 1 : job.attemptCount,
    deviceId: options?.deviceId !== undefined ? options.deviceId : job.deviceId,
    errorCode: options?.errorCode !== undefined ? options.errorCode : job.errorCode,
    processedBytes,
    totalBytes,
    completedStageIndex,
    totalStages,
    stageLabel: options?.stageLabel !== undefined ? options.stageLabel : job.stageLabel,
    progressPercent: computedProgress,
    redactedMessage: options?.redactedMessage || job.redactedMessage,
  };
}


