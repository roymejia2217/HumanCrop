# Contributing

HumanCrop accepts focused changes that preserve the repository's offline-processing, packaging, and governance contracts.

Use [GitHub Issues](https://github.com/roymejia2217/HumanCrop/issues) for questions and bug reports. Pull requests are accepted when they follow the repository governance and validation requirements below.

## Development Setup

Requirements:

- Node.js 22.12.0 or newer.
- npm 10 or newer.
- Git LFS for bundled model assets.

```bash
git clone https://github.com/roymejia2217/HumanCrop.git
cd HumanCrop
git lfs pull
npm install
npm run build
```

## Change Workflow

1. Start from the current `main` branch and create a focused branch.
2. Keep each change scoped to one concern.
3. Use Conventional Commits with one of the types and scopes accepted by [`.commitlintrc.json`](.commitlintrc.json).
4. Include a meaningful commit body; repository governance rejects empty bodies.
5. Do not force-push reviewed branch history unless recovery explicitly requires it.
6. Open a pull request using the repository template and keep its What, Why, Testing, and Related issues sections accurate.

Example:

```text
docs(docs): clarify development setup

Document the Git LFS and validation steps required before packaging.
```

## Validation

Run the checks relevant to the change before opening or updating a pull request:

```bash
npm test
npm run build
npm run lint:docs
```

Packaging changes must also satisfy the production AppImage contract executed by CI. CI remains authoritative even when local checks pass.

## Documentation

Keep `README.md` aligned with [Standard Readme](https://github.com/RichardLitt/standard-readme), keep local references valid, and avoid adding external links that cannot be verified reliably.

## Pull Requests

Pull request titles follow the same scoped Conventional Commit policy as commit messages. Keep the pull request focused, document the verification performed, and address review feedback with append-only commits while the branch is under review.
