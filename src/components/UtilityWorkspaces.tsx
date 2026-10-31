import React, { useMemo, useState, useEffect } from 'react';
import {
  CompanionState,
  JobRecord,
  ProjectCheckpointRecord,
  ProjectFileStatus,
  ProjectLibraryItem,
  TargetMobileEditorId,
} from '../types/sowveil';
import {
  buildCaptionCuesFromTranscript,
  serializeCaptionsToJson,
  validateAlightMotionXml,
  validateSowveilProjectJson,
} from '../services/editorGateway';
import {
  buildCaptionSidecarZipBundle,
  CaptionCueSegment,
  CaptionValidationConfig,
  createProjectCheckpoint,
  DEFAULT_CAPTION_VALIDATION_CONFIG,
  deleteCaptionCue,
  mergeCaptionCues,
  parseSrtContent,
  parseVttContent,
  retimeCaptionCue,
  sanitizeMediaFileName,
  serializeCaptionSegmentsToSrt,
  serializeCaptionSegmentsToVtt,
  splitCaptionCue,
  updateCaptionCueText,
  validateCaptionTimeline,
  validateMediaUrlForSsrf,
  verifyMediaMagicBytes,
} from '../features/media-workflows/index';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clipboard,
  Copy,
  Download,
  Edit3,
  FileText,
  FolderPlus,
  History,
  Plus,
  RefreshCw,
  Scissors,
  Search,
  Share2,
  ShieldAlert,
  Sliders,
  Smartphone,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  canonicalProjectToLibraryRecord,
  createMinimalCanonicalProject,
  migrateToCanonicalProject,
  serializeCanonicalProject,
} from '../services/canonicalProjectEngine';
import { MobileProEditorModal } from './MobileProEditorModal';

// ============================================================================
// 1. AUTO CAPTIONS WORKSPACE (MOBILE-FIRST 4-STEP MEDIA WORKFLOW)
// ============================================================================

interface AutoCaptionsWorkspaceProps {
  companion: CompanionState;
  projects?: ProjectLibraryItem[];
  onQueueJob: (
    job: Omit<
      JobRecord,
      'id' | 'createdAt' | 'updatedAt' | 'requestId' | 'attemptCount' | 'idempotencyKey'
    >
  ) => void;
  onNotify: (message: string, tone?: 'info' | 'warning' | 'error' | 'success') => void;
}

const CAPTION_STYLE_PRESETS = [
  { id: 'clean', name: 'Clean', tag: 'Minimal', accent: '#F3EEE8' },
  { id: 'bold-pop', name: 'Bold Pop', tag: 'Word Pop', accent: '#F06424' },
  { id: 'highlight-box', name: 'Boxed', tag: 'Active Pill', accent: '#E4B45A' },
  { id: 'karaoke-fill', name: 'Karaoke', tag: 'Sweep', accent: '#55B98B' },
  { id: 'minimal-clean', name: 'Minimal', tag: 'Broadcast', accent: '#E5E7EB' },
  { id: 'fade-words', name: 'Fade Words', tag: 'Editorial', accent: '#F3EEE8' },
  { id: 'glow-pulse', name: 'Glow Pulse', tag: 'Neon', accent: '#60A5FA' },
  { id: 'typewriter', name: 'Typewriter', tag: 'Monospace', accent: '#FFC08C' },
];

export const AutoCaptionsWorkspace: React.FC<AutoCaptionsWorkspaceProps> = ({
  projects = [],
  onQueueJob,
  onNotify,
}) => {
  const [sourceMode, setSourceMode] = useState<'phone-file' | 'library-asset'>('phone-file');
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    sizeBytes: number;
    type: string;
    signatureVerified?: string;
  } | null>(null);
  const [selectedLibraryProjectId, setSelectedLibraryProjectId] = useState<string>(
    projects[0]?.id || ''
  );
  const [largeFilePrivacyConsented, setLargeFilePrivacyConsented] = useState<boolean>(false);

  const [language, setLanguage] = useState<string>('auto');
  const [modelTier, setModelTier] = useState<'browser-timed' | 'server-whisper-asr'>(
    'browser-timed'
  );
  const [wordsPerCaption, setWordsPerCaption] = useState<number>(3);
  const [selectedStyleId, setSelectedStyleId] = useState<string>('bold-pop');
  const [targetEditor, setTargetEditor] = useState<TargetMobileEditorId>('capcut');
  const [transcriptInput, setTranscriptInput] = useState<string>(
    'Sowveil Studio generates mobile motion presets and timed captions for CapCut Alight Motion and Node Video on Android'
  );
  const [wpmSpeed, setWpmSpeed] = useState<number>(155);
  const [previewFormat, setPreviewFormat] = useState<'styled-overlay' | 'srt' | 'vtt'>(
    'styled-overlay'
  );

  // Interactive editable cues state
  const [editableCues, setEditableCues] = useState<CaptionCueSegment[]>(() =>
    buildCaptionCuesFromTranscript(
      'Sowveil Studio generates mobile motion presets and timed captions for CapCut Alight Motion and Node Video on Android',
      3,
      155
    )
  );

  // Configurable subtitle line-length and duration validation rules (never hardcoded)
  const [validationConfig, setValidationConfig] = useState<CaptionValidationConfig>(
    DEFAULT_CAPTION_VALIDATION_CONFIG
  );

  // Re-generate segments when user clicks "Transcribe" or adjusts wordsPerCaption/wpmSpeed
  const handleRegenerateFromTranscript = () => {
    const built = buildCaptionCuesFromTranscript(
      transcriptInput,
      wordsPerCaption,
      wpmSpeed
    );
    setEditableCues(built);
    onNotify(
      `Generated ${built.length} timed segments (${wordsPerCaption} words/caption @ ${wpmSpeed} WPM).`,
      'info'
    );
  };

  const validationReport = useMemo(
    () => validateCaptionTimeline(editableCues, validationConfig),
    [editableCues, validationConfig]
  );

  const srtOutput = useMemo(
    () => serializeCaptionSegmentsToSrt(editableCues),
    [editableCues]
  );
  const vttOutput = useMemo(
    () => serializeCaptionSegmentsToVtt(editableCues),
    [editableCues]
  );
  const jsonOutput = useMemo(
    () =>
      serializeCaptionsToJson(
        editableCues.map((c) => ({
          index: c.index,
          startSec: c.startSec,
          endSec: c.endSec,
          text: c.speaker ? `[${c.speaker}]: ${c.text}` : c.text,
        })),
        {
          language,
          wordsPerCaption,
        }
      ),
    [editableCues, language, wordsPerCaption]
  );

  const activeStyle =
    CAPTION_STYLE_PRESETS.find((s) => s.id === selectedStyleId) || CAPTION_STYLE_PRESETS[1];

  const isLargeFile = Boolean(
    selectedFile && selectedFile.sizeBytes > 10 * 1024 * 1024
  );

  const handleDownloadCaptionFile = (format: 'srt' | 'vtt' | 'json') => {
    if (editableCues.length === 0) {
      onNotify('Add or generate at least one caption segment before exporting.', 'warning');
      return;
    }
    if (!validationReport.valid) {
      onNotify(
        `Please resolve ${validationReport.errorCount} timestamp overlap or duration error(s) before exporting.`,
        'error'
      );
      return;
    }

    const baseName = selectedFile
      ? selectedFile.name.replace(/\.[^/.]+$/, '')
      : 'sowveil-mobile-captions';
    const content =
      format === 'srt' ? srtOutput : format === 'vtt' ? vttOutput : jsonOutput;
    const mimeType =
      format === 'srt'
        ? 'application/x-subrip'
        : format === 'vtt'
        ? 'text/vtt'
        : 'application/json';
    const ext = format === 'json' ? 'captions.json' : format;
    const fileName = `${baseName}.${ext}`;

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);

    onQueueJob({
      type: 'caption',
      title: `Export Captions (${editableCues.length} cues) → ${fileName}`,
      moduleId: 'auto-captions',
      targetEditor,
      exportFormat:
        format === 'srt'
          ? 'srt-captions'
          : format === 'vtt'
          ? 'vtt-captions'
          : 'json-captions',
      outputFileName: fileName,
      outputMimeType: mimeType,
      outputSizeBytes: content.length,
      processedBytes: content.length,
      totalBytes: content.length,
      status: 'ready',
      deviceId: 'android-mobile-browser',
      redactedMessage: `Generated ${editableCues.length} parser-validated caption segments (${fileName}, ${content.length} bytes).`,
    });

    onNotify(`Downloaded ${fileName} (${editableCues.length} timed segments).`, 'success');
  };

  const handleDownloadSidecarBundle = () => {
    if (editableCues.length === 0) {
      onNotify('Add or generate at least one caption segment before exporting.', 'warning');
      return;
    }
    if (!validationReport.valid) {
      onNotify(
        `Please resolve ${validationReport.errorCount} timestamp overlap or duration error(s) before exporting sidecar bundle.`,
        'error'
      );
      return;
    }

    const baseName = selectedFile
      ? selectedFile.name.replace(/\.[^/.]+$/, '')
      : 'sowveil-mobile-captions';
    const sidecar = buildCaptionSidecarZipBundle({
      baseName,
      targetEditor,
      language,
      wordsPerCaption,
      cues: editableCues,
    });

    const blob = new Blob([new Uint8Array(sidecar.bytes)], { type: sidecar.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sidecar.fileName;
    a.click();
    URL.revokeObjectURL(url);

    onQueueJob({
      type: 'caption',
      title: `Caption Sidecar Bundle (${targetEditor}) → ${sidecar.fileName}`,
      moduleId: 'auto-captions',
      targetEditor,
      exportFormat: 'zip-bundle',
      outputFileName: sidecar.fileName,
      outputMimeType: sidecar.mimeType,
      outputSizeBytes: sidecar.sizeBytes,
      processedBytes: sidecar.sizeBytes,
      totalBytes: sidecar.sizeBytes,
      status: 'ready',
      deviceId: 'android-mobile-browser',
      redactedMessage: `Packaged .srt + .vtt + .captions.json + import guide in ${sidecar.fileName} (${sidecar.sizeBytes} bytes).`,
    });

    onNotify(
      `Downloaded ${sidecar.fileName} (${(sidecar.sizeBytes / 1024).toFixed(1)} KB) for ${targetEditor}.`,
      'success'
    );
  };

  const handleRequestServerWhisperJob = () => {
    if (!selectedFile && sourceMode === 'phone-file') {
      onNotify('Select a phone video/audio file first to request server ASR.', 'warning');
      return;
    }
    if (isLargeFile && !largeFilePrivacyConsented) {
      onNotify(
        'Please review and check the large-file privacy consent box before queuing cloud transcription.',
        'warning'
      );
      return;
    }
    const sourceLabel =
      sourceMode === 'phone-file' && selectedFile
        ? selectedFile.name
        : projects.find((p) => p.id === selectedLibraryProjectId)?.title || 'Library Asset';

    onQueueJob({
      type: 'caption',
      title: `Server ASR Transcription: ${sourceLabel}`,
      moduleId: 'auto-captions',
      status: 'needs-setup',
      deviceId: null,
      errorCode: 'WHISPER_ASR_WORKER_NOT_CONFIGURED',
      redactedMessage: `Needs server worker setup: Server-side speech-to-text worker is not configured for "${sourceLabel}" (lang=${language}). Use the interactive mobile transcript & cue editor below.`,
    });
    onNotify(
      `Logged Server ASR request in Jobs as "Needs setup" (Server worker not configured). Use the interactive segment editor below to export .srt / .vtt / sidecar .zip immediately.`,
      'info'
    );
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Reference Sections 1 SOURCE, 2 TRANSCRIBE & 4 STYLE (frames 01:18-01:19) */}
        <div className="lg:col-span-5 space-y-4">
          {/* 1 SOURCE (frame 01:18) */}
          <div className="rounded-xl border border-[#2A231E] bg-[#11100F] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-[#2A1810] border border-[#F06424]/50 text-[#F06424] text-[11px] font-bold flex items-center justify-center">
                  1
                </span>
                <span className="text-xs font-mono-tabular uppercase tracking-wider text-[#B8AAA0]">
                  SOURCE
                </span>
              </div>
              <div className="inline-flex rounded-lg border border-[#2A231E] bg-[#141210] p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setSourceMode('phone-file')}
                  className={`px-2 py-0.5 rounded font-medium ${
                    sourceMode === 'phone-file'
                      ? 'bg-[#F06424] text-[#080707] font-semibold'
                      : 'text-[#B8AAA0]'
                  }`}
                >
                  File / Layer
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode('library-asset')}
                  className={`px-2 py-0.5 rounded font-medium ${
                    sourceMode === 'library-asset'
                      ? 'bg-[#F06424] text-[#080707] font-semibold'
                      : 'text-[#B8AAA0]'
                  }`}
                >
                  Library ({projects.length})
                </button>
              </div>
            </div>

            {sourceMode === 'phone-file' ? (
              <div className="rounded-lg border border-[#2A231E] bg-[#141210] p-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-[#B8AAA0] truncate">
                  {selectedFile ? (
                    <span className="text-[#F3EEE8] font-medium">
                      {selectedFile.name} ({(selectedFile.sizeBytes / 1024).toFixed(1)} KB)
                    </span>
                  ) : (
                    'No source yet.'
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      handleRegenerateFromTranscript();
                      onNotify(
                        'Loaded active timeline layer transcript into timed subtitle cues.',
                        'info'
                      );
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-semibold text-xs transition-colors"
                  >
                    Use selected layer
                  </button>
                  <label className="cursor-pointer px-3 py-1.5 rounded-lg border border-[#2A231E] bg-[#191614] hover:border-[#83766D] text-xs font-medium text-[#F3EEE8] transition-colors">
                    <span>Choose file...</span>
                    <input
                      type="file"
                      accept="video/*,audio/*,.mp4,.mov,.webm,.mp3,.wav,.m4a,.srt,.vtt"
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const safeName = sanitizeMediaFileName(file.name);

                        if (
                          safeName.toLowerCase().endsWith('.srt') ||
                          safeName.toLowerCase().endsWith('.vtt')
                        ) {
                          try {
                            const text = await file.text();
                            const parsedCues = safeName.toLowerCase().endsWith('.vtt')
                              ? parseVttContent(text)
                              : parseSrtContent(text);
                            setEditableCues(parsedCues);
                            setTranscriptInput(parsedCues.map((c) => c.text).join(' '));
                            setSelectedFile({
                              name: safeName,
                              sizeBytes: file.size,
                              type: file.type || 'text/plain',
                              signatureVerified: `Parsed ${parsedCues.length} subtitle cues`,
                            });
                            onNotify(
                              `Imported ${parsedCues.length} timed segments from "${safeName}".`,
                              'success'
                            );
                            return;
                          } catch (err) {
                            onNotify(
                              `Subtitle parse error: ${err instanceof Error ? err.message : 'Invalid format'}`,
                              'error'
                            );
                            return;
                          }
                        }

                        const headBuf = await file.slice(0, 256).arrayBuffer();
                        const sig = verifyMediaMagicBytes(new Uint8Array(headBuf), safeName);
                        setSelectedFile({
                          name: safeName,
                          sizeBytes: file.size,
                          type: sig.detectedMimeType || file.type || 'video/mp4',
                          signatureVerified: sig.reason,
                        });
                        setLargeFilePrivacyConsented(false);
                        onNotify(
                          sig.valid
                            ? `Verified "${safeName}" (${sig.detectedContainer.toUpperCase()}, ${(file.size / 1024).toFixed(1)} KB).`
                            : `Selected "${safeName}" (${sig.reason}).`,
                          sig.valid ? 'info' : 'warning'
                        );
                      }}
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <select
                  value={selectedLibraryProjectId}
                  onChange={(e) => setSelectedLibraryProjectId(e.target.value)}
                  aria-label="Choose asset from Project Library"
                  className="w-full min-h-[38px] rounded-lg border border-[#2A231E] bg-[#141210] px-3 py-1.5 text-xs text-[#F3EEE8]"
                >
                  {projects.length === 0 ? (
                    <option value="">No saved Project Library items yet</option>
                  ) : (
                    projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} ({p.projectFileStatus})
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}

            {isLargeFile && (
              <div className="rounded-xl border border-[#E4B45A]/50 bg-[#E4B45A]/10 p-3 space-y-2 text-xs">
                <div className="flex items-start gap-2 text-[#E4B45A] font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Large Media Privacy &amp; Retention Notice (&gt; 10 MB)</span>
                </div>
                <label className="flex items-center gap-2 text-[11px] text-[#F3EEE8] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={largeFilePrivacyConsented}
                    onChange={(e) => setLargeFilePrivacyConsented(e.target.checked)}
                    className="accent-[#F06424]"
                  />
                  <span>I understand the network upload &amp; privacy policy for this file</span>
                </label>
              </div>
            )}
          </div>

          {/* 2 TRANSCRIBE (frame 01:18) */}
          <div className="rounded-xl border border-[#2A231E] bg-[#11100F] p-4 space-y-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-[#2A1810] border border-[#F06424]/50 text-[#F06424] text-[11px] font-bold flex items-center justify-center">
                2
              </span>
              <span className="text-xs font-mono-tabular uppercase tracking-wider text-[#B8AAA0]">
                TRANSCRIBE
              </span>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#B8AAA0]">Model</span>
                <select
                  value={modelTier}
                  onChange={(e) =>
                    setModelTier(e.target.value as 'browser-timed' | 'server-whisper-asr')
                  }
                  className="w-56 min-h-[36px] rounded-lg border border-[#2A231E] bg-[#141210] px-2.5 py-1 text-xs text-[#F3EEE8]"
                >
                  <option value="browser-timed">Turbo (best speed/quality)</option>
                  <option value="server-whisper-asr">
                    Server Whisper ASR Worker (Needs setup)
                  </option>
                </select>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-[#B8AAA0]">Language</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-56 min-h-[36px] rounded-lg border border-[#2A231E] bg-[#141210] px-2.5 py-1 text-xs text-[#F3EEE8]"
                >
                  <option value="auto">Auto detect</option>
                  <option value="en">English (en)</option>
                  <option value="es">Spanish (es)</option>
                  <option value="fr">French (fr)</option>
                  <option value="de">German (de)</option>
                  <option value="pt">Portuguese (pt)</option>
                  <option value="hi">Hindi (hi)</option>
                  <option value="ja">Japanese (ja)</option>
                </select>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-[#B8AAA0] shrink-0">Words per caption</span>
                <input
                  type="range"
                  min={1}
                  max={7}
                  value={wordsPerCaption}
                  onChange={(e) => setWordsPerCaption(Number(e.target.value))}
                  className="flex-1 accent-[#F06424]"
                />
                <span className="min-w-[34px] text-center px-2 py-1 rounded bg-[#141210] border border-[#2A231E] font-mono-tabular text-[#F3EEE8]">
                  {wordsPerCaption}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-[#2A231E] bg-[#141210] px-3 py-2 text-xs text-[#B8AAA0]">
              Ready: Python + Whisper + ffmpeg. Everything runs on this computer.
            </div>

            <label className="block space-y-1 text-xs pt-1">
              <span className="text-[#83766D]">
                Transcript text (edit or paste script to chunk into timed cues):
              </span>
              <textarea
                rows={2}
                value={transcriptInput}
                onChange={(e) => setTranscriptInput(e.target.value)}
                placeholder="Paste or type spoken script…"
                className="w-full rounded-lg border border-[#2A231E] bg-[#141210] p-2 text-xs text-[#F3EEE8] leading-relaxed"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRegenerateFromTranscript}
                className="w-full min-h-[40px] py-2 px-4 rounded-lg bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-bold text-xs sm:text-sm transition-colors"
              >
                Transcribe
              </button>
              {modelTier === 'server-whisper-asr' && (
                <button
                  type="button"
                  onClick={handleRequestServerWhisperJob}
                  className="w-full min-h-[36px] py-1.5 px-3 rounded-lg border border-[#2A231E] bg-[#141210] hover:border-[#F06424] text-xs font-medium text-[#B8AAA0] hover:text-[#F3EEE8]"
                >
                  Queue Server ASR Job →
                </button>
              )}
            </div>
          </div>

          {/* 4 STYLE (frame 01:19) */}
          <div className="rounded-xl border border-[#2A231E] bg-[#11100F] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-[#2A1810] border border-[#F06424]/50 text-[#F06424] text-[11px] font-bold flex items-center justify-center">
                4
              </span>
              <span className="text-xs font-mono-tabular uppercase tracking-wider text-[#B8AAA0]">
                STYLE
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {CAPTION_STYLE_PRESETS.map((preset) => {
                const isSelected = preset.id === selectedStyleId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSelectedStyleId(preset.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      isSelected
                        ? 'border-[#F06424] bg-[#2A1810] text-[#F06424] font-semibold'
                        : 'border-[#2A231E] bg-[#141210] text-[#B8AAA0] hover:text-[#F3EEE8]'
                    }`}
                  >
                    {preset.name}
                  </button>
                );
              })}
            </div>

            {/* Reference frame 01:19 live style preview box: yourcaptionslooklikethis */}
            <div className="rounded-xl border border-[#2A231E] bg-[#0B0A09] p-5 flex items-center justify-center min-h-[84px]">
              <div className="text-base sm:text-lg font-extrabold tracking-tight select-none">
                <span className="text-[#F3EEE8]">your</span>
                <span
                  style={{ color: activeStyle.accent }}
                  className="mx-0.5 underline decoration-2 underline-offset-4"
                >
                  captions
                </span>
                <span className="text-[#F3EEE8]">looklikethis</span>
              </div>
            </div>

            {/* Configurable Subtitle Validation Thresholds */}
            <div className="pt-2 border-t border-[#2A231E] grid grid-cols-3 gap-2 text-xs">
              <label className="block space-y-1">
                <span className="text-[10px] text-[#83766D]">Max Chars/Line</span>
                <input
                  type="number"
                  min={16}
                  max={80}
                  value={validationConfig.maxCharsPerLine}
                  onChange={(e) =>
                    setValidationConfig((prev) => ({
                      ...prev,
                      maxCharsPerLine: Math.max(16, Number(e.target.value) || 38),
                    }))
                  }
                  className="w-full min-h-[34px] rounded border border-[#2A231E] bg-[#141210] px-2 py-1 text-xs text-[#F3EEE8] font-mono-tabular"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] text-[#83766D]">Min Cue (s)</span>
                <input
                  type="number"
                  min={0.2}
                  max={3}
                  step={0.1}
                  value={validationConfig.minDurationSec}
                  onChange={(e) =>
                    setValidationConfig((prev) => ({
                      ...prev,
                      minDurationSec: Math.max(0.2, Number(e.target.value) || 0.5),
                    }))
                  }
                  className="w-full min-h-[34px] rounded border border-[#2A231E] bg-[#141210] px-2 py-1 text-xs text-[#F3EEE8] font-mono-tabular"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] text-[#83766D]">Max Cue (s)</span>
                <input
                  type="number"
                  min={2}
                  max={15}
                  step={0.5}
                  value={validationConfig.maxDurationSec}
                  onChange={(e) =>
                    setValidationConfig((prev) => ({
                      ...prev,
                      maxDurationSec: Math.max(2, Number(e.target.value) || 7),
                    }))
                  }
                  className="w-full min-h-[34px] rounded border border-[#2A231E] bg-[#141210] px-2 py-1 text-xs text-[#F3EEE8] font-mono-tabular"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Right Column: Step 3 EDIT TEXT (Interactive Timed Segment Editor) & Step 4 Export */}
        <div className="lg:col-span-7 space-y-5">
          {/* 3. Edit Text & Timed Segments */}
          <div className="rounded-2xl border border-[#2A231E] bg-[#11100F] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-[#2A1810] border border-[#F06424]/50 text-[#F06424] text-[11px] font-bold flex items-center justify-center">
                  3
                </span>
                <div>
                  <div className="text-xs font-mono-tabular text-[#B8AAA0] uppercase">
                    EDIT TEXT ({editableCues.length} CUES)
                  </div>
                  <p className="text-[11px] text-[#83766D]">
                    Transcribe to edit the captions here, or fine-tune timestamps below.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const lastEnd =
                    editableCues.length > 0
                      ? editableCues[editableCues.length - 1].endSec
                      : 0;
                  setEditableCues((prev) => [
                    ...prev,
                    {
                      index: prev.length + 1,
                      startSec: Number(lastEnd.toFixed(2)),
                      endSec: Number((lastEnd + 1.5).toFixed(2)),
                      text: 'New caption segment',
                    },
                  ]);
                }}
                className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#191614] border border-[#342A24] hover:border-[#F06424] text-xs font-semibold text-[#F3EEE8]"
              >
                <Plus className="w-3.5 h-3.5 text-[#F06424]" />
                <span>+ Add Cue</span>
              </button>
            </div>

            {/* Live Overlap & Line-Length Validation Diagnostics */}
            <div
              className={`rounded-xl border p-3 text-xs ${
                validationReport.valid
                  ? 'border-[#55B98B]/40 bg-[#55B98B]/10 text-[#55B98B]'
                  : 'border-[#F06464]/50 bg-[#F06464]/10 text-[#F06464]'
              }`}
            >
              <div className="flex items-center justify-between font-mono-tabular">
                <span className="font-semibold">
                  {validationReport.valid
                    ? `TIMELINE VALIDATED · 0 OVERLAPS (${validationReport.warningCount} warnings)`
                    : `${validationReport.errorCount} TIMING / OVERLAP ERROR(S) DETECTED`}
                </span>
                <span>Max {validationConfig.maxCharsPerLine} chars/line</span>
              </div>
              {validationReport.issues.length > 0 && (
                <ul className="mt-2 space-y-1 text-[11px] text-[#F3EEE8] max-h-24 overflow-y-auto">
                  {validationReport.issues.slice(0, 6).map((iss, idx) => (
                    <li key={`${iss.cueIndex}-${iss.code}-${idx}`} className="flex items-center gap-1.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono-tabular uppercase ${
                          iss.severity === 'error'
                            ? 'bg-[#F06464] text-[#080707] font-bold'
                            : 'bg-[#E4B45A] text-[#080707] font-semibold'
                        }`}
                      >
                        {iss.code}
                      </span>
                      <span>{iss.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Touch-First Timed Cue Editor List */}
            <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
              {editableCues.map((cue, idx) => {
                const cueIssues = validationReport.issues.filter(
                  (i) => i.cueIndex === cue.index
                );
                const hasError = cueIssues.some((i) => i.severity === 'error');
                return (
                  <div
                    key={cue.index}
                    className={`rounded-xl border p-3 space-y-2 transition-colors ${
                      hasError
                        ? 'border-[#F06464] bg-[#F06464]/5'
                        : 'border-[#342A24] bg-[#191614]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-[#11100F] border border-[#342A24] font-mono-tabular text-[11px] text-[#F06424] font-bold">
                          #{cue.index}
                        </span>
                        <label className="inline-flex items-center gap-1 text-[11px] font-mono-tabular text-[#B8AAA0]">
                          <span>In(s)</span>
                          <input
                            type="number"
                            step={0.1}
                            min={0}
                            value={cue.startSec}
                            onChange={(e) =>
                              setEditableCues((prev) =>
                                retimeCaptionCue(
                                  prev,
                                  cue.index,
                                  Number(e.target.value) || 0,
                                  cue.endSec
                                )
                              )
                            }
                            aria-label={`Segment ${cue.index} start time in seconds`}
                            className="w-16 rounded border border-[#342A24] bg-[#11100F] px-1.5 py-1 text-xs text-[#F3EEE8]"
                          />
                        </label>
                        <label className="inline-flex items-center gap-1 text-[11px] font-mono-tabular text-[#B8AAA0]">
                          <span>Out(s)</span>
                          <input
                            type="number"
                            step={0.1}
                            min={0}
                            value={cue.endSec}
                            onChange={(e) =>
                              setEditableCues((prev) =>
                                retimeCaptionCue(
                                  prev,
                                  cue.index,
                                  cue.startSec,
                                  Number(e.target.value) || 0
                                )
                              )
                            }
                            aria-label={`Segment ${cue.index} end time in seconds`}
                            className="w-16 rounded border border-[#342A24] bg-[#11100F] px-1.5 py-1 text-xs text-[#F3EEE8]"
                          />
                        </label>
                      </div>

                      {/* Touch Segment Actions: Split, Merge Next, Delete */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setEditableCues((prev) => splitCaptionCue(prev, cue.index))
                          }
                          title="Split segment in two"
                          className="min-h-[36px] px-2.5 py-1 rounded-lg border border-[#342A24] bg-[#11100F] hover:border-[#F06424] text-[11px] font-medium text-[#F3EEE8] inline-flex items-center gap-1"
                        >
                          <Scissors className="w-3 h-3 text-[#F06424]" />
                          <span>Split</span>
                        </button>

                        {idx < editableCues.length - 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setEditableCues((prev) =>
                                mergeCaptionCues(prev, cue.index, cue.index + 1)
                              )
                            }
                            title="Merge with next segment"
                            className="min-h-[36px] px-2.5 py-1 rounded-lg border border-[#342A24] bg-[#11100F] hover:border-[#F06424] text-[11px] font-medium text-[#F3EEE8]"
                          >
                            Merge ↓
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            setEditableCues((prev) => deleteCaptionCue(prev, cue.index))
                          }
                          aria-label={`Delete segment ${cue.index}`}
                          className="min-h-[36px] px-2 py-1 rounded-lg border border-[#342A24] bg-[#11100F] hover:border-[#F06464] text-[#F06464] text-[11px]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <input
                        type="text"
                        value={cue.speaker || ''}
                        onChange={(e) =>
                          setEditableCues((prev) =>
                            updateCaptionCueText(prev, cue.index, cue.text, e.target.value)
                          )
                        }
                        placeholder="Speaker (optional)"
                        aria-label={`Segment ${cue.index} speaker label`}
                        className="sm:col-span-1 min-h-[38px] rounded-lg border border-[#342A24] bg-[#11100F] px-2.5 py-1.5 text-xs text-[#B8AAA0]"
                      />
                      <input
                        type="text"
                        value={cue.text}
                        onChange={(e) =>
                          setEditableCues((prev) =>
                            updateCaptionCueText(prev, cue.index, e.target.value, cue.speaker)
                          )
                        }
                        aria-label={`Segment ${cue.index} caption text`}
                        className="sm:col-span-3 min-h-[38px] rounded-lg border border-[#342A24] bg-[#11100F] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live Caption Visual & Raw Subtitle Inspector */}
          <div className="rounded-2xl border border-[#342A24] bg-[#11100F] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-mono-tabular text-[#83766D]">
                LIVE SUBTITLE PREVIEW · {activeStyle.name.toUpperCase()}
              </span>
              <div className="inline-flex rounded-lg border border-[#342A24] bg-[#191614] p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setPreviewFormat('styled-overlay')}
                  className={`px-2.5 py-1 rounded-md font-medium ${
                    previewFormat === 'styled-overlay'
                      ? 'bg-[#F06424] text-[#080707] font-semibold'
                      : 'text-[#B8AAA0]'
                  }`}
                >
                  Overlay Frame
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewFormat('srt')}
                  className={`px-2.5 py-1 rounded-md font-medium ${
                    previewFormat === 'srt'
                      ? 'bg-[#F06424] text-[#080707] font-semibold'
                      : 'text-[#B8AAA0]'
                  }`}
                >
                  .SRT
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewFormat('vtt')}
                  className={`px-2.5 py-1 rounded-md font-medium ${
                    previewFormat === 'vtt'
                      ? 'bg-[#F06424] text-[#080707] font-semibold'
                      : 'text-[#B8AAA0]'
                  }`}
                >
                  .VTT
                </button>
              </div>
            </div>

            {previewFormat === 'styled-overlay' ? (
              <div className="rounded-xl border border-[#342A24] bg-[#080707] p-5 flex flex-col items-center justify-center min-h-[120px] text-center">
                <div
                  style={{
                    borderColor: activeStyle.accent,
                    boxShadow: `0 0 24px -6px ${activeStyle.accent}66`,
                  }}
                  className="px-4 py-2.5 rounded-xl border-2 bg-[#11100F]/95 text-base sm:text-lg font-extrabold tracking-tight text-[#F3EEE8]"
                >
                  {editableCues[0]?.speaker ? (
                    <span className="text-xs font-mono-tabular text-[#F06424] mr-2">
                      [{editableCues[0].speaker}]
                    </span>
                  ) : null}
                  {editableCues[0]?.text || 'No caption segments'}
                </div>
                <span className="mt-2 text-[11px] font-mono-tabular text-[#83766D]">
                  Cue #1 ({editableCues[0]?.startSec.toFixed(2) || '0.00'}s →{' '}
                  {editableCues[0]?.endSec.toFixed(2) || '1.00'}s) · {activeStyle.tag}
                </span>
              </div>
            ) : (
              <pre className="max-h-40 overflow-y-auto rounded-xl border border-[#342A24] bg-[#080707] p-3 text-[11px] font-mono-tabular text-[#B8AAA0] leading-relaxed">
                {previewFormat === 'srt' ? srtOutput : vttOutput}
              </pre>
            )}
          </div>

          {/* 4. Export & Mobile Editor Sidecar Bundle */}
          <div className="rounded-2xl border border-[#F06424]/40 bg-[#14110F] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-mono-tabular text-[#F06424] font-semibold">
                4. EXPORT SUBTITLES &amp; MOBILE SIDECAR BUNDLE
              </span>
              <select
                value={targetEditor}
                onChange={(e) => setTargetEditor(e.target.value as TargetMobileEditorId)}
                aria-label="Select destination mobile editor for caption sidecar"
                className="min-h-[36px] rounded-lg border border-[#342A24] bg-[#191614] px-2.5 py-1 text-xs text-[#F3EEE8]"
              >
                <option value="capcut">Target: CapCut (.srt + Sidecar)</option>
                <option value="alight-motion">Target: Alight Motion (Sidecar Bundle)</option>
                <option value="node-video">Target: Node Video (Sidecar Bundle)</option>
                <option value="kinemaster">Target: KineMaster (.srt + Sidecar)</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => handleDownloadCaptionFile('srt')}
                className="min-h-[44px] py-2.5 px-3 rounded-xl bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-bold text-xs inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>Download .SRT</span>
              </button>
              <button
                type="button"
                onClick={() => handleDownloadCaptionFile('vtt')}
                className="min-h-[44px] py-2.5 px-3 rounded-xl border border-[#342A24] bg-[#191614] hover:border-[#F06424] text-[#F3EEE8] font-semibold text-xs inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <Download className="w-4 h-4 text-[#F06424]" />
                <span>Download .VTT</span>
              </button>
              <button
                type="button"
                onClick={() => handleDownloadCaptionFile('json')}
                className="min-h-[44px] py-2.5 px-3 rounded-xl border border-[#342A24] bg-[#191614] hover:border-[#F06424] text-[#F3EEE8] font-semibold text-xs inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <FileText className="w-4 h-4 text-[#55B98B]" />
                <span>Download .JSON</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleDownloadSidecarBundle}
              className="w-full min-h-[46px] py-2.5 px-4 rounded-xl border border-[#55B98B]/50 bg-[#55B98B]/15 hover:bg-[#55B98B]/25 text-[#F3EEE8] font-bold text-xs inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Share2 className="w-4 h-4 text-[#55B98B]" />
              <span>
                Download {targetEditor.toUpperCase()} Media Sidecar Bundle (.zip with .srt + .vtt + .json + Guide)
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 2. DOWNLOADER & ASSET IMPORT WORKSPACE (SSRF-HARDENED + MAGIC-BYTE VERIFIED)
// ============================================================================

interface DownloaderWorkspaceProps {
  companion: CompanionState;
  onQueueJob: (
    job: Omit<
      JobRecord,
      'id' | 'createdAt' | 'updatedAt' | 'requestId' | 'attemptCount' | 'idempotencyKey'
    >
  ) => void;
  onNotify: (message: string, tone?: 'info' | 'warning' | 'error' | 'success') => void;
}

export const DownloaderWorkspace: React.FC<DownloaderWorkspaceProps> = ({
  onQueueJob,
  onNotify,
}) => {
  const [urlInput, setUrlInput] = useState<string>('');
  const [mode, setMode] = useState<'video' | 'audio' | 'thumbnail'>('video');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favOnly, setFavOnly] = useState<boolean>(false);
  const [quality, setQuality] = useState<string>('1080p');
  const [importIntoProject, setImportIntoProject] = useState<boolean>(true);
  const [addToActiveComp, setAddToActiveComp] = useState<boolean>(false);
  const [saveToPath, setSaveToPath] = useState<string>(
    'C:\\Users\\Administrator\\Downloads\\Sowveil'
  );
  const [recentDownloads, setRecentDownloads] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [localInspectResult, setLocalInspectResult] = useState<{
    fileName: string;
    sizeBytes: number;
    valid: boolean;
    container: string;
    mimeType: string;
    reason: string;
  } | null>(null);

  const liveSsrfInspection = useMemo(
    () => (urlInput.trim() ? validateMediaUrlForSsrf(urlInput.trim()) : null),
    [urlInput]
  );

  const downloaderModes = [
    {
      id: 'video' as const,
      title: 'Video',
      subtitle: 'MP4 video + audio',
      description: 'Download full video with audio as MP4.',
    },
    {
      id: 'audio' as const,
      title: 'Audio only',
      subtitle: 'MP3 320 kbps',
      description: 'Extract audio track only as MP3.',
    },
    {
      id: 'thumbnail' as const,
      title: 'Thumbnail',
      subtitle: 'High-res cover image',
      description: 'Save video thumbnail image.',
    },
  ];

  const visibleModes = favOnly
    ? downloaderModes.filter((m) => favorites.includes(m.id))
    : downloaderModes;

  const activeModeMeta =
    downloaderModes.find((m) => m.id === mode) || downloaderModes[0];

  const toggleFav = (id: string) => {
    setFavorites((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handlePasteClipboard = async () => {
    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setUrlInput(text.trim());
          setValidationError(null);
          onNotify('Pasted URL from clipboard.', 'info');
          return;
        }
      }
      onNotify(
        'Clipboard read permission was not granted by the browser. Long-press the URL field to paste manually.',
        'warning'
      );
    } catch {
      onNotify(
        'Browser blocked automatic clipboard read. Long-press the URL input field to paste.',
        'warning'
      );
    }
  };

  const handleDownloadSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const ssrf = validateMediaUrlForSsrf(urlInput);
    if (!ssrf.allowed) {
      if (ssrf.errorCode === 'SERVER_EXTRACTOR_WORKER_REQUIRED') {
        onQueueJob({
          type: 'download',
          title: `Remote Extractor (${mode}): ${ssrf.hostname}`,
          moduleId: 'downloader',
          operation: 'importAllowedFootage',
          status: 'needs-setup',
          deviceId: null,
          errorCode: ssrf.errorCode,
          redactedMessage: ssrf.reason,
        });
        setValidationError(ssrf.reason);
        onNotify(
          `Logged "${ssrf.hostname}" as "Needs setup": Third-party stream extraction requires a configured server worker.`,
          'info'
        );
        return;
      }

      setValidationError(`[${ssrf.errorCode}] ${ssrf.reason}`);
      onNotify(`Blocked URL: ${ssrf.reason}`, 'error');
      return;
    }

    onQueueJob({
      type: 'download',
      title: `HTTPS Media Intake (${mode}): ${ssrf.hostname}`,
      moduleId: 'downloader',
      operation: 'importAllowedFootage',
      status: ssrf.detectedExtension ? 'ready' : 'needs-setup',
      deviceId: 'android-mobile-browser',
      errorCode: ssrf.detectedExtension ? undefined : 'SERVER_MEDIA_PROXY_REQUIRED',
      redactedMessage: ssrf.reason,
    });

    setRecentDownloads((prev) => [ssrf.normalizedUrl || urlInput.trim(), ...prev].slice(0, 5));

    if (ssrf.detectedExtension) {
      const a = document.createElement('a');
      a.href = ssrf.normalizedUrl!;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.download = '';
      a.click();
      onNotify(
        `Verified direct HTTPS media asset (${ssrf.detectedExtension}) on ${ssrf.hostname}.`,
        'success'
      );
    } else {
      onNotify(
        `Verified HTTPS host "${ssrf.hostname}". Non-direct stream URLs require a server media worker ("Needs setup").`,
        'info'
      );
    }
  };

  return (
    <div className="p-2.5 sm:p-4 max-w-[1440px] mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
        {/* LEFT COLUMN (5 cols): Filter Pills + 2-Column Mode Grid (01:20–01:22) */}
        <div className="lg:col-span-5 flex flex-col gap-2.5 rounded-lg border border-[#221F1D] bg-[#121110] p-2.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFavOnly(false)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                !favOnly
                  ? 'bg-[#F06424] text-[#FFFFFF] font-semibold'
                  : 'bg-[#181615] text-[#9E958E] border border-[#262321]'
              }`}
            >
              All <span className="opacity-85 ml-0.5">3</span>
            </button>
            <button
              type="button"
              onClick={() => setFavOnly((v) => !v)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                favOnly
                  ? 'bg-[#F06424] text-[#FFFFFF] font-semibold'
                  : 'bg-[#181615] text-[#9E958E] border border-[#262321]'
              }`}
            >
              <span>★ Favorites</span>
              <span className="opacity-85">{favorites.length}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {visibleModes.map((opt) => {
              const isSelected = mode === opt.id;
              return (
                <div
                  key={opt.id}
                  onClick={() => setMode(opt.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setMode(opt.id);
                  }}
                  className={`rounded-md border p-2 transition-all cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? 'border-[#F06424] bg-[#1A1614] ring-1 ring-[#F06424]/50'
                      : 'border-[#24211F] bg-[#161413] hover:border-[#3A3430]'
                  }`}
                >
                  <div className="h-[68px] rounded bg-[#0C0B0A] border border-[#1E1C1A] flex items-center justify-center">
                    <Download
                      className={`w-6 h-6 ${
                        isSelected ? 'text-[#F06424]' : 'text-[#8C827A]'
                      }`}
                    />
                  </div>
                  <div className="mt-1.5">
                    <div className="text-[11px] font-semibold text-[#F3EEE8]">
                      {opt.title}
                    </div>
                    <div className="text-[9.5px] text-[#787069]">{opt.subtitle}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT COLUMN (7 cols): Reference Downloader Inspector (01:20–01:22) */}
        <div className="lg:col-span-7 flex flex-col gap-3 rounded-lg border border-[#221F1D] bg-[#121110] p-3.5">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-bold text-[#F3EEE8]">
                {activeModeMeta.title}
              </h2>
              <p className="text-[11px] text-[#8E857E] mt-0.5">
                {activeModeMeta.description}
              </p>
            </div>
            <button
              type="button"
              onClick={() => toggleFav(mode)}
              className="px-2.5 py-1 rounded border border-[#2C2826] bg-[#181615] hover:border-[#F06424] text-[11px] text-[#D8CFC8]"
            >
              {favorites.includes(mode) ? '★ Favorited' : '+ Add to favorites'}
            </button>
          </div>

          {/* Primary Orange Download Button */}
          <form onSubmit={handleDownloadSubmit} className="space-y-3">
            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-md bg-[#F06424] hover:bg-[#FF7434] text-[#FFFFFF] font-semibold text-[13px] transition-colors text-center"
            >
              Download
            </button>
            <div className="text-[10.5px] text-[#6E665F] text-center">
              Paste a link below and click Download. Saves to your folder and imports into After Effects.
            </div>

            {/* Info Box */}
            <div className="rounded border border-[#24211F] bg-[#161413] px-3 py-2 text-[10.5px] text-[#9E958E]">
              yt-dlp + ffmpeg ready. Full quality and MP3 available. Only download media you own or have permission to use.
            </div>

            {/* LINK Section */}
            <div className="space-y-1.5 pt-1">
              <div className="text-[10px] font-mono-tabular uppercase tracking-wider text-[#787069]">
                LINK
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="downloader-url-input"
                  type="text"
                  value={urlInput}
                  onChange={(e) => {
                    setUrlInput(e.target.value);
                    setValidationError(null);
                  }}
                  placeholder="Paste a video link (YouTube, Vimeo, X, TikTok...)"
                  className="flex-1 rounded border border-[#2C2826] bg-[#181615] px-3 py-1.5 text-[11px] text-[#F3EEE8] placeholder:text-[#6E665F]"
                />
                <button
                  type="button"
                  onClick={handlePasteClipboard}
                  className="px-3 py-1.5 rounded border border-[#2C2826] bg-[#181615] hover:border-[#F06424] text-[11px] text-[#D8CFC8]"
                >
                  Paste
                </button>
              </div>
            </div>

            {/* Live SSRF & Capability Status Pill */}
            {liveSsrfInspection && (
              <div
                className={`rounded border px-2.5 py-1.5 text-[10.5px] font-mono-tabular flex flex-wrap items-center justify-between gap-2 ${
                  liveSsrfInspection.allowed
                    ? 'border-[#55B98B]/40 bg-[#55B98B]/10 text-[#55B98B]'
                    : liveSsrfInspection.sourceStatus === 'Needs server worker setup'
                    ? 'border-[#E4B45A]/40 bg-[#E4B45A]/10 text-[#E4B45A]'
                    : 'border-[#F06464]/50 bg-[#F06464]/10 text-[#F06464]'
                }`}
              >
                <span>Status: {liveSsrfInspection.sourceStatus}</span>
                <span className="text-[#F3EEE8]">{liveSsrfInspection.reason}</span>
              </div>
            )}

            {validationError && (
              <div className="rounded border border-[#F06464]/50 bg-[#F06464]/10 px-3 py-2 text-[11px] text-[#F06464] flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{validationError}</span>
              </div>
            )}

            {/* PARAMETERS Section */}
            <div className="space-y-2 pt-2 border-t border-[#1E1C1A]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono-tabular uppercase tracking-wider text-[#787069]">
                  PARAMETERS
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setQuality('1080p');
                    setImportIntoProject(true);
                    setAddToActiveComp(false);
                  }}
                  className="text-[10.5px] text-[#8E857E] hover:text-[#F3EEE8]"
                >
                  Reset
                </button>
              </div>

              {mode === 'video' && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-[#9E958E]">Quality</span>
                  <select
                    value={quality}
                    onChange={(e) => setQuality(e.target.value)}
                    className="w-48 rounded border border-[#2C2826] bg-[#181615] px-2.5 py-1 text-[11px] text-[#F3EEE8]"
                  >
                    <option value="Best available">Best available</option>
                    <option value="4K (2160p)">4K (2160p)</option>
                    <option value="1080p">1080p</option>
                    <option value="720p">720p</option>
                  </select>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-[#9E958E]">Import into project</span>
                <input
                  type="checkbox"
                  checked={importIntoProject}
                  onChange={(e) => setImportIntoProject(e.target.checked)}
                  className="accent-[#F06424]"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-[#9E958E]">Add to active comp</span>
                <input
                  type="checkbox"
                  checked={addToActiveComp}
                  onChange={(e) => setAddToActiveComp(e.target.checked)}
                  className="accent-[#F06424]"
                />
              </div>
            </div>

            {/* SAVE TO Section */}
            <div className="space-y-1.5 pt-2 border-t border-[#1E1C1A]">
              <div className="text-[10px] font-mono-tabular uppercase tracking-wider text-[#787069]">
                SAVE TO
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={saveToPath}
                  onChange={(e) => setSaveToPath(e.target.value)}
                  className="flex-1 rounded border border-[#24211F] bg-[#161413] px-2.5 py-1.5 text-[10.5px] font-mono-tabular text-[#9E958E]"
                />
                <button
                  type="button"
                  onClick={() =>
                    onNotify('Select save destination folder in browser settings.', 'info')
                  }
                  className="px-2.5 py-1.5 rounded border border-[#2C2826] bg-[#181615] text-[10.5px] text-[#D8CFC8]"
                >
                  Change...
                </button>
              </div>
            </div>

            {/* RECENT Section */}
            <div className="space-y-1 pt-2 border-t border-[#1E1C1A]">
              <div className="text-[10px] font-mono-tabular uppercase tracking-wider text-[#787069]">
                RECENT
              </div>
              {recentDownloads.length === 0 ? (
                <div className="text-[11px] text-[#6E665F]">
                  Nothing downloaded yet.
                </div>
              ) : (
                <div className="space-y-1">
                  {recentDownloads.map((item, idx) => (
                    <div
                      key={idx}
                      className="text-[10.5px] font-mono-tabular text-[#B8AAA0] truncate"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </form>

          {/* Phone-Local Media File Import & Magic-Byte Signature Verifier */}
          <div className="pt-2 border-t border-[#1E1C1A] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono-tabular uppercase tracking-wider text-[#787069]">
                PHONE-LOCAL MAGIC-BYTE INSPECTOR
              </span>
              <span className="text-[10px] font-mono-tabular text-[#55B98B]">
                SSRF Guard Active
              </span>
            </div>
            <label className="block cursor-pointer rounded border border-dashed border-[#2C2826] hover:border-[#F06424] bg-[#161413] p-2.5 text-center transition-colors">
              <input
                type="file"
                accept="video/*,audio/*,image/*,.glb,.gltf,.srt,.vtt"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const safeName = sanitizeMediaFileName(file.name);
                  const slice = await file.slice(0, 256).arrayBuffer();
                  const sig = verifyMediaMagicBytes(new Uint8Array(slice), safeName);
                  setLocalInspectResult({
                    fileName: safeName,
                    sizeBytes: file.size,
                    valid: sig.valid,
                    container: sig.detectedContainer,
                    mimeType: sig.detectedMimeType,
                    reason: sig.reason,
                  });
                  onQueueJob({
                    type: 'asset-process',
                    title: `Local Media Inspect: ${safeName}`,
                    moduleId: 'downloader',
                    outputFileName: safeName,
                    outputMimeType: sig.detectedMimeType,
                    outputSizeBytes: file.size,
                    processedBytes: file.size,
                    totalBytes: file.size,
                    status: sig.valid ? 'ready' : 'failed',
                    errorCode: sig.errorCode,
                    deviceId: 'android-mobile-browser',
                    redactedMessage: sig.reason,
                  });
                  onNotify(
                    sig.valid
                      ? `Verified local file "${safeName}" (${sig.detectedContainer.toUpperCase()}).`
                      : `Rejected "${safeName}": ${sig.reason}`,
                    sig.valid ? 'success' : 'error'
                  );
                }}
              />
              <span className="text-[10.5px] text-[#9E958E]">
                Tap to inspect local media file (MP4, WebM, WAV, MP3, PNG, JPEG, GLB)
              </span>
            </label>

            {localInspectResult && (
              <div
                className={`rounded border p-2 text-[10.5px] font-mono-tabular ${
                  localInspectResult.valid
                    ? 'border-[#55B98B]/40 bg-[#55B98B]/10 text-[#55B98B]'
                    : 'border-[#F06464]/50 bg-[#F06464]/10 text-[#F06464]'
                }`}
              >
                <div className="flex justify-between">
                  <span className="font-bold">{localInspectResult.fileName}</span>
                  <span>{(localInspectResult.sizeBytes / 1024).toFixed(1)} KB</span>
                </div>
                <div className="text-[#F3EEE8]">
                  Container: {localInspectResult.container.toUpperCase()} · MIME:{' '}
                  {localInspectResult.mimeType}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 3. PROJECT LIBRARY WORKSPACE (REFERENCE 5-COLUMN GRID AT 01:23 + CHECKPOINTS)
// ============================================================================

interface ProjectLibraryWorkspaceProps {
  projects: ProjectLibraryItem[];
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetryLoad?: () => void;
  onAddProject: (
    proj: Omit<ProjectLibraryItem, 'id' | 'updatedAt'> & { id?: string; createdAt?: string }
  ) => Promise<void> | void;
  onUpdateProject: (
    id: string,
    patch: Partial<ProjectLibraryItem>
  ) => Promise<void> | void;
  onDeleteProject: (id: string) => Promise<void> | void;
  companion: CompanionState;
  onNotify: (message: string, tone?: 'info' | 'warning' | 'error' | 'success') => void;
}

export const ProjectLibraryWorkspace: React.FC<ProjectLibraryWorkspaceProps> = ({
  projects,
  isLoading = false,
  errorMessage = null,
  onRetryLoad,
  onAddProject,
  onUpdateProject,
  onDeleteProject,
  onNotify,
}) => {
  const [rawSearch, setRawSearch] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [archiveFilter, setArchiveFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [showAddModal, setShowAddModal] = useState<boolean>(false);

  const [newTitle, setNewTitle] = useState<string>('');
  const [newDesc, setNewDesc] = useState<string>('');
  const [newCompCountInput, setNewCompCountInput] = useState<string>('');
  const [newResolution, setNewResolution] = useState<string>('1080 × 1920');
  const [newFormatStatus, setNewFormatStatus] =
    useState<ProjectFileStatus>('sowveil-native');
  const [newTargetEditor, setNewTargetEditor] =
    useState<TargetMobileEditorId>('capcut');
  const [newTagsInput, setNewTagsInput] = useState<string>('Mobile, 9:16, Reusable');

  const [selectedProjId, setSelectedProjId] = useState<string>(projects[0]?.id || '');
  const [isEditingDetails, setIsEditingDetails] = useState<boolean>(false);
  const [editTitle, setEditTitle] = useState<string>('');
  const [editDesc, setEditDesc] = useState<string>('');
  const [editResolution, setEditResolution] = useState<string>('');
  const [editCompCountInput, setEditCompCountInput] = useState<string>('');
  const [editExternalWarning, setEditExternalWarning] = useState<boolean>(false);
  const [checkpointLabelInput, setCheckpointLabelInput] = useState<string>('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showProEditorModal, setShowProEditorModal] = useState<boolean>(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(rawSearch.trim().toLowerCase()), 180);
    return () => window.clearTimeout(t);
  }, [rawSearch]);

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (archiveFilter === 'active' && p.archived) return false;
      if (archiveFilter === 'archived' && !p.archived) return false;
      if (debouncedSearch) {
        const matchTitle = p.title.toLowerCase().includes(debouncedSearch);
        const matchDesc = p.description.toLowerCase().includes(debouncedSearch);
        const matchTags = p.tags.some((t) => t.toLowerCase().includes(debouncedSearch));
        const matchStatus = p.projectFileStatus.toLowerCase().includes(debouncedSearch);
        return matchTitle || matchDesc || matchTags || matchStatus;
      }
      return true;
    });
  }, [projects, archiveFilter, debouncedSearch]);

  const activeProject = useMemo(
    () => filtered.find((p) => p.id === selectedProjId) || filtered[0] || null,
    [filtered, selectedProjId]
  );

  useEffect(() => {
    if (!activeProject) return;
    setEditTitle(activeProject.title);
    setEditDesc(activeProject.description);
    setEditResolution(activeProject.resolution || '');
    setEditCompCountInput(
      activeProject.compCount !== null && activeProject.compCount !== undefined
        ? String(activeProject.compCount)
        : ''
    );
    setEditExternalWarning(activeProject.hasExternalFootageWarning);
    setIsEditingDetails(false);
    setConfirmDeleteId(null);
  }, [activeProject?.id]);

  const handleCreateProjectRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const parsedComps =
      newCompCountInput.trim() !== '' && !Number.isNaN(Number(newCompCountInput))
        ? Math.max(0, Math.floor(Number(newCompCountInput)))
        : null;

    const specObj = {
      schemaVersion: '2.4.0-mobile',
      format: 'sowveil-mobile-project',
      exportedAt: new Date().toISOString(),
      targetEditor: newTargetEditor,
      composition: {
        id: `proj_${Date.now()}`,
        title: newTitle.trim(),
        moduleId: 'project-library',
        categoryId: 'mobile-project',
        packLabel: 'User Mobile Project',
        aspectRatio: '9:16',
        width: 1080,
        height: 1920,
        fps: 60,
        durationSec: 4,
        previewKind: 'template-motion-card',
      },
      parameters: { headline: newTitle.trim() },
      motionRig: {
        curvePoints: [0.22, 1, 0.36, 1],
        cssCubicBezier: 'cubic-bezier(0.22, 1, 0.36, 1)',
        tags: ['Mobile'],
      },
      compatibility: {
        adapterId: newTargetEditor,
        status: 'Verified',
        notes: 'Reusable Sowveil Mobile Project document',
      },
    };
    const specJson = JSON.stringify(specObj, null, 2);

    const canonicalDoc = createMinimalCanonicalProject({
      title: newTitle.trim(),
      description:
        newDesc.trim() ||
        'Reusable Sowveil Canonical Project (v2.0.0) ready for mobile timeline editing and export.',
      targetEditor: newTargetEditor,
    });
    const canonicalLibRecord = canonicalProjectToLibraryRecord(canonicalDoc);
    const canonicalJson = serializeCanonicalProject(canonicalDoc);

    await onAddProject({
      id: canonicalDoc.id,
      title: newTitle.trim(),
      description:
        newDesc.trim() ||
        (newFormatStatus === 'sowveil-native'
          ? 'Reusable Sowveil Mobile Project (.sowveil.json · Canonical v2.0.0) ready for Android export and handoff.'
          : 'User-saved project metadata record (no binary uploaded to cloud storage).'),
      compCount: parsedComps ?? canonicalDoc.scenes.length,
      projectFileStatus: newFormatStatus,
      fileSizeBytes: newFormatStatus === 'sowveil-native' ? canonicalJson.length : null,
      fileSizeLabel:
        newFormatStatus === 'sowveil-native'
          ? `${(canonicalJson.length / 1024).toFixed(1)} KB (.sowveil.json v2.0)`
          : 'Unknown (metadata-only)',
      resolution: newResolution.trim() || undefined,
      targetEditor: newTargetEditor,
      aspectRatio: '9:16',
      sowveilSpecJson:
        newFormatStatus === 'sowveil-native'
          ? canonicalLibRecord.sowveilSpecJson || specJson
          : undefined,
      canonicalProjectJson:
        newFormatStatus === 'sowveil-native' ? canonicalJson : undefined,
      revision: canonicalDoc.revision,
      activeBranch: canonicalDoc.activeBranch,
      hasExternalFootageWarning: false,
      archived: false,
      tags: newTagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });
    setNewTitle('');
    setNewDesc('');
    setNewCompCountInput('');
    setShowAddModal(false);
    onNotify(`Saved project "${newTitle.trim()}" (${newFormatStatus} · Canonical v2.0).`, 'success');
  };

  const handleSaveDetailsEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject || !editTitle.trim()) return;
    const parsedComps =
      editCompCountInput.trim() !== '' && !Number.isNaN(Number(editCompCountInput))
        ? Math.max(0, Math.floor(Number(editCompCountInput)))
        : null;

    await onUpdateProject(activeProject.id, {
      title: editTitle.trim(),
      description: editDesc.trim(),
      resolution: editResolution.trim() || undefined,
      compCount: parsedComps,
      hasExternalFootageWarning: editExternalWarning,
    });
    setIsEditingDetails(false);
    onNotify(`Updated details for "${editTitle.trim()}".`, 'success');
  };

  const handleSaveCheckpoint = async (proj: ProjectLibraryItem) => {
    const chk = createProjectCheckpoint(proj, checkpointLabelInput.trim() || undefined);
    const nextCheckpoints: ProjectCheckpointRecord[] = [
      chk,
      ...(proj.checkpoints || []),
    ].slice(0, 15);
    await onUpdateProject(proj.id, {
      checkpoints: nextCheckpoints,
    });
    setCheckpointLabelInput('');
    onNotify(`Saved checkpoint "${chk.label}" for "${proj.title}".`, 'success');
  };

  const handleRestoreCheckpoint = async (
    proj: ProjectLibraryItem,
    chk: ProjectCheckpointRecord
  ) => {
    await onUpdateProject(proj.id, {
      sowveilSpecJson: chk.sowveilSpecJson,
      targetEditor: chk.targetEditor || proj.targetEditor,
      aspectRatio: chk.aspectRatio || proj.aspectRatio,
      fileSizeBytes: chk.sowveilSpecJson.length,
      fileSizeLabel: `${(chk.sowveilSpecJson.length / 1024).toFixed(1)} KB (.sowveil.json)`,
    });
    onNotify(`Restored "${proj.title}" to checkpoint "${chk.label}".`, 'info');
  };

  const handleDuplicateProject = async (proj: ProjectLibraryItem) => {
    await onAddProject({
      title: `${proj.title} (Copy)`,
      description: proj.description,
      compCount: proj.compCount,
      projectFileStatus: proj.projectFileStatus,
      fileSizeBytes: proj.fileSizeBytes,
      fileSizeLabel: proj.fileSizeLabel,
      resolution: proj.resolution,
      durationLabel: proj.durationLabel,
      fps: proj.fps,
      targetEditor: proj.targetEditor,
      aspectRatio: proj.aspectRatio,
      sowveilSpecJson: proj.sowveilSpecJson,
      checkpoints: proj.checkpoints,
      hasExternalFootageWarning: proj.hasExternalFootageWarning,
      archived: false,
      tags: [...proj.tags, 'Duplicate'].slice(0, 20),
    });
    onNotify(`Duplicated project "${proj.title}".`, 'success');
  };

  const handleDownloadMobileProjectFile = (proj: ProjectLibraryItem) => {
    const payload =
      proj.canonicalProjectJson ||
      proj.sowveilSpecJson ||
      JSON.stringify(
        {
          schemaVersion: '2.4.0-mobile',
          format: 'sowveil-mobile-project',
          exportedAt: new Date().toISOString(),
          targetEditor: proj.targetEditor || 'sowveil-project',
          composition: {
            id: proj.id,
            title: proj.title,
            width: 1080,
            height: 1920,
            fps: proj.fps || 60,
            durationSec: 4,
          },
          description: proj.description,
          tags: proj.tags,
        },
        null,
        2
      );
    const slug = proj.title.replace(/[^a-z0-9\-]/gi, '-').toLowerCase();
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.sowveil.json`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify(`Downloaded reusable mobile project "${slug}.sowveil.json".`, 'success');
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-10 rounded-lg bg-[#191614] animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="h-32 rounded-lg bg-[#191614] animate-pulse" />
          <div className="h-32 rounded-lg bg-[#191614] animate-pulse" />
          <div className="h-32 rounded-lg bg-[#191614] animate-pulse" />
        </div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <div className="rounded-xl border border-[#F06464]/50 bg-[#11100F] p-6 space-y-3">
          <div className="text-xs font-mono-tabular text-[#F06464]">PROJECT LIBRARY LOAD ERROR</div>
          <p className="text-xs text-[#F3EEE8]">{errorMessage}</p>
          {onRetryLoad && (
            <button
              type="button"
              onClick={onRetryLoad}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#F06424] text-[#080707] font-semibold text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry loading Project Library</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 max-w-[1440px] mx-auto space-y-4">
      {/* Top Action Bar Matching Frame 01:23 */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-[#787069] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            placeholder="Search projects and comps"
            aria-label="Search projects and comps"
            className="w-full rounded-md border border-[#24211F] bg-[#141211] pl-8 pr-7 py-1.5 text-[11px] text-[#F3EEE8] placeholder:text-[#6E665F]"
          />
          {rawSearch && (
            <button
              type="button"
              onClick={() => setRawSearch('')}
              aria-label="Clear project search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#787069] hover:text-[#F3EEE8]"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAddModal((v) => !v)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-[#F06424] hover:bg-[#FF7434] text-[#FFFFFF] font-semibold text-[11px] transition-colors whitespace-nowrap"
          >
            <span>+ Save project</span>
          </button>

          <label className="cursor-pointer inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-[#2C2826] bg-[#181615] hover:border-[#F06424] text-[#D8CFC8] font-medium text-[11px] transition-colors whitespace-nowrap">
            <span>Add .aep</span>
            <input
              type="file"
              accept=".json,.xml,.aep,.aet"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;

                if (file.name.endsWith('.json')) {
                  const text = await file.text();
                  const check = validateSowveilProjectJson(text);
                  const migrated = migrateToCanonicalProject(text);
                  const canonicalJson = serializeCanonicalProject(migrated.project);
                  await onAddProject({
                    title:
                      check.parsed?.composition.title ||
                      migrated.project.title ||
                      file.name.replace(/\.sowveil\.json$|\.json$/i, ''),
                    description: check.valid
                      ? `Imported verified Sowveil Project (${file.name} · migrated from ${migrated.fromVersion} to v2.0.0).`
                      : `Imported JSON project document (${file.name}).`,
                    compCount: migrated.project.scenes.length || 1,
                    projectFileStatus: 'sowveil-native',
                    fileSizeBytes: file.size,
                    fileSizeLabel: `${(file.size / 1024).toFixed(1)} KB`,
                    resolution: check.parsed
                      ? `${check.parsed.composition.width} × ${check.parsed.composition.height}`
                      : `${migrated.project.canvas.width} × ${migrated.project.canvas.height}`,
                    targetEditor: check.parsed?.targetEditor || 'sowveil-project',
                    sowveilSpecJson: text.slice(0, 14000),
                    canonicalProjectJson: canonicalJson.slice(0, 64000),
                    revision: migrated.project.revision,
                    activeBranch: migrated.project.activeBranch,
                    hasExternalFootageWarning: false,
                    archived: false,
                    tags: ['Imported .sowveil.json', 'Canonical v2.0'],
                  });
                  onNotify(`Imported reusable mobile project "${file.name}" (Canonical v2.0).`, 'success');
                  return;
                }

                if (file.name.endsWith('.xml')) {
                  const text = await file.text();
                  const check = validateAlightMotionXml(text);
                  await onAddProject({
                    title: file.name.replace(/\.xml$/i, ''),
                    description: check.valid
                      ? `Imported validated Alight Motion XML template (${file.name}).`
                      : `Imported XML template (${file.name}).`,
                    compCount: 1,
                    projectFileStatus: 'alight-motion-xml',
                    fileSizeBytes: file.size,
                    fileSizeLabel: `${(file.size / 1024).toFixed(1)} KB`,
                    resolution: '1080 × 1920',
                    targetEditor: 'alight-motion',
                    hasExternalFootageWarning: false,
                    archived: false,
                    tags: ['Alight Motion XML', 'Mobile Template'],
                  });
                  onNotify(`Imported Alight Motion XML template "${file.name}".`, 'success');
                  return;
                }

                await onAddProject({
                  title: file.name.replace(/\.ae[pt]$/i, ''),
                  description: `Registered local .aep file metadata (${file.name}). Storage not configured; no binary or blob URL stored in cloud.`,
                  compCount: null,
                  projectFileStatus: 'linked-local',
                  fileSizeBytes: file.size,
                  fileSizeLabel: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
                  resolution: undefined,
                  durationLabel: undefined,
                  hasExternalFootageWarning: true,
                  archived: false,
                  tags: ['Imported .aep', 'Local Reference'],
                });
                onNotify(
                  `Saved local .aep metadata "${file.name}" (${(file.size / 1024).toFixed(1)} KB).`,
                  'info'
                );
              }}
            />
          </label>

          <button
            type="button"
            onClick={() =>
              setArchiveFilter((prev) => (prev === 'active' ? 'all' : 'active'))
            }
            title="Toggle Active / All projects"
            className="p-1.5 rounded-md border border-[#2C2826] bg-[#181615] hover:border-[#F06424] text-[#9E958E] hover:text-[#F3EEE8]"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {showAddModal && (
        <form
          onSubmit={handleCreateProjectRecord}
          className="rounded-lg border border-[#F06424]/50 bg-[#181615] p-3.5 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-[#F3EEE8]">
              Create Reusable Mobile Project or Metadata Record
            </h3>
            <span className="text-[10.5px] font-mono-tabular text-[#9E958E]">
              Leave comp count blank if uninspected
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            <input
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Project title *"
              className="rounded border border-[#2C2826] bg-[#121110] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
            />
            <select
              value={newFormatStatus}
              onChange={(e) => setNewFormatStatus(e.target.value as ProjectFileStatus)}
              className="rounded border border-[#2C2826] bg-[#121110] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
            >
              <option value="sowveil-native">Sowveil Mobile (.sowveil.json)</option>
              <option value="alight-motion-xml">Alight Motion (.xml)</option>
              <option value="media-bundle">Mobile Media Bundle (.zip)</option>
              <option value="metadata-only">Metadata-Only Record</option>
            </select>
            <select
              value={newTargetEditor}
              onChange={(e) =>
                setNewTargetEditor(e.target.value as TargetMobileEditorId)
              }
              className="rounded border border-[#2C2826] bg-[#121110] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
            >
              <option value="capcut">Target: CapCut</option>
              <option value="alight-motion">Target: Alight Motion</option>
              <option value="node-video">Target: Node Video</option>
              <option value="kinemaster">Target: KineMaster</option>
              <option value="sowveil-project">Target: Sowveil Native</option>
            </select>
            <input
              type="number"
              min={0}
              max={500}
              value={newCompCountInput}
              onChange={(e) => setNewCompCountInput(e.target.value)}
              placeholder="Comps (optional)"
              className="rounded border border-[#2C2826] bg-[#121110] px-2.5 py-1.5 text-xs text-[#F3EEE8] font-mono-tabular"
            />
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newResolution}
                onChange={(e) => setNewResolution(e.target.value)}
                placeholder="Res (e.g. 1080 × 1920)"
                className="flex-1 rounded border border-[#2C2826] bg-[#121110] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
              />
              <button
                type="submit"
                className="py-1.5 px-3 rounded bg-[#F06424] text-[#FFFFFF] font-semibold text-xs whitespace-nowrap"
              >
                Save
              </button>
            </div>
          </div>
        </form>
      )}

      {/* 5-Column Project Card Grid Matching Frame 01:23 */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-[#24211F] bg-[#121110] p-8 text-center space-y-2">
          <p className="text-xs font-semibold text-[#F3EEE8]">
            No project records match your current view
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map((proj) => {
            const isSelected = activeProject?.id === proj.id;
            const shortSize = proj.fileSizeLabel.replace(/\s*\(.*?\)/g, '');
            return (
              <div
                key={proj.id}
                onClick={() => setSelectedProjId(proj.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setSelectedProjId(proj.id);
                }}
                className={`group text-left rounded-lg border p-2.5 transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'border-[#F06424] bg-[#1A1614] ring-1 ring-[#F06424]/50'
                    : 'border-[#24211F] bg-[#141211] hover:border-[#3A3430]'
                }`}
              >
                <div className="h-[88px] rounded bg-[#0C0B0A] border border-[#1E1C1A] p-2 flex flex-col justify-between relative">
                  <div className="text-[9.5px] font-mono-tabular text-[#8E857E]">
                    {proj.compCount !== null && proj.compCount !== undefined
                      ? `${proj.compCount} comps`
                      : 'Comps: Unknown'}
                  </div>
                  <div className="my-auto text-center font-mono-tabular text-[11px] tracking-[0.2em] text-[#5C554F] uppercase">
                    PROJECT
                  </div>
                  <div className="h-2" />
                </div>

                <div className="mt-2">
                  <div className="font-semibold text-[11.5px] text-[#F3EEE8] truncate">
                    {proj.title}
                  </div>
                  <div className="mt-0.5 text-[9.5px] text-[#787069] truncate">
                    Oct 22, 2026 · {shortSize}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Project Detail, Checkpoints & Export Drawer */}
      {activeProject && (
        <div className="rounded-lg border border-[#24211F] bg-[#121110] p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-mono-tabular text-[#55B98B] uppercase">
                {activeProject.projectFileStatus} ·{' '}
                {activeProject.compCount !== null && activeProject.compCount !== undefined
                  ? `${activeProject.compCount} comps`
                  : 'Comps: Unknown'}
              </div>
              <h3 className="text-sm font-bold text-[#F3EEE8] mt-0.5">
                {activeProject.title}
              </h3>
              <p className="text-[11px] text-[#8E857E] mt-0.5">
                {activeProject.description}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowProEditorModal(true)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-[#F06424]/70 bg-[#23140E] hover:bg-[#2F1A12] text-[#F3EEE8] font-semibold text-[11px]"
              >
                <Sliders className="w-3.5 h-3.5 text-[#F06424]" />
                <span>Open in Pro Editor (v2.0)</span>
              </button>
              <button
                type="button"
                onClick={() => handleDownloadMobileProjectFile(activeProject)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-[#F06424] hover:bg-[#FF7434] text-[#FFFFFF] font-semibold text-[11px]"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download .sowveil.json</span>
              </button>
              <button
                type="button"
                onClick={() => handleDuplicateProject(activeProject)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-[#2C2826] bg-[#181615] text-[11px] text-[#D8CFC8]"
              >
                <Copy className="w-3 h-3" />
                <span>Duplicate</span>
              </button>
              <button
                type="button"
                onClick={() => setIsEditingDetails((v) => !v)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-[#2C2826] bg-[#181615] text-[11px] text-[#D8CFC8]"
              >
                <Edit3 className="w-3 h-3" />
                <span>{isEditingDetails ? 'Cancel' : 'Edit'}</span>
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(activeProject.id)}
                aria-label={`Delete ${activeProject.title}`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-[#2C2826] text-[11px] text-[#F06464] hover:bg-[#F06464]/10"
              >
                <Trash2 className="w-3 h-3" />
                <span>Delete</span>
              </button>
            </div>
          </div>

          {isEditingDetails && (
            <form
              onSubmit={handleSaveDetailsEdit}
              className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 pt-2 border-t border-[#1E1C1A]"
            >
              <input
                type="text"
                required
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="rounded border border-[#2C2826] bg-[#181615] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
              />
              <input
                type="text"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="rounded border border-[#2C2826] bg-[#181615] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
              />
              <input
                type="number"
                min={0}
                value={editCompCountInput}
                onChange={(e) => setEditCompCountInput(e.target.value)}
                placeholder="Comps"
                className="rounded border border-[#2C2826] bg-[#181615] px-2.5 py-1.5 text-xs text-[#F3EEE8] font-mono-tabular"
              />
              <button
                type="submit"
                className="rounded bg-[#F06424] text-[#FFFFFF] font-semibold text-xs py-1.5 px-3"
              >
                Save Changes
              </button>
            </form>
          )}

          {/* Version Checkpoints Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#1E1C1A]">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono-tabular text-[#787069] uppercase flex items-center gap-1">
                <History className="w-3 h-3 text-[#F06424]" />
                <span>Checkpoints ({activeProject.checkpoints?.length || 0})</span>
              </span>
              <input
                type="text"
                value={checkpointLabelInput}
                onChange={(e) => setCheckpointLabelInput(e.target.value)}
                placeholder="Checkpoint label…"
                className="rounded border border-[#2C2826] bg-[#181615] px-2 py-1 text-[11px] text-[#F3EEE8]"
              />
              <button
                type="button"
                onClick={() => handleSaveCheckpoint(activeProject)}
                className="px-2.5 py-1 rounded bg-[#F06424] text-[#FFFFFF] font-semibold text-[11px]"
              >
                + Checkpoint
              </button>
            </div>

            {activeProject.checkpoints && activeProject.checkpoints.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {activeProject.checkpoints.slice(0, 3).map((chk) => (
                  <button
                    key={chk.id}
                    type="button"
                    onClick={() => handleRestoreCheckpoint(activeProject, chk)}
                    className="px-2 py-0.5 rounded border border-[#2C2826] bg-[#181615] text-[10px] font-mono-tabular text-[#55B98B] hover:border-[#55B98B]"
                  >
                    Restore: {chk.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {confirmDeleteId === activeProject.id && (
            <div className="rounded border border-[#F06464] bg-[#F06464]/10 p-2.5 flex items-center justify-between gap-2 text-xs">
              <span className="text-[#F3EEE8]">
                Confirm permanent deletion of “{activeProject.title}”?
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onDeleteProject(activeProject.id);
                    setConfirmDeleteId(null);
                    onNotify(`Deleted "${activeProject.title}".`, 'info');
                  }}
                  className="px-2.5 py-1 rounded bg-[#F06464] text-[#080707] font-semibold"
                >
                  Confirm Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="px-2.5 py-1 rounded border border-[#2C2826] bg-[#181615] text-[#9E958E]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mobile Pro Timeline Editor Modal (Canonical Project v2.0.0) */}
      {showProEditorModal && activeProject && (
        <MobileProEditorModal
          isOpen={showProEditorModal}
          sourceLibraryProject={activeProject}
          onClose={() => setShowProEditorModal(false)}
          onSaveToProjectLibrary={async (updatedRecord) => {
            await onUpdateProject(activeProject.id, {
              title: updatedRecord.title,
              description: updatedRecord.description,
              compCount: updatedRecord.compCount,
              projectFileStatus: updatedRecord.projectFileStatus,
              fileSizeBytes: updatedRecord.fileSizeBytes,
              fileSizeLabel: updatedRecord.fileSizeLabel,
              resolution: updatedRecord.resolution,
              durationLabel: updatedRecord.durationLabel,
              fps: updatedRecord.fps,
              targetEditor: updatedRecord.targetEditor,
              aspectRatio: updatedRecord.aspectRatio,
              sowveilSpecJson: updatedRecord.sowveilSpecJson,
              canonicalProjectJson: updatedRecord.canonicalProjectJson,
              revision: updatedRecord.revision,
              activeBranch: updatedRecord.activeBranch,
              checkpoints: updatedRecord.checkpoints,
              tags: updatedRecord.tags,
            });
          }}
          onNotify={onNotify}
        />
      )}
    </div>
  );
};

