#!/usr/bin/env bun
// Refresh the local source data for both counties, then optionally rebuild the
// search database:
//   - Ramsey:   download + unzip the parcel GeoPackage from the MN Geospatial
//               Commons (refreshed monthly).
//   - Hennepin: page the county's public ArcGIS REST service into an NDJSON
//               cache (via scripts/fetch-hennepin.mjs).
//
// Run with:
//   bun run refresh-data           # refresh both counties' source data
//   bun run refresh-data --build   # …then rebuild data/parcels.db as well
//
// Source datasets:
//   Ramsey:   https://gisdata.mn.gov/dataset/us-mn-co-ramsey-plan-parcel-data
//   Hennepin: https://gis.hennepin.us (LAND_PROPERTY/MapServer, County Parcels)

import { existsSync, statSync, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const ZIP_URL =
  "https://resources.gisdata.mn.gov/pub/gdrs/data/pub/us_mn_co_ramsey/plan_parcel_data/gpkg_plan_parcel_data.zip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data");
const zipPath = join(dataDir, "gpkg_plan_parcel_data.zip");
const gpkgPath = join(dataDir, "plan_parcel_data.gpkg");

const runBuild = process.argv.includes("--build");

const fmtMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// Run a command, inheriting stdio so the user sees its output live.
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} exited with code ${code}`)),
    );
  });
}

async function download(url, dest) {
  console.log(`Downloading latest GeoPackage…\n  ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  }
  const total = Number(res.headers.get("content-length")) || 0;

  // Stream to a temp file first so an interrupted download never clobbers a
  // previously-good zip.
  const tmp = `${dest}.part`;
  let received = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    received += chunk.length;
    if (total) {
      const pct = ((received / total) * 100).toFixed(0);
      process.stdout.write(`\r  ${fmtMB(received)} / ${fmtMB(total)} (${pct}%)   `);
    } else {
      process.stdout.write(`\r  ${fmtMB(received)} downloaded   `);
    }
  });
  await pipeline(body, createWriteStream(tmp));
  process.stdout.write("\n");

  // Atomically move temp → final.
  await rm(dest, { force: true });
  await run("mv", [tmp, dest]);
  console.log(`Saved ${fmtMB(statSync(dest).size)} → ${dest}`);
}

async function unzip(zip, outDir) {
  console.log("Unzipping…");
  // The archive contains plan_parcel_data.gpkg. -o overwrites without prompting.
  await run("unzip", ["-o", zip, "-d", outDir]);
  if (!existsSync(gpkgPath)) {
    throw new Error(
      `Expected ${gpkgPath} after unzip, but it wasn't found. ` +
        `Inspect ${zip} manually.`,
    );
  }
  console.log(`Extracted ${fmtMB(statSync(gpkgPath).size)} → ${gpkgPath}`);
}

try {
  // Ramsey: single GeoPackage from the MN Geospatial Commons.
  console.log("[1/2] Ramsey County");
  await download(ZIP_URL, zipPath);
  await unzip(zipPath, dataDir);

  // Hennepin: paged from the county's ArcGIS REST service (its own script).
  console.log("\n[2/2] Hennepin County");
  await run("bun", ["run", join(__dirname, "fetch-hennepin.mjs")]);

  if (runBuild) {
    console.log("\nRebuilding search database…");
    await run("bun", ["run", join(__dirname, "build-db.mjs")]);
  } else {
    console.log("\nDone. Next: `bun run build-db` to rebuild the search database.");
  }
} catch (err) {
  console.error(`\nrefresh-data failed: ${err.message}`);
  process.exit(1);
}
