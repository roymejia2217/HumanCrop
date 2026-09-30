const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');

const sharpPackage = JSON.parse(
  fs.readFileSync(path.join(path.dirname(require.resolve('sharp')), '..', 'package.json'), 'utf8'),
);

function versionTuple(version) {
  return version.split('.').slice(0, 3).map(part => Number.parseInt(part, 10));
}

test('Sharp runtime stays on the security-fixed 0.35.x line', () => {
  const [major, minor, patch] = versionTuple(sharpPackage.version);
  assert.equal(major, 0);
  assert.equal(minor, 35, `Sharp ${sharpPackage.version} is outside the governed 0.35.x line`);
  assert.ok(patch >= 5, `Sharp ${sharpPackage.version} is below 0.35.5`);
});

test('Sharp preserves HumanCrop image-processing primitives', async () => {
  const input = await sharp({
    create: {
      width: 12,
      height: 8,
      channels: 3,
      background: { r: 64, g: 128, b: 192 },
    },
  }).png().toBuffer();

  const inputMeta = await sharp(input).metadata();
  assert.equal(inputMeta.width, 12);
  assert.equal(inputMeta.height, 8);

  const working = await sharp(input)
    .rotate()
    .resize({ width: 6, height: 6, fit: 'inside', withoutEnlargement: true })
    .toBuffer();

  const rgb = await sharp(working)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(rgb.info.channels, 3);
  assert.equal(rgb.data.length, rgb.info.width * rgb.info.height * 3);

  const rgba = await sharp(working)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(rgba.info.channels, 4);
  assert.equal(rgba.data.length, rgba.info.width * rgba.info.height * 4);

  const person = await sharp(working).resize({ width: 4 }).png().toBuffer();
  const canvas = await sharp({
    create: {
      width: 10,
      height: 10,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  }).png().toBuffer();

  const output = await sharp(canvas)
    .composite([{ input: person, gravity: 'center' }])
    .png({ quality: 100 })
    .toBuffer();
  const outputMeta = await sharp(output).metadata();
  assert.equal(outputMeta.format, 'png');
  assert.equal(outputMeta.width, 10);
  assert.equal(outputMeta.height, 10);
});
