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
import { existsSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data");
const gpkgPath = join(dataDir, "plan_parcel_data.gpkg");
const hennepinPath = join(dataDir, "hennepin_parcels.ndjson");
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

// Normalize one raw Hennepin ArcGIS attribute record into the shared schema.
// Returns an object keyed by COLUMNS; unmapped fields are null. Hennepin values
// carry trailing whitespace and numbers-as-strings, so trim/coerce here.
function mapHennepin(a) {
  const s = (v) => {
    if (v == null) return null;
    const t = String(v).trim();
    return t === "" ? null : t;
  };
  const n = (v) => (v == null || v === "" ? null : Number(v));

  // Site address: "<house><frac> <street>", e.g. "2901 78TH ST E".
  const house = a.HOUSE_NO != null ? String(a.HOUSE_NO).trim() : "";
  const frac = s(a.FRAC_HOUSE_NO) ? ` ${s(a.FRAC_HOUSE_NO)}` : "";
  const site = `${house}${frac} ${s(a.STREET_NM) || ""}`.trim() || null;

  // Sale date arrives as YYYYMM (e.g. "201412"); render as YYYY-MM for display.
  const sale = s(a.SALE_DATE);
  const saleDate =
    sale && /^\d{6}$/.test(sale) ? `${sale.slice(0, 4)}-${sale.slice(4, 6)}` : sale;

  // PID is the 13-digit parcel id; format it as Hennepin's standard
  // XX-XXX-XX-XX-XXXX. (PID_TEXT is an unrelated internal marker, not the id.)
  const pid = s(a.PID);
  const parcelId =
    pid && /^\d{13}$/.test(pid)
      ? `${pid.slice(0, 2)}-${pid.slice(2, 5)}-${pid.slice(5, 7)}-${pid.slice(7, 9)}-${pid.slice(9)}`
      : pid;

  // Homestead code → readable label to match Ramsey's descriptive category.
  const hmstd = s(a.HMSTD_CD1);
  const ownership =
    hmstd === "Y" ? "Homestead" : hmstd === "N" ? "Non-homestead" : hmstd === "F" ? "Fractional homestead" : hmstd;

  // TAXPAYER_NM is the name; TAXPAYER_NM_1/_2 are mailing-address lines (a street
  // line and usually a "CITY ST ZIP" line, occasionally a second street line).
  const taxAddr1 = s(a.TAXPAYER_NM_1);
  const taxAddr2raw = s(a.TAXPAYER_NM_2);
  const isCityStateZip = (v) => v && /\b[A-Z]{2}\s+\d{5}/.test(v);
  const taxCityStateZip = isCityStateZip(taxAddr2raw) ? taxAddr2raw : s(a.TAXPAYER_NM_3);

  return {
    ParcelID: parcelId,
    OwnershipCategory: ownership,
    OwnerName: s(a.OWNER_NM),
    OwnerName1: s(a.OWNER_NM),
    OwnerName2: null,
    OwnerLastName: null,
    OwnerAddress1: null,
    OwnerAddress2: null,
    OwnerCityStateZIP: null,
    TaxName1: s(a.TAXPAYER_NM),
    TaxName2: null,
    TaxAddress1: taxAddr1,
    TaxAddress2: isCityStateZip(taxAddr2raw) ? null : taxAddr2raw,
    TaxCityStateZIP: taxCityStateZip,
    SiteAddress: site,
    SiteCityName: s(a.MUNIC_NM),
    SiteZIP5: s(a.ZIP_CD),
    LandUseCodeDescription: s(a.PR_TYP_NM1),
    StructureDescription: null,
    DwellingType: null,
    YearBuilt: s(a.BUILD_YR),
    BedRoom: null,
    LivingAreaSquareFeet: null,
    ParcelAcresDeed: null,
    ParcelSquareFeet: n(a.PARCEL_AREA),
    TaxYear: null,
    EMVLand: n(a.LAND_MV1),
    EMVBuilding: n(a.BLDG_MV1),
    EMVTotal: n(a.MKT_VAL_TOT),
    TotalTax: n(a.TAX_TOT),
    LastSaleDate: saleDate,
    SalePrice: n(a.SALE_PRICE),
    Latitude: n(a.LAT),
    Longitude: n(a.LON),
  };
}

// Read the cached Hennepin NDJSON and bulk-insert normalized rows (single
// transaction for speed).
function ingestHennepin(db, path) {
  const insert = db.prepare(
    `INSERT INTO parcels ("County", ${COLUMNS.map((c) => `"${c}"`).join(", ")})
     VALUES ('Hennepin', ${COLUMNS.map(() => "?").join(", ")})`,
  );
  const lines = readFileSync(path, "utf8").split("\n");
  const run = db.transaction(() => {
    for (const line of lines) {
      if (!line) continue;
      const m = mapHennepin(JSON.parse(line));
      insert.run(...COLUMNS.map((c) => m[c]));
    }
  });
  run();
}

// Start fresh so reruns are deterministic.
for (const suffix of ["", "-wal", "-shm"]) {
  const p = outPath + suffix;
  if (existsSync(p)) rmSync(p);
}

console.log("Opening output database…");
const db = new Database(outPath, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = OFF;");

// `County` tags each row with its source ("Ramsey" | "Hennepin"). rowid is a
// plain autoincrement key (NOT the source OBJECTID/PID) so IDs from the two
// counties can never collide.
db.exec(`
  CREATE TABLE parcels (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    "County" TEXT NOT NULL,
    ${COLUMNS.map((c) => `"${c}"`).join(",\n    ")}
  );
`);

console.log("Attaching GeoPackage and copying Ramsey rows…");
db.exec(`ATTACH DATABASE '${gpkgPath.replace(/'/g, "''")}' AS gpkg;`);

const colList = COLUMNS.map((c) => `"${c}"`).join(", ");
db.exec(`
  INSERT INTO parcels ("County", ${colList})
  SELECT 'Ramsey', ${colList}
  FROM gpkg.plan_attributedparcelpoint;
`);
db.exec("DETACH DATABASE gpkg;");

const ramseyCount = db.query("SELECT COUNT(*) AS n FROM parcels").get().n;
console.log(`Copied ${ramseyCount.toLocaleString()} Ramsey parcels.`);

// ---- Hennepin County ----
// Hennepin has no single GeoPackage; scripts/fetch-hennepin.mjs caches its
// parcels as NDJSON (raw ArcGIS attributes). Normalize each record into the
// shared schema here. Fields Hennepin doesn't publish (bedrooms, living area,
// structure type, etc.) are left null and simply show as "—" in the TUI.
if (existsSync(hennepinPath)) {
  console.log("Ingesting Hennepin rows…");
  ingestHennepin(db, hennepinPath);
  const hennCount = db.query("SELECT COUNT(*) AS n FROM parcels WHERE County='Hennepin'").get().n;
  console.log(`Copied ${hennCount.toLocaleString()} Hennepin parcels.`);
} else {
  console.warn(
    `\n  No Hennepin cache at ${hennepinPath} — building Ramsey only.\n` +
      `  Run \`bun run scripts/fetch-hennepin.mjs\` (or \`bun run refresh-data\`) to include Hennepin.\n`,
  );
}

const count = db.query("SELECT COUNT(*) AS n FROM parcels").get().n;
console.log(`Total: ${count.toLocaleString()} parcels.`);

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

// Checkpoint the WAL into the main file so the DB is a single portable file.
db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
db.exec("PRAGMA optimize;");
db.close();

console.log(`\nDone. Wrote ${outPath}`);
