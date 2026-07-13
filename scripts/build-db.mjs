#!/usr/bin/env bun
// Build a lean, searchable SQLite database from the Ramsey County GeoPackage.
//
// Source: data/plan_parcel_data.gpkg  (table: plan_attributedparcelpoint)
// Output: data/parcels.db
//   - `parcels`     : one row per parcel, key attribute fields only (no geometry)
//   - `parcels_fts` : FTS5 full-text index over owner/taxpayer names for fast search
//
// Run with: bun run build-db
// Uses Bun's built-in SQLite driver (bun:sqlite).

import { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data");
const gpkgPath = join(dataDir, "plan_parcel_data.gpkg");
const outPath = join(dataDir, "parcels.db");

if (!existsSync(gpkgPath)) {
  console.error(`GeoPackage not found at ${gpkgPath}`);
  console.error("Download it first (see README), then re-run this script.");
  process.exit(1);
}

// Columns we keep from plan_attributedparcelpoint. Order matters: it defines the
// `parcels` schema below.
const COLUMNS = [
  "ParcelID",
  "OwnershipCategory",
  "OwnerName",
  "OwnerName1",
  "OwnerName2",
  "OwnerLastName",
  "OwnerAddress1",
  "OwnerAddress2",
  "OwnerCityStateZIP",
  "TaxName1",
  "TaxName2",
  "TaxAddress1",
  "TaxAddress2",
  "TaxCityStateZIP",
  "SiteAddress",
  "SiteCityName",
  "SiteZIP5",
  "LandUseCodeDescription",
  "StructureDescription",
  "DwellingType",
  "YearBuilt",
  "BedRoom",
  "LivingAreaSquareFeet",
  "ParcelAcresDeed",
  "ParcelSquareFeet",
  "TaxYear",
  "EMVLand",
  "EMVBuilding",
  "EMVTotal",
  "TotalTax",
  "LastSaleDate",
  "SalePrice",
  "Latitude",
  "Longitude",
];

// Start fresh so reruns are deterministic.
for (const suffix of ["", "-wal", "-shm"]) {
  const p = outPath + suffix;
  if (existsSync(p)) rmSync(p);
}

console.log("Opening output database…");
const db = new Database(outPath, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = OFF;");

db.exec(`
  CREATE TABLE parcels (
    rowid INTEGER PRIMARY KEY,
    ${COLUMNS.map((c) => `"${c}"`).join(",\n    ")}
  );
`);

console.log("Attaching GeoPackage and copying rows…");
db.exec(`ATTACH DATABASE '${gpkgPath.replace(/'/g, "''")}' AS gpkg;`);

const colList = COLUMNS.map((c) => `"${c}"`).join(", ");
db.exec(`
  INSERT INTO parcels (rowid, ${colList})
  SELECT OBJECTID, ${colList}
  FROM gpkg.plan_attributedparcelpoint;
`);

const count = db.query("SELECT COUNT(*) AS n FROM parcels").get().n;
console.log(`Copied ${count.toLocaleString()} parcels.`);

console.log("Building full-text search index over owner/taxpayer names…");
// External-content FTS5 table backed by `parcels`. We index the name fields that
// a user would search by; rowid links back to the parcels table.
db.exec(`
  CREATE VIRTUAL TABLE parcels_fts USING fts5(
    OwnerName, OwnerName1, OwnerName2, OwnerLastName, TaxName1, TaxName2,
    content='parcels',
    content_rowid='rowid',
    tokenize='unicode61'
  );
`);
db.exec(`
  INSERT INTO parcels_fts (rowid, OwnerName, OwnerName1, OwnerName2, OwnerLastName, TaxName1, TaxName2)
  SELECT rowid, OwnerName, OwnerName1, OwnerName2, OwnerLastName, TaxName1, TaxName2
  FROM parcels;
`);

console.log("Building fuzzy address index (site address + city + zip)…");
// A separate trigram-tokenized FTS index for fuzzy address search. The trigram
// tokenizer matches arbitrary substrings (LIKE-style), so partial street names
// and house numbers match even mid-string. `addr` holds the combined, normalized
// site address; rowid links back to the parcels table.
db.exec(`
  CREATE VIRTUAL TABLE parcels_addr_fts USING fts5(
    addr,
    tokenize='trigram'
  );
`);
db.exec(`
  INSERT INTO parcels_addr_fts (rowid, addr)
  SELECT rowid,
         TRIM(
           COALESCE("SiteAddress", '') || ' ' ||
           COALESCE("SiteCityName", '') || ' ' ||
           COALESCE("SiteZIP5", '')
         )
  FROM parcels
  WHERE COALESCE("SiteAddress", '') <> '';
`);

// Helpful secondary index for exact parcel-id lookups.
db.exec(`CREATE INDEX idx_parcels_parcelid ON parcels("ParcelID");`);

db.exec("DETACH DATABASE gpkg;");
// Checkpoint the WAL into the main file so the DB is a single portable file.
db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
db.exec("PRAGMA optimize;");
db.close();

console.log(`\nDone. Wrote ${outPath}`);
