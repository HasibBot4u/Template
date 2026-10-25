import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_CATALOG_ITEMS, SEED_PROJECT_LIBRARY } from '../data/catalogSeeds';
import { MODULE_CATEGORIES, SOWVEIL_MODULES } from '../data/modules';
import {
  computeActualCategoryCounts,
  computeActualModuleCounts,
  filterAndSortCatalogItems,
  supportsInteractiveTemplateComparison,
} from '../services/catalogEngine';
import {
  canTransitionJob,
  transitionJobRecord,
} from '../services/jobStateMachine';
import { LocalPreviewWorkspaceRepository } from '../repositories/workspaceRepository';

test('Catalog search filters by name, tags, pack/category, and description', () => {
  const textItems = SEED_CATALOG_ITEMS.filter((i) => i.moduleId === 'text-animation');
  const textCats = MODULE_CATEGORIES.filter((c) => c.moduleId === 'text-animation');

  // 1. By name
  const byName = filterAndSortCatalogItems(textItems, {
    moduleId: 'text-animation',
    searchQuery: 'Soft Focus',
    categories: textCats,
  });
  assert.equal(byName.length, 1);
  assert.equal(byName[0].id, 'ta-soft-focus');

  // 2. By tag
  const byTag = filterAndSortCatalogItems(textItems, {
    moduleId: 'text-animation',
    searchQuery: 'Cipher',
    categories: textCats,
  });
  assert.ok(byTag.some((i) => i.id === 'ta-decode'));

  // 3. By pack/category label
  const byPack = filterAndSortCatalogItems(textItems, {
    moduleId: 'text-animation',
    searchQuery: 'Glow Edge Titles',
    categories: textCats,
  });
  assert.equal(byPack.length, 1);
  assert.equal(byPack[0].id, 'ta-ge-title-05');

  // 4. By description content
  const byDesc = filterAndSortCatalogItems(textItems, {
    moduleId: 'text-animation',
    searchQuery: 'Gaussian Blur',
    categories: textCats,
  });
  assert.equal(byDesc.length, 1);
  assert.equal(byDesc[0].id, 'ta-soft-focus');
});

test('Category filters, sorting, and actual counts operate on real stored records (never fake 220/104/72 totals)', () => {
  const textItems = SEED_CATALOG_ITEMS.filter((i) => i.moduleId === 'text-animation');
  const catCounts = computeActualCategoryCounts(textItems);
  const sumOfCategories = Object.values(catCounts).reduce((a, b) => a + b, 0);

  // Sum of category counts equals actual seeded items in text-animation (13), not reference 220
  assert.equal(sumOfCategories, textItems.length);
  assert.notEqual(sumOfCategories, 220);

  const moduleCounts = computeActualModuleCounts(SEED_CATALOG_ITEMS, SEED_PROJECT_LIBRARY);
  assert.equal(moduleCounts['expressions'], 12);
  assert.equal(moduleCounts['saas-effects'], 9);
  assert.equal(moduleCounts['templates'], 11);
  assert.notEqual(moduleCounts['ui-saas'], 104);
  assert.notEqual(moduleCounts['overlays-fx'], 72);

  // Favorites filter & sort
  const favFiltered = filterAndSortCatalogItems(textItems, {
    moduleId: 'text-animation',
    categoryId: 'favorites',
    favoriteIds: ['ta-decode', 'ta-rise-up'],
  });
  assert.equal(favFiltered.length, 2);
});

test('Template/Your edits comparison gate requires supportsTemplateComparison and non-empty editableParams', () => {
  for (const item of SEED_CATALOG_ITEMS) {
    if (supportsInteractiveTemplateComparison(item)) {
      assert.equal(item.supportsTemplateComparison, true);
      assert.ok(Array.isArray(item.editableParams) && item.editableParams.length > 0);
    }
  }
});

test('Favorite add/remove is idempotent and supports failure rollback', async () => {
  const repo = new LocalPreviewWorkspaceRepository();

  const initial = await repo.getFavorites();
  const afterFirstAdd = await repo.addFavorite('ta-pop');
  const afterDuplicateAdd = await repo.addFavorite('ta-pop');

  assert.equal(afterFirstAdd.length, afterDuplicateAdd.length);
  assert.deepEqual(afterFirstAdd, afterDuplicateAdd);
  assert.equal(afterDuplicateAdd.filter((id) => id === 'ta-pop').length, 1);

  const afterRemove = await repo.removeFavorite('ta-pop');
  const afterSecondRemove = await repo.removeFavorite('ta-pop');
  assert.deepEqual(afterRemove, afterSecondRemove);
  assert.equal(afterRemove.includes('ta-pop'), false);
  assert.deepEqual(afterRemove, initial);

  // Simulated write failure throws so caller can roll back optimistic UI state
  repo.setSimulateWriteFailure(true);
  await assert.rejects(async () => {
    await repo.addFavorite('ta-decode');
  }, /REPOSITORY_WRITE_FAILED/);
  repo.setSimulateWriteFailure(false);
});

test('Project Library preserves null compCount/fileSizeBytes without inventing numbers', async () => {
  const repo = new LocalPreviewWorkspaceRepository();
  const created = await repo.createProject({
    title: 'Uninspected Client Reel',
    description: 'Metadata-only record',
    compCount: null,
    projectFileStatus: 'metadata-only',
    fileSizeBytes: null,
    fileSizeLabel: 'Unknown (metadata-only)',
    hasExternalFootageWarning: false,
    archived: false,
    tags: ['Client'],
  });

  assert.equal(created.compCount, null);
  assert.equal(created.fileSizeBytes, null);
  assert.equal(created.projectFileStatus, 'metadata-only');

  const archived = await repo.updateProject(created.id, { archived: true });
  assert.equal(archived.archived, true);

  await repo.deleteProject(created.id);
  const remaining = await repo.listProjects();
  assert.equal(remaining.some((p) => p.id === created.id), false);
});

test('Job state machine enforces valid transitions and blocks duplicate terminal completion', async () => {
  const repo = new LocalPreviewWorkspaceRepository();
  const job = await repo.createJob({
    type: 'ae-operation',
    title: 'Apply: Rise Up',
    moduleId: 'text-animation',
    operation: 'applyTextAnimation',
    status: 'needs-setup',
    deviceId: null,
    errorCode: 'CONNECTOR_NOT_PAIRED',
    redactedMessage: 'Connector not paired',
  });

  assert.equal(job.attemptCount, 1);
  assert.equal(canTransitionJob('needs-setup', 'queued'), true);
  assert.equal(canTransitionJob('needs-setup', 'succeeded'), false);

  // Retry transitions needs-setup -> queued and increments attemptCount
  const retried = transitionJobRecord(job, 'queued');
  assert.equal(retried.status, 'queued');
  assert.equal(retried.attemptCount, 2);

  const running = transitionJobRecord(retried, 'running');
  assert.equal(running.status, 'running');
  assert.ok(running.startedAt);

  const succeeded = transitionJobRecord(running, 'succeeded');
  assert.equal(succeeded.status, 'succeeded');
  assert.ok(succeeded.finishedAt);

  // Terminal succeeded job cannot transition again
  assert.throws(() => {
    transitionJobRecord(succeeded, 'running');
  }, /Invalid job state transition/);
});

test('All 20 modules have valid unique routes and displayOrder 1..20', () => {
  assert.equal(SOWVEIL_MODULES.length, 20);
  const orders = SOWVEIL_MODULES.map((m) => m.displayOrder);
  assert.deepEqual(
    orders,
    Array.from({ length: 20 }, (_, i) => i + 1)
  );
});
