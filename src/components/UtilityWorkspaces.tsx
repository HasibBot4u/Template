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
  Smartphone,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

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
  { id: 'bold-pop', name: 'Bold Pop', tag: 'Word Pop', accent: '#F06424' },
  { id: 'highlight-box', name: 'Highlight Box', tag: 'Active Pill', accent: '#E4B45A' },
  { id: 'karaoke-fill', name: 'Karaoke Fill', tag: 'Sweep', accent: '#55B98B' },
  { id: 'fade-words', name: 'Fade Words', tag: 'Editorial', accent: '#F3EEE8' },
  { id: 'glow-pulse', name: 'Glow Pulse', tag: 'Neon', accent: '#60A5FA' },
  { id: 'typewriter', name: 'Typewriter', tag: 'Monospace', accent: '#FFC08C' },
  { id: 'slide-up', name: 'Slide Up', tag: 'Kinetic', accent: '#F06424' },
  { id: 'minimal-clean', name: 'Minimal Clean', tag: 'Broadcast', accent: '#E5E7EB' },
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

  // Re-generate segments when user clicks "Sync Transcript to Timed Cues" or adjusts wordsPerCaption/wpmSpeed
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
    CAPTION_STYLE_PRESETS.find((s) => s.id === selectedStyleId) || CAPTION_STYLE_PRESETS[0];

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
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#342A24] pb-4">
        <div>
          <h1 className="text-lg font-bold text-[#F3EEE8]">Auto Captions</h1>
          <p className="text-xs text-[#B8AAA0] mt-0.5">
            1. Source · 2. Transcribe · 3. Edit Timed Segments · 4. Export (.srt / .vtt / .json / Mobile Sidecar .zip)
          </p>
        </div>
        <span className="text-xs font-mono-tabular text-[#55B98B]">
          Mobile Subtitle Engine Ready · Parser &amp; Overlap Verified
        </span>
      </div>

      {/* Honest Processing & Privacy Banner */}
      <div className="rounded-xl border border-[#342A24] bg-[#14110F] p-3.5 flex items-start gap-3 text-xs text-[#B8AAA0]">
        <Smartphone className="w-4 h-4 text-[#F06424] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-[#F3EEE8]">
            Honest On-Device vs. Cloud ASR Architecture
          </div>
          <p>
            Sowveil never downloads multi-hundred-megabyte speech models onto your phone without consent and never claims heavy AI transcription runs locally when it does not. Timed transcript chunking, SRT/VTT parsing, overlap detection, cue splitting/merging, and sidecar ZIP packaging run directly in your mobile browser. Full audio speech-to-text requires a configured server ASR worker.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Steps 1, 2 & Style Presets */}
        <div className="lg:col-span-5 space-y-5">
          {/* 1. Source Selection (Phone File Picker OR User Library Asset) */}
          <div className="rounded-2xl border border-[#342A24] bg-[#11100F] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-mono-tabular text-[#83766D]">1. SOURCE</div>
              <div className="inline-flex rounded-lg border border-[#342A24] bg-[#191614] p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setSourceMode('phone-file')}
                  className={`px-2.5 py-1 rounded-md font-medium ${
                    sourceMode === 'phone-file'
                      ? 'bg-[#F06424] text-[#080707] font-semibold'
                      : 'text-[#B8AAA0]'
                  }`}
                >
                  Phone File
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode('library-asset')}
                  className={`px-2.5 py-1 rounded-md font-medium ${
                    sourceMode === 'library-asset'
                      ? 'bg-[#F06424] text-[#080707] font-semibold'
                      : 'text-[#B8AAA0]'
                  }`}
                >
                  Library Asset ({projects.length})
                </button>
              </div>
            </div>

            {sourceMode === 'phone-file' ? (
              <label className="block cursor-pointer rounded-xl border border-dashed border-[#342A24] hover:border-[#F06424] bg-[#191614]/60 p-4 text-center transition-colors">
                <input
                  type="file"
                  accept="video/*,audio/*,.mp4,.mov,.webm,.mp3,.wav,.m4a,.srt,.vtt"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const safeName = sanitizeMediaFileName(file.name);

                    // If user selects an existing .srt or .vtt file, parse it into interactive segments!
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

                    // Inspect first 256 magic bytes of video/audio file
                    const headBuf = await file.slice(0, 256).arrayBuffer();
                    const sig = verifyMediaMagicBytes(new Uint8Array(headBuf), safeName);
                    setSelectedFile({
                      name: safeName,
                      sizeBytes: file.size,
                      type: sig.detectedMimeType || file.type || 'video/mp4',
                      signatureVerified: sig.valid ? sig.reason : sig.reason,
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
                <Upload className="w-5 h-5 text-[#F06424] mx-auto mb-1.5" />
                {selectedFile ? (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-[#F3EEE8] truncate">
                      {selectedFile.name}
                    </div>
                    <div className="text-[11px] text-[#B8AAA0] font-mono-tabular">
                      {(selectedFile.sizeBytes / 1024).toFixed(1)} KB · {selectedFile.type}
                    </div>
                    {selectedFile.signatureVerified && (
                      <div className="text-[10px] text-[#55B98B] font-mono-tabular">
                        {selectedFile.signatureVerified}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-[#F3EEE8]">
                      Select phone video, audio, or .srt / .vtt file
                    </div>
                    <div className="text-[11px] text-[#83766D]">
                      MP4, MOV, WebM, WAV, MP3, SRT, VTT · Magic-byte verified
                    </div>
                  </div>
                )}
              </label>
            ) : (
              <div className="space-y-2">
                <select
                  value={selectedLibraryProjectId}
                  onChange={(e) => setSelectedLibraryProjectId(e.target.value)}
                  aria-label="Choose asset from Project Library"
                  className="w-full min-h-[42px] rounded-xl border border-[#342A24] bg-[#191614] px-3 py-2 text-xs text-[#F3EEE8]"
                >
                  {projects.length === 0 ? (
                    <option value="">No saved Project Library items yet</option>
                  ) : (
                    projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} ({p.projectFileStatus} · {p.resolution || '1080×1920'})
                      </option>
                    ))
                  )}
                </select>
                <p className="text-[11px] text-[#83766D]">
                  Attaches generated subtitle sidecars to your selected Project Library record.
                </p>
              </div>
            )}

            {/* Large File Privacy & Data Retention Disclosure */}
            {isLargeFile && (
              <div className="rounded-xl border border-[#E4B45A]/50 bg-[#E4B45A]/10 p-3 space-y-2 text-xs">
                <div className="flex items-start gap-2 text-[#E4B45A] font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Large Media Privacy &amp; Retention Notice (&gt; 10 MB)</span>
                </div>
                <p className="text-[#B8AAA0] text-[11px] leading-relaxed">
                  Uploading large video/audio files to a cloud transcription worker transfers your media over the network and may incur bandwidth and Cloud Run/ASR costs. Temporary worker uploads are scoped to your account and purged after job retention expires.
                </p>
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

          {/* 2. Transcribe Settings */}
          <div className="rounded-2xl border border-[#342A24] bg-[#11100F] p-4 space-y-3">
            <div className="text-xs font-mono-tabular text-[#83766D]">
              2. TRANSCRIBE &amp; CHUNKING CONTROLS
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <label className="block space-y-1">
                <span className="text-[#B8AAA0]">Language</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-[#342A24] bg-[#191614] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
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
              </label>

              <label className="block space-y-1">
                <span className="text-[#B8AAA0]">Model / Processing Tier</span>
                <select
                  value={modelTier}
                  onChange={(e) =>
                    setModelTier(e.target.value as 'browser-timed' | 'server-whisper-asr')
                  }
                  className="w-full min-h-[42px] rounded-xl border border-[#342A24] bg-[#191614] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
                >
                  <option value="browser-timed">Browser Timed Chunker (Available)</option>
                  <option value="server-whisper-asr">
                    Server Whisper ASR Worker (Needs setup)
                  </option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-[#B8AAA0] flex justify-between">
                  <span>Words per caption</span>
                  <span className="font-mono-tabular text-[#F3EEE8]">{wordsPerCaption}</span>
                </span>
                <input
                  type="range"
                  min={1}
                  max={7}
                  value={wordsPerCaption}
                  onChange={(e) => setWordsPerCaption(Number(e.target.value))}
                  className="w-full accent-[#F06424]"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[#B8AAA0] flex justify-between">
                  <span>Cadence (WPM)</span>
                  <span className="font-mono-tabular text-[#F3EEE8]">{wpmSpeed}</span>
                </span>
                <input
                  type="range"
                  min={90}
                  max={240}
                  step={5}
                  value={wpmSpeed}
                  onChange={(e) => setWpmSpeed(Number(e.target.value))}
                  className="w-full accent-[#F06424]"
                />
              </label>
            </div>

            <label className="block space-y-1 text-xs">
              <span className="text-[#B8AAA0]">
                Quick Transcript Seed (Syncs into interactive segment list)
              </span>
              <textarea
                rows={3}
                value={transcriptInput}
                onChange={(e) => setTranscriptInput(e.target.value)}
                placeholder="Paste or type spoken script…"
                className="w-full rounded-xl border border-[#342A24] bg-[#191614] p-2.5 text-xs text-[#F3EEE8] leading-relaxed"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRegenerateFromTranscript}
                className="flex-1 min-h-[42px] py-2 px-3 rounded-xl bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-bold text-xs transition-colors"
              >
                Sync Transcript → Timed Segments
              </button>
              {modelTier === 'server-whisper-asr' && (
                <button
                  type="button"
                  onClick={handleRequestServerWhisperJob}
                  className="min-h-[42px] py-2 px-3 rounded-xl border border-[#342A24] bg-[#191614] hover:border-[#F06424] text-xs font-medium text-[#B8AAA0] hover:text-[#F3EEE8]"
                >
                  Queue Server ASR →
                </button>
              )}
            </div>
          </div>

          {/* Configurable Subtitle Validation Thresholds */}
          <div className="rounded-2xl border border-[#342A24] bg-[#11100F] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono-tabular text-[#83766D]">
                SUBTITLE LINE-LENGTH &amp; TIMING RULES
              </span>
              <span className="text-[11px] font-mono-tabular text-[#55B98B]">Configurable</span>
            </div>
            <div className="grid grid-cols-3 gap-2.5 text-xs">
              <label className="block space-y-1">
                <span className="text-[11px] text-[#B8AAA0]">Max Chars/Line</span>
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
                  className="w-full min-h-[38px] rounded-lg border border-[#342A24] bg-[#191614] px-2.5 py-1 text-xs text-[#F3EEE8] font-mono-tabular"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] text-[#B8AAA0]">Min Cue (s)</span>
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
                  className="w-full min-h-[38px] rounded-lg border border-[#342A24] bg-[#191614] px-2.5 py-1 text-xs text-[#F3EEE8] font-mono-tabular"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] text-[#B8AAA0]">Max Cue (s)</span>
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
                  className="w-full min-h-[38px] rounded-lg border border-[#342A24] bg-[#191614] px-2.5 py-1 text-xs text-[#F3EEE8] font-mono-tabular"
                />
              </label>
            </div>
          </div>

          {/* Caption Style Presets */}
          <div className="rounded-2xl border border-[#342A24] bg-[#11100F] p-4 space-y-3">
            <div className="text-xs font-mono-tabular text-[#83766D]">
              MOBILE CAPTION OVERLAY PRESET ({CAPTION_STYLE_PRESETS.length})
            </div>
            <div className="grid grid-cols-2 gap-2">
              {CAPTION_STYLE_PRESETS.map((preset) => {
                const isSelected = preset.id === selectedStyleId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSelectedStyleId(preset.id)}
                    className={`min-h-[48px] text-left rounded-xl p-2.5 border transition-colors ${
                      isSelected
                        ? 'border-[#F06424] bg-[#211B17]'
                        : 'border-[#342A24] bg-[#191614] hover:border-[#83766D]'
                    }`}
                  >
                    <div className="text-xs font-semibold text-[#F3EEE8]">{preset.name}</div>
                    <div className="text-[10px] font-mono-tabular text-[#83766D] mt-0.5">
                      {preset.tag}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Step 3 (Interactive Timed Segment Editor) & Step 4 (Export & Sidecar Bundle) */}
        <div className="lg:col-span-7 space-y-5">
          {/* 3. Edit Text & Timed Segments */}
          <div className="rounded-2xl border border-[#342A24] bg-[#11100F] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-mono-tabular text-[#83766D]">
                  3. EDIT TIMED SEGMENTS ({editableCues.length} CUES)
                </div>
                <p className="text-[11px] text-[#B8AAA0]">
                  Touch controls to edit text, speaker label, start/end timestamps, split, merge, or delete segments
                </p>
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
  const [rightsConfirmed, setRightsConfirmed] = useState<boolean>(false);
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

    if (!rightsConfirmed) {
      setValidationError(
        'Please confirm that you own or have explicit permission to download and import this media.'
      );
      return;
    }

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
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div className="border-b border-[#342A24] pb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-[#F3EEE8]">Downloader &amp; Asset Intake</h1>
          <p className="text-xs text-[#B8AAA0] mt-0.5">
            Authorized HTTPS media intake + Phone-local file magic-byte verification
          </p>
        </div>
        <span className="text-xs font-mono-tabular text-[#55B98B]">
          SSRF Guard Active · Zero Shell Execution
        </span>
      </div>

      {/* Explicit Network, Quota & Cloud Cost Disclosure */}
      <div className="rounded-xl border border-[#342A24] bg-[#14110F] p-3.5 text-xs text-[#B8AAA0] space-y-1">
        <div className="font-semibold text-[#F3EEE8] flex items-center gap-1.5">
          <ShieldAlert className="w-4 h-4 text-[#F06424]" />
          <span>SSRF Hardening, Rights Policy &amp; Worker Cost Gate</span>
        </div>
        <p>
          URLs are never passed to shell commands. Loopback (<code className="text-[#F3EEE8]">127.0.0.0/8</code>, <code className="text-[#F3EEE8]">::1</code>), RFC1918 private networks (<code className="text-[#F3EEE8]">10.*</code>, <code className="text-[#F3EEE8]">172.16-31.*</code>, <code className="text-[#F3EEE8]">192.168.*</code>), link-local (<code className="text-[#F3EEE8]">169.254.*</code>), and cloud metadata endpoints (<code className="text-[#F3EEE8]">169.254.169.254</code>, <code className="text-[#F3EEE8]">metadata.google.internal</code>) are strictly blocked. Third-party social platforms require an authorized backend worker.
        </p>
      </div>

      <form
        onSubmit={handleDownloadSubmit}
        className="rounded-2xl border border-[#342A24] bg-[#11100F] p-5 space-y-4"
      >
        {/* URL Input + Paste Button */}
        <div className="space-y-1.5">
          <label htmlFor="downloader-url-input" className="text-xs font-medium text-[#B8AAA0]">
            Direct HTTPS Media URL (Owner-authorized assets only)
          </label>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              id="downloader-url-input"
              type="text"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                setValidationError(null);
              }}
              placeholder="https://example.com/authorized-footage.mp4"
              className="flex-1 min-h-[44px] rounded-xl border border-[#342A24] bg-[#191614] px-3.5 py-2 text-xs text-[#F3EEE8] placeholder:text-[#83766D]"
            />
            <button
              type="button"
              onClick={handlePasteClipboard}
              className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#342A24] bg-[#191614] hover:border-[#83766D] text-xs font-medium text-[#F3EEE8] whitespace-nowrap shrink-0"
            >
              <Clipboard className="w-3.5 h-3.5 text-[#F06424]" />
              <span>Paste</span>
            </button>
          </div>
        </div>

        {/* Live SSRF & Capability Status Pill */}
        {liveSsrfInspection && (
          <div
            className={`rounded-xl border p-3 text-xs font-mono-tabular flex flex-wrap items-center justify-between gap-2 ${
              liveSsrfInspection.allowed
                ? 'border-[#55B98B]/40 bg-[#55B98B]/10 text-[#55B98B]'
                : liveSsrfInspection.sourceStatus === 'Needs server worker setup'
                ? 'border-[#E4B45A]/40 bg-[#E4B45A]/10 text-[#E4B45A]'
                : 'border-[#F06464]/50 bg-[#F06464]/10 text-[#F06464]'
            }`}
          >
            <span>Status: {liveSsrfInspection.sourceStatus}</span>
            <span className="text-[11px] text-[#F3EEE8]">{liveSsrfInspection.reason}</span>
          </div>
        )}

        {/* Mode Selector: Video / Audio only / Thumbnail */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-[#B8AAA0]">Output Mode</span>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'video', label: 'Video' },
                { id: 'audio', label: 'Audio only' },
                { id: 'thumbnail', label: 'Thumbnail' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMode(opt.id)}
                className={`min-h-[44px] py-2 px-3 rounded-xl border text-xs font-semibold transition-colors ${
                  mode === opt.id
                    ? 'border-[#F06424] bg-[#F06424] text-[#080707]'
                    : 'border-[#342A24] bg-[#191614] text-[#B8AAA0] hover:text-[#F3EEE8]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Rights Confirmation */}
        <label className="flex items-start gap-2.5 text-xs text-[#B8AAA0] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={rightsConfirmed}
            onChange={(e) => {
              setRightsConfirmed(e.target.checked);
              setValidationError(null);
            }}
            className="mt-0.5 accent-[#F06424]"
          />
          <span>
            I confirm that I own the rights or have explicit license permission to download and use this media asset in my mobile project.
          </span>
        </label>

        {validationError && (
          <div className="rounded-xl border border-[#F06464]/50 bg-[#F06464]/10 px-3.5 py-2.5 text-xs text-[#F06464] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}

        <button
          type="submit"
          className="w-full min-h-[48px] py-2.5 px-4 rounded-xl bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-bold text-xs transition-colors flex items-center justify-center gap-2"
        >
          <Download className="w-4 h-4" />
          <span>Download ({mode === 'video' ? 'Video' : mode === 'audio' ? 'Audio only' : 'Thumbnail'})</span>
        </button>
      </form>

      {/* Phone-Local Media File Import & Magic-Byte Signature Verifier */}
      <div className="rounded-2xl border border-[#342A24] bg-[#11100F] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-[#F3EEE8]">
              Phone-Local Media Import &amp; Magic-Byte Inspector
            </h2>
            <p className="text-xs text-[#B8AAA0]">
              Import footage or audio from your phone storage and verify container magic bytes before adding to your workflow
            </p>
          </div>
          <span className="text-xs font-mono-tabular text-[#55B98B]">Available On-Device</span>
        </div>

        <label className="block cursor-pointer rounded-xl border border-dashed border-[#342A24] hover:border-[#F06424] bg-[#191614]/60 p-4 text-center transition-colors">
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
          <Upload className="w-5 h-5 text-[#F06424] mx-auto mb-1" />
          <div className="text-xs font-semibold text-[#F3EEE8]">
            Tap to inspect &amp; import a local phone file (MP4, WebM, WAV, MP3, PNG, JPEG, GLB)
          </div>
        </label>

        {localInspectResult && (
          <div
            className={`rounded-xl border p-3 text-xs font-mono-tabular space-y-1 ${
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
            <div>{localInspectResult.reason}</div>
          </div>
        )}
      </div>

      {/* Per-Source Capability Status Matrix */}
      <div className="rounded-2xl border border-[#342A24] bg-[#11100F] p-5 space-y-3">
        <div className="text-xs font-mono-tabular text-[#83766D]">
          PER-SOURCE CAPABILITY &amp; SECURITY MATRIX
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
          <div className="rounded-xl border border-[#342A24] bg-[#191614] p-3 space-y-1">
            <div className="font-mono-tabular text-[#55B98B] font-semibold">Available</div>
            <div className="font-semibold text-[#F3EEE8]">Direct HTTPS Media &amp; Phone Files</div>
            <p className="text-[11px] text-[#B8AAA0]">
              Public HTTPS <code className="text-[#F3EEE8]">.mp4</code>, <code className="text-[#F3EEE8]">.webm</code>, <code className="text-[#F3EEE8]">.wav</code>, <code className="text-[#F3EEE8]">.mp3</code>, <code className="text-[#F3EEE8]">.png</code> and phone file picker imports.
            </p>
          </div>
          <div className="rounded-xl border border-[#342A24] bg-[#191614] p-3 space-y-1">
            <div className="font-mono-tabular text-[#E4B45A] font-semibold">
              Needs server worker setup
            </div>
            <div className="font-semibold text-[#F3EEE8]">Third-Party Social Streams</div>
            <p className="text-[11px] text-[#B8AAA0]">
              YouTube, TikTok, Instagram, Vimeo &amp; X require an owner-approved backend extraction worker.
            </p>
          </div>
          <div className="rounded-xl border border-[#342A24] bg-[#191614] p-3 space-y-1">
            <div className="font-mono-tabular text-[#F06464] font-semibold">Blocked (SSRF Guard)</div>
            <div className="font-semibold text-[#F3EEE8]">Private IP / Metadata / Non-HTTPS</div>
            <p className="text-[11px] text-[#B8AAA0]">
              <code className="text-[#F3EEE8]">http://</code>, <code className="text-[#F3EEE8]">file://</code>, <code className="text-[#F3EEE8]">localhost</code>, <code className="text-[#F3EEE8]">10.*</code>, <code className="text-[#F3EEE8]">192.168.*</code>, <code className="text-[#F3EEE8]">169.254.169.254</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 3. PROJECT LIBRARY WORKSPACE (WITH VERSION CHECKPOINTS & DUPLICATE)
// ============================================================================

interface ProjectLibraryWorkspaceProps {
  projects: ProjectLibraryItem[];
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetryLoad?: () => void;
  onAddProject: (proj: Omit<ProjectLibraryItem, 'id' | 'updatedAt'>) => Promise<void> | void;
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
  const [sortBy, setSortBy] = useState<'title' | 'updated' | 'status'>('title');
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

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(rawSearch.trim().toLowerCase()), 180);
    return () => window.clearTimeout(t);
  }, [rawSearch]);

  const activeCount = useMemo(() => projects.filter((p) => !p.archived).length, [projects]);
  const archivedCount = useMemo(() => projects.filter((p) => p.archived).length, [projects]);

  const filtered = useMemo(() => {
    return projects
      .filter((p) => {
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
      })
      .sort((a, b) => {
        if (sortBy === 'updated') {
          return b.updatedAt.localeCompare(a.updatedAt);
        }
        if (sortBy === 'status') {
          return a.projectFileStatus.localeCompare(b.projectFileStatus);
        }
        return a.title.localeCompare(b.title);
      });
  }, [projects, archiveFilter, debouncedSearch, sortBy]);

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

    await onAddProject({
      title: newTitle.trim(),
      description:
        newDesc.trim() ||
        (newFormatStatus === 'sowveil-native'
          ? 'Reusable Sowveil Mobile Project (.sowveil.json) ready for Android export and handoff.'
          : 'User-saved project metadata record (no binary uploaded to cloud storage).'),
      compCount: parsedComps,
      projectFileStatus: newFormatStatus,
      fileSizeBytes: newFormatStatus === 'sowveil-native' ? specJson.length : null,
      fileSizeLabel:
        newFormatStatus === 'sowveil-native'
          ? `${(specJson.length / 1024).toFixed(1)} KB (.sowveil.json)`
          : 'Unknown (metadata-only)',
      resolution: newResolution.trim() || undefined,
      targetEditor: newTargetEditor,
      aspectRatio: '9:16',
      sowveilSpecJson: newFormatStatus === 'sowveil-native' ? specJson : undefined,
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
    onNotify(`Saved project "${newTitle.trim()}" (${newFormatStatus}).`, 'success');
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="h-32 rounded-xl bg-[#191614] animate-pulse" />
          <div className="h-32 rounded-xl bg-[#191614] animate-pulse" />
          <div className="h-32 rounded-xl bg-[#191614] animate-pulse" />
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
    <div className="p-4 sm:p-6 space-y-5">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-[#83766D] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            placeholder="Search mobile projects, .sowveil.json, .xml, or comps…"
            aria-label="Search projects and comps"
            className="w-full min-h-[44px] rounded-xl border border-[#342A24] bg-[#11100F] pl-9 pr-8 py-2 text-xs text-[#F3EEE8] placeholder:text-[#83766D]"
          />
          {rawSearch && (
            <button
              type="button"
              onClick={() => setRawSearch('')}
              aria-label="Clear project search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#83766D] hover:text-[#F3EEE8]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'title' | 'updated' | 'status')}
            aria-label="Sort projects"
            className="min-h-[44px] rounded-xl border border-[#342A24] bg-[#11100F] px-2.5 py-2 text-xs text-[#B8AAA0]"
          >
            <option value="title">Sort: Title (A–Z)</option>
            <option value="updated">Sort: Recently updated</option>
            <option value="status">Sort: Project format</option>
          </select>

          <button
            type="button"
            onClick={() => setShowAddModal((v) => !v)}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-semibold text-xs transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Save Mobile Project</span>
          </button>

          <label className="min-h-[44px] cursor-pointer inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#342A24] bg-[#191614] hover:border-[#F06424] text-[#F3EEE8] font-medium text-xs transition-colors whitespace-nowrap shrink-0">
            <FolderPlus className="w-3.5 h-3.5 text-[#F06424]" />
            <span>Import .sowveil.json / .xml / .aep</span>
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
                  await onAddProject({
                    title:
                      check.parsed?.composition.title ||
                      file.name.replace(/\.sowveil\.json$|\.json$/i, ''),
                    description: check.valid
                      ? `Imported verified Sowveil Mobile Project (${file.name}).`
                      : `Imported JSON project document (${file.name}).`,
                    compCount: 1,
                    projectFileStatus: 'sowveil-native',
                    fileSizeBytes: file.size,
                    fileSizeLabel: `${(file.size / 1024).toFixed(1)} KB (.sowveil.json)`,
                    resolution: check.parsed
                      ? `${check.parsed.composition.width} × ${check.parsed.composition.height}`
                      : '1080 × 1920',
                    targetEditor: check.parsed?.targetEditor || 'sowveil-project',
                    sowveilSpecJson: text.slice(0, 14000),
                    hasExternalFootageWarning: false,
                    archived: false,
                    tags: ['Imported .sowveil.json', 'Mobile Native'],
                  });
                  onNotify(`Imported reusable mobile project "${file.name}".`, 'success');
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
                    fileSizeLabel: `${(file.size / 1024).toFixed(1)} KB (.xml)`,
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
                  fileSizeLabel: `${(file.size / 1024).toFixed(1)} KB (local file)`,
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
        </div>
      </div>

      {/* Scope Filter Tabs (Active / Archived / All) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setArchiveFilter('active')}
            className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-medium tabular-nums ${
              archiveFilter === 'active'
                ? 'bg-[#F06424] text-[#080707] font-semibold'
                : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24]'
            }`}
          >
            Active {activeCount}
          </button>
          <button
            type="button"
            onClick={() => setArchiveFilter('archived')}
            className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-medium tabular-nums ${
              archiveFilter === 'archived'
                ? 'bg-[#F06424] text-[#080707] font-semibold'
                : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24]'
            }`}
          >
            Archived {archivedCount}
          </button>
          <button
            type="button"
            onClick={() => setArchiveFilter('all')}
            className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-medium tabular-nums ${
              archiveFilter === 'all'
                ? 'bg-[#F06424] text-[#080707] font-semibold'
                : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24]'
            }`}
          >
            All {projects.length}
          </button>
        </div>
        <span className="text-xs font-mono-tabular text-[#83766D]">
          Editable .sowveil.json documents are stored separately from rendered media outputs
        </span>
      </div>

      {showAddModal && (
        <form
          onSubmit={handleCreateProjectRecord}
          className="rounded-2xl border border-[#F06424]/50 bg-[#191614] p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-[#F3EEE8]">
              Create Reusable Mobile Project or Metadata Record
            </h3>
            <span className="text-[11px] font-mono-tabular text-[#B8AAA0]">
              Leave comp count blank if uninspected (never invented)
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <input
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Project title *"
              className="min-h-[42px] rounded-xl border border-[#342A24] bg-[#11100F] px-3 py-2 text-xs text-[#F3EEE8]"
            />
            <select
              value={newFormatStatus}
              onChange={(e) => setNewFormatStatus(e.target.value as ProjectFileStatus)}
              className="min-h-[42px] rounded-xl border border-[#342A24] bg-[#11100F] px-3 py-2 text-xs text-[#F3EEE8]"
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
              className="min-h-[42px] rounded-xl border border-[#342A24] bg-[#11100F] px-3 py-2 text-xs text-[#F3EEE8]"
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
              className="min-h-[42px] rounded-xl border border-[#342A24] bg-[#11100F] px-3 py-2 text-xs text-[#F3EEE8] font-mono-tabular"
            />
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newResolution}
                onChange={(e) => setNewResolution(e.target.value)}
                placeholder="Res (e.g. 1080 × 1920)"
                className="flex-1 min-h-[42px] rounded-xl border border-[#342A24] bg-[#11100F] px-3 py-2 text-xs text-[#F3EEE8]"
              />
              <button
                type="submit"
                className="min-h-[42px] py-2 px-4 rounded-xl bg-[#F06424] text-[#080707] font-semibold text-xs whitespace-nowrap"
              >
                Save
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7">
          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-[#342A24] bg-[#11100F] p-8 text-center space-y-2">
              <p className="text-sm font-semibold text-[#F3EEE8]">
                No project records match your current view
              </p>
              <p className="text-xs text-[#B8AAA0]">
                {debouncedSearch
                  ? `No project titles, descriptions, or tags matched "${debouncedSearch}".`
                  : archiveFilter === 'archived'
                  ? 'No archived projects found.'
                  : 'Tap "+ Save Mobile Project" or import a .sowveil.json / .xml file.'}
              </p>
              {(debouncedSearch || archiveFilter !== 'active') && (
                <button
                  type="button"
                  onClick={() => {
                    setRawSearch('');
                    setArchiveFilter('active');
                  }}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-[#191614] border border-[#342A24] text-xs font-medium text-[#F3EEE8]"
                >
                  Reset filters
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {filtered.map((proj) => {
                const isSelected = activeProject?.id === proj.id;
                const isEditableDoc =
                  proj.projectFileStatus === 'sowveil-native' ||
                  proj.projectFileStatus === 'alight-motion-xml';
                return (
                  <div
                    key={proj.id}
                    onClick={() => setSelectedProjId(proj.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setSelectedProjId(proj.id);
                    }}
                    className={`group text-left rounded-2xl border p-4 transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-[#F06424] bg-[#211B17]'
                        : 'border-[#342A24] bg-[#11100F] hover:border-[#83766D]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono-tabular text-[#B8AAA0]">
                      <span>
                        {proj.compCount !== null && proj.compCount !== undefined
                          ? `${proj.compCount} comps`
                          : 'Comps: Unknown'}
                      </span>
                      <span className="text-[#55B98B]">{proj.projectFileStatus}</span>
                    </div>
                    <div className="my-3 py-2 rounded-lg bg-[#191614] border border-[#342A24]/60 text-center font-mono-tabular text-[11px] tracking-wider text-[#B8AAA0] uppercase">
                      {proj.archived
                        ? 'ARCHIVED PROJECT'
                        : isEditableDoc
                        ? `EDITABLE DOC · ${(proj.targetEditor || 'MOBILE').toUpperCase()}`
                        : 'METADATA / RENDERED REF'}
                    </div>
                    <div className="font-semibold text-xs text-[#F3EEE8] truncate">
                      {proj.title}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] font-mono-tabular text-[#83766D]">
                      <span className="truncate">{proj.fileSizeLabel}</span>
                      {proj.checkpoints && proj.checkpoints.length > 0 && (
                        <span className="text-[#FFC08C] shrink-0">
                          {proj.checkpoints.length} chk
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Project Detail, Version Checkpoints & Mobile Export Inspector */}
        <div className="lg:col-span-5">
          {activeProject ? (
            <div className="rounded-2xl border border-[#342A24] bg-[#11100F] p-5 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-mono-tabular text-[#55B98B]">
                    {activeProject.projectFileStatus.toUpperCase()} RECORD
                    {activeProject.archived ? ' · ARCHIVED' : ''}
                  </div>
                  <h3 className="mt-1 text-base font-bold text-[#F3EEE8]">
                    {activeProject.title}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleDuplicateProject(activeProject)}
                    title="Duplicate project"
                    className="min-h-[38px] inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border border-[#342A24] bg-[#191614] text-xs text-[#B8AAA0] hover:text-[#F3EEE8]"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Duplicate</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingDetails((v) => !v)}
                    className="min-h-[38px] inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border border-[#342A24] bg-[#191614] text-xs text-[#B8AAA0] hover:text-[#F3EEE8]"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>{isEditingDetails ? 'Cancel' : 'Edit'}</span>
                  </button>
                </div>
              </div>

              {isEditingDetails ? (
                <form
                  onSubmit={handleSaveDetailsEdit}
                  className="space-y-3 pt-2 border-t border-[#342A24]"
                >
                  <label className="block space-y-1 text-xs">
                    <span className="text-[#B8AAA0]">Title</span>
                    <input
                      type="text"
                      required
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs text-[#F3EEE8]"
                    />
                  </label>
                  <label className="block space-y-1 text-xs">
                    <span className="text-[#B8AAA0]">Description</span>
                    <textarea
                      rows={3}
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs text-[#F3EEE8]"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block space-y-1 text-xs">
                      <span className="text-[#B8AAA0]">Comps (blank = Unknown)</span>
                      <input
                        type="number"
                        min={0}
                        value={editCompCountInput}
                        onChange={(e) => setEditCompCountInput(e.target.value)}
                        className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-2.5 py-1.5 text-xs text-[#F3EEE8] font-mono-tabular"
                      />
                    </label>
                    <label className="block space-y-1 text-xs">
                      <span className="text-[#B8AAA0]">Resolution</span>
                      <input
                        type="text"
                        value={editResolution}
                        onChange={(e) => setEditResolution(e.target.value)}
                        placeholder="1080 × 1920"
                        className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
                      />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[#B8AAA0] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editExternalWarning}
                      onChange={(e) => setEditExternalWarning(e.target.checked)}
                      className="accent-[#F06424]"
                    />
                    <span>Warn about external local footage paths</span>
                  </label>
                  <button
                    type="submit"
                    className="w-full min-h-[42px] py-2 rounded-xl bg-[#F06424] text-[#080707] font-semibold text-xs"
                  >
                    Save Changes
                  </button>
                </form>
              ) : (
                <>
                  <p className="text-xs text-[#B8AAA0] leading-relaxed">
                    {activeProject.description}
                  </p>

                  <div className="space-y-2 pt-3 border-t border-[#342A24] text-xs font-mono-tabular">
                    <div className="flex justify-between">
                      <span className="text-[#83766D]">Document vs. Media</span>
                      <span className="text-[#F3EEE8]">
                        {activeProject.projectFileStatus === 'sowveil-native' ||
                        activeProject.projectFileStatus === 'alight-motion-xml'
                          ? 'Editable Project Document'
                          : 'Metadata / Rendered Bundle'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#83766D]">Storage Status</span>
                      <span className="text-[#55B98B]">
                        {activeProject.ownerUid
                          ? 'Cloud Firestore Synced (No Binary Bucket)'
                          : 'Session Document'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#83766D]">Compositions</span>
                      <span className="text-[#F3EEE8]">
                        {activeProject.compCount !== null &&
                        activeProject.compCount !== undefined
                          ? activeProject.compCount
                          : 'Unknown (not inspected)'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#83766D]">Resolution</span>
                      <span className="text-[#F3EEE8]">
                        {activeProject.resolution || '1080 × 1920'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#83766D]">File Size</span>
                      <span className="text-[#F3EEE8]">{activeProject.fileSizeLabel}</span>
                    </div>
                  </div>

                  {/* Version History & Checkpoints */}
                  <div className="rounded-xl border border-[#342A24] bg-[#191614] p-3.5 space-y-2.5 text-xs">
                    <div className="flex items-center justify-between font-mono-tabular">
                      <span className="text-[#83766D] flex items-center gap-1.5">
                        <History className="w-3.5 h-3.5 text-[#F06424]" />
                        <span>VERSION CHECKPOINTS ({activeProject.checkpoints?.length || 0})</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={checkpointLabelInput}
                        onChange={(e) => setCheckpointLabelInput(e.target.value)}
                        placeholder="Checkpoint label (e.g. Before color tweak)…"
                        className="flex-1 min-h-[36px] rounded-lg border border-[#342A24] bg-[#11100F] px-2.5 py-1 text-xs text-[#F3EEE8]"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveCheckpoint(activeProject)}
                        className="min-h-[36px] px-3 py-1 rounded-lg bg-[#F06424] text-[#080707] font-semibold text-xs whitespace-nowrap"
                      >
                        + Checkpoint
                      </button>
                    </div>

                    {activeProject.checkpoints && activeProject.checkpoints.length > 0 && (
                      <div className="space-y-1.5 max-h-28 overflow-y-auto pt-1">
                        {activeProject.checkpoints.map((chk) => (
                          <div
                            key={chk.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-[#342A24] bg-[#11100F] px-2.5 py-1.5 text-[11px] font-mono-tabular"
                          >
                            <div className="truncate">
                              <span className="text-[#F3EEE8] font-medium">{chk.label}</span>
                              <span className="text-[#83766D] ml-1.5">
                                {chk.createdAt.slice(0, 16).replace('T', ' ')}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRestoreCheckpoint(activeProject, chk)}
                              className="text-[#55B98B] hover:underline shrink-0"
                            >
                              Restore
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {activeProject.hasExternalFootageWarning && (
                    <div className="rounded-xl border border-[#E4B45A]/40 bg-[#E4B45A]/10 p-3 text-xs text-[#E4B45A] flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        External footage dependency warning: Legacy .aep reference points to local files; export as .sowveil.json for portable mobile use.
                      </span>
                    </div>
                  )}

                  {/* Mobile Export & Archive/Delete Controls */}
                  <div className="pt-2 space-y-2">
                    <button
                      type="button"
                      onClick={() => handleDownloadMobileProjectFile(activeProject)}
                      className="w-full min-h-[44px] py-2.5 px-3 rounded-xl bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-bold text-xs inline-flex items-center justify-center gap-2 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download .sowveil.json Project</span>
                    </button>

                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const nextState = !activeProject.archived;
                          onUpdateProject(activeProject.id, { archived: nextState });
                          onNotify(
                            nextState
                              ? `Archived "${activeProject.title}".`
                              : `Restored "${activeProject.title}" to Active projects.`,
                            'info'
                          );
                        }}
                        className="flex-1 min-h-[42px] inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#191614] border border-[#342A24] hover:border-[#83766D] text-xs font-medium text-[#F3EEE8]"
                      >
                        <Archive className="w-3.5 h-3.5 text-[#B8AAA0]" />
                        <span>{activeProject.archived ? 'Restore Project' : 'Archive'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(activeProject.id)}
                        aria-label={`Delete ${activeProject.title}`}
                        className="min-h-[42px] px-3 py-2 rounded-xl border border-[#342A24] text-[#F06464] hover:bg-[#F06464]/10 text-xs font-medium inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </div>

                    {confirmDeleteId === activeProject.id && (
                      <div className="rounded-xl border border-[#F06464] bg-[#F06464]/10 p-3 space-y-2 text-xs">
                        <div className="font-semibold text-[#F3EEE8]">
                          Confirm permanent deletion of “{activeProject.title}”?
                        </div>
                        <p className="text-[#B8AAA0]">
                          This removes the project record from your Project Library.
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteProject(activeProject.id);
                              setConfirmDeleteId(null);
                              onNotify(
                                `Deleted "${activeProject.title}" from Project Library.`,
                                'info'
                              );
                            }}
                            className="px-3 py-1.5 rounded bg-[#F06464] text-[#080707] font-semibold"
                          >
                            Confirm Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-3 py-1.5 rounded border border-[#342A24] bg-[#11100F] text-[#B8AAA0]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-[#342A24] bg-[#11100F] p-6 text-center text-xs text-[#83766D]">
              Select a project card to inspect or export its mobile project document.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
