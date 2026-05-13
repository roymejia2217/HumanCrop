const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const modelsDir = path.join(rootDir, 'src', 'assets', 'models');
const lfsPointerSignature = 'version https://git-lfs.github.com/spec/v1';

function collectFiles(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    return entries.flatMap(entry => {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return collectFiles(absolutePath);
        }
        return [absolutePath];
    });
}

function isGitLfsPointer(filePath) {
    const fileHandle = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(lfsPointerSignature.length);
        const bytesRead = fs.readSync(fileHandle, buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead).toString('utf8') === lfsPointerSignature;
    } finally {
        fs.closeSync(fileHandle);
    }
}

function main() {
    if (!fs.existsSync(modelsDir)) {
        throw new Error(`Model assets directory not found: ${path.relative(rootDir, modelsDir)}`);
    }

    const pointerFiles = collectFiles(modelsDir)
        .filter(isGitLfsPointer)
        .map(filePath => path.relative(rootDir, filePath));

    if (pointerFiles.length > 0) {
        throw new Error([
            'Git LFS model assets are not hydrated. Refusing to build incomplete installers.',
            'Run `git lfs install && git lfs pull` before packaging.',
            ...pointerFiles.map(filePath => `- ${filePath}`)
        ].join('\n'));
    }

    console.log('Model asset validation passed.');
}

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
