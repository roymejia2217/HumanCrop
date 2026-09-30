const fs = require('node:fs/promises');
const path = require('node:path');

const APPSTREAM_METADATA_FILENAME = 'com.rjmejia.humancrop.appdata.xml';
const APPSTREAM_METADATA_RELATIVE_PATH = path.join(
  'usr',
  'share',
  'metainfo',
  APPSTREAM_METADATA_FILENAME,
);

function targetNames(context) {
  return (context.targets || [])
    .map(target => String(target && target.name ? target.name : '').toLowerCase())
    .filter(Boolean);
}

async function syncLinuxAppStreamMetadata(context) {
  if (context.electronPlatformName !== 'linux') {
    return;
  }

  const targets = targetNames(context);
  const hasAppImage = targets.includes('appimage');
  const destination = path.join(context.appOutDir, APPSTREAM_METADATA_RELATIVE_PATH);

  if (hasAppImage && targets.length !== 1) {
    throw new Error(
      'AppImage must be built in a dedicated electron-builder invocation so AppStream metadata does not contaminate other Linux targets.',
    );
  }

  if (!hasAppImage) {
    await fs.rm(destination, { force: true });
    return;
  }

  const source = path.join(
    context.packager.projectDir,
    'build',
    'linux',
    APPSTREAM_METADATA_FILENAME,
  );

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  console.log(`[AppStream] Installed metadata: ${destination}`);
}

module.exports = {
  APPSTREAM_METADATA_RELATIVE_PATH,
  syncLinuxAppStreamMetadata,
};
