const assert = require('node:assert/strict');
const { test } = require('node:test');
const packageJson = require('../package.json');

test('AppImage artifact name omits the redundant Linux platform token', () => {
  assert.equal(
    packageJson.build.appImage?.artifactName,
    '${productName}-${version}-${arch}.${ext}'
  );
});

test('AppImage packaging avoids electron-builder maximum compression', () => {
  assert.notEqual(
    packageJson.build.compression,
    'maximum',
    'electron-builder 24.13.3 maps maximum AppImage compression to SquashFS/XZ'
  );
});
