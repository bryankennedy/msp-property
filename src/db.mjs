// Data access for the Ramsey County parcel search TUI.
// Reads the lean, indexed database produced by scripts/build-db.mjs.
// Uses Bun's built-in SQLite driver (bun:sqlite).

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = join(__dirname, "..", "data", "parcels.db");

let db;
export function open() {
  if (db) return db;
  if (!existsSync(DB_PATH)) {
    throw new Error(
      `Database not found at ${DB_PATH}. Run \`bun run build-db\` first.`,
    );
  }
  db = new Database(DB_PATH, { readonly: true });
  return db;
}

// Turn free-form user input into a safe FTS5 prefix query.
// "john smith" -> '"john"* "smith"*'  (all tokens must match, prefix-style)
function toFtsQuery(input) {
  const tokens = String(input)
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, "")) // strip FTS-special chars
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(" ");
}

// Turn free-form user input into a trigram FTS query for fuzzy (substring)
// address matching. Each token becomes a quoted substring phrase and all must
// match: "1930 rice" -> '"1930" AND "rice"'. The trigram tokenizer needs at
// least 3 characters per phrase, so shorter tokens (e.g. a "34" house number)
// are dropped from the query — the remaining tokens still find the address.
function toAddrQuery(input) {
  const tokens = String(input)
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/["]/g, "")) // strip the FTS phrase delimiter
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"`).join(" AND ");
}

const SUMMARY_COLS = `p.rowid, p."ParcelID", p."OwnerName", p."SiteAddress", p."SiteCityName", p."EMVTotal"`;

// Search parcels by owner / taxpayer name. Returns lightweight summary rows
// ordered by relevance (bm25). `limit` caps results.
export function searchByOwner(input, limit = 200) {
  const fts = toFtsQuery(input);
  if (!fts) return [];
  const stmt = open().query(`
    SELECT ${SUMMARY_COLS}
    FROM parcels_fts f
    JOIN parcels p ON p.rowid = f.rowid
    WHERE parcels_fts MATCH ?
    ORDER BY bm25(parcels_fts), p."OwnerName"
    LIMIT ?
  `);
  return stmt.all(fts, limit);
}

// Fuzzy-search parcels by site address (also matches city / ZIP). Uses the
// trigram FTS index so partial and mid-string matches work. Returns lightweight
// summary rows, shortest address first (a good proxy for the closest match).
export function searchByAddress(input, limit = 200) {
  const q = toAddrQuery(input);
  if (!q) return [];
  const stmt = open().query(`
    SELECT ${SUMMARY_COLS}
    FROM parcels_addr_fts f
    JOIN parcels p ON p.rowid = f.rowid
    WHERE parcels_addr_fts MATCH ?
    ORDER BY length(p."SiteAddress"), p."SiteAddress"
    LIMIT ?
  `);
  return stmt.all(q, limit);
}

// Full record for one parcel (all stored fields).
export function getByRowid(rowid) {
  return open().query(`SELECT * FROM parcels WHERE rowid = ?`).get(rowid);
}

export function totalCount() {
  return open().query(`SELECT COUNT(*) AS n FROM parcels`).get().n;
}
