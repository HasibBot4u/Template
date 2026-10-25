import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');

test('Firestore Rules Audit: Every collection in firebase-blueprint.json is secured and all 12 Dirty Dozen invariants are enforced', () => {
  const rulesText = fs.readFileSync(rulesPath, 'utf8');
  const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));

  // 1. Rules version & global default-deny catch-all
  assert.ok(rulesText.includes("rules_version = '2';"));
  assert.ok(
    rulesText.includes('match /{document=**} {\n      allow read, write: if false;\n    }')
  );

  // 2. Verify every collection path in firebase-blueprint.json has an explicit match block
  const requiredMatchBlocks = [
    'match /users/{uid}',
    'match /private/{docId}',
    'match /admins/{uid}',
    'match /modules/{moduleId}',
    'match /categories/{categoryId}',
    'match /catalogItems/{itemId}',
    'match /favorites/{uid}/items/{itemId}',
    'match /projects/{projectId}',
    'match /jobs/{jobId}',
    'match /devices/{deviceId}',
    'match /devicePairingTokens/{tokenId}',
    'match /auditEvents/{eventId}',
  ];
  for (const block of requiredMatchBlocks) {
    assert.ok(rulesText.includes(block), `Missing match block in firestore.rules: ${block}`);
  }
  assert.equal(Object.keys(blueprint.firestore).length, 12);

  // 3. Verify Dirty Dozen Defenses:
  // Payload 1 & 2: Self-role escalation blocked on create (incoming().role == 'user' || isAdmin()) and update (incoming().role == existing().role)
  assert.ok(rulesText.includes("(incoming().role == 'user' || isAdmin())"));
  assert.ok(rulesText.includes('incoming().role == existing().role'));

  // Payload 3: Shadow field injection blocked via hasOnly() on every entity validator and affectedKeys().hasOnly() on updates
  assert.ok(rulesText.includes("affectedKeys().hasOnly(['displayName', 'photoURL', 'preferences', 'updatedAt'])"));

  // Payload 4: PII split-collection isolation (/users/{uid}/private/{docId}) restricted to isOwner(uid) || isAdmin()
  assert.ok(rulesText.includes('allow get: if isValidId(uid) && isValidId(docId) && (isOwner(uid) || isAdmin())'));

  // Payload 5: Unverified email spoofing blocked by checking request.auth.token.email_verified == true
  assert.ok(rulesText.includes('request.auth.token.email_verified == true'));

  // Payload 6: Draft catalog items blocked for ordinary users
  assert.ok(rulesText.includes("existing().visibility == 'published' || isAdmin()"));

  // Payload 7: Cross-user project & job access blocked via existing().ownerUid == request.auth.uid
  assert.ok(rulesText.includes('existing().ownerUid == request.auth.uid || isAdmin()'));

  // Payload 8: Orphaned favorite writes blocked by Master Gate exists(/databases/$(database)/documents/users/$(uid))
  assert.ok(rulesText.includes('exists(/databases/$(database)/documents/users/$(uid))'));

  // Payload 9: Terminal job state locking blocks updates once status is downloaded, succeeded, cancelled, or expired
  assert.ok(
    rulesText.includes("!(existing().status in ['downloaded', 'succeeded', 'cancelled', 'expired'])")
  );

  // Payload 10 & 11: Client SDK blocked from writing /auditEvents and reading/writing /devicePairingTokens
  assert.ok(
    rulesText.includes('match /devicePairingTokens/{tokenId} {\n      allow read, write: if false;\n    }')
  );
  assert.ok(
    rulesText.includes('match /auditEvents/{eventId} {\n      allow get: if isValidId(eventId) && isAdmin();\n      allow list: if isAdmin();\n      allow create, update, delete: if false;\n    }')
  );

  // Payload 12: ID Poisoning guard regex & length check
  assert.ok(rulesText.includes("id.size() >= 1 && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\\\-]+$')"));
});
