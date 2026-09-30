const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.resolve(__dirname, '..');
const electronPackage = JSON.parse(
  fs.readFileSync(require.resolve('electron/package.json'), 'utf8'),
);
const mainSource = fs.readFileSync(path.join(rootDir, 'src/main.ts'), 'utf8');
const preloadSource = fs.readFileSync(path.join(rootDir, 'src/preload.ts'), 'utf8');

function versionTuple(version) {
  return version.split('.').slice(0, 3).map(part => Number.parseInt(part, 10));
}

test('Electron stays on the governed 41.10.x security-fixed line', () => {
  const [major, minor, patch] = versionTuple(electronPackage.version);
  assert.equal(major, 41, `Electron ${electronPackage.version} is outside major 41`);
  assert.equal(minor, 10, `Electron ${electronPackage.version} is outside the governed 41.10.x line`);
  assert.ok(patch >= 6, `Electron ${electronPackage.version} is below 41.10.6`);
});

test('BrowserWindow preserves renderer isolation invariants', () => {
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.doesNotMatch(mainSource, /contextIsolation:\s*false/);
  assert.doesNotMatch(mainSource, /nodeIntegration:\s*true/);
  assert.doesNotMatch(mainSource, /sandbox:\s*false/);
});

test('preload bridge keeps renderer access behind contextBridge and invoke/on IPC', () => {
  assert.match(preloadSource, /import\s*\{[^}]*contextBridge[^}]*ipcRenderer[^}]*\}\s*from\s*['"]electron['"]/s);
  assert.match(preloadSource, /contextBridge\.exposeInMainWorld\(['"]electronAPI['"]/);
  assert.match(preloadSource, /ipcRenderer\.invoke\(/);
  assert.match(preloadSource, /ipcRenderer\.on\(/);
  assert.doesNotMatch(preloadSource, /ipcRenderer\.send\(/);
  assert.doesNotMatch(preloadSource, /ipcRenderer\.sendSync\(/);
});
