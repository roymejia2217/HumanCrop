# Releasing HumanCrop

HumanCrop uses Release Please to derive versions from Conventional Commits, update release metadata, and create GitHub releases. Release publication is fail-closed: a release remains a draft until the exact Windows and Linux candidates have been built, verified, checksummed, uploaded, and compared with GitHub's recorded asset digests.

## Release Identity

Release Please must use a dedicated GitHub App installed only on the HumanCrop repository. Do not use a personal access token for automated releases.

The GitHub App requires these repository permissions:

- Contents: read and write.
- Issues: read and write.
- Pull requests: read and write.

Store the App Client ID as the repository variable `HUMANCROP_RELEASE_APP_CLIENT_ID` and its private key as the repository secret `HUMANCROP_RELEASE_APP_PRIVATE_KEY`.

Until both values exist, automatic release orchestration stays dormant. Release orchestration is triggered only after a successful `CI` run on `main`; there is no manual dispatch path that bypasses that gate.

## Release Flow

1. A successful `CI` run on `main` triggers the Release workflow.
2. Release Please creates or updates a draft release pull request.
3. The release pull request must pass normal CI and pull request governance.
4. Merging the release pull request updates the version, changelog, and manifest.
5. After `main` CI succeeds, the release workflow detects the governed release commit and verifies that the exact SHA previously passed main CI.
6. Windows and Linux release candidates are built from that exact pending release SHA before any new release tag is created.
7. Each candidate is validated and recorded with SHA-256.
8. Only after both candidate builds pass does Release Please create the version tag and draft GitHub release.
9. The publish job downloads those same candidates, verifies the tag target and checksums, uploads the assets, and compares GitHub asset digests.
10. Only after every verification succeeds is the draft changed to a published release.

## Bootstrap State

Release Please starts from the existing `v1.0.0` publication:

- Manifest baseline: `1.0.0`.
- Bootstrap commit: `0ecea98c7f3f00665b899781f1fe299de1cb2e8b`.
- Tags remain in the `vX.Y.Z` format without a component prefix.

The catalog-compatibility correction after `v1.0.0` is a `fix(packaging)` change, so the first Release Please proposal is expected to be `1.0.1`.

## Recovery Rules

Do not move an existing release tag, rebuild an already verified candidate during publication, or publish a draft after a failed verification.

If a build fails before tag creation, correct the cause through a governed pull request. The next successful `main` CI run can recover the still-untagged release because the workflow locates the governed release commit in history and revalidates its prior CI success.

If publication fails after the draft release exists, diagnose the failure before removing any draft assets and retrying. The publish job refuses to overwrite pre-existing assets automatically.
