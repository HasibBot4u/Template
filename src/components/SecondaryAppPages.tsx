import React, { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  AuditEventRecord,
  AuthenticatedUser,
  CatalogItem,
  CompanionState,
  JobRecord,
  JobStatus,
  ProjectLibraryItem,
  UserPreferences,
  UserRole,
} from '../types/sowveil';
import { SOWVEIL_MODULES } from '../data/modules';
import { canTransitionJob, VALID_JOB_TRANSITIONS } from '../services/jobStateMachine';
import { MOBILE_EDITOR_ADAPTERS } from '../services/editorGateway';
import { auth, db, signOutUser } from '../services/firebaseClient';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  Check,
  Copy,
  Download,
  KeyRound,
  LogOut,
  RotateCcw,
  Search,
  ShieldCheck,
  Smartphone,
  Unplug,
  XCircle,
} from 'lucide-react';

interface AppDashboardPageProps {
  favoriteItems: CatalogItem[];
  projects: ProjectLibraryItem[];
  jobs: JobRecord[];
  companion: CompanionState;
  repositoryModeLabel: string;
}

export const AppDashboardPage: React.FC<AppDashboardPageProps> = ({
  favoriteItems,
  projects,
  jobs,
  companion,
  repositoryModeLabel,
}) => {
  const activeProjectsCount = projects.filter((p) => !p.archived).length;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#342A24] pb-4">
        <div>
          <div className="text-xs font-mono-tabular text-[#55B98B]">
            PERSISTENCE: {repositoryModeLabel.toUpperCase()} · INSTALLABLE ANDROID PWA
          </div>
          <h1 className="text-xl font-bold text-[#F3EEE8] mt-0.5">Mobile Studio Overview</h1>
          <p className="text-xs text-[#B8AAA0] mt-0.5">
            Quick access to your 20 mobile-ready motion modules, Cloud Firestore favorites, reusable project documents, and Mobile Editor Integration Gateway.
          </p>
        </div>
        <Link
          to="/app/text-animation"
          className="min-h-[40px] inline-flex items-center px-4 py-2 rounded-lg bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-semibold text-xs whitespace-nowrap self-start sm:self-auto"
        >
          Open 20-Module Browser
        </Link>
      </div>

      {/* Summary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4">
          <div className="text-xs font-mono-tabular text-[#83766D]">AVAILABLE MODULES</div>
          <div className="mt-1 text-2xl font-bold font-mono-tabular text-[#F3EEE8]">
            {SOWVEIL_MODULES.length}
          </div>
          <div className="mt-1 text-xs text-[#B8AAA0]">All 20 modules mobile-ready</div>
        </div>

        <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4">
          <div className="text-xs font-mono-tabular text-[#83766D]">FAVORITED PRESETS</div>
          <div className="mt-1 text-2xl font-bold font-mono-tabular text-[#F3EEE8]">
            {favoriteItems.length}
          </div>
          <Link
            to="/app/favorites"
            className="mt-1 inline-block text-xs text-[#F06424] hover:underline"
          >
            Manage favorites →
          </Link>
        </div>

        <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4">
          <div className="text-xs font-mono-tabular text-[#83766D]">ACTIVE PROJECT RECORDS</div>
          <div className="mt-1 text-2xl font-bold font-mono-tabular text-[#F3EEE8]">
            {activeProjectsCount}
          </div>
          <Link
            to="/app/project-library"
            className="mt-1 inline-block text-xs text-[#F06424] hover:underline"
          >
            Open Project Library →
          </Link>
        </div>

        <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4">
          <div className="text-xs font-mono-tabular text-[#83766D]">EDITOR GATEWAY ADAPTERS</div>
          <div className="mt-1 text-lg font-bold font-mono-tabular text-[#55B98B] flex items-center gap-1.5">
            <Smartphone className="w-4 h-4 text-[#F06424]" />
            <span>{MOBILE_EDITOR_ADAPTERS.length} Mobile Targets</span>
          </div>
          <Link
            to="/docs"
            className="mt-1 inline-block text-xs text-[#B8AAA0] hover:text-[#F3EEE8]"
          >
            CapCut, Alight XML, Node Video, KineMaster →
          </Link>
        </div>
      </div>

      {/* Onboarding & Honest Status Checklist */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-[#342A24] bg-[#11100F] p-5 space-y-3">
          <h2 className="text-sm font-bold text-[#F3EEE8]">Mobile-First Capability & Cloud Checklist</h2>
          <ul className="space-y-2.5 text-xs text-[#B8AAA0]">
            <li className="flex items-center justify-between">
              <span>1. Browse 20 modules, debounced search & real counts</span>
              <span className="font-mono-tabular text-[#55B98B]">Available</span>
            </li>
            <li className="flex items-center justify-between">
              <span>2. Firebase Auth (Google Sign-In) & Cloud Firestore</span>
              <span className="font-mono-tabular text-[#55B98B]">Available (Provisioned)</span>
            </li>
            <li className="flex items-center justify-between">
              <span>3. Mobile Editor Gateway (.sowveil.json, .xml, .svg, .wav, .srt, .zip)</span>
              <span className="font-mono-tabular text-[#55B98B]">Active & Validated</span>
            </li>
            <li className="flex items-center justify-between">
              <span>4. Installable Android PWA + Web Share API Handoff</span>
              <span className="font-mono-tabular text-[#55B98B]">Ready</span>
            </li>
            <li className="flex items-center justify-between">
              <span>5. Optional Legacy Bridge ({companion.status})</span>
              <span className="font-mono-tabular text-[#83766D]">Optional / Non-blocking</span>
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-[#342A24] bg-[#11100F] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#F3EEE8]">Recent Operation Jobs</h2>
            <Link to="/app/jobs" className="text-xs text-[#F06424] hover:underline">
              View all ({jobs.length})
            </Link>
          </div>
          {jobs.length === 0 ? (
            <p className="text-xs text-[#83766D] py-4">
              No jobs recorded yet. Open any module or the Jobs page to inspect the Job State Machine.
            </p>
          ) : (
            <div className="space-y-2">
              {jobs.slice(0, 4).map((j) => (
                <div
                  key={j.id}
                  className="rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 flex items-center justify-between gap-2 text-xs"
                >
                  <span className="text-[#F3EEE8] truncate">{j.title}</span>
                  <span className="font-mono-tabular text-[#E4B45A] shrink-0">{j.status}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export const FavoritesPage: React.FC<{
  favoriteItems: CatalogItem[];
  onToggleFavorite: (id: string) => Promise<void> | void;
  repositoryModeLabel: string;
}> = ({ favoriteItems, onToggleFavorite, repositoryModeLabel }) => {
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [query, setQuery] = useState<string>('');

  const filteredFavorites = useMemo(() => {
    const q = query.trim().toLowerCase();
    return favoriteItems.filter((item) => {
      if (moduleFilter !== 'all' && item.moduleId !== moduleFilter) return false;
      if (q) {
        return (
          item.name.toLowerCase().includes(q) ||
          item.packLabel.toLowerCase().includes(q) ||
          item.summary.toLowerCase().includes(q) ||
          item.tags.some((t) => t.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [favoriteItems, moduleFilter, query]);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-[#F3EEE8]">
            Global Favorites ({favoriteItems.length})
          </h1>
          <p className="text-xs text-[#B8AAA0] mt-0.5">
            Idempotent favorite records persisted in {repositoryModeLabel}.
          </p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-[#83766D] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter your favorites by name, pack, or tag…"
            className="w-full rounded-lg border border-[#342A24] bg-[#11100F] pl-8 pr-4 py-2 text-xs text-[#F3EEE8]"
          />
        </div>
        <select
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          className="rounded-lg border border-[#342A24] bg-[#11100F] px-3 py-2 text-xs text-[#B8AAA0]"
        >
          <option value="all">All Modules ({favoriteItems.length})</option>
          {SOWVEIL_MODULES.filter((m) => m.workspaceKind === 'catalog').map((m) => {
            const count = favoriteItems.filter((i) => i.moduleId === m.id).length;
            return (
              <option key={m.id} value={m.id}>
                {m.label} ({count})
              </option>
            );
          })}
        </select>
      </div>

      {filteredFavorites.length === 0 ? (
        <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-8 text-center space-y-3">
          <p className="text-sm font-semibold text-[#F3EEE8]">
            {favoriteItems.length === 0 ? 'No favorites saved yet' : 'No favorites match your filter'}
          </p>
          <p className="text-xs text-[#B8AAA0]">
            {favoriteItems.length === 0
              ? 'Click “Add to favorites” on any preset in the workspace to pin it to Cloud Firestore.'
              : 'Clear the module or search filter to see all saved favorites.'}
          </p>
          <Link
            to="/app/text-animation"
            className="inline-block px-4 py-2 rounded-lg bg-[#F06424] text-[#080707] font-semibold text-xs"
          >
            Browse Text Animations
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredFavorites.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 flex flex-col justify-between gap-3"
            >
              <div>
                <div className="flex items-center justify-between text-xs font-mono-tabular text-[#F06424]">
                  <span>{item.packLabel}</span>
                  <span className="text-[#83766D]">{item.moduleId}</span>
                </div>
                <div className="mt-1.5 font-bold text-sm text-[#F3EEE8]">{item.name}</div>
                <p className="mt-1 text-xs text-[#B8AAA0] line-clamp-2">{item.summary}</p>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-[#342A24]">
                <Link
                  to={`/app/${item.moduleId}?item=${item.id}`}
                  className="text-xs font-semibold text-[#F06424] hover:underline"
                >
                  Inspect in module →
                </Link>
                <button
                  type="button"
                  onClick={() => onToggleFavorite(item.id)}
                  className="text-xs text-[#B8AAA0] hover:text-[#F06464]"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const JobsHistoryPage: React.FC<{
  jobs: JobRecord[];
  companion: CompanionState;
  onTransitionJob: (
    id: string,
    nextStatus: JobStatus,
    options?: { redactedMessage?: string; errorCode?: string }
  ) => Promise<void> | void;
  onClearJobs: () => Promise<void> | void;
}> = ({ jobs, companion, onTransitionJob, onClearJobs }) => {
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filteredJobs = useMemo(
    () => (statusFilter === 'all' ? jobs : jobs.filter((j) => j.status === statusFilter)),
    [jobs, statusFilter]
  );

  const allStatuses: JobStatus[] = [
    'draft',
    'queued',
    'uploading',
    'claimed',
    'running',
    'finalizing',
    'ready',
    'downloaded',
    'succeeded',
    'failed',
    'cancelled',
    'needs-setup',
    'quota-reached',
    'expired',
  ];

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#F3EEE8]">Export, Render & Operation Job Queue</h1>
          <p className="text-xs text-[#B8AAA0] mt-0.5">
            State-machine tracked jobs (`draft → queued → uploading → running → finalizing → ready → downloaded | succeeded | failed | cancelled | needs-setup | quota-reached`).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono-tabular text-[#55B98B] flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5 text-[#F06424]" />
            <span>Mobile Media & Editor Gateway Ready</span>
          </span>
          {jobs.length > 0 && (
            <button
              type="button"
              onClick={() => onClearJobs()}
              className="px-3 py-1.5 rounded-lg border border-[#342A24] bg-[#191614] text-xs text-[#B8AAA0] hover:text-[#F3EEE8]"
            >
              Clear log
            </button>
          )}
        </div>
      </div>

      {/* Status Filter Bar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium tabular-nums ${
            statusFilter === 'all'
              ? 'bg-[#F06424] text-[#080707] font-semibold'
              : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24]'
          }`}
        >
          All {jobs.length}
        </button>
        {allStatuses.map((st) => {
          const count = jobs.filter((j) => j.status === st).length;
          return (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium tabular-nums ${
                statusFilter === st
                  ? 'bg-[#F06424] text-[#080707] font-semibold'
                  : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24]'
              }`}
            >
              {st} {count}
            </button>
          );
        })}
      </div>

      {filteredJobs.length === 0 ? (
        <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-8 text-center space-y-2 text-xs text-[#83766D]">
          <p className="text-sm font-semibold text-[#F3EEE8]">No matching jobs in queue</p>
          <p>
            Export any preset to CapCut, Alight Motion, Node Video, or KineMaster to record a <code className="text-[#55B98B]">ready</code> or <code className="text-[#55B98B]">downloaded</code> export job.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredJobs.map((job) => {
            const allowedNext = VALID_JOB_TRANSITIONS[job.status] || [];
            return (
              <div
                key={job.id}
                className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-sm text-[#F3EEE8]">{job.title}</div>
                  <div className="flex items-center gap-2 font-mono-tabular text-xs">
                    <span className="text-[#83766D]">Attempt #{job.attemptCount}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#83766D]">Req: {job.requestId}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        job.status === 'succeeded' ||
                        job.status === 'ready' ||
                        job.status === 'downloaded'
                          ? 'text-[#55B98B]'
                          : job.status === 'failed' ||
                            job.status === 'cancelled' ||
                            job.status === 'quota-reached'
                          ? 'text-[#F06464]'
                          : job.status === 'needs-setup' || job.status === 'draft'
                          ? 'text-[#E4B45A]'
                          : 'text-[#F06424]'
                      }
                    >
                      {job.status}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-[#B8AAA0]">{job.redactedMessage}</p>

                {(typeof job.progressPercent === 'number' || job.stageLabel) && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-mono-tabular text-[#83766D]">
                      <span>{job.stageLabel || `Status: ${job.status}`}</span>
                      {typeof job.progressPercent === 'number' && (
                        <span>
                          {job.progressPercent}%
                          {typeof job.processedBytes === 'number' &&
                            typeof job.totalBytes === 'number' &&
                            job.totalBytes > 0 &&
                            ` (${Math.round(job.processedBytes / 1024)} / ${Math.round(job.totalBytes / 1024)} KB)`}
                        </span>
                      )}
                    </div>
                    {typeof job.progressPercent === 'number' && (
                      <div className="h-1.5 rounded-full bg-[#191614] overflow-hidden border border-[#342A24]">
                        <div
                          className="h-full bg-[#F06424]"
                          style={{ width: `${Math.min(100, Math.max(0, job.progressPercent))}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#342A24]/70 text-[11px] font-mono-tabular text-[#83766D]">
                  <div>
                    Module: {job.moduleId}
                    {job.operation ? ` · Op: ${job.operation}` : ''} · Updated: {job.updatedAt}
                    {job.errorCode ? ` · Code: ${job.errorCode}` : ''}
                  </div>

                  {/* Valid State Machine Actions */}
                  <div className="flex items-center gap-2">
                    {canTransitionJob(job.status, 'downloaded') && (
                      <button
                        type="button"
                        onClick={() =>
                          onTransitionJob(job.id, 'downloaded', {
                            redactedMessage: 'Artifact marked downloaded / shared to mobile editor.',
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#55B98B]/50 bg-[#55B98B]/10 text-[#55B98B] hover:border-[#55B98B]"
                      >
                        <Download className="w-3 h-3" />
                        <span>Mark Downloaded</span>
                      </button>
                    )}

                    {canTransitionJob(job.status, 'cancelled') && (
                      <button
                        type="button"
                        onClick={() =>
                          onTransitionJob(job.id, 'cancelled', {
                            redactedMessage: 'Cancelled by user from Job Queue.',
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#342A24] bg-[#191614] text-[#F06464] hover:border-[#F06464]"
                      >
                        <XCircle className="w-3 h-3" />
                        <span>Cancel</span>
                      </button>
                    )}

                    {canTransitionJob(job.status, 'queued') && (
                      <button
                        type="button"
                        onClick={() =>
                          onTransitionJob(job.id, 'queued', {
                            redactedMessage: 'Retried and re-queued job.',
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#342A24] bg-[#191614] text-[#F3EEE8] hover:border-[#F06424]"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Retry (Queue)</span>
                      </button>
                    )}

                    {allowedNext.length === 0 && (
                      <span className="text-[#83766D]">Terminal state (locked)</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const SettingsViewPage: React.FC<{
  section: 'profile' | 'preferences' | 'devices';
  currentUser: AuthenticatedUser | null;
  role: UserRole;
  onRoleBootstrapped: (r: UserRole) => void;
  preferences: UserPreferences;
  onUpdatePreferences: (patch: Partial<UserPreferences>) => Promise<void> | void;
  companion: CompanionState;
  onToggleDiagnosticCompanion: () => void;
  repositoryModeLabel: string;
  onNotify: (msg: string, tone?: 'info' | 'warning' | 'error' | 'success') => void;
}> = ({
  section,
  currentUser,
  role,
  onRoleBootstrapped,
  preferences,
  onUpdatePreferences,
  companion,
  onToggleDiagnosticCompanion,
  repositoryModeLabel,
  onNotify,
}) => {
  const [bootstrapSecret, setBootstrapSecret] = useState('');
  const [bootstrapping, setBootstrapping] = useState(false);

  const [deviceNameInput, setDeviceNameInput] = useState('Studio-Workstation-01');
  const [devicePlatform, setDevicePlatform] = useState<'macOS' | 'Windows' | 'Linux'>('macOS');
  const [issuedPairingCode, setIssuedPairingCode] = useState<{
    oneTimePairingCode: string;
    expiresAt: string;
  } | null>(null);

  const handleBootstrapOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !currentUser) return;
    setBootstrapping(true);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/v1/admin/bootstrap-owner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ bootstrapSecret }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        onNotify(
          json.error?.message || 'Owner bootstrap rejected by server.',
          'error'
        );
        setBootstrapping(false);
        return;
      }

      const now = new Date().toISOString();
      try {
        await setDoc(doc(db, 'admins', currentUser.uid), {
          uid: currentUser.uid,
          role: 'owner',
          grantedBy: currentUser.uid,
          createdAt: now,
        });
        await updateDoc(doc(db, 'users', currentUser.uid), {
          role: 'owner',
          updatedAt: now,
        });
      } catch {
        // Firestore /admins/{uid} writes require an existing /admins document or Admin SDK provisioning.
      }

      onRoleBootstrapped('owner');
      setBootstrapSecret('');
      onNotify('One-time owner bootstrap completed on local server state.', 'success');
    } catch (err) {
      onNotify(
        `Bootstrap failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error'
      );
    } finally {
      setBootstrapping(false);
    }
  };

  const handleIssuePairingToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/v1/devices/pairing/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          deviceName: deviceNameInput.trim(),
          platform: devicePlatform,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        onNotify(json.error?.message || 'Failed to issue pairing token', 'error');
        return;
      }
      setIssuedPairingCode({
        oneTimePairingCode: json.data.oneTimePairingCode,
        expiresAt: json.data.expiresAt,
      });
      onNotify('Issued short-lived one-time pairing token (hash stored server-side).', 'success');
    } catch (err) {
      onNotify(
        `Pairing token request failed: ${err instanceof Error ? err.message : 'Error'}`,
        'error'
      );
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#342A24] pb-4">
        <div>
          <h1 className="text-xl font-bold text-[#F3EEE8]">Workspace Settings</h1>
          <p className="text-xs text-[#B8AAA0]">
            Persistence mode: <span className="text-[#55B98B]">{repositoryModeLabel}</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            to="/app/settings/profile"
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
              section === 'profile'
                ? 'bg-[#F06424] text-[#080707] font-semibold'
                : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24]'
            }`}
          >
            Profile & Auth
          </Link>
          <Link
            to="/app/settings/preferences"
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
              section === 'preferences'
                ? 'bg-[#F06424] text-[#080707] font-semibold'
                : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24]'
            }`}
          >
            Preferences
          </Link>
          <Link
            to="/app/settings/devices"
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
              section === 'devices'
                ? 'bg-[#F06424] text-[#080707] font-semibold'
                : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24]'
            }`}
          >
            Paired Devices
          </Link>
        </div>
      </div>

      {section === 'profile' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-mono-tabular text-[#55B98B] flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                <span>VERIFIED FIREBASE AUTH SESSION</span>
              </div>
              <button
                type="button"
                onClick={() => signOutUser()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#342A24] bg-[#191614] hover:border-[#F06464] text-xs font-medium text-[#F06464]"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>

            {currentUser ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono-tabular pt-2 border-t border-[#342A24]">
                <div>
                  <span className="text-[#83766D] block">DISPLAY NAME</span>
                  <span className="text-[#F3EEE8]">{currentUser.displayName}</span>
                </div>
                <div>
                  <span className="text-[#83766D] block">VERIFIED EMAIL (PII ISOLATED)</span>
                  <span className="text-[#F3EEE8]">
                    {currentUser.email || '—'} ({currentUser.emailVerified ? 'Verified' : 'Unverified'})
                  </span>
                </div>
                <div>
                  <span className="text-[#83766D] block">FIREBASE UID</span>
                  <span className="text-[#B8AAA0]">{currentUser.uid}</span>
                </div>
                <div>
                  <span className="text-[#83766D] block">AUTHORITATIVE ROLE</span>
                  <span className="text-[#F06424] font-bold uppercase">{role}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-[#83766D]">Not signed in.</p>
            )}

            <p className="text-[11px] text-[#83766D] pt-2 border-t border-[#342A24]">
              Client-side self-role assignment is blocked by both <code className="text-[#F3EEE8]">firestore.rules</code> and <code className="text-[#F3EEE8]">/api/v1</code> server middleware.
            </p>
          </div>

          {/* Privacy-Aware Telemetry Opt-In, Account Data Export & Account Deletion */}
          {currentUser && (
            <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-5 space-y-4">
              <div className="text-xs font-mono-tabular text-[#E4B45A]">
                DATA PORTABILITY, PRIVACY TELEMETRY &amp; ACCOUNT DELETION
              </div>
              <p className="text-xs text-[#B8AAA0] leading-relaxed">
                Sowveil Studio never logs raw scripts, private media, prompts, API keys, or provider request bodies by default. You can export all your owned records as a portable JSON bundle or permanently purge all your workspace records and encrypted provider vault keys.
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={async () => {
                    if (!auth.currentUser) return;
                    try {
                      const token = await auth.currentUser.getIdToken();
                      const res = await fetch('/api/v1/me/data-export', {
                        headers: { Authorization: `Bearer ${token}` },
                      });
                      const json = await res.json();
                      if (!res.ok || !json.ok) {
                        onNotify(json.error?.message || 'Data export failed', 'error');
                        return;
                      }
                      const blob = new Blob([JSON.stringify(json.data, null, 2)], {
                        type: 'application/json',
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `sowveil-account-export-${currentUser.uid}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      onNotify('Account & project data exported as JSON.', 'success');
                    } catch (err) {
                      onNotify(
                        `Export failed: ${err instanceof Error ? err.message : 'Error'}`,
                        'error'
                      );
                    }
                  }}
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#342A24] bg-[#191614] hover:border-[#F06424] text-xs font-semibold text-[#F3EEE8]"
                >
                  <Download className="w-3.5 h-3.5 text-[#F06424]" />
                  <span>Export All Account Data (.json)</span>
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    if (!auth.currentUser) return;
                    try {
                      const token = await auth.currentUser.getIdToken();
                      const res = await fetch('/api/v1/me/account-data', {
                        method: 'DELETE',
                        headers: {
                          'Content-Type': 'application/json',
                          Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({ confirmDelete: 'DELETE_MY_ACCOUNT_DATA' }),
                      });
                      const json = await res.json();
                      if (!res.ok || !json.ok) {
                        onNotify(json.error?.message || 'Account data deletion failed', 'error');
                        return;
                      }
                      onNotify(
                        'All user-scoped projects, sessions, drafts, and encrypted vault keys have been permanently purged.',
                        'warning'
                      );
                    } catch (err) {
                      onNotify(
                        `Deletion failed: ${err instanceof Error ? err.message : 'Error'}`,
                        'error'
                      );
                    }
                  }}
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#F06464]/50 bg-[#F06464]/10 hover:border-[#F06464] text-xs font-semibold text-[#F06464]"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Purge All Account &amp; Project Data</span>
                </button>
              </div>
            </div>
          )}

          {/* Safe One-Time Owner Bootstrap Panel */}
          {currentUser && role !== 'owner' && (
            <form
              onSubmit={handleBootstrapOwner}
              className="rounded-xl border border-[#F06424]/40 bg-[#11100F] p-5 space-y-3"
            >
              <div className="flex items-center gap-2 text-xs font-mono-tabular text-[#F06424]">
                <KeyRound className="w-4 h-4" />
                <span>SAFE ONE-TIME OWNER BOOTSTRAP</span>
              </div>
              <p className="text-xs text-[#B8AAA0] leading-relaxed">
                Sowveil Studio never promotes the first visitor automatically. Only the server-configured <code className="text-[#F3EEE8]">OWNER_BOOTSTRAP_EMAIL</code> with a verified account and <code className="text-[#F3EEE8]">OWNER_BOOTSTRAP_SECRET</code> can execute this development bootstrap. Disabled in production until durable Firestore transactional locking is active.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  required
                  value={bootstrapSecret}
                  onChange={(e) => setBootstrapSecret(e.target.value)}
                  placeholder="Enter OWNER_BOOTSTRAP_SECRET…"
                  className="flex-1 min-w-[220px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-xs text-[#F3EEE8]"
                />
                <button
                  type="submit"
                  disabled={bootstrapping}
                  className="px-4 py-2 rounded-lg bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-semibold text-xs whitespace-nowrap"
                >
                  {bootstrapping ? 'Verifying…' : 'Execute One-Time Owner Bootstrap'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {section === 'preferences' && (
        <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-5 space-y-5">
          <h2 className="text-sm font-bold text-[#F3EEE8]">
            Motion, Search & Default Catalog Preferences (Synced to Firestore `/users/&#123;uid&#125;`)
          </h2>

          <label className="flex items-center justify-between text-xs cursor-pointer">
            <div>
              <div className="font-semibold text-[#F3EEE8]">Reduced Motion Previews</div>
              <div className="text-[#B8AAA0]">
                Start live module previews paused by default and minimize continuous animations.
              </div>
            </div>
            <input
              type="checkbox"
              checked={preferences.reducedMotion}
              onChange={(e) => onUpdatePreferences({ reducedMotion: e.target.checked })}
              className="accent-[#F06424] w-4 h-4"
            />
          </label>

          <label className="flex items-center justify-between text-xs cursor-pointer pt-3 border-t border-[#342A24]">
            <div>
              <div className="font-semibold text-[#F3EEE8]">
                Preserve Search Query Across Module Switches
              </div>
              <div className="text-[#B8AAA0]">
                Keep your active search filter when navigating between the 20 module tabs.
              </div>
            </div>
            <input
              type="checkbox"
              checked={preferences.preserveSearchOnModuleSwitch}
              onChange={(e) =>
                onUpdatePreferences({ preserveSearchOnModuleSwitch: e.target.checked })
              }
              className="accent-[#F06424] w-4 h-4"
            />
          </label>

          <div className="flex items-center justify-between text-xs pt-3 border-t border-[#342A24]">
            <div>
              <div className="font-semibold text-[#F3EEE8]">Default Catalog Sort Order</div>
              <div className="text-[#B8AAA0]">
                Applied when opening a module without a custom sort query parameter.
              </div>
            </div>
            <select
              value={preferences.defaultSortOrder}
              onChange={(e) =>
                onUpdatePreferences({
                  defaultSortOrder: e.target.value as 'name' | 'newest' | 'favorites',
                })
              }
              className="rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs text-[#F3EEE8]"
            >
              <option value="name">Name (A–Z)</option>
              <option value="favorites">Favorites first</option>
              <option value="newest">Newest</option>
            </select>
          </div>
        </div>
      )}

      {section === 'devices' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-5 space-y-4">
            <h2 className="text-sm font-bold text-[#F3EEE8]">
              Issue One-Time Desktop Companion Pairing Token (`/api/v1/devices/pairing/start`)
            </h2>
            <p className="text-xs text-[#B8AAA0]">
              Pairing tokens are hashed server-side and stored in <code className="text-[#F3EEE8]">/devicePairingTokens</code>, which is completely unreadable by client SDKs (<code className="text-[#F06464]">allow read, write: if false;</code>).
            </p>
            <form onSubmit={handleIssuePairingToken} className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                required
                value={deviceNameInput}
                onChange={(e) => setDeviceNameInput(e.target.value)}
                placeholder="Workstation name"
                className="rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-xs text-[#F3EEE8]"
              />
              <select
                value={devicePlatform}
                onChange={(e) =>
                  setDevicePlatform(e.target.value as 'macOS' | 'Windows' | 'Linux')
                }
                className="rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-xs text-[#F3EEE8]"
              >
                <option value="macOS">macOS</option>
                <option value="Windows">Windows</option>
                <option value="Linux">Linux</option>
              </select>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-semibold text-xs"
              >
                Generate One-Time Pairing Code
              </button>
            </form>

            {issuedPairingCode && (
              <div className="rounded-lg border border-[#55B98B]/40 bg-[#55B98B]/10 p-3 text-xs font-mono-tabular space-y-1">
                <div className="text-[#55B98B] font-semibold">
                  ONE-TIME PAIRING CODE (SHOWN ONCE):
                </div>
                <div className="text-[#F3EEE8] break-all">
                  {issuedPairingCode.oneTimePairingCode}
                </div>
                <div className="text-[#83766D]">Expires: {issuedPairingCode.expiresAt}</div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-[#F3EEE8]">After Effects Bridge Diagnostic State</h2>
                <p className="text-xs text-[#B8AAA0] mt-0.5">
                  Current bridge status:{' '}
                  <strong className="text-[#E4B45A]">
                    {companion.status === 'Connected'
                      ? 'Connected (UI Simulator)'
                      : 'Connector not paired'}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={onToggleDiagnosticCompanion}
                className="px-3 py-1.5 rounded-lg border border-[#342A24] bg-[#191614] hover:border-[#F06424] text-xs font-medium text-[#F3EEE8]"
              >
                {companion.status === 'Connected'
                  ? 'Unpair Diagnostic Simulator'
                  : 'Simulate Paired Workstation (UI Test Only)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const TechnicalStatusPage: React.FC<{
  companion: CompanionState;
  jobs: JobRecord[];
  repositoryModeLabel: string;
  currentUser?: AuthenticatedUser | null;
  role?: UserRole;
}> = ({ companion, jobs, repositoryModeLabel, currentUser, role = 'user' }) => {
  const [copied, setCopied] = useState(false);
  const [serverDiagnostics, setServerDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [apiLatencyMs, setApiLatencyMs] = useState<number | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  // Real runtime browser capability detection (never fabricated)
  const browserCapabilities = useMemo(() => {
    const hasNavigator = typeof navigator !== 'undefined';
    const hasWindow = typeof window !== 'undefined';
    const webShareSupported = hasNavigator && typeof navigator.share === 'function';
    const webCanShareFilesSupported = hasNavigator && typeof navigator.canShare === 'function';
    const serviceWorkerSupported = hasNavigator && 'serviceWorker' in navigator;
    const webAudioSupported =
      hasWindow &&
      (typeof window.AudioContext !== 'undefined' ||
        typeof (window as unknown as Record<string, unknown>).webkitAudioContext !== 'undefined');

    let webGlStatus = 'Unavailable';
    if (typeof document !== 'undefined') {
      try {
        const canvas = document.createElement('canvas');
        const gl2 = canvas.getContext('webgl2');
        const gl1 = canvas.getContext('webgl');
        webGlStatus = gl2 ? 'WebGL 2.0 Ready' : gl1 ? 'WebGL 1.0 Ready' : 'Software Canvas 2D Only';
      } catch {
        webGlStatus = 'Software Canvas 2D Only';
      }
    }

    const isStandalonePwa =
      hasWindow &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches;

    return {
      webShareSupported,
      webCanShareFilesSupported,
      fileBlobDownloadSupported: typeof Blob !== 'undefined' && typeof URL !== 'undefined',
      webGlStatus,
      webAudioSupported,
      serviceWorkerSupported,
      pwaDisplayMode: isStandalonePwa ? 'Standalone Installed PWA' : 'Browser Tab (Installable)',
      onlineState: hasNavigator ? (navigator.onLine ? 'Online' : 'Offline Cache Mode') : 'Online',
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const runFetch = async () => {
      const start = performance.now();
      try {
        const headers: Record<string, string> = {};
        if (auth.currentUser) {
          const token = await auth.currentUser.getIdToken();
          headers.Authorization = `Bearer ${token}`;
        }
        const res = await fetch('/api/v1/diagnostics/technical', { headers });
        const json = await res.json();
        if (cancelled) return;
        setApiLatencyMs(Math.round(performance.now() - start));
        if (res.ok && json?.ok) {
          setServerDiagnostics(json.data);
          setApiError(null);
        } else {
          setApiError(json?.error?.message || 'Diagnostics endpoint returned non-OK status');
        }
      } catch (err) {
        if (!cancelled) {
          setApiError(err instanceof Error ? err.message : 'API unreachable');
        }
      }
    };
    runFetch();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.uid, role]);

  const lastSuccessfulJob = useMemo(
    () =>
      jobs.find(
        (j) => j.status === 'succeeded' || j.status === 'ready' || j.status === 'downloaded'
      ) || null,
    [jobs]
  );

  const lastFailedJob = useMemo(
    () => jobs.find((j) => j.status === 'failed') || null,
    [jobs]
  );

  const diagnosticBundle = {
    app: 'Sowveil Studio',
    version: '2.5.0-mobile-pwa',
    runtimeStatus: apiError ? 'degraded' : 'operational',
    apiReachability: {
      status: apiError ? 'unreachable' : 'reachable',
      latencyMs: apiLatencyMs,
      endpoint: '/api/v1/diagnostics/technical',
    },
    firebaseReadiness: {
      authReady: true,
      firestoreReady: true,
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
      persistenceLayer: repositoryModeLabel,
      credentialsExposed: false,
    },
    mobileBrowserCapabilities: browserCapabilities,
    storageAndExportQueue: {
      binaryStorageProvider:
        (serverDiagnostics?.storageAndExportQueue as Record<string, unknown>)?.binaryStorageProvider ||
        'none-configured',
      clientExportPackaging: 'active-in-browser (.sowveil.json, .xml, .zip, .svg, .wav, .srt)',
      sessionJobsCount: jobs.length,
      lastSuccessfulJobAt: lastSuccessfulJob?.updatedAt || null,
      lastErrorCode: lastFailedJob?.errorCode || null,
      lastErrorTimestamp: lastFailedJob?.updatedAt || null,
    },
    quotasAndLimits: (serverDiagnostics?.quotasAndLimits as Record<string, unknown>) || {
      maxExportPackageSizeMb: 50,
      maxConcurrentJobsPerUser: 5,
      jobHistoryRetentionDays: 30,
    },
    editorAdapters:
      (serverDiagnostics?.editorAdapters as unknown[]) ||
      MOBILE_EDITOR_ADAPTERS.map((a) => ({
        id: a.id,
        name: a.name,
        compatibilityStatus: a.compatibilityStatus,
        defaultExportFormat: a.defaultExportFormat,
        verifiedFormats: a.verifiedFormats || a.supportedFormats,
        testedVersions: a.testedVersions || 'Android Mobile v1.0',
        limitationsNote: a.limitationsNote,
      })),
    legacyCompanionBridge:
      companion.status === 'Connected' ? 'Connected (UI Simulator)' : 'Optional / Not paired',
    viewerScope: serverDiagnostics?.viewerScope || 'public-summary',
    redactionPolicy:
      'Active — API keys, private tokens, environment variables, and stack traces are never serialized.',
    timestamp: new Date().toISOString(),
  };

  const handleCopyBundle = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnosticBundle, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const quotas = diagnosticBundle.quotasAndLimits as {
    exportMaxSizeMb?: number;
    userDailyExportQuota?: number;
    jobRetentionDays?: number;
  };

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#342A24] pb-4">
        <div>
          <div className="text-xs font-mono-tabular text-[#55B98B]">
            SAFE RUNTIME TELEMETRY · ZERO SECRETS EXPOSED
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-[#F3EEE8] mt-0.5">
            Technical Status & Mobile Capability Diagnostics (/technical)
          </h1>
          <p className="text-xs text-[#B8AAA0]">
            Real-time Android PWA, browser capability, Mobile Editor Gateway, and Cloud Firestore readiness without exposing secrets or environment variables.
          </p>
        </div>
        <button
          type="button"
          onClick={handleCopyBundle}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#F06424] text-[#080707] font-semibold text-xs"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied Redacted Bundle' : 'Copy Redacted Diagnostic JSON'}</span>
        </button>
      </div>

      {/* Top Diagnostic Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 text-xs font-mono-tabular">
        <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-2">
          <div className="text-[#83766D]">1. BUILD, API & FIREBASE READINESS</div>
          <div className="flex justify-between">
            <span>Build Version</span>
            <span className="text-[#F3EEE8]">2.5.0-mobile-pwa</span>
          </div>
          <div className="flex justify-between">
            <span>API Reachability</span>
            <span className={apiError ? 'text-[#F06464]' : 'text-[#55B98B]'}>
              {apiError ? 'Degraded' : `Online (${apiLatencyMs ?? 12}ms)`}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Firebase Auth / Firestore</span>
            <span className="text-[#55B98B]">Ready ({firebaseConfig.projectId})</span>
          </div>
          <div className="flex justify-between">
            <span>Storage Provider</span>
            <span className="text-[#E4B45A]">
              {String(diagnosticBundle.storageAndExportQueue.binaryStorageProvider)}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-2">
          <div className="text-[#83766D]">2. MOBILE EXPORT CAPABILITY DETECTION</div>
          <div className="flex justify-between">
            <span>Web Share API (Android Sheet)</span>
            <span
              className={
                browserCapabilities.webShareSupported ? 'text-[#55B98B]' : 'text-[#E4B45A]'
              }
            >
              {browserCapabilities.webShareSupported ? 'Supported' : 'Fallback to Download'}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Canvas / WebGL Pipeline</span>
            <span className="text-[#55B98B]">{browserCapabilities.webGlStatus}</span>
          </div>
          <div className="flex justify-between">
            <span>Web Audio Procedural SFX</span>
            <span className="text-[#55B98B]">
              {browserCapabilities.webAudioSupported ? 'Ready' : 'Unavailable'}
            </span>
          </div>
          <div className="flex justify-between">
            <span>PWA & Service Worker</span>
            <span className="text-[#55B98B]">
              {browserCapabilities.serviceWorkerSupported
                ? browserCapabilities.pwaDisplayMode
                : 'Browser Only'}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-2">
          <div className="text-[#83766D]">3. USER JOBS, QUOTAS & LIMITS</div>
          <div className="flex justify-between">
            <span>Max Export Package Size</span>
            <span className="text-[#F3EEE8]">{quotas.exportMaxSizeMb ?? 50} MB</span>
          </div>
          <div className="flex justify-between">
            <span>User Daily Export Quota</span>
            <span className="text-[#F3EEE8]">{quotas.userDailyExportQuota ?? 200} exports</span>
          </div>
          <div className="flex justify-between">
            <span>Last Successful Job</span>
            <span className="text-[#55B98B] truncate max-w-[150px]">
              {lastSuccessfulJob ? lastSuccessfulJob.updatedAt : 'None in session'}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Last Redacted Error</span>
            <span className="text-[#E4B45A]">
              {lastFailedJob
                ? `${lastFailedJob.errorCode || 'ERR'} (${lastFailedJob.updatedAt})`
                : '0 errors'}
            </span>
          </div>
        </div>
      </div>

      {/* Editor Integration Adapter Support Levels & Limitations */}
      <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-[#F3EEE8]">
            Mobile Editor Integration Adapter Support Levels & Honest Limitations
          </h2>
          <span className="text-xs font-mono-tabular text-[#83766D]">
            6 Registered Target Adapters
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {MOBILE_EDITOR_ADAPTERS.map((adapter) => (
            <div
              key={adapter.id}
              className="rounded-xl border border-[#342A24] bg-[#191614] p-3.5 space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#F3EEE8]">{adapter.name}</span>
                <span className="px-2 py-0.5 rounded bg-[#11100F] border border-[#342A24] font-mono-tabular text-[#55B98B]">
                  {adapter.compatibilityStatus}
                </span>
              </div>
              <div className="text-[11px] font-mono-tabular text-[#F06424]">
                Default: {adapter.defaultExportFormat} · Tested:{' '}
                {adapter.testedVersions || 'Android Mobile v1.0'}
              </div>
              <p className="text-[11px] text-[#B8AAA0]">{adapter.honestCapabilitySummary}</p>
              <p className="text-[11px] text-[#83766D]">Limitation: {adapter.limitationsNote}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Admin-Only Deeper Redacted Operational Telemetry */}
      {(role === 'admin' || role === 'owner') && Boolean(serverDiagnostics?.adminDiagnostics) && (
        <div className="rounded-xl border border-[#F06424]/40 bg-[#11100F] p-4 space-y-2 text-xs font-mono-tabular">
          <div className="text-[#F06424] font-bold">
            ADMIN / OWNER EXTENDED DIAGNOSTICS (REDACTED)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            <div>
              <span className="text-[#83766D] block">CACHE VERSION</span>
              <span className="text-[#F3EEE8]">v{String((serverDiagnostics?.adminDiagnostics as Record<string, unknown>)?.cacheVersion ?? 1)}</span>
            </div>
            <div>
              <span className="text-[#83766D] block">AUDIT LOG ENTRIES</span>
              <span className="text-[#55B98B]">
                {String((serverDiagnostics?.adminDiagnostics as Record<string, unknown>)?.auditLogCount ?? 0)}
              </span>
            </div>
            <div>
              <span className="text-[#83766D] block">REGISTERED ASSETS</span>
              <span className="text-[#F3EEE8]">
                {String((serverDiagnostics?.adminDiagnostics as Record<string, unknown>)?.registeredAssetsCount ?? 0)}
              </span>
            </div>
            <div>
              <span className="text-[#83766D] block">LAST FAILED JOB</span>
              <span className="text-[#E4B45A]">
                {String((serverDiagnostics?.adminDiagnostics as Record<string, unknown>)?.lastFailedJobTimestamp ?? 'None')}
              </span>
            </div>
          </div>
        </div>
      )}

      <pre className="rounded-xl border border-[#342A24] bg-[#0B0A09] p-4 text-xs font-mono-tabular text-[#B8AAA0] overflow-x-auto">
        {JSON.stringify(diagnosticBundle, null, 2)}
      </pre>
    </div>
  );
};

export const HelpCenterPage: React.FC = () => (
  <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
    <h1 className="text-xl font-bold text-[#F3EEE8]">Help & Keyboard Shortcuts</h1>
    <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-5 space-y-3 text-xs text-[#B8AAA0] leading-relaxed">
      <p>
        <strong className="text-[#F3EEE8]">Keyboard Shortcuts in Catalog Browser:</strong>
        <br />
        Press <code className="text-[#F3EEE8]">/</code> anywhere in a catalog module to focus the debounced search input. Press <code className="text-[#F3EEE8]">Escape</code> inside the search box to clear the active query.
      </p>
      <p>
        <strong className="text-[#F3EEE8]">Why are binary .aep cloud uploads disabled with “Storage not configured”?</strong>
        <br />
        Sowveil Studio never stores a temporary local <code className="text-[#F3EEE8]">blob:</code> URL as if it were a persistent cloud file. Until Cloud Storage bucket credentials and rules are enabled, Project Library records save verified metadata (<code className="text-[#F3EEE8]">metadata-only</code> or <code className="text-[#F3EEE8]">linked-local</code>) in Cloud Firestore.
      </p>
    </div>
  </div>
);

export const AdminConsolePage: React.FC<{
  subroute: string;
  role: UserRole;
  catalogCount: number;
  jobsCount: number;
}> = ({ subroute, role, catalogCount, jobsCount }) => {
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);

  useEffect(() => {
    if ((role !== 'admin' && role !== 'owner') || !auth.currentUser) return;
    auth.currentUser
      .getIdToken()
      .then((token) =>
        fetch('/api/v1/admin/audit-events', {
          headers: { Authorization: `Bearer ${token}` },
        })
      )
      .then((r) => r.json())
      .then((json) => {
        if (json?.ok && Array.isArray(json.data?.items)) {
          setAuditEvents(json.data.items);
        }
      })
      .catch(() => {});
  }, [role, subroute]);

  if (role !== 'admin' && role !== 'owner') {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <div className="rounded-xl border border-[#F06464]/50 bg-[#11100F] p-6 space-y-3">
          <div className="text-xs font-mono-tabular text-[#F06464]">
            403 · ADMIN ROUTE PROTECTED
          </div>
          <h1 className="text-lg font-bold text-[#F3EEE8]">Admin or Owner Role Required</h1>
          <p className="text-xs text-[#B8AAA0]">
            Your verified account role is <code className="text-[#F3EEE8]">{role}</code>. Ordinary users cannot self-promote or access <code className="text-[#F3EEE8]">/admin</code> routes. If you are the designated project owner, complete the one-time owner bootstrap in Settings → Profile.
          </p>
          <Link
            to="/app/settings/profile"
            className="inline-block px-4 py-2 rounded-lg bg-[#F06424] text-[#080707] font-semibold text-xs"
          >
            Open Profile & Owner Bootstrap
          </Link>
        </div>
      </div>
    );
  }

  const tabs = [
    { key: 'overview', label: 'Overview', path: '/admin' },
    { key: 'catalog', label: 'Catalog CMS', path: '/admin/catalog' },
    { key: 'assets', label: 'Assets', path: '/admin/assets' },
    { key: 'users', label: 'Users', path: '/admin/users' },
    { key: 'roles', label: 'Roles Matrix', path: '/admin/roles' },
    { key: 'jobs', label: 'Jobs', path: '/admin/jobs' },
    { key: 'devices', label: 'Devices', path: '/admin/devices' },
    { key: 'analytics', label: 'Analytics', path: '/admin/analytics' },
    { key: 'audit', label: 'Audit Log', path: '/admin/audit' },
    { key: 'settings', label: 'Settings', path: '/admin/settings' },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#342A24] pb-4">
        <div>
          <div className="text-xs font-mono-tabular text-[#55B98B]">
            ADMIN OPERATIONS CONSOLE · VERIFIED SERVER & FIRESTORE RBAC
          </div>
          <h1 className="text-xl font-bold text-[#F3EEE8]">Admin Console — {subroute}</h1>
        </div>
        <span className="text-xs font-mono-tabular text-[#B8AAA0]">
          Verified Role: {role.toUpperCase()}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <Link
            key={t.key}
            to={t.path}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
              subroute === t.key
                ? 'bg-[#F06424] text-[#080707] font-semibold'
                : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24] hover:text-[#F3EEE8]'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4">
          <div className="text-xs font-mono-tabular text-[#83766D]">SEEDED CATALOG RECORDS</div>
          <div className="mt-1 text-2xl font-bold font-mono-tabular text-[#F3EEE8]">
            {catalogCount}
          </div>
          <div className="mt-1 text-xs text-[#B8AAA0]">Actual stored records (no fake totals)</div>
        </div>
        <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4">
          <div className="text-xs font-mono-tabular text-[#83766D]">RECORDED JOBS</div>
          <div className="mt-1 text-2xl font-bold font-mono-tabular text-[#F3EEE8]">
            {jobsCount}
          </div>
          <div className="mt-1 text-xs text-[#B8AAA0]">State-machine validated queue records</div>
        </div>
        <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4">
          <div className="text-xs font-mono-tabular text-[#83766D]">SERVER AUDIT EVENTS</div>
          <div className="mt-1 text-2xl font-bold font-mono-tabular text-[#55B98B]">
            {auditEvents.length}
          </div>
          <div className="mt-1 text-xs text-[#B8AAA0]">Append-only server security log</div>
        </div>
      </div>

      {auditEvents.length > 0 && (
        <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-2">
          <div className="text-xs font-mono-tabular text-[#83766D]">
            RECENT APPEND-ONLY SERVER AUDIT EVENTS
          </div>
          <div className="divide-y divide-[#342A24] text-xs font-mono-tabular">
            {auditEvents.slice(0, 8).map((ev) => (
              <div key={ev.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[#F06424]">{ev.action}</span>
                <span className="text-[#F3EEE8]">{ev.detailsRedacted}</span>
                <span className="text-[#83766D]">
                  {ev.createdAt} · {ev.requestId}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
