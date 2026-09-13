# Contributing to slacki

Thanks for contributing.

## Attribution

If you'd like to be credited when we share your contribution on X, include your Twitter/X handle in your PR description.

## Development

Install deps and run the CLI in dev mode:

```bash
bun install
bun run dev -- --help
```

Diagnose local auth without printing secrets:

```bash
bun run dev -- doctor
```

Build and test:

```bash
bun run build
bun run test
bun run typecheck
```

Lint and format:

```bash
bun run lint
bun run format:check
```

Run via Bun directly (for local development):

```bash
bun ./bin/slacki.bun.js --help
```

## Releasing (maintainers)

Releases publish native binaries to GitHub Releases and the package to npm (see `.github/workflows/publish.yml`).

### Using the release script

```bash
# Bump to explicit version
bun run release 0.2.0

# Or use semver bump type
bun run release patch   # 0.1.0 -> 0.1.1
bun run release minor   # 0.1.0 -> 0.2.0
bun run release major   # 0.1.0 -> 1.0.0
```

The script will:

1. Update version in `package.json`
2. Commit with message `v{version}`
3. Create git tag `v{version}`
4. Push to origin (after confirmation)

Pushing the tag triggers the GitHub Actions `Release` workflow, which:

- Builds native binaries for all platforms (macOS, Linux, Windows × x64, arm64)
- Generates checksums
- Uploads everything to the GitHub Release

### Manual release (alternative)

```bash
# 1. Update version in package.json
# 2. Commit and tag
git add package.json
git commit -m "v0.2.0"
git tag v0.2.0
git push origin master --tags
```

### User installation

Users install the binary via:

```bash
curl -fsSL https://raw.githubusercontent.com/codealisha99/slacki/master/install.sh | sh
```

Or download directly from [GitHub Releases](https://github.com/codealisha99/slacki/releases).
