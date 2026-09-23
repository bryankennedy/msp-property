#!/usr/bin/env bun
// Fetch Hennepin County parcel data from the county's public ArcGIS REST service
// and cache it as newline-delimited JSON (one parcel's raw attributes per line)
// in data/hennepin_parcels.ndjson.
//
// Hennepin exposes its parcels through an ArcGIS MapServer, so we page through
// the layer (2,000 records at a time, ~450k parcels) and keep only the
// attributes we need.
// scripts/build-db.mjs then normalizes these into the shared `parcels` schema.
//
// Run with: bun run scripts/fetch-hennepin.mjs

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchLayerToNdjson } from "./arcgis.mjs";

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

const __dirname = dirname(fileURLToPath(import.meta.url));

await fetchLayerToNdjson({
  label: "Hennepin",
  layer: LAYER,
  outFields: OUT_FIELDS,
  outPath: join(__dirname, "..", "data", "hennepin_parcels.ndjson"),
});
