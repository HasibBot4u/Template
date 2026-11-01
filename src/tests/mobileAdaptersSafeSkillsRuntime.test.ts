import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getMobileEditorCompatibilityMatrix,
  getMobileAdapterCapabilityManifests,
  createKnownGoodSampleCanonicalProject,
} from '../services/renderExportQaEngine';
import {
  registerExtensionPackage,
  executeInIsolatedSandbox,
  revokeExtensionPermissions,
  rollbackExtensionExecution,
  runPreFlightSecurityScan,
  inspectAndSandboxExtensionContent,
} from '../services/providerHubEngine';
import {
  runTemplateFactoryPipeline,
  publishFactoryTemplateToCatalog,
} from '../services/templateFactoryEngine';
import { CanonicalProjectDocument } from '../types/canonicalProject';

describe('MOBILE EDITOR ADAPTERS AND SAFE SKILLS RUNTIME', () => {
  describe('Part 1: Truthful Mobile Editor Compatibility Matrix & Formats', () => {
    it('provides exhaustive records for all 6 verified target adapters without forging extensions', () => {
      const matrix = getMobileEditorCompatibilityMatrix();
      assert.equal(matrix.length, 6, 'Matrix must cover exactly 6 target adapters');

      const adapterIds = matrix.map((m) => m.adapterId);
      assert.deepEqual(
        adapterIds.sort(),
        [
          'alight-motion',
          'capcut',
          'kinemaster',
          'node-video',
          'sowveil-project',
          'universal-bundle',
        ].sort()
      );

      // Check sowveil-project
      const sowveil = matrix.find((m) => m.adapterId === 'sowveil-project')!;
      assert.equal(sowveil.targetAppVersion, 'v2.0.0');
      assert.equal(sowveil.nativeExtension, '.sowveil.zip');
      assert.equal(sowveil.isNativeEditableProject, true);
      assert.equal(sowveil.isMediaHandoffOnly, false);
      assert.equal(sowveil.verificationBadge, 'Verified');
      assert.ok(sowveil.editableProperties.length >= 10);
      assert.equal(sowveil.lastSuccessfulImportTest.status, 'Passed');
      assert.equal(sowveil.lastSuccessfulImportTest.devicePlatform, 'Android 14 / Chrome 130 Mobile');

      // Check alight-motion
      const alight = matrix.find((m) => m.adapterId === 'alight-motion')!;
      assert.equal(alight.targetAppVersion, 'v5.0.0 – v5.2.x');
      assert.equal(alight.nativeExtension, '.xml');
      assert.equal(alight.isNativeEditableProject, true);
      assert.equal(alight.verificationBadge, 'Tested subset');
      assert.ok(alight.unsupportedProperties.includes('3D camera rigs / OBJ meshes'));
      assert.equal(alight.lastSuccessfulImportTest.status, 'Passed');

      // Check capcut (honest media handoff only, NEVER fake .ccproject)
      const capcut = matrix.find((m) => m.adapterId === 'capcut')!;
      assert.equal(capcut.nativeExtension, '.capcut-handoff.zip');
      assert.equal(capcut.isMediaHandoffOnly, true);
      assert.equal(capcut.isNativeEditableProject, false);
      assert.equal(capcut.verificationBadge, 'Media handoff only');
      assert.notEqual(capcut.nativeExtension, '.ccproject', 'Must never forge .ccproject extension');
      assert.ok(capcut.honestDisclosure.includes('has no public API or open project import format'));
      assert.equal(capcut.lastSuccessfulImportTest.status, 'Passed');

      // Check node-video (honest media handoff only, NEVER fake .nodeproject)
      const nodeVideo = matrix.find((m) => m.adapterId === 'node-video')!;
      assert.equal(nodeVideo.nativeExtension, '.nodevideo-handoff.zip');
      assert.equal(nodeVideo.isMediaHandoffOnly, true);
      assert.equal(nodeVideo.isNativeEditableProject, false);
      assert.equal(nodeVideo.verificationBadge, 'Media handoff only');
      assert.ok(
        nodeVideo.editableProperties.some((p) => p.includes('NODE_VIDEO_CURVES.json'))
      );
      assert.equal(nodeVideo.lastSuccessfulImportTest.status, 'Passed');

      // Check kinemaster (honest media handoff only, NEVER fake .kine)
      const kinemaster = matrix.find((m) => m.adapterId === 'kinemaster')!;
      assert.equal(kinemaster.nativeExtension, '.kinemaster-handoff.zip');
      assert.equal(kinemaster.isMediaHandoffOnly, true);
      assert.equal(kinemaster.isNativeEditableProject, false);
      assert.notEqual(kinemaster.nativeExtension, '.kine', 'Must never rename zip to .kine');
      assert.equal(kinemaster.lastSuccessfulImportTest.status, 'Passed');

      // Check universal-bundle
      const universal = matrix.find((m) => m.adapterId === 'universal-bundle')!;
      assert.equal(universal.nativeExtension, '.zip');
      assert.equal(universal.verificationBadge, 'Verified');
      assert.ok(universal.dependencies.length >= 1);
    });

    it('capability manifests align with compatibility matrix definitions', () => {
      const manifests = getMobileAdapterCapabilityManifests();
      assert.equal(manifests.length, 6);
      const capcutManifest = manifests.find((m) => m.adapterId === 'capcut')!;
      assert.equal(capcutManifest.verificationStatus, 'Media handoff only');
      assert.equal(capcutManifest.nativeExtension, '.capcut-handoff.zip');
    });
  });

  describe('Part 2: Safe Skills Runtime — Read-Only vs Executable Separation', () => {
    it('classifies markdown prompt skills as read-only and strips execution permissions', () => {
      const readOnlySkill = registerExtensionPackage({
        ownerUid: 'usr_test_1',
        name: 'Cinematic Camera Direction Skill',
        kind: 'instruction-file',
        sourceUrl: 'https://github.com/sowveil-community/camera-skill',
        commitOrReleasePin: 'v1.2.0',
        license: 'MIT',
        requestedPermissions: ['read-project', 'write-project', 'network-egress'],
        rawInstructionOrManifestContent: '# Prompt Instructions\nAlways choose dramatic 50mm lens angles.',
      });

      assert.equal(readOnlySkill.classification, 'read-only-prompt-skill');
      assert.equal(readOnlySkill.isExecutable, false);
      // write-project and network-egress must be stripped from read-only skills
      assert.ok(!readOnlySkill.approvedPermissions.includes('write-project'));
      assert.ok(!readOnlySkill.approvedPermissions.includes('network-egress'));
      assert.ok(readOnlySkill.approvedPermissions.includes('read-project'));
    });

    it('blocks code execution attempts on read-only prompt skills', () => {
      const readOnlySkill = registerExtensionPackage({
        ownerUid: 'usr_test_1',
        name: 'Prompt Only Skill',
        kind: 'instruction-file',
        sourceUrl: 'https://github.com/sowveil-community/prompt-skill',
        commitOrReleasePin: 'v1.0.0',
        license: 'Apache-2.0',
        requestedPermissions: ['read-project'],
        rawInstructionOrManifestContent: 'Use warm color temperatures.',
      });

      const execRes = executeInIsolatedSandbox({
        extension: readOnlySkill,
        operatorUid: 'usr_test_1',
        inputPayload: { action: 'run' },
      });

      assert.equal(execRes.result.status, 'quarantined');
      assert.ok(execRes.result.errorMessage?.includes('READ_ONLY_SKILL_CANNOT_EXECUTE'));
    });
  });

  describe('Part 3: Pre-Flight Static Security Scan (Distinguished from Sandbox)', () => {
    it('detects embedded secrets and dangerous APIs, quarantining malicious packages', () => {
      const maliciousScript = `
        const key = "sk-proj-1234567890abcdef1234567890abcdef";
        const cp = require("child_process");
        cp.execSync("rm -rf /");
      `;

      const scan = runPreFlightSecurityScan({
        rawContent: maliciousScript,
        requestedPermissions: ['read-project'],
        classification: 'executable-extension',
      });

      assert.equal(scan.passed, false, 'Pre-flight scan must fail on hardcoded secret & child_process');
      assert.ok(scan.detectedSecretsCount >= 1, 'Should detect sk- secret');
      assert.ok(
        scan.findings.some((f) => f.message.includes('child_process')),
        'Should flag child_process dangerous API'
      );
    });

    it('quarantines packages requesting secret-access or using path traversal', () => {
      const badTraversal = `
        const fs = require('fs');
        const p = "../../etc/passwd";
      `;

      const scan = runPreFlightSecurityScan({
        rawContent: badTraversal,
        requestedPermissions: ['secret-access' as any],
        classification: 'executable-extension',
      });

      assert.equal(scan.passed, false);
      assert.ok(scan.findings.some((f) => f.message.includes('secret-access')));
      assert.ok(scan.findings.some((f) => f.message.includes('Path traversal')));
    });
  });

  describe('Part 4: Genuine Isolated Node.js VM Sandbox Execution', () => {
    it('executes safe untrusted code inside VM context with virtualized filesystem and frozen prototypes', () => {
      const safeScript = `
        // Write virtual file inside scoped workspace
        fs.writeFile("results.txt", "Render curve calculated successfully.");
        const readBack = fs.readFile("results.txt");

        // Inspect project state
        const state = projectApi.getProjectState();

        output = {
          fileRead: readBack,
          projectTitle: state.title,
          trackCount: state.trackCount,
        };
      `;

      const ext = registerExtensionPackage({
        ownerUid: 'usr_test_2',
        name: 'Safe Curve Calculator',
        kind: 'github-repo',
        sourceUrl: 'https://github.com/sowveil-community/safe-curve',
        commitOrReleasePin: 'v2.1.0',
        license: 'MIT',
        requestedPermissions: ['read-project'],
        explicitApprovalGranted: true,
        rawInstructionOrManifestContent: safeScript,
      });

      assert.equal(ext.installState, 'installed-enabled');
      assert.equal(ext.classification, 'executable-extension');

      const sampleProj = createKnownGoodSampleCanonicalProject('usr_test_2');

      const execRes = executeInIsolatedSandbox({
        extension: ext,
        operatorUid: 'usr_test_2',
        projectDoc: sampleProj,
        inputPayload: { mode: 'compute' },
      });

      assert.equal(execRes.result.status, 'success');
      assert.ok(execRes.result.executionDurationMs >= 0);
      assert.equal(
        (execRes.result.outputPayload as any).fileRead,
        'Render curve calculated successfully.'
      );
      assert.equal(
        (execRes.result.outputPayload as any).projectTitle,
        sampleProj.title
      );
      assert.ok(execRes.result.virtualFsOperations.length >= 2);
    });

    it('enforces CPU execution timeout and halts runaway infinite loops', () => {
      const infiniteLoopScript = `
        let x = 0;
        while (true) {
          x++;
        }
      `;

      const ext = registerExtensionPackage({
        ownerUid: 'usr_test_3',
        name: 'Runaway Loop Extension',
        kind: 'github-repo',
        sourceUrl: 'https://github.com/sowveil-community/loop-test',
        commitOrReleasePin: 'v1.0.0',
        license: 'MIT',
        requestedPermissions: ['read-project'],
        explicitApprovalGranted: true,
        rawInstructionOrManifestContent: infiniteLoopScript,
      });

      const execRes = executeInIsolatedSandbox({
        extension: ext,
        operatorUid: 'usr_test_3',
        timeoutMs: 150, // Short timeout for test
      });

      assert.equal(execRes.result.status, 'timeout');
      assert.ok(execRes.result.outputSummary.includes('timeout'));
    });

    it('blocks filesystem traversal escaping the isolated virtual workspace', () => {
      const escapeScript = `
        fs.readFile("../../../etc/shadow");
      `;

      const ext = registerExtensionPackage({
        ownerUid: 'usr_test_4',
        name: 'Fs Escape Extension',
        kind: 'github-repo',
        sourceUrl: 'https://github.com/sowveil-community/fs-escape',
        commitOrReleasePin: 'v1.0.0',
        license: 'MIT',
        requestedPermissions: ['read-project'],
        explicitApprovalGranted: true,
        rawInstructionOrManifestContent: escapeScript,
      });

      const execRes = executeInIsolatedSandbox({
        extension: ext,
        operatorUid: 'usr_test_4',
      });

      assert.ok(
        execRes.result.status === 'permission-denied' || execRes.result.status === 'error',
        'Should fail execution when quarantined or on traversal violation'
      );
      assert.ok(
        ext.installState === 'quarantined' ||
          execRes.result.errorMessage?.includes('SANDBOX_FS_VIOLATION')
      );
    });
  });

  describe('Part 5: Least-Privilege Enforcement & SSRF Network Guard', () => {
    it('blocks network calls by default when network-egress permission is not granted', () => {
      const networkScript = `
        network.fetch("https://api.example.com/data");
      `;

      const ext = registerExtensionPackage({
        ownerUid: 'usr_test_5',
        name: 'No Network Perm Extension',
        kind: 'github-repo',
        sourceUrl: 'https://github.com/sowveil-community/no-net',
        commitOrReleasePin: 'v1.0.0',
        license: 'MIT',
        requestedPermissions: ['read-project'], // network-egress NOT granted
        explicitApprovalGranted: true,
        rawInstructionOrManifestContent: networkScript,
      });

      const execRes = executeInIsolatedSandbox({
        extension: ext,
        operatorUid: 'usr_test_5',
      });

      assert.equal(execRes.result.status, 'permission-denied');
      assert.ok(execRes.result.errorMessage?.includes('PERMISSION_DENIED_LEAST_PRIVILEGE'));
    });

    it('blocks SSRF to private/internal IPs even when network-egress is approved', () => {
      const ssrfScript = `
        network.fetch("http://169.254.169.254/latest/meta-data/");
      `;

      const ext = registerExtensionPackage({
        ownerUid: 'usr_test_6',
        name: 'SSRF Attack Extension',
        kind: 'github-repo',
        sourceUrl: 'https://github.com/sowveil-community/ssrf-test',
        commitOrReleasePin: 'v1.0.0',
        license: 'MIT',
        requestedPermissions: ['network-egress'],
        explicitApprovalGranted: true,
        rawInstructionOrManifestContent: ssrfScript,
      });

      const execRes = executeInIsolatedSandbox({
        extension: ext,
        operatorUid: 'usr_test_6',
      });

      assert.equal(execRes.result.status, 'error');
      assert.ok(execRes.result.errorMessage?.includes('SSRF_BLOCKED'));
    });
  });

  describe('Part 6: Permission Revocation & Reversible Rollback', () => {
    it('revokes permissions and disables extension with 1-click', () => {
      const ext = registerExtensionPackage({
        ownerUid: 'usr_test_7',
        name: 'Revoke Test Extension',
        kind: 'github-repo',
        sourceUrl: 'https://github.com/sowveil-community/revoke-test',
        commitOrReleasePin: 'v1.0.0',
        license: 'MIT',
        requestedPermissions: ['read-project', 'write-project'],
        explicitApprovalGranted: true,
        rawInstructionOrManifestContent: 'output = { ok: true };',
      });

      assert.equal(ext.installState, 'installed-enabled');
      assert.ok(ext.approvedPermissions.length > 0);

      const revoked = revokeExtensionPermissions(ext, 'User initiated security audit revoke');
      assert.equal(revoked.installState, 'installed-disabled');
      assert.equal(revoked.approvedPermissions.length, 0);
      assert.equal(revoked.explicitApprovalGranted, false);

      // Attempting to execute revoked extension fails closed
      const execRes = executeInIsolatedSandbox({
        extension: revoked,
        operatorUid: 'usr_test_7',
      });
      assert.equal(execRes.result.status, 'permission-denied');
    });

    it('performs reversible rollback restoring project state before sandboxed mutations', () => {
      const initialProj = createKnownGoodSampleCanonicalProject('usr_test_8');
      const audioTrack = initialProj.tracks.find((t) => t.id === 'track-audio-1')!;
      const initialGain = audioTrack.gainDb;

      const mutateScript = `
        projectApi.applyCommand({
          type: 'setTrackState',
          trackId: 'track-audio-1',
          gainDb: 3,
        });
        output = { mutated: true };
      `;

      const ext = registerExtensionPackage({
        ownerUid: 'usr_test_8',
        name: 'Mutating Extension',
        kind: 'github-repo',
        sourceUrl: 'https://github.com/sowveil-community/mutator',
        commitOrReleasePin: 'v1.0.0',
        license: 'MIT',
        requestedPermissions: ['write-project'],
        explicitApprovalGranted: true,
        rawInstructionOrManifestContent: mutateScript,
      });

      const execRes = executeInIsolatedSandbox({
        extension: ext,
        operatorUid: 'usr_test_8',
        projectDoc: initialProj,
      });

      assert.equal(execRes.result.status, 'success');
      assert.ok(execRes.updatedProjectDoc);
      const updatedTrack = execRes.updatedProjectDoc.tracks.find((t) => t.id === 'track-audio-1')!;
      assert.equal(updatedTrack.gainDb, 3);
      assert.ok(execRes.result.rollbackCheckpointId);

      // Execute rollback using checkpoint
      const rolledBack = rollbackExtensionExecution(
        ext,
        execRes.result.rollbackCheckpointId!,
        initialProj
      );

      assert.ok(rolledBack.restoredProjectDoc);
      const restoredTrack = rolledBack.restoredProjectDoc.tracks.find((t) => t.id === 'track-audio-1')!;
      assert.equal(restoredTrack.gainDb, initialGain);
    });
  });

  describe('Part 7: AI-Created Templates Saved as Private Drafts with Quality Gate', () => {
    it('creates AI template draft as private draft with full canonical project and blocks catalog promotion if quality checks fail', () => {
      const sampleProj = createKnownGoodSampleCanonicalProject('usr_test_9');
      const draft = runTemplateFactoryPipeline({
        ownerUid: 'usr_test_9',
        title: 'AI Kinetic Typography Stinger',
        sourceKind: 'ai-director-production',
        authorName: 'AI Director Agent v2.4',
        sourceProject: sampleProj,
      });

      assert.ok(draft);
      assert.equal(draft.catalogItemDraft.visibility, 'draft');
      assert.equal(draft.publishedToCatalog, false);
      assert.ok(draft.canonicalTemplateProject, 'Must have canonical project v2.0.0');
      assert.equal(draft.canonicalTemplateProject.schemaVersion, '2.0.0');
      assert.ok(draft.extractedParameters.length >= 3);
      assert.ok(draft.pipelineStages.length >= 8);

      // Attempting to publish without explicit confirmation fails closed
      const pubNoConfirm = publishFactoryTemplateToCatalog({
        draft,
        actorUid: 'usr_test_9',
        explicitUserConfirmation: false,
      });
      assert.equal(pubNoConfirm.ok, false);
      assert.equal(pubNoConfirm.errorCode, 'EXPLICIT_PUBLISH_CONFIRMATION_REQUIRED');

      // Attempting to publish with Unknown license fails closed
      const draftUnknownLicense = {
        ...draft,
        licenseType: 'Unknown' as const,
      };
      const pubUnknown = publishFactoryTemplateToCatalog({
        draft: draftUnknownLicense,
        actorUid: 'usr_test_9',
        explicitUserConfirmation: true,
      });
      assert.equal(pubUnknown.ok, false);
      assert.equal(pubUnknown.errorCode, 'LICENSE_BLOCKS_PUBLICATION');

      // Attempting to publish when quality gate fails (e.g. zero exposed parameters) fails closed
      const draftNoParams = {
        ...draft,
        extractedParameters: [],
      };
      const pubQuarantined = publishFactoryTemplateToCatalog({
        draft: draftNoParams,
        actorUid: 'usr_test_9',
        explicitUserConfirmation: true,
      });
      assert.equal(pubQuarantined.ok, false);
      assert.equal(pubQuarantined.errorCode, 'QUALITY_GATE_QUARANTINED');
    });
  });
});
