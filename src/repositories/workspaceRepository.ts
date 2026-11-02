import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  AssetMetadataRecord,
  CatalogItem,
  DeviceRecord,
  JobRecord,
  JobStatus,
  ProjectLibraryItem,
  TemplateLicenseType,
  TemplateVariantInstance,
  UserPreferences,
} from '../types/sowveil';
import { CanonicalProjectDocument } from '../types/canonicalProject';
import { SEED_CATALOG_ITEMS, SEED_PROJECT_LIBRARY } from '../data/catalogSeeds';
import { enrichCatalogItemWithMarketplaceDefaults } from '../services/marketplaceEngine';
import { transitionJobRecord } from '../services/jobStateMachine';
import {
  auth,
  db,
  DEFAULT_USER_PREFERENCES,
  handleFirestoreError,
  OperationType,
} from '../services/firebaseClient';
import { executeAuthenticatedApiRequest, ApiRequestOptions } from '../services/apiClient';
import {
  deserializeProjectFromFirestoreDto,
  ProjectFirestoreDto,
  serializeProjectToFirestoreDto,
} from '../services/persistenceContracts';

export interface IWorkspaceRepository {
  readonly modeLabel: string;
  getFavorites(): Promise<string[]>;
  addFavorite(itemId: string): Promise<string[]>;
  removeFavorite(itemId: string): Promise<string[]>;
  listProjects(): Promise<ProjectLibraryItem[]>;
  createProject(
    input: Omit<ProjectLibraryItem, 'id' | 'updatedAt'> & {
      id?: string;
      createdAt?: string;
    }
  ): Promise<ProjectLibraryItem>;
  updateProject(
    id: string,
    patch: Partial<
      Pick<
        ProjectLibraryItem,
        | 'title'
        | 'description'
        | 'compCount'
        | 'projectFileStatus'
        | 'fileSizeBytes'
        | 'fileSizeLabel'
        | 'resolution'
        | 'durationLabel'
        | 'fps'
        | 'aeVersion'
        | 'targetEditor'
        | 'aspectRatio'
        | 'sowveilSpecJson'
        | 'canonicalProjectJson'
        | 'revision'
        | 'activeBranch'
        | 'checkpoints'
        | 'hasExternalFootageWarning'
        | 'archived'
        | 'lastOpenedAt'
        | 'tags'
      >
    > & { expectedRevision?: number }
  ): Promise<ProjectLibraryItem>;
  upsertProjectRecord?(project: ProjectLibraryItem): Promise<ProjectLibraryItem>;
  getCanonicalProjectById?(
    id: string
  ): Promise<{ project: CanonicalProjectDocument; canUndo?: boolean; canRedo?: boolean } | null>;
  deleteProject(id: string): Promise<void>;
  listJobs(): Promise<JobRecord[]>;
  createJob(
    input: Omit<
      JobRecord,
      'id' | 'createdAt' | 'updatedAt' | 'requestId' | 'attemptCount' | 'idempotencyKey'
    > & { idempotencyKey?: string }
  ): Promise<JobRecord>;
  transitionJob(
    id: string,
    nextStatus: JobStatus,
    options?: { redactedMessage?: string; errorCode?: string; deviceId?: string | null }
  ): Promise<JobRecord>;
  clearJobs(): Promise<void>;
  getPreferences(): Promise<UserPreferences>;
  savePreferences(prefs: Partial<UserPreferences>): Promise<UserPreferences>;
  listDevices?(): Promise<DeviceRecord[]>;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

function sanitizeFirestoreId(raw: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
  if (!cleaned || !VALID_ID_REGEX.test(cleaned)) {
    throw new Error('Invalid resource identifier format');
  }
  return cleaned;
}

/**
 * Production Cloud Firestore Repository.
 * Never falls back to localStorage for private user data.
 * Prefers server-mediated API operations (/api/v1/*) for canonical project and user records,
 * and uses identical collection paths, stable document IDs, and DTO schemas when accessing Firestore directly.
 */
export class FirestoreWorkspaceRepository implements IWorkspaceRepository {
  public readonly modeLabel =
    'Cloud Firestore (sacred-tune-blxdt · Authoritative Server & Rules Enforced)';

  private apiTransportOverride: {
    baseUrl?: string;
    getAuthToken?: ApiRequestOptions['getAuthToken'];
    fetchImpl?: ApiRequestOptions['fetchImpl'];
  } | null = null;

  public configureServerApiTransport(
    config: {
      baseUrl?: string;
      getAuthToken?: ApiRequestOptions['getAuthToken'];
      fetchImpl?: ApiRequestOptions['fetchImpl'];
    } | null
  ): void {
    this.apiTransportOverride = config;
  }

  private shouldUseServerApi(): boolean {
    if (this.apiTransportOverride) return true;
    return typeof window !== 'undefined' && typeof globalThis.fetch === 'function';
  }

  private async callServerApi<T>(
    path: string,
    options: Omit<ApiRequestOptions, 'getAuthToken' | 'fetchImpl'> = {}
  ): Promise<ReturnType<typeof executeAuthenticatedApiRequest<T>>> {
    const fullPath = this.apiTransportOverride?.baseUrl
      ? `${this.apiTransportOverride.baseUrl.replace(/\/$/, '')}${path}`
      : path;
    return executeAuthenticatedApiRequest<T>(fullPath, {
      ...options,
      ...(this.apiTransportOverride?.getAuthToken
        ? { getAuthToken: this.apiTransportOverride.getAuthToken }
        : {}),
      ...(this.apiTransportOverride?.fetchImpl
        ? { fetchImpl: this.apiTransportOverride.fetchImpl }
        : {}),
    });
  }

  private requireUid(): string {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      throw new Error('UNAUTHENTICATED: Sign in with Google to access private cloud records.');
    }
    return uid;
  }

  public async getFavorites(): Promise<string[]> {
    if (this.shouldUseServerApi()) {
      const apiRes = await this.callServerApi<{ items: string[] }>('/api/v1/me/favorites', {
        method: 'GET',
      });
      if (apiRes.ok && apiRes.data && Array.isArray(apiRes.data.items)) {
        return apiRes.data.items;
      }
      if (this.apiTransportOverride && !apiRes.ok && apiRes.status !== 0) {
        if (apiRes.status === 401) return [];
        throw new Error(`${apiRes.errorCode || 'API_ERROR'}: ${apiRes.errorMessage}`);
      }
    }

    const uid = auth.currentUser?.uid;
    if (!uid) return [];
    const favPath = `favorites/${uid}/items`;
    try {
      const q = query(
        collection(db, 'favorites', uid, 'items'),
        where('ownerUid', '==', uid)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => String(d.data().itemId || d.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, favPath);
    }
  }

  public async addFavorite(itemId: string): Promise<string[]> {
    const safeId = sanitizeFirestoreId(itemId);
    if (this.shouldUseServerApi()) {
      const apiRes = await this.callServerApi<{ items: string[] }>(
        `/api/v1/me/favorites/${encodeURIComponent(safeId)}`,
        { method: 'PUT' }
      );
      if (apiRes.ok && apiRes.data && Array.isArray(apiRes.data.items)) {
        return apiRes.data.items;
      }
      if (this.apiTransportOverride && !apiRes.ok && apiRes.status !== 0) {
        throw new Error(`${apiRes.errorCode || 'API_ERROR'}: ${apiRes.errorMessage}`);
      }
    }

    const uid = this.requireUid();
    const favDocPath = `favorites/${uid}/items/${safeId}`;
    const now = new Date().toISOString();

    try {
      const existingSnap = await getDoc(doc(db, 'favorites', uid, 'items', safeId));
      if (!existingSnap.exists()) {
        await setDoc(doc(db, 'favorites', uid, 'items', safeId), {
          itemId: safeId,
          ownerUid: uid,
          createdAt: now,
        });
      }
      return await this.getFavorites();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, favDocPath);
    }
  }

  public async removeFavorite(itemId: string): Promise<string[]> {
    const safeId = sanitizeFirestoreId(itemId);
    if (this.shouldUseServerApi()) {
      const apiRes = await this.callServerApi<{ items: string[] }>(
        `/api/v1/me/favorites/${encodeURIComponent(safeId)}`,
        { method: 'DELETE' }
      );
      if (apiRes.ok && apiRes.data && Array.isArray(apiRes.data.items)) {
        return apiRes.data.items;
      }
      if (this.apiTransportOverride && !apiRes.ok && apiRes.status !== 0) {
        throw new Error(`${apiRes.errorCode || 'API_ERROR'}: ${apiRes.errorMessage}`);
      }
    }

    const uid = this.requireUid();
    const favDocPath = `favorites/${uid}/items/${safeId}`;

    try {
      const existingSnap = await getDoc(doc(db, 'favorites', uid, 'items', safeId));
      if (existingSnap.exists()) {
        await deleteDoc(doc(db, 'favorites', uid, 'items', safeId));
      }
      return await this.getFavorites();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, favDocPath);
    }
  }

  public async listProjects(): Promise<ProjectLibraryItem[]> {
    if (this.shouldUseServerApi()) {
      const apiRes = await this.callServerApi<{ items: ProjectLibraryItem[] }>(
        '/api/v1/projects?limit=100&offset=0',
        { method: 'GET' }
      );
      if (apiRes.ok && apiRes.data && Array.isArray(apiRes.data.items)) {
        return apiRes.data.items;
      }
      if (this.apiTransportOverride && !apiRes.ok && apiRes.status !== 0) {
        if (apiRes.status === 401) return [];
        throw new Error(`${apiRes.errorCode || 'API_ERROR'}: ${apiRes.errorMessage}`);
      }
    }

    const uid = auth.currentUser?.uid;
    if (!uid) return [];
    const path = 'projects';
    try {
      const q = query(collection(db, 'projects'), where('ownerUid', '==', uid));
      const snap = await getDocs(q);
      const list = snap.docs.map(
        (d) => deserializeProjectFromFirestoreDto(d.data() as ProjectFirestoreDto).project
      );
      return list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  }

  public async seedStarterProjectsForUserIfEmpty(): Promise<ProjectLibraryItem[]> {
    const uid = auth.currentUser?.uid;
    if (!uid && !this.apiTransportOverride) return [];
    const current = await this.listProjects();
    if (current.length > 0) return current;

    const effectiveUid = uid || 'user-seeded';
    const now = new Date().toISOString();
    const created: ProjectLibraryItem[] = [];
    for (const seed of SEED_PROJECT_LIBRARY.slice(0, 4)) {
      const projId = sanitizeFirestoreId(`${effectiveUid.slice(0, 8)}_${seed.id}`);
      const payload: ProjectLibraryItem = {
        id: projId,
        ownerUid: effectiveUid,
        title: seed.title.slice(0, 160),
        description: seed.description.slice(0, 2000),
        compCount: seed.compCount,
        projectFileStatus: seed.projectFileStatus,
        fileSizeBytes: seed.fileSizeBytes,
        fileSizeLabel: seed.fileSizeLabel.slice(0, 80),
        ...(seed.resolution ? { resolution: seed.resolution } : {}),
        ...(seed.durationLabel ? { durationLabel: seed.durationLabel } : {}),
        ...(seed.fps !== undefined ? { fps: seed.fps } : {}),
        ...(seed.aeVersion ? { aeVersion: seed.aeVersion } : {}),
        hasExternalFootageWarning: Boolean(seed.hasExternalFootageWarning),
        archived: Boolean(seed.archived),
        tags: (seed.tags || []).slice(0, 20).map((t) => String(t).slice(0, 64)),
        createdAt: now,
        updatedAt: now,
      };
      try {
        const saved = await this.createProject(payload);
        created.push(saved);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `projects/${projId}`);
      }
    }
    return created;
  }

  public async createProject(
    input: Omit<ProjectLibraryItem, 'id' | 'updatedAt'> & {
      id?: string;
      createdAt?: string;
    }
  ): Promise<ProjectLibraryItem> {
    if (
      input.description?.includes('blob:') ||
      input.title?.includes('blob:')
    ) {
      throw new Error(
        'STORAGE_NOT_CONFIGURED: Local blob URLs cannot be saved as persistent cloud URLs.'
      );
    }

    let candidateId = input.id;
    let syncedCanonicalJson = input.canonicalProjectJson;
    const initialRevision =
      typeof input.revision === 'number' && input.revision >= 1 ? Math.floor(input.revision) : 1;

    if (syncedCanonicalJson) {
      try {
        const parsed = JSON.parse(syncedCanonicalJson) as Record<string, unknown>;
        if (!candidateId && typeof parsed.id === 'string' && VALID_ID_REGEX.test(parsed.id)) {
          candidateId = parsed.id;
        }
      } catch {
        // Ignore parse error; fallback to generated ID
      }
    }

    const projId = sanitizeFirestoreId(
      candidateId || `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    );

    if (this.shouldUseServerApi()) {
      const apiRes = await this.callServerApi<ProjectLibraryItem>('/api/v1/projects', {
        method: 'POST',
        body: {
          ...input,
          id: projId,
          revision: initialRevision,
          ...(syncedCanonicalJson ? { canonicalProjectJson: syncedCanonicalJson } : {}),
        },
      });
      if (apiRes.ok && apiRes.data) {
        return apiRes.data;
      }
      if (apiRes.status !== 0) {
        throw new Error(`${apiRes.errorCode || 'API_ERROR'}: ${apiRes.errorMessage}`);
      }
    }

    const uid = this.requireUid();
    const now = new Date().toISOString();

    if (syncedCanonicalJson) {
      try {
        const parsed = JSON.parse(syncedCanonicalJson) as Record<string, unknown>;
        parsed.id = projId;
        parsed.ownerUid = uid;
        parsed.title = input.title.trim().slice(0, 160);
        parsed.revision = initialRevision;
        parsed.updatedAt = now;
        syncedCanonicalJson = JSON.stringify(parsed);
      } catch {
        // Keep raw string if unparseable
      }
    }

    const record: ProjectLibraryItem = {
      id: projId,
      ownerUid: uid,
      title: input.title.trim().slice(0, 160),
      description: (input.description || '').trim().slice(0, 2000),
      compCount: input.compCount ?? null,
      projectFileStatus: input.projectFileStatus || 'metadata-only',
      fileSizeBytes: input.fileSizeBytes ?? null,
      fileSizeLabel: (input.fileSizeLabel || 'Unknown (metadata-only)').slice(0, 80),
      ...(input.resolution ? { resolution: input.resolution.slice(0, 64) } : {}),
      ...(input.durationLabel ? { durationLabel: input.durationLabel.slice(0, 64) } : {}),
      ...(input.fps !== undefined ? { fps: input.fps } : {}),
      ...(input.aeVersion ? { aeVersion: input.aeVersion.slice(0, 64) } : {}),
      ...(input.targetEditor ? { targetEditor: input.targetEditor } : {}),
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
      ...(input.sowveilSpecJson ? { sowveilSpecJson: input.sowveilSpecJson.slice(0, 15000) } : {}),
      ...(syncedCanonicalJson
        ? { canonicalProjectJson: syncedCanonicalJson.slice(0, 200000) }
        : {}),
      revision: initialRevision,
      ...(input.activeBranch ? { activeBranch: input.activeBranch.slice(0, 64) } : {}),
      ...(input.checkpoints ? { checkpoints: input.checkpoints.slice(0, 20) } : {}),
      hasExternalFootageWarning: Boolean(input.hasExternalFootageWarning),
      archived: Boolean(input.archived),
      tags: (input.tags || []).slice(0, 20).map((t) => String(t).slice(0, 64)),
      createdAt: input.createdAt || now,
      updatedAt: now,
    };

    try {
      const dto = serializeProjectToFirestoreDto(record);
      await setDoc(doc(db, 'projects', projId), dto);
      return deserializeProjectFromFirestoreDto(dto).project;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `projects/${projId}`);
    }
  }

  public async updateProject(
    id: string,
    patch: Partial<ProjectLibraryItem> & { expectedRevision?: number }
  ): Promise<ProjectLibraryItem> {
    const safeId = sanitizeFirestoreId(id);

    if (this.shouldUseServerApi()) {
      const apiRes = await this.callServerApi<ProjectLibraryItem>(
        `/api/v1/projects/${encodeURIComponent(safeId)}`,
        {
          method: 'PATCH',
          body: patch,
        }
      );
      if (apiRes.ok && apiRes.data) {
        return apiRes.data;
      }
      if (apiRes.status === 409 || apiRes.errorCode === 'REVISION_CONFLICT') {
        throw new Error(`REVISION_CONFLICT: ${apiRes.errorMessage || 'Stale project revision'}`);
      }
      if (apiRes.status !== 0) {
        throw new Error(`${apiRes.errorCode || 'API_ERROR'}: ${apiRes.errorMessage}`);
      }
    }

    const uid = this.requireUid();
    const docRef = doc(db, 'projects', safeId);
    const now = new Date().toISOString();

    try {
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        throw new Error(`Project "${safeId}" not found`);
      }
      const existing = deserializeProjectFromFirestoreDto(
        snap.data() as ProjectFirestoreDto
      ).project;
      const existingRev = existing.revision || 1;
      if (
        patch.expectedRevision !== undefined &&
        existingRev !== patch.expectedRevision
      ) {
        throw new Error(
          `REVISION_CONFLICT: Stale project revision on "${safeId}": expected revision ${patch.expectedRevision}, actual revision ${existingRev}.`
        );
      }

      const nextRevision =
        typeof patch.revision === 'number' && patch.revision > existingRev
          ? Math.floor(patch.revision)
          : existingRev + 1;

      const merged: ProjectLibraryItem = {
        ...existing,
        ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 160) } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description.trim().slice(0, 2000) }
          : {}),
        ...(patch.compCount !== undefined ? { compCount: patch.compCount } : {}),
        ...(patch.projectFileStatus !== undefined
          ? { projectFileStatus: patch.projectFileStatus }
          : {}),
        ...(patch.fileSizeBytes !== undefined ? { fileSizeBytes: patch.fileSizeBytes } : {}),
        ...(patch.fileSizeLabel !== undefined
          ? { fileSizeLabel: patch.fileSizeLabel.slice(0, 80) }
          : {}),
        ...(patch.resolution !== undefined ? { resolution: patch.resolution } : {}),
        ...(patch.durationLabel !== undefined ? { durationLabel: patch.durationLabel } : {}),
        ...(patch.fps !== undefined ? { fps: patch.fps } : {}),
        ...(patch.aeVersion !== undefined ? { aeVersion: patch.aeVersion } : {}),
        ...(patch.targetEditor !== undefined ? { targetEditor: patch.targetEditor } : {}),
        ...(patch.aspectRatio !== undefined ? { aspectRatio: patch.aspectRatio } : {}),
        ...(patch.sowveilSpecJson !== undefined
          ? { sowveilSpecJson: patch.sowveilSpecJson.slice(0, 15000) }
          : {}),
        ...(patch.activeBranch !== undefined
          ? { activeBranch: patch.activeBranch.slice(0, 64) }
          : {}),
        ...(patch.checkpoints !== undefined
          ? { checkpoints: patch.checkpoints.slice(0, 20) }
          : {}),
        ...(patch.hasExternalFootageWarning !== undefined
          ? { hasExternalFootageWarning: Boolean(patch.hasExternalFootageWarning) }
          : {}),
        ...(patch.archived !== undefined ? { archived: Boolean(patch.archived) } : {}),
        ...(patch.lastOpenedAt !== undefined ? { lastOpenedAt: patch.lastOpenedAt } : {}),
        ...(patch.tags !== undefined
          ? { tags: patch.tags.slice(0, 20).map((t) => String(t).slice(0, 64)) }
          : {}),
        ownerUid: existing.ownerUid || uid,
        revision: nextRevision,
        updatedAt: now,
      };

      if (patch.canonicalProjectJson !== undefined) {
        let syncedJson = patch.canonicalProjectJson;
        try {
          const parsed = JSON.parse(syncedJson) as Record<string, unknown>;
          parsed.id = safeId;
          parsed.ownerUid = merged.ownerUid;
          parsed.title = merged.title;
          parsed.revision = nextRevision;
          parsed.updatedAt = now;
          syncedJson = JSON.stringify(parsed);
        } catch {
          // Keep raw string if unparseable
        }
        merged.canonicalProjectJson = syncedJson.slice(0, 200000);
      }

      const dto = serializeProjectToFirestoreDto(merged);
      await setDoc(docRef, dto);
      return deserializeProjectFromFirestoreDto(dto).project;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('REVISION_CONFLICT:')) {
        throw err;
      }
      handleFirestoreError(err, OperationType.UPDATE, `projects/${safeId}`);
    }
  }

  public async upsertProjectRecord(project: ProjectLibraryItem): Promise<ProjectLibraryItem> {
    const safeId = sanitizeFirestoreId(project.id);
    if (this.shouldUseServerApi()) {
      const apiRes = await this.callServerApi<ProjectLibraryItem>('/api/v1/projects', {
        method: 'POST',
        body: {
          ...project,
          id: safeId,
        },
      });
      if (apiRes.ok && apiRes.data) {
        return apiRes.data;
      }
    }

    const uid = auth.currentUser?.uid;
    if (!uid) return project;
    const record: ProjectLibraryItem = {
      ...project,
      id: safeId,
      ownerUid: project.ownerUid || uid,
    };
    try {
      const dto = serializeProjectToFirestoreDto(record);
      await setDoc(doc(db, 'projects', safeId), dto);
      return deserializeProjectFromFirestoreDto(dto).project;
    } catch {
      return record;
    }
  }

  public async deleteProject(id: string): Promise<void> {
    const safeId = sanitizeFirestoreId(id);
    if (this.shouldUseServerApi()) {
      const apiRes = await this.callServerApi<{ deletedId: string }>(
        `/api/v1/projects/${encodeURIComponent(safeId)}`,
        { method: 'DELETE' }
      );
      if (apiRes.ok) {
        return;
      }
      if (apiRes.status !== 0) {
        throw new Error(`${apiRes.errorCode || 'API_ERROR'}: ${apiRes.errorMessage}`);
      }
    }

    this.requireUid();
    try {
      await deleteDoc(doc(db, 'projects', safeId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `projects/${safeId}`);
    }
  }

  public async getCanonicalProjectById(id: string): Promise<{
    project: CanonicalProjectDocument;
    canUndo?: boolean;
    canRedo?: boolean;
  } | null> {
    const safeId = sanitizeFirestoreId(id);
    if (this.shouldUseServerApi()) {
      const apiRes = await this.callServerApi<{
        project: CanonicalProjectDocument;
        canUndo?: boolean;
        canRedo?: boolean;
      }>(`/api/v1/projects/${encodeURIComponent(safeId)}/canonical`, {
        method: 'GET',
      });
      if (apiRes.ok && apiRes.data && apiRes.data.project) {
        return apiRes.data;
      }
      if (apiRes.status === 403 || apiRes.errorCode === 'CROSS_USER_ACCESS_FORBIDDEN') {
        throw new Error(`403 CROSS_USER_ACCESS_FORBIDDEN: ${apiRes.errorMessage}`);
      }
      if (apiRes.status === 404 || apiRes.errorCode === 'NOT_FOUND') {
        return null;
      }
    }
    return null;
  }

  public async listJobs(): Promise<JobRecord[]> {
    const uid = auth.currentUser?.uid;
    if (!uid) return [];
    try {
      const q = query(collection(db, 'jobs'), where('ownerUid', '==', uid));
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => d.data() as JobRecord);
      return list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'jobs');
    }
  }

  public async createJob(
    input: Omit<
      JobRecord,
      'id' | 'createdAt' | 'updatedAt' | 'requestId' | 'attemptCount' | 'idempotencyKey'
    > & { idempotencyKey?: string }
  ): Promise<JobRecord> {
    const uid = this.requireUid();
    const current = await this.listJobs();
    const idemKey = (
      input.idempotencyKey ||
      `${input.type}:${input.moduleId}:${input.operation || 'none'}:${input.title}`
    ).slice(0, 200);

    const existingActive = current.find(
      (j) =>
        j.idempotencyKey === idemKey &&
        (j.status === 'queued' ||
          j.status === 'uploading' ||
          j.status === 'claimed' ||
          j.status === 'running' ||
          j.status === 'finalizing')
    );
    if (existingActive) {
      return existingActive;
    }

    const now = new Date().toISOString();
    const jobId = sanitizeFirestoreId(
      `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    );
    const allowedInitialStatuses: JobStatus[] = [
      'draft',
      'queued',
      'uploading',
      'running',
      'finalizing',
      'ready',
      'needs-setup',
      'quota-reached',
    ];
    const initialStatus: JobStatus = allowedInitialStatuses.includes(input.status)
      ? input.status
      : 'queued';

    const record: JobRecord = {
      id: jobId,
      ownerUid: uid,
      type: input.type,
      title: input.title.trim().slice(0, 200),
      moduleId: input.moduleId,
      ...(input.itemId ? { itemId: input.itemId } : {}),
      ...(input.operation ? { operation: input.operation } : {}),
      ...(input.targetEditor ? { targetEditor: input.targetEditor } : {}),
      ...(input.exportFormat ? { exportFormat: input.exportFormat } : {}),
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
      ...(input.outputFileName ? { outputFileName: input.outputFileName } : {}),
      ...(input.outputMimeType ? { outputMimeType: input.outputMimeType } : {}),
      ...(input.outputSizeBytes !== undefined ? { outputSizeBytes: input.outputSizeBytes } : {}),
      ...(input.processedBytes !== undefined ? { processedBytes: input.processedBytes } : {}),
      ...(input.totalBytes !== undefined ? { totalBytes: input.totalBytes } : {}),
      ...(input.completedStageIndex !== undefined
        ? { completedStageIndex: input.completedStageIndex }
        : {}),
      ...(input.totalStages !== undefined ? { totalStages: input.totalStages } : {}),
      ...(input.stageLabel ? { stageLabel: input.stageLabel } : {}),
      status: initialStatus,
      createdAt: now,
      updatedAt: now,
      attemptCount: 1,
      idempotencyKey: idemKey,
      deviceId: input.deviceId ?? null,
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      redactedMessage: (input.redactedMessage || '').slice(0, 1000),
      requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
    };

    try {
      await setDoc(doc(db, 'jobs', jobId), record);
      return record;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `jobs/${jobId}`);
    }
  }

  public async transitionJob(
    id: string,
    nextStatus: JobStatus,
    options?: { redactedMessage?: string; errorCode?: string; deviceId?: string | null }
  ): Promise<JobRecord> {
    this.requireUid();
    const safeId = sanitizeFirestoreId(id);
    const docRef = doc(db, 'jobs', safeId);

    try {
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        throw new Error(`Job "${safeId}" not found`);
      }
      const existing = snap.data() as JobRecord;
      const updated = transitionJobRecord(existing, nextStatus, options);
      const updatePayload: Record<string, unknown> = {
        status: updated.status,
        updatedAt: updated.updatedAt,
        attemptCount: updated.attemptCount,
        redactedMessage: updated.redactedMessage.slice(0, 1000),
      };
      if (updated.startedAt) updatePayload.startedAt = updated.startedAt;
      if (updated.finishedAt) updatePayload.finishedAt = updated.finishedAt;
      if (updated.deviceId !== undefined) updatePayload.deviceId = updated.deviceId;
      if (updated.errorCode !== undefined) updatePayload.errorCode = updated.errorCode;

      await updateDoc(docRef, updatePayload);
      return updated;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('INVALID_JOB_TRANSITION')) {
        throw err;
      }
      handleFirestoreError(err, OperationType.UPDATE, `jobs/${safeId}`);
    }
  }

  public async clearJobs(): Promise<void> {
    const jobs = await this.listJobs();
    for (const j of jobs) {
      try {
        await deleteDoc(doc(db, 'jobs', j.id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `jobs/${j.id}`);
      }
    }
  }

  public async getPreferences(): Promise<UserPreferences> {
    if (this.shouldUseServerApi()) {
      const apiRes = await this.callServerApi<UserPreferences>('/api/v1/me/preferences', {
        method: 'GET',
      });
      if (apiRes.ok && apiRes.data) {
        return {
          ...DEFAULT_USER_PREFERENCES,
          ...apiRes.data,
        };
      }
      if (this.apiTransportOverride && !apiRes.ok && apiRes.status !== 0) {
        if (apiRes.status === 401) return DEFAULT_USER_PREFERENCES;
        throw new Error(`${apiRes.errorCode || 'API_ERROR'}: ${apiRes.errorMessage}`);
      }
    }

    const uid = auth.currentUser?.uid;
    if (!uid) return DEFAULT_USER_PREFERENCES;
    try {
      const prefSnap = await getDoc(doc(db, 'userPreferences', uid));
      if (prefSnap.exists()) {
        const data = prefSnap.data();
        return {
          ...DEFAULT_USER_PREFERENCES,
          reducedMotion:
            typeof data.reducedMotion === 'boolean'
              ? data.reducedMotion
              : DEFAULT_USER_PREFERENCES.reducedMotion,
          defaultSortOrder:
            data.defaultSortOrder === 'name' ||
            data.defaultSortOrder === 'newest' ||
            data.defaultSortOrder === 'favorites'
              ? data.defaultSortOrder
              : DEFAULT_USER_PREFERENCES.defaultSortOrder,
          preserveSearchOnModuleSwitch:
            typeof data.preserveSearchOnModuleSwitch === 'boolean'
              ? data.preserveSearchOnModuleSwitch
              : DEFAULT_USER_PREFERENCES.preserveSearchOnModuleSwitch,
        };
      }
      const userSnap = await getDoc(doc(db, 'users', uid));
      if (!userSnap.exists()) return DEFAULT_USER_PREFERENCES;
      const prefs = userSnap.data().preferences || {};
      return {
        ...DEFAULT_USER_PREFERENCES,
        ...prefs,
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `userPreferences/${uid}`);
    }
  }

  public async savePreferences(
    patch: Partial<UserPreferences>
  ): Promise<UserPreferences> {
    if (this.shouldUseServerApi()) {
      const apiRes = await this.callServerApi<UserPreferences>('/api/v1/me/preferences', {
        method: 'PATCH',
        body: patch,
      });
      if (apiRes.ok && apiRes.data) {
        return {
          ...DEFAULT_USER_PREFERENCES,
          ...apiRes.data,
        };
      }
      if (this.apiTransportOverride && !apiRes.ok && apiRes.status !== 0) {
        throw new Error(`${apiRes.errorCode || 'API_ERROR'}: ${apiRes.errorMessage}`);
      }
    }

    const uid = this.requireUid();
    const current = await this.getPreferences();
    const next: UserPreferences = { ...current, ...patch };
    const now = new Date().toISOString();

    try {
      await setDoc(doc(db, 'userPreferences', uid), {
        ownerUid: uid,
        reducedMotion: Boolean(next.reducedMotion),
        defaultSortOrder: next.defaultSortOrder,
        preserveSearchOnModuleSwitch: Boolean(next.preserveSearchOnModuleSwitch),
        updatedAt: now,
      });
      return next;
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `userPreferences/${uid}`);
    }
  }

  public async listDevices(): Promise<DeviceRecord[]> {
    const uid = auth.currentUser?.uid;
    if (!uid) return [];
    try {
      const q = query(collection(db, 'devices'), where('ownerUid', '==', uid));
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as DeviceRecord);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'devices');
    }
  }
}

/**
 * Deterministic in-memory repository used strictly by automated Node unit tests
 * (`src/tests/phase2.test.ts` and `src/tests/phase3.security.test.ts`).
 * Never touches browser localStorage.
 */
export class InMemoryTestWorkspaceRepository implements IWorkspaceRepository {
  public readonly modeLabel = 'In-Memory Test Repository (Automated Test Suite Only)';
  private favorites: string[] = ['ta-rise-up', 'exp-sine-wave', 'car-builder-main'];
  private projects: ProjectLibraryItem[] = [...SEED_PROJECT_LIBRARY];
  private jobs: JobRecord[] = [];
  private preferences: UserPreferences = { ...DEFAULT_USER_PREFERENCES };
  private shouldSimulateWriteFailure = false;

  public setSimulateWriteFailure(fail: boolean): void {
    this.shouldSimulateWriteFailure = fail;
  }

  private assertWritable(): void {
    if (this.shouldSimulateWriteFailure) {
      throw new Error('REPOSITORY_WRITE_FAILED: Simulated storage write failure');
    }
  }

  public async getFavorites(): Promise<string[]> {
    return Array.from(new Set(this.favorites));
  }

  public async addFavorite(itemId: string): Promise<string[]> {
    const trimmed = itemId.trim();
    if (!trimmed) throw new Error('Invalid itemId for favorite');
    this.assertWritable();
    if (!this.favorites.includes(trimmed)) {
      this.favorites = [...this.favorites, trimmed];
    }
    return this.getFavorites();
  }

  public async removeFavorite(itemId: string): Promise<string[]> {
    const trimmed = itemId.trim();
    this.assertWritable();
    this.favorites = this.favorites.filter((id) => id !== trimmed);
    return this.getFavorites();
  }

  public async listProjects(): Promise<ProjectLibraryItem[]> {
    return [...this.projects];
  }

  public async createProject(
    input: Omit<ProjectLibraryItem, 'id' | 'updatedAt'> & {
      id?: string;
      createdAt?: string;
    }
  ): Promise<ProjectLibraryItem> {
    this.assertWritable();
    const now = new Date().toISOString();
    let candidateId = input.id;
    let syncedCanonicalJson = input.canonicalProjectJson;
    const initialRevision =
      typeof input.revision === 'number' && input.revision >= 1 ? Math.floor(input.revision) : 1;

    if (syncedCanonicalJson) {
      try {
        const parsed = JSON.parse(syncedCanonicalJson) as Record<string, unknown>;
        if (!candidateId && typeof parsed.id === 'string' && VALID_ID_REGEX.test(parsed.id)) {
          candidateId = parsed.id;
        }
      } catch {
        // Ignore parse error
      }
    }

    const projId = sanitizeFirestoreId(
      candidateId || `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    );

    if (syncedCanonicalJson) {
      try {
        const parsed = JSON.parse(syncedCanonicalJson) as Record<string, unknown>;
        parsed.id = projId;
        parsed.ownerUid = input.ownerUid || 'user-local';
        parsed.title = input.title;
        parsed.revision = initialRevision;
        parsed.updatedAt = now;
        syncedCanonicalJson = JSON.stringify(parsed);
      } catch {
        // Keep raw string
      }
    }

    const existingIdx = this.projects.findIndex((p) => p.id === projId);
    if (existingIdx !== -1) {
      return this.updateProject(projId, {
        ...input,
        canonicalProjectJson: syncedCanonicalJson,
      });
    }

    const record: ProjectLibraryItem = {
      ...input,
      id: projId,
      canonicalProjectJson: syncedCanonicalJson,
      revision: initialRevision,
      createdAt: input.createdAt || now,
      updatedAt: now.slice(0, 10),
    };
    this.projects = [record, ...this.projects];
    return record;
  }

  public async updateProject(
    id: string,
    patch: Partial<ProjectLibraryItem> & { expectedRevision?: number }
  ): Promise<ProjectLibraryItem> {
    this.assertWritable();
    const idx = this.projects.findIndex((p) => p.id === id);
    if (idx === -1) {
      throw new Error(`Project record "${id}" not found`);
    }
    const existing = this.projects[idx];
    const existingRev = existing.revision || 1;
    if (
      patch.expectedRevision !== undefined &&
      existingRev !== patch.expectedRevision
    ) {
      throw new Error(
        `REVISION_CONFLICT: Stale project revision on "${id}": expected revision ${patch.expectedRevision}, actual revision ${existingRev}.`
      );
    }

    const nextRevision =
      typeof patch.revision === 'number' && patch.revision > existingRev
        ? Math.floor(patch.revision)
        : existingRev + 1;

    const { expectedRevision: _ignoredExpectedRev, ...cleanPatch } = patch;
    let syncedCanonicalJson =
      cleanPatch.canonicalProjectJson !== undefined
        ? cleanPatch.canonicalProjectJson
        : existing.canonicalProjectJson;
    if (syncedCanonicalJson) {
      try {
        const parsed = JSON.parse(syncedCanonicalJson) as Record<string, unknown>;
        parsed.id = existing.id;
        parsed.ownerUid = existing.ownerUid || 'user-local';
        parsed.title = cleanPatch.title || existing.title;
        parsed.revision = nextRevision;
        parsed.updatedAt = new Date().toISOString();
        syncedCanonicalJson = JSON.stringify(parsed);
      } catch {
        // Ignore parse error
      }
    }

    const updated: ProjectLibraryItem = {
      ...existing,
      ...cleanPatch,
      id: existing.id,
      revision: nextRevision,
      ...(syncedCanonicalJson !== undefined
        ? { canonicalProjectJson: syncedCanonicalJson }
        : {}),
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    this.projects[idx] = updated;
    return updated;
  }

  public async upsertProjectRecord(project: ProjectLibraryItem): Promise<ProjectLibraryItem> {
    this.assertWritable();
    const idx = this.projects.findIndex((p) => p.id === project.id);
    if (idx >= 0) {
      this.projects[idx] = { ...project };
    } else {
      this.projects = [{ ...project }, ...this.projects];
    }
    return { ...project };
  }

  public async deleteProject(id: string): Promise<void> {
    this.assertWritable();
    this.projects = this.projects.filter((p) => p.id !== id);
  }

  public async listJobs(): Promise<JobRecord[]> {
    return [...this.jobs];
  }

  public async createJob(
    input: Omit<
      JobRecord,
      'id' | 'createdAt' | 'updatedAt' | 'requestId' | 'attemptCount' | 'idempotencyKey'
    > & { idempotencyKey?: string }
  ): Promise<JobRecord> {
    this.assertWritable();
    const idemKey =
      input.idempotencyKey ||
      `${input.type}:${input.moduleId}:${input.operation || 'none'}:${input.title}`;

    const existingActive = this.jobs.find(
      (j) =>
        j.idempotencyKey === idemKey &&
        (j.status === 'queued' || j.status === 'claimed' || j.status === 'running')
    );
    if (existingActive) {
      return existingActive;
    }

    const now = new Date().toISOString();
    const record: JobRecord = {
      ...input,
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: now,
      updatedAt: now,
      attemptCount: 1,
      idempotencyKey: idemKey,
      requestId: `req_${Math.random().toString(36).slice(2, 9)}`,
    };
    this.jobs = [record, ...this.jobs];
    return record;
  }

  public async transitionJob(
    id: string,
    nextStatus: JobStatus,
    options?: { redactedMessage?: string; errorCode?: string; deviceId?: string | null }
  ): Promise<JobRecord> {
    this.assertWritable();
    const idx = this.jobs.findIndex((j) => j.id === id);
    if (idx === -1) {
      throw new Error(`Job "${id}" not found`);
    }
    const updated = transitionJobRecord(this.jobs[idx], nextStatus, options);
    this.jobs[idx] = updated;
    return updated;
  }

  public async clearJobs(): Promise<void> {
    this.assertWritable();
    this.jobs = [];
  }

  public async getPreferences(): Promise<UserPreferences> {
    return { ...this.preferences };
  }

  public async savePreferences(
    patch: Partial<UserPreferences>
  ): Promise<UserPreferences> {
    this.assertWritable();
    this.preferences = { ...this.preferences, ...patch };
    return { ...this.preferences };
  }
}

export { InMemoryTestWorkspaceRepository as LocalPreviewWorkspaceRepository };

export const firestoreWorkspaceRepository = new FirestoreWorkspaceRepository();
export const workspaceRepository: IWorkspaceRepository = firestoreWorkspaceRepository;

// --- Durable Client-Side + Server API Sync Helpers for Variants, Recent Items & Asset Library ---
const LOCAL_VARIANTS_STORAGE_KEY = 'sowveil.marketplace.variants.v1';
const LOCAL_FORKED_TEMPLATES_STORAGE_KEY = 'sowveil.marketplace.forkedTemplates.v1';
const LOCAL_RECENT_ITEMS_STORAGE_KEY = 'sowveil.marketplace.recentIds.v1';
const LOCAL_ASSETS_STORAGE_KEY = 'sowveil.marketplace.assets.v1';

function safeReadLocalJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWriteLocalJson<T>(key: string, value: T): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota errors
  }
}

export function getSavedTemplateVariants(baseTemplateId?: string): TemplateVariantInstance[] {
  const all = safeReadLocalJson<TemplateVariantInstance[]>(LOCAL_VARIANTS_STORAGE_KEY, []);
  if (!baseTemplateId) return all;
  return all.filter((v) => v.baseTemplateId === baseTemplateId);
}

export function saveLocalTemplateVariant(
  variant: Omit<TemplateVariantInstance, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): TemplateVariantInstance[] {
  const all = safeReadLocalJson<TemplateVariantInstance[]>(LOCAL_VARIANTS_STORAGE_KEY, []);
  const now = new Date().toISOString();
  const existingIdx = variant.id ? all.findIndex((v) => v.id === variant.id) : -1;
  if (existingIdx >= 0) {
    const updated: TemplateVariantInstance = {
      ...all[existingIdx],
      ...variant,
      id: all[existingIdx].id,
      createdAt: all[existingIdx].createdAt,
      updatedAt: now,
    };
    all[existingIdx] = updated;
    safeWriteLocalJson(LOCAL_VARIANTS_STORAGE_KEY, all);
    return all;
  }
  const created: TemplateVariantInstance = {
    ...variant,
    id: variant.id || `var_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now,
    updatedAt: now,
  };
  const next = [created, ...all];
  safeWriteLocalJson(LOCAL_VARIANTS_STORAGE_KEY, next);
  return next;
}

export function deleteLocalTemplateVariant(variantId: string): TemplateVariantInstance[] {
  const all = safeReadLocalJson<TemplateVariantInstance[]>(LOCAL_VARIANTS_STORAGE_KEY, []);
  const filtered = all.filter((v) => v.id !== variantId);
  safeWriteLocalJson(LOCAL_VARIANTS_STORAGE_KEY, filtered);
  return filtered;
}

export function getLocalForkedTemplates(): CatalogItem[] {
  const raw = safeReadLocalJson<CatalogItem[]>(LOCAL_FORKED_TEMPLATES_STORAGE_KEY, []);
  return raw.map((item) => enrichCatalogItemWithMarketplaceDefaults(item));
}

export function saveLocalForkedTemplate(item: CatalogItem): CatalogItem[] {
  const enriched = enrichCatalogItemWithMarketplaceDefaults(item);
  const all = getLocalForkedTemplates().filter((i) => i.id !== enriched.id);
  const next = [enriched, ...all];
  safeWriteLocalJson(LOCAL_FORKED_TEMPLATES_STORAGE_KEY, next);
  return next;
}

export function getRecentCatalogItemIds(): string[] {
  return safeReadLocalJson<string[]>(LOCAL_RECENT_ITEMS_STORAGE_KEY, []);
}

export function recordRecentCatalogItemId(itemId: string): string[] {
  const current = getRecentCatalogItemIds();
  const next = [itemId, ...current.filter((id) => id !== itemId)].slice(0, 40);
  safeWriteLocalJson(LOCAL_RECENT_ITEMS_STORAGE_KEY, next);
  return next;
}

export function getStarterAndUserAssets(): AssetMetadataRecord[] {
  const stored = safeReadLocalJson<AssetMetadataRecord[] | null>(LOCAL_ASSETS_STORAGE_KEY, null);
  if (stored && stored.length > 0) return stored;
  const seeded: AssetMetadataRecord[] = SEED_CATALOG_ITEMS.slice(0, 10).map((item) => ({
    id: `asset_${item.id}`,
    title: `${item.name} (${item.packLabel})`,
    labels: [item.packLabel, item.moduleId],
    tags: [...item.tags],
    moduleId: item.moduleId,
    catalogItemId: item.id,
    assetKind: item.assetKind,
    ownerUid: 'system-seed',
    visibility: 'public',
    licenseType: item.licenseType as TemplateLicenseType,
    licenseNote: item.licenseNote,
    sourceNote: `Procedural ${item.sourceType} preset specification`,
    provenance: 'Sowveil Studio Core Seed',
    attribution: 'Sowveil Studio',
    storageProvider: 'none-configured',
    storageObjectKey: null,
    mimeType: item.moduleId === 'sfx' ? 'audio/wav' : 'application/json',
    sizeBytes: item.metadata.fileSizeBytes ?? null,
    dimensions: item.metadata.resolution || '1920×1080',
    durationSec: item.metadata.durationSec ?? 3,
    audioFormat: item.moduleId === 'sfx' ? 'WAV 48kHz 24-bit' : undefined,
    checksumSha256: `sha256_seed_${item.id}`,
    versions: [
      {
        version: '1.0.0',
        checksumSha256: `sha256_seed_${item.id}`,
        sizeBytes: item.metadata.fileSizeBytes ?? null,
        mimeType: item.moduleId === 'sfx' ? 'audio/wav' : 'application/json',
        updatedAt: item.updatedAt,
        updatedByUid: 'system-seed',
        note: 'Initial procedural asset specification',
      },
    ],
    missingAssetDetected: false,
    usedByTemplateIds: [item.id],
    usedByVariantIds: [],
    status: 'metadata-only',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
  safeWriteLocalJson(LOCAL_ASSETS_STORAGE_KEY, seeded);
  return seeded;
}

export function saveStarterAndUserAssets(assets: AssetMetadataRecord[]): void {
  safeWriteLocalJson(LOCAL_ASSETS_STORAGE_KEY, assets);
}

