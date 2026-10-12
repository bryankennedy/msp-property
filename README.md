# Ramsey + Hennepin County, MN — Parcel Search

A local, full-screen terminal (TUI) tool to search **attributed parcels across
Ramsey and Hennepin Counties, Minnesota** by **property owner** (or taxpayer)
name — or by **site address** (fuzzy) — and view the parcel record. Both counties
are normalized into one searchable dataset, and each result is tagged with the
county it came from. Everything runs on your machine — no network access after
the one-time data download.

```
Ramsey + Hennepin County, MN — Parcel Search  (615,906 parcels)

Owner name: doe

  County    Owner             Address        City         Value
› Ramsey    JANE DOE          100 MAPLE ST   SAINT PAUL   $274,100
  Hennepin  DOE HOLDINGS LLC  42 CEDAR CT    MINNEAPOLIS  $631,900
2 matches · ↑↓ move · Enter or click open · Ctrl+C quit
```

<sub>Example output uses fictional owners and addresses.</sub>

## Data sources

Both are official public datasets served from each county's ArcGIS REST service.
Neither offers a single file download, so `fetch-ramsey.mjs` and
`fetch-hennepin.mjs` page each layer into a local NDJSON cache. The two counties
have different schemas, so `build-db` normalizes them into one shared `parcels`
table with a `County` column.

**Ramsey County Attributed Parcel Points** — listed on the Minnesota Geospatial
Commons (https://gis.data.mn.gov) and refreshed monthly:

- Service: `https://gis.ramseycountymn.gov/server/rest/services/Cadastral/CAD_AttributedParcelPoint_ViewOnly/FeatureServer/0`

One fully-attributed row per parcel: owner, taxpayer, site address, land use,
structure, valuation, taxes, last sale, coordinates. (This replaced the
`plan_attributedparcelpoint` GeoPackage, which was retired when the Geospatial
Commons moved to ArcGIS Hub in 2026. The field names are unchanged.)

**Hennepin County Parcels**:

- Service: `https://gis.hennepin.us/arcgis/rest/services/HennepinData/LAND_PROPERTY/MapServer/1`
  (layer "County Parcels")

Hennepin publishes owner, taxpayer + mailing address, site address, homestead
status, land use, valuation, taxes, sale, year built and coordinates. A few
Ramsey-only fields (bedrooms, living area, structure type, lot acreage) aren't in
the Hennepin data and simply display as `—` for those parcels.

## Requirements

- [Bun](https://bun.com) (uses Bun's built-in `bun:sqlite` — no native modules to compile)

## Setup

```bash
bun install

# 1. Fetch both counties' source data into ./data:
#    - Ramsey:   ~170k parcels paged into a ~150 MB NDJSON cache
#    - Hennepin: ~450k parcels paged into a ~270 MB NDJSON cache
bun run refresh-data

# 2. Build the lean, indexed search database (./data/parcels.db)
bun run build-db
```

`refresh-data` pages both counties' parcels from their ArcGIS services. Pass
`--build` to rebuild the search database in the same step:

```bash
bun run refresh-data --build
```

<details>
<summary>Prefer to fetch each county by hand?</summary>

```bash
# Ramsey parcels (paged from ArcGIS into data/ramsey_parcels.ndjson)
bun run scripts/fetch-ramsey.mjs

# Hennepin parcels (paged from ArcGIS into data/hennepin_parcels.ndjson)
bun run scripts/fetch-hennepin.mjs
```
</details>

`build-db` normalizes both counties into a slim SQLite database and builds two
FTS5 indexes — one over the owner/taxpayer name fields, and a trigram index over
the site address (+ city + ZIP) for fuzzy address matching — so searches are
instant. If the Hennepin cache is missing it builds Ramsey-only and warns.

### Offline copies

The NDJSON caches in `data/` are your local copy of the source data. A fetch
writes to a `.part` file and replaces the cache only once it completes, so if a
county's service is down or changes, the previous cache stays put and
`bun run build-db` still rebuilds from it. `data/` is git-ignored, so back it up
somewhere else (another disk, cloud storage) if you want a copy that survives
losing this machine.

> Already have a `data/parcels.db` from before address search existed? Add the
> address index without a full rebuild:
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
- Every result row (and the detail view) is tagged with its **county** — Ramsey
  or Hennepin — since searches span both.
- `↑` / `↓` (or the scroll wheel) to move, `Enter` to open the full record — or
  click a result to open it. While the results list is up the app takes the
  mouse, so hold `Shift` (`Option` in iTerm/Terminal.app) to select text; the
  detail view leaves the mouse to the terminal.
- `Esc` / `←` to go back to the results, `Ctrl+C` to quit.

## Updating the data

When either county publishes a new release, refresh both and rebuild in one go:

```bash
bun run refresh-data --build
```

## Project layout

| Path | Purpose |
|------|---------|
| `scripts/refresh-data.mjs` | Fetches both counties' source data (`--build` also rebuilds the DB) |
| `scripts/fetch-ramsey.mjs` | Pages Ramsey parcels from ArcGIS into `data/ramsey_parcels.ndjson` |
| `scripts/fetch-hennepin.mjs` | Pages Hennepin parcels from ArcGIS into `data/hennepin_parcels.ndjson` |
| `scripts/arcgis.mjs` | Shared ArcGIS layer → NDJSON pager used by both fetch scripts |
| `scripts/build-db.mjs` | Normalizes both counties into `data/parcels.db` (+ name & address FTS indexes) |
| `scripts/add-address-index.mjs` | Adds the fuzzy address index to an existing DB (no rebuild) |
| `src/db.mjs` | Read-only data access: owner search, fuzzy address search, record fetch |
| `src/cli.jsx` | Ink full-screen TUI |
| `scripts/tui-smoke.mjs` | Headless smoke test of the TUI |
| `data/` | Source data (Ramsey + Hennepin NDJSON caches) + derived DB (git-ignored; regenerate locally) |

## Test

```bash
bun run scripts/tui-smoke.mjs
```
