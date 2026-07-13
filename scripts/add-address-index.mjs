#!/usr/bin/env bun
// One-time migration: add the fuzzy address search index to an existing
// data/parcels.db without rebuilding from the GeoPackage.
//
// Fresh builds (`bun run build-db`) already create this index; this script is
// only for databases built before address search existed. Safe to re-run.
//
// Run with: bun run scripts/add-address-index.mjs

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "parcels.db");

if (!existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath}. Run \`bun run build-db\` first.`);
  process.exit(1);
}

const db = new Database(dbPath);

const exists = db
  .query(
    `SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = 'parcels_addr_fts'`,
  )
  .get();

if (exists) {
  console.log("Address index already present — rebuilding it fresh.");
  db.exec("DROP TABLE parcels_addr_fts;");
}

console.log("Building fuzzy address index (site address + city + zip)…");
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

const n = db.query("SELECT COUNT(*) AS n FROM parcels_addr_fts").get().n;
db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
db.exec("PRAGMA optimize;");
db.close();

console.log(`Done. Indexed ${n.toLocaleString()} site addresses in ${dbPath}`);
