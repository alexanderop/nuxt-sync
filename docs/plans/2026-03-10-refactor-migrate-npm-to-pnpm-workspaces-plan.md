---
title: "Migrate from npm to pnpm with pnpm workspaces"
type: refactor
status: active
date: 2026-03-10
---

# Migrate from npm to pnpm with pnpm Workspaces

## Overview

Switch the nuxt-sync project from npm to pnpm and set up a pnpm workspace with three packages: the root module (publishable), `playground/` (dev app), and `docs/` (future documentation site).

## Problem Statement / Motivation

- npm's flat `node_modules` and slower installs are suboptimal for module development
- pnpm provides content-addressable storage, strict dependency resolution, and faster installs
- A workspace structure isolates playground and docs dependencies, making the project ready for growth
- pnpm is the standard package manager in the Nuxt ecosystem (Nuxt itself uses pnpm workspaces)

## Proposed Solution

Migrate to pnpm 10+ with a workspace that treats `playground/` and `docs/` as workspace packages while keeping the root as the publishable `nuxt-sync` module.

### Key Design Decisions

1. **Root is NOT `private: true`** — The root `package.json` is the publishable `nuxt-sync` module. Only `playground` and `docs` are private.
2. **Keep relative imports in playground** — `playground/nuxt.config.ts` keeps `'../src/module'` and `playground/shared/schema.ts` keeps its relative import. This matches the official Nuxt module starter convention and avoids requiring `dev:prepare` before every dev session.
3. **`shamefullyHoist: true`** — Required for reliable Nuxt dependency resolution in pnpm (vue-router, generated types, implicit deps).
4. **Settings in `pnpm-workspace.yaml`** — pnpm 10+ moved non-auth settings from `.npmrc` into `pnpm-workspace.yaml`.
5. **Corepack via `packageManager` field** — Pins exact pnpm version for reproducibility.

## Technical Considerations

- **Nuxt + pnpm hoisting**: Without `shamefullyHoist: true`, Nuxt has known issues with multiple Vue instances and broken type generation ([nuxt/nuxt#14146](https://github.com/nuxt/nuxt/issues/14146))
- **@nuxt/module-builder v0.8.4**: Works fine in workspaces, no special config needed
- **Playwright E2E**: Uses `npx` which must change to `pnpm exec`
- **No CI/CD exists**: No pipelines need updating
- **Corepack**: Ships with Node 20/22 LTS; will require separate install on Node 25+

## Implementation Plan

### Phase 1: Clean Up

- [ ] Delete `package-lock.json`
- [ ] Delete all `node_modules/` directories (root + `playground/node_modules/.cache/`)
- [ ] Delete `playground/.nuxt/` (stale generated types)

### Phase 2: Create Workspace Configuration

- [ ] Create `pnpm-workspace.yaml`:

```yaml
# pnpm-workspace.yaml
packages:
  - 'playground'
  - 'docs'

shamefullyHoist: true
```

### Phase 3: Update Root `package.json`

- [ ] Add `packageManager` field (pin pnpm version):

```json
"packageManager": "pnpm@10.8.1"
```

- [ ] Add `preinstall` guard to prevent accidental `npm install`:

```json
"scripts": {
  "preinstall": "npx only-allow pnpm",
  ...
}
```

- [ ] Add `dev:prepare` script:

```json
"scripts": {
  "dev:prepare": "nuxt-module-build build --stub && nuxi prepare playground",
  ...
}
```

- [ ] Do NOT add `"private": true` — root is the publishable module

### Phase 4: Create Workspace Package Files

- [ ] Create `playground/package.json`:

```json
{
  "name": "nuxt-sync-playground",
  "private": true,
  "type": "module",
  "devDependencies": {
    "nuxt": "^3.16.0",
    "nuxt-sync": "workspace:*"
  }
}
```

- [ ] Create `docs/` directory and `docs/package.json`:

```json
{
  "name": "nuxt-sync-docs",
  "private": true
}
```

### Phase 5: Update Existing Files

- [ ] Update `playwright.config.ts` — change `npx` to `pnpm exec`:

```ts
// playwright.config.ts:25
command: 'pnpm exec nuxi dev playground --port 3333',
```

- [ ] Update `CLAUDE.md` — replace all `npm run` / `npm test` with `pnpm` equivalents:

```bash
pnpm dev              # Start playground dev server
pnpm build            # Build the module
pnpm dev:prepare      # Stub module + generate playground types
pnpm prepare          # Generate playground types only
pnpm typecheck        # Typecheck via playground
pnpm test             # Run all vitest tests
pnpm test:unit        # Run unit tests only
pnpm test:composables # Run composable tests only
pnpm test:e2e         # Run Playwright E2E tests
pnpm test:coverage    # Run vitest with V8 coverage
```

- [ ] Verify `.gitignore` — ensure `pnpm-lock.yaml` is NOT listed (it should be committed)

### Phase 6: Install and Verify

- [ ] Run `pnpm install` — generates `pnpm-lock.yaml`
- [ ] Run `pnpm dev:prepare` — stubs module and generates playground types
- [ ] Verify `pnpm dev` — playground starts correctly
- [ ] Verify `pnpm test:unit` — unit tests pass
- [ ] Verify `pnpm test:composables` — composable tests pass
- [ ] Verify `pnpm build` — produces correct `dist/` output
- [ ] Verify `pnpm test:e2e` — E2E tests pass (depends on playground working)

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `package-lock.json` | Delete | Replaced by `pnpm-lock.yaml` |
| `pnpm-workspace.yaml` | Create | Workspace config + pnpm settings |
| `package.json` | Edit | Add `packageManager`, `preinstall`, `dev:prepare` |
| `playground/package.json` | Create | Workspace package with nuxt-sync dep |
| `docs/package.json` | Create | Empty placeholder workspace package |
| `playwright.config.ts` | Edit | `npx` → `pnpm exec` (line 25) |
| `CLAUDE.md` | Edit | `npm` → `pnpm` commands |

## Files NOT Changed

| File | Reason |
|------|--------|
| `playground/nuxt.config.ts` | Keep `'../src/module'` — matches official Nuxt module starter |
| `playground/shared/schema.ts` | Keep relative import — avoids stub requirement |
| `src/**/*.ts` | Relative imports, package-manager agnostic |
| `test/**/*.ts` | Relative imports, package-manager agnostic |
| `vitest.config.ts` | Uses `__dirname` resolution, works with any PM |
| `tsconfig.json` | No path issues |

## Acceptance Criteria

- [ ] `pnpm install` succeeds from a clean clone
- [ ] `pnpm dev` starts the playground dev server
- [ ] `pnpm build` produces correct `dist/` output
- [ ] `pnpm test:unit` and `pnpm test:composables` pass
- [ ] `pnpm test:e2e` passes
- [ ] `pnpm typecheck` passes
- [ ] `npm install` is blocked by the `preinstall` guard
- [ ] `package-lock.json` is deleted and `pnpm-lock.yaml` is committed
- [ ] `pnpm --filter nuxt-sync-playground dev` works (workspace filtering)
- [ ] Root package can still be published (`pnpm publish --dry-run` succeeds)

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| `shamefullyHoist` may not fully resolve Nuxt deps | Test all flows; fall back to targeted `publicHoistPattern` if needed |
| Existing contributors have stale `node_modules` | Document migration: delete `node_modules` + `package-lock.json`, run `pnpm install` |
| `pnpm-workspace.yaml` settings syntax wrong | Verify `shamefullyHoist` works with installed pnpm version before committing |
| Playwright E2E fails with new command | Test `pnpm exec nuxi dev playground --port 3333` explicitly |

## Migration Guide for Contributors

```bash
# After pulling this change:
rm -rf node_modules playground/node_modules playground/.nuxt package-lock.json
corepack enable          # optional, enables pnpm via packageManager field
pnpm install
pnpm dev:prepare         # stub module + generate types
pnpm dev                 # start developing
```

## References

- [pnpm Workspaces](https://pnpm.io/workspaces)
- [pnpm Settings (pnpm-workspace.yaml)](https://pnpm.io/settings)
- [nuxt/nuxt#14146 — pnpm without shamefully-hoist](https://github.com/nuxt/nuxt/issues/14146)
- [Nuxt module starter template](https://github.com/nuxt/starter/tree/module)
- [Nuxt framework pnpm-workspace.yaml](https://github.com/nuxt/nuxt/blob/main/pnpm-workspace.yaml)
