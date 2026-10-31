import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { createApiApp } from '../server/apiApp';
import {
  AuthoritativeFirestorePersistenceAdapter,
  RuleEnforcingFirestoreTestDriver,
} from '../server/persistenceAdapters';
import {
  createMinimalCanonicalProject,
  serializeCanonicalProject,
} from '../services/canonicalProjectEngine';
import { InMemoryTestWorkspaceRepository } from '../repositories/workspaceRepository';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function startTestServer(options: Parameters<typeof createApiApp>[0]): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = createApiApp({
    tokenVerifier: async (token: string) => {
      if (token === 'test-user-alice') {
        return {
          uid: 'user-alice',
          email: 'alice@example.com',
          emailVerified: true,
        };
      }
      if (token === 'test-user-bob') {
        return {
          uid: 'user-bob',
          email: 'bob@example.com',
          emailVerified: true,
        };
      }
      throw new Error('INVALID_TOKEN');
    },
    ...options,
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

async function apiJson<T = any>(
  baseUrl: string,
  endpoint: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {}
): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const json = (await res.json()) as T;
  return { status: res.status, json };
}

async function runPhase2BTests() {
  console.log('Running Phase 2B Projects & Canonical Timeline Consistency Tests...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sowveil-phase2b-'));
  const snapshotPath = path.join(tmpDir, 'durable-store.json');
  const sharedFirestoreDriver = new RuleEnforcingFirestoreTestDriver();

  const makeFirestoreAdapter = () =>
    new AuthoritativeFirestorePersistenceAdapter({
      driver: sharedFirestoreDriver,
    });

  // =========================================================================
  // 1. E2E FLOW: CREATE -> OPEN -> EDIT -> SAVE -> RELOAD -> RENDER & EXTRACT
  // =========================================================================
  {
    const srv = await startTestServer({
      persistenceFilePath: snapshotPath,
      persistenceAdapter: makeFirestoreAdapter(),
    });

    try {
      const initialCanonical = createMinimalCanonicalProject({
        id: 'proj_e2e_phase2b_01',
        ownerUid: 'user-alice',
        title: 'Phase 2B Canonical Launch Reel',
        aspectRatio: '9:16',
        fps: 60,
        durationSec: 6,
      });

      // Step 1: Create in Project Library with explicit stable ID
      const createRes = await apiJson(srv.baseUrl, '/api/v1/projects', {
        method: 'POST',
        token: 'test-user-alice',
        body: {
          id: 'proj_e2e_phase2b_01',
          title: initialCanonical.title,
          description: 'Created in Project Library with stable ID',
          projectFileStatus: 'sowveil-native',
          targetEditor: 'sowveil-project',
          aspectRatio: '9:16',
          fps: 60,
          canonicalProjectJson: serializeCanonicalProject(initialCanonical),
          revision: 1,
        },
      });
      assert(createRes.status === 201, `Expected 201 on project create, got ${createRes.status}`);
      assert(
        createRes.json.data.id === 'proj_e2e_phase2b_01',
        `Expected stable ID proj_e2e_phase2b_01, got ${createRes.json.data.id}`
      );
      assert(
        createRes.json.data.revision === 1,
        `Expected initial revision 1, got ${createRes.json.data.revision}`
      );

      // Step 2: Open project via GET /api/v1/projects/:id and /canonical
      const openRes = await apiJson(srv.baseUrl, '/api/v1/projects/proj_e2e_phase2b_01', {
        token: 'test-user-alice',
      });
      assert(openRes.status === 200, 'Expected 200 opening project by ID');
      assert(openRes.json.data.id === 'proj_e2e_phase2b_01', 'Opened project ID must match');
      assert(openRes.json.data.revision === 1, 'Opened project revision must be 1');

      const openCanonRes = await apiJson(
        srv.baseUrl,
        '/api/v1/projects/proj_e2e_phase2b_01/canonical',
        { token: 'test-user-alice' }
      );
      assert(openCanonRes.status === 200, 'Expected 200 opening canonical project');
      assert(
        openCanonRes.json.data.project.id === 'proj_e2e_phase2b_01',
        'Canonical project ID must match library project ID'
      );
      assert(
        openCanonRes.json.data.project.revision === 1,
        'Canonical project revision must be 1'
      );

      // Step 3: Edit via /api/v1/editor/command (Editing Studio command path) with expectedRevision
      const editCmd1 = await apiJson(srv.baseUrl, '/api/v1/editor/command', {
        method: 'POST',
        token: 'test-user-alice',
        body: {
          projectId: 'proj_e2e_phase2b_01',
          expectedRevision: 1,
          command: {
            type: 'renameProject',
            title: 'Phase 2B Canonical Launch Reel — Edited in Studio',
          },
        },
      });
      assert(editCmd1.status === 200, `Expected 200 on editor command 1, got ${editCmd1.status}`);
      assert(
        editCmd1.json.data.project.id === 'proj_e2e_phase2b_01',
        'Editor command must preserve project ID'
      );
      assert(
        editCmd1.json.data.project.revision === 2,
        `Expected revision 2 after edit command 1, got ${editCmd1.json.data.project.revision}`
      );

      // Step 4: Edit via /api/v1/projects/:id/commands with expectedRevision: 2
      const editCmd2 = await apiJson(
        srv.baseUrl,
        '/api/v1/projects/proj_e2e_phase2b_01/commands',
        {
          method: 'POST',
          token: 'test-user-alice',
          body: {
            expectedRevision: 2,
            command: {
              type: 'addTrack',
              kind: 'overlay',
              name: 'Phase 2B FX Track',
            },
          },
        }
      );
      assert(editCmd2.status === 200, `Expected 200 on project command 2, got ${editCmd2.status}`);
      assert(
        editCmd2.json.data.project.revision === 3,
        `Expected revision 3 after edit command 2, got ${editCmd2.json.data.project.revision}`
      );

      // Step 5: Save via PATCH /api/v1/projects/:id with expectedRevision: 3
      const savePatchRes = await apiJson(
        srv.baseUrl,
        '/api/v1/projects/proj_e2e_phase2b_01',
        {
          method: 'PATCH',
          token: 'test-user-alice',
          body: {
            expectedRevision: 3,
            description: 'Confirmed save from Editing Studio',
            canonicalProjectJson: serializeCanonicalProject(editCmd2.json.data.project),
          },
        }
      );
      assert(savePatchRes.status === 200, `Expected 200 on PATCH save, got ${savePatchRes.status}`);
      assert(
        savePatchRes.json.data.id === 'proj_e2e_phase2b_01',
        'PATCH save must return the same project ID'
      );
      assert(
        savePatchRes.json.data.revision === 4,
        `Expected revision 4 after PATCH save, got ${savePatchRes.json.data.revision}`
      );

      // Step 6: Reload Project Library list and confirm single record with ID & revision 4
      const listRes = await apiJson(srv.baseUrl, '/api/v1/projects', {
        token: 'test-user-alice',
      });
      assert(listRes.status === 200, 'Expected 200 listing projects');
      const matchingProjects = listRes.json.data.items.filter(
        (p: any) => p.id === 'proj_e2e_phase2b_01'
      );
      assert(
        matchingProjects.length === 1,
        `Expected exactly 1 project with ID proj_e2e_phase2b_01, found ${matchingProjects.length}`
      );
      assert(
        matchingProjects[0].revision === 4,
        `Expected listed project revision 4, got ${matchingProjects[0].revision}`
      );
      assert(
        matchingProjects[0].title === 'Phase 2B Canonical Launch Reel — Edited in Studio',
        'Listed project title must reflect Editing Studio rename'
      );

      // Step 7: Template Factory immediately sees Editing Studio changes by projectId
      const tfPreviewRes = await apiJson(
        srv.baseUrl,
        '/api/v1/template-factory/extract-preview',
        {
          method: 'POST',
          token: 'test-user-alice',
          body: {
            projectId: 'proj_e2e_phase2b_01',
          },
        }
      );
      assert(
        tfPreviewRes.status === 200,
        `Expected 200 from template-factory extract-preview, got ${tfPreviewRes.status}`
      );

      // Step 8: Render/Export QA immediately renders the committed revision (r4) using projectId
      const renderRes = await apiJson(srv.baseUrl, '/api/v1/render-export/jobs', {
        method: 'POST',
        token: 'test-user-alice',
        body: {
          projectId: 'proj_e2e_phase2b_01',
          expectedProjectRevision: 4,
          executionTier: 'final-render',
          outputFormat: 'sowveil-json',
          targetAdapter: 'sowveil-project',
        },
      });
      assert(
        renderRes.status === 201,
        `Expected 201 from render-export/jobs, got ${renderRes.status}`
      );
      assert(
        renderRes.json.data.job.projectId === 'proj_e2e_phase2b_01',
        `Expected render job projectId proj_e2e_phase2b_01, got ${renderRes.json.data.job.projectId}`
      );
      assert(
        renderRes.json.data.job.projectRevision === 4,
        `Expected render job projectRevision 4, got ${renderRes.json.data.job.projectRevision}`
      );
      assert(
        renderRes.json.data.job.projectTitle ===
          'Phase 2B Canonical Launch Reel — Edited in Studio',
        `Expected render job projectTitle to match latest Editing Studio save, got ${renderRes.json.data.job.projectTitle}`
      );
      assert(
        renderRes.json.data.job.stage === 'ready',
        `Expected render job stage ready, got ${renderRes.json.data.job.stage}`
      );

      // Step 9: Stale revision conflict tests (409 REVISION_CONFLICT)
      const stalePatchRes = await apiJson(
        srv.baseUrl,
        '/api/v1/projects/proj_e2e_phase2b_01',
        {
          method: 'PATCH',
          token: 'test-user-alice',
          body: {
            expectedRevision: 2, // stale (actual is 4)
            title: 'Should Be Rejected Stale Patch',
          },
        }
      );
      assert(
        stalePatchRes.status === 409 &&
          stalePatchRes.json.error?.code === 'REVISION_CONFLICT',
        `Expected 409 REVISION_CONFLICT on stale PATCH, got ${stalePatchRes.status} (${stalePatchRes.json.error?.code})`
      );

      const staleEditorCmdRes = await apiJson(srv.baseUrl, '/api/v1/editor/command', {
        method: 'POST',
        token: 'test-user-alice',
        body: {
          projectId: 'proj_e2e_phase2b_01',
          expectedRevision: 1, // stale (actual is 4)
          command: {
            type: 'renameProject',
            title: 'Should Be Rejected Stale Command',
          },
        },
      });
      assert(
        staleEditorCmdRes.status === 409 &&
          staleEditorCmdRes.json.error?.code === 'REVISION_CONFLICT',
        `Expected 409 REVISION_CONFLICT on stale editor command, got ${staleEditorCmdRes.status}`
      );

      const staleRenderRes = await apiJson(srv.baseUrl, '/api/v1/render-export/jobs', {
        method: 'POST',
        token: 'test-user-alice',
        body: {
          projectId: 'proj_e2e_phase2b_01',
          expectedProjectRevision: 1, // stale (actual is 4)
          executionTier: 'final-render',
          outputFormat: 'sowveil-json',
        },
      });
      assert(
        staleRenderRes.status === 409 &&
          staleRenderRes.json.error?.code === 'REVISION_CONFLICT',
        `Expected 409 REVISION_CONFLICT on stale render job request, got ${staleRenderRes.status}`
      );
    } finally {
      await srv.close();
    }
  }

  // =========================================================================
  // 2. SERVER RESTART PERSISTENCE VERIFICATION
  // =========================================================================
  {
    const srvRestarted = await startTestServer({
      persistenceFilePath: snapshotPath,
      persistenceAdapter: makeFirestoreAdapter(),
    });

    try {
      const afterRestartRes = await apiJson(
        srvRestarted.baseUrl,
        '/api/v1/projects/proj_e2e_phase2b_01',
        { token: 'test-user-alice' }
      );
      assert(
        afterRestartRes.status === 200,
        `Expected 200 loading project after server restart, got ${afterRestartRes.status}`
      );
      assert(
        afterRestartRes.json.data.id === 'proj_e2e_phase2b_01',
        'Project ID must survive server restart'
      );
      assert(
        afterRestartRes.json.data.revision === 4,
        `Expected revision 4 after server restart, got ${afterRestartRes.json.data.revision}`
      );
      assert(
        afterRestartRes.json.data.title ===
          'Phase 2B Canonical Launch Reel — Edited in Studio',
        'Edited title must survive server restart'
      );

      // Cross-user isolation check (user-bob cannot read or mutate user-alice's project)
      const crossUserGet = await apiJson(
        srvRestarted.baseUrl,
        '/api/v1/projects/proj_e2e_phase2b_01',
        { token: 'test-user-bob' }
      );
      assert(
        crossUserGet.status === 403 &&
          crossUserGet.json.error?.code === 'CROSS_USER_ACCESS_FORBIDDEN',
        `Expected 403 CROSS_USER_ACCESS_FORBIDDEN when user-bob reads user-alice project, got ${crossUserGet.status}`
      );
    } finally {
      await srvRestarted.close();
    }
  }

  // =========================================================================
  // 3. AI DIRECTOR SAVE & REFERENCE LAB SAVE -> SAME PROJECT IN LIBRARY
  // =========================================================================
  {
    const srv = await startTestServer({
      persistenceFilePath: snapshotPath,
      persistenceAdapter: makeFirestoreAdapter(),
    });

    try {
      // 3A. AI Director session save-project (twice -> same project ID, revision 1 -> 2)
      const dirCreate = await apiJson(srv.baseUrl, '/api/v1/ai-director/sessions', {
        method: 'POST',
        token: 'test-user-alice',
        body: {
          title: 'Director Unified Project Test',
          scriptText:
            'Hook the viewer in two seconds. Show the product kinetic UI on phone. End with a clear call to action.',
          intendedPlatform: 'youtube-shorts',
          aspectRatio: '9:16',
          noQuestionsWorkflow: true,
        },
      });
      assert(dirCreate.status === 201, `Expected 201 creating AI Director session, got ${dirCreate.status}`);
      const dirSessionId = dirCreate.json.data.session.id;

      // Approve brief & shots and produce timeline so session has canonicalProject
      await apiJson(srv.baseUrl, `/api/v1/ai-director/sessions/${dirSessionId}/plan`, {
        method: 'POST',
        token: 'test-user-alice',
        body: { action: 'approve-all' },
      });
      await apiJson(srv.baseUrl, `/api/v1/ai-director/sessions/${dirSessionId}/produce`, {
        method: 'POST',
        token: 'test-user-alice',
        body: {},
      });

      const dirSave1 = await apiJson(
        srv.baseUrl,
        `/api/v1/ai-director/sessions/${dirSessionId}/save-project`,
        {
          method: 'POST',
          token: 'test-user-alice',
        }
      );
      assert(dirSave1.status === 200, `Expected 200 on first AI Director save-project, got ${dirSave1.status}`);
      const dirProjId1 = dirSave1.json.data.project.id;
      const dirRev1 = dirSave1.json.data.project.revision;
      assert(Boolean(dirProjId1), 'AI Director save-project must return a project ID');
      assert(
        typeof dirRev1 === 'number' && dirRev1 >= 1,
        `Expected positive revision on first AI Director save, got ${dirRev1}`
      );

      // Save again from the same AI Director session -> must update the SAME project ID and increment revision monotonically
      const dirSave2 = await apiJson(
        srv.baseUrl,
        `/api/v1/ai-director/sessions/${dirSessionId}/save-project`,
        {
          method: 'POST',
          token: 'test-user-alice',
        }
      );
      assert(dirSave2.status === 200, 'Expected 200 on second AI Director save-project');
      assert(
        dirSave2.json.data.project.id === dirProjId1,
        `AI Director second save must preserve project ID ${dirProjId1}, got ${dirSave2.json.data.project.id}`
      );
      assert(
        dirSave2.json.data.project.revision === dirRev1 + 1,
        `Expected revision ${dirRev1 + 1} on second AI Director save, got ${dirSave2.json.data.project.revision}`
      );

      // Verify Project Library has the AI Director project with revision dirRev1 + 1
      const libCheckDir = await apiJson(
        srv.baseUrl,
        `/api/v1/projects/${dirProjId1}`,
        { token: 'test-user-alice' }
      );
      assert(libCheckDir.status === 200, 'AI Director saved project must be in Project Library');
      assert(
        libCheckDir.json.data.revision === dirRev1 + 1,
        `Project Library must reflect revision ${dirRev1 + 1}`
      );

      // 3B. Reference Lab session save-project (twice -> same project ID, revision r -> r + 1)
      const refCreate = await apiJson(
        srv.baseUrl,
        '/api/v1/reference-lab/sessions',
        {
          method: 'POST',
          token: 'test-user-alice',
          body: {
            usageMode: 'authorized-reconstruction',
            sourceKind: 'uploaded-video',
            title: 'Reference Lab Unified Project Test',
          },
        }
      );
      assert(refCreate.status === 201, `Expected 201 creating Reference Lab session, got ${refCreate.status}`);
      const refSessionId = refCreate.json.data.session.id;

      const refSave1 = await apiJson(
        srv.baseUrl,
        `/api/v1/reference-lab/sessions/${refSessionId}/save-project`,
        {
          method: 'POST',
          token: 'test-user-alice',
        }
      );
      assert(refSave1.status === 201, `Expected 201 on first Reference Lab save-project, got ${refSave1.status}`);
      const refProjId1 = refSave1.json.data.project.id;
      const refRev1 = refSave1.json.data.project.revision;
      assert(
        typeof refRev1 === 'number' && refRev1 >= 1,
        `Expected positive revision on first Reference Lab save, got ${refRev1}`
      );

      const refSave2 = await apiJson(
        srv.baseUrl,
        `/api/v1/reference-lab/sessions/${refSessionId}/save-project`,
        {
          method: 'POST',
          token: 'test-user-alice',
        }
      );
      assert(refSave2.status === 201, 'Expected 201 on second Reference Lab save-project');
      assert(
        refSave2.json.data.project.id === refProjId1,
        `Reference Lab second save must preserve project ID ${refProjId1}, got ${refSave2.json.data.project.id}`
      );
      assert(
        refSave2.json.data.project.revision === refRev1 + 1,
        `Expected revision ${refRev1 + 1} on second Reference Lab save, got ${refSave2.json.data.project.revision}`
      );

      const libCheckRef = await apiJson(
        srv.baseUrl,
        `/api/v1/projects/${refProjId1}`,
        { token: 'test-user-alice' }
      );
      assert(libCheckRef.status === 200, 'Reference Lab saved project must be in Project Library');
      assert(
        libCheckRef.json.data.revision === refRev1 + 1,
        `Project Library must reflect revision ${refRev1 + 1}`
      );
    } finally {
      await srv.close();
    }
  }

  // =========================================================================
  // 4. CLIENT REPOSITORY ID PRESERVATION & REVISION CONFLICT TESTS
  // =========================================================================
  {
    const repo = new InMemoryTestWorkspaceRepository();
    const created = await repo.createProject({
      id: 'proj_client_stable_01',
      ownerUid: 'user-alice',
      title: 'Client Stable Project',
      description: 'Testing stable ID preservation',
      compCount: 1,
      projectFileStatus: 'sowveil-native',
      fileSizeBytes: 1024,
      fileSizeLabel: '1.0 KB',
      hasExternalFootageWarning: false,
      archived: false,
      tags: ['Test'],
      revision: 1,
    });
    assert(
      created.id === 'proj_client_stable_01',
      `Expected InMemoryTestWorkspaceRepository to preserve ID proj_client_stable_01, got ${created.id}`
    );

    const updated = await repo.updateProject('proj_client_stable_01', {
      title: 'Client Stable Project v2',
      expectedRevision: 1,
    });
    assert(updated.id === 'proj_client_stable_01', 'Update must preserve project ID');
    assert(updated.revision === 2, `Expected revision 2, got ${updated.revision}`);

    let conflictCaught = false;
    try {
      await repo.updateProject('proj_client_stable_01', {
        title: 'Stale Client Update',
        expectedRevision: 1,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('REVISION_CONFLICT')) {
        conflictCaught = true;
      }
    }
    assert(
      conflictCaught,
      'Expected InMemoryTestWorkspaceRepository.updateProject to throw REVISION_CONFLICT on stale expectedRevision'
    );
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('All Phase 2B Projects & Canonical Timeline Consistency Tests passed!');
}

runPhase2BTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
