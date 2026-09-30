const assert = require('node:assert/strict');
const test = require('node:test');

const {
  validateReleaseVersionCoherence,
} = require('../scripts/release-version-contract.cjs');

function fixture(version) {
  return {
    packageJson: { version },
    packageLock: { version, packages: { '': { version } } },
    manifest: { '.': version },
  };
}

test('accepts the published 1.0.0 baseline', () => {
  assert.doesNotThrow(() => validateReleaseVersionCoherence(fixture('1.0.0')));
});

test('accepts a coherent Release Please transition to 1.0.1', () => {
  assert.doesNotThrow(() => validateReleaseVersionCoherence(fixture('1.0.1')));
});

test('rejects a manifest version that diverges from package.json', () => {
  const input = fixture('1.0.1');
  input.manifest['.'] = '1.0.0';
  assert.throws(() => validateReleaseVersionCoherence(input), /manifest/i);
});

test('rejects a lockfile version that diverges from package.json', () => {
  const input = fixture('1.0.1');
  input.packageLock.packages[''].version = '1.0.0';
  assert.throws(() => validateReleaseVersionCoherence(input), /lockfile/i);
});
