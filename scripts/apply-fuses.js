const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('path');

/** 
 * Post-packaging script to apply Electron Fuses.
 * Enhances application security by locking down runtime features.
 */
exports.default = async function(context) {
    const isMac = context.electronPlatformName === 'darwin';
    const isWin = context.electronPlatformName === 'win32';
    
    /** Locate the generated Electron executable binary */
    const executableName = context.packager.appInfo.productFilename + (isWin ? '.exe' : '');
    const executablePath = path.join(
        context.appOutDir,
        isMac ? `${context.packager.appInfo.productFilename}.app/Contents/MacOS/${context.packager.appInfo.productFilename}` : executableName
    );

    console.log(`[Fuses] Locking down Electron Binary: ${executablePath}`);

    await flipFuses(executablePath, {
        version: FuseVersion.V1,
        /** Required for child_process.fork() functionality used by the WorkerPool */
        [FuseV1Options.RunAsNode]: true,
        /** Protects browser cookies stored on disk */
        [FuseV1Options.EnableCookieEncryption]: true,
        /** Prevents passing Node.js flags via CLI arguments to mitigate injection attacks */
        [FuseV1Options.EnableNodeOptionsCli]: false,
        /** Disables native Node.js debug mode arguments */
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        /** Disabled: Requires header injection not fully supported by the current build pipeline */
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
        /** Restricts the application to only load files from the official ASAR package */
        [FuseV1Options.OnlyLoadAppFromAsar]: true
    });
    
    console.log(`[Fuses] Security Fuses applied successfully.`);
};
