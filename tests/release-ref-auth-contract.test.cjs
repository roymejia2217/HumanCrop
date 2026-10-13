const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'release.yml'),
  'utf8',
).replace(/\r\n?/g, '\n');

function getJob(name) {
  const lines = workflow.split('\n');
  const start = lines.indexOf('  ' + name + ':');
  assert.notEqual(start, -1, 'missing ' + name + ' job');

  let end = lines.findIndex(
    (line, index) => index > start && /^  [a-z][a-z0-9-]*:$/.test(line),
  );
  if (end === -1) end = lines.length;
  return lines.slice(start, end).join('\n');
}

function getAppTokenStep(name, stepName) {
  const job = getJob(name);
  const start = job.indexOf('      - name: ' + stepName + '\n');
  assert.notEqual(start, -1, 'missing token step in ' + name);

  const next = job.indexOf('\n      - name: ', start + 1);
  return job.slice(start, next === -1 ? undefined : next);
}

test('release tag creation token includes only the additional workflow write grant', () => {
  const tokenStep = getAppTokenStep(
    'create-draft-release',
    'Create scoped release GitHub App token',
  );
  assert.match(tokenStep, /^          permission-contents: write$/m);
  assert.match(tokenStep, /^          permission-workflows: write$/m);
  assert.equal((tokenStep.match(/permission-workflows:/g) || []).length, 1);
  assert.doesNotMatch(tokenStep, /permission-administration:|write-all/);
});

test('other release jobs do not inherit workflow-file modification permission', () => {
  const prToken = getAppTokenStep(
    'release-pr',
    'Create scoped release GitHub App token',
  );
  const publishToken = getAppTokenStep(
    'publish',
    'Create publication GitHub App token',
  );
  assert.doesNotMatch(prToken, /permission-workflows:/);
  assert.doesNotMatch(publishToken, /permission-workflows:/);
  assert.equal((workflow.match(/^          permission-workflows: write$/gm) || []).length, 1);
});
