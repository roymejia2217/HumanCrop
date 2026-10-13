import { readFile } from 'node:fs/promises';
import { remark } from 'remark';
import standardReadmePreset from 'standard-readme-preset';
import requireSections from 'standard-readme-preset/rules/require-sections.js';
import consistent from 'remark-preset-lint-consistent';
import recommended from 'remark-preset-lint-recommended';

// Execute upstream remark plugins; no custom README rules or regex heuristics.
const source = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
const file = await remark()
  .use(standardReadmePreset)
  .use(requireSections, { installable: true })
  .use(recommended)
  .use(consistent)
  .process({ value: source, path: 'HumanCrop/README.md' });

for (const issue of file.messages) {
  console.error(issue.toString());
}

if (file.messages.length > 0) {
  process.exitCode = 1;
} else {
  console.log('README.md: Standard Readme validation passed');
}
