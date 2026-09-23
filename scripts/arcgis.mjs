// Shared helper: page an ArcGIS REST layer's attributes into a newline-delimited
// JSON cache (one record's raw attributes per line). Used by fetch-ramsey.mjs and
// fetch-hennepin.mjs; scripts/build-db.mjs normalizes the caches afterwards.

import { createWriteStream, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

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

// Page through `layer` (a .../MapServer/N or .../FeatureServer/N URL), writing
// only `outFields` for every record to `outPath`. `page` must not exceed the
// service's maxRecordCount. Exits non-zero if far fewer rows than expected come back.
//
// Records stream to `<outPath>.part` and only replace `outPath` once the fetch
// completes, so a failed or unreachable source never clobbers the last good cache.
export async function fetchLayerToNdjson({ label, layer, outFields, outPath, page = 2000 }) {
  const queryUrl = (offset) =>
    `${layer}/query?${new URLSearchParams({
      where: "1=1",
      outFields: outFields.join(","),
      returnGeometry: "false",
      orderByFields: "OBJECTID", // stable ordering is required for reliable paging
      resultOffset: String(offset),
      resultRecordCount: String(page),
      f: "json",
    })}`;

  console.log(`Counting ${label} parcels…`);
  const countRes = await getJSON(
    `${layer}/query?where=${encodeURIComponent("1=1")}&returnCountOnly=true&f=json`,
  );
  const total = countRes.count ?? 0;
  console.log(`Fetching ${total.toLocaleString()} parcels in pages of ${page}…`);

  mkdirSync(dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.part`;
  const out = createWriteStream(tmpPath);
  let written = 0;
  for (let offset = 0; ; offset += page) {
    const res = await getJSON(queryUrl(offset));
    const feats = res.features ?? [];
    for (const f of feats) out.write(JSON.stringify(f.attributes) + "\n");
    written += feats.length;
    process.stdout.write(
      `\r  ${written.toLocaleString()} / ${total.toLocaleString()} parcels`,
    );
    // Stop when the service says there is no more, or a short page comes back.
    if (!res.exceededTransferLimit && feats.length < page) break;
    if (feats.length === 0) break;
  }
  process.stdout.write("\n");

  await new Promise((resolve, reject) => {
    out.end((err) => (err ? reject(err) : resolve()));
  });

  if (total && written < total * 0.99) {
    rmSync(tmpPath, { force: true });
    console.error(
      `Only got ${written} of ${total} expected parcels — the service may have thrown mid-run. ` +
        `Kept the previous cache at ${outPath}.`,
    );
    process.exit(1);
  }
  renameSync(tmpPath, outPath);

  console.log(
    `Done. Wrote ${written.toLocaleString()} parcels (${fmtMB(statSync(outPath).size)}) → ${outPath}`,
  );
}
