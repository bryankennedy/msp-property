#!/usr/bin/env bun
// Fetch Hennepin County parcel data from the county's public ArcGIS REST service
// and cache it as newline-delimited JSON (one parcel's raw attributes per line)
// in data/hennepin_parcels.ndjson.
//
// Ramsey County publishes a single downloadable GeoPackage; Hennepin instead
// exposes its parcels through an ArcGIS MapServer, so we page through the layer
// (2,000 records at a time, ~450k parcels) and keep only the attributes we need.
// scripts/build-db.mjs then normalizes these into the shared `parcels` schema.
//
// Run with: bun run scripts/fetch-hennepin.mjs

import { createWriteStream, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LAYER =
  "https://gis.hennepin.us/arcgis/rest/services/HennepinData/LAND_PROPERTY/MapServer/1";

// Only the attributes build-db maps into the shared schema — keeps the cache
// small and the requests fast.
const OUT_FIELDS = [
  "PID",
  "PID_TEXT",
  "PR_TYP_NM1",
  "HMSTD_CD1",
  "OWNER_NM",
  "TAXPAYER_NM",
  "TAXPAYER_NM_1",
  "TAXPAYER_NM_2",
  "MAILING_MUNIC_NM",
  "HOUSE_NO",
  "FRAC_HOUSE_NO",
  "STREET_NM",
  "MUNIC_NM",
  "ZIP_CD",
  "BUILD_YR",
  "PARCEL_AREA",
  "LAND_MV1",
  "BLDG_MV1",
  "MKT_VAL_TOT",
  "TAX_TOT",
  "SALE_DATE",
  "SALE_PRICE",
  "LAT",
  "LON",
];

const PAGE = 2000; // service maxRecordCount

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "data", "hennepin_parcels.ndjson");

const fmtMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function getJSON(url, { tries = 4 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const j = await res.json();
      if (j.error) throw new Error(`ArcGIS error: ${JSON.stringify(j.error)}`);
      return j;
    } catch (err) {
      lastErr = err;
      if (attempt < tries) {
        const backoff = 500 * 2 ** (attempt - 1);
        console.warn(`  request failed (${err.message}); retry ${attempt}/${tries - 1}…`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw lastErr;
}

function queryUrl(offset) {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: OUT_FIELDS.join(","),
    returnGeometry: "false",
    orderByFields: "OBJECTID", // stable ordering is required for reliable paging
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
    f: "json",
  });
  return `${LAYER}/query?${params}`;
}

console.log("Counting Hennepin parcels…");
const countRes = await getJSON(
  `${LAYER}/query?where=${encodeURIComponent("1=1")}&returnCountOnly=true&f=json`,
);
const total = countRes.count ?? 0;
console.log(`Fetching ${total.toLocaleString()} parcels in pages of ${PAGE}…`);

const out = createWriteStream(outPath);
let written = 0;
for (let offset = 0; ; offset += PAGE) {
  const page = await getJSON(queryUrl(offset));
  const feats = page.features ?? [];
  for (const f of feats) out.write(JSON.stringify(f.attributes) + "\n");
  written += feats.length;
  process.stdout.write(
    `\r  ${written.toLocaleString()} / ${total.toLocaleString()} parcels`,
  );
  // Stop when the service says there is no more, or a short page comes back.
  if (!page.exceededTransferLimit && feats.length < PAGE) break;
  if (feats.length === 0) break;
}
process.stdout.write("\n");

await new Promise((resolve, reject) => {
  out.end((err) => (err ? reject(err) : resolve()));
});

console.log(
  `Done. Wrote ${written.toLocaleString()} parcels (${fmtMB(statSync(outPath).size)}) → ${outPath}`,
);
if (total && written < total * 0.99) {
  console.warn(
    `Warning: wrote ${written} of ${total} expected parcels — the service may have thrown mid-run.`,
  );
  process.exit(1);
}
