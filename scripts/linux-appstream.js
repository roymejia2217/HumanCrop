const fs = require('node:fs/promises');
const path = require('node:path');

const APPSTREAM_METADATA_FILENAME = 'com.rjmejia.humancrop.appdata.xml';
const APPSTREAM_METADATA_RELATIVE_PATH = path.join(
  'usr',
  'share',
  'metainfo',
  APPSTREAM_METADATA_FILENAME,
);
const APPSTREAM_DESKTOP_RELATIVE_PATH = path.join(
  'usr',
  'share',
  'applications',
  'humancrop.desktop',
);

function targetNames(context) {
  return (context.targets || [])
    .map(target => String(target && target.name ? target.name : '').toLowerCase())
    .filter(Boolean);
}

function requireSingleLine(value, field) {
  const text = String(value || '').trim();
  if (!text || /[\r\n]/.test(text)) {
    throw new Error(`AppStream desktop field ${field} must be a non-empty single line.`);
  }
  return text;
}

function buildDesktopEntry(context) {
  const { packager } = context;
  const appInfo = packager.appInfo || {};
  const linux = packager.platformSpecificBuildOptions || {};
  const productName = requireSingleLine(appInfo.productName, 'Name');
  const executableName = requireSingleLine(packager.executableName, 'Icon');
  const category = requireSingleLine(linux.category, 'Categories').replace(/;+$/, '');
  const comment = requireSingleLine(linux.description || appInfo.description, 'Comment');
  const version = requireSingleLine(appInfo.version, 'X-AppImage-Version');

  return [
    '[Desktop Entry]',
    `Name=${productName}`,
    'Exec=AppRun --no-sandbox %U',
    'Terminal=false',
    'Type=Application',
    `Icon=${executableName}`,
    `StartupWMClass=${productName}`,
    `Comment=${comment}`,
    `Categories=${category};`,
    `X-AppImage-Version=${version}`,
    '',
  ].join('\n');
}

async function syncLinuxAppStreamMetadata(context) {
  if (context.electronPlatformName !== 'linux') {
    return;
  }

  const targets = targetNames(context);
  const hasAppImage = targets.includes('appimage');
  const metadataDestination = path.join(context.appOutDir, APPSTREAM_METADATA_RELATIVE_PATH);
  const desktopDestination = path.join(context.appOutDir, APPSTREAM_DESKTOP_RELATIVE_PATH);

  if (hasAppImage && targets.length !== 1) {
    throw new Error(
      'AppImage must be built in a dedicated electron-builder invocation so AppStream metadata does not contaminate other Linux targets.',
    );
  }

  if (!hasAppImage) {
    await Promise.all([
      fs.rm(metadataDestination, { force: true }),
      fs.rm(desktopDestination, { force: true }),
    ]);
    return;
  }

  const metadataSource = path.join(
    context.packager.projectDir,
    'build',
    'linux',
    APPSTREAM_METADATA_FILENAME,
  );

  await Promise.all([
    fs.mkdir(path.dirname(metadataDestination), { recursive: true }),
    fs.mkdir(path.dirname(desktopDestination), { recursive: true }),
  ]);
  await Promise.all([
    fs.copyFile(metadataSource, metadataDestination),
    fs.writeFile(desktopDestination, buildDesktopEntry(context), 'utf8'),
  ]);
  console.log(`[AppStream] Installed metadata: ${metadataDestination}`);
  console.log(`[AppStream] Installed desktop-id: ${desktopDestination}`);
}

module.exports = {
  APPSTREAM_DESKTOP_RELATIVE_PATH,
  APPSTREAM_METADATA_RELATIVE_PATH,
  buildDesktopEntry,
  syncLinuxAppStreamMetadata,
};
