const releasePleaseCommit = /^chore\(main\): release \d+\.\d+\.\d+$/;

module.exports = {
  extends: ['@commitlint/config-conventional'],
  defaultIgnores: false,
  ignores: [
    message => releasePleaseCommit.test(message.trim()),
  ],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'perf',
        'refactor',
        'docs',
        'style',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'core',
        'ai',
        'processor',
        'ui',
        'i18n',
        'packaging',
        'ci',
        'deps',
        'docs',
        'governance',
        'release',
        'main',
      ],
    ],
    'scope-empty': [2, 'never'],
    'header-max-length': [2, 'always', 72],
    'body-empty': [2, 'never'],
    'body-min-length': [2, 'always', 20],
    'body-leading-blank': [2, 'always'],
    'body-max-line-length': [2, 'always', 100],
    'footer-leading-blank': [2, 'always'],
    'footer-max-line-length': [2, 'always', 100],
  },
};
