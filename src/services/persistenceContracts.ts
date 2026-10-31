import {
  AccountStatus,
  AssetMetadataRecord,
  AuditEventRecord,
  CatalogItem,
  DeviceRecord,
  JobRecord,
  ProjectCheckpointRecord,
  ProjectFileStatus,
  ProjectLibraryItem,
  TemplateVariantInstance,
  UserPreferences,
  UserRole,
} from '../types/sowveil';
import { AiDirectorSessionRecord } from './aiDirectorProductionEngine';
import { ReferenceLabSession } from './referenceLabEngine';
import {
  TemplateFactoryDraftRecord,
  TemplatePreferenceSignal,
  UserPreferenceConsentConfig,
} from './templateFactoryEngine';
import {
  EncryptedVaultCiphertext,
  ExtensionPackageRecord,
  HubProviderProtocol,
  HubTaskType,
  ProviderConnectionPublicView,
  ProviderConnectionRecord,
  TaskRoutingProfile,
  ToolExecutionAuditRecord,
  toPublicProviderConnectionView,
} from './providerHubEngine';
import { DurableRenderExportJobRecord } from './renderExportQaEngine';

// ============================================================================
// 1. PERSISTENCE ERROR TAXONOMY & INVARIANT GUARDS
// ============================================================================

export type PersistenceErrorCode =
  | 'IMMUTABLE_IDENTITY_VIOLATION'
  | 'IMMUTABLE_OWNER_VIOLATION'
  | 'IMMUTABLE_CREATED_AT_VIOLATION'
  | 'REVISION_CONFLICT'
  | 'ENTITY_NOT_FOUND'
  | 'ENTITY_ALREADY_EXISTS'
  | 'CROSS_USER_ACCESS_FORBIDDEN'
  | 'INVALID_DTO_PAYLOAD'
  | 'BINARY_MEDIA_IN_FIRESTORE_FORBIDDEN'
  | 'VAULT_SECRET_IN_PUBLIC_DTO_FORBIDDEN'
  | 'STORAGE_NOT_CONFIGURED'
  | 'PRODUCTION_DURABLE_ADAPTER_REQUIRED'
  | 'AUTHORITATIVE_STORE_WRITE_FAILED'
  | 'AUTHORITATIVE_STORE_READ_FAILED'
  | 'BOOTSTRAP_LOCK_ALREADY_CLAIMED';

export class PersistenceContractError extends Error {
  public readonly code: PersistenceErrorCode;
  public readonly entity: string;
  public readonly operation: 'create' | 'get' | 'list' | 'update' | 'delete' | 'startup' | 'transaction';
  public readonly documentId?: string;
  public readonly statusCode: number;
  public readonly retryable: boolean;

  constructor(params: {
    code: PersistenceErrorCode;
    message: string;
    entity: string;
    operation: 'create' | 'get' | 'list' | 'update' | 'delete' | 'startup' | 'transaction';
    documentId?: string;
    statusCode?: number;
    retryable?: boolean;
  }) {
    super(params.message);
    this.name = 'PersistenceContractError';
    this.code = params.code;
    this.entity = params.entity;
    this.operation = params.operation;
    this.documentId = params.documentId;
    this.statusCode =
      params.statusCode ??
      (params.code === 'ENTITY_NOT_FOUND'
        ? 404
        : params.code === 'REVISION_CONFLICT' ||
          params.code === 'ENTITY_ALREADY_EXISTS' ||
          params.code === 'BOOTSTRAP_LOCK_ALREADY_CLAIMED'
        ? 409
        : params.code === 'CROSS_USER_ACCESS_FORBIDDEN' ||
          params.code === 'IMMUTABLE_OWNER_VIOLATION' ||
          params.code === 'IMMUTABLE_IDENTITY_VIOLATION' ||
          params.code === 'IMMUTABLE_CREATED_AT_VIOLATION'
        ? 403
        : params.code === 'PRODUCTION_DURABLE_ADAPTER_REQUIRED' ||
          params.code === 'AUTHORITATIVE_STORE_WRITE_FAILED' ||
          params.code === 'AUTHORITATIVE_STORE_READ_FAILED'
        ? 503
        : 400);
    this.retryable = params.retryable ?? false;
  }
}

const VALID_FIRESTORE_ID_REGEX = /^[a-zA-Z0-9_\-]{1,128}$/;
const MAX_FIRESTORE_STRING_PAYLOAD_BYTES = 750_000; // Strictly under 1 MiB Firestore document cap

export function assertValidDocumentId(id: unknown, entity: string): string {
  if (typeof id !== 'string' || !VALID_FIRESTORE_ID_REGEX.test(id.trim())) {
    throw new PersistenceContractError({
      code: 'INVALID_DTO_PAYLOAD',
      message: `Invalid document ID "${String(id)}" for entity "${entity}". Must match /^[a-zA-Z0-9_\\-]{1,128}$/.`,
      entity,
      operation: 'create',
      documentId: typeof id === 'string' ? id : undefined,
    });
  }
  return id.trim();
}

export function assertImmutableIdentityFields(params: {
  entity: string;
  documentId: string;
  existing: { id: string; ownerUid?: string; createdAt?: string };
  incoming: { id?: string; ownerUid?: string; createdAt?: string };
}): void {
  const { entity, documentId, existing, incoming } = params;
  if (incoming.id !== undefined && incoming.id !== existing.id) {
    throw new PersistenceContractError({
      code: 'IMMUTABLE_IDENTITY_VIOLATION',
      message: `Cannot change immutable document ID on ${entity} "${documentId}" (attempted "${incoming.id}").`,
      entity,
      operation: 'update',
      documentId,
    });
  }
  if (
    existing.ownerUid !== undefined &&
    incoming.ownerUid !== undefined &&
    incoming.ownerUid !== existing.ownerUid
  ) {
    throw new PersistenceContractError({
      code: 'IMMUTABLE_OWNER_VIOLATION',
      message: `Cannot change immutable ownerUid on ${entity} "${documentId}".`,
      entity,
      operation: 'update',
      documentId,
    });
  }
  if (
    existing.createdAt !== undefined &&
    incoming.createdAt !== undefined &&
    incoming.createdAt !== existing.createdAt
  ) {
    throw new PersistenceContractError({
      code: 'IMMUTABLE_CREATED_AT_VIOLATION',
      message: `Cannot change immutable createdAt timestamp on ${entity} "${documentId}".`,
      entity,
      operation: 'update',
      documentId,
    });
  }
}

export function assertMonotonicRevision(params: {
  entity: string;
  documentId: string;
  existingRevision: number;
  expectedRevision?: number;
  incomingRevision?: number;
}): number {
  const { entity, documentId, existingRevision, expectedRevision, incomingRevision } = params;
  if (expectedRevision !== undefined && expectedRevision !== existingRevision) {
    throw new PersistenceContractError({
      code: 'REVISION_CONFLICT',
      message: `Optimistic concurrency conflict on ${entity} "${documentId}": expected revision ${expectedRevision}, but current revision is ${existingRevision}.`,
      entity,
      operation: 'update',
      documentId,
    });
  }
  if (incomingRevision !== undefined) {
    if (!Number.isInteger(incomingRevision) || incomingRevision < existingRevision) {
      throw new PersistenceContractError({
        code: 'REVISION_CONFLICT',
        message: `Revision regression forbidden on ${entity} "${documentId}": incoming revision ${incomingRevision} is less than existing revision ${existingRevision}.`,
        entity,
        operation: 'update',
        documentId,
      });
    }
    return incomingRevision;
  }
  return existingRevision + 1;
}

export function assertNoLocalBlobUrls(value: unknown, entity: string, documentId?: string): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  if (serialized.includes('blob:http:') || serialized.includes('blob:https:') || serialized.includes('"blob:')) {
    throw new PersistenceContractError({
      code: 'STORAGE_NOT_CONFIGURED',
      message: `Local browser blob: URLs cannot be persisted as authoritative cloud records on ${entity}.`,
      entity,
      operation: 'create',
      documentId,
    });
  }
}

// ============================================================================
// 2. EXPLICIT DTO CONTRACTS & SERIALIZERS / DESERIALIZERS PER ENTITY
// ============================================================================

export interface EntityMigrationMetadata {
  dtoSchemaVersion: string;
  migratedFromVersion?: string | null;
  migrationWarnings?: string[];
}

/**
 * 2.1 Projects & Canonical Project Revisions DTO
 */
export interface ProjectFirestoreDto {
  id: string;
  ownerUid: string;
  title: string;
  description: string;
  compCount: number | null;
  projectFileStatus: ProjectFileStatus;
  fileSizeBytes: number | null;
  fileSizeLabel: string;
  resolution?: string;
  durationLabel?: string;
  fps?: number;
  aeVersion?: string;
  targetEditor?: ProjectLibraryItem['targetEditor'];
  aspectRatio?: ProjectLibraryItem['aspectRatio'];
  sowveilSpecJson?: string;
  canonicalProjectJson?: string;
  revision: number;
  activeBranch?: string;
  checkpoints?: ProjectCheckpointRecord[];
  hasExternalFootageWarning: boolean;
  archived: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  migrationMetadata?: EntityMigrationMetadata;
}

export function serializeProjectToFirestoreDto(
  domain: ProjectLibraryItem,
  migrationMetadata?: EntityMigrationMetadata
): ProjectFirestoreDto {
  const id = assertValidDocumentId(domain.id, 'projects');
  const ownerUid = assertValidDocumentId(domain.ownerUid || '', 'projects.ownerUid');
  assertNoLocalBlobUrls({ title: domain.title, description: domain.description }, 'projects', id);

  if (
    domain.canonicalProjectJson &&
    Buffer.byteLength(domain.canonicalProjectJson, 'utf8') > MAX_FIRESTORE_STRING_PAYLOAD_BYTES
  ) {
    throw new PersistenceContractError({
      code: 'BINARY_MEDIA_IN_FIRESTORE_FORBIDDEN',
      message: `Project "${id}" canonicalProjectJson exceeds maximum structured document size. Binary media must not be embedded in Firestore.`,
      entity: 'projects',
      operation: 'create',
      documentId: id,
    });
  }

  const now = new Date().toISOString();
  const createdAt = domain.createdAt || domain.updatedAt || now;
  const updatedAt = domain.updatedAt || now;
  const revision =
    typeof domain.revision === 'number' && Number.isInteger(domain.revision) && domain.revision >= 1
      ? domain.revision
      : 1;

  const dto: ProjectFirestoreDto = {
    id,
    ownerUid,
    title: (domain.title || 'Untitled Project').trim().slice(0, 160),
    description: (domain.description || '').trim().slice(0, 2000),
    compCount: domain.compCount ?? null,
    projectFileStatus: domain.projectFileStatus || 'metadata-only',
    fileSizeBytes: domain.fileSizeBytes ?? null,
    fileSizeLabel: (domain.fileSizeLabel || 'Unknown (metadata-only)').slice(0, 80),
    ...(domain.resolution ? { resolution: domain.resolution.slice(0, 64) } : {}),
    ...(domain.durationLabel ? { durationLabel: domain.durationLabel.slice(0, 64) } : {}),
    ...(domain.fps !== undefined ? { fps: domain.fps } : {}),
    ...(domain.aeVersion ? { aeVersion: domain.aeVersion.slice(0, 64) } : {}),
    ...(domain.targetEditor ? { targetEditor: domain.targetEditor } : {}),
    ...(domain.aspectRatio ? { aspectRatio: domain.aspectRatio } : {}),
    ...(domain.sowveilSpecJson ? { sowveilSpecJson: domain.sowveilSpecJson } : {}),
    ...(domain.canonicalProjectJson ? { canonicalProjectJson: domain.canonicalProjectJson } : {}),
    revision,
    ...(domain.activeBranch ? { activeBranch: domain.activeBranch.slice(0, 64) } : {}),
    ...(domain.checkpoints ? { checkpoints: domain.checkpoints.slice(0, 20) } : {}),
    hasExternalFootageWarning: Boolean(domain.hasExternalFootageWarning),
    archived: Boolean(domain.archived),
    tags: Array.isArray(domain.tags)
      ? domain.tags.slice(0, 20).map((t) => String(t).slice(0, 64))
      : [],
    createdAt,
    updatedAt,
    ...(domain.lastOpenedAt ? { lastOpenedAt: domain.lastOpenedAt } : {}),
    ...(migrationMetadata ? { migrationMetadata } : {}),
  };

  return dto;
}

export function deserializeProjectFromFirestoreDto(
  dto: ProjectFirestoreDto
): { project: ProjectLibraryItem; migrationMetadata?: EntityMigrationMetadata } {
  const id = assertValidDocumentId(dto.id, 'projects');
  const ownerUid = assertValidDocumentId(dto.ownerUid, 'projects.ownerUid');

  const project: ProjectLibraryItem = {
    id,
    ownerUid,
    title: dto.title,
    description: dto.description || '',
    compCount: dto.compCount ?? null,
    projectFileStatus: dto.projectFileStatus || 'metadata-only',
    fileSizeBytes: dto.fileSizeBytes ?? null,
    fileSizeLabel: dto.fileSizeLabel || 'Unknown (metadata-only)',
    ...(dto.resolution ? { resolution: dto.resolution } : {}),
    ...(dto.durationLabel ? { durationLabel: dto.durationLabel } : {}),
    ...(dto.fps !== undefined ? { fps: dto.fps } : {}),
    ...(dto.aeVersion ? { aeVersion: dto.aeVersion } : {}),
    ...(dto.targetEditor ? { targetEditor: dto.targetEditor } : {}),
    ...(dto.aspectRatio ? { aspectRatio: dto.aspectRatio } : {}),
    ...(dto.sowveilSpecJson ? { sowveilSpecJson: dto.sowveilSpecJson } : {}),
    ...(dto.canonicalProjectJson ? { canonicalProjectJson: dto.canonicalProjectJson } : {}),
    revision: typeof dto.revision === 'number' && dto.revision >= 1 ? dto.revision : 1,
    ...(dto.activeBranch ? { activeBranch: dto.activeBranch } : {}),
    ...(dto.checkpoints ? { checkpoints: dto.checkpoints } : {}),
    hasExternalFootageWarning: Boolean(dto.hasExternalFootageWarning),
    archived: Boolean(dto.archived),
    tags: Array.isArray(dto.tags) ? [...dto.tags] : [],
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    ...(dto.lastOpenedAt ? { lastOpenedAt: dto.lastOpenedAt } : {}),
  };

  return {
    project,
    migrationMetadata: dto.migrationMetadata,
  };
}

/**
 * 2.2 AI Director Sessions DTO
 */
export type AiDirectorBlueprintState =
  | 'intake'
  | 'analyzing'
  | 'clarifying'
  | 'planning'
  | 'awaiting-approval'
  | 'producing'
  | 'refining'
  | 'completed'
  | 'failed';

function mapStageToBlueprintState(
  stage: AiDirectorSessionRecord['stage']
): AiDirectorBlueprintState {
  switch (stage) {
    case 'intake':
      return 'intake';
    case 'analysis-coverage':
      return 'analyzing';
    case 'questions-clarification':
      return 'clarifying';
    case 'brief-shot-plan':
      return 'planning';
    case 'production-execution':
      return 'producing';
    case 'adaptive-refinement':
      return 'refining';
    case 'acceptance-verified':
      return 'completed';
    default:
      return 'planning';
  }
}

export interface AiDirectorSessionFirestoreDto {
  id: string;
  ownerUid: string;
  title: string;
  state: AiDirectorBlueprintState;
  stage: AiDirectorSessionRecord['stage'];
  originalScriptSha256: string;
  createdAt: string;
  updatedAt: string;
  activeRevisionNumber: number;
  savedProjectId?: string;
  payloadJson: string; // Serialized complex nested structures while keeping top-level indexable fields
}

export function serializeAiDirectorSessionToDto(
  session: AiDirectorSessionRecord
): AiDirectorSessionFirestoreDto {
  const id = assertValidDocumentId(session.id, 'aiDirectorSessions');
  const ownerUid = assertValidDocumentId(session.ownerUid, 'aiDirectorSessions.ownerUid');
  const payloadJson = JSON.stringify(session);
  if (Buffer.byteLength(payloadJson, 'utf8') > MAX_FIRESTORE_STRING_PAYLOAD_BYTES) {
    throw new PersistenceContractError({
      code: 'BINARY_MEDIA_IN_FIRESTORE_FORBIDDEN',
      message: `AI Director session "${id}" exceeds maximum Firestore document size.`,
      entity: 'aiDirectorSessions',
      operation: 'create',
      documentId: id,
    });
  }
  const latestRevision =
    session.planRevisions && session.planRevisions.length > 0
      ? session.planRevisions[session.planRevisions.length - 1].revisionNumber
      : 1;
  const originalScriptSha256 =
    (session.analysisReport?.originalScriptSha256 || 'sha256_unverified').slice(0, 128);
  return {
    id,
    ownerUid,
    title: (session.intake?.title || 'AI Director Session').slice(0, 160),
    state: mapStageToBlueprintState(session.stage),
    stage: session.stage,
    originalScriptSha256:
      originalScriptSha256.length >= 8 ? originalScriptSha256 : 'sha256_unverified',
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    activeRevisionNumber: latestRevision,
    ...(session.savedProjectId ? { savedProjectId: session.savedProjectId } : {}),
    payloadJson,
  };
}

export function deserializeAiDirectorSessionFromDto(
  dto: AiDirectorSessionFirestoreDto
): AiDirectorSessionRecord {
  const parsed = JSON.parse(dto.payloadJson) as AiDirectorSessionRecord;
  return {
    ...parsed,
    id: dto.id,
    ownerUid: dto.ownerUid,
    stage: dto.stage || parsed.stage,
    ...(dto.savedProjectId ? { savedProjectId: dto.savedProjectId } : {}),
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

/**
 * 2.3 Reference Lab Sessions DTO
 */
export interface ReferenceLabSessionFirestoreDto {
  id: string;
  ownerUid: string;
  title: string;
  sourceKind: ReferenceLabSession['sourceKind'];
  usageMode: ReferenceLabSession['rightsDeclaration']['usageMode'];
  mediaAnalysisState?: ReferenceLabSession['mediaSpecs']['mediaAnalysisState'];
  sourceMediaParsed?: boolean;
  savedProjectId?: string;
  savedDraftTemplateId?: string;
  promotedValidatedTemplateId?: string;
  createdAt: string;
  updatedAt: string;
  payloadJson: string;
}

export function serializeReferenceLabSessionToDto(
  session: ReferenceLabSession
): ReferenceLabSessionFirestoreDto {
  const id = assertValidDocumentId(session.id, 'referenceLabSessions');
  const ownerUid = assertValidDocumentId(session.ownerUid, 'referenceLabSessions.ownerUid');
  const payloadJson = JSON.stringify(session);
  if (Buffer.byteLength(payloadJson, 'utf8') > MAX_FIRESTORE_STRING_PAYLOAD_BYTES) {
    throw new PersistenceContractError({
      code: 'BINARY_MEDIA_IN_FIRESTORE_FORBIDDEN',
      message: `Reference Lab session "${id}" exceeds maximum Firestore document size.`,
      entity: 'referenceLabSessions',
      operation: 'create',
      documentId: id,
    });
  }
  return {
    id,
    ownerUid,
    title: (session.title || 'Reference Lab Session').slice(0, 160),
    sourceKind: session.sourceKind,
    usageMode: session.rightsDeclaration.usageMode,
    mediaAnalysisState: session.mediaSpecs?.mediaAnalysisState || 'verified-preset',
    sourceMediaParsed: Boolean(session.mediaSpecs?.sourceMediaParsed),
    ...(session.savedProjectId ? { savedProjectId: session.savedProjectId } : {}),
    ...(session.savedDraftTemplateId
      ? { savedDraftTemplateId: session.savedDraftTemplateId }
      : {}),
    ...(session.promotedValidatedTemplateId
      ? { promotedValidatedTemplateId: session.promotedValidatedTemplateId }
      : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    payloadJson,
  };
}

export function deserializeReferenceLabSessionFromDto(
  dto: ReferenceLabSessionFirestoreDto
): ReferenceLabSession {
  const parsed = JSON.parse(dto.payloadJson) as ReferenceLabSession;
  return {
    ...parsed,
    id: dto.id,
    ownerUid: dto.ownerUid,
    title: dto.title,
    sourceKind: dto.sourceKind || parsed.sourceKind,
    ...(dto.savedProjectId ? { savedProjectId: dto.savedProjectId } : {}),
    ...(dto.savedDraftTemplateId ? { savedDraftTemplateId: dto.savedDraftTemplateId } : {}),
    ...(dto.promotedValidatedTemplateId
      ? { promotedValidatedTemplateId: dto.promotedValidatedTemplateId }
      : {}),
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

/**
 * 2.4 Template Factory Drafts DTO
 */
export interface TemplateFactoryDraftFirestoreDto {
  id: string;
  ownerUid: string;
  title: string;
  sourceKind: TemplateFactoryDraftRecord['sourceKind'];
  provenanceClassification: TemplateFactoryDraftRecord['provenanceClassification'];
  version: string;
  publishedToCatalog: boolean;
  publishedCatalogItemId?: string;
  publishedVersion?: string;
  publishedAt?: string;
  originProjectId?: string;
  originProjectRevision?: number;
  originReferenceSessionId?: string;
  createdAt: string;
  updatedAt: string;
  payloadJson: string;
}

export function serializeTemplateFactoryDraftToDto(
  draft: TemplateFactoryDraftRecord
): TemplateFactoryDraftFirestoreDto {
  const id = assertValidDocumentId(draft.id, 'templateFactoryDrafts');
  const ownerUid = assertValidDocumentId(draft.ownerUid, 'templateFactoryDrafts.ownerUid');
  const payloadJson = JSON.stringify(draft);
  if (Buffer.byteLength(payloadJson, 'utf8') > MAX_FIRESTORE_STRING_PAYLOAD_BYTES) {
    throw new PersistenceContractError({
      code: 'BINARY_MEDIA_IN_FIRESTORE_FORBIDDEN',
      message: `Template Factory draft "${id}" exceeds maximum Firestore document size.`,
      entity: 'templateFactoryDrafts',
      operation: 'create',
      documentId: id,
    });
  }
  return {
    id,
    ownerUid,
    title: (draft.title || 'Untitled Draft').slice(0, 160),
    sourceKind: draft.sourceKind,
    provenanceClassification: draft.provenanceClassification,
    version: draft.version || '1.0.0',
    publishedToCatalog: Boolean(draft.publishedToCatalog),
    ...(draft.publishedCatalogItemId
      ? { publishedCatalogItemId: draft.publishedCatalogItemId }
      : {}),
    ...(draft.publishedVersion ? { publishedVersion: draft.publishedVersion } : {}),
    ...(draft.publishedAt ? { publishedAt: draft.publishedAt } : {}),
    ...(draft.originProjectId ? { originProjectId: draft.originProjectId } : {}),
    ...(draft.originProjectRevision !== undefined
      ? { originProjectRevision: draft.originProjectRevision }
      : {}),
    ...(draft.originReferenceSessionId
      ? { originReferenceSessionId: draft.originReferenceSessionId }
      : {}),
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    payloadJson,
  };
}

export function deserializeTemplateFactoryDraftFromDto(
  dto: TemplateFactoryDraftFirestoreDto
): TemplateFactoryDraftRecord {
  const parsed = JSON.parse(dto.payloadJson) as TemplateFactoryDraftRecord;
  return {
    ...parsed,
    id: dto.id,
    ownerUid: dto.ownerUid,
    title: dto.title,
    sourceKind: dto.sourceKind,
    provenanceClassification: dto.provenanceClassification,
    version: dto.version,
    publishedToCatalog: dto.publishedToCatalog,
    ...(dto.publishedCatalogItemId
      ? { publishedCatalogItemId: dto.publishedCatalogItemId }
      : {}),
    ...(dto.publishedVersion ? { publishedVersion: dto.publishedVersion } : {}),
    ...(dto.publishedAt ? { publishedAt: dto.publishedAt } : {}),
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

/**
 * 2.5 Provider Connection Metadata DTO (Firestore-safe) & Server Vault Secret DTO (Server-only)
 * CRITICAL INVARIANT: Raw keys and encryptedVaultCiphertext NEVER enter ProviderConnectionMetadataFirestoreDto.
 */
export type ProviderConnectionMetadataFirestoreDto = ProviderConnectionPublicView;

export interface ServerCredentialVaultRecordDto {
  connectionId: string;
  ownerUid: string;
  workspaceId: string;
  protocol: HubProviderProtocol;
  encryptedCredential: EncryptedVaultCiphertext;
  keyVersion: number;
  updatedAt: string;
}

export function serializeProviderConnectionSplitDto(
  record: ProviderConnectionRecord
): {
  metadataDto: ProviderConnectionMetadataFirestoreDto;
  vaultSecretDto: ServerCredentialVaultRecordDto | null;
} {
  const id = assertValidDocumentId(record.id, 'providerConnections');
  const ownerUid = assertValidDocumentId(record.ownerUid, 'providerConnections.ownerUid');

  // Ensure no raw credential field was smuggled onto the record
  const rawCheck = record as unknown as Record<string, unknown>;
  if ('apiKey' in rawCheck || 'rawSecret' in rawCheck || 'plaintextSecret' in rawCheck) {
    throw new PersistenceContractError({
      code: 'VAULT_SECRET_IN_PUBLIC_DTO_FORBIDDEN',
      message: `Plaintext credential fields are strictly forbidden on ProviderConnectionRecord "${id}".`,
      entity: 'providerConnections',
      operation: 'create',
      documentId: id,
    });
  }

  const metadataDto = toPublicProviderConnectionView({
    ...record,
    id,
    ownerUid,
  });

  // Double-check that encryptedCredential is never present on metadataDto
  if ('encryptedCredential' in (metadataDto as unknown as Record<string, unknown>)) {
    delete (metadataDto as unknown as Record<string, unknown>).encryptedCredential;
  }

  const vaultSecretDto: ServerCredentialVaultRecordDto | null = record.encryptedCredential
    ? {
        connectionId: id,
        ownerUid,
        workspaceId: record.workspaceId || `ws_${ownerUid}`,
        protocol: record.protocol,
        encryptedCredential: record.encryptedCredential,
        keyVersion: record.keyVersion || 1,
        updatedAt: record.updatedAt,
      }
    : null;

  return { metadataDto, vaultSecretDto };
}

export function deserializeProviderConnectionFromSplitDto(
  metadataDto: ProviderConnectionMetadataFirestoreDto,
  vaultSecretDto?: ServerCredentialVaultRecordDto | null
): ProviderConnectionRecord {
  return {
    ...metadataDto,
    encryptedCredential: vaultSecretDto?.encryptedCredential ?? null,
  };
}

/**
 * 2.6 Render/Export Jobs DTO
 * CRITICAL INVARIANT: Binary media (`artifactBytesBase64`) is NEVER serialized into Firestore documents.
 */
export interface RenderExportJobFirestoreDto {
  id: string;
  ownerUid: string;
  projectId: string;
  stage: DurableRenderExportJobRecord['stage'];
  executionTier: DurableRenderExportJobRecord['executionTier'];
  outputFormat: DurableRenderExportJobRecord['outputFormat'];
  targetAdapter: DurableRenderExportJobRecord['targetAdapter'];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  storagePersistenceMode: 'metadata-only-ephemeral' | 'cloud-storage-backed';
  jobMetadataJson: string; // Excludes artifactBytesBase64
}

export function serializeRenderExportJobToFirestoreDto(
  job: DurableRenderExportJobRecord,
  cloudStorageEnabled = false
): RenderExportJobFirestoreDto {
  const id = assertValidDocumentId(job.id, 'renderExportJobs');
  const ownerUid = assertValidDocumentId(job.ownerUid, 'renderExportJobs.ownerUid');

  // Strip binary artifact bytes before serializing to Firestore DTO
  const { artifactBytesBase64: _strippedBinary, ...metadataOnlyJob } = job;
  const jobMetadataJson = JSON.stringify(metadataOnlyJob);

  if (Buffer.byteLength(jobMetadataJson, 'utf8') > MAX_FIRESTORE_STRING_PAYLOAD_BYTES) {
    throw new PersistenceContractError({
      code: 'BINARY_MEDIA_IN_FIRESTORE_FORBIDDEN',
      message: `Render/Export job "${id}" metadata exceeds Firestore document size limit.`,
      entity: 'renderExportJobs',
      operation: 'create',
      documentId: id,
    });
  }

  return {
    id,
    ownerUid,
    projectId: job.projectId,
    stage: job.stage,
    executionTier: job.executionTier,
    outputFormat: job.outputFormat,
    targetAdapter: job.targetAdapter,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt ?? null,
    storagePersistenceMode: cloudStorageEnabled ? 'cloud-storage-backed' : 'metadata-only-ephemeral',
    jobMetadataJson,
  };
}

export function deserializeRenderExportJobFromFirestoreDto(
  dto: RenderExportJobFirestoreDto,
  transientArtifactBytesBase64?: string | null
): DurableRenderExportJobRecord {
  const parsed = JSON.parse(dto.jobMetadataJson) as Omit<
    DurableRenderExportJobRecord,
    'artifactBytesBase64'
  >;
  return {
    ...parsed,
    id: dto.id,
    ownerUid: dto.ownerUid,
    stage: dto.stage,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    completedAt: dto.completedAt,
    artifactBytesBase64: transientArtifactBytesBase64 ?? null,
  };
}

/**
 * 2.7 Owner Bootstrap Lock DTO (`/systemLocks/ownerBootstrap`)
 */
export interface OwnerBootstrapLockDto {
  id: 'ownerBootstrap';
  bootstrapped: boolean;
  ownerUid: string;
  lockedAt: string;
  environment: string;
}

// ============================================================================
// 3. REPOSITORY INTERFACES PER PERSISTENCE CONCERN
// ============================================================================

export interface IProjectPersistenceRepository {
  create(
    project: ProjectLibraryItem,
    migrationMetadata?: EntityMigrationMetadata
  ): Promise<ProjectLibraryItem>;
  getById(id: string, requesterUid: string, isAdmin?: boolean): Promise<ProjectLibraryItem | null>;
  listByOwner(ownerUid: string): Promise<ProjectLibraryItem[]>;
  update(
    id: string,
    requesterUid: string,
    patch: Partial<ProjectLibraryItem>,
    options?: { expectedRevision?: number; isAdmin?: boolean }
  ): Promise<ProjectLibraryItem>;
  delete(id: string, requesterUid: string, isAdmin?: boolean): Promise<boolean>;
}

export interface IAiDirectorSessionRepository {
  save(session: AiDirectorSessionRecord): Promise<AiDirectorSessionRecord>;
  getById(id: string, requesterUid: string, isAdmin?: boolean): Promise<AiDirectorSessionRecord | null>;
  listByOwner(ownerUid: string): Promise<AiDirectorSessionRecord[]>;
  delete(id: string, requesterUid: string): Promise<boolean>;
}

export interface IReferenceLabSessionRepository {
  save(session: ReferenceLabSession): Promise<ReferenceLabSession>;
  getById(id: string, requesterUid: string, isAdmin?: boolean): Promise<ReferenceLabSession | null>;
  listByOwner(ownerUid: string): Promise<ReferenceLabSession[]>;
  delete(id: string, requesterUid: string): Promise<boolean>;
}

export interface ITemplateFactoryDraftRepository {
  save(draft: TemplateFactoryDraftRecord): Promise<TemplateFactoryDraftRecord>;
  getById(id: string, requesterUid: string, isAdmin?: boolean): Promise<TemplateFactoryDraftRecord | null>;
  listByOwner(ownerUid: string): Promise<TemplateFactoryDraftRecord[]>;
  delete(id: string, requesterUid: string): Promise<boolean>;
  publishDraftToCatalog(
    draft: TemplateFactoryDraftRecord,
    catalogItem: CatalogItem
  ): Promise<{
    draft: TemplateFactoryDraftRecord;
    catalogItem: CatalogItem;
    idempotentNoOp: boolean;
  }>;
  getPreferenceConsent(ownerUid: string): Promise<UserPreferenceConsentConfig | null>;
  savePreferenceConsent(
    consent: UserPreferenceConsentConfig
  ): Promise<UserPreferenceConsentConfig>;
  listPreferenceSignals(ownerUid: string): Promise<TemplatePreferenceSignal[]>;
  savePreferenceSignals(
    ownerUid: string,
    signals: TemplatePreferenceSignal[]
  ): Promise<TemplatePreferenceSignal[]>;
}

export interface ICatalogAndVariantRepository {
  saveCatalogItem(item: CatalogItem): Promise<CatalogItem>;
  getCatalogItemById(id: string): Promise<CatalogItem | null>;
  listCatalogItems(): Promise<CatalogItem[]>;
  deleteCatalogItem(id: string): Promise<boolean>;
  saveVariant(variant: TemplateVariantInstance): Promise<TemplateVariantInstance>;
  getVariantById(id: string, requesterUid: string): Promise<TemplateVariantInstance | null>;
  listVariantsByOwner(ownerUid: string, baseTemplateId?: string): Promise<TemplateVariantInstance[]>;
  deleteVariant(id: string, requesterUid: string): Promise<boolean>;
}

export interface IProviderConnectionMetadataRepository {
  saveMetadata(
    record: ProviderConnectionRecord
  ): Promise<ProviderConnectionMetadataFirestoreDto>;
  getMetadataById(
    id: string,
    requesterUid: string,
    isAdmin?: boolean
  ): Promise<ProviderConnectionMetadataFirestoreDto | null>;
  listMetadataByOwner(ownerUid: string): Promise<ProviderConnectionMetadataFirestoreDto[]>;
  deleteMetadata(id: string, requesterUid: string): Promise<boolean>;
}

/**
 * Server-only encrypted vault repository.
 * NEVER exposed to browser clients or public Firestore rules.
 */
export interface IServerCredentialVaultRepository {
  saveVaultSecret(secretRecord: ServerCredentialVaultRecordDto): Promise<void>;
  getVaultSecret(
    connectionId: string,
    ownerUid: string
  ): Promise<ServerCredentialVaultRecordDto | null>;
  deleteVaultSecret(connectionId: string, ownerUid: string): Promise<boolean>;
  purgeAllForOwner(ownerUid: string): Promise<number>;
}

export interface IRoutingAndExtensionRepository {
  saveRoutingProfiles(
    ownerUid: string,
    profiles: Record<HubTaskType, TaskRoutingProfile>
  ): Promise<Record<HubTaskType, TaskRoutingProfile>>;
  getRoutingProfiles(
    ownerUid: string
  ): Promise<Record<HubTaskType, TaskRoutingProfile> | null>;
  saveExtension(ext: ExtensionPackageRecord): Promise<ExtensionPackageRecord>;
  listExtensionsByOwner(ownerUid: string): Promise<ExtensionPackageRecord[]>;
  deleteExtension(id: string, requesterUid: string): Promise<boolean>;
  appendToolAudit(record: ToolExecutionAuditRecord): Promise<ToolExecutionAuditRecord>;
  listToolAuditsByOwner(ownerUid: string): Promise<ToolExecutionAuditRecord[]>;
}

export interface IRenderExportJobRepository {
  saveJob(
    job: DurableRenderExportJobRecord,
    options?: { cloudStorageEnabled?: boolean }
  ): Promise<DurableRenderExportJobRecord>;
  getJobById(
    id: string,
    requesterUid: string,
    isAdmin?: boolean
  ): Promise<DurableRenderExportJobRecord | null>;
  listJobsByOwner(ownerUid: string): Promise<DurableRenderExportJobRecord[]>;
  deleteJob(id: string, requesterUid: string): Promise<boolean>;
}

export interface IUserAndSystemGovernanceRepository {
  getPreferences(uid: string): Promise<UserPreferences | null>;
  savePreferences(uid: string, prefs: UserPreferences): Promise<UserPreferences>;
  getFavorites(uid: string): Promise<string[]>;
  addFavorite(uid: string, itemId: string): Promise<string[]>;
  removeFavorite(uid: string, itemId: string): Promise<string[]>;
  getRole(uid: string): Promise<UserRole>;
  setRole(uid: string, role: UserRole, grantedByUid: string): Promise<void>;
  getAccountStatus(uid: string): Promise<AccountStatus>;
  setAccountStatus(uid: string, status: AccountStatus): Promise<void>;
  getOwnerBootstrapLock(): Promise<OwnerBootstrapLockDto | null>;
  claimOwnerBootstrapLock(ownerUid: string, environment: string): Promise<OwnerBootstrapLockDto>;
  appendAuditEvent(event: AuditEventRecord): Promise<AuditEventRecord>;
  listAuditEvents(limit?: number): Promise<AuditEventRecord[]>;
}

// ============================================================================
// 4. ADAPTER CLASSIFICATION, READINESS & SANITIZED DIAGNOSTICS
// ============================================================================

export type PersistenceAdapterKind =
  | 'cloud-firestore-authoritative'
  | 'local-json-snapshot-dev-only'
  | 'local-json-snapshot-shared-fs';

export interface PersistenceReadinessReport {
  readyForProductionTraffic: boolean;
  status: 'ready' | 'development-only' | 'blocked';
  activeAdapterKind: PersistenceAdapterKind;
  authoritativeStoreLabel: string;
  isDevelopmentOrTestOnly: boolean;
  silentFallbackToMemoryEnabled: false; // Invariant: always false
  cloudStorageEnabled: boolean;
  binaryArtifactPolicy: 'metadata-only-stream-download' | 'cloud-storage-backed';
  vaultBoundaryPolicy: 'server-only-aes-256-gcm';
  blockerCode: PersistenceErrorCode | null;
  blockerMessage: string | null;
  checkedAt: string;
}

export interface ISowveilPersistenceAdapter {
  readonly adapterKind: PersistenceAdapterKind;
  readonly isDevelopmentOrTestOnly: boolean;
  readonly silentFallbackToMemoryEnabled: false;

  readonly projects: IProjectPersistenceRepository;
  readonly aiDirectorSessions: IAiDirectorSessionRepository;
  readonly referenceLabSessions: IReferenceLabSessionRepository;
  readonly templateFactoryDrafts: ITemplateFactoryDraftRepository;
  readonly catalogAndVariants: ICatalogAndVariantRepository;
  readonly providerConnections: IProviderConnectionMetadataRepository;
  readonly credentialVault: IServerCredentialVaultRepository;
  readonly routingAndExtensions: IRoutingAndExtensionRepository;
  readonly renderExportJobs: IRenderExportJobRepository;
  readonly governance: IUserAndSystemGovernanceRepository;

  getReadinessReport(): PersistenceReadinessReport;
}
