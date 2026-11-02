import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createApiApp, VerifiedTokenIdentity } from '../server/apiApp';
import {
  CanonicalEditorSessionManager,
  createNewUserCanonicalProject,
} from '../services/canonicalEditorSession';
import {
  canonicalProjectToLibraryRecord,
  evaluateProjectAtTime,
} from '../services/canonicalProjectEngine';
import { EASING_CURVE_PRESETS } from '../services/coEditingEngine';
import { LandscapeCreativeStudio } from '../components/LandscapeCreativeStudio';
import { EditingStudioWorkspace } from '../components/EditingStudioWorkspace';
import { CanonicalProjectDocument } from '../types/canonicalProject';
import { ProjectLibraryItem } from '../types/sowveil';

const MOCK_TOKENS: Record<string, VerifiedTokenIdentity> = {
  token_alice: {
    uid: 'user_alice',
    email: 'alice@example.com',
    emailVerified: true,
    displayName: 'Alice Editor',
  },
  token_bob: {
    uid: 'user_bob',
    email: 'bob@example.com',
    emailVerified: true,
    displayName: 'Bob Intruder',
  },
};

async function startTestServer() {
  const app = createApiApp({
    ownerBootstrapEmail: 'owner@example.com',
    ownerBootstrapSecret: 'TEST_SECRET_2026',
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

describe('One Canonical Editor and Real Project Lifecycle Integration Suite', () => {
  it('1. create project -> open landscape -> edit -> save -> reload -> open standard editor -> same ID/revision/content', async () => {
    const srv = await startTestServer();
    try {
      const session = new CanonicalEditorSessionManager('user_alice');
      const createdDoc = session.createNewProject({
        ownerUid: 'user_alice',
        title: 'Unified Lifecycle Launch Cut',
        aspectRatio: '16:9',
        durationSec: 12,
      });

      assert.equal(session.getState().mode, 'active-project');
      assert.equal(session.getState().saveState, 'Unsaved Changes');
      assert.equal(createdDoc.ownerUid, 'user_alice');

      // Initial durable create on authoritative server repository
      const persistedIds = new Set<string>();
      const persister = async (
        record: ProjectLibraryItem,
        expectedRevision?: number
      ): Promise<ProjectLibraryItem> => {
        const id = record.id;
        if (!persistedIds.has(id)) {
          const res = await fetch(`${srv.baseUrl}/api/v1/projects`, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer token_alice',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(record),
          });
          const body = await res.json();
          if (!res.ok) {
            throw new Error(body.error?.message || `HTTP ${res.status}`);
          }
          persistedIds.add(id);
          return body.data as ProjectLibraryItem;
        } else {
          const res = await fetch(`${srv.baseUrl}/api/v1/projects/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: {
              Authorization: 'Bearer token_alice',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...record,
              expectedRevision,
            }),
          });
          const body = await res.json();
          if (!res.ok) {
            throw new Error(body.error?.message || `HTTP ${res.status}`);
          }
          return body.data as ProjectLibraryItem;
        }
      };

      const firstSave = await session.saveProject(persister);
      assert.equal(firstSave.ok, true);
      assert.equal(session.getState().saveState, 'Saved');
      assert.ok(firstSave.record);
      // Verify fileSizeBytes is computed from actual serialized payload (not hardcoded 1024 / 1 KB)
      assert.notEqual(firstSave.record!.fileSizeBytes, 1024);
      assert.ok((firstSave.record!.fileSizeBytes || 0) > 1200);

      // Open in Landscape Studio & perform edits via shared command service
      const landscapeHtmlInitial = renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(LandscapeCreativeStudio, {
            sessionManager: session,
            ownerUid: 'user_alice',
            initialViewportWidth: 1280,
            initialViewportHeight: 720,
          })
        )
      );
      assert.ok(landscapeHtmlInitial.includes('Unified Lifecycle Launch Cut'));
      assert.ok(landscapeHtmlInitial.includes('Saved · r1'));

      // Edit title and clip text in Landscape session
      const targetClipId = session.getState().selectedClipId!;
      assert.ok(targetClipId);

      const renameReceipt = session.dispatchCommand({
        type: 'renameProject',
        title: 'Unified Lifecycle Launch Cut v2',
      });
      assert.equal(renameReceipt.ok, true);

      const textEditReceipt = session.dispatchCommand({
        type: 'setTextProperties',
        clipId: targetClipId,
        textData: {
          content: 'CANONICAL HEADLINE SYNCED',
          colorHex: '#55B98B',
        },
      });
      assert.equal(textEditReceipt.ok, true);
      assert.equal(session.getState().saveState, 'Unsaved Changes');
      const editedRevision = session.getState().project!.revision;
      assert.equal(editedRevision, 3);

      // Save updated canonical document to server
      const secondSave = await session.saveProject(persister);
      assert.equal(secondSave.ok, true);
      assert.equal(session.getState().saveState, 'Saved');

      // Reload into a brand-new session from authoritative server repository (must NOT create a 7-track demo!)
      const reloadedSession = new CanonicalEditorSessionManager('user_alice');
      const loadedDoc = await reloadedSession.loadProjectById(createdDoc.id, {
        ownerUid: 'user_alice',
        fetchCanonicalFromServer: async (projectId: string) => {
          const res = await fetch(
            `${srv.baseUrl}/api/v1/projects/${encodeURIComponent(projectId)}/canonical`,
            {
              headers: { Authorization: 'Bearer token_alice' },
            }
          );
          const body = await res.json();
          if (!res.ok) {
            throw new Error(body.error?.message || `HTTP ${res.status}`);
          }
          return {
            project: body.data.project as CanonicalProjectDocument,
            canUndo: body.data.canUndo,
            canRedo: body.data.canRedo,
          };
        },
      });

      assert.ok(loadedDoc);
      assert.equal(reloadedSession.getState().mode, 'active-project');
      assert.equal(loadedDoc!.id, createdDoc.id);
      assert.equal(loadedDoc!.revision, editedRevision);
      assert.equal(loadedDoc!.title, 'Unified Lifecycle Launch Cut v2');

      const reloadedTextClip = loadedDoc!.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === targetClipId);
      assert.ok(reloadedTextClip);
      assert.equal(reloadedTextClip!.textData?.content, 'CANONICAL HEADLINE SYNCED');
      assert.equal(reloadedTextClip!.textData?.colorHex, '#55B98B');

      // Open Standard Editor (/app/editor) bound to the same reloadedSession and verify identical ID, revision, and content
      const standardEditorHtml = renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(EditingStudioWorkspace, {
            mode: 'standalone-route',
            sessionManager: reloadedSession,
            ownerUid: 'user_alice',
            onSaveToProjectLibrary: async () => {},
            onNotify: () => {},
          })
        )
      );

      assert.ok(standardEditorHtml.includes('Unified Lifecycle Launch Cut v2'));
      assert.ok(standardEditorHtml.includes(`Saved · r${editedRevision}`));
      assert.ok(
        standardEditorHtml.includes(
          `/app/landscape-studio/${encodeURIComponent(createdDoc.id)}`
        )
      );
    } finally {
      await srv.close();
    }
  });

  it('2. keyframe command mutates canonical state, updates existing keyframe at same playhead/property, and applies easing presets', () => {
    const session = new CanonicalEditorSessionManager('user_alice');
    session.createNewProject({
      ownerUid: 'user_alice',
      title: 'Keyframe & Easing Test Project',
    });

    const clipId = session.getState().selectedClipId!;
    assert.ok(clipId);

    // Move playhead to 1.25s and set opacity to 0.45
    session.setTransport({ playheadSec: 1.25 });
    session.dispatchCommand({
      type: 'setTransform',
      clipId,
      transform: { opacity: 0.45 },
    });

    // Execute toolbar Keyframe command at playhead (1.25s) for opacity
    const addReceipt = session.upsertKeyframeAtPlayhead({ property: 'opacity' });
    assert.ok(addReceipt);
    assert.equal(addReceipt!.ok, true);
    assert.equal(addReceipt!.commandType, 'addKeyframe');

    let updatedClip = session
      .getState()
      .project!.tracks.flatMap((t) => t.clips)
      .find((c) => c.id === clipId)!;
    assert.equal(updatedClip.keyframes.length, 1);
    const kfId = updatedClip.keyframes[0].id;
    assert.equal(updatedClip.keyframes[0].property, 'opacity');
    assert.equal(updatedClip.keyframes[0].timeSec, 1.25);
    assert.equal(updatedClip.keyframes[0].value, 0.45);
    assert.equal(session.getState().selectedKeyframeId, kfId);

    // Update opacity at same playhead (1.25s) and invoke upsertKeyframeAtPlayhead again -> updates existing keyframe
    session.dispatchCommand({
      type: 'setTransform',
      clipId,
      transform: { opacity: 0.85 },
    });
    const updateReceipt = session.upsertKeyframeAtPlayhead({
      property: 'opacity',
      value: 0.85,
    });
    assert.ok(updateReceipt);
    assert.equal(updateReceipt!.ok, true);
    assert.equal(updateReceipt!.commandType, 'updateKeyframe');

    updatedClip = session
      .getState()
      .project!.tracks.flatMap((t) => t.clips)
      .find((c) => c.id === clipId)!;
    assert.equal(updatedClip.keyframes.length, 1);
    assert.equal(updatedClip.keyframes[0].id, kfId);
    assert.equal(updatedClip.keyframes[0].value, 0.85);

    // Apply Easing Curve Preset from EASING_CURVE_PRESETS to selected keyframe
    const preset = EASING_CURVE_PRESETS[0]; // Expo Out (Snappy)
    assert.ok(preset);
    const easingReceipt = session.applyEasingPresetToSelection(
      preset.id,
      'user_alice'
    );
    assert.equal(easingReceipt?.ok, true);

    updatedClip = session
      .getState()
      .project!.tracks.flatMap((t) => t.clips)
      .find((c) => c.id === clipId)!;
    assert.equal(updatedClip.keyframes[0].easingPresetId, preset.id);
    assert.deepEqual(updatedClip.keyframes[0].cubicBezier, preset.points);

    // Add a second keyframe at 2.25s so interpolation evaluates across the segment
    session.setTransport({ playheadSec: 2.25 });
    const secondAdd = session.upsertKeyframeAtPlayhead({
      property: 'opacity',
      value: 0.15,
    });
    assert.ok(secondAdd);
    assert.equal(secondAdd!.ok, true);
    assert.equal(secondAdd!.commandType, 'addKeyframe');

    const evalMid = evaluateProjectAtTime(session.getState().project!, 1.75);
    const midClip = evalMid.find((f) => f.clip.id === clipId);
    assert.ok(midClip);
    assert.ok(midClip!.transform.opacity < 0.85 && midClip!.transform.opacity >= 0.15);

    // Delete keyframe
    const removeReceipt = session.dispatchCommand({
      type: 'removeKeyframe',
      clipId,
      keyframeId: kfId,
    });
    assert.equal(removeReceipt.ok, true);
    updatedClip = session
      .getState()
      .project!.tracks.flatMap((t) => t.clips)
      .find((c) => c.id === clipId)!;
    assert.equal(updatedClip.keyframes.length, 1);
    assert.notEqual(updatedClip.keyframes[0].id, kfId);
  });

  it('3. drag/trim, split, duplicate, track reorder/lock/mute, and marker commands mutate canonical state and persist', async () => {
    const srv = await startTestServer();
    try {
      const session = new CanonicalEditorSessionManager('user_alice');
      session.enterExplicitDemoMode('user_alice');
      assert.equal(session.getState().mode, 'demo');

      // Create user project to test full timeline gesture commands + server persistence
      const userDoc = session.createNewProject({
        ownerUid: 'user_alice',
        title: 'Timeline Gestures & Persistence Cut',
      });
      const clipId = session.getState().selectedClipId!;
      const trackId = session.getState().selectedTrackId!;

      // Move clip (drag gesture equivalent)
      const moveRes = session.dispatchCommand({
        type: 'moveClip',
        clipId,
        startTimeSec: 1.5,
      });
      assert.equal(moveRes.ok, true);

      // Trim clip head & tail (trim gesture equivalent)
      const trimRes = session.dispatchCommand({
        type: 'trimClip',
        clipId,
        startTimeSec: 1.8,
        durationSec: 3.2,
      });
      assert.equal(trimRes.ok, true);

      // Split clip at 3.0s
      const splitRes = session.dispatchCommand({
        type: 'splitClip',
        clipId,
        splitTimeSec: 3.0,
      });
      assert.equal(splitRes.ok, true);

      // Duplicate first half clip
      const dupRes = session.dispatchCommand({
        type: 'duplicateClip',
        clipId,
      });
      assert.equal(dupRes.ok, true);

      // Track mute & reorder
      const trackStateRes = session.dispatchCommand({
        type: 'setTrackState',
        trackId,
        muted: true,
        order: 3,
      });
      assert.equal(trackStateRes.ok, true);

      // Add timeline marker
      const markerRes = session.dispatchCommand({
        type: 'addMarker',
        marker: {
          label: 'Beat Drop Sync',
          timeSec: 2.4,
          colorHex: '#F06424',
          kind: 'beat',
        },
      });
      assert.equal(markerRes.ok, true);

      // Undo and Redo verification
      const revBeforeUndo = session.getState().project!.revision;
      const undoRes = session.undo();
      assert.equal(undoRes.ok, true);
      assert.equal(session.getState().project!.markers.length, 1); // initial starter marker only

      const redoRes = session.redo();
      assert.equal(redoRes.ok, true);
      assert.equal(session.getState().project!.markers.length, 2);
      assert.equal(session.getState().project!.revision, revBeforeUndo);

      // Persist to server and fetch back canonical document
      const saveRes = await session.saveProject(async (record) => {
        const res = await fetch(`${srv.baseUrl}/api/v1/projects`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_alice',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(record),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error?.message || 'Save failed');
        return body.data as ProjectLibraryItem;
      });
      assert.equal(saveRes.ok, true);

      const verifyRes = await fetch(
        `${srv.baseUrl}/api/v1/projects/${encodeURIComponent(userDoc.id)}/canonical`,
        {
          headers: { Authorization: 'Bearer token_alice' },
        }
      );
      assert.equal(verifyRes.status, 200);
      const verifyBody = await verifyRes.json();
      const serverCanonical: CanonicalProjectDocument =
        verifyBody.data.project;

      assert.equal(serverCanonical.id, userDoc.id);
      assert.ok(
        serverCanonical.markers.some((m) => m.label === 'Beat Drop Sync')
      );
      const serverTrack = serverCanonical.tracks.find((t) => t.id === trackId)!;
      assert.equal(serverTrack.muted, true);
      assert.equal(serverTrack.clips.length, 3); // split (2) + duplicate (1) = 3 clips
    } finally {
      await srv.close();
    }
  });

  it('4. failed save or revision conflict stays dirty and never reports false Saved state', async () => {
    const session = new CanonicalEditorSessionManager('user_alice');
    session.createNewProject({
      ownerUid: 'user_alice',
      title: 'Dirty State Integrity Project',
    });

    session.dispatchCommand({
      type: 'renameProject',
      title: 'Edited Before Network Failure',
    });
    assert.equal(session.getState().saveState, 'Unsaved Changes');

    // Simulate network/persistence failure
    const failedResult = await session.saveProject(async () => {
      throw new Error('503 Service Unavailable: Upstream database timeout');
    });

    assert.equal(failedResult.ok, false);
    assert.equal(session.getState().saveState, 'Failed');
    assert.equal(session.getState().lastSavedRevision, null);
    assert.ok(session.getState().saveError?.includes('503 Service Unavailable'));

    // Simulate 409 REVISION_CONFLICT
    const conflictResult = await session.saveProject(async () => {
      throw new Error('409 REVISION_CONFLICT: Expected revision 1 but found 4');
    });

    assert.equal(conflictResult.ok, false);
    assert.equal(session.getState().saveState, 'Conflict');
    assert.equal(session.getState().lastSavedRevision, null);
  });

  it('5. cross-user project access is rejected across GET, GET /canonical, PATCH, and POST /commands', async () => {
    const srv = await startTestServer();
    try {
      const aliceDoc = createNewUserCanonicalProject({
        ownerUid: 'user_alice',
        title: 'Alice Private Canonical Project',
      });
      const aliceRecord = {
        ...canonicalProjectToLibraryRecord(aliceDoc),
        id: aliceDoc.id,
        ownerUid: 'user_alice',
      };

      const createRes = await fetch(`${srv.baseUrl}/api/v1/projects`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token_alice',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(aliceRecord),
      });
      assert.equal(createRes.status, 201);

      // Bob attempts GET /api/v1/projects/:id
      const bobGetRes = await fetch(
        `${srv.baseUrl}/api/v1/projects/${encodeURIComponent(aliceDoc.id)}`,
        {
          headers: { Authorization: 'Bearer token_bob' },
        }
      );
      assert.ok(
        bobGetRes.status === 403 || bobGetRes.status === 404,
        `Expected 403 or 404 for cross-user GET, got ${bobGetRes.status}`
      );

      // Bob attempts GET /api/v1/projects/:id/canonical
      const bobCanonicalRes = await fetch(
        `${srv.baseUrl}/api/v1/projects/${encodeURIComponent(aliceDoc.id)}/canonical`,
        {
          headers: { Authorization: 'Bearer token_bob' },
        }
      );
      assert.equal(bobCanonicalRes.status, 403);

      // Bob attempts PATCH /api/v1/projects/:id
      const bobPatchRes = await fetch(
        `${srv.baseUrl}/api/v1/projects/${encodeURIComponent(aliceDoc.id)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: 'Bearer token_bob',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title: 'Hijacked by Bob' }),
        }
      );
      assert.ok(
        bobPatchRes.status === 403 || bobPatchRes.status === 404,
        `Expected 403 or 404 for cross-user PATCH, got ${bobPatchRes.status}`
      );

      // Bob attempts POST /api/v1/projects/:id/commands
      const bobCmdRes = await fetch(
        `${srv.baseUrl}/api/v1/projects/${encodeURIComponent(aliceDoc.id)}/commands`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_bob',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            command: { type: 'renameProject', title: 'Hijacked via Command' },
          }),
        }
      );
      assert.equal(bobCmdRes.status, 403);

      // Verify Alice's project remains untouched
      const aliceVerifyRes = await fetch(
        `${srv.baseUrl}/api/v1/projects/${encodeURIComponent(aliceDoc.id)}/canonical`,
        {
          headers: { Authorization: 'Bearer token_alice' },
        }
      );
      assert.equal(aliceVerifyRes.status, 200);
      const aliceVerifyBody = await aliceVerifyRes.json();
      assert.equal(
        aliceVerifyBody.data.project.title,
        'Alice Private Canonical Project'
      );
    } finally {
      await srv.close();
    }
  });
});
