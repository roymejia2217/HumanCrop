const assert = require('node:assert/strict');
const test = require('node:test');

const {
  hasReleasePleaseMainScope,
} = require('../scripts/release-governance-contract.cjs');

const lfWorkflow = [
  'with:',
  '  scopes: |',
  '    core',
  '    release',
  '    main',
  '',
].join('\n');

const crlfWorkflow = lfWorkflow.replace(/\n/g, '\r\n');

test('accepts Release Please main scope with LF line endings', () => {
  assert.equal(hasReleasePleaseMainScope(lfWorkflow), true);
});

test('accepts Release Please main scope with CRLF line endings', () => {
  assert.equal(hasReleasePleaseMainScope(crlfWorkflow), true);
});

test('rejects workflows that omit the main scope', () => {
  assert.equal(
    hasReleasePleaseMainScope(lfWorkflow.replace('    main\n', '')),
    false,
  );
});
