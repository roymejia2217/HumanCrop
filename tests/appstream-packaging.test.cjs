const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.resolve(__dirname, '..');
const {
  APPSTREAM_METADATA_RELATIVE_PATH,
  syncLinuxAppStreamMetadata,
} = require('../scripts/linux-appstream.js');

async function makeContext(targetNames, platform = 'linux') {
  const appOutDir = await fs.mkdtemp(path.join(os.tmpdir(), 'humancrop-appstream-'));
  return {
    appOutDir,
    electronPlatformName: platform,
    packager: { projectDir: rootDir },
    targets: targetNames.map(name => ({ name })),
  };
}

test('AppImage packaging installs AppStream metadata at the AppDir root contract', async () => {
  const context = await makeContext(['appImage']);
  try {
    await syncLinuxAppStreamMetadata(context);
    const packaged = await fs.readFile(path.join(context.appOutDir, APPSTREAM_METADATA_RELATIVE_PATH), 'utf8');
    const source = await fs.readFile(path.join(rootDir, 'build/linux/com.rjmejia.humancrop.appdata.xml'), 'utf8');
    assert.equal(packaged, source);
  } finally {
    await fs.rm(context.appOutDir, { recursive: true, force: true });
  }
});

test('combined AppImage and deb packaging is rejected to prevent cross-target contamination', async () => {
  const context = await makeContext(['appImage', 'deb']);
  try {
    await assert.rejects(
      syncLinuxAppStreamMetadata(context),
      /AppImage must be built in a dedicated electron-builder invocation/,
    );
  } finally {
    await fs.rm(context.appOutDir, { recursive: true, force: true });
  }
});

test('non-AppImage Linux packaging removes stale AppStream staging metadata', async () => {
  const context = await makeContext(['appImage']);
  try {
    await syncLinuxAppStreamMetadata(context);
    context.targets = [{ name: 'deb' }];
    await syncLinuxAppStreamMetadata(context);
    await assert.rejects(
      fs.access(path.join(context.appOutDir, APPSTREAM_METADATA_RELATIVE_PATH)),
      error => error && error.code === 'ENOENT',
    );
  } finally {
    await fs.rm(context.appOutDir, { recursive: true, force: true });
  }
});

test('Linux distribution scripts build AppImage and deb in separate invocations', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
  const linux = pkg.scripts['dist:linux'];
  assert.match(linux, /electron-builder --linux AppImage --publish never/);
  assert.match(linux, /electron-builder --linux deb --publish never/);
  assert.doesNotMatch(linux, /--linux AppImage deb/);
});
