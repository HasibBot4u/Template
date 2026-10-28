import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ProjectLibraryItem,
  TargetMobileEditorId,
} from '../types/sowveil';
import { CanonicalProjectDocument } from '../types/canonicalProject';
import {
  AdapterFeatureLossReport,
  BrowserRenderCapabilities,
  cancelRenderExportJob,
  computeAdapterFeatureLossReport,
  createAndExecuteCanonicalRenderJob,
  createKnownGoodSampleCanonicalProject,
  detectBrowserRenderCapabilities,
  DurableRenderExportJobRecord,
  evaluateServerWorkerTransparency,
  getAllClipsFromProject,
  getMobileAdapterCapabilityManifests,
  MobileAdapterCapabilityManifest,
  RENDER_EXPORT_ENGINE_VERSION,
  renderCanonicalFrameSvg,
  RenderExecutionTier,
  RenderOutputFormat,
} from '../services/renderExportQaEngine';
import { auth } from '../services/firebaseClient';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Download,
  FileCheck2,
  Film,
  HardDrive,
  Layers,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sliders,
  Sparkles,
  XCircle,
} from 'lucide-react';

interface RenderExportQaWorkspaceProps {
  userUid: string;
  projects: ProjectLibraryItem[];
  onNotify: (
    message: string,
    tone?: 'info' | 'warning' | 'error' | 'success'
  ) => void;
}

const FORMAT_OPTIONS: Array<{
  format: RenderOutputFormat;
  label: string;
  ext: string;
  badge: string;
  defaultAdapter: TargetMobileEditorId;
  description: string;
}> = [
  {
    format: 'sowveil-bundle-zip',
    label: 'Sowveil Canonical Bundle',
    ext: '.sowveil.zip',
    badge: 'Verified',
    defaultAdapter: 'sowveil-project',
    description:
      'Complete canonical v2.0.0 project JSON + PNG/JPEG/SVG frames + WAV master & stems + SRT/VTT captions + QA report.',
  },
  {
    format: 'sowveil-json',
    label: 'Sowveil Canonical JSON',
    ext: '.sowveil.json',
    badge: 'Verified',
    defaultAdapter: 'sowveil-project',
    description: 'Lossless canonical v2.0.0 project graph document.',
  },
  {
    format: 'png-frame',
    label: 'PNG Raster Still Frame',
    ext: '.png',
    badge: 'Verified',
    defaultAdapter: 'universal-bundle',
    description: 'Validated RGBA PNG frame with IHDR/IDAT/IEND verification.',
  },
  {
    format: 'jpeg-frame',
    label: 'JPEG Baseline Still Frame',
    ext: '.jpg',
    badge: 'Verified',
    defaultAdapter: 'universal-bundle',
    description: 'Validated JFIF Baseline DCT JPEG frame with SOI/SOF0/EOI verification.',
  },
  {
    format: 'svg-vector',
    label: 'SVG Sanitized Vector Plate',
    ext: '.svg',
    badge: 'Verified',
    defaultAdapter: 'universal-bundle',
    description: 'Sanitized vector graphic frame plate from active canonical layers.',
  },
  {
    format: 'wav-audio',
    label: 'WAV 16-Bit PCM Master Audio',
    ext: '.wav',
    badge: 'Verified',
    defaultAdapter: 'universal-bundle',
    description: 'Validated RIFF/WAVE 16-bit PCM audio master with peak/clipping telemetry.',
  },
  {
    format: 'audio-stems-zip',
    label: 'Multi-Track Audio Stems Bundle',
    ext: '.stems.zip',
    badge: 'Verified',
    defaultAdapter: 'universal-bundle',
    description: 'Per-track 16-bit PCM WAV stems + master mix + STEMS_MANIFEST.json.',
  },
  {
    format: 'srt-captions',
    label: 'SubRip Timed Captions',
    ext: '.srt',
    badge: 'Verified',
    defaultAdapter: 'capcut',
    description: 'Validated .srt subtitle file extracted from canonical caption tracks.',
  },
  {
    format: 'vtt-captions',
    label: 'WebVTT Timed Captions',
    ext: '.vtt',
    badge: 'Verified',
    defaultAdapter: 'capcut',
    description: 'Validated .vtt subtitle track for web and mobile players.',
  },
  {
    format: 'alight-motion-xml',
    label: 'Alight Motion XML Project',
    ext: '.xml',
    badge: 'Tested subset',
    defaultAdapter: 'alight-motion',
    description:
      'Validated Alight Motion <scene> XML for tested 2D text/shape/bezier subset with Feature-Loss Report.',
  },
  {
    format: 'capcut-handoff-zip',
    label: 'CapCut Mobile Handoff ZIP',
    ext: '.capcut-handoff.zip',
    badge: 'Media handoff only',
    defaultAdapter: 'capcut',
    description:
      'Honest Media + SRT + Frame Timing Sheet handoff package for CapCut Mobile.',
  },
  {
    format: 'node-video-handoff-zip',
    label: 'Node Video Curve & Media ZIP',
    ext: '.nodevideo-handoff.zip',
    badge: 'Media handoff only',
    defaultAdapter: 'node-video',
    description:
      'Visual plates + WAV stems + cubic-bezier curve coordinate sheet for Node Video.',
  },
  {
    format: 'kinemaster-handoff-zip',
    label: 'KineMaster Media & Timing ZIP',
    ext: '.kinemaster-handoff.zip',
    badge: 'Media handoff only',
    defaultAdapter: 'kinemaster',
    description:
      'Honest KineMaster media + SRT + layer timing handoff archive (never renamed to fake .kine).',
  },
  {
    format: 'webm-video',
    label: 'WebM Video Container',
    ext: '.webm',
    badge: 'Needs setup',
    defaultAdapter: 'universal-bundle',
    description:
      'Requires configured server render worker or verified browser WebCodecs session.',
  },
  {
    format: 'mp4-video',
    label: 'MP4 (H.264 / AAC) Video',
    ext: '.mp4',
    badge: 'Needs setup',
    defaultAdapter: 'universal-bundle',
    description:
      'Requires configured server H.264 render worker; never fakes MP4 by renaming WebM/ZIP.',
  },
];

export const RenderExportQaWorkspace: React.FC<RenderExportQaWorkspaceProps> = ({
  userUid,
  projects,
  onNotify,
}) => {
  const sampleCanonicalProject = useMemo(
    () => createKnownGoodSampleCanonicalProject(userUid),
    [userUid]
  );

  const [selectedProjectId, setSelectedProjectId] = useState<string>('sample-canonical');
  const [executionTier, setExecutionTier] =
    useState<RenderExecutionTier>('final-render');
  const [outputFormat, setOutputFormat] =
    useState<RenderOutputFormat>('sowveil-bundle-zip');
  const [targetAdapter, setTargetAdapter] =
    useState<TargetMobileEditorId>('sowveil-project');
  const [sampleTimestampSec, setSampleTimestampSec] = useState<number>(1.5);
  const [downscaleAssetsForProxy, setDownscaleAssetsForProxy] =
    useState<boolean>(true);
  const [userApprovedDataUpload, setUserApprovedDataUpload] =
    useState<boolean>(false);

  const [jobs, setJobs] = useState<DurableRenderExportJobRecord[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const browserCaps: BrowserRenderCapabilities = useMemo(
    () => detectBrowserRenderCapabilities(),
    []
  );
  const adapterManifests: MobileAdapterCapabilityManifest[] = useMemo(
    () => getMobileAdapterCapabilityManifests(),
    []
  );

  const activeCanonicalProject: CanonicalProjectDocument = useMemo(() => {
    if (selectedProjectId !== 'sample-canonical') {
      const found = projects.find((p) => p.id === selectedProjectId);
      if (found?.canonicalProjectJson) {
        try {
          return JSON.parse(found.canonicalProjectJson) as CanonicalProjectDocument;
        } catch {
          // Fallback to sample project if JSON is invalid
        }
      }
    }
    return sampleCanonicalProject;
  }, [selectedProjectId, projects, sampleCanonicalProject]);

  const featureLossReport: AdapterFeatureLossReport = useMemo(
    () =>
      computeAdapterFeatureLossReport(activeCanonicalProject, targetAdapter),
    [activeCanonicalProject, targetAdapter]
  );

  const serverWorkerDisclosure = useMemo(
    () =>
      evaluateServerWorkerTransparency({
        executionTier,
        outputFormat,
        durationSec: activeCanonicalProject.canvas.durationSec || 6,
        projectClipsCount: getAllClipsFromProject(activeCanonicalProject).length,
        userApprovedDataUpload,
      }),
    [executionTier, outputFormat, activeCanonicalProject, userApprovedDataUpload]
  );

  const livePreviewSvg = useMemo(() => {
    const scale = executionTier === 'proxy-render' ? 0.5 : 1;
    const w = Math.round((activeCanonicalProject.canvas.width || 1080) * scale);
    const h = Math.round((activeCanonicalProject.canvas.height || 1920) * scale);
    return renderCanonicalFrameSvg(
      activeCanonicalProject,
      w,
      h,
      sampleTimestampSec
    );
  }, [activeCanonicalProject, executionTier, sampleTimestampSec]);

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    try {
      const current = auth?.currentUser;
      if (current) {
        const token = await current.getIdToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // Fallback to local execution if offline
    }
    return headers;
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/v1/render-export/jobs', { headers });
      if (res.ok) {
        const payload = await res.json();
        if (payload?.ok && Array.isArray(payload.data?.jobs)) {
          setJobs(payload.data.jobs);
          if (!selectedJobId && payload.data.jobs.length > 0) {
            setSelectedJobId(payload.data.jobs[0].id);
          }
          return;
        }
      }
    } catch {
      // Keep local jobs state
    }
  }, [getAuthHeaders, selectedJobId]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const handleRunRenderJob = async (overrideTier?: RenderExecutionTier) => {
    const tier = overrideTier || executionTier;
    setBusy(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/v1/render-export/jobs', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectDoc: activeCanonicalProject,
          executionTier: tier,
          outputFormat,
          targetAdapter,
          sampleTimestampSec,
          downscaleAssetsForProxy:
            tier === 'proxy-render' ? true : downscaleAssetsForProxy,
          userApprovedDataUpload,
        }),
      });

      if (res.ok) {
        const payload = await res.json();
        if (payload?.ok && payload.data?.job) {
          const createdJob: DurableRenderExportJobRecord = payload.data.job;
          setJobs((prev) => [
            createdJob,
            ...prev.filter((j) => j.id !== createdJob.id),
          ]);
          setSelectedJobId(createdJob.id);
          onNotify(
            createdJob.stage === 'ready'
              ? `Completed ${tier} (${outputFormat}) — 11-point QA: ${createdJob.qaReport?.checksPassedCount}/${createdJob.qaReport?.checksTotalCount} passed.`
              : `Job state: ${createdJob.stage} (${createdJob.sanitizedErrorMessage || 'See details'}).`,
            createdJob.stage === 'ready' ? 'success' : 'warning'
          );
          return;
        }
      }

      // Deterministic local fallback when running without live server auth token
      const localJob = createAndExecuteCanonicalRenderJob({
        ownerUid: userUid,
        projectDoc: activeCanonicalProject,
        executionTier: tier,
        outputFormat,
        targetAdapter,
        sampleTimestampSec,
        downscaleAssetsForProxy:
          tier === 'proxy-render' ? true : downscaleAssetsForProxy,
        userApprovedDataUpload,
      });
      setJobs((prev) => [localJob, ...prev]);
      setSelectedJobId(localJob.id);
      onNotify(
        localJob.stage === 'ready'
          ? `Completed ${tier} (${outputFormat}) — 11-point QA: ${localJob.qaReport?.checksPassedCount}/${localJob.qaReport?.checksTotalCount} passed.`
          : `Job state: ${localJob.stage} — ${localJob.sanitizedErrorMessage}`,
        localJob.stage === 'ready' ? 'success' : 'warning'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCancelJob = async (job: DurableRenderExportJobRecord) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/render-export/jobs/${job.id}/cancel`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: 'Cancelled by user in Render & QA Studio' }),
      });
      if (res.ok) {
        const payload = await res.json();
        if (payload?.ok && payload.data?.job) {
          setJobs((prev) =>
            prev.map((j) => (j.id === job.id ? payload.data.job : j))
          );
          onNotify(`Cancelled render job ${job.id}.`, 'info');
          return;
        }
      }
    } catch {
      // Fallback
    }
    const cancelled = cancelRenderExportJob(
      job,
      'Cancelled by user in Render & QA Studio'
    );
    setJobs((prev) => prev.map((j) => (j.id === job.id ? cancelled : j)));
    onNotify(`Cancelled render job ${job.id}.`, 'info');
  };

  const handleRetryJob = async (job: DurableRenderExportJobRecord) => {
    setBusy(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/render-export/jobs/${job.id}/retry`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectDoc: activeCanonicalProject,
          userApprovedDataUpload,
        }),
      });
      if (res.ok) {
        const payload = await res.json();
        if (payload?.ok && payload.data?.job) {
          setJobs((prev) =>
            prev.map((j) => (j.id === job.id ? payload.data.job : j))
          );
          onNotify(
            `Retried job ${job.id} (attempt #${payload.data.job.retryPolicy.attemptCount}).`,
            'success'
          );
          return;
        }
      }
      const retried = createAndExecuteCanonicalRenderJob({
        ownerUid: userUid,
        projectDoc: activeCanonicalProject,
        executionTier: job.executionTier,
        outputFormat: job.outputFormat,
        targetAdapter: job.targetAdapter,
        sampleTimestampSec: job.sampleTimestampSec,
        downscaleAssetsForProxy: job.downscaleAssetsForProxy,
        userApprovedDataUpload,
        existingJobToRetry: job,
      });
      setJobs((prev) => prev.map((j) => (j.id === job.id ? retried : j)));
      onNotify(
        `Retried job ${job.id} (attempt #${retried.retryPolicy.attemptCount}).`,
        'success'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadJobArtifact = async (job: DurableRenderExportJobRecord) => {
    if (job.stage !== 'ready' || !job.artifactMetadata) {
      onNotify(
        `Cannot download: job is in stage "${job.stage}".`,
        'warning'
      );
      return;
    }

    try {
      if (job.artifactBytesBase64) {
        const binaryString = window.atob(job.artifactBytesBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: job.artifactMetadata.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = job.artifactMetadata.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        onNotify(
          `Downloaded verified file "${job.artifactMetadata.fileName}" (${job.artifactMetadata.sizeBytes} bytes, SHA-256 ${job.artifactMetadata.sha256.slice(0, 10)}…).`,
          'success'
        );
        return;
      }

      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/render-export/jobs/${job.id}/download`, {
        headers,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = job.artifactMetadata.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onNotify(
        `Downloaded verified file "${job.artifactMetadata.fileName}" (${job.artifactMetadata.sizeBytes} bytes).`,
        'success'
      );
    } catch (err) {
      onNotify(
        `Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error'
      );
    }
  };

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) || jobs[0] || null,
    [jobs, selectedJobId]
  );

  const selectedAdapterManifest = useMemo(
    () =>
      adapterManifests.find((m) => m.adapterId === targetAdapter) ||
      adapterManifests[0],
    [adapterManifests, targetAdapter]
  );

  return (
    <div className="min-h-screen bg-[#080a0f] text-zinc-100 pb-20">
      {/* Top Header */}
      <div className="border-b border-zinc-800/80 bg-[#0b0e16]/90 backdrop-blur sticky top-0 z-20 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              to="/app/text-animation"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 hover:text-white hover:border-zinc-700"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Catalog
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-emerald-400" />
                <h1 className="text-sm font-semibold tracking-tight text-white">
                  Canonical Render, Export, Mobile Adapters & 11-Point QA Gate
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  v{RENDER_EXPORT_ENGINE_VERSION}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Real work-unit progress · Post-write binary/structural verification · Feature-Loss Reports · Process-restart safety
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/app/editor"
              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 hover:text-white"
            >
              Editing Studio
            </Link>
            <Link
              to="/app/template-factory"
              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 hover:text-white"
            >
              Template Factory
            </Link>
            <Link
              to="/app/ai-director"
              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 hover:text-white"
            >
              AI Director
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 pt-5 space-y-6">
        {/* Browser Capabilities & Mobile Low-RAM Guard Strip */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-zinc-800/80">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
              <span className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-sky-400" />
                Browser Capabilities
              </span>
              <span className="font-mono text-[10px] text-zinc-300">
                {browserCaps.environment}
              </span>
            </div>
            <div className="text-xs font-medium text-white">
              WebGL2: {browserCaps.webGl2Supported ? 'Ready' : 'No'} · Offscreen:{' '}
              {browserCaps.offscreenCanvasSupported ? 'Ready' : 'No'}
            </div>
            <div className="text-[11px] text-zinc-400 mt-1">
              WebCodecs: {browserCaps.webCodecsVideoEncoderSupported ? 'Yes' : 'No'} ·
              Recommended Preview: {browserCaps.recommendedMaxPreviewResolution}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-zinc-800/80">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
              <span className="flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                Mobile RAM / Proxy Guard
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  browserCaps.mobileLowRamGuardActive
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-emerald-500/15 text-emerald-300'
                }`}
              >
                {browserCaps.mobileLowRamGuardActive
                  ? 'Low-RAM Guard On'
                  : 'Standard'}
              </span>
            </div>
            <div className="text-xs font-medium text-white">
              Cores: {browserCaps.hardwareConcurrency} · RAM:{' '}
              {browserCaps.deviceMemoryGb ? `${browserCaps.deviceMemoryGb} GB` : 'Auto'}
            </div>
            <div className="text-[11px] text-zinc-400 mt-1">
              Proxy mode downscales resolution & assets by 50% for mobile safety.
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-zinc-800/80">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
              <span className="flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-violet-400" />
                Server Render Worker
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  serverWorkerDisclosure.status === 'local-eligible' ||
                  serverWorkerDisclosure.status === 'worker-ready'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-amber-500/20 text-amber-300'
                }`}
              >
                {serverWorkerDisclosure.status}
              </span>
            </div>
            <div className="text-xs font-medium text-white">
              {serverWorkerDisclosure.serverWorkerRequired
                ? `Est. Transfer: ${Math.round(
                    serverWorkerDisclosure.estimatedDataTransferBytes / 1024
                  )} KB ($${serverWorkerDisclosure.estimatedCostUsd})`
                : 'In-Process Deterministic Render ($0.00)'}
            </div>
            <div className="text-[11px] text-zinc-400 mt-1 line-clamp-2">
              {serverWorkerDisclosure.disclosureMessage}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-zinc-800/80">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Adapter Fidelity Score
              </span>
              <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-200">
                {featureLossReport.verificationStatus}
              </span>
            </div>
            <div className="text-xs font-medium text-white">
              {featureLossReport.fidelityRetentionScore}% Retention (
              {featureLossReport.supportedCount} supported,{' '}
              {featureLossReport.approximatedCount} approx,{' '}
              {featureLossReport.droppedCount} dropped)
            </div>
            <div className="text-[11px] text-zinc-400 mt-1">
              Target: {featureLossReport.adapterDisplayName}
            </div>
          </div>
        </div>

        {/* Main Configuration & Live Preview Row */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left 7 Cols: Render Configuration & Format Matrix */}
          <div className="lg:col-span-7 space-y-4">
            <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                  <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                  1. Source Project & Execution Mode Separation
                </h2>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200"
                >
                  <option value="sample-canonical">
                    {sampleCanonicalProject.title} (r{sampleCanonicalProject.revision})
                  </option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.aspectRatio})
                    </option>
                  ))}
                </select>
              </div>

              {/* Execution Tier Cards: Timeline Preview vs Proxy Render vs Final Render */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {(
                  [
                    {
                      tier: 'timeline-preview' as RenderExecutionTier,
                      title: 'Timeline Preview',
                      sub: 'Live interactive graph eval',
                      badge: 'Instant',
                    },
                    {
                      tier: 'proxy-render' as RenderExecutionTier,
                      title: 'Mobile Proxy Render',
                      sub: '540p @ 24fps + Asset Downscale',
                      badge: 'Low-RAM Safe',
                    },
                    {
                      tier: 'final-render' as RenderExecutionTier,
                      title: 'Final Master Render',
                      sub: '1080p @ 30/60fps + 11-Pt QA',
                      badge: 'Full Fidelity',
                    },
                  ] as const
                ).map((item) => {
                  const active = executionTier === item.tier;
                  return (
                    <button
                      key={item.tier}
                      type="button"
                      onClick={() => setExecutionTier(item.tier)}
                      className={`p-3 rounded-lg border text-left transition ${
                        active
                          ? 'bg-emerald-500/10 border-emerald-500/50 text-white'
                          : 'bg-zinc-950/60 border-zinc-800/80 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">{item.title}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                          {item.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-1">{item.sub}</p>
                    </button>
                  );
                })}
              </div>

              {/* Format Selector */}
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-2">
                  2. Universal Output Format & Container (Post-Write Validated)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                  {FORMAT_OPTIONS.map((opt) => {
                    const active = outputFormat === opt.format;
                    return (
                      <button
                        key={opt.format}
                        type="button"
                        onClick={() => {
                          setOutputFormat(opt.format);
                          setTargetAdapter(opt.defaultAdapter);
                        }}
                        className={`p-2.5 rounded-lg border text-left transition ${
                          active
                            ? 'bg-sky-500/10 border-sky-500/50 text-white'
                            : 'bg-zinc-950/70 border-zinc-800/80 text-zinc-300 hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-medium truncate">
                            {opt.label}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
                              opt.badge === 'Verified'
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : opt.badge === 'Tested subset'
                                ? 'bg-sky-500/15 text-sky-300'
                                : opt.badge === 'Media handoff only'
                                ? 'bg-amber-500/15 text-amber-300'
                                : 'bg-rose-500/15 text-rose-300'
                            }`}
                          >
                            {opt.badge}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
                          Extension: {opt.ext}
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2">
                          {opt.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Target Mobile Adapter Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    3. Target Mobile App Adapter
                  </label>
                  <select
                    value={targetAdapter}
                    onChange={(e) =>
                      setTargetAdapter(e.target.value as TargetMobileEditorId)
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200"
                  >
                    {adapterManifests.map((m) => (
                      <option key={m.adapterId} value={m.adapterId}>
                        {m.displayName} [{m.verificationStatus}]
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    Sample Timestamp ({sampleTimestampSec.toFixed(2)}s /{' '}
                    {activeCanonicalProject.canvas.durationSec}s)
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={activeCanonicalProject.canvas.durationSec || 6}
                    step={0.1}
                    value={sampleTimestampSec}
                    onChange={(e) => setSampleTimestampSec(Number(e.target.value))}
                    className="w-full accent-emerald-400"
                  />
                </div>
              </div>

              {/* Options & Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-800/80">
                <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-300">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={downscaleAssetsForProxy}
                      onChange={(e) =>
                        setDownscaleAssetsForProxy(e.target.checked)
                      }
                      className="rounded border-zinc-700"
                    />
                    Downscale assets in Proxy mode
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={userApprovedDataUpload}
                      onChange={(e) =>
                        setUserApprovedDataUpload(e.target.checked)
                      }
                      className="rounded border-zinc-700"
                    />
                    Approve worker data upload (if configured)
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRunRenderJob('proxy-render')}
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-100 inline-flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5 text-sky-400" />
                    Run Proxy (540p)
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRunRenderJob('final-render')}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Run Final Render & 11-Point QA
                  </button>
                </div>
              </div>
            </div>

            {/* Adapter Capability & Feature-Loss Report Card */}
            <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-sky-400" />
                  Mobile App Adapter Capability & Feature-Loss Report
                </h3>
                <span className="text-xs font-mono text-emerald-300">
                  {featureLossReport.fidelityRetentionScore}% Retention
                </span>
              </div>

              <p className="text-xs text-zinc-300">
                {selectedAdapterManifest.honestSummary}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800">
                  <div className="font-semibold text-emerald-300 mb-1">
                    Supported ({selectedAdapterManifest.supportedFeatures.length})
                  </div>
                  <ul className="space-y-1 text-zinc-400">
                    {selectedAdapterManifest.supportedFeatures.map((f, i) => (
                      <li key={i}>• {f}</li>
                    ))}
                  </ul>
                </div>
                <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800">
                  <div className="font-semibold text-amber-300 mb-1">
                    Approximated ({selectedAdapterManifest.approximatedFeatures.length})
                  </div>
                  <ul className="space-y-1 text-zinc-400">
                    {selectedAdapterManifest.approximatedFeatures.length === 0 ? (
                      <li>• None (lossless)</li>
                    ) : (
                      selectedAdapterManifest.approximatedFeatures.map((f, i) => (
                        <li key={i}>• {f}</li>
                      ))
                    )}
                  </ul>
                </div>
                <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800">
                  <div className="font-semibold text-rose-300 mb-1">
                    Unsupported ({selectedAdapterManifest.unsupportedFeatures.length})
                  </div>
                  <ul className="space-y-1 text-zinc-400">
                    {selectedAdapterManifest.unsupportedFeatures.length === 0 ? (
                      <li>• None</li>
                    ) : (
                      selectedAdapterManifest.unsupportedFeatures.map((f, i) => (
                        <li key={i}>• {f}</li>
                      ))
                    )}
                  </ul>
                </div>
              </div>

              {/* Per-clip feature loss rows */}
              <div className="space-y-1.5 pt-1">
                <div className="text-[11px] font-medium text-zinc-400">
                  Per-Clip Evaluation ({featureLossReport.items.length} item(s)):
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                  {featureLossReport.items.map((item, idx) => (
                    <div
                      key={`${item.clipId}-${idx}`}
                      className="flex items-center justify-between gap-2 p-2 rounded bg-zinc-950/70 border border-zinc-800/70 text-[11px]"
                    >
                      <div>
                        <span className="font-medium text-zinc-200">
                          {item.clipLabel}
                        </span>{' '}
                        <span className="text-zinc-400">· {item.featureName}</span>
                        <div className="text-zinc-500 text-[10px]">
                          {item.detail}
                        </div>
                      </div>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0 ${
                          item.handling === 'supported'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : item.handling === 'approximated'
                            ? 'bg-amber-500/15 text-amber-300'
                            : 'bg-rose-500/15 text-rose-300'
                        }`}
                      >
                        {item.handling}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right 5 Cols: Live Timeline Preview + Selected Job 11-Point QA Gate */}
          <div className="lg:col-span-5 space-y-4">
            <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                  Timeline Frame Evaluation Preview (t={sampleTimestampSec.toFixed(2)}s)
                </h2>
                <span className="text-[10px] font-mono text-zinc-400">
                  {executionTier === 'proxy-render' ? '540x960 Proxy' : '1080x1920 Master'}
                </span>
              </div>
              <div className="w-full h-56 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center overflow-hidden p-2">
                <img
                  src={`data:image/svg+xml;utf8,${encodeURIComponent(livePreviewSvg)}`}
                  alt="Canonical frame preview"
                  className="max-h-full max-w-full object-contain rounded"
                />
              </div>
            </div>

            {/* 11-Point Final QA Gate Inspector */}
            <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                  <FileCheck2 className="w-3.5 h-3.5 text-emerald-400" />
                  11-Point Final QA & Acceptance Gate
                </h3>
                {selectedJob?.qaReport && (
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                      selectedJob.qaReport.overallPassed
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    {selectedJob.qaReport.checksPassedCount}/
                    {selectedJob.qaReport.checksTotalCount} Passed
                  </span>
                )}
              </div>

              {!selectedJob ? (
                <div className="p-6 text-center text-xs text-zinc-500">
                  Run a Proxy or Final Render job to inspect its 11-point Final QA Report and checksums.
                </div>
              ) : !selectedJob.qaReport ? (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    Stage: {selectedJob.stage}
                  </div>
                  <p className="text-[11px] text-amber-100/90">
                    {selectedJob.sanitizedErrorMessage ||
                      'Final QA report runs only after real artifact bytes are written.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {Object.values(selectedJob.qaReport.checks).map((chk) => (
                    <div
                      key={chk.checkId}
                      className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800/80 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-zinc-200 flex items-center gap-1.5">
                          {chk.passed ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          )}
                          {chk.label}
                        </span>
                        <span className="font-mono text-[10px] text-zinc-400">
                          {chk.measuredValue}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-1">
                        {chk.detail}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Durable Render Job Queue & Stage History */}
        <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              Durable Render & Export Job Queue ({jobs.length})
            </h2>
            <button
              type="button"
              onClick={() => void loadJobs()}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-300 inline-flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>

          {jobs.length === 0 ? (
            <div className="p-6 text-center text-xs text-zinc-500">
              No render jobs queued yet. Select a format above and click &ldquo;Run Final Render & 11-Point QA&rdquo;.
            </div>
          ) : (
            <div className="space-y-2.5">
              {jobs.map((job) => {
                const isSelected = selectedJob?.id === job.id;
                return (
                  <div
                    key={job.id}
                    onClick={() => setSelectedJobId(job.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition ${
                      isSelected
                        ? 'bg-zinc-950 border-emerald-500/50'
                        : 'bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                            job.stage === 'ready'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : job.stage === 'needs-worker-setup' ||
                                job.stage === 'interrupted-recovered'
                              ? 'bg-amber-500/20 text-amber-300'
                              : job.stage === 'cancelled' || job.stage === 'failed'
                              ? 'bg-rose-500/15 text-rose-300'
                              : 'bg-sky-500/15 text-sky-300'
                          }`}
                        >
                          {job.stage}
                        </span>
                        <span className="text-xs font-semibold text-white">
                          {job.projectTitle} · {job.outputFormat} ({job.executionTier})
                        </span>
                        <span className="text-[11px] font-mono text-zinc-400">
                          {job.requestedWidth}x{job.requestedHeight} @ {job.requestedFps}fps
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-zinc-400">
                          Work Units: {job.completedWorkUnits}/{job.totalWorkUnits} (
                          {job.progressPercent}%) · Attempt #{job.retryPolicy.attemptCount}
                        </span>

                        {job.stage === 'ready' && job.artifactMetadata && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDownloadJobArtifact(job);
                            }}
                            className="px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-[11px] font-semibold inline-flex items-center gap-1"
                          >
                            <Download className="w-3 h-3" />
                            Download ({job.artifactMetadata.sizeBytes} B)
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleRetryJob(job);
                          }}
                          className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-200"
                        >
                          Retry
                        </button>

                        {job.stage !== 'cancelled' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleCancelJob(job);
                            }}
                            className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 hover:border-rose-500/40 text-[11px] text-rose-300"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>

                    {job.artifactMetadata && (
                      <div className="mt-2 pt-2 border-t border-zinc-800/70 flex flex-wrap items-center gap-4 text-[11px] font-mono text-zinc-400">
                        <span>File: {job.artifactMetadata.fileName}</span>
                        <span>Container: {job.artifactMetadata.container}</span>
                        <span>Codec: {job.artifactMetadata.codec}</span>
                        <span>
                          SHA-256: {job.artifactMetadata.sha256.slice(0, 16)}…
                        </span>
                        <span>CRC-32: {job.artifactMetadata.crc32Hex}</span>
                        <span>Revision: r{job.artifactMetadata.projectRevision}</span>
                      </div>
                    )}

                    {job.sanitizedErrorMessage && (
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-300">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                        <span>{job.sanitizedErrorMessage}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
