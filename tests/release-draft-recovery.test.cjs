const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'release.yml'),
  'utf8',
).replace(/\r\n?/g, '\n');

function job(name) {
  const lines = workflow.split('\n');
  const start = lines.indexOf('  ' + name + ':');
  assert.notEqual(start, -1, 'missing job: ' + name);
  let end = lines.findIndex(
    (line, index) => index > start && /^  [a-z][a-z0-9-]*:$/.test(line),
  );
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join('\n');
}

test('draft verification uses release ID, never published-only tag endpoint', () => {
  const publish = job('publish');
  assert.doesNotMatch(publish, /releases\/tags\/\$/);
  assert.match(publish, /releases\?per_page=100/);
  assert.match(publish, /--paginate --slurp/);
  assert.match(publish, /releases\/\$/);
  assert.match(publish, /target_commitish/);
});

test('tagged draft recovery requires a guarded, unique release identity', () => {
  const detect = job('release-detection');
  assert.match(detect, /recover_release/);
  assert.match(detect, /release_id/);
  assert.match(detect, /git\/ref\/tags/);
  assert.match(detect, /target_commitish/);
  assert.match(detect, /length == 1/);
  assert.match(detect, /RECOVER_RELEASE=true/);
  assert.match(detect, /printf 'recover_release=%s\\n' "\$RECOVER_RELEASE"/);
  assert.match(job('release-pr'), /recover_release != 'true'/);
});

test('draft discovery uses a narrowly scoped App token while CI keeps Actions read', () => {
  const detect = job('release-detection');
  assert.match(detect, /id: draft-app-token/);
  assert.match(detect, /permission-contents: write/);
  assert.doesNotMatch(detect, /permission-workflows: write/);
  assert.match(detect, /GH_TOKEN: \$\{\{ github.token \}\}/);
  assert.match(detect, /DRAFT_TOKEN: \$\{\{ steps.draft-app-token.outputs.token \}\}/);
  assert.match(detect, /GH_TOKEN="\$DRAFT_TOKEN" gh api "repos\/\$\{REPOSITORY\}\/releases\?per_page=100"/);
});

test('recovery validates existing immutable assets before publishing', () => {
  const recovery = job('recover-draft-release');
  const checks = [
    'releases/',
    'git/ref/tags/',
    'gh release download',
    'SHA256SUMS.txt',
    'sha256sum',
    'REMOTE_DIGEST',
    'EXPECTED_NAMES',
    'permission-contents: write',
  ];
  for (const check of checks) {
    assert.ok(recovery.includes(check), 'missing recovery check: ' + check);
  }
  assert.doesNotMatch(recovery, /gh release upload|gh release create|permission-workflows: write/);
  const verification = recovery.indexOf('REMOTE_DIGEST');
  const publication = recovery.indexOf('gh release edit');
  assert.ok(verification >= 0 && publication > verification);
});

test('recovery remains fail-closed and cannot bypass release governance', () => {
  const recovery = job('recover-draft-release');
  assert.match(recovery, /needs: release-detection/);
  assert.match(recovery, /outputs\.recover_release == 'true'/);
  assert.match(recovery, /set -Eeuo pipefail/);
  assert.match(recovery, /trap 'status=\$\?;[^'\n]*' ERR/);
  assert.match(recovery, /fail_recovery\(\)/);
  assert.match(recovery, /RELEASE_SHA/);
  assert.match(recovery, /RELEASE_TAG/);
  assert.doesNotMatch(workflow, /workflow_dispatch:|gh release create/);
});
