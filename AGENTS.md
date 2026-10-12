# AGENTS.md

A local full-screen terminal (Ink/React) tool that searches attributed parcels
across Ramsey and Hennepin Counties, MN, by owner or site address. Source data
comes from each county's public ArcGIS REST service, is cached locally as NDJSON
and normalised into one SQLite database with FTS5 indexes. It runs on the
user's machine only and is not deployed. `README.md` holds the data sources,
usage and project layout; this file does not repeat them.

This repository is **public**: keep personal data, private hostnames and
credentials out of everything written here. The README's example owners and
addresses are fictional and must stay so.

## Commands

Bun only (`packageManager` is pinned in `package.json`).

- `bun install`
- `bun run refresh-data [--build]` fetches both counties into `data/`
- `bun run build-db` builds `data/parcels.db`
- `bun run search` starts the TUI
- `bun run scripts/tui-smoke.mjs` is the headless TUI smoke test
- `bun test` is the CI check: it runs `format:check` (Prettier) only; there
  is no unit-test suite

## Constraints

- `data/` (hundreds of MB of caches and the derived DB) is git-ignored;
  regenerate it, never commit it.
- Fetches write to a `.part` file and replace the cache only on completion, so
  a failed fetch leaves the previous cache usable.
- After the one-time download nothing touches the network.

Decisions go in one file per action, `docs/decisions/<KEY>.md`. Fleet policy lives in infrastructure's [docs/house-standards.md](https://git.bck.dev/bkennedy/infrastructure/src/branch/main/docs/house-standards.md); it is linked here, not restated.
