#!/usr/bin/env bun
// Refresh the local source data for both counties, then optionally rebuild the
// search database. Each county's public ArcGIS REST service is paged into an
// NDJSON cache in data/:
//   - Ramsey:   data/ramsey_parcels.ndjson    (via scripts/fetch-ramsey.mjs)
//   - Hennepin: data/hennepin_parcels.ndjson  (via scripts/fetch-hennepin.mjs)
//
// A cache is only replaced once its fetch completes, so if a source is down the
// previous copy stays in place and `build-db` can still run from it.
//
// Run with:
//   bun run refresh-data           # refresh both counties' source data
//   bun run refresh-data --build   # …then rebuild data/parcels.db as well
//
// Source services:
//   Ramsey:   https://gis.ramseycountymn.gov (Cadastral/CAD_AttributedParcelPoint_ViewOnly)
//   Hennepin: https://gis.hennepin.us (LAND_PROPERTY/MapServer, County Parcels)

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const runBuild = process.argv.includes("--build");

// Run a command, inheriting stdio so the user sees its output live.
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`)),
    );
  });
}

try {
  console.log("[1/2] Ramsey County");
  await run("bun", ["run", join(__dirname, "fetch-ramsey.mjs")]);

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
