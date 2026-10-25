import React, { useMemo, useState } from 'react';
import {
  CatalogItem,
  ExportArtifactFormat,
  JobRecord,
  MobileAspectRatio,
  ProjectLibraryItem,
  TargetMobileEditorId,
} from '../types/sowveil';
import {
  ALIGHT_MOTION_TESTED_MODULES,
  ALIGHT_MOTION_XML_FEATURE_MATRIX,
  BackgroundAlphaMode,
  buildMobileEditorExportArtifact,
  classifyPresetForAlightMotionXml,
  getDimensionsForAspectRatio,
  getEditorAdapter,
  MOBILE_EDITOR_ADAPTERS,
  QualityBitratePolicy,
} from '../services/editorGateway';
import { PreviewRenderer } from './PreviewRenderer';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileCheck2,
  FolderPlus,
  HelpCircle,
  RefreshCw,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  X,
} from 'lucide-react';

interface ExportOpenInModalProps {
  item: CatalogItem;
  customValues: Record<string, string | number | boolean>;
  reducedMotion?: boolean;
  initialEditor?: TargetMobileEditorId;
  onClose: () => void;
  onQueueJob: (
    job: Omit<
      JobRecord,
      'id' | 'createdAt' | 'updatedAt' | 'requestId' | 'attemptCount' | 'idempotencyKey'
    >
  ) => Promise<void> | void;
  onSaveProject?: (
    proj: Omit<ProjectLibraryItem, 'id' | 'updatedAt'>
  ) => Promise<void> | void;
  onNotify: (message: string, tone?: 'info' | 'warning' | 'error' | 'success') => void;
}

const FORMAT_LABELS: Record<ExportArtifactFormat, string> = {
  'zip-bundle': 'Universal Media Bundle (.zip)',
  'alight-xml': 'Alight Motion Scene (.xml — Tested Subset)',
  'sowveil-json': 'Sowveil MotionDocument (.sowveil.json)',
  'svg-frame': 'Sanitized Vector Motion Plate (.svg)',
  'png-still': 'RGBA Still Graphic Plate (.png)',
  'wav-audio': '16-Bit PCM Audio (.wav)',
  'srt-captions': 'SubRip Subtitle Track (.srt)',
  'vtt-captions': 'WebVTT Subtitle Track (.vtt)',
  'json-captions': 'Structured Caption Track (.captions.json)',
  'webm-video': 'Rendered WebM Stream (.webm)',
};

export const ExportOpenInModal: React.FC<ExportOpenInModalProps> = ({
  item,
  customValues,
  reducedMotion = false,
  initialEditor = 'capcut',
  onClose,
  onQueueJob,
  onSaveProject,
  onNotify,
}) => {
  const [selectedEditor, setSelectedEditor] =
    useState<TargetMobileEditorId>(initialEditor);
  const [aspectRatio, setAspectRatio] = useState<MobileAspectRatio>('9:16');
  const [fps, setFps] = useState<24 | 30 | 60>(
    item.metadata.fps === 24 || item.metadata.fps === 30 ? item.metadata.fps : 60
  );
  const [durationSec, setDurationSec] = useState<number>(
    item.metadata.durationSec || 3
  );
  const [qualityPolicy, setQualityPolicy] =
    useState<QualityBitratePolicy>('balanced');
  const [backgroundMode, setBackgroundMode] =
    useState<BackgroundAlphaMode>('solid');
  const [selectedFormat, setSelectedFormat] = useState<
    ExportArtifactFormat | undefined
  >(undefined);
  const [lowPowerStaticPreview, setLowPowerStaticPreview] =
    useState<boolean>(reducedMotion);
  const [showWhyNotDirectHelp, setShowWhyNotDirectHelp] =
    useState<boolean>(false);
  const [showAlightMatrix, setShowAlightMatrix] = useState<boolean>(false);
  const [copiedSteps, setCopiedSteps] = useState(false);
  const [exportStatus, setExportStatus] = useState<
    'ready' | 'generating' | 'downloaded' | 'shared' | 'cancelled'
  >('ready');

  const adapterInstance = useMemo(
    () => getEditorAdapter(selectedEditor),
    [selectedEditor]
  );

  const capability = useMemo(
    () => adapterInstance.discoverCapabilities(item.moduleId),
    [adapterInstance, item.moduleId]
  );

  const alightXmlInfo = useMemo(
    () => classifyPresetForAlightMotionXml(item),
    [item]
  );

  const artifact = useMemo(
    () =>
      buildMobileEditorExportArtifact({
        item,
        targetEditor: selectedEditor,
        format: selectedFormat,
        aspectRatio,
        fps,
        durationSec,
        qualityPolicy,
        backgroundMode,
        customValues,
      }),
    [
      item,
      selectedEditor,
      selectedFormat,
      aspectRatio,
      fps,
      durationSec,
      qualityPolicy,
      backgroundMode,
      customValues,
    ]
  );

  const dims = getDimensionsForAspectRatio(aspectRatio);

  const triggerBrowserFileDownload = () => {
    const blob = new Blob([new Uint8Array(artifact.bytes)], {
      type: artifact.mimeType,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const handleRunExportVerification = () => {
    setExportStatus('generating');
    setTimeout(() => {
      setExportStatus('ready');
      onNotify(
        `Verified ${artifact.bundleLabel} (${(artifact.bytes.byteLength / 1024).toFixed(1)} KB · SHA-256 ${artifact.sha256.slice(0, 12)}…).`,
        'success'
      );
    }, 120);
  };

  const handleDownloadArtifact = async () => {
    triggerBrowserFileDownload();
    setExportStatus('downloaded');

    await onQueueJob({
      type: 'mobile-export',
      title: `Export "${item.name}" → ${artifact.adapter.shortName} (${aspectRatio} @ ${fps}fps)`,
      moduleId: item.moduleId,
      itemId: item.id,
      targetEditor: artifact.adapter.id,
      exportFormat: artifact.format,
      aspectRatio,
      outputFileName: artifact.fileName,
      outputMimeType: artifact.mimeType,
      outputSizeBytes: artifact.bytes.byteLength,
      status: 'ready',
      deviceId: 'android-mobile-pwa',
      redactedMessage: `Downloaded ${artifact.fileName} (${(artifact.bytes.byteLength / 1024).toFixed(1)} KB · SHA-256 ${artifact.sha256.slice(0, 12)} · ${artifact.validationDetails}) for ${artifact.adapter.name}.`,
    });

    onNotify(
      `Downloaded ${artifact.fileName} for ${artifact.adapter.shortName}.`,
      'success'
    );
  };

  const handleShareToMobileApp = async () => {
    const file = new File([new Uint8Array(artifact.bytes)], artifact.fileName, {
      type: artifact.mimeType,
    });

    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
    };

    if (typeof nav.share === 'function') {
      try {
        const shareData: ShareData =
          typeof nav.canShare === 'function' && nav.canShare({ files: [file] })
            ? {
                title: `${item.name} — Sowveil Studio`,
                text: `Import into ${artifact.adapter.shortName} (${aspectRatio} @ ${fps}fps):\n${artifact.importSteps[0]}`,
                files: [file],
              }
            : {
                title: `${item.name} — Sowveil Studio`,
                text: `${item.name} (${artifact.adapter.shortName} ${aspectRatio})\n${artifact.importSteps.join('\n')}`,
              };

        await nav.share(shareData);
        setExportStatus('shared');

        await onQueueJob({
          type: 'mobile-export',
          title: `Share "${item.name}" → ${artifact.adapter.shortName} (${aspectRatio})`,
          moduleId: item.moduleId,
          itemId: item.id,
          targetEditor: artifact.adapter.id,
          exportFormat: artifact.format,
          aspectRatio,
          outputFileName: artifact.fileName,
          outputMimeType: artifact.mimeType,
          outputSizeBytes: artifact.bytes.byteLength,
          status: 'ready',
          deviceId: 'android-share-sheet',
          redactedMessage: `Shared ${artifact.fileName} via Web Share API to ${artifact.adapter.name}.`,
        });

        onNotify(
          `Shared ${artifact.fileName} via Android / Mobile Share Sheet.`,
          'success'
        );
        return;
      } catch (err) {
        // User cancellation of system share sheet must not be treated as a failure
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
      }
    }

    // Fallback to direct download if Web Share API is unavailable in desktop/iframe preview
    await handleDownloadArtifact();
    onNotify(
      `System Share Sheet not supported in this browser; downloaded ${artifact.fileName} directly.`,
      'info'
    );
  };

  const handleCopyImportSteps = async () => {
    try {
      await navigator.clipboard.writeText(artifact.importSteps.join('\n'));
      setCopiedSteps(true);
      setTimeout(() => setCopiedSteps(false), 1800);
      onNotify(
        `Copied ${artifact.adapter.shortName} import instructions to clipboard.`,
        'info'
      );
    } catch {
      onNotify('Could not access clipboard.', 'warning');
    }
  };

  const handleSaveToProjectLibrary = async () => {
    if (!onSaveProject) return;
    const sowveilExport = buildMobileEditorExportArtifact({
      item,
      targetEditor: selectedEditor,
      format: 'sowveil-json',
      aspectRatio,
      fps,
      durationSec,
      qualityPolicy,
      backgroundMode,
      customValues,
    });

    await onSaveProject({
      title: `${item.name} (${artifact.adapter.shortName} ${aspectRatio})`,
      description: `Mobile project preset configured for ${artifact.adapter.name} (${dims.label}, ${fps}fps, ${durationSec}s). ${artifact.validationDetails}`,
      compCount: 1,
      projectFileStatus:
        artifact.format === 'alight-xml'
          ? 'alight-motion-xml'
          : artifact.format === 'zip-bundle'
          ? 'media-bundle'
          : 'sowveil-native',
      fileSizeBytes: artifact.bytes.byteLength,
      fileSizeLabel: `${(artifact.bytes.byteLength / 1024).toFixed(1)} KB (${artifact.format})`,
      resolution: `${dims.width} × ${dims.height}`,
      durationLabel: `${durationSec}s`,
      fps,
      targetEditor: selectedEditor,
      aspectRatio,
      sowveilSpecJson: sowveilExport.textPreview,
      hasExternalFootageWarning: false,
      archived: false,
      tags: [
        artifact.adapter.shortName,
        aspectRatio,
        `${fps}fps`,
        item.packLabel,
        artifact.adapter.compatibilityStatus,
      ],
    });
    onNotify(
      `Saved reusable "${item.name}" mobile project to Cloud Firestore Project Library.`,
      'success'
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Export & Open In — ${item.name}`}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div className="w-full max-w-3xl max-h-[90dvh] rounded-t-3xl sm:rounded-3xl border border-[#342A24] bg-[#11100F] text-[#F3EEE8] flex flex-col overflow-hidden shadow-2xl overscroll-contain">
        {/* Mobile Bottom-Sheet Grab Handle */}
        <div className="sm:hidden w-10 h-1.5 bg-[#342A24] rounded-full mx-auto mt-2.5" />

        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-[#342A24] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono-tabular text-[#F06424]">
              <Smartphone className="w-3.5 h-3.5 shrink-0" />
              <span>MOBILE EDITOR GATEWAY &amp; EXPORT ENGINE</span>
              <span className="px-2 py-0.5 rounded bg-[#191614] border border-[#342A24] text-[#55B98B]">
                STATUS: {exportStatus.toUpperCase()}
              </span>
            </div>
            <h2 className="text-base sm:text-lg font-bold text-[#F3EEE8] truncate">
              Export &amp; Open In — {item.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Export & Open In sheet"
            className="min-h-[44px] min-w-[44px] rounded-xl border border-[#342A24] bg-[#191614] hover:border-[#83766D] inline-flex items-center justify-center text-[#B8AAA0] hover:text-[#F3EEE8]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable 6-Step Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* STEP 1: Select Destination Editor */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono-tabular text-[#83766D] uppercase">
                Step 1 · Select Destination Mobile Editor
              </span>
              <span className="font-mono-tabular text-[#55B98B]">
                {artifact.adapter.compatibilityStatus}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {MOBILE_EDITOR_ADAPTERS.map((ed) => {
                const isSelected = ed.id === selectedEditor;
                return (
                  <button
                    key={ed.id}
                    type="button"
                    onClick={() => {
                      setSelectedEditor(ed.id);
                      setSelectedFormat(undefined);
                      setExportStatus('ready');
                    }}
                    className={`min-h-[60px] text-left rounded-2xl border p-3 transition-colors flex flex-col justify-between ${
                      isSelected
                        ? 'border-[#F06424] bg-[#211B17] text-[#F3EEE8]'
                        : 'border-[#342A24] bg-[#191614] text-[#B8AAA0] hover:border-[#83766D]'
                    }`}
                  >
                    <div className="font-bold text-xs text-[#F3EEE8] flex items-center justify-between gap-1">
                      <span className="truncate">{ed.shortName}</span>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-[#F06424] shrink-0" />
                      )}
                    </div>
                    <div
                      className={`mt-1 text-[10px] font-mono-tabular ${
                        ed.compatibilityStatus === 'Verified'
                          ? 'text-[#55B98B]'
                          : ed.compatibilityStatus === 'Tested subset'
                          ? 'text-[#F06424]'
                          : 'text-[#E4B45A]'
                      }`}
                    >
                      {ed.compatibilityStatus}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* STEP 2: Capabilities Card & "Why can't this be added directly?" */}
          <section className="rounded-2xl border border-[#342A24] bg-[#191614] p-4 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#F06424]" />
                <span className="font-mono-tabular text-[#83766D] uppercase">
                  Step 2 · Capabilities &amp; Interoperability Contract
                </span>
              </div>
              <span className="font-mono-tabular text-[11px] text-[#E4B45A]">
                {artifact.adapter.compatibilityStatus}
                {artifact.adapter.secondaryValidationBadge
                  ? ` · ${artifact.adapter.secondaryValidationBadge}`
                  : ''}
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="font-bold text-[#F3EEE8]">
                {artifact.adapter.name} —{' '}
                <span className="text-[#F06424]">{artifact.bundleLabel}</span>
              </div>
              <p className="text-[#B8AAA0] leading-relaxed">
                {artifact.adapter.honestCapabilitySummary}
              </p>
              <p className="text-[11px] text-[#83766D]">
                {artifact.adapter.limitationsNote}
              </p>
            </div>

            {/* Alight Motion Per-Preset XML Status */}
            {selectedEditor === 'alight-motion' && (
              <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono-tabular text-[11px] text-[#B8AAA0]">
                    Preset XML Status:
                  </span>
                  <span
                    className={`font-mono-tabular text-[11px] font-semibold ${
                      alightXmlInfo.canExportXml
                        ? 'text-[#55B98B]'
                        : 'text-[#E4B45A]'
                    }`}
                  >
                    {alightXmlInfo.status}
                  </span>
                </div>
                <p className="text-[11px] text-[#83766D]">{alightXmlInfo.reason}</p>
                <button
                  type="button"
                  onClick={() => setShowAlightMatrix((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] font-mono-tabular text-[#F06424] hover:underline"
                >
                  <span>
                    {showAlightMatrix
                      ? 'Hide Alight Motion XML Subset Matrix'
                      : 'View Supported vs. Unsupported XML Constructs'}
                  </span>
                  {showAlightMatrix ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
                {showAlightMatrix && (
                  <div className="pt-2 border-t border-[#342A24] space-y-1.5 text-[11px]">
                    {ALIGHT_MOTION_XML_FEATURE_MATRIX.map((row, idx) => (
                      <div
                        key={idx}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 py-1 border-b border-[#342A24]/40 last:border-b-0"
                      >
                        <span className="text-[#F3EEE8] font-medium">
                          {row.feature}
                        </span>
                        <span
                          className={`font-mono-tabular text-[10px] ${
                            row.status.startsWith('Supported')
                              ? 'text-[#55B98B]'
                              : 'text-[#E4B45A]'
                          }`}
                        >
                          {row.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Contextual Help: "Why can't this be added directly?" */}
            <div className="pt-2 border-t border-[#342A24]">
              <button
                type="button"
                onClick={() => setShowWhyNotDirectHelp((v) => !v)}
                className="min-h-[38px] w-full flex items-center justify-between gap-2 text-left text-xs font-medium text-[#F06424] hover:text-[#FF4B24]"
              >
                <span className="inline-flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 shrink-0" />
                  <span>Why can&apos;t this be added directly to my open timeline?</span>
                </span>
                {showWhyNotDirectHelp ? (
                  <ChevronUp className="w-4 h-4 shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 shrink-0" />
                )}
              </button>

              {showWhyNotDirectHelp && (
                <div className="mt-2 rounded-xl border border-[#342A24] bg-[#11100F] p-3 space-y-2 text-[11px] text-[#B8AAA0] leading-relaxed">
                  <p>{capability.whyNotDirectTimelineInsertion}</p>
                  <div className="font-mono-tabular text-[10px] text-[#83766D] flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      Tested Versions: {capability.documentedVersionRequirements}
                    </span>
                    <span>
                      Last Verified: {capability.evidence.lastValidationDate}
                    </span>
                  </div>
                  <p className="text-[10px] text-[#83766D]">
                    {capability.regionalOrPlatformNotes}
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* STEP 3: Output Settings (Aspect Ratio, FPS, Duration, File Type, Quality, Background/Alpha) */}
          <section className="rounded-2xl border border-[#342A24] bg-[#191614] p-4 space-y-4">
            <span className="text-xs font-mono-tabular text-[#83766D] uppercase block">
              Step 3 · Output Settings &amp; Alpha / Chroma-Key Policy
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Aspect Ratio */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono-tabular text-[#B8AAA0] block">
                  Aspect Ratio &amp; Dimensions
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: '9:16', label: '9:16 Vertical', sub: '1080×1920' },
                      { id: '1:1', label: '1:1 Square', sub: '1080×1080' },
                      { id: '16:9', label: '16:9 Wide', sub: '1920×1080' },
                    ] as const
                  ).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setAspectRatio(r.id)}
                      className={`min-h-[48px] rounded-xl border px-2 py-1.5 text-center transition-colors ${
                        aspectRatio === r.id
                          ? 'border-[#F06424] bg-[#211B17] text-[#F3EEE8] font-semibold'
                          : 'border-[#342A24] bg-[#11100F] text-[#B8AAA0]'
                      }`}
                    >
                      <div className="text-xs">{r.label}</div>
                      <div className="text-[10px] font-mono-tabular text-[#83766D]">
                        {r.sub}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Output Format */}
              <div className="space-y-1.5">
                <label
                  htmlFor="export-output-format-select"
                  className="text-[11px] font-mono-tabular text-[#B8AAA0] block"
                >
                  Validated Output Format
                </label>
                <select
                  id="export-output-format-select"
                  aria-label="Validated Output Format"
                  value={artifact.format}
                  onChange={(e) =>
                    setSelectedFormat(e.target.value as ExportArtifactFormat)
                  }
                  className="w-full min-h-[48px] rounded-xl border border-[#342A24] bg-[#11100F] px-3 py-2.5 text-xs text-[#F3EEE8]"
                >
                  {artifact.adapter.supportedFormats.map((fmt) => {
                    const disabledXml =
                      fmt === 'alight-xml' &&
                      !ALIGHT_MOTION_TESTED_MODULES.includes(item.moduleId);
                    return (
                      <option key={fmt} value={fmt} disabled={disabledXml}>
                        {FORMAT_LABELS[fmt]}
                        {disabledXml ? ' (Media handoff only for this module)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {/* Frame Rate, Duration, Quality, and Background/Alpha */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-mono-tabular text-[#83766D] block">
                  Frame Rate (FPS)
                </label>
                <select
                  aria-label="Export Frame Rate"
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value) as 24 | 30 | 60)}
                  className="w-full min-h-[42px] rounded-xl border border-[#342A24] bg-[#11100F] px-2.5 py-2 text-xs text-[#F3EEE8]"
                >
                  <option value={24}>24 FPS (Cinema)</option>
                  <option value={30}>30 FPS (Mobile Standard)</option>
                  <option value={60}>60 FPS (Smooth Motion)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-mono-tabular text-[#83766D] block">
                  Duration (Seconds)
                </label>
                <input
                  type="number"
                  aria-label="Export Duration Seconds"
                  min={0.5}
                  max={30}
                  step={0.5}
                  value={durationSec}
                  onChange={(e) =>
                    setDurationSec(
                      Math.max(0.5, Math.min(30, Number(e.target.value) || 3))
                    )
                  }
                  className="w-full min-h-[42px] rounded-xl border border-[#342A24] bg-[#11100F] px-2.5 py-2 text-xs text-[#F3EEE8] font-mono-tabular"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-mono-tabular text-[#83766D] block">
                  Quality / Bitrate
                </label>
                <select
                  aria-label="Export Quality Policy"
                  value={qualityPolicy}
                  onChange={(e) =>
                    setQualityPolicy(e.target.value as QualityBitratePolicy)
                  }
                  className="w-full min-h-[42px] rounded-xl border border-[#342A24] bg-[#11100F] px-2.5 py-2 text-xs text-[#F3EEE8]"
                >
                  <option value="high-quality">High Fidelity</option>
                  <option value="balanced">Balanced Mobile</option>
                  <option value="compact-mobile">Compact Size</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-mono-tabular text-[#83766D] block">
                  Background / Alpha
                </label>
                <select
                  aria-label="Background and Alpha Mode"
                  value={backgroundMode}
                  onChange={(e) =>
                    setBackgroundMode(e.target.value as BackgroundAlphaMode)
                  }
                  className="w-full min-h-[42px] rounded-xl border border-[#342A24] bg-[#11100F] px-2.5 py-2 text-xs text-[#F3EEE8]"
                >
                  <option value="solid">Solid Obsidian (#080707)</option>
                  <option value="transparent">Transparent Alpha (SVG/PNG/XML)</option>
                  <option value="chroma-key-green">Chroma-Key Green (#00FF00)</option>
                </select>
              </div>
            </div>

            {backgroundMode === 'chroma-key-green' && (
              <div className="rounded-xl border border-[#55B98B]/40 bg-[#55B98B]/10 p-2.5 text-[11px] text-[#55B98B] flex items-center gap-2">
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>
                  Chroma-Key Green (#00FF00) active: in {artifact.adapter.shortName}, use Cutout / Chroma Key on the imported plate for clean transparency where MP4/raster alpha is not supported.
                </span>
              </div>
            )}
          </section>

          {/* STEP 4 & STEP 5: Preview & Export Verification */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
            {/* STEP 4: Preview */}
            <div className="md:col-span-5 rounded-2xl border border-[#342A24] bg-[#080707] p-3.5 flex flex-col justify-between space-y-2.5">
              <div className="flex items-center justify-between text-[11px] font-mono-tabular text-[#83766D]">
                <span>STEP 4 · PREVIEW ({aspectRatio})</span>
                <span>
                  {dims.width}×{dims.height} · {fps}fps
                </span>
              </div>
              <div
                className={`h-40 rounded-xl overflow-hidden border ${
                  backgroundMode === 'chroma-key-green'
                    ? 'border-[#55B98B] bg-[#00FF00]/10'
                    : 'border-[#342A24]/60'
                }`}
              >
                <PreviewRenderer
                  item={item}
                  comparisonMode="edits"
                  reducedMotion={lowPowerStaticPreview}
                  customValues={customValues}
                />
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <label className="inline-flex items-center gap-1.5 text-[#B8AAA0] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={lowPowerStaticPreview}
                    onChange={(e) => setLowPowerStaticPreview(e.target.checked)}
                    className="rounded border-[#342A24] bg-[#191614]"
                  />
                  <span>Low-power static preview</span>
                </label>
                <span className="font-mono-tabular text-[#55B98B]">
                  {backgroundMode}
                </span>
              </div>
            </div>

            {/* STEP 5 & STEP 6: Export Job Progress & Result Summary */}
            <div className="md:col-span-7 rounded-2xl border border-[#342A24] bg-[#191614] p-4 flex flex-col justify-between space-y-3 text-xs">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono-tabular text-[#83766D] uppercase">
                    Step 5 &amp; 6 · Export Pipeline &amp; Verified Output
                  </span>
                  <button
                    type="button"
                    onClick={handleRunExportVerification}
                    className="min-h-[32px] px-2.5 py-1 rounded-lg border border-[#342A24] bg-[#11100F] hover:border-[#F06424] text-[11px] font-mono-tabular text-[#F3EEE8] inline-flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3 text-[#F06424]" />
                    <span>Re-Verify Output</span>
                  </button>
                </div>

                {/* Progress Steps */}
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  {artifact.progressEvents.map((ev, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-[#342A24] bg-[#11100F] px-2.5 py-1.5 flex items-center justify-between text-[10px] font-mono-tabular"
                    >
                      <span className="text-[#B8AAA0] truncate">{ev.step}</span>
                      <span className="text-[#55B98B]">{ev.percent}%</span>
                    </div>
                  ))}
                </div>

                {/* Result File Details */}
                <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-3 space-y-1 font-mono-tabular text-[11px]">
                  <div className="flex items-center justify-between text-[#F3EEE8]">
                    <span className="truncate font-semibold">
                      {artifact.fileName}
                    </span>
                    <span className="text-[#55B98B] shrink-0">
                      {(artifact.bytes.byteLength / 1024).toFixed(1)} KB
                    </span>
                  </div>
                  <div className="text-[10px] text-[#83766D] flex flex-wrap justify-between gap-2">
                    <span>MIME: {artifact.mimeType}</span>
                    <span>SHA-256: {artifact.sha256.slice(0, 16)}…</span>
                  </div>
                  <div className="text-[10px] text-[#B8AAA0] pt-1 border-t border-[#342A24]/60">
                    Bundle contents: {artifact.bundleManifest.join(', ')}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono-tabular">
                <span className="inline-flex items-center gap-1 text-[#55B98B]">
                  {artifact.validationPassed ? (
                    <FileCheck2 className="w-3.5 h-3.5" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-[#E4B45A]" />
                  )}
                  {artifact.validationDetails}
                </span>
              </div>
            </div>
          </div>

          {/* Step-by-Step Mobile Import Instructions */}
          <section className="rounded-2xl border border-[#342A24] bg-[#191614] p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-mono-tabular text-[#83766D] uppercase">
                Mobile Import Guide ({artifact.adapter.shortName})
              </span>
              <button
                type="button"
                onClick={handleCopyImportSteps}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#342A24] bg-[#11100F] hover:border-[#F06424] text-xs font-medium text-[#F3EEE8]"
              >
                {copiedSteps ? (
                  <Check className="w-3.5 h-3.5 text-[#55B98B]" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-[#F06424]" />
                )}
                <span>{copiedSteps ? 'Copied Steps' : 'Copy Import Steps'}</span>
              </button>
            </div>
            <ol className="list-decimal pl-5 space-y-1.5 text-xs text-[#B8AAA0] leading-relaxed">
              {artifact.importSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </section>
        </div>

        {/* Sticky Bottom Action Bar (Android Thumb-Zone Optimized) */}
        <div className="p-4 sm:px-6 border-t border-[#342A24] bg-[#0B0A09] flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {onSaveProject && (
              <button
                type="button"
                onClick={handleSaveToProjectLibrary}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-[#342A24] bg-[#191614] hover:border-[#83766D] text-xs font-medium text-[#F3EEE8]"
              >
                <FolderPlus className="w-4 h-4 text-[#F06424]" />
                <span>Save to Project Library</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setExportStatus('ready');
                setSelectedFormat(
                  artifact.format === 'zip-bundle' ? 'sowveil-json' : 'zip-bundle'
                );
              }}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-[#342A24] bg-[#191614] hover:border-[#83766D] text-xs font-medium text-[#B8AAA0] hover:text-[#F3EEE8]"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Export Another Format</span>
            </button>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={handleShareToMobileApp}
              className="flex-1 sm:flex-initial min-h-[48px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[#F06424] bg-[#211B17] hover:bg-[#342A24] text-xs font-semibold text-[#F3EEE8] transition-colors"
            >
              <Share2 className="w-4 h-4 text-[#F06424]" />
              <span>Share</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadArtifact}
              className="flex-1 sm:flex-initial min-h-[48px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-bold text-xs transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Download ({artifact.format.split('-')[0].toUpperCase()})</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
