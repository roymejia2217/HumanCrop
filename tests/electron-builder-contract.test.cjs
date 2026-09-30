const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function readPackage(name) {
  return JSON.parse(fs.readFileSync(require.resolve(`${name}/package.json`), 'utf8'));
}

function versionTuple(version) {
  return version.split('.').slice(0, 3).map(part => Number.parseInt(part, 10));
}

const electronBuilder = readPackage('electron-builder');
const appBuilderLib = readPackage('app-builder-lib');
const appBuilderRoot = path.dirname(require.resolve('app-builder-lib/package.json'));

function readAppBuilder(relativePath) {
  return fs.readFileSync(path.join(appBuilderRoot, relativePath), 'utf8');
}

test('electron-builder stays on the governed 26.15.x security-fixed line', () => {
  const [major, minor, patch] = versionTuple(electronBuilder.version);
  assert.equal(major, 26, `electron-builder ${electronBuilder.version} is outside major 26`);
  assert.equal(minor, 15, `electron-builder ${electronBuilder.version} is outside the governed 26.15.x line`);
  assert.ok(patch >= 3, `electron-builder ${electronBuilder.version} is below 26.15.3`);
  assert.equal(appBuilderLib.version, electronBuilder.version, 'app-builder-lib must stay aligned with electron-builder');
});

test('electron-builder 26 preserves HumanCrop afterPack target context', () => {
  const configuration = readAppBuilder('out/configuration.d.ts');
  assert.match(configuration, /export interface PackContext[\s\S]*readonly targets: Array<Target>;/);
  assert.match(configuration, /readonly afterPack\?: Hook<AfterPackContext, void>/);
});

test('electron-builder 26 preserves HumanCrop AppImage staging contract', () => {
  const appImageTarget = readAppBuilder('out/targets/appimage/AppImageTarget.js');
  assert.match(appImageTarget, /appDir: appOutDir/);
  assert.match(appImageTarget, /expandArtifactNamePattern\(options, "AppImage", arch\)/);
  assert.match(appImageTarget, /compression:/);
});

test('electron-builder 26 preserves deb layout isolation contract', () => {
  const fpmTarget = readAppBuilder('out/targets/FpmTarget.js');
  assert.match(fpmTarget, /appOutDir/);
  assert.match(fpmTarget, /usr\/share\/applications/);
  assert.match(fpmTarget, /installPrefix/);
});
