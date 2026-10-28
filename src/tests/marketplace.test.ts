import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApiApp, VerifiedTokenIdentity } from '../server/apiApp';
import {
  applyVariantOverridesToTemplate,
  enrichCatalogItemWithMarketplaceDefaults,
  forkTemplateFromVariant,
  runTemplateValidationJob,
  sanitizeAndValidateSvgContent,
  sanitizeUserLabelAndMarkdown,
} from '../services/marketplaceEngine';
import { SEED_CATALOG_ITEMS } from '../data/catalogSeeds';
import { filterAndSortCatalogItems } from '../services/catalogEngine';
import { TemplateVariantInstance } from '../types/sowveil';

const MOCK_TOKENS: Record<string, VerifiedTokenIdentity> = {
  'token-alice': {
    uid: 'user_alice',
    email: 'alice@example.com',
    emailVerified: true,
    displayName: 'Alice Creator',
  },
  'token-bob': {
    uid: 'user_bob',
    email: 'bob@example.com',
    emailVerified: true,
    displayName: 'Bob Editor',
  },
  'token-admin': {
    uid: 'user_admin',
    email: 'admin@sowveil.studio',
    emailVerified: true,
    displayName: 'Studio Admin',
  },
};

async function startMarketplaceTestServer() {
  const app = createApiApp({
    ownerBootstrapEmail: 'admin@sowveil.studio',
    ownerBootstrapSecret: 'TEST_BOOTSTRAP_SECRET_2026',
    storageEnabled: false,
    tokenVerifier: async (token: string) => {
      const identity = MOCK_TOKENS[token];
      if (!identity) {
        const err = new Error('Invalid token');
        (err as { code?: string }).code = 'INVALID_TOKEN';
        throw err;
      }
      return identity;
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('Marketplace Schema Enrichment: Every catalog item has required marketplace metadata fields', () => {
  assert.ok(SEED_CATALOG_ITEMS.length > 300, 'Expected full catalog seed');
  for (const raw of SEED_CATALOG_ITEMS.slice(0, 30)) {
    const item = enrichCatalogItemWithMarketplaceDefaults(raw);
    assert.ok(item.id);
    assert.ok(item.name);
    assert.ok(item.moduleId);
    assert.ok(item.creatorUid);
    assert.ok(item.ownerUid);
    assert.ok(item.sourceProjectVersion);
    assert.ok(item.templateSchemaVersion);
    assert.ok(Array.isArray(item.supportedEditableProperties));
    assert.ok(item.mediaRequirements);
    assert.ok(item.rendererRequirements);
    assert.ok(item.licenseType);
    assert.ok(item.attribution);
    assert.ok(Array.isArray(item.previewFiles));
    assert.ok(item.validationState);
    assert.ok(Array.isArray(item.versionHistory));
    assert.ok(item.deprecationStatus);
  }
});

test('Marketplace Permission Scoping: Private templates of Alice never appear in Bob’s results', () => {
  const baseItem = enrichCatalogItemWithMarketplaceDefaults(SEED_CATALOG_ITEMS[0]);
  const alicePrivate = {
    ...baseItem,
    id: 'alice-secret-template',
    name: 'Alice Secret Motion Pack',
    ownerUid: 'user_alice',
    creatorUid: 'user_alice',
    visibility: 'private' as const,
  };
  const publicTemplate = {
    ...baseItem,
    id: 'public-shared-template',
    name: 'Public Shared Motion Pack',
    ownerUid: 'user_alice',
    creatorUid: 'user_alice',
    visibility: 'published' as const,
  };

  const bobView = filterAndSortCatalogItems([alicePrivate, publicTemplate], {
    moduleId: baseItem.moduleId,
    viewerUid: 'user_bob',
    viewerIsAdmin: false,
  });
  assert.equal(bobView.some((i) => i.id === 'alice-secret-template'), false);
  assert.equal(bobView.some((i) => i.id === 'public-shared-template'), true);

  const aliceView = filterAndSortCatalogItems([alicePrivate, publicTemplate], {
    moduleId: baseItem.moduleId,
    viewerUid: 'user_alice',
    viewerIsAdmin: false,
  });
  assert.equal(aliceView.some((i) => i.id === 'alice-secret-template'), true);
});

test('Template vs. Your Edits & Forking: Editing an instance or forking never mutates the base template', () => {
  const baseTemplate = enrichCatalogItemWithMarketplaceDefaults(SEED_CATALOG_ITEMS[0]);
  const originalDefaultVal = baseTemplate.editableParams?.[0]?.defaultValue;
  const paramKey = baseTemplate.editableParams?.[0]?.key || 'headline';

  const variant: TemplateVariantInstance = {
    id: 'var-test-1',
    baseTemplateId: baseTemplate.id,
    baseTemplateVersion: baseTemplate.templateSchemaVersion || '2.0.0',
    ownerUid: 'user_alice',
    title: 'Alice Custom Brand Edit',
    description: 'Custom overrides',
    parameterOverrides: {
      [paramKey]: 'OVERRIDE_VALUE_999',
    },
    assetSlotBindings: {
      'slot-primary-media': 'asset_custom_logo',
    },
    timingOverrides: {
      durationSec: 7.5,
      fps: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const resolvedView = applyVariantOverridesToTemplate(baseTemplate, variant);
  assert.equal(
    resolvedView.editableParams?.find((p) => p.key === paramKey)?.defaultValue,
    'OVERRIDE_VALUE_999'
  );
  // Base template must remain untouched
  assert.equal(baseTemplate.editableParams?.[0]?.defaultValue, originalDefaultVal);

  const forked = forkTemplateFromVariant(baseTemplate, variant, {
    newId: 'forked-template-01',
    newTitle: 'Alice Forked Standalone Template',
    ownerUid: 'user_alice',
  });

  assert.equal(forked.id, 'forked-template-01');
  assert.equal(forked.forkedFromTemplateId, baseTemplate.id);
  assert.equal(forked.ownerUid, 'user_alice');
  assert.equal(forked.visibility, 'private');
  assert.equal(
    forked.editableParams?.find((p) => p.key === paramKey)?.defaultValue,
    'OVERRIDE_VALUE_999'
  );
  // Verify original template is still untouched
  assert.equal(baseTemplate.editableParams?.[0]?.defaultValue, originalDefaultVal);
});

test('SVG & Markdown Sanitization: Blocks XSS payloads in SVG and user labels', () => {
  const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="100" height="100"/></svg>`;
  const check1 = sanitizeAndValidateSvgContent(maliciousSvg);
  assert.equal(check1.safe, false);
  assert.ok(check1.rejectedReason?.includes('<script>'));

  const onEventSvg = `<svg xmlns="http://www.w3.org/2000/svg" onload="evil()"><rect width="50" height="50"/></svg>`;
  const check2 = sanitizeAndValidateSvgContent(onEventSvg);
  assert.equal(check2.safe, false);

  const validSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#F06424"/></svg>`;
  const check3 = sanitizeAndValidateSvgContent(validSvg);
  assert.equal(check3.safe, true);

  const dirtyLabel = `My Template <script>steal()</script> [Click](javascript:alert(1))`;
  const cleanLabel = sanitizeUserLabelAndMarkdown(dirtyLabel);
  assert.equal(cleanLabel.includes('<script>'), false);
  assert.equal(cleanLabel.includes('javascript:'), false);
});

test('Template Validation Runner: Produces recorded validation evidence and catches missing required assets', () => {
  const baseTemplate = enrichCatalogItemWithMarketplaceDefaults(SEED_CATALOG_ITEMS[0]);
  const availableAssets = new Set<string>(['asset_hero_1']);

  const templateWithRequiredMissingAsset = {
    ...baseTemplate,
    mediaRequirements: {
      requiresUserMedia: true,
      requiredAssetKinds: ['image' as const],
      allowedAssetKinds: ['image' as const],
      replaceableSlots: [
        {
          slotId: 'slot-logo',
          label: 'Brand Logo',
          acceptedKinds: ['image' as const],
          required: true,
          boundAssetId: 'missing_asset_id_999',
        },
      ],
    },
  };

  const failedRun = runTemplateValidationJob(templateWithRequiredMissingAsset, availableAssets);
  assert.equal(failedRun.nextValidationState, 'Needs assets');
  assert.equal(failedRun.evidence.passed, false);
  assert.ok(failedRun.evidence.jobId.startsWith('valjob_'));

  // Now bind the available asset and re-run validation
  templateWithRequiredMissingAsset.mediaRequirements.replaceableSlots[0].boundAssetId =
    'asset_hero_1';
  const passedRun = runTemplateValidationJob(templateWithRequiredMissingAsset, availableAssets);
  assert.equal(passedRun.nextValidationState, 'Validated');
  assert.equal(passedRun.evidence.passed, true);
});

test('API Integration: Variants, Forking, Provenance License Rules, and Asset Library Deduplication', async () => {
  const srv = await startMarketplaceTestServer();
  try {
    // 1. Alice creates a named variant ("Your edits")
    const createVarRes = await fetch(`${srv.baseUrl}/api/v1/template-variants`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-alice',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        baseTemplateId: 'ta-rise-up',
        title: 'Alice Rise Up Variant',
        parameterOverrides: { durationMs: 950 },
        assetSlotBindings: { 'slot-primary-media': 'asset_1' },
      }),
    });
    assert.equal(createVarRes.status, 201);
    const createdVarJson = await createVarRes.json();
    const createdVar = createdVarJson.data;
    assert.equal(createdVar.title, 'Alice Rise Up Variant');

    // 2. Bob cannot see Alice's private variant
    const bobListVarRes = await fetch(`${srv.baseUrl}/api/v1/template-variants`, {
      headers: { Authorization: 'Bearer token-bob' },
    });
    assert.equal(bobListVarRes.status, 200);
    const bobListVarJson = await bobListVarRes.json();
    assert.equal(
      bobListVarJson.data.items.some((v: { id: string }) => v.id === createdVar.id),
      false
    );

    // 3. Alice forks the template from her variant
    const forkRes = await fetch(`${srv.baseUrl}/api/v1/catalog/ta-rise-up/fork`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-alice',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        variantId: createdVar.id,
        newTitle: 'Alice Standalone Rise Up Fork',
      }),
    });
    assert.equal(forkRes.status, 201);
    const forkJson = await forkRes.json();
    assert.equal(forkJson.data.forkedFromTemplateId, 'ta-rise-up');
    assert.equal(forkJson.data.visibility, 'private');

    // 4. Asset Library: Unknown license is preserved by default and never auto-converted to Free
    const assetRes1 = await fetch(`${srv.baseUrl}/api/v1/assets`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-alice',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Custom Brand Icon.svg',
        kind: 'svg',
        mimeType: 'image/svg+xml',
        byteSize: 512,
        svgContent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#F06424"/></svg>`,
      }),
    });
    assert.equal(assetRes1.status, 201);
    const assetJson1 = await assetRes1.json();
    assert.equal(assetJson1.data.licenseType, 'Unknown');

    // 5. Identical upload by Alice is deduplicated by SHA-256 within her scope
    const assetRes2 = await fetch(`${srv.baseUrl}/api/v1/assets`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-alice',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Duplicate Brand Icon.svg',
        kind: 'svg',
        mimeType: 'image/svg+xml',
        byteSize: 512,
        svgContent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#F06424"/></svg>`,
      }),
    });
    assert.equal(assetRes2.status, 200);
    const assetJson2 = await assetRes2.json();
    assert.equal(assetJson2.data.deduplicated, true);
    assert.equal(assetJson2.data.id, assetJson1.data.id);

    // 6. Publishing an Unknown-license asset as public is rejected
    const badPublicAsset = await fetch(`${srv.baseUrl}/api/v1/assets`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-alice',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Unlicensed Public Attempt.png',
        kind: 'image',
        mimeType: 'image/png',
        byteSize: 2048,
        visibility: 'public',
        licenseType: 'Unknown',
      }),
    });
    assert.equal(badPublicAsset.status, 400);
    const badPublicJson = await badPublicAsset.json();
    assert.equal(badPublicJson.error.code, 'LICENSE_REQUIRED_FOR_PUBLICATION');
  } finally {
    await srv.close();
  }
});
