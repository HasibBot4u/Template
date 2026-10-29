/**
 * SOWVEIL STUDIO — Browser-Safe Authenticated API Client
 *
 * Requirements:
 * 1. Obtains the current Firebase user's ID token through `auth.currentUser.getIdToken()`.
 * 2. Transmits the token as `Authorization: Bearer <token>`.
 * 3. Never transmits development bypass headers in production authorization.
 * 4. Transparently handles token refresh on 401, missing sessions, expired tokens,
 *    network errors, 403, and 503 responses.
 * 5. Supports dependency injection of `getAuthToken` and `fetchImpl` for testing.
 */

import { auth } from './firebaseClient';

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  getAuthToken?: (forceRefresh?: boolean) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  retryOn401?: boolean;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  errorCode?: string;
  errorMessage?: string;
  details?: unknown;
}

/**
 * Default token retriever using active Firebase Auth state.
 */
export async function getFirebaseIdToken(forceRefresh = false): Promise<string | null> {
  try {
    const current = auth?.currentUser;
    if (!current) return null;
    return await current.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}

/**
 * Sanitizes request headers: removes insecure development headers and sets standard types.
 */
function sanitizeHeaders(
  customHeaders?: Record<string, string>,
  hasBody = false
): Record<string, string> {
  const result: Record<string, string> = {};
  if (hasBody) {
    result['Content-Type'] = 'application/json';
  }
  if (!customHeaders) return result;

  for (const [key, value] of Object.entries(customHeaders)) {
    const lower = key.toLowerCase();
    // Strip forbidden development identity headers
    if (
      lower === 'x-test-uid' ||
      lower === 'x-test-email' ||
      lower === 'x-sowveil-dev-uid' ||
      lower === 'x-dev-user-id'
    ) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

/**
 * Executes an authenticated API request with Bearer authorization and 1-attempt token refresh on 401.
 */
export async function executeAuthenticatedApiRequest<T = unknown>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<ApiResponse<T>> {
  const fetchFn = options.fetchImpl || globalThis.fetch;
  const tokenResolver =
    options.getAuthToken ||
    (async (forceRefresh = false) => {
      return getFirebaseIdToken(forceRefresh);
    });

  let token: string | null = null;
  try {
    token = await tokenResolver(false);
  } catch {
    token = null;
  }

  if (!token) {
    return {
      ok: false,
      status: 401,
      errorCode: 'AUTH_SESSION_REQUIRED',
      errorMessage:
        'An active authenticated session is required for this operation. Please sign in with your verified Google account.',
    };
  }

  const hasBody = options.body !== undefined;
  const headers = sanitizeHeaders(options.headers, hasBody);
  headers.Authorization = `Bearer ${token}`;

  try {
    let response = await fetchFn(path, {
      method: options.method || 'GET',
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
    });

    // Handle token refresh on 401 if retryOn401 is not explicitly disabled
    if (response.status === 401 && options.retryOn401 !== false) {
      try {
        const refreshedToken = await tokenResolver(true);
        if (refreshedToken && refreshedToken !== token) {
          headers.Authorization = `Bearer ${refreshedToken}`;
          response = await fetchFn(path, {
            method: options.method || 'GET',
            headers,
            body: hasBody ? JSON.stringify(options.body) : undefined,
          });
        }
      } catch {
        // Fall through to parse original 401 response
      }
    }

    const json = await response.json().catch(() => null);

    if (!response.ok || !json || json.ok === false) {
      const code =
        json?.error?.code ||
        (response.status === 401
          ? 'UNAUTHENTICATED'
          : response.status === 403
          ? 'FORBIDDEN'
          : response.status === 503
          ? 'SERVICE_UNAVAILABLE'
          : `HTTP_${response.status}`);
      const msg =
        json?.error?.message ||
        `Request to ${path} failed with HTTP ${response.status}.`;
      return {
        ok: false,
        status: response.status,
        errorCode: code,
        errorMessage: msg,
        details: json?.error?.details,
      };
    }

    return {
      ok: true,
      status: response.status,
      data: (json.data !== undefined ? json.data : json) as T,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      errorCode: 'NETWORK_ERROR',
      errorMessage:
        err instanceof Error
          ? err.message
          : `Network request error while contacting ${path}. No local fallback was assumed.`,
    };
  }
}

export async function apiGet<T = unknown>(
  path: string,
  options: Omit<ApiRequestOptions, 'method'> = {}
): Promise<ApiResponse<T>> {
  return executeAuthenticatedApiRequest<T>(path, { ...options, method: 'GET' });
}

export async function apiPost<T = unknown>(
  path: string,
  body?: unknown,
  options: Omit<ApiRequestOptions, 'method' | 'body'> = {}
): Promise<ApiResponse<T>> {
  return executeAuthenticatedApiRequest<T>(path, { ...options, method: 'POST', body });
}

export async function apiPatch<T = unknown>(
  path: string,
  body?: unknown,
  options: Omit<ApiRequestOptions, 'method' | 'body'> = {}
): Promise<ApiResponse<T>> {
  return executeAuthenticatedApiRequest<T>(path, { ...options, method: 'PATCH', body });
}

export async function apiDelete<T = unknown>(
  path: string,
  options: Omit<ApiRequestOptions, 'method'> = {}
): Promise<ApiResponse<T>> {
  return executeAuthenticatedApiRequest<T>(path, { ...options, method: 'DELETE' });
}
