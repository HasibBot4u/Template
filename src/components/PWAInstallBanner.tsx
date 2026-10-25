import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  Download,
  Info,
  RefreshCw,
  Share2,
  Smartphone,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Detect standalone display mode (already installed as PWA or running in Android TWA)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));
    setIsAndroid(/android/.test(ua));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setIsInstallable(false);
    return outcome === 'accepted';
  }, [deferredPrompt]);

  return { isInstallable, isInstalled, isIOS, isAndroid, promptInstall };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const [showOfflineModal, setShowOfflineModal] = useState(false);
  const [checking, setChecking] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  if (isOnline && !showOfflineModal) return null;

  const handleRetryConnection = async () => {
    setChecking(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/v1/health', { method: 'GET', cache: 'no-store' });
      if (res.ok) {
        setTestResult('Connection restored! Reconnected to Sowveil server.');
        setTimeout(() => setShowOfflineModal(false), 1200);
      } else {
        setTestResult('Server reached but returned error status.');
      }
    } catch {
      setTestResult('Still offline. Check your Wi-Fi or mobile data connection.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      {!isOnline && (
        <div
          role="status"
          aria-live="polite"
          className="bg-[#E4B45A] text-[#080707] px-3 sm:px-4 py-2 text-xs font-semibold flex items-center justify-between gap-2 z-50"
        >
          <div className="flex items-center gap-2 min-w-0">
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              Offline Mode — Procedural previews and local file export (.xml, .sowveil.json, .zip, .srt, .wav) are active.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowOfflineModal(true)}
              className="px-2.5 py-1 rounded bg-[#080707]/10 hover:bg-[#080707]/20 border border-[#080707]/30 text-[11px] font-bold"
            >
              Details &amp; Retry
            </button>
          </div>
        </div>
      )}

      {showOfflineModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Offline Mode Capabilities"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-2xl border border-[#342A24] bg-[#11100F] text-[#F3EEE8] p-5 space-y-4 shadow-2xl max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <WifiOff className="w-5 h-5 text-[#E4B45A]" />
                <h3 className="font-bold text-base text-[#F3EEE8]">
                  Network Status &amp; Offline Scope
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowOfflineModal(false)}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-[#83766D] hover:text-[#F3EEE8]"
                aria-label="Close offline status dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[#B8AAA0] leading-relaxed">
              Sowveil Studio is architected with an in-browser procedural motion engine and Service Worker shell. Private user files and auth tokens are never cached publicly.
            </p>

            <div className="rounded-xl border border-[#342A24] bg-[#191614] p-3.5 space-y-2.5 text-xs">
              <div className="font-semibold text-[#55B98B] flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Available Offline on This Phone:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[#B8AAA0] text-[11px]">
                <li>Real-time animation previews across all 20 modules</li>
                <li>Interactive Cubic-Bezier Easing handles and sample curves</li>
                <li>12-preset deterministic Expression mathematical evaluator</li>
                <li>Alight Motion XML generator (.xml) for supported 2D subset</li>
                <li>Sanitized vector motion plates (.svg) and RGBA still graphics (.png)</li>
                <li>16-bit PCM WAV audio synthesizer (.wav) and peak analyzer</li>
                <li>Auto Captions segment editing, split/merge, and SRT/VTT generation</li>
              </ul>
            </div>

            <div className="rounded-xl border border-[#342A24] bg-[#191614] p-3.5 space-y-2 text-xs">
              <div className="font-semibold text-[#E4B45A] flex items-center gap-1.5">
                <Info className="w-4 h-4 shrink-0" />
                <span>Requires Online Connectivity:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[#83766D] text-[11px]">
                <li>Firebase Authentication sign-in and token renewals</li>
                <li>Cloud Firestore synchronization for Project Library &amp; Favorites</li>
                <li>Server-side extractor workers and media URL inspection</li>
                <li>Administrative operations and backend role mutations</li>
              </ul>
            </div>

            {testResult && (
              <div className="text-xs font-mono-tabular p-2.5 rounded-lg border border-[#342A24] bg-[#14110F] text-[#F3EEE8]">
                {testResult}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#342A24]">
              <button
                type="button"
                onClick={handleRetryConnection}
                disabled={checking}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-[#F06424] text-[#080707] font-semibold text-xs inline-flex items-center gap-2 hover:bg-[#F06424]/90 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
                <span>{checking ? 'Checking Connection…' : 'Retry Connection'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, promptInstall } = usePWAInstall();
  const [dismissed, setDismissed] = useState(false);
  const [showManualGuide, setShowManualGuide] = useState(false);

  // If already running standalone or dismissed, do not render prompt
  if (isInstalled || dismissed) return null;

  const handleClick = async () => {
    if (isInstallable) {
      const ok = await promptInstall();
      if (!ok) {
        // User dismissed native prompt
      }
    } else {
      setShowManualGuide(true);
    }
  };

  const renderGuideModal = () => {
    if (!showManualGuide) return null;

    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Install Sowveil Studio Guide"
        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      >
        <div className="w-full max-w-sm rounded-t-3xl sm:rounded-2xl border border-[#342A24] bg-[#11100F] text-[#F3EEE8] p-5 space-y-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-[#F06424]" />
              <h3 className="font-bold text-sm text-[#F3EEE8]">
                Install on {isIOS ? 'iPhone / iPad' : isAndroid ? 'Android' : 'Your Device'}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowManualGuide(false)}
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-[#83766D] hover:text-[#F3EEE8]"
              aria-label="Close install guide"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {isIOS ? (
            <div className="space-y-2 text-xs text-[#B8AAA0] leading-relaxed">
              <p>1. Tap the <strong className="text-[#F3EEE8]">Share</strong> icon (<Share2 className="w-3.5 h-3.5 inline text-[#F06424]" />) in Safari's bottom toolbar.</p>
              <p>2. Scroll down and tap <strong className="text-[#F3EEE8]">Add to Home Screen</strong>.</p>
              <p>3. Tap <strong className="text-[#F3EEE8]">Add</strong> in the top-right corner to launch Sowveil in full-screen portrait mode.</p>
            </div>
          ) : (
            <div className="space-y-2 text-xs text-[#B8AAA0] leading-relaxed">
              <p>1. Open your browser menu (tap the <strong className="text-[#F3EEE8]">⋮</strong> three dots in Chrome or Brave).</p>
              <p>2. Select <strong className="text-[#F3EEE8]">Install app</strong> or <strong className="text-[#F3EEE8]">Add to Home screen</strong>.</p>
              <p>3. Launch Sowveil Studio from your home screen for standalone mobile motion authoring.</p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowManualGuide(false)}
            className="w-full min-h-[44px] py-2.5 rounded-xl border border-[#342A24] bg-[#191614] text-xs font-semibold text-[#F3EEE8] hover:border-[#83766D]"
          >
            Got It
          </button>
        </div>
      </div>
    );
  };

  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={handleClick}
          title={isInstallable ? 'Install Sowveil Studio PWA' : 'Installation Instructions'}
          aria-label={isInstallable ? 'Install Sowveil Studio PWA' : 'Installation Instructions'}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-[#F06424]/60 bg-[#211B17] hover:bg-[#F06424] hover:text-[#080707] text-xs font-semibold text-[#F3EEE8] transition-colors whitespace-nowrap shrink-0"
        >
          <Smartphone className="w-3.5 h-3.5 text-[#F06424]" />
          <span className="hidden sm:inline">Install PWA</span>
        </button>
        {renderGuideModal()}
      </>
    );
  }

  return (
    <>
      <div className="border-b border-[#342A24] bg-[#191614] px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <Smartphone className="w-4 h-4 text-[#F06424] shrink-0" />
          <span className="text-[#F3EEE8] truncate">
            Install <strong>Sowveil Studio</strong> on your home screen for full-screen portrait motion design.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleClick}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#F06424] text-[#080707] font-semibold text-xs whitespace-nowrap hover:bg-[#F06424]/90"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Install App</span>
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss install banner"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-[#83766D] hover:text-[#F3EEE8]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      {renderGuideModal()}
    </>
  );
};
