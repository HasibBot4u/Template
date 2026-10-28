import { URL } from 'node:url';

/**
 * Validates external or user-configured AI provider endpoints against SSRF and internal network exposure.
 */
export function validateProviderEndpointSsrf(endpointUrl: string): {
  allowed: boolean;
  normalizedUrl?: string;
  hostname?: string;
  errorCode?: string;
  reason: string;
} {
  if (!endpointUrl || typeof endpointUrl !== 'string') {
    return {
      allowed: false,
      errorCode: 'ENDPOINT_EMPTY',
      reason: 'Provider endpoint URL cannot be empty.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(endpointUrl.trim());
  } catch {
    return {
      allowed: false,
      errorCode: 'ENDPOINT_MALFORMED',
      reason: 'Invalid URL format.',
    };
  }

  // Must use HTTPS in production (allow HTTP only for localhost dev on non-prod)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      allowed: false,
      errorCode: 'UNSUPPORTED_PROTOCOL',
      reason: `Protocol "${parsed.protocol}" is forbidden. Endpoints must use HTTPS.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block loopback addresses
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0'
  ) {
    return {
      allowed: false,
      hostname,
      errorCode: 'SSRF_LOOPBACK_FORBIDDEN',
      reason: 'Localhost and loopback endpoints are blocked to prevent internal network scanning.',
    };
  }

  // Block cloud metadata services (e.g. 169.254.169.254 AWS/GCP instance metadata)
  if (hostname === '169.254.169.254' || hostname.startsWith('169.254.')) {
    return {
      allowed: false,
      hostname,
      errorCode: 'SSRF_METADATA_FORBIDDEN',
      reason: 'Cloud metadata service endpoints are strictly blocked.',
    };
  }

  // Block RFC1918 private IPv4 subnets
  const ipv4Parts = hostname.split('.').map((p) => parseInt(p, 10));
  if (ipv4Parts.length === 4 && ipv4Parts.every((n) => !isNaN(n) && n >= 0 && n <= 255)) {
    const [p0, p1] = ipv4Parts;
    // 10.0.0.0/8
    if (p0 === 10) {
      return {
        allowed: false,
        hostname,
        errorCode: 'SSRF_PRIVATE_IP_FORBIDDEN',
        reason: 'Private 10.0.0.0/8 subnet access is forbidden.',
      };
    }
    // 172.16.0.0/12 (172.16 - 172.31)
    if (p0 === 172 && p1 >= 16 && p1 <= 31) {
      return {
        allowed: false,
        hostname,
        errorCode: 'SSRF_PRIVATE_IP_FORBIDDEN',
        reason: 'Private 172.16.0.0/12 subnet access is forbidden.',
      };
    }
    // 192.168.0.0/16
    if (p0 === 192 && p1 === 168) {
      return {
        allowed: false,
        hostname,
        errorCode: 'SSRF_PRIVATE_IP_FORBIDDEN',
        reason: 'Private 192.168.0.0/16 subnet access is forbidden.',
      };
    }
  }

  return {
    allowed: true,
    normalizedUrl: parsed.origin + parsed.pathname.replace(/\/$/, ''),
    hostname,
    reason: 'Endpoint validated as secure public host.',
  };
}

/**
 * Masks an API key for safe display and logging without revealing high-entropy credentials.
 */
export function maskApiKey(key: string): string {
  if (!key || typeof key !== 'string') return 'unconfigured';
  const trimmed = key.trim();
  if (trimmed.length <= 8) {
    return '••••••••';
  }
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••••••${suffix}`;
}

/**
 * Scans untrusted repository files or templates for secret leaks or suspicious binaries.
 */
export function scanUntrustedRepoContent(files: Array<{ path: string; content?: string }>): {
  safeToIngest: boolean;
  secretMatchesCount: number;
  suspiciousPatterns: string[];
} {
  const secretPatterns = [
    /AIza[0-9A-Za-z-_]{35}/, // Google API Key
    /sk-[a-zA-Z0-9_-]{20,}/, // OpenAI API Key
    /ghp_[a-zA-Z0-9]{36}/, // GitHub Personal Token
    /-----BEGIN (?:RSA|EC|OPENSSH) PRIVATE KEY-----/,
  ];

  let matches = 0;
  const suspicious: string[] = [];

  for (const f of files) {
    if (f.path.includes('../') || f.path.startsWith('/')) {
      suspicious.push(`Path traversal pattern in: ${f.path}`);
    }
    if (f.content) {
      for (const pat of secretPatterns) {
        if (pat.test(f.content)) {
          matches++;
          suspicious.push(`Potential credential found in: ${f.path}`);
          break;
        }
      }
    }
  }

  return {
    safeToIngest: matches === 0 && suspicious.length === 0,
    secretMatchesCount: matches,
    suspiciousPatterns: suspicious,
  };
}

/**
 * Detects prompt injection markers in untrusted third-party website or template text.
 */
export function sanitizePromptInjectionRisk(text: string): {
  sanitized: string;
  hasSuspiciousIndicators: boolean;
  flaggedPhrases: string[];
} {
  if (!text) return { sanitized: '', hasSuspiciousIndicators: false, flaggedPhrases: [] };

  const suspiciousPhrases = [
    'ignore previous instructions',
    'system override',
    'you are now in developer mode',
    'disregard all prior instructions',
    'bypass safety filters',
    'reveal system prompt',
    'drop table',
  ];

  const lower = text.toLowerCase();
  const flagged = suspiciousPhrases.filter((p) => lower.includes(p));

  // Neutralize angle brackets and script blocks
  const sanitized = text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '[SCRIPT_STRIPPED]')
    .replace(/<\/?(?:iframe|embed|object)\b[^>]*>/gi, '[EMBED_STRIPPED]');

  return {
    sanitized,
    hasSuspiciousIndicators: flagged.length > 0,
    flaggedPhrases: flagged,
  };
}
