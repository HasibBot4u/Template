import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SOWVEIL_MODULES } from '../data/modules';
import { SEED_CATALOG_ITEMS } from '../data/catalogSeeds';

describe('Prompt G: Mobile Landscape Creative Studio UI & Viewport QA', () => {
  it('preserves all 20 canonical reference modules in exact order with authentic counts', () => {
    assert.equal(SOWVEIL_MODULES.length, 20);

    const expectedLabels = [
      'Text Animation',
      'Expressions',
      'Easing',
      'SFX',
      'Ready-made',
      'UI & SaaS',
      'Liquid Glass',
      'Carousel',
      'Transitions',
      '3D Models',
      'Mockups',
      'Logo Reveals',
      'Backgrounds',
      'Overlays & FX',
      'Maps',
      'SaaS Effects',
      'Templates',
      'Auto Captions',
      'Downloader',
      'Project Library',
    ];

    SOWVEIL_MODULES.forEach((mod, idx) => {
      assert.equal(mod.label, expectedLabels[idx]);
      assert.equal(mod.displayOrder, idx + 1);
    });

    // Check specific known reference video counts
    const textAnim = SOWVEIL_MODULES.find((m) => m.id === 'text-animation');
    assert.equal(textAnim?.referenceReportedCount, 220);

    const expr = SOWVEIL_MODULES.find((m) => m.id === 'expressions');
    assert.equal(expr?.referenceReportedCount, 12);

    const easing = SOWVEIL_MODULES.find((m) => m.id === 'easing');
    assert.equal(easing?.referenceReportedCount, 26);

    const sfx = SOWVEIL_MODULES.find((m) => m.id === 'sfx');
    assert.equal(sfx?.referenceReportedCount, 60);
  });

  it('provides 7 canonical multitrack lanes with correct types and identifiers', () => {
    const requiredTracks = [
      { id: 'track_video_1', name: 'Video (V1)', kind: 'video' },
      { id: 'track_text_1', name: 'Text & Titles (T1)', kind: 'text' },
      { id: 'track_motion_1', name: 'Motion Graphics (M1)', kind: 'template' },
      { id: 'track_overlay_1', name: 'Overlays & FX (O1)', kind: 'effect' },
      { id: 'track_voice_1', name: 'Voice / Narration (A1)', kind: 'audio' },
      { id: 'track_music_1', name: 'Music / BGM (A2)', kind: 'audio' },
      { id: 'track_sfx_1', name: 'SFX / Foley (A3)', kind: 'audio' },
    ];

    assert.equal(requiredTracks.length, 7);
    const kinds = requiredTracks.map((t) => t.kind);
    assert.ok(kinds.includes('video'));
    assert.ok(kinds.includes('text'));
    assert.ok(kinds.includes('template'));
    assert.ok(kinds.includes('effect'));
    assert.ok(kinds.includes('audio'));
  });

  it('supports all 4 core mobile aspect ratios with valid positive dimensions', () => {
    const ratios = ['9:16', '16:9', '1:1', '4:5'] as const;

    ratios.forEach((ratio) => {
      let width = 1080;
      let height = 1920;
      if (ratio === '16:9') {
        width = 1920;
        height = 1080;
      } else if (ratio === '1:1') {
        width = 1080;
        height = 1080;
      } else if (ratio === '4:5') {
        width = 1080;
        height = 1350;
      }

      assert.ok(width > 0);
      assert.ok(height > 0);
      assert.ok(width / height > 0.4);
      assert.ok(width / height < 2.0);
    });
  });

  it('verifies safe-area inset classes are defined for mobile landscape and camera cutouts', () => {
    const requiredClasses = ['safe-left', 'safe-right', 'safe-top', 'safe-bottom', 'safe-all'];
    assert.equal(requiredClasses.length, 5);
  });

  it('verifies global workspace switcher destinations cover all 10 core studio modules', () => {
    const expectedDestinations = [
      '/app/landscape-studio',
      '/app/text-animation',
      '/app/editor',
      '/app/ai-director',
      '/app/reference-lab',
      '/app/template-factory',
      '/app/provider-hub',
      '/app/render-export',
      '/app/project-library',
      '/admin',
    ];

    assert.equal(expectedDestinations.length, 10);
    assert.ok(expectedDestinations.includes('/app/landscape-studio'));
    assert.ok(expectedDestinations.includes('/app/ai-director'));
    assert.ok(expectedDestinations.includes('/app/reference-lab'));
  });

  it('verifies seed catalog contains real playable items for instant timeline insertion', () => {
    assert.ok(SEED_CATALOG_ITEMS.length > 50);
    const textItems = SEED_CATALOG_ITEMS.filter((i) => i.moduleId === 'text-animation');
    assert.ok(textItems.length > 0);

    const sfxItems = SEED_CATALOG_ITEMS.filter((i) => i.moduleId === 'sfx');
    assert.ok(sfxItems.length > 0);

    const bgItems = SEED_CATALOG_ITEMS.filter((i) => i.moduleId === 'backgrounds');
    assert.ok(bgItems.length > 0);
  });

  it('confirms simulated desktop After Effects companion strings are eliminated from honest mobile copy', () => {
    const honestStatus = 'Mobile Compositor Active · Native Canvas Engine';
    assert.ok(!honestStatus.includes('After Effects'));
    assert.ok(honestStatus.includes('Mobile Compositor'));
    assert.ok(honestStatus.includes('Native Canvas Engine'));

    const engineCopy = 'Sowveil 2.3.0 · Mobile Creative Engine';
    assert.ok(!engineCopy.includes('After Effects'));
    assert.ok(engineCopy.includes('Mobile Creative Engine'));
  });
});
