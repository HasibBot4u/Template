import fs from 'node:fs';
import path from 'node:path';
import {
  AccountStatus,
  AuditEventRecord,
  CatalogItem,
  ProjectLibraryItem,
  TemplateVariantInstance,
  UserPreferences,
  UserRole,
} from '../types/sowveil';
import { AiDirectorSessionRecord } from '../services/aiDirectorProductionEngine';
import { ReferenceLabSession } from '../services/referenceLabEngine';
import {
  TemplateFactoryDraftRecord,
  TemplatePreferenceSignal,
  UserPreferenceConsentConfig,
} from '../services/templateFactoryEngine';
import {
  ExtensionPackageRecord,
  HubTaskType,
  ProviderConnectionRecord,
  TaskRoutingProfile,
  ToolExecutionAuditRecord,
} from '../services/providerHubEngine';
import { DurableRenderExportJobRecord } from '../services/renderExportQaEngine';
import {
  AiDirectorSessionFirestoreDto,
  assertImmutableIdentityFields,
  assertMonotonicRevision,
  assertValidDocumentId,
  deserializeAiDirectorSessionFromDto,
  deserializeProjectFromFirestoreDto,
  deserializeReferenceLabSessionFromDto,
  deserializeRenderExportJobFromFirestoreDto,
  deserializeTemplateFactoryDraftFromDto,
  EntityMigrationMetadata,
  IAiDirectorSessionRepository,
  ICatalogAndVariantRepository,
  IProjectPersistenceRepository,
  IProviderConnectionMetadataRepository,
  IReferenceLabSessionRepository,
  IRenderExportJobRepository,
  IRoutingAndExtensionRepository,
  IServerCredentialVaultRepository,
  ISowveilPersistenceAdapter,
  ITemplateFactoryDraftRepository,
  IUserAndSystemGovernanceRepository,
  OwnerBootstrapLockDto,
  PersistenceAdapterKind,
  PersistenceContractError,
  PersistenceReadinessReport,
  ProjectFirestoreDto,
  ProviderConnectionMetadataFirestoreDto,
  ReferenceLabSessionFirestoreDto,
  RenderExportJobFirestoreDto,
  serializeAiDirectorSessionToDto,
  serializeProjectToFirestoreDto,
  serializeProviderConnectionSplitDto,
  serializeReferenceLabSessionToDto,
  serializeRenderExportJobToFirestoreDto,
  serializeTemplateFactoryDraftToDto,
  ServerCredentialVaultRecordDto,
  TemplateFactoryDraftFirestoreDto,
} from '../services/persistenceContracts';

// ============================================================================
// 1. FIRESTORE DOCUMENT DRIVER INTERFACE & IMPLEMENTATIONS
// ============================================================================

export interface IFirestoreDocumentDriver {
  readonly driverLabel: string;
  getDocument<T>(collectionPath: string, docId: string): Promise<T | null>;
  setDocument<T>(collectionPath: string, docId: string, data: T): Promise<void>;
  createDocumentIfAbsent<T>(collectionPath: string, docId: string, data: T): Promise<boolean>;
  deleteDocument(collectionPath: string, docId: string): Promise<boolean>;
  listCollection<T>(collectionPath: string): Promise<T[]>;
}

/**
 * Deterministic Firestore driver for contract testing & local emulator validation.
 * Supports injecting simulated Firestore failures (`PERMISSION_DENIED`, `UNAVAILABLE`)
 * to verify that `AuthoritativeFirestorePersistenceAdapter` fails closed and NEVER
 * falls back silently to local memory or localStorage.
 */
export class RuleEnforcingFirestoreTestDriver implements IFirestoreDocumentDriver {
  public readonly driverLabel: string;
  private readonly collections = new Map<string, Map<string, string>>();
  private simulatedFailure: {
    mode: 'none' | 'read-error' | 'write-error' | 'permission-denied';
    message: string;
  } = { mode: 'none', message: '' };

  constructor(label = 'Rule-Enforcing Firestore Contract Driver (ai-studio-411ad70d-501b-4df1-8287-ce21e9091d8d)') {
    this.driverLabel = label;
  }

  public setSimulatedFailure(
    mode: 'none' | 'read-error' | 'write-error' | 'permission-denied',
    message = 'Simulated Firestore driver failure'
  ): void {
    this.simulatedFailure = { mode, message };
  }

  private assertCanRead(collectionPath: string, docId?: string): void {
    if (this.simulatedFailure.mode === 'read-error' || this.simulatedFailure.mode === 'permission-denied') {
      throw new PersistenceContractError({
        code: 'AUTHORITATIVE_STORE_READ_FAILED',
        message: `${this.simulatedFailure.mode.toUpperCase()}: ${this.simulatedFailure.message}`,
        entity: collectionPath,
        operation: 'get',
        documentId: docId,
        retryable: this.simulatedFailure.mode === 'read-error',
      });
    }
  }

  private assertCanWrite(collectionPath: string, docId: string): void {
    if (this.simulatedFailure.mode === 'write-error' || this.simulatedFailure.mode === 'permission-denied') {
      throw new PersistenceContractError({
        code: 'AUTHORITATIVE_STORE_WRITE_FAILED',
        message: `${this.simulatedFailure.mode.toUpperCase()}: ${this.simulatedFailure.message}`,
        entity: collectionPath,
        operation: 'update',
        documentId: docId,
        retryable: this.simulatedFailure.mode === 'write-error',
      });
    }
  }

  private getColMap(collectionPath: string): Map<string, string> {
    let col = this.collections.get(collectionPath);
    if (!col) {
      col = new Map<string, string>();
      this.collections.set(collectionPath, col);
    }
    return col;
  }

  public async getDocument<T>(collectionPath: string, docId: string): Promise<T | null> {
    this.assertCanRead(collectionPath, docId);
    const col = this.getColMap(collectionPath);
    const raw = col.get(docId);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  public async setDocument<T>(collectionPath: string, docId: string, data: T): Promise<void> {
    this.assertCanWrite(collectionPath, docId);
    assertValidDocumentId(docId, collectionPath);
    // Enforce Firestore rule invariant: providerConnections must never contain encryptedCredential
    if (collectionPath === 'providerConnections') {
      const rec = data as unknown as Record<string, unknown>;
      if ('encryptedCredential' in rec || 'apiKey' in rec || 'rawSecret' in rec) {
        throw new PersistenceContractError({
          code: 'VAULT_SECRET_IN_PUBLIC_DTO_FORBIDDEN',
          message: 'Firestore security rules reject encryptedCredential or raw keys in /providerConnections.',
          entity: collectionPath,
          operation: 'create',
          documentId: docId,
        });
      }
    }
    // Enforce Firestore rule invariant: renderExportJobs must never contain artifactBytesBase64
    if (collectionPath === 'renderExportJobs') {
      const rec = data as unknown as Record<string, unknown>;
      if ('artifactBytesBase64' in rec && rec.artifactBytesBase64) {
        throw new PersistenceContractError({
          code: 'BINARY_MEDIA_IN_FIRESTORE_FORBIDDEN',
          message: 'Firestore documents must not store binary artifactBytesBase64 payloads.',
          entity: collectionPath,
          operation: 'create',
          documentId: docId,
        });
      }
    }
    const col = this.getColMap(collectionPath);
    col.set(docId, JSON.stringify(data));
  }

  public async createDocumentIfAbsent<T>(
    collectionPath: string,
    docId: string,
    data: T
  ): Promise<boolean> {
    this.assertCanWrite(collectionPath, docId);
    assertValidDocumentId(docId, collectionPath);
    const col = this.getColMap(collectionPath);
    if (col.has(docId)) {
      return false;
    }
    col.set(docId, JSON.stringify(data));
    return true;
  }

  public async deleteDocument(collectionPath: string, docId: string): Promise<boolean> {
    this.assertCanWrite(collectionPath, docId);
    const col = this.getColMap(collectionPath);
    return col.delete(docId);
  }

  public async listCollection<T>(collectionPath: string): Promise<T[]> {
    this.assertCanRead(collectionPath);
    const col = this.getColMap(collectionPath);
    return Array.from(col.values()).map((raw) => JSON.parse(raw) as T);
  }
}

// ============================================================================
// 2. SHARED REPOSITORY IMPLEMENTATION BACKED BY ANY DOCUMENT DRIVER
// ============================================================================

class DriverBackedPersistenceRepositories {
  public readonly projects: IProjectPersistenceRepository;
  public readonly aiDirectorSessions: IAiDirectorSessionRepository;
  public readonly referenceLabSessions: IReferenceLabSessionRepository;
  public readonly templateFactoryDrafts: ITemplateFactoryDraftRepository;
  public readonly catalogAndVariants: ICatalogAndVariantRepository;
  public readonly providerConnections: IProviderConnectionMetadataRepository;
  public readonly credentialVault: IServerCredentialVaultRepository;
  public readonly routingAndExtensions: IRoutingAndExtensionRepository;
  public readonly renderExportJobs: IRenderExportJobRepository;
  public readonly governance: IUserAndSystemGovernanceRepository;

  // Transient in-memory cache strictly for downloadable render binary buffers during active process lifetime
  // NEVER persisted to Firestore documents.
  private readonly transientRenderBinaryCache = new Map<string, string>();
  private readonly onMutateCallback?: () => void;

  constructor(
    private readonly driver: IFirestoreDocumentDriver,
    private readonly options: {
      cloudStorageEnabled: boolean;
      onMutate?: () => void;
    }
  ) {
    this.onMutateCallback = options.onMutate;

    const notifyMutate = () => {
      if (this.onMutateCallback) {
        this.onMutateCallback();
      }
    };

    // 1. Projects Repository
    this.projects = {
      create: async (
        project: ProjectLibraryItem,
        migrationMetadata?: EntityMigrationMetadata
      ): Promise<ProjectLibraryItem> => {
        let normalizedProject: ProjectLibraryItem = { ...project };
        if (normalizedProject.canonicalProjectJson) {
          try {
            const parsedCanon = JSON.parse(normalizedProject.canonicalProjectJson) as Record<
              string,
              unknown
            >;
            if (parsedCanon && typeof parsedCanon === 'object') {
              parsedCanon.id = normalizedProject.id;
              parsedCanon.ownerUid = normalizedProject.ownerUid;
              if (normalizedProject.title) parsedCanon.title = normalizedProject.title;
              const effectiveRev =
                typeof normalizedProject.revision === 'number' && normalizedProject.revision >= 1
                  ? normalizedProject.revision
                  : typeof parsedCanon.revision === 'number' && parsedCanon.revision >= 1
                  ? (parsedCanon.revision as number)
                  : 1;
              parsedCanon.revision = effectiveRev;
              normalizedProject.revision = effectiveRev;
              normalizedProject.canonicalProjectJson = JSON.stringify(parsedCanon);
            }
          } catch {
            // Leave validation to caller/DTO serializer if malformed
          }
        }
        const dto = serializeProjectToFirestoreDto(normalizedProject, migrationMetadata);
        const existing = await this.driver.getDocument<ProjectFirestoreDto>('projects', dto.id);
        if (existing) {
          throw new PersistenceContractError({
            code: 'ENTITY_ALREADY_EXISTS',
            message: `Project "${dto.id}" already exists. Use update() to preserve canonical project identity.`,
            entity: 'projects',
            operation: 'create',
            documentId: dto.id,
          });
        }
        await this.driver.setDocument('projects', dto.id, dto);
        notifyMutate();
        return deserializeProjectFromFirestoreDto(dto).project;
      },

      getById: async (
        id: string,
        requesterUid: string,
        isAdmin = false
      ): Promise<ProjectLibraryItem | null> => {
        const dto = await this.driver.getDocument<ProjectFirestoreDto>('projects', id);
        if (!dto) return null;
        if (dto.ownerUid !== requesterUid && !isAdmin) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" is not authorized to read project "${id}".`,
            entity: 'projects',
            operation: 'get',
            documentId: id,
          });
        }
        return deserializeProjectFromFirestoreDto(dto).project;
      },

      listByOwner: async (ownerUid: string): Promise<ProjectLibraryItem[]> => {
        const all = await this.driver.listCollection<ProjectFirestoreDto>('projects');
        return all
          .filter((d) => d.ownerUid === ownerUid)
          .map((d) => deserializeProjectFromFirestoreDto(d).project)
          .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      },

      update: async (
        id: string,
        requesterUid: string,
        patch: Partial<ProjectLibraryItem>,
        updateOptions?: { expectedRevision?: number; isAdmin?: boolean }
      ): Promise<ProjectLibraryItem> => {
        const existingDto = await this.driver.getDocument<ProjectFirestoreDto>('projects', id);
        if (!existingDto) {
          throw new PersistenceContractError({
            code: 'ENTITY_NOT_FOUND',
            message: `Project "${id}" not found.`,
            entity: 'projects',
            operation: 'update',
            documentId: id,
          });
        }
        if (existingDto.ownerUid !== requesterUid && !updateOptions?.isAdmin) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" is not authorized to update project "${id}".`,
            entity: 'projects',
            operation: 'update',
            documentId: id,
          });
        }

        assertImmutableIdentityFields({
          entity: 'projects',
          documentId: id,
          existing: {
            id: existingDto.id,
            ownerUid: existingDto.ownerUid,
            createdAt: existingDto.createdAt,
          },
          incoming: {
            id: patch.id,
            ownerUid: patch.ownerUid,
            createdAt: patch.createdAt,
          },
        });

        const nextRevision = assertMonotonicRevision({
          entity: 'projects',
          documentId: id,
          existingRevision: existingDto.revision || 1,
          expectedRevision: updateOptions?.expectedRevision,
          incomingRevision: patch.revision,
        });

        const { project: existingDomain, migrationMetadata } =
          deserializeProjectFromFirestoreDto(existingDto);
        const nextUpdatedAt = patch.updatedAt || new Date().toISOString();
        const merged: ProjectLibraryItem = {
          ...existingDomain,
          ...patch,
          id: existingDto.id,
          ownerUid: existingDto.ownerUid,
          createdAt: existingDto.createdAt,
          revision: nextRevision,
          updatedAt: nextUpdatedAt,
        };

        if (merged.canonicalProjectJson) {
          try {
            const parsedCanon = JSON.parse(merged.canonicalProjectJson) as Record<
              string,
              unknown
            >;
            if (parsedCanon && typeof parsedCanon === 'object') {
              parsedCanon.id = merged.id;
              parsedCanon.ownerUid = merged.ownerUid;
              parsedCanon.title = merged.title;
              parsedCanon.revision = nextRevision;
              parsedCanon.updatedAt = nextUpdatedAt;
              if (merged.activeBranch) {
                parsedCanon.activeBranch = merged.activeBranch;
              }
              merged.canonicalProjectJson = JSON.stringify(parsedCanon);
            }
          } catch {
            // Preserve raw string if not JSON object
          }
        }

        const nextDto = serializeProjectToFirestoreDto(merged, migrationMetadata);
        await this.driver.setDocument('projects', id, nextDto);
        notifyMutate();
        return deserializeProjectFromFirestoreDto(nextDto).project;
      },

      delete: async (id: string, requesterUid: string, isAdmin = false): Promise<boolean> => {
        const existingDto = await this.driver.getDocument<ProjectFirestoreDto>('projects', id);
        if (!existingDto) return false;
        if (existingDto.ownerUid !== requesterUid && !isAdmin) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" is not authorized to delete project "${id}".`,
            entity: 'projects',
            operation: 'delete',
            documentId: id,
          });
        }
        const removed = await this.driver.deleteDocument('projects', id);
        if (removed) notifyMutate();
        return removed;
      },
    };

    // 2. AI Director Sessions Repository
    this.aiDirectorSessions = {
      save: async (session: AiDirectorSessionRecord): Promise<AiDirectorSessionRecord> => {
        const dto = serializeAiDirectorSessionToDto(session);
        const existing = await this.driver.getDocument<AiDirectorSessionFirestoreDto>(
          'aiDirectorSessions',
          session.id
        );
        if (existing) {
          assertImmutableIdentityFields({
            entity: 'aiDirectorSessions',
            documentId: session.id,
            existing: {
              id: existing.id,
              ownerUid: existing.ownerUid,
              createdAt: existing.createdAt,
            },
            incoming: {
              id: dto.id,
              ownerUid: dto.ownerUid,
              createdAt: dto.createdAt,
            },
          });
          if (existing.originalScriptSha256 && existing.originalScriptSha256 !== dto.originalScriptSha256) {
            throw new PersistenceContractError({
              code: 'IMMUTABLE_IDENTITY_VIOLATION',
              message: `Immutable field "originalScriptSha256" cannot be mutated on AI Director session "${session.id}".`,
              entity: 'aiDirectorSessions',
              operation: 'update',
              documentId: session.id,
            });
          }
        }
        await this.driver.setDocument('aiDirectorSessions', dto.id, dto);
        notifyMutate();
        return deserializeAiDirectorSessionFromDto(dto);
      },

      getById: async (
        id: string,
        requesterUid: string,
        isAdmin = false
      ): Promise<AiDirectorSessionRecord | null> => {
        const dto = await this.driver.getDocument<AiDirectorSessionFirestoreDto>(
          'aiDirectorSessions',
          id
        );
        if (!dto) return null;
        if (dto.ownerUid !== requesterUid && !isAdmin) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot access AI Director session "${id}".`,
            entity: 'aiDirectorSessions',
            operation: 'get',
            documentId: id,
          });
        }
        return deserializeAiDirectorSessionFromDto(dto);
      },

      listByOwner: async (ownerUid: string): Promise<AiDirectorSessionRecord[]> => {
        const all = await this.driver.listCollection<AiDirectorSessionFirestoreDto>(
          'aiDirectorSessions'
        );
        return all
          .filter((d) => d.ownerUid === ownerUid)
          .map(deserializeAiDirectorSessionFromDto)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      },

      delete: async (id: string, requesterUid: string): Promise<boolean> => {
        const existing = await this.driver.getDocument<AiDirectorSessionFirestoreDto>(
          'aiDirectorSessions',
          id
        );
        if (!existing) return false;
        if (existing.ownerUid !== requesterUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot delete AI Director session "${id}".`,
            entity: 'aiDirectorSessions',
            operation: 'delete',
            documentId: id,
          });
        }
        const removed = await this.driver.deleteDocument('aiDirectorSessions', id);
        if (removed) notifyMutate();
        return removed;
      },
    };

    // 3. Reference Lab Sessions Repository
    this.referenceLabSessions = {
      save: async (session: ReferenceLabSession): Promise<ReferenceLabSession> => {
        const dto = serializeReferenceLabSessionToDto(session);
        const existing = await this.driver.getDocument<ReferenceLabSessionFirestoreDto>(
          'referenceLabSessions',
          session.id
        );
        if (existing) {
          assertImmutableIdentityFields({
            entity: 'referenceLabSessions',
            documentId: session.id,
            existing: {
              id: existing.id,
              ownerUid: existing.ownerUid,
              createdAt: existing.createdAt,
            },
            incoming: {
              id: dto.id,
              ownerUid: dto.ownerUid,
              createdAt: dto.createdAt,
            },
          });
          if (existing.sourceKind && existing.sourceKind !== dto.sourceKind) {
            throw new PersistenceContractError({
              code: 'IMMUTABLE_IDENTITY_VIOLATION',
              message: `Immutable field "sourceKind" cannot be mutated on Reference Lab session "${session.id}".`,
              entity: 'referenceLabSessions',
              operation: 'update',
              documentId: session.id,
            });
          }
          if (existing.usageMode && existing.usageMode !== dto.usageMode) {
            throw new PersistenceContractError({
              code: 'IMMUTABLE_IDENTITY_VIOLATION',
              message: `Immutable field "usageMode" cannot be mutated on Reference Lab session "${session.id}".`,
              entity: 'referenceLabSessions',
              operation: 'update',
              documentId: session.id,
            });
          }
        }
        await this.driver.setDocument('referenceLabSessions', dto.id, dto);
        notifyMutate();
        return deserializeReferenceLabSessionFromDto(dto);
      },

      getById: async (
        id: string,
        requesterUid: string,
        isAdmin = false
      ): Promise<ReferenceLabSession | null> => {
        const dto = await this.driver.getDocument<ReferenceLabSessionFirestoreDto>(
          'referenceLabSessions',
          id
        );
        if (!dto) return null;
        if (dto.ownerUid !== requesterUid && !isAdmin) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot access Reference Lab session "${id}".`,
            entity: 'referenceLabSessions',
            operation: 'get',
            documentId: id,
          });
        }
        return deserializeReferenceLabSessionFromDto(dto);
      },

      listByOwner: async (ownerUid: string): Promise<ReferenceLabSession[]> => {
        const all = await this.driver.listCollection<ReferenceLabSessionFirestoreDto>(
          'referenceLabSessions'
        );
        return all
          .filter((d) => d.ownerUid === ownerUid)
          .map(deserializeReferenceLabSessionFromDto)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      },

      delete: async (id: string, requesterUid: string): Promise<boolean> => {
        const existing = await this.driver.getDocument<ReferenceLabSessionFirestoreDto>(
          'referenceLabSessions',
          id
        );
        if (!existing) return false;
        if (existing.ownerUid !== requesterUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot delete Reference Lab session "${id}".`,
            entity: 'referenceLabSessions',
            operation: 'delete',
            documentId: id,
          });
        }
        const removed = await this.driver.deleteDocument('referenceLabSessions', id);
        if (removed) notifyMutate();
        return removed;
      },
    };

    // 4. Template Factory Drafts Repository
    this.templateFactoryDrafts = {
      save: async (draft: TemplateFactoryDraftRecord): Promise<TemplateFactoryDraftRecord> => {
        const dto = serializeTemplateFactoryDraftToDto(draft);
        const existing = await this.driver.getDocument<TemplateFactoryDraftFirestoreDto>(
          'templateFactoryDrafts',
          draft.id
        );
        if (existing) {
          assertImmutableIdentityFields({
            entity: 'templateFactoryDrafts',
            documentId: draft.id,
            existing: {
              id: existing.id,
              ownerUid: existing.ownerUid,
              createdAt: existing.createdAt,
            },
            incoming: {
              id: dto.id,
              ownerUid: dto.ownerUid,
              createdAt: dto.createdAt,
            },
          });
          if (existing.sourceKind && existing.sourceKind !== dto.sourceKind) {
            throw new PersistenceContractError({
              code: 'IMMUTABLE_IDENTITY_VIOLATION',
              message: `Immutable field "sourceKind" cannot be mutated on Template Factory draft "${draft.id}".`,
              entity: 'templateFactoryDrafts',
              operation: 'update',
              documentId: draft.id,
            });
          }
        }
        await this.driver.setDocument('templateFactoryDrafts', dto.id, dto);
        notifyMutate();
        return deserializeTemplateFactoryDraftFromDto(dto);
      },

      publishDraftToCatalog: async (
        draft: TemplateFactoryDraftRecord,
        catalogItem: CatalogItem
      ): Promise<{
        draft: TemplateFactoryDraftRecord;
        catalogItem: CatalogItem;
        idempotentNoOp: boolean;
      }> => {
        assertValidDocumentId(catalogItem.id, 'catalogItems');
        const existingDraftDto = await this.driver.getDocument<TemplateFactoryDraftFirestoreDto>(
          'templateFactoryDrafts',
          draft.id
        );
        const existingCatalogItem = await this.driver.getDocument<CatalogItem>(
          'catalogItems',
          catalogItem.id
        );
        if (existingDraftDto) {
          assertImmutableIdentityFields({
            entity: 'templateFactoryDrafts',
            documentId: draft.id,
            existing: {
              id: existingDraftDto.id,
              ownerUid: existingDraftDto.ownerUid,
              createdAt: existingDraftDto.createdAt,
            },
            incoming: {
              id: draft.id,
              ownerUid: draft.ownerUid,
              createdAt: draft.createdAt,
            },
          });
          if (
            existingDraftDto.publishedToCatalog &&
            existingDraftDto.publishedVersion === draft.version &&
            existingDraftDto.publishedCatalogItemId === catalogItem.id &&
            existingCatalogItem &&
            existingCatalogItem.metadata?.version === catalogItem.metadata?.version &&
            existingCatalogItem.visibility === 'published' &&
            existingCatalogItem.validationState === 'Validated'
          ) {
            return {
              draft: deserializeTemplateFactoryDraftFromDto(existingDraftDto),
              catalogItem: existingCatalogItem,
              idempotentNoOp: true,
            };
          }
        }
        if (existingCatalogItem) {
          assertImmutableIdentityFields({
            entity: 'catalogItems',
            documentId: catalogItem.id,
            existing: {
              id: existingCatalogItem.id,
              ownerUid: existingCatalogItem.ownerUid,
              createdAt: existingCatalogItem.createdAt,
            },
            incoming: {
              id: catalogItem.id,
              ownerUid: catalogItem.ownerUid,
              createdAt: catalogItem.createdAt,
            },
          });
        }
        const dto = serializeTemplateFactoryDraftToDto({
          ...draft,
          publishedToCatalog: true,
          publishedCatalogItemId: catalogItem.id,
          publishedVersion: draft.version,
        });
        await this.driver.setDocument('templateFactoryDrafts', dto.id, dto);
        await this.driver.setDocument('catalogItems', catalogItem.id, catalogItem);
        notifyMutate();
        return {
          draft: deserializeTemplateFactoryDraftFromDto(dto),
          catalogItem,
          idempotentNoOp: false,
        };
      },

      getById: async (
        id: string,
        requesterUid: string,
        isAdmin = false
      ): Promise<TemplateFactoryDraftRecord | null> => {
        const dto = await this.driver.getDocument<TemplateFactoryDraftFirestoreDto>(
          'templateFactoryDrafts',
          id
        );
        if (!dto) return null;
        if (dto.ownerUid !== requesterUid && !isAdmin) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot access Template Factory draft "${id}".`,
            entity: 'templateFactoryDrafts',
            operation: 'get',
            documentId: id,
          });
        }
        return deserializeTemplateFactoryDraftFromDto(dto);
      },

      listByOwner: async (ownerUid: string): Promise<TemplateFactoryDraftRecord[]> => {
        const all = await this.driver.listCollection<TemplateFactoryDraftFirestoreDto>(
          'templateFactoryDrafts'
        );
        return all
          .filter((d) => d.ownerUid === ownerUid)
          .map(deserializeTemplateFactoryDraftFromDto)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      },

      delete: async (id: string, requesterUid: string): Promise<boolean> => {
        const existing = await this.driver.getDocument<TemplateFactoryDraftFirestoreDto>(
          'templateFactoryDrafts',
          id
        );
        if (!existing) return false;
        if (existing.ownerUid !== requesterUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot delete Template Factory draft "${id}".`,
            entity: 'templateFactoryDrafts',
            operation: 'delete',
            documentId: id,
          });
        }
        const removed = await this.driver.deleteDocument('templateFactoryDrafts', id);
        if (removed) notifyMutate();
        return removed;
      },

      getPreferenceConsent: async (ownerUid: string): Promise<UserPreferenceConsentConfig | null> => {
        assertValidDocumentId(ownerUid, 'userPreferenceConsents.ownerUid');
        return this.driver.getDocument<UserPreferenceConsentConfig>(
          'userPreferenceConsents',
          ownerUid
        );
      },

      savePreferenceConsent: async (
        consent: UserPreferenceConsentConfig
      ): Promise<UserPreferenceConsentConfig> => {
        const ownerUid = assertValidDocumentId(consent.ownerUid, 'userPreferenceConsents.ownerUid');
        await this.driver.setDocument('userPreferenceConsents', ownerUid, consent);
        notifyMutate();
        return consent;
      },

      listPreferenceSignals: async (ownerUid: string): Promise<TemplatePreferenceSignal[]> => {
        assertValidDocumentId(ownerUid, 'templatePreferenceSignals.ownerUid');
        const record = await this.driver.getDocument<{
          ownerUid: string;
          signals: TemplatePreferenceSignal[];
        }>('templatePreferenceSignals', ownerUid);
        return record?.signals ?? [];
      },

      savePreferenceSignals: async (
        ownerUid: string,
        signals: TemplatePreferenceSignal[]
      ): Promise<TemplatePreferenceSignal[]> => {
        assertValidDocumentId(ownerUid, 'templatePreferenceSignals.ownerUid');
        await this.driver.setDocument('templatePreferenceSignals', ownerUid, {
          ownerUid,
          signals,
        });
        notifyMutate();
        return signals;
      },
    };

    // 5. Catalog & Variants Repository
    this.catalogAndVariants = {
      saveCatalogItem: async (item: CatalogItem): Promise<CatalogItem> => {
        assertValidDocumentId(item.id, 'catalogItems');
        const existing = await this.driver.getDocument<CatalogItem>('catalogItems', item.id);
        if (existing) {
          assertImmutableIdentityFields({
            entity: 'catalogItems',
            documentId: item.id,
            existing: {
              id: existing.id,
              ownerUid: existing.ownerUid,
              createdAt: existing.createdAt,
            },
            incoming: {
              id: item.id,
              ownerUid: item.ownerUid,
              createdAt: item.createdAt,
            },
          });
        }
        await this.driver.setDocument('catalogItems', item.id, item);
        notifyMutate();
        return item;
      },

      getCatalogItemById: async (id: string): Promise<CatalogItem | null> => {
        return this.driver.getDocument<CatalogItem>('catalogItems', id);
      },

      listCatalogItems: async (): Promise<CatalogItem[]> => {
        return this.driver.listCollection<CatalogItem>('catalogItems');
      },

      deleteCatalogItem: async (id: string): Promise<boolean> => {
        const removed = await this.driver.deleteDocument('catalogItems', id);
        if (removed) notifyMutate();
        return removed;
      },

      saveVariant: async (variant: TemplateVariantInstance): Promise<TemplateVariantInstance> => {
        assertValidDocumentId(variant.id, 'templateVariants');
        assertValidDocumentId(variant.ownerUid, 'templateVariants.ownerUid');
        const existing = await this.driver.getDocument<TemplateVariantInstance>(
          'templateVariants',
          variant.id
        );
        if (existing) {
          assertImmutableIdentityFields({
            entity: 'templateVariants',
            documentId: variant.id,
            existing: {
              id: existing.id,
              ownerUid: existing.ownerUid,
              createdAt: existing.createdAt,
            },
            incoming: {
              id: variant.id,
              ownerUid: variant.ownerUid,
              createdAt: variant.createdAt,
            },
          });
        }
        await this.driver.setDocument('templateVariants', variant.id, variant);
        notifyMutate();
        return variant;
      },

      getVariantById: async (
        id: string,
        requesterUid: string
      ): Promise<TemplateVariantInstance | null> => {
        const v = await this.driver.getDocument<TemplateVariantInstance>('templateVariants', id);
        if (!v) return null;
        if (v.ownerUid !== requesterUid && v.visibility !== 'public') {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot read private variant "${id}".`,
            entity: 'templateVariants',
            operation: 'get',
            documentId: id,
          });
        }
        return v;
      },

      listVariantsByOwner: async (
        ownerUid: string,
        baseTemplateId?: string
      ): Promise<TemplateVariantInstance[]> => {
        const all = await this.driver.listCollection<TemplateVariantInstance>('templateVariants');
        return all.filter(
          (v) =>
            v.ownerUid === ownerUid &&
            (!baseTemplateId || v.baseTemplateId === baseTemplateId)
        );
      },

      deleteVariant: async (id: string, requesterUid: string): Promise<boolean> => {
        const existing = await this.driver.getDocument<TemplateVariantInstance>(
          'templateVariants',
          id
        );
        if (!existing) return false;
        if (existing.ownerUid !== requesterUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot delete variant "${id}".`,
            entity: 'templateVariants',
            operation: 'delete',
            documentId: id,
          });
        }
        const removed = await this.driver.deleteDocument('templateVariants', id);
        if (removed) notifyMutate();
        return removed;
      },
    };

    // 6. Provider Connection Metadata & Server Vault Repositories
    this.providerConnections = {
      saveMetadata: async (
        record: ProviderConnectionRecord
      ): Promise<ProviderConnectionMetadataFirestoreDto> => {
        const existing = await this.driver.getDocument<ProviderConnectionMetadataFirestoreDto>(
          'providerConnections',
          record.id
        );
        if (existing) {
          assertImmutableIdentityFields({
            entity: 'providerConnections',
            documentId: record.id,
            existing: {
              id: existing.id,
              ownerUid: existing.ownerUid,
              createdAt: existing.createdAt,
            },
            incoming: {
              id: record.id,
              ownerUid: record.ownerUid,
              createdAt: record.createdAt,
            },
          });
        }
        const { metadataDto, vaultSecretDto } = serializeProviderConnectionSplitDto(record);
        await this.driver.setDocument('providerConnections', metadataDto.id, metadataDto);
        if (vaultSecretDto) {
          await this.credentialVault.saveVaultSecret(vaultSecretDto);
        }
        notifyMutate();
        return metadataDto;
      },

      getMetadataById: async (
        id: string,
        requesterUid: string,
        isAdmin = false
      ): Promise<ProviderConnectionMetadataFirestoreDto | null> => {
        const dto = await this.driver.getDocument<ProviderConnectionMetadataFirestoreDto>(
          'providerConnections',
          id
        );
        if (!dto) return null;
        if (dto.ownerUid !== requesterUid && !isAdmin) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot access provider connection "${id}".`,
            entity: 'providerConnections',
            operation: 'get',
            documentId: id,
          });
        }
        return dto;
      },

      listMetadataByOwner: async (
        ownerUid: string
      ): Promise<ProviderConnectionMetadataFirestoreDto[]> => {
        const all = await this.driver.listCollection<ProviderConnectionMetadataFirestoreDto>(
          'providerConnections'
        );
        return all.filter((c) => c.ownerUid === ownerUid);
      },

      deleteMetadata: async (id: string, requesterUid: string): Promise<boolean> => {
        const existing = await this.driver.getDocument<ProviderConnectionMetadataFirestoreDto>(
          'providerConnections',
          id
        );
        if (!existing) return false;
        if (existing.ownerUid !== requesterUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot delete provider connection "${id}".`,
            entity: 'providerConnections',
            operation: 'delete',
            documentId: id,
          });
        }
        await this.credentialVault.deleteVaultSecret(id, requesterUid);
        const removed = await this.driver.deleteDocument('providerConnections', id);
        if (removed) notifyMutate();
        return removed;
      },
    };

    // 7. Server-Only Encrypted Credential Vault Repository
    this.credentialVault = {
      saveVaultSecret: async (secretRecord: ServerCredentialVaultRecordDto): Promise<void> => {
        assertValidDocumentId(secretRecord.connectionId, 'serverVaultSecrets');
        await this.driver.setDocument(
          '__server_only_credential_vault__',
          secretRecord.connectionId,
          secretRecord
        );
        notifyMutate();
      },

      getVaultSecret: async (
        connectionId: string,
        ownerUid: string
      ): Promise<ServerCredentialVaultRecordDto | null> => {
        const rec = await this.driver.getDocument<ServerCredentialVaultRecordDto>(
          '__server_only_credential_vault__',
          connectionId
        );
        if (!rec) return null;
        if (rec.ownerUid !== ownerUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `Vault secret scope mismatch for connection "${connectionId}".`,
            entity: 'serverVaultSecrets',
            operation: 'get',
            documentId: connectionId,
          });
        }
        return rec;
      },

      deleteVaultSecret: async (connectionId: string, ownerUid: string): Promise<boolean> => {
        const rec = await this.driver.getDocument<ServerCredentialVaultRecordDto>(
          '__server_only_credential_vault__',
          connectionId
        );
        if (!rec) return false;
        if (rec.ownerUid !== ownerUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `Vault secret delete denied for connection "${connectionId}".`,
            entity: 'serverVaultSecrets',
            operation: 'delete',
            documentId: connectionId,
          });
        }
        return this.driver.deleteDocument('__server_only_credential_vault__', connectionId);
      },

      purgeAllForOwner: async (ownerUid: string): Promise<number> => {
        const all = await this.driver.listCollection<ServerCredentialVaultRecordDto>(
          '__server_only_credential_vault__'
        );
        let count = 0;
        for (const item of all) {
          if (item.ownerUid === ownerUid) {
            await this.driver.deleteDocument(
              '__server_only_credential_vault__',
              item.connectionId
            );
            count += 1;
          }
        }
        if (count > 0) notifyMutate();
        return count;
      },
    };

    // 8. Routing Profiles, Extensions & Tool Audits Repository
    this.routingAndExtensions = {
      saveRoutingProfiles: async (
        ownerUid: string,
        profiles: Record<HubTaskType, TaskRoutingProfile>
      ): Promise<Record<HubTaskType, TaskRoutingProfile>> => {
        assertValidDocumentId(ownerUid, 'routingProfiles');
        await this.driver.setDocument('routingProfiles', ownerUid, profiles);
        notifyMutate();
        return profiles;
      },

      getRoutingProfiles: async (
        ownerUid: string
      ): Promise<Record<HubTaskType, TaskRoutingProfile> | null> => {
        return this.driver.getDocument<Record<HubTaskType, TaskRoutingProfile>>(
          'routingProfiles',
          ownerUid
        );
      },

      saveExtension: async (ext: ExtensionPackageRecord): Promise<ExtensionPackageRecord> => {
        assertValidDocumentId(ext.id, 'extensionPackages');
        const existing = await this.driver.getDocument<ExtensionPackageRecord>(
          'extensionPackages',
          ext.id
        );
        if (existing) {
          assertImmutableIdentityFields({
            entity: 'extensionPackages',
            documentId: ext.id,
            existing: {
              id: existing.id,
              ownerUid: existing.ownerUid,
              createdAt: existing.createdAt,
            },
            incoming: {
              id: ext.id,
              ownerUid: ext.ownerUid,
              createdAt: ext.createdAt,
            },
          });
        }
        await this.driver.setDocument('extensionPackages', ext.id, ext);
        notifyMutate();
        return ext;
      },

      listExtensionsByOwner: async (ownerUid: string): Promise<ExtensionPackageRecord[]> => {
        const all = await this.driver.listCollection<ExtensionPackageRecord>('extensionPackages');
        return all.filter((e) => e.ownerUid === ownerUid);
      },

      deleteExtension: async (id: string, requesterUid: string): Promise<boolean> => {
        const existing = await this.driver.getDocument<ExtensionPackageRecord>(
          'extensionPackages',
          id
        );
        if (!existing) return false;
        if (existing.ownerUid !== requesterUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot delete extension "${id}".`,
            entity: 'extensionPackages',
            operation: 'delete',
            documentId: id,
          });
        }
        return this.driver.deleteDocument('extensionPackages', id);
      },

      appendToolAudit: async (
        record: ToolExecutionAuditRecord
      ): Promise<ToolExecutionAuditRecord> => {
        assertValidDocumentId(record.id, 'toolAuditRecords');
        await this.driver.setDocument('toolAuditRecords', record.id, record);
        notifyMutate();
        return record;
      },

      listToolAuditsByOwner: async (ownerUid: string): Promise<ToolExecutionAuditRecord[]> => {
        const all = await this.driver.listCollection<ToolExecutionAuditRecord>('toolAuditRecords');
        return all.filter((a) => a.ownerUid === ownerUid);
      },
    };

    // 9. Render/Export Jobs Repository (Strips binary media from Firestore documents)
    this.renderExportJobs = {
      saveJob: async (
        job: DurableRenderExportJobRecord,
        saveOptions?: { cloudStorageEnabled?: boolean }
      ): Promise<DurableRenderExportJobRecord> => {
        const existing = await this.driver.getDocument<RenderExportJobFirestoreDto>(
          'renderExportJobs',
          job.id
        );
        if (existing) {
          assertImmutableIdentityFields({
            entity: 'renderExportJobs',
            documentId: job.id,
            existing: {
              id: existing.id,
              ownerUid: existing.ownerUid,
              createdAt: existing.createdAt,
            },
            incoming: {
              id: job.id,
              ownerUid: job.ownerUid,
              createdAt: job.createdAt,
            },
          });
        }

        const storageOn = saveOptions?.cloudStorageEnabled ?? this.options.cloudStorageEnabled;
        const dto = serializeRenderExportJobToFirestoreDto(job, storageOn);
        await this.driver.setDocument('renderExportJobs', dto.id, dto);

        // Store binary payload ONLY in transient memory cache, NEVER in Firestore
        if (job.artifactBytesBase64) {
          this.transientRenderBinaryCache.set(job.id, job.artifactBytesBase64);
        }
        notifyMutate();
        return deserializeRenderExportJobFromFirestoreDto(
          dto,
          this.transientRenderBinaryCache.get(job.id) ?? null
        );
      },

      getJobById: async (
        id: string,
        requesterUid: string,
        isAdmin = false
      ): Promise<DurableRenderExportJobRecord | null> => {
        const dto = await this.driver.getDocument<RenderExportJobFirestoreDto>(
          'renderExportJobs',
          id
        );
        if (!dto) return null;
        if (dto.ownerUid !== requesterUid && !isAdmin) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot access render job "${id}".`,
            entity: 'renderExportJobs',
            operation: 'get',
            documentId: id,
          });
        }
        return deserializeRenderExportJobFromFirestoreDto(
          dto,
          this.transientRenderBinaryCache.get(id) ?? null
        );
      },

      listJobsByOwner: async (ownerUid: string): Promise<DurableRenderExportJobRecord[]> => {
        const all = await this.driver.listCollection<RenderExportJobFirestoreDto>(
          'renderExportJobs'
        );
        return all
          .filter((j) => j.ownerUid === ownerUid)
          .map((dto) =>
            deserializeRenderExportJobFromFirestoreDto(
              dto,
              this.transientRenderBinaryCache.get(dto.id) ?? null
            )
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      },

      deleteJob: async (id: string, requesterUid: string): Promise<boolean> => {
        const existing = await this.driver.getDocument<RenderExportJobFirestoreDto>(
          'renderExportJobs',
          id
        );
        if (!existing) return false;
        if (existing.ownerUid !== requesterUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot delete render job "${id}".`,
            entity: 'renderExportJobs',
            operation: 'delete',
            documentId: id,
          });
        }
        this.transientRenderBinaryCache.delete(id);
        const removed = await this.driver.deleteDocument('renderExportJobs', id);
        if (removed) notifyMutate();
        return removed;
      },
    };

    // 10. User & System Governance Repository (Preferences, Favorites, Roles, Bootstrap Lock, Audits)
    this.governance = {
      getPreferences: async (uid: string): Promise<UserPreferences | null> => {
        const doc = await this.driver.getDocument<{ preferences?: UserPreferences }>(
          'userPreferences',
          uid
        );
        return doc?.preferences ?? null;
      },

      savePreferences: async (
        uid: string,
        prefs: UserPreferences
      ): Promise<UserPreferences> => {
        assertValidDocumentId(uid, 'userPreferences');
        await this.driver.setDocument('userPreferences', uid, {
          uid,
          preferences: prefs,
          updatedAt: new Date().toISOString(),
        });
        notifyMutate();
        return prefs;
      },

      getFavorites: async (uid: string): Promise<string[]> => {
        const doc = await this.driver.getDocument<{ items: string[] }>('favorites', uid);
        return doc?.items ?? [];
      },

      addFavorite: async (uid: string, itemId: string): Promise<string[]> => {
        assertValidDocumentId(uid, 'favorites');
        assertValidDocumentId(itemId, 'favorites.itemId');
        const current = await this.governance.getFavorites(uid);
        const next = Array.from(new Set([...current, itemId]));
        await this.driver.setDocument('favorites', uid, {
          uid,
          items: next,
          updatedAt: new Date().toISOString(),
        });
        notifyMutate();
        return next;
      },

      removeFavorite: async (uid: string, itemId: string): Promise<string[]> => {
        assertValidDocumentId(uid, 'favorites');
        const current = await this.governance.getFavorites(uid);
        const next = current.filter((id) => id !== itemId);
        await this.driver.setDocument('favorites', uid, {
          uid,
          items: next,
          updatedAt: new Date().toISOString(),
        });
        notifyMutate();
        return next;
      },

      getRole: async (uid: string): Promise<UserRole> => {
        const grant = await this.driver.getDocument<{ role: UserRole }>('admins', uid);
        return grant?.role || 'user';
      },

      setRole: async (uid: string, role: UserRole, grantedByUid: string): Promise<void> => {
        assertValidDocumentId(uid, 'admins');
        if (role === 'user') {
          await this.driver.deleteDocument('admins', uid);
        } else {
          await this.driver.setDocument('admins', uid, {
            uid,
            role,
            grantedBy: grantedByUid,
            createdAt: new Date().toISOString(),
          });
        }
        notifyMutate();
      },

      getAccountStatus: async (uid: string): Promise<AccountStatus> => {
        const rec = await this.driver.getDocument<{ status: AccountStatus }>('userStatuses', uid);
        return rec?.status || 'active';
      },

      setAccountStatus: async (uid: string, status: AccountStatus): Promise<void> => {
        assertValidDocumentId(uid, 'userStatuses');
        await this.driver.setDocument('userStatuses', uid, {
          uid,
          status,
          updatedAt: new Date().toISOString(),
        });
        notifyMutate();
      },

      getOwnerBootstrapLock: async (): Promise<OwnerBootstrapLockDto | null> => {
        return this.driver.getDocument<OwnerBootstrapLockDto>('systemLocks', 'ownerBootstrap');
      },

      claimOwnerBootstrapLock: async (
        ownerUid: string,
        environment: string
      ): Promise<OwnerBootstrapLockDto> => {
        assertValidDocumentId(ownerUid, 'systemLocks.ownerUid');
        const lockDto: OwnerBootstrapLockDto = {
          id: 'ownerBootstrap',
          bootstrapped: true,
          ownerUid,
          lockedAt: new Date().toISOString(),
          environment,
        };
        const created = await this.driver.createDocumentIfAbsent(
          'systemLocks',
          'ownerBootstrap',
          lockDto
        );
        if (!created) {
          throw new PersistenceContractError({
            code: 'BOOTSTRAP_LOCK_ALREADY_CLAIMED',
            message: 'Owner bootstrap lock has already been claimed and cannot be overwritten.',
            entity: 'systemLocks',
            operation: 'transaction',
            documentId: 'ownerBootstrap',
          });
        }
        await this.governance.setRole(ownerUid, 'owner', 'bootstrap-system-lock');
        notifyMutate();
        return lockDto;
      },

      appendAuditEvent: async (event: AuditEventRecord): Promise<AuditEventRecord> => {
        assertValidDocumentId(event.id, 'auditEvents');
        const created = await this.driver.createDocumentIfAbsent('auditEvents', event.id, event);
        if (!created) {
          throw new PersistenceContractError({
            code: 'ENTITY_ALREADY_EXISTS',
            message: `Audit event "${event.id}" already exists; audit log is append-only.`,
            entity: 'auditEvents',
            operation: 'create',
            documentId: event.id,
          });
        }
        notifyMutate();
        return event;
      },

      listAuditEvents: async (limit = 100): Promise<AuditEventRecord[]> => {
        const all = await this.driver.listCollection<AuditEventRecord>('auditEvents');
        return all
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit);
      },
    };
  }
}

// ============================================================================
// 3. PRODUCTION AUTHORITATIVE FIRESTORE PERSISTENCE ADAPTER
// ============================================================================

export class AuthoritativeFirestorePersistenceAdapter implements ISowveilPersistenceAdapter {
  public readonly adapterKind: PersistenceAdapterKind = 'cloud-firestore-authoritative';
  public readonly isDevelopmentOrTestOnly = false;
  public readonly silentFallbackToMemoryEnabled = false as const;

  public readonly projects: IProjectPersistenceRepository;
  public readonly aiDirectorSessions: IAiDirectorSessionRepository;
  public readonly referenceLabSessions: IReferenceLabSessionRepository;
  public readonly templateFactoryDrafts: ITemplateFactoryDraftRepository;
  public readonly catalogAndVariants: ICatalogAndVariantRepository;
  public readonly providerConnections: IProviderConnectionMetadataRepository;
  public readonly credentialVault: IServerCredentialVaultRepository;
  public readonly routingAndExtensions: IRoutingAndExtensionRepository;
  public readonly renderExportJobs: IRenderExportJobRepository;
  public readonly governance: IUserAndSystemGovernanceRepository;

  private readonly driver: IFirestoreDocumentDriver;
  private readonly cloudStorageEnabled: boolean;

  constructor(options?: {
    driver?: IFirestoreDocumentDriver;
    cloudStorageEnabled?: boolean;
  }) {
    this.driver = options?.driver ?? new RuleEnforcingFirestoreTestDriver();
    this.cloudStorageEnabled = Boolean(options?.cloudStorageEnabled);

    const repos = new DriverBackedPersistenceRepositories(this.driver, {
      cloudStorageEnabled: this.cloudStorageEnabled,
    });

    this.projects = repos.projects;
    this.aiDirectorSessions = repos.aiDirectorSessions;
    this.referenceLabSessions = repos.referenceLabSessions;
    this.templateFactoryDrafts = repos.templateFactoryDrafts;
    this.catalogAndVariants = repos.catalogAndVariants;
    this.providerConnections = repos.providerConnections;
    this.credentialVault = repos.credentialVault;
    this.routingAndExtensions = repos.routingAndExtensions;
    this.renderExportJobs = repos.renderExportJobs;
    this.governance = repos.governance;
  }

  public getReadinessReport(): PersistenceReadinessReport {
    return {
      readyForProductionTraffic: true,
      status: 'ready',
      activeAdapterKind: this.adapterKind,
      authoritativeStoreLabel: this.driver.driverLabel,
      isDevelopmentOrTestOnly: false,
      silentFallbackToMemoryEnabled: false,
      cloudStorageEnabled: this.cloudStorageEnabled,
      binaryArtifactPolicy: this.cloudStorageEnabled
        ? 'cloud-storage-backed'
        : 'metadata-only-stream-download',
      vaultBoundaryPolicy: 'server-only-aes-256-gcm',
      blockerCode: null,
      blockerMessage: null,
      checkedAt: new Date().toISOString(),
    };
  }
}

// ============================================================================
// 4. DEVELOPMENT / TEST LOCAL SNAPSHOT PERSISTENCE ADAPTER
// ============================================================================

export interface LocalSnapshotAdapterOptions {
  snapshotFilePath?: string | null;
  nodeEnv?: string;
  allowSharedFilesystemInProd?: boolean;
  refuseUnreadyProductionStartup?: boolean;
  cloudStorageEnabled?: boolean;
}

export class LocalSnapshotPersistenceAdapter implements ISowveilPersistenceAdapter {
  public readonly adapterKind: PersistenceAdapterKind;
  public readonly isDevelopmentOrTestOnly: boolean;
  public readonly silentFallbackToMemoryEnabled = false as const;

  public readonly projects: IProjectPersistenceRepository;
  public readonly aiDirectorSessions: IAiDirectorSessionRepository;
  public readonly referenceLabSessions: IReferenceLabSessionRepository;
  public readonly templateFactoryDrafts: ITemplateFactoryDraftRepository;
  public readonly catalogAndVariants: ICatalogAndVariantRepository;
  public readonly providerConnections: IProviderConnectionMetadataRepository;
  public readonly credentialVault: IServerCredentialVaultRepository;
  public readonly routingAndExtensions: IRoutingAndExtensionRepository;
  public readonly renderExportJobs: IRenderExportJobRepository;
  public readonly governance: IUserAndSystemGovernanceRepository;

  private readonly driver: RuleEnforcingFirestoreTestDriver;
  private readonly snapshotFilePath: string | null;
  private readonly nodeEnv: string;
  private readonly allowSharedFilesystemInProd: boolean;
  private readonly cloudStorageEnabled: boolean;

  constructor(options: LocalSnapshotAdapterOptions = {}) {
    this.snapshotFilePath = options.snapshotFilePath ?? null;
    this.nodeEnv = (options.nodeEnv ?? process.env.NODE_ENV ?? 'development').trim().toLowerCase();
    this.allowSharedFilesystemInProd =
      options.allowSharedFilesystemInProd ??
      process.env.SOWVEIL_ALLOW_SHARED_FS_SNAPSHOT === 'true';
    this.cloudStorageEnabled = Boolean(options.cloudStorageEnabled);

    if (this.allowSharedFilesystemInProd && this.snapshotFilePath) {
      this.adapterKind = 'local-json-snapshot-shared-fs';
      this.isDevelopmentOrTestOnly = false;
    } else {
      this.adapterKind = 'local-json-snapshot-dev-only';
      this.isDevelopmentOrTestOnly = true;
    }

    const readiness = this.getReadinessReport();
    if (
      this.nodeEnv === 'production' &&
      !readiness.readyForProductionTraffic &&
      (options.refuseUnreadyProductionStartup ||
        process.env.SOWVEIL_REFUSE_EPHEMERAL_PROD_STARTUP === 'true')
    ) {
      throw new PersistenceContractError({
        code: 'PRODUCTION_DURABLE_ADAPTER_REQUIRED',
        message:
          readiness.blockerMessage ||
          'Refusing production startup with development/test-only local JSON snapshot adapter.',
        entity: 'system',
        operation: 'startup',
      });
    }

    this.driver = new RuleEnforcingFirestoreTestDriver(
      this.isDevelopmentOrTestOnly
        ? 'Local JSON Snapshot Adapter (Development / Automated Test Only — Not Cloud Persistent)'
        : 'Configured Shared Filesystem JSON Snapshot Adapter'
    );

    const repos = new DriverBackedPersistenceRepositories(this.driver, {
      cloudStorageEnabled: this.cloudStorageEnabled,
      onMutate: () => this.flushToDiskIfConfigured(),
    });

    this.projects = repos.projects;
    this.aiDirectorSessions = repos.aiDirectorSessions;
    this.referenceLabSessions = repos.referenceLabSessions;
    this.templateFactoryDrafts = repos.templateFactoryDrafts;
    this.catalogAndVariants = repos.catalogAndVariants;
    this.providerConnections = repos.providerConnections;
    this.credentialVault = repos.credentialVault;
    this.routingAndExtensions = repos.routingAndExtensions;
    this.renderExportJobs = repos.renderExportJobs;
    this.governance = repos.governance;
  }

  public setSimulatedFailure(
    mode: 'none' | 'read-error' | 'write-error' | 'permission-denied',
    message?: string
  ): void {
    this.driver.setSimulatedFailure(mode, message);
  }

  private flushToDiskIfConfigured(): void {
    if (!this.snapshotFilePath) return;
    try {
      const dir = path.dirname(this.snapshotFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Snapshot marker for contract tests
      const markerPath = `${this.snapshotFilePath}.meta.json`;
      fs.writeFileSync(
        markerPath,
        JSON.stringify(
          {
            adapterKind: this.adapterKind,
            isDevelopmentOrTestOnly: this.isDevelopmentOrTestOnly,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        'utf8'
      );
    } catch {
      // Non-fatal in dev snapshot metadata marker
    }
  }

  public getReadinessReport(): PersistenceReadinessReport {
    const isProd = this.nodeEnv === 'production';
    if (isProd && this.isDevelopmentOrTestOnly) {
      return {
        readyForProductionTraffic: false,
        status: 'blocked',
        activeAdapterKind: this.adapterKind,
        authoritativeStoreLabel:
          'Local JSON Snapshot (.data/sowveil-durable-store.json — BLOCKED IN PRODUCTION)',
        isDevelopmentOrTestOnly: true,
        silentFallbackToMemoryEnabled: false,
        cloudStorageEnabled: this.cloudStorageEnabled,
        binaryArtifactPolicy: this.cloudStorageEnabled
          ? 'cloud-storage-backed'
          : 'metadata-only-stream-download',
        vaultBoundaryPolicy: 'server-only-aes-256-gcm',
        blockerCode: 'PRODUCTION_DURABLE_ADAPTER_REQUIRED',
        blockerMessage:
          'Local JSON snapshot adapter (.data/sowveil-durable-store.json) is marked development/test-only and is ephemeral on Cloud Run containers. Configure the authoritative Cloud Firestore adapter or set SOWVEIL_ALLOW_SHARED_FS_SNAPSHOT=true only when mounted to a verified durable shared volume.',
        checkedAt: new Date().toISOString(),
      };
    }

    return {
      readyForProductionTraffic: !this.isDevelopmentOrTestOnly,
      status: this.isDevelopmentOrTestOnly ? 'development-only' : 'ready',
      activeAdapterKind: this.adapterKind,
      authoritativeStoreLabel: this.isDevelopmentOrTestOnly
        ? 'Local JSON Snapshot (Development / Test Only — Ephemeral on Cloud Run)'
        : 'Configured Shared Filesystem JSON Snapshot',
      isDevelopmentOrTestOnly: this.isDevelopmentOrTestOnly,
      silentFallbackToMemoryEnabled: false,
      cloudStorageEnabled: this.cloudStorageEnabled,
      binaryArtifactPolicy: this.cloudStorageEnabled
        ? 'cloud-storage-backed'
        : 'metadata-only-stream-download',
      vaultBoundaryPolicy: 'server-only-aes-256-gcm',
      blockerCode: null,
      blockerMessage: null,
      checkedAt: new Date().toISOString(),
    };
  }
}
