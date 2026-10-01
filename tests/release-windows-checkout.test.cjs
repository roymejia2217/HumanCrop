const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowPath = path.join(
  __dirname,
  '..',
  '.github',
  'workflows',
  'release.yml',
);

function windowsReleaseJob() {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const start = workflow.indexOf('  build-windows:');
  const end = workflow.indexOf('\n  build-linux:', start);

  assert.notEqual(start, -1, 'release workflow must define build-windows');
  assert.notEqual(end, -1, 'release workflow must define build-linux after build-windows');

  return workflow.slice(start, end);
}

test('Windows release checkout preserves repository line endings before checkout', () => {
  const job = windowsReleaseJob();
  const lineEndingConfig = job.indexOf(
    'git config --global core.autocrlf false',
  );
  const checkout = job.indexOf('- name: Checkout released revision');

  assert.notEqual(
    lineEndingConfig,
    -1,
    'Windows release job must disable checkout line-ending conversion',
  );
  assert.ok(
    lineEndingConfig < checkout,
    'line-ending policy must be applied before actions/checkout',
  );
});

test('Windows release build uses explicit no-publish packaging', () => {
  const job = windowsReleaseJob();

  assert.doesNotMatch(
    job,
    /npm run dist:win/,
    'release workflow must not delegate Windows packaging to a historical script',
  );
  assert.match(
    job,
    /npm run validate:models[\s\S]*npm run build[\s\S]*npm exec -- electron-builder --win nsis --publish never/,
    'release workflow must validate, build, and package with publishing disabled',
  );
});
