import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { SOWVEIL_MODULES, MODULE_CATEGORIES } from './data/modules';
import { SEED_CATALOG_ITEMS } from './data/catalogSeeds';
import {
  AuthenticatedUser,
  AuthErrorState,
  CompanionState,
  JobRecord,
  JobStatus,
  ModuleId,
  ProjectLibraryItem,
  UserPreferences,
  UserRole,
} from './types/sowveil';
import { computeActualModuleCounts } from './services/catalogEngine';
import {
  firestoreWorkspaceRepository,
  workspaceRepository,
} from './repositories/workspaceRepository';
import {
  auth,
  classifyFirebaseAuthError,
  DEFAULT_USER_PREFERENCES,
  syncAndLoadAuthenticatedUser,
} from './services/firebaseClient';
import { ModuleStrip } from './components/ModuleStrip';
import { CatalogBrowserWorkspace } from './components/CatalogBrowserWorkspace';
import {
  AutoCaptionsWorkspace,
  DownloaderWorkspace,
  ProjectLibraryWorkspace,
} from './components/UtilityWorkspaces';
import {
  DocsPage,
  FeaturesPage,
  LandingPage,
  PrivacyPage,
  SignInPage,
  TermsPage,
} from './components/PublicPages';
import {
  AppDashboardPage,
  FavoritesPage,
  HelpCenterPage,
  JobsHistoryPage,
  SettingsViewPage,
  TechnicalStatusPage,
} from './components/SecondaryAppPages';
import { AdminConsoleWorkspace } from './components/AdminConsoleWorkspace';
import { ReferenceLabWorkspace } from './components/ReferenceLabWorkspace';
import { ProviderHubWorkspace } from './components/ProviderHubWorkspace';
import { AiDirectorWorkspace } from './components/AiDirectorWorkspace';
import { EditingStudioWorkspace } from './components/EditingStudioWorkspace';
import { TemplateFactoryWorkspace } from './components/TemplateFactoryWorkspace';
import { RenderExportQaWorkspace } from './components/RenderExportQaWorkspace';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallBanner';
import {
  FolderKanban,
  Heart,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  Settings,
  X,
} from 'lucide-react';

interface ToastBanner {
  id: string;
  message: string;
  tone: 'info' | 'warning' | 'error' | 'success';
}

const WorkspaceModuleRoute: React.FC<{
  favoriteIds: string[];
  onToggleFavorite: (id: string) => Promise<void>;
  companion: CompanionState;
  preferences: UserPreferences;
  projects: ProjectLibraryItem[];
  onAddProject: (p: Omit<ProjectLibraryItem, 'id' | 'updatedAt'>) => Promise<void>;
  onUpdateProject: (id: string, patch: Partial<ProjectLibraryItem>) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onQueueJob: (
    job: Omit<
      JobRecord,
      'id' | 'createdAt' | 'updatedAt' | 'requestId' | 'attemptCount' | 'idempotencyKey'
    >
  ) => Promise<void>;
  onNotify: (message: string, tone?: 'info' | 'warning' | 'error' | 'success') => void;
}> = ({
  favoriteIds,
  onToggleFavorite,
  companion,
  preferences,
  projects,
  onAddProject,
  onUpdateProject,
  onDeleteProject,
  onQueueJob,
  onNotify,
}) => {
  const { moduleId } = useParams<{ moduleId: string }>();
  const mod = SOWVEIL_MODULES.find((m) => m.id === moduleId) || SOWVEIL_MODULES[0];

  const moduleItems = useMemo(
    () => SEED_CATALOG_ITEMS.filter((i) => i.moduleId === mod.id && i.visibility === 'published'),
    [mod.id]
  );

  const moduleCategories = useMemo(
    () =>
      MODULE_CATEGORIES.filter((c) => c.moduleId === mod.id).sort((a, b) => a.order - b.order),
    [mod.id]
  );

  if (mod.workspaceKind === 'auto-captions') {
    return (
      <AutoCaptionsWorkspace
        companion={companion}
        projects={projects}
        onQueueJob={onQueueJob}
        onNotify={onNotify}
      />
    );
  }

  if (mod.workspaceKind === 'downloader') {
    return (
      <DownloaderWorkspace
        companion={companion}
        onQueueJob={onQueueJob}
        onNotify={onNotify}
      />
    );
  }

  if (mod.workspaceKind === 'project-library') {
    return (
      <ProjectLibraryWorkspace
        projects={projects}
        onAddProject={onAddProject}
        onUpdateProject={onUpdateProject}
        onDeleteProject={onDeleteProject}
        companion={companion}
        onNotify={onNotify}
      />
    );
  }

  return (
    <CatalogBrowserWorkspace
      moduleDef={mod}
      items={moduleItems}
      categories={moduleCategories}
      favoriteIds={favoriteIds}
      onToggleFavorite={onToggleFavorite}
      companion={companion}
      reducedMotion={preferences.reducedMotion}
      defaultSortOrder={preferences.defaultSortOrder}
      preserveSearchOnModuleSwitch={preferences.preserveSearchOnModuleSwitch}
      onQueueJob={onQueueJob}
      onSaveProject={onAddProject}
      onNotify={onNotify}
    />
  );
};

const AuthenticatedAppShell: React.FC<{
  children: React.ReactNode;
  currentUser: AuthenticatedUser | null;
  role: UserRole;
  favoriteIds: string[];
  jobsCount: number;
  companion: CompanionState;
  itemCountsByModule: Record<string, number>;
  toast: ToastBanner | null;
  onDismissToast: () => void;
}> = ({
  children,
  currentUser,
  role,
  favoriteIds,
  jobsCount,
  companion,
  itemCountsByModule,
  toast,
  onDismissToast,
}) => {
  const location = useLocation();
  const navigate = useNavigate();

  const activeModuleId = useMemo<ModuleId>(() => {
    const match = SOWVEIL_MODULES.find((m) => location.pathname === m.route);
    return match ? match.id : 'text-animation';
  }, [location.pathname]);

  const isModulesActive =
    location.pathname.startsWith('/app/') &&
    !location.pathname.startsWith('/app/favorites') &&
    !location.pathname.startsWith('/app/jobs') &&
    !location.pathname.startsWith('/app/settings') &&
    !location.pathname.startsWith('/app/template-factory') &&
    !location.pathname.startsWith('/app/project-library');

  return (
    <div className="min-h-screen flex flex-col bg-[#080707] text-[#F3EEE8] pb-16 md:pb-0">
      <OfflineIndicator />
      <header className="flex items-center justify-between gap-4 px-4 sm:px-6 py-2 border-b border-[#2A231E] bg-[#0B0A09]">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm sm:text-base font-extrabold tracking-[0.18em] text-[#F3EEE8] whitespace-nowrap shrink-0"
          >
            <span>SOWVEIL</span>
            <span className="px-2 py-0.5 rounded bg-[#2A1810] border border-[#F06424]/50 text-[#F06424] text-[10px] font-bold tracking-[0.14em]">
              STUDIO
            </span>
          </Link>
        </div>

        <nav
          aria-label="Workspace Navigation"
          className="hidden md:flex items-center gap-4 text-xs font-medium text-[#B8AAA0]"
        >
          <Link
            to="/app"
            className="hover:text-[#F3EEE8] transition-colors whitespace-nowrap shrink-0"
          >
            Dashboard
          </Link>
          <Link
            to="/app/project-library"
            className="hover:text-[#F3EEE8] transition-colors whitespace-nowrap shrink-0"
          >
            Projects
          </Link>
          <Link
            to="/app/reference-lab"
            className="hover:text-[#F06424] text-[#F3EEE8] transition-colors whitespace-nowrap shrink-0 font-semibold"
          >
            Reference Lab
          </Link>
          <Link
            to="/app/provider-hub"
            className="hover:text-[#F06424] text-[#F3EEE8] transition-colors whitespace-nowrap shrink-0 font-semibold"
          >
            Provider Hub
          </Link>
          <Link
            to="/app/ai-director"
            className="hover:text-[#F06424] text-[#F06424] transition-colors whitespace-nowrap shrink-0 font-semibold"
            data-testid="nav-ai-director-link"
          >
            AI Director
          </Link>
          <Link
            to="/app/editor"
            className="hover:text-[#F06424] text-[#F3EEE8] transition-colors whitespace-nowrap shrink-0 font-semibold"
            data-testid="nav-editing-studio-link"
          >
            Editing Studio
          </Link>
          <Link
            to="/app/template-factory"
            className="hover:text-[#F06424] text-[#F3EEE8] transition-colors whitespace-nowrap shrink-0 font-semibold"
            data-testid="nav-template-factory-link"
          >
            Template Factory
          </Link>
          <Link
            to="/app/render-export"
            className="hover:text-[#F06424] text-[#55B98B] transition-colors whitespace-nowrap shrink-0 font-semibold"
            data-testid="nav-render-export-link"
          >
            Render &amp; QA
          </Link>
          <Link
            to="/app/favorites"
            className="hover:text-[#F3EEE8] transition-colors whitespace-nowrap shrink-0 tabular-nums"
          >
            Favorites ({favoriteIds.length})
          </Link>
          <Link
            to="/app/jobs"
            className="hover:text-[#F3EEE8] transition-colors whitespace-nowrap shrink-0 tabular-nums"
          >
            Jobs ({jobsCount})
          </Link>
          <Link
            to="/technical"
            className="hover:text-[#F3EEE8] transition-colors whitespace-nowrap shrink-0"
          >
            Technical
          </Link>
          {(role === 'admin' || role === 'owner') && (
            <Link
              to="/admin"
              className="text-[#F06424] hover:underline transition-colors whitespace-nowrap shrink-0"
            >
              Admin Console
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton />
          {currentUser && (
            <span className="hidden lg:inline text-xs font-mono-tabular text-[#83766D]">
              {currentUser.displayName} ({role})
            </span>
          )}
          {(role === 'admin' || role === 'owner') && (
            <Link
              to="/admin"
              className="md:hidden min-h-[38px] inline-flex items-center px-2.5 py-1.5 rounded-lg border border-[#F06424]/50 bg-[#F06424]/15 text-xs font-semibold text-[#F06424]"
            >
              Admin
            </Link>
          )}
          <Link
            to="/app/settings/profile"
            aria-label="Open Workspace Settings"
            className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#342A24] bg-[#191614] hover:border-[#83766D] text-xs font-medium text-[#F3EEE8] whitespace-nowrap shrink-0"
          >
            <Settings className="w-3.5 h-3.5 text-[#F06424]" />
            <span className="hidden sm:inline">Settings</span>
          </Link>
        </div>
      </header>

      <ModuleStrip
        activeModuleId={activeModuleId}
        onSelectModule={(modId) => {
          const target = SOWVEIL_MODULES.find((m) => m.id === modId);
          if (target) {
            navigate(`${target.route}${location.search}`);
          }
        }}
        itemCountsByModule={itemCountsByModule}
      />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="border-b border-[#342A24] bg-[#191614] px-4 sm:px-6 py-2 flex items-center justify-between gap-4 text-xs"
        >
          <span
            className={
              toast.tone === 'warning'
                ? 'text-[#E4B45A]'
                : toast.tone === 'error'
                ? 'text-[#F06464]'
                : toast.tone === 'success'
                ? 'text-[#55B98B]'
                : 'text-[#F3EEE8]'
            }
          >
            {toast.message}
          </span>
          <button
            type="button"
            onClick={onDismissToast}
            aria-label="Dismiss notification"
            className="text-[#83766D] hover:text-[#F3EEE8]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <main className="flex-1">{children}</main>

      <footer className="border-t border-[#2A231E] bg-[#0B0A09] px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-xs font-mono-tabular text-[#83766D]">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              companion.status === 'Connected' ? 'bg-[#55B98B]' : 'bg-[#55B98B]'
            }`}
          />
          <span className="text-[#B8AAA0]">
            {companion.status === 'Connected'
              ? `Connected · ${companion.aeActiveComp || 'No active comp'}`
              : 'Connected · No active comp'}
          </span>
          <span aria-hidden="true" className="hidden sm:inline">
            ·
          </span>
          <span className="hidden sm:inline text-[#55B98B]">
            Mobile Editor Gateway ({workspaceRepository.modeLabel})
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/app/help" className="hover:text-[#F3EEE8]">
            Help
          </Link>
          <span aria-hidden="true">·</span>
          <span className="text-[#B8AAA0]">Sowveil 2.3.0 · After Effects</span>
        </div>
      </footer>

      {/* Android Mobile Thumb-Zone Bottom Navigation Bar (5 destinations max) */}
      <nav
        aria-label="Mobile Bottom Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-[#342A24] bg-[#0B0A09]/95 backdrop-blur-md grid grid-cols-5 h-16 px-1"
      >
        <Link
          to="/app/text-animation"
          className={`flex flex-col items-center justify-center gap-1 text-[10px] font-medium ${
            isModulesActive ? 'text-[#F06424]' : 'text-[#B8AAA0]'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Modules</span>
        </Link>
        <Link
          to="/app/project-library"
          className={`flex flex-col items-center justify-center gap-1 text-[10px] font-medium ${
            location.pathname.startsWith('/app/project-library')
              ? 'text-[#F06424]'
              : 'text-[#B8AAA0]'
          }`}
        >
          <FolderKanban className="w-4 h-4" />
          <span>Projects</span>
        </Link>
        <Link
          to="/app/favorites"
          className={`flex flex-col items-center justify-center gap-1 text-[10px] font-medium ${
            location.pathname.startsWith('/app/favorites')
              ? 'text-[#F06424]'
              : 'text-[#B8AAA0]'
          }`}
        >
          <Heart className="w-4 h-4" />
          <span>Saved ({favoriteIds.length})</span>
        </Link>
        <Link
          to="/app/jobs"
          className={`flex flex-col items-center justify-center gap-1 text-[10px] font-medium ${
            location.pathname.startsWith('/app/jobs') ? 'text-[#F06424]' : 'text-[#B8AAA0]'
          }`}
        >
          <ListChecks className="w-4 h-4" />
          <span>Exports ({jobsCount})</span>
        </Link>
        <Link
          to="/app/settings/profile"
          className={`flex flex-col items-center justify-center gap-1 text-[10px] font-medium ${
            location.pathname.startsWith('/app/settings')
              ? 'text-[#F06424]'
              : 'text-[#B8AAA0]'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Settings</span>
        </Link>
      </nav>
    </div>
  );
};

const ProtectedUserRoute: React.FC<{
  authReady: boolean;
  currentUser: AuthenticatedUser | null;
  children: React.ReactNode;
}> = ({ authReady, currentUser, children }) => {
  const location = useLocation();

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080707] text-[#F3EEE8]">
        <div className="flex items-center gap-2.5 text-xs font-mono-tabular text-[#B8AAA0]">
          <Loader2 className="w-4 h-4 animate-spin text-[#F06424]" />
          <span>Verifying Firebase Authentication session…</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/sign-in?redirect=${redirect}`} replace />;
  }

  return <>{children}</>;
};

const ProtectedAdminRoute: React.FC<{
  authReady: boolean;
  currentUser: AuthenticatedUser | null;
  role: UserRole;
  children: React.ReactNode;
}> = ({ authReady, currentUser, role, children }) => {
  const location = useLocation();

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080707] text-[#F3EEE8]">
        <div className="flex items-center gap-2.5 text-xs font-mono-tabular text-[#B8AAA0]">
          <Loader2 className="w-4 h-4 animate-spin text-[#F06424]" />
          <span>Verifying Admin Authorization…</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/sign-in?redirect=${redirect}`} replace />;
  }

  if (role !== 'admin' && role !== 'owner') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080707] text-[#F3EEE8] p-6">
        <div className="max-w-md w-full rounded-2xl border border-[#F06464]/50 bg-[#11100F] p-6 space-y-4">
          <div className="flex items-center gap-2 text-xs font-mono-tabular text-[#F06464]">
            <Lock className="w-4 h-4" />
            <span>403 · ADMIN ROUTE PROTECTED</span>
          </div>
          <h1 className="text-lg font-bold text-[#F3EEE8]">
            Admin or Owner Privileges Required
          </h1>
          <p className="text-xs text-[#B8AAA0] leading-relaxed">
            Your authenticated account (<code className="text-[#F3EEE8]">{currentUser.email}</code>) has role <code className="text-[#F3EEE8]">{role}</code>. Admin routes are protected separately from standard user routes.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <Link
              to="/app/settings/profile"
              className="px-4 py-2 rounded-lg bg-[#F06424] text-[#080707] font-semibold text-xs"
            >
              Open Profile & Owner Bootstrap
            </Link>
            <Link
              to="/app"
              className="px-4 py-2 rounded-lg border border-[#342A24] bg-[#191614] text-xs text-[#B8AAA0]"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [authError, setAuthError] = useState<AuthErrorState>(null);
  const [role, setRole] = useState<UserRole>('user');
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [projects, setProjects] = useState<ProjectLibraryItem[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);
  const [toast, setToast] = useState<ToastBanner | null>(null);

  const [companion, setCompanion] = useState<CompanionState>({
    status: 'Disconnected',
    pairedDeviceName: null,
    aeActiveComp: null,
    selectedLayersCount: 0,
    selectedLayerType: 'none',
    connectorVersion: null,
    hostVersion: null,
    lastSeenAt: null,
    autoRunEnabled: false,
    dependencies: {
      python: { installed: false, version: null },
      whisper: { installed: false, model: null },
      ffmpeg: { installed: false, version: null },
      ytDlp: { installed: false, version: null },
      depthAnythingV2: { installed: false, modelSizeMb: 335, verified: false },
    },
  });

  const notify = useCallback(
    (
      message: string,
      tone: 'info' | 'warning' | 'error' | 'success' = 'info'
    ) => {
      setToast({ id: String(Date.now()), message, tone });
    },
    []
  );

  // Subscribe to Firebase Authentication state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setCurrentUser(null);
        setRole('user');
        setFavoriteIds([]);
        setProjects([]);
        setJobs([]);
        setPreferences(DEFAULT_USER_PREFERENCES);
        setAuthReady(true);
        return;
      }

      try {
        const { profile, preferences: loadedPrefs } =
          await syncAndLoadAuthenticatedUser(fbUser);
        setCurrentUser(profile);
        setRole(profile.role);
        setPreferences(loadedPrefs);
        setAuthError(null);

        // Load user-scoped Cloud Firestore records ONLY after authentication is verified
        const [favs, projs, jbs] = await Promise.all([
          firestoreWorkspaceRepository.getFavorites(),
          firestoreWorkspaceRepository.seedStarterProjectsForUserIfEmpty(),
          firestoreWorkspaceRepository.listJobs(),
        ]);
        setFavoriteIds(favs);
        setProjects(projs);
        setJobs(jbs);
      } catch (err) {
        setAuthError(classifyFirebaseAuthError(err));
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsubscribe();
  }, []);

  // Optimistic Favorite Add/Remove with automatic rollback on failure
  const toggleFavorite = useCallback(
    async (itemId: string) => {
      const previous = favoriteIds;
      const isCurrentlyFav = previous.includes(itemId);
      const optimisticNext = isCurrentlyFav
        ? previous.filter((id) => id !== itemId)
        : [...previous, itemId];

      setFavoriteIds(optimisticNext);

      try {
        const persisted = isCurrentlyFav
          ? await workspaceRepository.removeFavorite(itemId)
          : await workspaceRepository.addFavorite(itemId);
        setFavoriteIds(persisted);
      } catch (err) {
        setFavoriteIds(previous);
        notify(
          `Failed to update favorite in Firestore (${err instanceof Error ? err.message : 'Error'}). Rolled back state.`,
          'error'
        );
      }
    },
    [favoriteIds, notify]
  );

  const queueJob = useCallback(
    async (
      partial: Omit<
        JobRecord,
        'id' | 'createdAt' | 'updatedAt' | 'requestId' | 'attemptCount' | 'idempotencyKey'
      >
    ) => {
      try {
        await workspaceRepository.createJob(partial);
        const updatedJobs = await workspaceRepository.listJobs();
        setJobs(updatedJobs);
      } catch (err) {
        notify(
          `Failed to queue job: ${err instanceof Error ? err.message : 'Unknown error'}`,
          'error'
        );
      }
    },
    [notify]
  );

  const handleTransitionJob = useCallback(
    async (
      id: string,
      nextStatus: JobStatus,
      options?: { redactedMessage?: string; errorCode?: string }
    ) => {
      try {
        await workspaceRepository.transitionJob(id, nextStatus, options);
        const updatedJobs = await workspaceRepository.listJobs();
        setJobs(updatedJobs);
        notify(`Transitioned job to "${nextStatus}" in Firestore.`, 'info');
      } catch (err) {
        notify(
          `Invalid job transition: ${err instanceof Error ? err.message : 'Error'}`,
          'error'
        );
      }
    },
    [notify]
  );

  const handleClearJobs = useCallback(async () => {
    await workspaceRepository.clearJobs();
    setJobs([]);
    notify('Cleared job history from Cloud Firestore.', 'info');
  }, [notify]);

  const addProject = useCallback(
    async (proj: Omit<ProjectLibraryItem, 'id' | 'updatedAt'>) => {
      await workspaceRepository.createProject(proj);
      const list = await workspaceRepository.listProjects();
      setProjects(list);
    },
    []
  );

  const updateProject = useCallback(
    async (id: string, patch: Partial<ProjectLibraryItem>) => {
      await workspaceRepository.updateProject(id, patch);
      const list = await workspaceRepository.listProjects();
      setProjects(list);
    },
    []
  );

  const deleteProject = useCallback(async (id: string) => {
    await workspaceRepository.deleteProject(id);
    const list = await workspaceRepository.listProjects();
    setProjects(list);
  }, []);

  const handleUpdatePreferences = useCallback(
    async (patch: Partial<UserPreferences>) => {
      const updated = await workspaceRepository.savePreferences(patch);
      setPreferences(updated);
      notify('Saved workspace preferences to Cloud Firestore.', 'success');
    },
    [notify]
  );

  const toggleDiagnosticCompanion = () => {
    setCompanion((prev) =>
      prev.status === 'Connected'
        ? {
            ...prev,
            status: 'Disconnected',
            pairedDeviceName: null,
            aeActiveComp: null,
            dependencies: {
              python: { installed: false, version: null },
              whisper: { installed: false, model: null },
              ffmpeg: { installed: false, version: null },
              ytDlp: { installed: false, version: null },
              depthAnythingV2: { installed: false, modelSizeMb: 335, verified: false },
            },
          }
        : {
            ...prev,
            status: 'Connected',
            pairedDeviceName: 'Studio-Workstation-Sim',
            aeActiveComp: 'Main_Comp_1080p (Diagnostic Sim)',
            connectorVersion: '0.3.0-sim',
            hostVersion: 'Studio Workstation Gateway (Diagnostic Sim)',
            lastSeenAt: new Date().toISOString(),
            dependencies: {
              python: { installed: true, version: '3.11.8 (Sim)' },
              whisper: { installed: true, model: 'turbo (Sim)' },
              ffmpeg: { installed: true, version: '6.1.1 (Sim)' },
              ytDlp: { installed: true, version: '2026.09.01 (Sim)' },
              depthAnythingV2: { installed: false, modelSizeMb: 335, verified: false },
            },
          }
    );
  };

  const itemCountsByModule = useMemo(
    () => computeActualModuleCounts(SEED_CATALOG_ITEMS, projects),
    [projects]
  );

  const favoriteItems = useMemo(
    () => SEED_CATALOG_ITEMS.filter((i) => favoriteIds.includes(i.id)),
    [favoriteIds]
  );

  const wrapUserProtected = (node: React.ReactNode) => (
    <ProtectedUserRoute authReady={authReady} currentUser={currentUser}>
      <AuthenticatedAppShell
        currentUser={currentUser}
        role={role}
        favoriteIds={favoriteIds}
        jobsCount={jobs.length}
        companion={companion}
        itemCountsByModule={itemCountsByModule}
        toast={toast}
        onDismissToast={() => setToast(null)}
      >
        {node}
      </AuthenticatedAppShell>
    </ProtectedUserRoute>
  );

  const wrapAdminProtected = (node: React.ReactNode) => (
    <ProtectedAdminRoute authReady={authReady} currentUser={currentUser} role={role}>
      <AuthenticatedAppShell
        currentUser={currentUser}
        role={role}
        favoriteIds={favoriteIds}
        jobsCount={jobs.length}
        companion={companion}
        itemCountsByModule={itemCountsByModule}
        toast={toast}
        onDismissToast={() => setToast(null)}
      >
        {node}
      </AuthenticatedAppShell>
    </ProtectedAdminRoute>
  );

  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<LandingPage currentUser={currentUser} />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route
          path="/sign-in"
          element={
            <SignInPage
              currentUser={currentUser}
              authLoading={!authReady}
              externalError={authError}
            />
          }
        />
        <Route path="/auth/callback" element={<Navigate to="/app" replace />} />

        {/* Public & Authenticated Technical Diagnostics Route */}
        <Route
          path="/technical"
          element={
            <AuthenticatedAppShell
              currentUser={currentUser}
              role={role}
              favoriteIds={favoriteIds}
              jobsCount={jobs.length}
              companion={companion}
              itemCountsByModule={itemCountsByModule}
              toast={toast}
              onDismissToast={() => setToast(null)}
            >
              <TechnicalStatusPage
                companion={companion}
                jobs={jobs}
                repositoryModeLabel={workspaceRepository.modeLabel}
                currentUser={currentUser}
                role={role}
              />
            </AuthenticatedAppShell>
          }
        />

        {/* Protected Authenticated User Routes */}
        <Route
          path="/app"
          element={wrapUserProtected(
            <AppDashboardPage
              favoriteItems={favoriteItems}
              projects={projects}
              jobs={jobs}
              companion={companion}
              repositoryModeLabel={workspaceRepository.modeLabel}
            />
          )}
        />
        <Route path="/app/workspace" element={<Navigate to="/app/text-animation" replace />} />
        <Route
          path="/app/favorites"
          element={wrapUserProtected(
            <FavoritesPage
              favoriteItems={favoriteItems}
              onToggleFavorite={toggleFavorite}
              repositoryModeLabel={workspaceRepository.modeLabel}
            />
          )}
        />
        <Route
          path="/app/jobs"
          element={wrapUserProtected(
            <JobsHistoryPage
              jobs={jobs}
              companion={companion}
              onTransitionJob={handleTransitionJob}
              onClearJobs={handleClearJobs}
            />
          )}
        />
        <Route
          path="/app/settings/profile"
          element={wrapUserProtected(
            <SettingsViewPage
              section="profile"
              currentUser={currentUser}
              role={role}
              onRoleBootstrapped={(nextRole) => {
                setRole(nextRole);
                setCurrentUser((prev) => (prev ? { ...prev, role: nextRole } : prev));
              }}
              preferences={preferences}
              onUpdatePreferences={handleUpdatePreferences}
              companion={companion}
              onToggleDiagnosticCompanion={toggleDiagnosticCompanion}
              repositoryModeLabel={workspaceRepository.modeLabel}
              onNotify={notify}
            />
          )}
        />
        <Route
          path="/app/settings/preferences"
          element={wrapUserProtected(
            <SettingsViewPage
              section="preferences"
              currentUser={currentUser}
              role={role}
              onRoleBootstrapped={(nextRole) => {
                setRole(nextRole);
                setCurrentUser((prev) => (prev ? { ...prev, role: nextRole } : prev));
              }}
              preferences={preferences}
              onUpdatePreferences={handleUpdatePreferences}
              companion={companion}
              onToggleDiagnosticCompanion={toggleDiagnosticCompanion}
              repositoryModeLabel={workspaceRepository.modeLabel}
              onNotify={notify}
            />
          )}
        />
        <Route
          path="/app/settings/devices"
          element={wrapUserProtected(
            <SettingsViewPage
              section="devices"
              currentUser={currentUser}
              role={role}
              onRoleBootstrapped={(nextRole) => {
                setRole(nextRole);
                setCurrentUser((prev) => (prev ? { ...prev, role: nextRole } : prev));
              }}
              preferences={preferences}
              onUpdatePreferences={handleUpdatePreferences}
              companion={companion}
              onToggleDiagnosticCompanion={toggleDiagnosticCompanion}
              repositoryModeLabel={workspaceRepository.modeLabel}
              onNotify={notify}
            />
          )}
        />
        <Route path="/app/help" element={wrapUserProtected(<HelpCenterPage />)} />
        <Route
          path="/app/reference-lab"
          element={wrapUserProtected(
            <ReferenceLabWorkspace
              userUid={currentUser?.uid}
              onProjectSaved={(proj) => {
                addProject(proj);
                notify(`Saved "${proj.title}" from Reference Lab to Project Library.`, 'success');
              }}
              onTemplateSaved={(tpl) => {
                notify(
                  `Saved reusable template "${tpl.name}" (${String(tpl.validationState || 'Draft').toUpperCase()}, license: ${tpl.licenseType}).`,
                  'success'
                );
              }}
            />
          )}
        />
        <Route
          path="/app/provider-hub"
          element={wrapUserProtected(
            <ProviderHubWorkspace
              userUid={currentUser?.uid}
              onNotify={notify}
            />
          )}
        />
        <Route
          path="/app/extensions"
          element={wrapUserProtected(
            <ProviderHubWorkspace
              userUid={currentUser?.uid}
              onNotify={notify}
            />
          )}
        />
        <Route
          path="/app/ai-director"
          element={wrapUserProtected(
            <AiDirectorWorkspace
              userUid={currentUser?.uid}
              onBackToReference={() => {
                window.location.href = '/app/text-animation';
              }}
              onOpenProjectLibrary={() => {
                window.location.href = '/app/project-library';
              }}
            />
          )}
        />
        <Route
          path="/app/editor"
          element={wrapUserProtected(
            <EditingStudioRouteWrapper
              projects={projects}
              ownerUid={currentUser?.uid || 'user-local'}
              onAddProject={addProject}
              onUpdateProject={updateProject}
              onNotify={notify}
            />
          )}
        />
        <Route
          path="/app/editor/:projectId"
          element={wrapUserProtected(
            <EditingStudioRouteWrapper
              projects={projects}
              ownerUid={currentUser?.uid || 'user-local'}
              onAddProject={addProject}
              onUpdateProject={updateProject}
              onNotify={notify}
            />
          )}
        />
        <Route
          path="/app/template-factory"
          element={wrapUserProtected(
            <TemplateFactoryWorkspace
              userUid={currentUser?.uid || 'user-local'}
              projects={projects}
              onSaveProjectToLibrary={addProject}
              onNotify={notify}
            />
          )}
        />
        <Route
          path="/app/render-export"
          element={wrapUserProtected(
            <RenderExportQaWorkspace
              userUid={currentUser?.uid || 'user-local'}
              projects={projects}
              onNotify={notify}
            />
          )}
        />

        {/* Dynamic route covering all 20 modules (/app/text-animation .. /app/project-library) */}
        <Route
          path="/app/:moduleId"
          element={wrapUserProtected(
            <WorkspaceModuleRoute
              favoriteIds={favoriteIds}
              onToggleFavorite={toggleFavorite}
              companion={companion}
              preferences={preferences}
              projects={projects}
              onAddProject={addProject}
              onUpdateProject={updateProject}
              onDeleteProject={deleteProject}
              onQueueJob={queueJob}
              onNotify={notify}
            />
          )}
        />

        {/* Separately Protected Admin Console Routes */}
        <Route
          path="/admin"
          element={wrapAdminProtected(
            <AdminConsoleWorkspace
              subroute="overview"
              currentUser={currentUser}
              role={role}
              onNotify={notify}
            />
          )}
        />
        <Route
          path="/admin/catalog/new"
          element={wrapAdminProtected(
            <AdminConsoleWorkspace
              subroute="catalog-new"
              currentUser={currentUser}
              role={role}
              onNotify={notify}
            />
          )}
        />
        <Route
          path="/admin/catalog/:itemId"
          element={wrapAdminProtected(
            <AdminCatalogEditWrapper
              currentUser={currentUser}
              role={role}
              onNotify={notify}
            />
          )}
        />
        <Route
          path="/admin/:subroute"
          element={wrapAdminProtected(
            <AdminSubrouteWrapper
              currentUser={currentUser}
              role={role}
              onNotify={notify}
            />
          )}
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

const AdminCatalogEditWrapper: React.FC<{
  currentUser: AuthenticatedUser | null;
  role: UserRole;
  onNotify: (message: string, tone?: 'info' | 'warning' | 'error' | 'success') => void;
}> = ({ currentUser, role, onNotify }) => {
  const { itemId } = useParams<{ itemId: string }>();
  return (
    <AdminConsoleWorkspace
      subroute="catalog-edit"
      catalogItemId={itemId}
      currentUser={currentUser}
      role={role}
      onNotify={onNotify}
    />
  );
};

const AdminSubrouteWrapper: React.FC<{
  currentUser: AuthenticatedUser | null;
  role: UserRole;
  onNotify: (message: string, tone?: 'info' | 'warning' | 'error' | 'success') => void;
}> = ({ currentUser, role, onNotify }) => {
  const { subroute } = useParams<{ subroute: string }>();
  return (
    <AdminConsoleWorkspace
      subroute={subroute || 'overview'}
      currentUser={currentUser}
      role={role}
      onNotify={onNotify}
    />
  );
};

const EditingStudioRouteWrapper: React.FC<{
  projects: ProjectLibraryItem[];
  ownerUid: string;
  onAddProject: (p: Omit<ProjectLibraryItem, 'id' | 'updatedAt'>) => Promise<void>;
  onUpdateProject: (id: string, patch: Partial<ProjectLibraryItem>) => Promise<void>;
  onNotify: (message: string, tone?: 'info' | 'warning' | 'error' | 'success') => void;
}> = ({ projects, ownerUid, onAddProject, onUpdateProject, onNotify }) => {
  const { projectId } = useParams<{ projectId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const targetLibraryProject = useMemo(() => {
    const queryParams = new URLSearchParams(location.search);
    const targetId = projectId || queryParams.get('projectId');
    if (targetId) {
      const found = projects.find((p) => p.id === targetId);
      if (found) return found;
    }
    return projects[0] || null;
  }, [projectId, location.search, projects]);

  return (
    <EditingStudioWorkspace
      mode="standalone-route"
      onClose={() => navigate('/app/text-animation')}
      sourceLibraryProject={targetLibraryProject}
      ownerUid={ownerUid}
      onSaveToProjectLibrary={async (record, existingId) => {
        if (existingId && projects.some((p) => p.id === existingId)) {
          await onUpdateProject(existingId, record);
        } else {
          await onAddProject(record);
        }
      }}
      onNotify={onNotify}
    />
  );
};

