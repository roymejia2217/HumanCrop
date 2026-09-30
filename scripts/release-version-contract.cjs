function fail(message) {
  throw new Error(message);
}

function validateReleaseVersionCoherence({ packageJson, packageLock, manifest }) {
  const packageVersion = packageJson && packageJson.version;
  const manifestVersion = manifest && manifest['.'];
  const lockVersion = packageLock && packageLock.version;
  const lockRootVersion = packageLock && packageLock.packages && packageLock.packages[''] && packageLock.packages[''].version;

  if (!packageVersion) fail('package.json version must be defined.');
  if (manifestVersion !== packageVersion) {
    fail(`Release Please manifest version ${manifestVersion} must match package.json version ${packageVersion}.`);
  }
  if (lockVersion !== packageVersion || lockRootVersion !== packageVersion) {
    fail(`package-lock.json lockfile versions must match package.json version ${packageVersion}.`);
  }

  return true;
}

module.exports = { validateReleaseVersionCoherence };
