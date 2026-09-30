const fs = require('fs');
const path = require('path');
const { validateReleaseVersionCoherence } = require('./release-version-contract.cjs');
const { hasReleasePleaseMainScope } = require('./release-governance-contract.cjs');

const rootDir = path.resolve(__dirname, '..');

function readJson(relativePath) {
    const absolutePath = path.join(rootDir, relativePath);
    try {
        return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    } catch (error) {
        throw new Error(`Unable to read ${relativePath}: ${error.message}`);
    }
}

function readText(relativePath) {
    const absolutePath = path.join(rootDir, relativePath);
    try {
        return fs.readFileSync(absolutePath, 'utf8');
    } catch (error) {
        throw new Error(`Unable to read ${relativePath}: ${error.message}`);
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function normalizeTargets(target) {
    if (Array.isArray(target)) {
        return target.map(item => typeof item === 'string' ? item : item.target).filter(Boolean);
    }

    if (typeof target === 'string') {
        return [target];
    }

    if (target && typeof target === 'object' && typeof target.target === 'string') {
        return [target.target];
    }

    return [];
}

function validatePackageConfig() {
    const packageJson = readJson('package.json');
    const build = packageJson.build || {};
    const winTargets = normalizeTargets(build.win && build.win.target);
    const linuxTargets = normalizeTargets(build.linux && build.linux.target);

    assert(packageJson.scripts && packageJson.scripts.test === 'node --test tests/*.test.cjs && node scripts/validate-release-config.js', 'package.json must run AppImage packaging tests before release config validation.');
    assert(packageJson.scripts['dist:win'], 'package.json must define dist:win.');
    assert(packageJson.scripts['dist:linux'], 'package.json must define dist:linux.');
    assert(packageJson.scripts['dist:all'], 'package.json must define dist:all.');
    assert(packageJson.scripts['validate:models'] === 'node scripts/validate-model-assets.js', 'package.json must define validate:models.');
    assert(packageJson.scripts.dist.includes('npm run validate:models'), 'dist must validate model assets before packaging.');
    assert(packageJson.scripts['dist:win'].includes('npm run validate:models'), 'dist:win must validate model assets before packaging.');
    assert(packageJson.scripts['dist:linux'].includes('npm run validate:models'), 'dist:linux must validate model assets before packaging.');
    assert(packageJson.scripts['dist:linux'].includes('electron-builder --linux AppImage --publish never'), 'dist:linux must build AppImage in a dedicated invocation.');
    assert(packageJson.scripts['dist:linux'].includes('electron-builder --linux deb --publish never'), 'dist:linux must build deb in a dedicated invocation.');
    assert(!packageJson.scripts['dist:linux'].includes('--linux AppImage deb'), 'dist:linux must not combine AppImage and deb in one invocation.');
    assert(packageJson.scripts['dist:all'].includes('npm run validate:models'), 'dist:all must validate model assets before packaging.');
    assert(packageJson.scripts['dist:all'].includes('electron-builder --linux AppImage --publish never'), 'dist:all must build AppImage in a dedicated invocation.');
    assert(packageJson.scripts['dist:all'].includes('electron-builder --linux deb --publish never'), 'dist:all must build deb in a dedicated invocation.');
    assert(packageJson.dependencies && packageJson.dependencies['onnxruntime-node'] === '1.17.3', 'onnxruntime-node must be a direct pinned dependency for offline background removal.');
    assert(!packageJson.dependencies['@imgly/background-removal-node'], '@imgly/background-removal-node must not be a runtime dependency because its Linux native wrapper crashes during processing.');
    assert(build.compression === 'normal', 'electron-builder compression must be normal so AppImage avoids unsupported SquashFS XZ compression.');
    assert(typeof build.artifactName === 'string' && build.artifactName.includes('${productName}') && build.artifactName.includes('${version}') && build.artifactName.includes('${ext}'), 'electron-builder artifactName must include productName, version, and extension.');
    assert(build.appImage && build.appImage.artifactName === '${productName}-${version}-${arch}.${ext}', 'AppImage artifactName must omit the redundant OS segment and use product-version-arch.AppImage.');
    assert(build.afterPack === './scripts/apply-fuses.js', 'electron-builder afterPack must preserve the governed fuse and AppStream hook.');
    assert(fs.existsSync(path.join(rootDir, 'build/linux/com.rjmejia.humancrop.appdata.xml')), 'AppStream source metadata must exist.');
    assert(Array.isArray(build.asarUnpack), 'electron-builder asarUnpack must be defined for native modules.');
    assert(build.asarUnpack.includes('**/node_modules/sharp/**/*'), 'asarUnpack must include sharp native files.');
    assert(build.asarUnpack.includes('**/node_modules/@img/**/*'), 'asarUnpack must include sharp @img runtime files.');
    assert(build.asarUnpack.includes('**/node_modules/onnxruntime-node/**/*'), 'asarUnpack must include onnxruntime-node native files.');
    assert(winTargets.includes('nsis'), 'Windows build target must include nsis.');
    assert(linuxTargets.includes('AppImage'), 'Linux build target must include AppImage.');
    assert(linuxTargets.includes('deb'), 'Linux build target must include deb.');
    assert(build.linux && typeof build.linux.category === 'string' && build.linux.category.length > 0, 'Linux category must be defined.');
    assert(build.deb && Array.isArray(build.deb.depends) && build.deb.depends.length > 0, 'Debian package dependencies must be explicitly defined.');
}

function validateWorkflows() {
    const ciWorkflow = readText('.github/workflows/ci.yml');
    const releaseWorkflow = readText('.github/workflows/release.yml');

    assert(ciWorkflow.includes('npm ci'), 'CI workflow must use npm ci.');
    assert(ciWorkflow.includes('npm run build'), 'CI workflow must run the TypeScript build.');
    assert(ciWorkflow.includes('npm test'), 'CI workflow must run npm test.');

    assert(releaseWorkflow.includes('workflow_run:'), 'Release workflow must orchestrate after CI completion.');
    assert(releaseWorkflow.includes('- CI') && releaseWorkflow.includes('- completed'), 'Release workflow must wait for completed CI runs.');
    assert(!releaseWorkflow.includes('workflow_dispatch:'), 'Release workflow must not bypass successful main CI through manual dispatch.');
    assert(!/tags:\s*\n\s*-\s*['"]?v\*\.\*\.\*['"]?/.test(releaseWorkflow), 'Release workflow must not publish directly from tag pushes.');
    assert(!releaseWorkflow.includes('gh release create'), 'Release workflow must not bypass Release Please with gh release create.');
    assert(releaseWorkflow.includes('actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1'), 'GitHub App token action must be pinned to v3.2.0 SHA.');
    assert(releaseWorkflow.includes('HUMANCROP_RELEASE_APP_CLIENT_ID') && releaseWorkflow.includes('HUMANCROP_RELEASE_APP_PRIVATE_KEY'), 'Release workflow must require the dedicated HumanCrop GitHub App identity.');
    assert(releaseWorkflow.includes('googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7'), 'Release Please action must be pinned to v5.0.0 SHA.');
    assert(releaseWorkflow.includes('skip-github-release: true'), 'Release PR orchestration must not create a tag or GitHub release before candidate verification.');
    assert(releaseWorkflow.includes('skip-github-pull-request: true'), 'Final release creation must not create or update another release PR.');
    assert(releaseWorkflow.includes('skip-github-release: true'), 'Release PR orchestration must not create a tag before candidate verification.');
    assert(releaseWorkflow.includes('skip-github-pull-request: true'), 'Post-build release creation must not create a second release PR.');
    assert(releaseWorkflow.includes('actions: read'), 'Release detection must be able to verify prior CI status for a pending release SHA.');
    assert(releaseWorkflow.includes('actions/runs'), 'Release detection must verify successful main CI for the pending release SHA.');
    assert(releaseWorkflow.includes('pending_release'), 'Release workflow must model pending release state explicitly.');
    assert(/create-draft-release:[\s\S]*?needs:[\s\S]*?- build-windows[\s\S]*?- build-linux/.test(releaseWorkflow), 'Draft release creation must depend on both verified candidate builds.');
    assert(releaseWorkflow.includes('release-please-config.json'), 'Release workflow must use the governed Release Please config.');
    assert(releaseWorkflow.includes('.release-please-manifest.json'), 'Release workflow must use the governed Release Please manifest.');
    assert(releaseWorkflow.includes('npm run dist:win'), 'Release workflow must build Windows artifacts once.');
    assert(releaseWorkflow.includes('npm run dist:linux'), 'Release workflow must build Linux artifacts once.');
    assert(releaseWorkflow.includes('sha256sum') || releaseWorkflow.includes('Get-FileHash'), 'Release workflow must record SHA-256 for release candidates.');
    assert(releaseWorkflow.includes('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'), 'Release workflow must pin upload-artifact v7.0.1.');
    assert(releaseWorkflow.includes('actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c'), 'Release workflow must pin download-artifact v8.0.1.');
    assert(releaseWorkflow.includes('gh release upload'), 'Release workflow must upload verified candidates to the Release Please draft.');
    assert(releaseWorkflow.includes('gh release edit') && releaseWorkflow.includes('--draft=false'), 'Release workflow must publish only after candidate verification.');
    assert(ciWorkflow.includes('appstreamcli validate --pedantic build/linux/com.rjmejia.humancrop.appdata.xml'), 'CI must validate AppStream source metadata.');
    assert(ciWorkflow.includes('squashfs-root/usr/share/metainfo/com.rjmejia.humancrop.appdata.xml'), 'CI must verify packaged AppStream metadata.');
    assert(ciWorkflow.includes('appstreamcli validate-tree --pedantic squashfs-root'), 'CI must validate the extracted AppDir as an AppStream tree.');
    assert(ciWorkflow.includes('name: DEB Package Contract'), 'CI must build and validate the Debian package.');
    assert(ciWorkflow.includes('dpkg-deb --field'), 'CI must verify Debian package metadata.');
    assert(ciWorkflow.includes('name: Windows Package Contract'), 'CI must build and validate the Windows NSIS package.');
    assert(ciWorkflow.includes('MZ PE header'), 'CI must verify the Windows installer PE signature.');
    assert(ciWorkflow.includes('- deb-package-contract') && ciWorkflow.includes('- windows-package-contract'), 'Required CI must depend on DEB and Windows package contracts.');
    assert(releaseWorkflow.includes('appstreamcli validate --pedantic build/linux/com.rjmejia.humancrop.appdata.xml'), 'Release workflow must validate AppStream source metadata.');
    assert(releaseWorkflow.includes('squashfs-root/usr/share/metainfo/com.rjmejia.humancrop.appdata.xml'), 'Release workflow must verify packaged AppStream metadata.');
    assert(releaseWorkflow.includes('appstreamcli validate-tree --pedantic squashfs-root'), 'Release workflow must validate the extracted AppDir as an AppStream tree.');
    const windowsBuildIndex = releaseWorkflow.indexOf('  build-windows:');
    const linuxBuildIndex = releaseWorkflow.indexOf('  build-linux:');
    const draftReleaseIndex = releaseWorkflow.indexOf('  create-draft-release:');
    const publishIndex = releaseWorkflow.indexOf('  publish:');
    assert(windowsBuildIndex >= 0 && linuxBuildIndex >= 0 && draftReleaseIndex > windowsBuildIndex && draftReleaseIndex > linuxBuildIndex, 'Verified candidates must be built before Release Please creates the tag and draft release.');
    assert(publishIndex > draftReleaseIndex, 'Publication must happen only after the verified draft release exists.');
    assert(!/^\s*uses:\s*[^@\s]+@v\d+/m.test(releaseWorkflow), 'Release workflow actions must be pinned to immutable SHAs.');
}

function validateReleasePleaseConfig() {
    const config = readJson('release-please-config.json');
    const manifest = readJson('.release-please-manifest.json');
    const packageJson = readJson('package.json');
    const packageLock = readJson('package-lock.json');
    const rootPackage = config.packages && config.packages['.'];

    assert(config['bootstrap-sha'] === '0ecea98c7f3f00665b899781f1fe299de1cb2e8b', 'Release Please must bootstrap immediately after v1.0.0.');
    assert(rootPackage && rootPackage['release-type'] === 'node', 'Release Please root package must use the node strategy.');
    assert(rootPackage['include-component-in-tag'] === false, 'Release tags must remain vX.Y.Z without a component prefix.');
    assert(rootPackage['include-v-in-tag'] === true, 'Release tags must retain the v prefix.');
    assert(rootPackage.draft === true, 'GitHub releases must remain draft until verified artifacts are attached.');
    assert(rootPackage['draft-pull-request'] === true, 'Release Please pull requests must start as drafts.');
    assert(rootPackage['force-tag-creation'] === true, 'Draft releases must create their tag immediately.');
    assert(rootPackage['pull-request-title-pattern'] === 'chore(main): release ${version}', 'Release PR title must satisfy repository governance.');
    assert(config['group-pull-request-title-pattern'] === 'chore(main): release ${version}', 'Grouped release PR title must satisfy repository governance.');
    validateReleaseVersionCoherence({ packageJson, packageLock, manifest });
}

function validateReleaseGovernance() {
    const commitlint = require(path.join(rootDir, 'commitlint.config.cjs'));
    const prGovernance = readText('.github/workflows/pr-governance.yml');
    const scopeRule = commitlint.rules && commitlint.rules['scope-enum'];
    const scopes = scopeRule && scopeRule[2];

    assert(Array.isArray(scopes) && scopes.includes('main'), 'Commitlint must allow Release Please scope main.');
    assert(Array.isArray(commitlint.ignores) && commitlint.ignores.some(ignore => ignore('chore(main): release 1.0.1')), 'Commitlint must narrowly ignore the exact Release Please commit shape.');
    assert(!commitlint.ignores.some(ignore => ignore('chore(main): release candidate')), 'Release commit ignore must not accept non-SemVer messages.');
    assert(hasReleasePleaseMainScope(prGovernance), 'PR Governance must allow Release Please scope main.');
}

function validateLockfilePolicy() {
    const gitignore = readText('.gitignore')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    assert(fs.existsSync(path.join(rootDir, 'package-lock.json')), 'package-lock.json must exist for reproducible npm ci builds.');
    assert(!gitignore.includes('package-lock.json'), '.gitignore must not ignore package-lock.json.');
}

function validateRendererStateOwnership() {
    const indexHtml = readText('src/index.html');
    const rendererTs = readText('src/renderer.ts');

    assert(!/<small id="txt-output"[^>]*data-i18n=/.test(indexHtml), 'txt-output must not be controlled by static i18n because it renders dynamic state.');
    assert(rendererTs.includes('const renderOutputPath = () =>'), 'renderer must define renderOutputPath.');
    assert(rendererTs.includes('renderOutputPath();'), 'renderer must use renderOutputPath when translations or output state change.');
}

function validateBackgroundRemovalRuntime() {
    const processorTs = readText('src/processor.ts');

    assert(processorTs.includes("require('onnxruntime-node')"), 'processor must use onnxruntime-node directly for offline background removal.');
    assert(!processorTs.includes("from '@imgly/background-removal-node'"), 'processor must not route Linux processing through the crashing IMG.LY Node wrapper.');
    assert(processorTs.includes("executionProviders: ['cpu']"), 'background removal must use the CPU ONNX execution provider.');
    assert(processorTs.includes("executionMode: 'sequential'"), 'background removal must use sequential ONNX execution for native runtime stability.');
    assert(processorTs.includes("intraOpNumThreads: 1"), 'background removal must cap ONNX intra-op threads.');
    assert(processorTs.includes("interOpNumThreads: 1"), 'background removal must cap ONNX inter-op threads.');
    assert(processorTs.includes('loadBackgroundModelBuffer'), 'processor must load bundled background model chunks explicitly.');
    assert(processorTs.includes('resizeSingleChannelMask'), 'processor must resize alpha masks with IMG.LY-compatible single-channel bilinear interpolation.');
    assert(processorTs.includes('hasVisibleFaceAlpha'), 'processor must validate face visibility before accepting a background mask.');
    assert(processorTs.includes('using full-opacity source fallback'), 'processor must preserve the detected face when segmentation produces an invalid mask.');
}

function main() {
    validatePackageConfig();
    validateWorkflows();
    validateReleasePleaseConfig();
    validateReleaseGovernance();
    validateLockfilePolicy();
    validateRendererStateOwnership();
    validateBackgroundRemovalRuntime();
    console.log('Release configuration validation passed.');
}

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
