import fs from 'node:fs';
import path from 'node:path';
import {
  AccountStatus,
  AssetMetadataRecord,
  AuditEventRecord,
  CatalogItem,
  DeviceRecord,
  JobRecord,
  MobileEditorAdapterDescriptor,
  ModuleDefinition,
  PlatformSettingsConfig,
  ProjectLibraryItem,
  TemplateVariantInstance,
  UserPreferences,
  UserRole,
} from '../types/sowveil';
import { ReferenceLabSession } from '../services/referenceLabEngine';
import {
  ExtensionPackageRecord,
  HubTaskType,
  ProviderConnectionRecord,
  TaskRoutingProfile,
  ToolExecutionAuditRecord,
} from '../services/providerHubEngine';
import { AiDirectorSessionRecord } from '../services/aiDirectorProductionEngine';
import {
  TemplateFactoryDraftRecord,
  TemplatePreferenceSignal,
  UserPreferenceConsentConfig,
} from '../services/templateFactoryEngine';
import { DurableRenderExportJobRecord } from '../services/renderExportQaEngine';

export interface DurableStoreSnapshot {
  schemaVersion: string | number;
  savedAt: string;
  catalogCacheVersion: number;
  ownerBootstrappedUid: string | null;
  platformSettings: PlatformSettingsConfig;
  roles: Record<string, UserRole>;
  userStatuses: Record<string, AccountStatus>;
  userPreferences: Record<string, UserPreferences>;
  userFavorites: Record<string, string[]>;
  userRecentItems: Record<string, string[]>;
  catalogItems: CatalogItem[];
  templateVariants: TemplateVariantInstance[];
  assets: AssetMetadataRecord[];
  projects: ProjectLibraryItem[];
  jobs: JobRecord[];
  devices: DeviceRecord[];
  modules: ModuleDefinition[];
  editorAdapters: MobileEditorAdapterDescriptor[];
  auditEvents: AuditEventRecord[];
  referenceLabSessions?: ReferenceLabSession[];
  providerConnections?: ProviderConnectionRecord[];
  routingProfiles?: Record<string, Record<HubTaskType, TaskRoutingProfile>>;
  extensionPackages?: ExtensionPackageRecord[];
  toolAuditRecords?: ToolExecutionAuditRecord[];
  aiDirectorSessions?: AiDirectorSessionRecord[];
  templateFactoryDrafts?: TemplateFactoryDraftRecord[];
  templatePreferenceSignals?: TemplatePreferenceSignal[];
  userPreferenceConsents?: Record<string, UserPreferenceConsentConfig>;
  renderExportJobs?: DurableRenderExportJobRecord[];
}

export function loadDurableSnapshot(
  filePath?: string | null
): DurableStoreSnapshot | null {
  if (!filePath) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as DurableStoreSnapshot;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed.schemaVersion !== 1 && parsed.schemaVersion !== '1.0.0')
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveDurableSnapshot(
  filePath: string | null | undefined,
  snapshot: DurableStoreSnapshot
): void {
  if (!filePath) return;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[DurableStore] Failed to persist state snapshot:', err);
  }
}
