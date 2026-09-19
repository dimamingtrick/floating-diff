# Releasing

1. Bump `version` in package.json (`npm version minor --no-git-tag-version`) and add the version to CHANGELOG.md.
2. Commit and push to `main`.
3. Upload the .vsix of the new GitHub release at https://marketplace.visualstudio.com/manage (the extension's ⋯ → Update).

For a version that is not out yet, the Release workflow (`.github/workflows/release.yml`) runs the unit tests, packages the extension, creates the GitHub release `v<version>` with the .vsix and publishes it to Open VSX (Cursor). Pushes without a new version publish nothing.

Open VSX takes the token in the repository secret `OVSX_PAT` (open-vsx.org → Settings → Access Tokens). The VS Code Marketplace stays manual: publishing to it from CI takes an Azure managed identity now that global Azure DevOps tokens end (2026-12-01), until the Marketplace's trusted publishing (`vsce publish --oidc`) is live.
