'use strict';

const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..', '..');
const workerPath = path.join(root, 'dist', 'worker.js');
const inputPath = path.join(root, 'docs', 'examples', 'original.webp');

function hashFile(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

test('real worker loads bundled AI models, exports PNG, rejects invalid input', {
  timeout: 300_000,
}, async (t) => {
  assert.ok(fs.existsSync(workerPath), 'Compile TypeScript before this integration smoke');
  assert.ok(fs.existsSync(inputPath), 'The source image fixture is missing');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'humancrop-ai-smoke-'));
  const sourceHash = hashFile(inputPath);
  const worker = fork(workerPath, [], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    execArgv: ['--expose-gc'],
  });
  let recentLogs = '';
  const capture = (data) => { recentLogs = (recentLogs + data.toString()).slice(-6000); };
  worker.stdout.on('data', capture);
  worker.stderr.on('data', capture);

  t.after(() => {
    if (worker.exitCode === null && worker.signalCode === null) worker.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function nextMessage(types, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error(
        'Worker timed out awaiting ' + types.join('/') + '.\n' + recentLogs,
      )), timeoutMs);

      function cleanup() {
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
      }
      function fail(error) {
        cleanup();
        reject(error);
      }
      function onMessage(message) {
        if (!types.includes(message?.type)) return;
        cleanup();
        resolve(message);
      }
      function onError(error) { fail(error); }
      function onExit(code, signal) {
        fail(new Error('Worker exited (' + code + ', ' + signal + ').\n' + recentLogs));
      }
      worker.on('message', onMessage);
      worker.once('error', onError);
      worker.once('exit', onExit);
    });
  }

  const initialized = nextMessage(['init-success', 'init-error'], 120_000);
  worker.send({ type: 'init', appPath: root });
  const initResult = await initialized;
  assert.equal(initResult.type, 'init-success',
    'AI model initialization failed: ' + (initResult.error || recentLogs));

  const expectedOutput = path.join(dir, 'original_passport_eu.png');
  const processed = nextMessage(['file-done', 'fatal-error'], 120_000);
  worker.send({
    type: 'process-file',
    config: {
      inputPath,
      outputDir: dir,
      preset: 'passport_eu',
      bgColor: '#ffffff',
      customDims: null,
    },
  });
  const outcome = await processed;
  assert.equal(outcome.type, 'file-done', 'Fatal worker error: ' + (outcome.error || recentLogs));
  assert.ok(['success', 'warning'].includes(outcome.data.status),
    'Processing failed: ' + JSON.stringify(outcome.data) + '\n' + recentLogs);

  assert.ok(fs.existsSync(expectedOutput), 'Expected PNG was not produced');
  const output = await sharp(expectedOutput).metadata();
  assert.equal(output.format, 'png');
  assert.equal(output.width, 413);
  assert.equal(output.height, 531);
  assert.ok(fs.statSync(expectedOutput).size > 1024, 'Generated output is unexpectedly empty');
  assert.equal(hashFile(inputPath), sourceHash, 'Original input was modified');

  const invalid = path.join(dir, 'corrupt.webp');
  fs.writeFileSync(invalid, Buffer.from('not a supported image'));
  const corruptResult = nextMessage(['file-done', 'fatal-error'], 60_000);
  worker.send({
    type: 'process-file',
    config: {
      inputPath: invalid,
      outputDir: dir,
      preset: 'passport_eu',
      bgColor: '#ffffff',
      customDims: null,
    },
  });
  const rejected = await corruptResult;
  assert.equal(rejected.type, 'file-done');
  assert.equal(rejected.data.status, 'error');
  assert.equal(rejected.data.error, 'ERR_UNSUPPORTED_FORMAT');
  assert.equal(fs.existsSync(path.join(dir, 'corrupt_passport_eu.png')), false);
});
