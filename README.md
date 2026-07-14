# Ramsey County, MN — Parcel Search

A local, full-screen terminal (TUI) tool to search **attributed parcels in Ramsey
County, Minnesota** by **property owner** (or taxpayer) name — or by **site
address** (fuzzy) — and view the parcel record. Everything runs on your machine —
no network access after the one-time data download.

```
Ramsey County, MN — Parcel Search  (167,643 parcels)

Owner name: doe

› JANE DOE          100 MAPLE ST  SAINT PAUL  $274,100
  DOE HOLDINGS LLC  42 CEDAR CT   MAPLEWOOD   $631,900
2 matches · ↑↓ move · Enter open · Ctrl+C quit
```

<sub>Example output uses fictional owners and addresses.</sub>

## Data source

Official **Ramsey County Parcel Data** published on the Minnesota Geospatial
Commons, distributed as an OGC GeoPackage and refreshed monthly:

- Dataset page: https://gisdata.mn.gov/dataset/us-mn-co-ramsey-plan-parcel-data
- GeoPackage download:
  https://resources.gisdata.mn.gov/pub/gdrs/data/pub/us_mn_co_ramsey/plan_parcel_data/gpkg_plan_parcel_data.zip

The tool reads the `plan_attributedparcelpoint` layer (one fully-attributed row
per parcel: owner, taxpayer, site address, land use, structure, valuation, taxes,
last sale, coordinates).

## Requirements

- [Bun](https://bun.com) (uses Bun's built-in `bun:sqlite` — no native modules to compile)

## Setup

```bash
bun install

# 1. Download + unzip the latest GeoPackage (~175 MB zip → ~750 MB .gpkg) into ./data
bun run refresh-data

# 2. Build the lean, indexed search database (./data/parcels.db, ~82 MB)
bun run build-db
```

`refresh-data` streams the current GeoPackage from the Minnesota Geospatial
Commons and unzips it for you. Pass `--build` to rebuild the search database in
the same step:

```bash
bun run refresh-data --build
```

<details>
<summary>Prefer to download by hand?</summary>

```bash
curl -L -o data/gpkg_plan_parcel_data.zip \
  https://resources.gisdata.mn.gov/pub/gdrs/data/pub/us_mn_co_ramsey/plan_parcel_data/gpkg_plan_parcel_data.zip
cd data && unzip -o gpkg_plan_parcel_data.zip && cd ..
```
</details>

`build-db` extracts the key fields into a slim SQLite database and builds two FTS5
indexes — one over the owner/taxpayer name fields, and a trigram index over the
site address (+ city + ZIP) for fuzzy address matching — so searches are instant.

> Already have a `data/parcels.db` from before address search existed? Add the
> address index without rebuilding from the GeoPackage:
>
> ```bash
> bun run scripts/add-address-index.mjs
> ```

## Use

```bash
bun run search          # or: bun run start  /  ./src/cli.jsx
```

- Type an owner or taxpayer name. Results filter as you type (tokens are AND-ed,
  prefix-matched — e.g. `john anders` matches "JOHN ANDERSON").
- `Tab` toggles between **owner name** and **address** search. In address mode,
  matching is fuzzy/substring — `1930 rice` or `labore rd` both work, and tokens
  can appear mid-string (short tokens under 3 characters are ignored).
- `↑` / `↓` to move, `Enter` to open the full record.
- `Esc` / `←` to go back to the results, `Ctrl+C` to quit.

## Updating the data

When Ramsey County publishes a new monthly release, refresh and rebuild in one go:

```bash
bun run refresh-data --build
```

## Project layout

| Path | Purpose |
|------|---------|
| `scripts/refresh-data.mjs` | Downloads + unzips the latest GeoPackage (`--build` also rebuilds the DB) |
| `scripts/build-db.mjs` | Builds `data/parcels.db` (+ name & address FTS indexes) from the GeoPackage |
| `scripts/add-address-index.mjs` | Adds the fuzzy address index to an existing DB (no rebuild) |
| `src/db.mjs` | Read-only data access: owner search, fuzzy address search, record fetch |
| `src/cli.jsx` | Ink full-screen TUI |
| `scripts/tui-smoke.mjs` | Headless smoke test of the TUI |
| `data/` | GeoPackage + derived DB (git-ignored; regenerate locally) |

## Test

```bash
bun run scripts/tui-smoke.mjs
```
