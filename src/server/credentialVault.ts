import crypto from 'node:crypto';
import {
  EncryptedVaultCiphertext,
  HubProviderProtocol,
  ProviderConnectionPublicView,
  ProviderConnectionRecord,
} from '../types/providerHub';

export type VaultErrorCode =
  | 'VAULT_MASTER_KEY_NOT_CONFIGURED'
  | 'VAULT_KEY_CONFIG_CONFLICT'
  | 'VAULT_COMPROMISED_FALLBACK_FORBIDDEN'
  | 'VAULT_KEY_TOO_SHORT'
  | 'VAULT_DECRYPTION_FAILED'
  | 'VAULT_SCOPE_MISMATCH'
  | 'VAULT_EMPTY_SECRET'
  | 'CREDENTIAL_REENTRY_REQUIRED';

export class VaultConfigurationError extends Error {
  public readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = 'VaultConfigurationError';
    this.code = code;
  }
}

/**
 * SHA-256 digest of the retired public fallback string that existed prior to Phase 1A.
 * Used strictly to reject accidental configuration of the retired fallback secret without
 * keeping the retired literal in active key derivation code.
 */
const RETIRED_PUBLIC_FALLBACK_SHA256_HEX =
  '2f562939cf695272590992f32f28eb77f62c7426466d5c5042874957e508257b';

function isRetiredPublicFallbackValue(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  const digest = crypto.createHash('sha256').update(trimmed, 'utf8').digest('hex');
  return (
    digest === RETIRED_PUBLIC_FALLBACK_SHA256_HEX ||
    trimmed.toLowerCase().includes('sowveil-studio-server-vault-key-2026')
  );
}

export interface ResolvedVaultKeyConfig {
  sourceEnvVar: 'SOWVEIL_MASTER_VAULT_KEY' | 'SOWVEIL_VAULT_KEY' | 'explicit-override';
  keyBytes: Buffer;
}

export function resolveVaultKeyConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  explicitMasterKeyOverride?: string
): ResolvedVaultKeyConfig {
  if (typeof explicitMasterKeyOverride === 'string') {
    const trimmedOverride = explicitMasterKeyOverride.trim();
    if (!trimmedOverride) {
      throw new VaultConfigurationError(
        'VAULT_MASTER_KEY_NOT_CONFIGURED',
        'SOWVEIL_MASTER_VAULT_KEY is empty. Configure a strong secret before encrypting or decrypting credentials.'
      );
    }
    if (isRetiredPublicFallbackValue(trimmedOverride)) {
      throw new VaultConfigurationError(
        'VAULT_COMPROMISED_FALLBACK_FORBIDDEN',
        'The retired public fallback vault key is forbidden and cannot be used as a vault master secret.'
      );
    }
    if (trimmedOverride.length < 16) {
      throw new VaultConfigurationError(
        'VAULT_KEY_TOO_SHORT',
        'Vault master secret must be at least 16 characters long.'
      );
    }
    return {
      sourceEnvVar: 'explicit-override',
      keyBytes: crypto.createHash('sha256').update(trimmedOverride, 'utf8').digest(),
    };
  }

  const canonicalRaw =
    typeof env.SOWVEIL_MASTER_VAULT_KEY === 'string' ? env.SOWVEIL_MASTER_VAULT_KEY.trim() : '';
  const legacyRaw =
    typeof env.SOWVEIL_VAULT_KEY === 'string' ? env.SOWVEIL_VAULT_KEY.trim() : '';

  if (canonicalRaw && legacyRaw && canonicalRaw !== legacyRaw) {
    throw new VaultConfigurationError(
      'VAULT_KEY_CONFIG_CONFLICT',
      'Conflicting vault key configuration detected: both SOWVEIL_MASTER_VAULT_KEY and legacy SOWVEIL_VAULT_KEY are set with different values. Remove SOWVEIL_VAULT_KEY or set both to the exact same value.'
    );
  }

  const effectiveSecret = canonicalRaw || legacyRaw;
  const sourceEnvVar: 'SOWVEIL_MASTER_VAULT_KEY' | 'SOWVEIL_VAULT_KEY' = canonicalRaw
    ? 'SOWVEIL_MASTER_VAULT_KEY'
    : 'SOWVEIL_VAULT_KEY';

  if (!effectiveSecret) {
    throw new VaultConfigurationError(
      'VAULT_MASTER_KEY_NOT_CONFIGURED',
      'Credential vault master key is not configured. Set SOWVEIL_MASTER_VAULT_KEY in the server environment before storing or using encrypted provider credentials.'
    );
  }

  if (isRetiredPublicFallbackValue(effectiveSecret)) {
    throw new VaultConfigurationError(
      'VAULT_COMPROMISED_FALLBACK_FORBIDDEN',
      'The retired public fallback vault key is forbidden and cannot be used as SOWVEIL_MASTER_VAULT_KEY or SOWVEIL_VAULT_KEY.'
    );
  }

  if (effectiveSecret.length < 16) {
    throw new VaultConfigurationError(
      'VAULT_KEY_TOO_SHORT',
      `${sourceEnvVar} must be at least 16 characters long.`
    );
  }

  return {
    sourceEnvVar,
    keyBytes: crypto.createHash('sha256').update(effectiveSecret, 'utf8').digest(),
  };
}

export function getVaultConfigurationDiagnostics(env: NodeJS.ProcessEnv = process.env): {
  configured: boolean;
  sourceEnvVar: 'SOWVEIL_MASTER_VAULT_KEY' | 'SOWVEIL_VAULT_KEY' | null;
  errorCode: VaultErrorCode | null;
  message: string;
} {
  try {
    const resolved = resolveVaultKeyConfiguration(env);
    return {
      configured: true,
      sourceEnvVar:
        resolved.sourceEnvVar === 'explicit-override'
          ? 'SOWVEIL_MASTER_VAULT_KEY'
          : resolved.sourceEnvVar,
      errorCode: null,
      message: `Credential vault active using ${resolved.sourceEnvVar} (AES-256-GCM with AAD scope binding).`,
    };
  } catch (err: any) {
    const code: VaultErrorCode =
      err instanceof VaultConfigurationError ? err.code : 'VAULT_MASTER_KEY_NOT_CONFIGURED';
    return {
      configured: false,
      sourceEnvVar: null,
      errorCode: code,
      message: err?.message || 'Credential vault master key is not configured.',
    };
  }
}

export function buildVaultAadScope(params: {
  ownerUid: string;
  workspaceId: string;
  connectionId: string;
  protocol: HubProviderProtocol;
}): string {
  return `${params.ownerUid}:${params.workspaceId}:${params.connectionId}:${params.protocol}`;
}

export function encryptCredentialForVault(
  rawSecret: string,
  scopeParams: {
    ownerUid: string;
    workspaceId: string;
    connectionId: string;
    protocol: HubProviderProtocol;
  },
  keyVersion = 1,
  explicitMasterKeyOverride?: string
): EncryptedVaultCiphertext {
  const trimmed = typeof rawSecret === 'string' ? rawSecret.trim() : '';
  if (!trimmed) {
    throw new VaultConfigurationError(
      'VAULT_EMPTY_SECRET',
      'Cannot encrypt an empty credential into the server vault.'
    );
  }

  const { keyBytes } = resolveVaultKeyConfiguration(process.env, explicitMasterKeyOverride);
  const iv = crypto.randomBytes(12);
  const aadScope = buildVaultAadScope(scopeParams);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes, iv);
  cipher.setAAD(Buffer.from(aadScope, 'utf8'));

  const encrypted = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    algorithm: 'aes-256-gcm',
    ivHex: iv.toString('hex'),
    authTagHex: authTag.toString('hex'),
    ciphertextHex: encrypted.toString('hex'),
    aadScope,
    keyVersion,
    encryptedAt: new Date().toISOString(),
  };
}

export function decryptCredentialFromVault(
  vaultRecord: EncryptedVaultCiphertext,
  expectedScopeParams: {
    ownerUid: string;
    workspaceId: string;
    connectionId: string;
    protocol: HubProviderProtocol;
  },
  explicitMasterKeyOverride?: string
): string {
  const expectedAad = buildVaultAadScope(expectedScopeParams);
  if (vaultRecord.aadScope !== expectedAad) {
    throw new VaultConfigurationError(
      'VAULT_SCOPE_MISMATCH',
      'VAULT_SCOPE_MISMATCH: Credential AAD scope does not match requesting user/workspace/adapter.'
    );
  }

  const { keyBytes } = resolveVaultKeyConfiguration(process.env, explicitMasterKeyOverride);

  try {
    const iv = Buffer.from(vaultRecord.ivHex, 'hex');
    const authTag = Buffer.from(vaultRecord.authTagHex, 'hex');
    const ciphertext = Buffer.from(vaultRecord.ciphertextHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes, iv);
    decipher.setAAD(Buffer.from(expectedAad, 'utf8'));
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err: any) {
    if (err instanceof VaultConfigurationError) {
      throw err;
    }
    throw new VaultConfigurationError(
      'VAULT_DECRYPTION_FAILED',
      'Vault credential decryption failed under the active master key (invalid key, rotated secret, or tampered ciphertext).'
    );
  }
}

export function maskSecretCredential(secret?: string | null): string {
  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    return 'unconfigured';
  }
  const trimmed = secret.trim();
  if (trimmed.length <= 8) {
    return '••••••••';
  }
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

export function computeCredentialFingerprint(secret?: string | null): string | null {
  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    return null;
  }
  return `sha256:${crypto
    .createHash('sha256')
    .update(secret.trim(), 'utf8')
    .digest('hex')
    .slice(0, 12)}`;
}

export function redactSecretsFromText(
  input: string | null | undefined,
  knownRawSecrets: string[] = []
): string {
  if (!input) return '';
  let text = String(input);

  for (const raw of knownRawSecrets) {
    if (raw && raw.trim().length >= 4) {
      const escaped = raw.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(escaped, 'g'), '[REDACTED_CREDENTIAL]');
    }
  }

  text = text
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_GEMINI_KEY]')
    .replace(/sk-ant-[0-9A-Za-z\-_]{12,}/g, '[REDACTED_ANTHROPIC_KEY]')
    .replace(/sk-[0-9A-Za-z\-_]{12,}/g, '[REDACTED_OPENAI_KEY]')
    .replace(/ghp_[0-9A-Za-z]{20,}/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/([?&](?:key|api_key|access_token)=)[^&\s]+/gi, '$1[REDACTED_KEY]')
    .replace(
      /(["']?(?:x-api-key|api-key|authorization|x-goog-api-key)["']?\s*:\s*["'])[^"']+(["'])/gi,
      '$1[REDACTED_HEADER_SECRET]$2'
    );

  return text;
}

export function toPublicProviderConnectionView(
  record: ProviderConnectionRecord
): ProviderConnectionPublicView {
  const { encryptedCredential: _omitted, ...publicRest } = record;
  return publicRest;
}

/**
 * Protects existing persisted ProviderConnectionRecord items on server startup or store load.
 * - Never discards or overwrites existing connection records or their metadata.
 * - Never uses the retired public fallback key to decrypt credentials for outbound requests.
 * - When a stored record has an encryptedCredential that cannot be decrypted with the active
 *   SOWVEIL_MASTER_VAULT_KEY (e.g., encrypted under a retired/previous key or when the master key
 *   is not yet configured), transitions `credentialStatus` to `'requires-reentry'` with a sanitized
 *   diagnostic so the user can rotate/re-enter their key without losing connection or routing state.
 */
export function inspectPersistedConnectionVaultHealth(
  record: ProviderConnectionRecord,
  env: NodeJS.ProcessEnv = process.env
): ProviderConnectionRecord {
  if (
    !record.encryptedCredential ||
    record.authMode === 'server-env' ||
    record.credentialStatus === 'revoked'
  ) {
    return record;
  }

  const scope = {
    ownerUid: record.ownerUid,
    workspaceId: record.workspaceId,
    connectionId: record.id,
    protocol: record.protocol,
  };

  let resolvedKey: ResolvedVaultKeyConfig;
  try {
    resolvedKey = resolveVaultKeyConfiguration(env);
  } catch (err: any) {
    const code: VaultErrorCode =
      err instanceof VaultConfigurationError ? err.code : 'VAULT_MASTER_KEY_NOT_CONFIGURED';
    return {
      ...record,
      credentialStatus: 'requires-reentry',
      lastTestStatus: 'Failed',
      lastSanitizedError: {
        code,
        httpStatus: 503,
        message:
          err?.message ||
          'SOWVEIL_MASTER_VAULT_KEY is not configured. Existing encrypted credential is preserved on disk but locked until the vault key is configured or the credential is rotated.',
        timestamp: new Date().toISOString(),
      },
    };
  }

  try {
    const expectedAad = buildVaultAadScope(scope);
    if (record.encryptedCredential.aadScope !== expectedAad) {
      throw new Error('AAD scope mismatch');
    }
    const iv = Buffer.from(record.encryptedCredential.ivHex, 'hex');
    const authTag = Buffer.from(record.encryptedCredential.authTagHex, 'hex');
    const ciphertext = Buffer.from(record.encryptedCredential.ciphertextHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', resolvedKey.keyBytes, iv);
    decipher.setAAD(Buffer.from(expectedAad, 'utf8'));
    decipher.setAuthTag(authTag);
    Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    if (record.credentialStatus === 'requires-reentry') {
      return {
        ...record,
        credentialStatus: 'active',
        lastSanitizedError: null,
      };
    }
    return record;
  } catch {
    return {
      ...record,
      credentialStatus: 'requires-reentry',
      lastTestStatus: 'Failed',
      lastSanitizedError: {
        code: 'CREDENTIAL_REENTRY_REQUIRED',
        httpStatus: 409,
        message:
          'Stored credential was encrypted under a retired or previous vault key and cannot be decrypted with the active SOWVEIL_MASTER_VAULT_KEY. Connection metadata and routing profiles were preserved; rotate your API key to restore this connection.',
        timestamp: new Date().toISOString(),
      },
    };
  }
}

/**
 * Controlled server-only migration helper for rotating an encrypted connection record from an
 * explicitly supplied previous master key to a new master key (neither may be the retired public fallback).
 */
export function migrateVaultRecordWithExplicitPreviousKey(
  record: ProviderConnectionRecord,
  options: {
    previousMasterKey: string;
    newMasterKey?: string;
  }
): ProviderConnectionRecord {
  if (!record.encryptedCredential) {
    return record;
  }

  const scope = {
    ownerUid: record.ownerUid,
    workspaceId: record.workspaceId,
    connectionId: record.id,
    protocol: record.protocol,
  };

  const plaintext = decryptCredentialFromVault(
    record.encryptedCredential,
    scope,
    options.previousMasterKey
  );
  const nextVersion = (record.keyVersion || 1) + 1;
  const reEncrypted = encryptCredentialForVault(
    plaintext,
    scope,
    nextVersion,
    options.newMasterKey
  );

  return {
    ...record,
    credentialStatus: 'active',
    keyVersion: nextVersion,
    encryptedCredential: reEncrypted,
    lastSanitizedError: null,
    rotatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
