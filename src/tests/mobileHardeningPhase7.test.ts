import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createApiApp } from '../server/apiApp';
import { SOWVEIL_MODULES, MODULE_CATEGORIES } from '../data/modules';
import { MOBILE_EDITOR_ADAPTERS } from '../services/editorGateway';

function startHardenedTestServer() {
  const app = createApiApp({
    tokenVerifier: async (token: string) => {
      if (token === 'token-verified-user') {
        return {
          uid: 'uid-user-phase7',
          email: 'designer@sowveil.studio',
          emailVerified: true,
          displayName: 'Phase 7 Designer',
        };
      }
      throw new Error('INVALID_TOKEN');
    },
    rateLimitMaxPerMinute: 120,
    ownerBootstrapEmail: 'owner@sowveil.studio',
    ownerBootstrapSecret: 'phase7-secret-key',
  });

  const server = http.createServer(app);
  return new Promise<{ server: http.Server; baseUrl: string }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

test('1. Security Headers & Crawler Exclusion: Verifies strict HTTP security headers and X-Robots-Tag', async () => {
  const { server, baseUrl } = await startHardenedTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    assert.strictEqual(res.status, 200);

    // Verify security headers
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.strictEqual(
      res.headers.get('referrer-policy'),
      'strict-origin-when-cross-origin'
    );
    assert.strictEqual(
      res.headers.get('permissions-policy'),
      'camera=(), microphone=(), geolocation=(), payment=()'
    );
    assert.strictEqual(
      res.headers.get('cross-origin-opener-policy'),
      'same-origin-allow-popups'
    );
    assert.strictEqual(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  } finally {
    server.close();
  }
});

test('2. Strict Origin-Checked CORS: Reflects authorized origins and rejects malicious ones', async () => {
  const { server, baseUrl } = await startHardenedTestServer();
  try {
    const allowedOrigin =
      'https://ais-dev-nn4jeltvqjefaodoembxbd-775414035263.asia-southeast1.run.app';
    const disallowedOrigin = 'https://malicious-impersonator.example.com';

    // Authorized origin GET
    const authRes = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { Origin: allowedOrigin },
    });
    assert.strictEqual(
      authRes.headers.get('access-control-allow-origin'),
      allowedOrigin
    );
    assert.strictEqual(
      authRes.headers.get('access-control-allow-credentials'),
      'true'
    );
    assert.strictEqual(authRes.headers.get('vary'), 'Origin');

    // Preflight OPTIONS for authorized origin
    const optionsRes = await fetch(`${baseUrl}/api/v1/catalog`, {
      method: 'OPTIONS',
      headers: {
        Origin: allowedOrigin,
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.strictEqual(optionsRes.status, 204);
    assert.strictEqual(
      optionsRes.headers.get('access-control-allow-origin'),
      allowedOrigin
    );

    // Unauthorized third-party origin GET
    const badRes = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { Origin: disallowedOrigin },
    });
    assert.strictEqual(badRes.headers.get('access-control-allow-origin'), null);
  } finally {
    server.close();
  }
});

test('3. Cache-Control Policy: Enforces public caching for catalog and no-store for private/authenticated routes', async () => {
  const { server, baseUrl } = await startHardenedTestServer();
  try {
    // Public catalog query
    const catRes = await fetch(`${baseUrl}/api/v1/catalog`);
    assert.strictEqual(catRes.status, 200);
    assert.strictEqual(
      catRes.headers.get('cache-control'),
      'public, max-age=60, stale-while-revalidate=300'
    );

    // Authenticated /me endpoint
    const meRes = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { Authorization: 'Bearer token-verified-user' },
    });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(
      meRes.headers.get('cache-control'),
      'no-store, no-cache, must-revalidate, private'
    );
    assert.strictEqual(meRes.headers.get('pragma'), 'no-cache');

    // Authenticated /jobs endpoint
    const jobsRes = await fetch(`${baseUrl}/api/v1/jobs`, {
      headers: { Authorization: 'Bearer token-verified-user' },
    });
    assert.strictEqual(jobsRes.status, 200);
    assert.strictEqual(
      jobsRes.headers.get('cache-control'),
      'no-store, no-cache, must-revalidate, private'
    );
  } finally {
    server.close();
  }
});

test('4. Strict Auth Rate Limiting: Blocks excessive bootstrap attempts beyond 10 req/min', async () => {
  const { server, baseUrl } = await startHardenedTestServer();
  try {
    let rateLimitedEncountered = false;
    for (let i = 0; i < 15; i++) {
      const res = await fetch(`${baseUrl}/api/v1/admin/bootstrap-owner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-verified-user',
        },
        body: JSON.stringify({ bootstrapSecret: 'wrong-secret' }),
      });
      if (res.status === 429) {
        rateLimitedEncountered = true;
        const body = (await res.json()) as { error?: { code?: string } };
        assert.strictEqual(body.error?.code, 'RATE_LIMITED');
        break;
      }
    }
    assert.strictEqual(
      rateLimitedEncountered,
      true,
      'Expected 429 RATE_LIMITED on sensitive bootstrap endpoint'
    );
  } finally {
    server.close();
  }
});

test('5. Static SEO & Discoverability Assets: Validates robots.txt, sitemap.xml, and index.html synchronization', () => {
  const root = process.cwd();

  // Validate robots.txt
  const robotsPath = path.join(root, 'public', 'robots.txt');
  assert.strictEqual(fs.existsSync(robotsPath), true);
  const robotsContent = fs.readFileSync(robotsPath, 'utf8');
  assert.ok(robotsContent.includes('Disallow: /admin'));
  assert.ok(robotsContent.includes('Disallow: /api/'));
  assert.ok(robotsContent.includes('Disallow: /app/jobs'));
  assert.ok(robotsContent.includes('Sitemap:'));

  // Validate sitemap.xml
  const sitemapPath = path.join(root, 'public', 'sitemap.xml');
  assert.strictEqual(fs.existsSync(sitemapPath), true);
  const sitemapContent = fs.readFileSync(sitemapPath, 'utf8');
  assert.ok(sitemapContent.includes('<urlset'));
  assert.ok(sitemapContent.includes('/features'));
  assert.ok(sitemapContent.includes('/docs'));
  assert.ok(sitemapContent.includes('/terms'));
  assert.ok(sitemapContent.includes('/privacy'));

  // Validate index.html metadata sync
  const indexPath = path.join(root, 'index.html');
  const indexContent = fs.readFileSync(indexPath, 'utf8');
  assert.ok(
    indexContent.includes(
      '<title>Sowveil Studio — Mobile Motion Design & Editor Gateway</title>'
    )
  );
  assert.ok(indexContent.includes('name="description"'));
  assert.ok(indexContent.includes('property="og:title"'));
  assert.ok(indexContent.includes('property="og:description"'));
  assert.ok(indexContent.includes('application/ld+json'));
  assert.ok(indexContent.includes('"@type": "WebApplication"'));
  assert.strictEqual(
    indexContent.includes('After Effects Desktop Extension'),
    false,
    'index.html must not contain obsolete desktop After Effects references'
  );
});

test('6. 20-Module & Mobile Editor Ecosystem: Validates module and adapter integrity', () => {
  // Verify 20 modules
  assert.strictEqual(SOWVEIL_MODULES.length, 20);
  const moduleIds = new Set(SOWVEIL_MODULES.map((m) => m.id));
  assert.strictEqual(moduleIds.size, 20);

  for (const mod of SOWVEIL_MODULES) {
    assert.ok(mod.id && mod.id.length > 0);
    assert.ok(mod.label && mod.label.length > 0);
    assert.ok(mod.route && mod.route.startsWith('/app/'));
    assert.ok(mod.icon && mod.icon.length > 0);
  }

  // Verify categories map to existing modules
  assert.ok(MODULE_CATEGORIES.length > 0);
  for (const cat of MODULE_CATEGORIES) {
    assert.ok(moduleIds.has(cat.moduleId as any));
  }

  // Verify 6 mobile editor adapters
  assert.strictEqual(MOBILE_EDITOR_ADAPTERS.length, 6);
  const editorIds = new Set(MOBILE_EDITOR_ADAPTERS.map((e) => e.id));
  assert.ok(editorIds.has('capcut'));
  assert.ok(editorIds.has('alight-motion'));
  assert.ok(editorIds.has('node-video'));
  assert.ok(editorIds.has('kinemaster'));
  assert.ok(editorIds.has('sowveil-project'));
  assert.ok(editorIds.has('universal-bundle'));

  for (const adapter of MOBILE_EDITOR_ADAPTERS) {
    assert.ok(adapter.name && adapter.name.length > 0);
    assert.ok(adapter.shortName && adapter.shortName.length > 0);
    assert.ok(adapter.compatibilityStatus && adapter.compatibilityStatus.length > 0);
    assert.ok(adapter.defaultExportFormat && adapter.defaultExportFormat.length > 0);
    assert.ok(Array.isArray(adapter.supportedFormats) && adapter.supportedFormats.length > 0);
  }
});
