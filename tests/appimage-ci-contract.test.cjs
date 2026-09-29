const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

test('CI builds and validates the production AppImage artifact', () => {
  assert.match(workflow, /^  appimage-contract:\n/m);
  assert.match(workflow, /name: AppImage Package Contract/);
  assert.match(workflow, /needs: validate/);
  assert.match(workflow, /runs-on: ubuntu-22\.04/);
  assert.match(workflow, /electron-builder --linux AppImage --publish never/);
  assert.match(workflow, /scripts\/validate-appimage-artifact\.sh/);
});

test('AppImage upstream validation dependencies are pinned immutably', () => {
  assert.match(workflow, /APPIMAGEHUB_REF:\s*[0-9a-f]{40}/);
  assert.match(workflow, /APPDIR_LINT_REF:\s*[0-9a-f]{40}/);
  assert.match(workflow, /code\/check-name\.sh/);
  assert.match(workflow, /appdir-lint\.sh/);
});

test('CI actions are pinned to immutable commits', () => {
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@v\d+/);
  assert.match(workflow, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.match(workflow, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
});
