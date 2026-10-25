import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CatalogItem } from '../types/sowveil';
import {
  buildMotionDocumentFromCatalogItem,
  generateProceduralSfxWavBytes,
} from '../services/editorGateway';
import {
  AUTHORIZED_MOBILE_FONTS,
  evaluateExpressionPresetMath,
  extractWavWaveformPeaks,
  getFontFallbackNotice,
} from '../features/media-workflows/index';
import {
  AlertTriangle,
  Eye,
  Layers,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Volume2,
  VolumeX,
} from 'lucide-react';

interface PreviewRendererProps {
  item: CatalogItem;
  comparisonMode: 'template' | 'edits';
  customValues: Record<string, string | number | boolean>;
  reducedMotion?: boolean;
}

export const PreviewRenderer: React.FC<PreviewRendererProps> = ({
  item,
  comparisonMode,
  customValues,
  reducedMotion = false,
}) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(!reducedMotion);
  const [tick, setTick] = useState<number>(0);
  const [previewQualityMode, setPreviewQualityMode] = useState<
    'mobile-half' | 'full' | 'still-fallback'
  >(reducedMotion ? 'still-fallback' : 'mobile-half');
  const [showLayerInspector, setShowLayerInspector] = useState<boolean>(false);
  const [pausedByVisibility, setPausedByVisibility] = useState<boolean>(false);

  // Audio playback state for SFX module
  const [audioVolume, setAudioVolume] = useState<number>(0.8);
  const [isAudioPlaying, setIsAudioPlaying] = useState<boolean>(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setIsPlaying(!reducedMotion);
    setPreviewQualityMode(reducedMotion ? 'still-fallback' : 'mobile-half');
    setTick(0);
  }, [reducedMotion, item.id]);

  // Automatically pause expensive preview loops when page/app is hidden or backgrounded
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setIsPlaying(false);
        setPausedByVisibility(true);
        if (audioRef.current) {
          audioRef.current.pause();
          setIsAudioPlaying(false);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Release audio resources when item changes or component unmounts
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
        audioObjectUrlRef.current = null;
      }
      setIsAudioPlaying(false);
    };
  }, [item.id]);

  useEffect(() => {
    if (!isPlaying || previewQualityMode === 'still-fallback') return;
    const intervalMs = previewQualityMode === 'mobile-half' ? 60 : 33;
    const interval = window.setInterval(() => {
      setTick((prev) => (prev + 1) % 120);
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, [isPlaying, previewQualityMode]);

  const getVal = <T extends string | number | boolean>(key: string, fallback: T): T => {
    if (comparisonMode === 'template') {
      const def = item.editableParams?.find((p) => p.key === key)?.defaultValue;
      return (def !== undefined ? def : fallback) as T;
    }
    const v = customValues[key];
    return (v !== undefined ? v : fallback) as T;
  };

  const durationSec = Number(
    getVal('durationSec', item.metadata.durationSec || 3)
  );
  const fps = item.metadata.fps || 60;
  const progress = previewQualityMode === 'still-fallback' ? 0.5 : (tick % 60) / 60;
  const currentTimeSec = Number((progress * durationSec).toFixed(2));

  // Build portable MotionDocument for the current item & custom edits
  const motionDocument = useMemo(
    () =>
      buildMotionDocumentFromCatalogItem(
        item,
        comparisonMode === 'edits' ? customValues : {},
        {
          aspectRatio: '9:16',
          durationSec,
          fps: (fps === 24 || fps === 30 || fps === 60 ? fps : 60) as 24 | 30 | 60,
        }
      ),
    [item, comparisonMode, customValues, durationSec, fps]
  );

  // Real PCM WAV generation and waveform extraction for SFX items
  const sfxWavData = useMemo(() => {
    if (item.moduleId !== 'sfx' && item.previewKind !== 'sfx-waveform') return null;
    const bytes = generateProceduralSfxWavBytes(item);
    const peaks = extractWavWaveformPeaks(bytes, 28);
    return {
      bytes,
      peaks,
      sizeBytes: bytes.byteLength,
    };
  }, [item]);

  const handleToggleSfxAudio = () => {
    if (!sfxWavData) return;
    if (isAudioPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsAudioPlaying(false);
      return;
    }

    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
    }
    const blob = new Blob([new Uint8Array(sfxWavData.bytes)], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    audioObjectUrlRef.current = url;

    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, audioVolume));
    audio.onended = () => setIsAudioPlaying(false);
    audio.onerror = () => setIsAudioPlaying(false);
    audioRef.current = audio;
    setIsAudioPlaying(true);
    setIsPlaying(true);
    audio.play().catch(() => {
      setIsAudioPlaying(false);
    });
  };

  // Text Animation extended styling parameters
  const selectedFontFamily = String(getVal('fontFamily', 'Space Grotesk'));
  const fontFallbackInfo = useMemo(
    () => getFontFallbackNotice(selectedFontFamily),
    [selectedFontFamily]
  );
  const textFillColor = String(getVal('fillColor', '#F3EEE8'));
  const textStrokeColor = String(getVal('strokeColor', 'transparent'));
  const textAlignMode = String(getVal('textAlign', 'center')) as
    | 'left'
    | 'center'
    | 'right';
  const textUnitMode = String(getVal('unitMode', 'word')) as
    | 'word'
    | 'character'
    | 'line';
  const entryExitMode = String(getVal('entryExitMode', 'Entry only'));
  const bgAlphaStrategy = String(getVal('backgroundMode', 'solid'));

  const bgSurfaceStyle: React.CSSProperties =
    bgAlphaStrategy === 'chroma-key-green'
      ? { backgroundColor: '#00B140' }
      : bgAlphaStrategy === 'transparent'
      ? {
          backgroundImage:
            'linear-gradient(45deg, #181513 25%, transparent 25%), linear-gradient(-45deg, #181513 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #181513 75%), linear-gradient(-45deg, transparent 75%, #181513 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
        }
      : {};

  // Compute entry/exit envelope when user selects Entry + Hold + Exit
  const envelopeFactor =
    entryExitMode === 'Entry + Hold + Exit' && progress > 0.78
      ? Math.max(0, 1 - (progress - 0.78) / 0.22)
      : 1;

  const renderVisualSurface = () => {
    switch (item.previewKind) {
      case 'text-rise-up': {
        const text = String(getVal('previewText', 'Make it move'));
        const tokens =
          textUnitMode === 'character'
            ? text.split('')
            : textUnitMode === 'line'
            ? [text]
            : text.split(' ');
        return (
          <div
            style={bgSurfaceStyle}
            className="flex flex-col items-center justify-center h-full px-6 select-none"
          >
            <div
              style={{
                fontFamily: selectedFontFamily,
                textAlign: textAlignMode,
                color: textFillColor,
                WebkitTextStroke:
                  textStrokeColor !== 'transparent' ? `1px ${textStrokeColor}` : undefined,
              }}
              className={`flex flex-wrap items-center ${
                textAlignMode === 'left'
                  ? 'justify-start'
                  : textAlignMode === 'right'
                  ? 'justify-end'
                  : 'justify-center'
              } ${textUnitMode === 'character' ? 'gap-x-0.5' : 'gap-x-3'} gap-y-1 text-3xl sm:text-4xl font-bold tracking-tight w-full`}
            >
              {tokens.map((tok, idx) => {
                const delay = idx * (textUnitMode === 'character' ? 0.04 : 0.14);
                const localP =
                  Math.max(0, Math.min(1, (progress * 1.6 - delay) * 2.2)) *
                  envelopeFactor;
                const easeOut = 1 - Math.pow(1 - localP, 3);
                const translateY = isPlaying ? (1 - easeOut) * 26 : 0;
                const opacity = isPlaying ? Math.max(0.15, easeOut) : 1;
                return (
                  <span
                    key={`${tok}-${idx}`}
                    style={{
                      transform: `translateY(${translateY.toFixed(1)}px)`,
                      opacity: opacity.toFixed(2),
                    }}
                    className="inline-block whitespace-pre transition-transform duration-75"
                  >
                    {tok}
                  </span>
                );
              })}
            </div>
          </div>
        );
      }

      case 'text-soft-focus': {
        const text = String(getVal('previewText', 'Make it move'));
        const maxBlur = Number(getVal('maxBlur', 12));
        return (
          <div
            style={bgSurfaceStyle}
            className="flex items-center justify-center h-full px-6 select-none"
          >
            <div
              style={{ fontFamily: selectedFontFamily, color: textFillColor }}
              className="flex flex-wrap justify-center text-3xl sm:text-4xl font-bold tracking-tight"
            >
              {text.split('').map((ch, idx) => {
                const charDelay = idx * 0.045;
                const localP =
                  Math.max(0, Math.min(1, (progress * 1.7 - charDelay) * 2.1)) *
                  envelopeFactor;
                const ease = 1 - Math.pow(1 - localP, 3);
                const blur = isPlaying ? (1 - ease) * maxBlur : 0;
                const scale = isPlaying ? 1 + (1 - ease) * 0.16 : 1;
                return (
                  <span
                    key={`${ch}-${idx}`}
                    style={{
                      filter: `blur(${blur.toFixed(1)}px)`,
                      transform: `scale(${scale.toFixed(3)})`,
                      opacity: isPlaying ? Math.max(0.25, ease) : 1,
                    }}
                    className="inline-block whitespace-pre"
                  >
                    {ch}
                  </span>
                );
              })}
            </div>
          </div>
        );
      }

      case 'text-pop': {
        const text = String(getVal('previewText', 'Make it move'));
        return (
          <div
            style={bgSurfaceStyle}
            className="flex items-center justify-center h-full px-6 select-none"
          >
            <div
              style={{ fontFamily: selectedFontFamily, color: textFillColor }}
              className="flex flex-wrap justify-center text-3xl sm:text-4xl font-bold tracking-tight"
            >
              {text.split('').map((ch, idx) => {
                const charDelay = idx * 0.05;
                const localP =
                  Math.max(0, Math.min(1, (progress * 1.8 - charDelay) * 2.4)) *
                  envelopeFactor;
                const overshoot =
                  localP === 0
                    ? 0.4
                    : localP < 0.7
                    ? 0.4 + (localP / 0.7) * 0.82
                    : 1.22 - ((localP - 0.7) / 0.3) * 0.22;
                const scale = isPlaying ? overshoot : 1;
                return (
                  <span
                    key={`${ch}-${idx}`}
                    style={{
                      transform: `scale(${scale.toFixed(2)})`,
                      opacity: isPlaying ? Math.min(1, localP * 2 + 0.2) : 1,
                    }}
                    className="inline-block whitespace-pre"
                  >
                    {ch}
                  </span>
                );
              })}
            </div>
          </div>
        );
      }

      case 'text-slide-in': {
        const text = String(getVal('previewText', 'Make it move'));
        const ease =
          (1 - Math.pow(1 - Math.min(1, progress * 1.5), 3)) * envelopeFactor;
        const offset = isPlaying ? (1 - ease) * -64 : 0;
        return (
          <div
            style={bgSurfaceStyle}
            className="flex items-center justify-center h-full px-6 select-none overflow-hidden"
          >
            <div
              style={{
                fontFamily: selectedFontFamily,
                color: textFillColor,
                transform: `translateX(${offset.toFixed(1)}px)`,
                opacity: isPlaying ? Math.max(0.2, ease) : 1,
              }}
              className="text-3xl sm:text-4xl font-bold tracking-tight"
            >
              {text}
            </div>
          </div>
        );
      }

      case 'text-shine': {
        const text = String(getVal('previewText', 'Make it move'));
        const sweepPos = Math.round(progress * 200 - 50);
        return (
          <div
            style={bgSurfaceStyle}
            className="flex items-center justify-center h-full px-6 select-none"
          >
            <div
              style={{
                fontFamily: selectedFontFamily,
                backgroundImage: `linear-gradient(110deg, ${textFillColor} ${sweepPos - 25}%, #FF9E6D ${sweepPos}%, ${textFillColor} ${sweepPos + 25}%)`,
                WebkitBackgroundClip: 'text',
                color: 'transparent',
              }}
              className="text-3xl sm:text-4xl font-bold tracking-tight"
            >
              {text}
            </div>
          </div>
        );
      }

      case 'text-decode': {
        const target = String(getVal('previewText', 'SYSTEM DECODED'));
        const glyphs = '01#$%&*+<>?@X';
        const lockIndex = isPlaying ? Math.floor(progress * (target.length + 4)) : target.length;
        const rendered = target
          .split('')
          .map((ch, idx) => {
            if (ch === ' ') return ' ';
            if (idx <= lockIndex) return ch;
            return glyphs[(idx + tick) % glyphs.length];
          })
          .join('');
        return (
          <div
            style={bgSurfaceStyle}
            className="flex flex-col items-center justify-center h-full px-6 select-none"
          >
            <div className="font-mono-tabular text-2xl sm:text-3xl font-semibold tracking-widest text-[#F06424]">
              {rendered}
            </div>
            <span className="mt-2 text-xs text-[#83766D] font-mono-tabular">
              SourceText · Character Cipher Lock
            </span>
          </div>
        );
      }

      case 'text-cyber-security': {
        const headline = String(getVal('headlineText', 'CYBER SECURITY'));
        const glowColor = String(getVal('glowColor', '#38F858'));
        return (
          <div className="flex flex-col items-center justify-center h-full px-6 bg-[#070B08] select-none">
            <div
              style={{
                color: glowColor,
                textShadow: `0 0 18px ${glowColor}66, 0 0 4px ${glowColor}`,
              }}
              className="font-mono-tabular text-2xl sm:text-3xl font-bold tracking-[0.18em] text-center"
            >
              {headline}
            </div>
            <div className="mt-3 h-0.5 w-32 bg-white/10 overflow-hidden">
              <div
                style={{
                  backgroundColor: glowColor,
                  transform: `translateX(${(progress * 100 - 30).toFixed(0)}%)`,
                }}
                className="h-full w-1/2"
              />
            </div>
          </div>
        );
      }

      case 'text-ge-title': {
        const copy = String(getVal('headlineText', 'Precision motion presets for modern timelines'));
        const accent = String(getVal('accentColor', '#F06424'));
        return (
          <div className="flex items-center justify-center h-full p-6 select-none">
            <div
              style={{
                borderColor: accent,
                boxShadow: `0 0 28px -6px ${accent}55`,
              }}
              className="max-w-xs w-full rounded-xl border bg-[#11100F]/90 p-5 text-center"
            >
              <p className="text-sm sm:text-base font-semibold text-[#F3EEE8] leading-snug">
                {copy}
              </p>
              <div
                style={{ backgroundColor: accent }}
                className="mx-auto mt-3 h-1 w-16 rounded-full"
              />
            </div>
          </div>
        );
      }

      case 'text-modern-title': {
        const title = String(getVal('headlineText', 'MOTION'));
        const ruleColor = String(getVal('ruleColor', '#E4B45A'));
        const ruleScale = isPlaying ? 0.35 + 0.65 * Math.sin(progress * Math.PI) : 1;
        return (
          <div className="flex flex-col items-center justify-center h-full px-6 select-none">
            <div
              style={{ backgroundColor: ruleColor, transform: `scaleX(${ruleScale.toFixed(2)})` }}
              className="h-[2px] w-48 mb-2 transition-transform"
            />
            <div className="text-3xl sm:text-4xl font-bold tracking-[0.22em] text-[#F3EEE8]">
              {title}
            </div>
            <div
              style={{ backgroundColor: ruleColor, transform: `scaleX(${ruleScale.toFixed(2)})` }}
              className="h-[2px] w-48 mt-2 transition-transform"
            />
          </div>
        );
      }

      case 'expression-sine-wave':
      case 'expression-wiggle':
      case 'expression-bounce':
      case 'expression-loop-out':
      case 'expression-spin': {
        const freq = Number(getVal('frequency', 1.8));
        const amp = Number(getVal('amplitude', 34));
        const evalResult = evaluateExpressionPresetMath(
          item.slug || item.previewKind,
          isPlaying ? currentTimeSec : 0.4,
          { frequency: freq, amplitude: amp }
        );

        return (
          <div className="relative flex items-center justify-center h-full w-full overflow-hidden select-none">
            <div
              className="absolute inset-0 opacity-25"
              style={{
                backgroundImage:
                  'linear-gradient(to right, #342A24 1px, transparent 1px), linear-gradient(to bottom, #342A24 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }}
            />
            <div className="absolute top-2.5 left-3 right-3 flex items-center justify-between text-[11px] font-mono-tabular text-[#B8AAA0]">
              <span className="truncate max-w-[65%]">{evalResult.formulaSummary}</span>
              <span className="text-[#FFC08C]">
                dx:{evalResult.dx.toFixed(0)} dy:{evalResult.dy.toFixed(0)}
              </span>
            </div>
            <div
              style={{
                transform: `translate(${evalResult.dx.toFixed(1)}px, ${evalResult.dy.toFixed(1)}px) scale(${evalResult.scaleX.toFixed(2)}, ${evalResult.scaleY.toFixed(2)}) rotate(${evalResult.rotationDeg.toFixed(0)}deg)`,
              }}
              className="w-14 h-14 rounded-xl bg-[#F06424] shadow-[0_0_24px_rgba(240,100,36,0.45)] flex items-center justify-center"
            >
              <div className="w-2 h-2 rounded-full bg-[#080707]" />
            </div>
            <div className="absolute bottom-2 left-3 right-3 text-[10px] font-mono-tabular text-[#83766D] text-center truncate">
              Deterministic Math Engine · Exports baked curves (.xml) or .sowveil.json
            </div>
          </div>
        );
      }

      case 'easing-curve': {
        const [defX1, defY1, defX2, defY2] = item.metadata.curvePoints || [0.16, 1, 0.3, 1];
        const x1 = Number(getVal('x1', defX1));
        const y1 = Number(getVal('y1', defY1));
        const x2 = Number(getVal('x2', defX2));
        const y2 = Number(getVal('y2', defY2));

        const sx = (v: number) => 24 + v * 152;
        const sy = (v: number) => 122 - v * 96;
        const pathD = `M ${sx(0)} ${sy(0)} C ${sx(x1)} ${sy(y1)}, ${sx(x2)} ${sy(y2)}, ${sx(1)} ${sy(1)}`;

        // Evaluate cubic-bezier point at current progress t
        const t = progress;
        const mt = 1 - t;
        const bx = 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t;
        const by = 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t;

        return (
          <div className="flex flex-col items-center justify-center h-full w-full p-4 select-none">
            <svg viewBox="0 0 200 144" className="w-full max-w-[260px] h-36 overflow-visible">
              <rect x="24" y="26" width="152" height="96" fill="#11100F" stroke="#342A24" strokeWidth="1" />
              <line x1="24" y1="74" x2="176" y2="74" stroke="#211B17" strokeDasharray="3 3" />
              <line x1="100" y1="26" x2="100" y2="122" stroke="#211B17" strokeDasharray="3 3" />
              {/* Control handles */}
              <line x1={sx(0)} y1={sy(0)} x2={sx(x1)} y2={sy(y1)} stroke="#83766D" strokeWidth="1" />
              <line x1={sx(1)} y1={sy(1)} x2={sx(x2)} y2={sy(y2)} stroke="#83766D" strokeWidth="1" />
              {/* Curve */}
              <path d={pathD} fill="none" stroke="#F06424" strokeWidth="2.75" strokeLinecap="round" />
              <circle cx={sx(0)} cy={sy(0)} r="3.5" fill="#F06424" />
              <circle cx={sx(1)} cy={sy(1)} r="3.5" fill="#F06424" />
              <circle cx={sx(x1)} cy={sy(y1)} r="3" fill="#FFC08C" />
              <circle cx={sx(x2)} cy={sy(y2)} r="3" fill="#FFC08C" />
              {/* Animated live sample dot */}
              <circle cx={sx(bx)} cy={sy(by)} r="4.5" fill="#55B98B" stroke="#080707" strokeWidth="1.5" />
            </svg>
            <div className="mt-1 text-xs font-mono-tabular text-[#B8AAA0]">
              cubic-bezier({x1.toFixed(2)}, {y1.toFixed(2)}, {x2.toFixed(2)}, {y2.toFixed(2)})
            </div>
          </div>
        );
      }

      case 'sfx-waveform': {
        const bars =
          sfxWavData?.peaks || [
            12, 22, 38, 65, 92, 100, 86, 74, 60, 48, 52, 40, 32, 26, 20, 16, 14, 18, 24, 20,
          ];
        const activeBar = isPlaying || isAudioPlaying ? Math.floor(progress * bars.length) : -1;
        return (
          <div className="flex flex-col items-center justify-center h-full w-full px-5 select-none">
            <div className="flex items-center gap-1.5 h-20 w-full max-w-xs justify-center">
              {bars.map((heightPct, idx) => {
                const isPassed = idx <= activeBar;
                return (
                  <div
                    key={idx}
                    style={{ height: `${Math.max(12, heightPct * 0.85)}%` }}
                    className={`w-1.5 rounded-full transition-colors ${
                      isPassed ? 'bg-[#F06424]' : 'bg-[#F3EEE8]/70'
                    }`}
                  />
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-3 w-full">
              <button
                type="button"
                onClick={handleToggleSfxAudio}
                className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-semibold text-xs transition-colors"
              >
                {isAudioPlaying ? (
                  <>
                    <VolumeX className="w-3.5 h-3.5" />
                    <span>Stop WAV</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Play 16-bit WAV ({sfxWavData ? `${(sfxWavData.sizeBytes / 1024).toFixed(1)} KB` : 'PCM'})</span>
                  </>
                )}
              </button>
              <label className="inline-flex items-center gap-1.5 text-[11px] font-mono-tabular text-[#B8AAA0]">
                <span>Vol</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={audioVolume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setAudioVolume(v);
                    if (audioRef.current) audioRef.current.volume = v;
                  }}
                  aria-label="SFX preview volume"
                  className="w-20 accent-[#F06424]"
                />
                <span>{Math.round(audioVolume * 100)}%</span>
              </label>
            </div>
            <div className="mt-1.5 text-[10px] font-mono-tabular text-[#55B98B]">
              PCM Waveform derived from actual synthesized 22.05kHz WAV buffer · {item.licenseType}
            </div>
          </div>
        );
      }

      case 'liquid-glass-panel':
      case 'liquid-glass-social':
      case 'liquid-glass-card': {
        const label =
          item.previewKind === 'liquid-glass-panel'
            ? String(getVal('glassText', 'GLASS'))
            : item.previewKind === 'liquid-glass-social'
            ? String(getVal('handleName', '@yournamehere'))
            : String(getVal('cardTitle', 'Refractive Surface Node'));
        const blurPx = Number(getVal('blurPx', 14));
        const orbOffset = isPlaying ? Math.sin(progress * Math.PI * 2) * 28 : 0;

        return (
          <div className="relative flex items-center justify-center h-full w-full overflow-hidden bg-[#0B0A0E] select-none">
            <div
              style={{ transform: `translateX(${orbOffset.toFixed(1)}px)` }}
              className="w-28 h-28 rounded-full bg-gradient-to-tr from-[#3B82F6] to-[#60A5FA] opacity-85 blur-md"
            />
            <div
              style={{ transform: `translateX(${(-orbOffset * 0.7).toFixed(1)}px)` }}
              className="w-24 h-24 -ml-6 rounded-full bg-gradient-to-tr from-[#F06424] to-[#E4B45A] opacity-70 blur-lg"
            />
            <div
              style={{ backdropFilter: `blur(${blurPx}px)` }}
              className="absolute px-6 py-4 rounded-2xl border border-white/25 bg-white/10 shadow-2xl text-center"
            >
              <span className="text-xl sm:text-2xl font-bold tracking-wider text-white drop-shadow">
                {label}
              </span>
              {item.previewKind === 'liquid-glass-social' && (
                <div className="mt-1 text-xs text-white/75">Follow · Liquid Glass L3D</div>
              )}
            </div>
          </div>
        );
      }

      case 'carousel-builder':
      case 'carousel-sphere': {
        const count = Math.min(12, Math.max(3, Number(getVal('numberOfCards', 8))));
        const arrangement = String(getVal('arrangement', 'Tilted orbit'));
        const palette = ['#F06464', '#F06424', '#E4B45A', '#55B98B', '#38BDF8', '#818CF8', '#E879F9', '#FB7185'];
        return (
          <div className="flex flex-col items-center justify-center h-full w-full px-4 select-none">
            <div className="relative flex items-center justify-center h-28 w-full max-w-xs">
              {Array.from({ length: count }).map((_, idx) => {
                const angle = (idx / count) * Math.PI * 2 + (isPlaying ? progress * Math.PI * 2 : 0.4);
                const x = Math.sin(angle) * 86;
                const z = Math.cos(angle);
                const y = arrangement === 'Spiral' ? (idx - count / 2) * 6 : Math.sin(angle * 2) * 6;
                const scale = 0.68 + (z + 1) * 0.22;
                const opacity = 0.4 + (z + 1) * 0.3;
                return (
                  <div
                    key={idx}
                    style={{
                      backgroundColor: palette[idx % palette.length],
                      transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(2)})`,
                      opacity: opacity.toFixed(2),
                      zIndex: Math.round((z + 2) * 10),
                    }}
                    className="absolute w-10 h-14 rounded-lg border border-white/25 shadow-md"
                  />
                );
              })}
            </div>
            <div className="mt-2 text-xs font-mono-tabular text-[#B8AAA0]">
              {arrangement} · {count} Cards · Camera + 2 Control Nulls
            </div>
          </div>
        );
      }

      case 'background-gradient-builder': {
        const paletteName = String(getVal('palettePreset', 'Midnight Ink'));
        const stops =
          paletteName === 'Solar Flare'
            ? ['#1F110B', '#F06424', '#E4B45A']
            : paletteName === 'Arctic Glass'
            ? ['#091526', '#2563EB', '#38BDF8']
            : paletteName === 'Emerald Matrix'
            ? ['#071712', '#059669', '#34D399']
            : ['#0B0F19', '#1D4ED8', '#38BDF8'];
        return (
          <div
            style={{
              background: `radial-gradient(circle at ${50 + Math.sin(progress * Math.PI * 2) * 20}% 50%, ${stops[2]}33, ${stops[1]}44, ${stops[0]})`,
            }}
            className="flex flex-col items-center justify-center h-full w-full p-6 select-none"
          >
            <div className="flex items-center gap-2.5">
              {stops.map((hex, i) => (
                <span
                  key={i}
                  style={{ backgroundColor: hex }}
                  className="w-7 h-7 rounded-full border border-white/30 shadow"
                />
              ))}
            </div>
            <span className="mt-3 text-xs font-mono-tabular text-[#F3EEE8]">
              {paletteName} · 4-Color Gradient Spec
            </span>
          </div>
        );
      }

      case 'background-dynamic-grid': {
        const color = String(getVal('gridColor', '#F06464'));
        return (
          <div className="flex items-center justify-center h-full w-full bg-[#090707] p-4 select-none">
            <div className="grid grid-cols-12 gap-1.5">
              {Array.from({ length: 48 }).map((_, idx) => {
                const row = Math.floor(idx / 12);
                const col = idx % 12;
                const wave = Math.sin((col * 0.5) + (row * 0.7) + (isPlaying ? progress * Math.PI * 2 : 0));
                const opacity = 0.2 + (wave + 1) * 0.4;
                return (
                  <span
                    key={idx}
                    style={{ backgroundColor: color, opacity: opacity.toFixed(2) }}
                    className="w-2 h-2 rounded-xs"
                  />
                );
              })}
            </div>
          </div>
        );
      }

      case 'model3d-glossy-shape': {
        const rotDeg = isPlaying ? progress * 360 : 35;
        return (
          <div className="relative flex flex-col items-center justify-center h-full w-full bg-[#0D0B0A] p-4 select-none">
            <div
              style={{
                transform:
                  previewQualityMode === 'still-fallback'
                    ? 'rotateX(18deg) rotateY(32deg)'
                    : `rotateX(22deg) rotateY(${rotDeg.toFixed(0)}deg)`,
              }}
              className="w-20 h-20 rounded-2xl border-2 border-[#F06424] bg-gradient-to-br from-[#F06424]/40 via-[#FFC08C]/20 to-[#11100F] shadow-[0_0_30px_rgba(240,100,36,0.3)] flex items-center justify-center"
            >
              <span className="text-[11px] font-mono-tabular text-[#F3EEE8] font-bold">
                glTF 2.0
              </span>
            </div>
            <div className="mt-3 text-[11px] font-mono-tabular text-[#B8AAA0] text-center">
              {previewQualityMode === 'still-fallback'
                ? 'Static Fallback Active (Low-Power / WebGL Safe Mode)'
                : 'Mobile WebGL / glTF 2.0 Surface · Static Fallback Ready'}
            </div>
          </div>
        );
      }

      case 'map-location-marker':
      case 'map-route-widget': {
        const routeLabel = String(getVal('routeLabel', item.name));
        const dashOffset = isPlaying ? Math.round((1 - progress) * 120) : 0;
        return (
          <div className="relative flex flex-col items-center justify-center h-full w-full bg-[#090D10] p-4 select-none">
            <svg viewBox="0 0 240 100" className="w-full max-w-[260px] h-24">
              <path
                d="M 20 75 Q 85 15, 130 55 T 220 25"
                fill="none"
                stroke="#23323D"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path
                d="M 20 75 Q 85 15, 130 55 T 220 25"
                fill="none"
                stroke="#F06424"
                strokeWidth="3.5"
                strokeDasharray="8 6"
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
              />
              <circle cx="20" cy="75" r="5" fill="#55B98B" />
              <circle cx="220" cy="25" r="6" fill="#F06424" />
            </svg>
            <div className="text-xs font-semibold text-[#F3EEE8]">{routeLabel}</div>
            <div className="mt-0.5 text-[10px] font-mono-tabular text-[#55B98B]">
              Original Abstract Vector Route · Zero Paid Map APIs or Keys
            </div>
          </div>
        );
      }

      case 'saas-splash-click':
      case 'saas-cursor-click': {
        const label = String(getVal('ctaLabel', 'Explore'));
        const ringColor = String(getVal('ringColor', '#60A5FA'));
        const ringScale = isPlaying ? 0.8 + progress * 1.1 : 1.25;
        const ringOpacity = isPlaying ? 1 - progress : 0.6;
        return (
          <div className="relative flex flex-col items-center justify-center h-full w-full bg-[#0D1017] select-none">
            <span className="text-[11px] font-semibold tracking-widest text-[#B8AAA0] mb-3">
              SHIP MOTION FASTER
            </span>
            <div className="relative flex items-center justify-center">
              <div
                style={{
                  borderColor: ringColor,
                  transform: `scale(${ringScale.toFixed(2)})`,
                  opacity: ringOpacity.toFixed(2),
                }}
                className="absolute w-28 h-10 rounded-full border-2 pointer-events-none"
              />
              <div className="px-5 py-1.5 rounded-full bg-[#3B82F6] text-xs font-semibold text-white shadow">
                {label}
              </div>
            </div>
          </div>
        );
      }

      case 'saas-depth-reveal': {
        return (
          <div className="relative flex flex-col items-center justify-center h-full w-full bg-gradient-to-b from-[#1E162B] via-[#2D1E3E] to-[#11100F] p-5 select-none">
            <div className="w-28 h-16 rounded-lg border border-white/20 bg-black/50 flex items-center justify-center shadow-lg">
              <span className="text-xs font-mono-tabular text-[#E4B45A]">
                Z-Depth Map Plane
              </span>
            </div>
            <span className="mt-2.5 text-[11px] text-[#B8AAA0] text-center">
              Near-to-Far Luminance Matte · Server Worker Optional for AI Depth
            </span>
          </div>
        );
      }

      default: {
        const customText = String(
          getVal(
            'cardHeading',
            getVal(
              'brandTitle',
              getVal('screenLabel', getVal('prTitle', getVal('routeLabel', item.name)))
            )
          )
        );
        return (
          <div className="flex flex-col items-center justify-center h-full w-full p-6 text-center select-none">
            <div className="px-5 py-3.5 rounded-xl border border-[#342A24] bg-[#191614] shadow-inner">
              <div className="text-base sm:text-lg font-bold text-[#F3EEE8] tracking-tight">
                {customText}
              </div>
              <div className="mt-1 text-xs text-[#B8AAA0] font-mono-tabular">
                {item.packLabel} ·{' '}
                {item.metadata.width
                  ? `${item.metadata.width}×${item.metadata.height}`
                  : '1080×1920 Mobile Rig'}
              </div>
            </div>
          </div>
        );
      }
    }
  };

  return (
    <div className="rounded-xl border border-[#342A24] bg-[#0B0A09] overflow-hidden">
      {/* Top Preview Telemetry Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-b border-[#342A24] bg-[#11100F]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-wider text-[#83766D] uppercase">
            Live Preview {comparisonMode === 'edits' ? '· Your Edits' : '· Template'}
          </span>
          <span className="text-[10px] font-mono-tabular px-1.5 py-0.5 rounded bg-[#191614] text-[#B8AAA0] border border-[#342A24]">
            {motionDocument.width}×{motionDocument.height} · {motionDocument.fps}fps ·{' '}
            {durationSec.toFixed(1)}s
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Reduced-Resolution Mobile Preview Toggle */}
          <button
            type="button"
            onClick={() =>
              setPreviewQualityMode((prev) =>
                prev === 'mobile-half'
                  ? 'full'
                  : prev === 'full'
                  ? 'still-fallback'
                  : 'mobile-half'
              )
            }
            title="Switch mobile preview quality / battery saver mode"
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono-tabular text-[#B8AAA0] hover:text-[#F3EEE8] bg-[#191614] border border-[#342A24]"
          >
            <Smartphone className="w-3 h-3 text-[#F06424]" />
            <span>
              {previewQualityMode === 'mobile-half'
                ? '0.5x Mobile'
                : previewQualityMode === 'full'
                ? '1x High'
                : 'Still Safe'}
            </span>
          </button>

          {/* Scene / Layer Inspector Toggle */}
          <button
            type="button"
            onClick={() => setShowLayerInspector((v) => !v)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono-tabular border transition-colors ${
              showLayerInspector
                ? 'bg-[#F06424] text-[#080707] border-[#F06424] font-semibold'
                : 'bg-[#191614] text-[#B8AAA0] border-[#342A24] hover:text-[#F3EEE8]'
            }`}
          >
            <Layers className="w-3 h-3" />
            <span>Layers ({motionDocument.layers.length})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setPausedByVisibility(false);
              setIsPlaying((p) => !p);
            }}
            aria-label={isPlaying ? 'Pause live preview' : 'Play live preview'}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#191614] transition-colors whitespace-nowrap shrink-0"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </button>

          <button
            type="button"
            onClick={() => setTick(0)}
            aria-label="Restart live preview"
            className="p-1 rounded text-[#B8AAA0] hover:text-[#F3EEE8] hover:bg-[#191614] transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Visual Surface */}
      <div className="h-48 sm:h-56 w-full relative">{renderVisualSurface()}</div>

      {/* Interactive Timeline Scrubber & Seek Bar */}
      <div className="px-3.5 py-2 border-t border-[#342A24] bg-[#11100F] flex items-center gap-3">
        <span className="text-[11px] font-mono-tabular text-[#F3EEE8] w-20 shrink-0">
          {currentTimeSec.toFixed(2)}s / {durationSec.toFixed(1)}s
        </span>
        <input
          type="range"
          min={0}
          max={59}
          step={1}
          value={tick % 60}
          onChange={(e) => {
            setIsPlaying(false);
            setTick(Number(e.target.value));
          }}
          aria-label="Seek motion preview timeline"
          className="flex-1 accent-[#F06424] cursor-pointer"
        />
        <span className="text-[10px] font-mono-tabular text-[#83766D] hidden sm:inline">
          {pausedByVisibility ? 'Auto-paused (backgrounded)' : `Frame ${Math.round(progress * durationSec * motionDocument.fps)}`}
        </span>
      </div>

      {/* Text Animation Font Fallback Notice (when in text-animation module) */}
      {item.moduleId === 'text-animation' && (
        <div className="px-3.5 py-2 border-t border-[#342A24] bg-[#14110F] flex items-start gap-2 text-[11px] text-[#B8AAA0]">
          <AlertTriangle className="w-3.5 h-3.5 text-[#E4B45A] shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-[#F3EEE8]">
              Font Handoff ({fontFallbackInfo.family}):{' '}
            </span>
            <span>{fontFallbackInfo.fallbackNotice}</span>
          </div>
        </div>
      )}

      {/* Expandable Scene & Layer List from MotionDocument */}
      {showLayerInspector && (
        <div className="px-3.5 py-3 border-t border-[#342A24] bg-[#14110F] space-y-2 text-xs">
          <div className="flex items-center justify-between font-mono-tabular text-[11px] text-[#83766D]">
            <span>PORTABLE MOTION DOCUMENT (v{motionDocument.schemaVersion})</span>
            <span className="text-[#55B98B]">
              {motionDocument.aspectRatio} · {motionDocument.backgroundColor}
            </span>
          </div>
          <div className="space-y-1.5">
            {motionDocument.layers.map((layer) => (
              <div
                key={layer.id}
                className="rounded-lg border border-[#342A24] bg-[#11100F] px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px] font-mono-tabular"
              >
                <div className="truncate">
                  <span className="text-[#F06424] uppercase mr-2">{layer.kind}</span>
                  <span className="text-[#F3EEE8] font-medium">{layer.name}</span>
                </div>
                <div className="text-[#83766D] shrink-0">
                  {layer.inPointSec.toFixed(1)}s–{layer.outPointSec.toFixed(1)}s ·{' '}
                  {layer.keyframes.length} kf · {layer.blendMode}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
