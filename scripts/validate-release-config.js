const fs = require('fs');
const path = require('path');

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

    assert(packageJson.scripts && packageJson.scripts.test === 'node scripts/validate-release-config.js', 'package.json must define npm test for release config validation.');
    assert(packageJson.scripts['dist:win'], 'package.json must define dist:win.');
    assert(packageJson.scripts['dist:linux'], 'package.json must define dist:linux.');
    assert(packageJson.scripts['dist:all'], 'package.json must define dist:all.');
    assert(packageJson.scripts['validate:models'] === 'node scripts/validate-model-assets.js', 'package.json must define validate:models.');
    assert(packageJson.scripts.dist.includes('npm run validate:models'), 'dist must validate model assets before packaging.');
    assert(packageJson.scripts['dist:win'].includes('npm run validate:models'), 'dist:win must validate model assets before packaging.');
    assert(packageJson.scripts['dist:linux'].includes('npm run validate:models'), 'dist:linux must validate model assets before packaging.');
    assert(packageJson.scripts['dist:all'].includes('npm run validate:models'), 'dist:all must validate model assets before packaging.');
    assert(packageJson.dependencies && packageJson.dependencies['onnxruntime-node'] === '1.17.3', 'onnxruntime-node must be a direct pinned dependency for offline background removal.');
    assert(!packageJson.dependencies['@imgly/background-removal-node'], '@imgly/background-removal-node must not be a runtime dependency because its Linux native wrapper crashes during processing.');
    assert(build.compression === 'maximum', 'electron-builder compression must be set to maximum.');
    assert(typeof build.artifactName === 'string' && build.artifactName.includes('${productName}') && build.artifactName.includes('${version}') && build.artifactName.includes('${ext}'), 'electron-builder artifactName must include productName, version, and extension.');
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

    assert(/tags:\s*\n\s*-\s*['"]?v\*\.\*\.\*['"]?/.test(releaseWorkflow), 'Release workflow must run only for semantic version tags.');
    assert(/lfs:\s*true/.test(releaseWorkflow), 'Release workflow must enable Git LFS checkout.');
    assert(releaseWorkflow.includes('npm ci'), 'Release workflow must use npm ci.');
    assert(releaseWorkflow.includes('npm run dist:win'), 'Release workflow must build Windows artifacts.');
    assert(releaseWorkflow.includes('npm run dist:linux'), 'Release workflow must build Linux artifacts.');
    assert(releaseWorkflow.includes('gh release create'), 'Release workflow must create releases with GitHub CLI.');
    assert(releaseWorkflow.includes('--verify-tag'), 'Release workflow must verify the remote tag before creating a release.');
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
