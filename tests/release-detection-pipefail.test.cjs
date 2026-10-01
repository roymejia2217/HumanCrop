const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const workflowPath = path.join(
  __dirname,
  '..',
  '.github',
  'workflows',
  'release.yml',
);

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'HumanCrop Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'HumanCrop Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_AUTHOR_DATE: '2026-09-30T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-09-30T00:00:00Z',
};

function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: gitEnv,
    ...options,
  }).trim();
}

function createLongHistory() {
  const cwd = fs.mkdtempSync(
    path.join(os.tmpdir(), 'humancrop-release-detection-'),
  );
  git(cwd, ['init', '-q']);
  const tree = git(cwd, ['mktree'], { input: '' });

  let parent = null;
  const filler = 'x'.repeat(4096);
  for (let index = 0; index < 96; index += 1) {
    const args = [
      'commit-tree',
      tree,
      '-m',
      `test(release): filler ${index} ${filler}`,
    ];
    if (parent) args.push('-p', parent);
    parent = git(cwd, args);
  }
  const releaseSha = git(cwd, [
    'commit-tree',
    tree,
    '-m',
    'chore(main): release 1.0.1',
    '-p',
    parent,
  ]);
  const currentSha = git(cwd, [
    'commit-tree',
    tree,
    '-m',
    'fix(release): later workflow fix',
    '-p',
    releaseSha,
  ]);
  git(cwd, ['update-ref', 'HEAD', currentSha]);

  return { cwd, releaseSha };
}

function releaseShaAssignment() {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const assignment = workflow
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('RELEASE_SHA='));

  assert.ok(assignment, 'release workflow must assign RELEASE_SHA');
  return assignment;
}

test('release commit detection is pipefail-safe with a long history', (t) => {
  const { cwd, releaseSha } = createLongHistory();
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  const result = spawnSync(
    'bash',
    [
      '-c',
      [
        'set -o pipefail',
        'EXPECTED_SUBJECT="chore(main): release 1.0.1"',
        releaseShaAssignment(),
        'printf "%s" "$RELEASE_SHA"',
      ].join('\n'),
    ],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_FLUSH: '1' },
    },
  );

  assert.equal(
    result.status,
    0,
    result.stderr || `release detection exited ${result.status}`,
  );
  assert.equal(result.stdout, releaseSha);
});

test('release detection consumes git log instead of exiting awk early', () => {
  assert.doesNotMatch(
    releaseShaAssignment(),
    /\{print \$1; exit\}/,
  );
});

function runReleaseShaAssignment(cwd, expectedSubject) {
  return spawnSync(
    'bash',
    [
      '-c',
      [
        'set -euo pipefail',
        `EXPECTED_SUBJECT="${expectedSubject}"`,
        releaseShaAssignment(),
        '[[ -n "$RELEASE_SHA" ]]',
        'printf "%s" "$RELEASE_SHA"',
      ].join('\n'),
    ],
    { cwd, encoding: 'utf8' },
  );
}

test('release detection fails closed when the exact subject is absent', (t) => {
  const { cwd } = createLongHistory();
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  const result = runReleaseShaAssignment(
    cwd,
    'chore(main): release 9.9.9',
  );

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
});

test('release detection emits only the newest exact matching release SHA', (t) => {
  const { cwd } = createLongHistory();
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  const tree = git(cwd, ['mktree'], { input: '' });
  const parent = git(cwd, ['rev-parse', 'HEAD']);
  const newestReleaseSha = git(cwd, [
    'commit-tree',
    tree,
    '-m',
    'chore(main): release 1.0.1',
    '-p',
    parent,
  ]);
  const currentSha = git(cwd, [
    'commit-tree',
    tree,
    '-m',
    'fix(release): post-release repair',
    '-p',
    newestReleaseSha,
  ]);
  git(cwd, ['update-ref', 'HEAD', currentSha]);

  const result = runReleaseShaAssignment(
    cwd,
    'chore(main): release 1.0.1',
  );

  assert.equal(
    result.status,
    0,
    result.stderr || `release detection exited ${result.status}`,
  );
  assert.equal(result.stdout, newestReleaseSha);
});
