import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SOWVEIL_MODULES } from '../data/modules';
import { SEED_CATALOG_ITEMS } from '../data/catalogSeeds';
import { AuthenticatedUser, AuthErrorState } from '../types/sowveil';
import { signInWithGooglePopup } from '../services/firebaseClient';
import { MOBILE_EDITOR_ADAPTERS } from '../services/editorGateway';
import { OfflineIndicator, PWAInstallButton } from './PWAInstallBanner';
import { AlertCircle, ArrowRight, Loader2, LogIn, ShieldCheck, Smartphone } from 'lucide-react';

export const PublicTopHeader: React.FC<{ currentUser?: AuthenticatedUser | null }> = ({
  currentUser,
}) => {
  return (
    <>
      <OfflineIndicator />
      <header className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3.5 border-b border-[#342A24] bg-[#080707]">
        <Link
          to="/"
          className="text-base sm:text-lg font-bold tracking-tight text-[#F3EEE8] whitespace-nowrap shrink-0"
        >
          SOWVEIL STUDIO
        </Link>

        <nav
          aria-label="Primary Navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-[#B8AAA0]"
        >
          <Link
            to="/features"
            className="hover:text-[#F3EEE8] transition-colors whitespace-nowrap shrink-0"
          >
            Features
          </Link>
          <Link
            to="/docs"
            className="hover:text-[#F3EEE8] transition-colors whitespace-nowrap shrink-0"
          >
            Editor Gateway
          </Link>
          <Link
            to="/technical"
            className="hover:text-[#F3EEE8] transition-colors whitespace-nowrap shrink-0"
          >
            Technical Status
          </Link>
          <Link
            to="/privacy"
            className="hover:text-[#F3EEE8] transition-colors whitespace-nowrap shrink-0"
          >
            Privacy
          </Link>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <PWAInstallButton />
          {currentUser ? (
            <Link
              to="/app/text-animation"
              className="min-h-[40px] inline-flex items-center px-3.5 py-2 text-xs font-semibold text-[#080707] bg-[#F06424] rounded-lg hover:bg-[#FF4B24] transition-colors whitespace-nowrap shrink-0"
            >
              Open Studio ({currentUser.displayName})
            </Link>
          ) : (
            <Link
              to="/sign-in"
              className="min-h-[40px] inline-flex items-center px-3.5 py-2 text-xs font-semibold text-[#080707] bg-[#F06424] rounded-lg hover:bg-[#FF4B24] transition-colors whitespace-nowrap shrink-0"
            >
              Sign In
            </Link>
          )}
        </div>
      </header>
    </>
  );
};

export const PublicFooter: React.FC = () => {
  return (
    <footer className="border-t border-[#342A24] bg-[#080707] px-6 py-8 text-xs text-[#83766D]">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          Sowveil Studio · Mobile-First Motion Engine · Installable Android PWA · Cloud Firestore
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <Link to="/features" className="hover:text-[#F3EEE8]">
            Features
          </Link>
          <Link to="/docs" className="hover:text-[#F3EEE8]">
            Editor Compatibility
          </Link>
          <Link to="/privacy" className="hover:text-[#F3EEE8]">
            Privacy Policy
          </Link>
          <Link to="/terms" className="hover:text-[#F3EEE8]">
            Terms (Draft)
          </Link>
          <Link to="/sign-in" className="hover:text-[#F3EEE8]">
            Sign In
          </Link>
        </div>
      </div>
    </footer>
  );
};

export const LandingPage: React.FC<{ currentUser?: AuthenticatedUser | null }> = ({
  currentUser,
}) => {
  const totalSeeded = SEED_CATALOG_ITEMS.length;

  return (
    <div className="min-h-screen flex flex-col bg-[#080707] text-[#F3EEE8]">
      <PublicTopHeader currentUser={currentUser} />

      <main className="flex-1">
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-7 flex flex-col justify-center space-y-5">
            <div className="inline-flex items-center gap-2 text-xs font-mono-tabular text-[#F06424]">
              <Smartphone className="w-3.5 h-3.5" />
              <span>Mobile-First Android Motion Platform · 20 Creative Modules · Zero Desktop Dependency</span>
            </div>
            <h1
              style={{ textWrap: 'balance' }}
              className="text-3xl sm:text-5xl font-bold tracking-tight text-[#F3EEE8] leading-[1.12]"
            >
              Studio-grade motion presets, procedural rigs, and universal mobile editor handoff.
            </h1>
            <p className="text-sm sm:text-base text-[#B8AAA0] leading-relaxed max-w-2xl">
              Customize 20 specialized motion-design modules directly on your Android phone. Export validated Alight Motion XML templates, high-precision SVG overlays, 16-bit PCM WAV sound effects, SRT captions, and RFC-compliant ZIP asset bundles for CapCut, Alight Motion, Node Video, and KineMaster.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                to={currentUser ? '/app/text-animation' : '/sign-in?redirect=/app/text-animation'}
                className="min-h-[44px] inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-semibold text-sm transition-colors whitespace-nowrap"
              >
                <span>{currentUser ? 'Launch Mobile Studio' : 'Sign In & Launch Studio'}</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/features"
                className="min-h-[44px] inline-flex items-center px-5 py-3 rounded-xl border border-[#342A24] bg-[#11100F] hover:border-[#83766D] text-sm font-medium text-[#F3EEE8] transition-colors whitespace-nowrap"
              >
                Capability & Editor Matrix
              </Link>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-2xl border border-[#342A24] bg-[#11100F] p-5 sm:p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs font-mono-tabular text-[#B8AAA0] border-b border-[#342A24] pb-3">
              <span>MOBILE STUDIO ARCHITECTURE</span>
              <span className="text-[#55B98B]">Installable Android PWA</span>
            </div>

            <div className="my-5 space-y-3.5">
              <div className="rounded-xl border border-[#342A24] bg-[#191614] p-3.5">
                <div className="text-xs font-mono-tabular text-[#55B98B]">
                  Mobile Editor Integration Gateway
                </div>
                <p className="mt-1 text-xs text-[#F3EEE8]">
                  Direct export & Android share-sheet handoff for CapCut, Alight Motion (`.xml` tested subset), Node Video, KineMaster, and reusable `.sowveil.json` projects.
                </p>
              </div>
              <div className="rounded-xl border border-[#342A24] bg-[#191614] p-3.5">
                <div className="text-xs font-mono-tabular text-[#F06424]">
                  Firebase Auth & Cloud Firestore Sync
                </div>
                <p className="mt-1 text-xs text-[#B8AAA0]">
                  Google Sign-In authentication, zero-trust Firestore security rules, server-verified `/api/v1` endpoints, and cross-device favorites and project libraries.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs font-mono-tabular text-[#83766D] pt-3 border-t border-[#342A24]">
              <span>20 Modules</span>
              <span>·</span>
              <span>{totalSeeded} Seeded Presets</span>
              <span>·</span>
              <span>Zero Fake Extensions</span>
            </div>
          </div>
        </section>

        <section className="border-y border-[#342A24] bg-[#11100F] px-4 sm:px-6 py-10">
          <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="space-y-1">
              <div className="text-xl sm:text-2xl font-bold font-mono-tabular text-[#F3EEE8]">20 Modules</div>
              <div className="text-xs text-[#B8AAA0]">
                Full creative suite from Text Animation and Liquid Glass to Auto Captions and Project Library.
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xl sm:text-2xl font-bold font-mono-tabular text-[#F3EEE8]">6 Editor Adapters</div>
              <div className="text-xs text-[#B8AAA0]">
                CapCut, Alight Motion XML, Node Video, KineMaster, Sowveil Project, and Universal ZIP.
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xl sm:text-2xl font-bold font-mono-tabular text-[#F3EEE8]">Firestore Cloud</div>
              <div className="text-xs text-[#B8AAA0]">
                Hardened owner-scoped security rules and server token verification on `/api/v1/*`.
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xl sm:text-2xl font-bold font-mono-tabular text-[#F3EEE8]">Honest Exports</div>
              <div className="text-xs text-[#B8AAA0]">
                Real validated `.xml`, `.sowveil.json`, `.svg`, `.wav`, `.srt`, and `.zip` outputs — never renamed fake files.
              </div>
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-[#F3EEE8]">01. Complete 20-Module Directory</h2>
              <p className="text-sm text-[#B8AAA0] mt-1">
                Sign in with Google to open any module, customize parameters on mobile, and export to your favorite mobile video editor.
              </p>
            </div>
            <Link
              to="/features"
              className="text-xs font-semibold text-[#F06424] hover:underline whitespace-nowrap"
            >
              View full capability matrix →
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {SOWVEIL_MODULES.map((m) => (
              <Link
                key={m.id}
                to={m.route}
                className="rounded-xl border border-[#342A24] bg-[#11100F] hover:border-[#F06424] p-4 transition-colors flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between text-xs font-mono-tabular text-[#83766D]">
                    <span>{String(m.displayOrder).padStart(2, '0')}</span>
                    <span className="text-[#55B98B]">Mobile Ready</span>
                  </div>
                  <div className="mt-2 font-semibold text-sm text-[#F3EEE8]">{m.label}</div>
                  <p className="mt-1 text-xs text-[#B8AAA0] line-clamp-2">{m.description}</p>
                </div>
                <div className="mt-4 pt-2 border-t border-[#342A24]/60 flex items-center justify-between text-[11px] font-mono-tabular text-[#B8AAA0]">
                  <span>Open module</span>
                  {m.referenceReportedCount !== undefined && (
                    <span>Ref: {m.referenceReportedCount}</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
};

export const FeaturesPage: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-[#080707] text-[#F3EEE8]">
      <PublicTopHeader />
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-10 space-y-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#F3EEE8]">
            Mobile Feature & Editor Compatibility Matrix
          </h1>
          <p className="mt-2 text-sm text-[#B8AAA0]">
            Transparent breakdown of browser/PWA capabilities, Cloud Firestore persistence, and mobile editor handoff across all 20 modules.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {MOBILE_EDITOR_ADAPTERS.map((adapter) => (
            <div
              key={adapter.id}
              className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm text-[#F3EEE8]">{adapter.name}</span>
                <span className="text-[11px] font-mono-tabular text-[#F06424]">
                  {adapter.compatibilityStatus}
                </span>
              </div>
              <p className="text-xs text-[#B8AAA0]">{adapter.honestCapabilitySummary}</p>
              <div className="text-[11px] font-mono-tabular text-[#83766D]">
                Formats: {adapter.supportedFormats.join(', ')}
              </div>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto rounded-xl border border-[#342A24] bg-[#11100F]">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#342A24] bg-[#191614] text-[#B8AAA0] font-mono-tabular">
                <th className="py-3 px-4">#</th>
                <th className="py-3 px-4">Module</th>
                <th className="py-3 px-4">Capability Type</th>
                <th className="py-3 px-4">Mobile & Cloud Behavior</th>
                <th className="py-3 px-4">Export / Handoff</th>
                <th className="py-3 px-4 text-right">Ref Badge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#342A24]">
              {SOWVEIL_MODULES.map((m) => (
                <tr key={m.id} className="hover:bg-[#191614]/60">
                  <td className="py-3 px-4 font-mono-tabular text-[#83766D]">{m.displayOrder}</td>
                  <td className="py-3 px-4 font-semibold text-[#F3EEE8]">
                    <Link
                      to={m.route}
                      className="hover:text-[#F06424] underline-offset-2 hover:underline"
                    >
                      {m.label}
                    </Link>
                  </td>
                  <td className="py-3 px-4 font-mono-tabular text-[#B8AAA0]">{m.capabilityType}</td>
                  <td className="py-3 px-4 text-[#B8AAA0]">
                    Search, filter, Firestore favorites, live touch preview & parameter controls
                  </td>
                  <td className="py-3 px-4 font-mono-tabular text-[#55B98B]">
                    {m.id === 'sfx'
                      ? '16-bit PCM WAV + ZIP + Share'
                      : m.id === 'auto-captions'
                      ? 'Validated SRT + Share'
                      : 'Alight XML / SVG / ZIP / .sowveil.json'}
                  </td>
                  <td className="py-3 px-4 text-right font-mono-tabular text-[#F3EEE8]">
                    {m.referenceReportedCount ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
};

export const DocsPage: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-[#080707] text-[#F3EEE8]">
      <PublicTopHeader />
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-10 space-y-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">
            Mobile Editor Integration Gateway & Trust Boundaries
          </h1>
          <p className="mt-2 text-sm text-[#B8AAA0]">
            How Sowveil Studio generates real, validated project files and media bundles for Android video editors without faking proprietary formats.
          </p>
        </div>

        <section className="rounded-xl border border-[#342A24] bg-[#11100F] p-6 space-y-3">
          <h2 className="text-lg font-semibold text-[#F3EEE8]">1. Mobile-First Architecture Layers</h2>
          <ul className="space-y-2 text-xs sm:text-sm text-[#B8AAA0] list-disc pl-5">
            <li>
              <strong className="text-[#F3EEE8]">Installable Android PWA:</strong> Renders all 20 modules with thumb-friendly controls, 9:16 / 1:1 / 16:9 aspect-ratio previews, and Web Share API file handoff.
            </li>
            <li>
              <strong className="text-[#F3EEE8]">Mobile Editor Integration Gateway:</strong> Generates validated `.sowveil.json` reusable projects, Alight Motion `.xml` scene templates (tested subset), `.svg` motion vectors, `.wav` 16-bit PCM audio, `.srt` timed captions, and RFC-compliant `.zip` asset bundles.
            </li>
            <li>
              <strong className="text-[#F3EEE8]">Cloud Server & Firestore:</strong> Authenticates users via Firebase Google Sign-In, verifies Bearer ID tokens server-side, validates payloads with Zod, and persists favorites, projects, and export jobs.
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-[#342A24] bg-[#11100F] p-6 space-y-3">
          <h2 className="text-lg font-semibold text-[#F3EEE8]">2. Target Mobile Editors & Honest Capability Labels</h2>
          <div className="space-y-3">
            {MOBILE_EDITOR_ADAPTERS.map((adapter) => (
              <div
                key={adapter.id}
                className="rounded-lg border border-[#342A24] bg-[#191614] p-3.5 space-y-1"
              >
                <div className="flex items-center justify-between text-xs font-mono-tabular">
                  <span className="text-[#F3EEE8] font-bold">{adapter.name}</span>
                  <span className="text-[#F06424]">{adapter.compatibilityStatus}</span>
                </div>
                <p className="text-xs text-[#B8AAA0]">{adapter.honestCapabilitySummary}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
};

export const PrivacyPage: React.FC = () => (
  <div className="min-h-screen flex flex-col bg-[#080707] text-[#F3EEE8]">
    <PublicTopHeader />
    <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-12 space-y-6">
      <h1 className="text-2xl font-bold">Privacy & Data Processing Summary</h1>
      <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-6 space-y-4 text-xs sm:text-sm text-[#B8AAA0] leading-relaxed">
        <p>
          <strong className="text-[#F3EEE8]">PII Split-Collection Isolation:</strong> Your email address is isolated in `/users/&#123;uid&#125;/private/info` and is strictly readable only by your authenticated account or a verified owner/admin.
        </p>
        <p>
          <strong className="text-[#F3EEE8]">Local Media Stays Local:</strong> Auto Captions (Whisper) and Depth Reveal process audio and imagery on your local desktop companion when configured. Raw timeline media is never silently uploaded to cloud storage.
        </p>
        <p>
          <strong className="text-[#F3EEE8]">Zero Silent LocalStorage Fallback:</strong> Private user records (favorites, Project Library metadata, jobs, and paired devices) are persisted exclusively in Cloud Firestore under your authenticated UID.
        </p>
      </div>
    </main>
    <PublicFooter />
  </div>
);

export const TermsPage: React.FC = () => (
  <div className="min-h-screen flex flex-col bg-[#080707] text-[#F3EEE8]">
    <PublicTopHeader />
    <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-12 space-y-6">
      <div className="text-xs font-mono-tabular text-[#E4B45A]">
        PLACEHOLDER FOR OWNER / LEGAL REVIEW
      </div>
      <h1 className="text-2xl font-bold">Terms of Use (Draft Specification)</h1>
      <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-6 space-y-4 text-xs sm:text-sm text-[#B8AAA0] leading-relaxed">
        <p>
          This page is a clearly labelled legal placeholder for review by the project owner. No compliance certification is claimed.
        </p>
        <p>
          Users of the Downloader and Auto Captions utilities must own or hold explicit license rights to any media processed. Bypassing DRM, login walls, or platform access controls is strictly prohibited.
        </p>
      </div>
    </main>
    <PublicFooter />
  </div>
);

export const SignInPage: React.FC<{
  currentUser: AuthenticatedUser | null;
  authLoading: boolean;
  externalError?: AuthErrorState;
}> = ({ currentUser, authLoading, externalError }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTarget = searchParams.get('redirect') || '/app/text-animation';

  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<AuthErrorState>(externalError || null);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    const { user, error } = await signInWithGooglePopup();
    setSigningIn(false);
    if (error) {
      setAuthError(error);
      return;
    }
    if (user) {
      navigate(redirectTarget.startsWith('/') ? redirectTarget : '/app/text-animation', {
        replace: true,
      });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#080707] text-[#F3EEE8]">
      <PublicTopHeader currentUser={currentUser} />
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-[#342A24] bg-[#11100F] p-6 space-y-5">
          <div>
            <div className="text-xs font-mono-tabular text-[#55B98B] flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>FIREBASE AUTHENTICATION · PROJECT SACRED-TUNE-BLXDT</span>
            </div>
            <h1 className="mt-1.5 text-xl font-bold text-[#F3EEE8]">
              Sign in to Sowveil Studio
            </h1>
            <p className="mt-1 text-xs text-[#B8AAA0] leading-relaxed">
              Authenticate with your verified Google account to access the 20-module workspace, sync favorites and Project Library records to Cloud Firestore, and manage desktop companion jobs.
            </p>
          </div>

          {authError && (
            <div
              role="alert"
              className="rounded-xl border border-[#F06464]/50 bg-[#F06464]/10 p-3.5 space-y-1 text-xs"
            >
              <div className="flex items-center gap-2 font-semibold text-[#F06464]">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>
                  {authError.title} ({authError.code})
                </span>
              </div>
              <p className="text-[#F3EEE8] leading-relaxed pl-6">{authError.message}</p>
            </div>
          )}

          {currentUser ? (
            <div className="rounded-xl border border-[#55B98B]/40 bg-[#55B98B]/10 p-4 space-y-3 text-xs">
              <div className="font-semibold text-[#55B98B]">
                Signed in as {currentUser.displayName} ({currentUser.email})
              </div>
              <div className="font-mono-tabular text-[#B8AAA0]">
                Role: {currentUser.role.toUpperCase()} · UID: {currentUser.uid.slice(0, 12)}…
              </div>
              <button
                type="button"
                onClick={() => navigate(redirectTarget, { replace: true })}
                className="w-full py-2.5 px-4 rounded-xl bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-semibold text-xs transition-colors"
              >
                Continue to Workspace →
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                disabled={signingIn || authLoading}
                onClick={handleGoogleSignIn}
                className="w-full py-3 px-4 rounded-xl bg-[#F06424] hover:bg-[#FF4B24] disabled:opacity-60 text-[#080707] font-semibold text-xs transition-colors inline-flex items-center justify-center gap-2"
              >
                {signingIn || authLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Authenticating with Google…</span>
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>Sign in with Google</span>
                  </>
                )}
              </button>

              <div className="rounded-lg border border-[#342A24] bg-[#191614] p-3 text-[11px] text-[#83766D] space-y-1">
                <div className="font-mono-tabular text-[#B8AAA0]">
                  POPUP & SESSION NOTES
                </div>
                <p>
                  Uses <code className="text-[#F3EEE8]">signInWithPopup</code> for iframe compatibility. If your browser blocks the popup, allow popups for this domain and retry.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
};
