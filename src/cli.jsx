#!/usr/bin/env bun
// Ramsey County, MN — Parcel Search (local TUI)
// Search attributed parcels by property owner / taxpayer name, view the record.
//
// Run with:  bun run search   (or ./src/cli.jsx)

import React, { useState, useEffect, useMemo, useReducer } from "react";
import { render, Box, Text, useApp, useInput, useStdout } from "ink";
import { searchByOwner, searchByAddress, getByRowid, totalCount } from "./db.mjs";

// ---------- formatting helpers ----------
const usd = (v) =>
  v == null || v === ""
    ? "—"
    : Number(v).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const num = (v) => (v == null || v === "" ? "—" : Number(v).toLocaleString("en-US"));
const txt = (v) => (v == null || String(v).trim() === "" ? "—" : String(v).trim());
const has = (v) => v != null && String(v).trim() !== "";
const date = (v) => (has(v) ? String(v).slice(0, 10) : "—");

// ---------- detail view ----------
function Row({ label, value }) {
  return (
    <Box>
      <Box width={16}>
        <Text color="gray">{label}</Text>
      </Box>
      <Text>{value}</Text>
    </Box>
  );
}

function Detail({ rowid }) {
  const r = useMemo(() => getByRowid(rowid), [rowid]);
  if (!r) return <Text color="red">Record not found.</Text>;

  const owner = [r.OwnerName1, r.OwnerName2].filter(has).join("  •  ");
  const taxpayer = [r.TaxName1, r.TaxName2].filter(has).join("  •  ");
  const taxAddr = [r.TaxAddress1, r.TaxAddress2, r.TaxCityStateZIP].filter(has).join(", ");
  const site = [r.SiteAddress, [r.SiteCityName, r.SiteZIP5].filter(has).join(" ")]
    .filter(has)
    .join(", ");
  const structure = [r.StructureDescription, r.DwellingType].filter(has).join(" / ");

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        {txt(r.OwnerName)}
        <Text color="gray">{has(r.County) ? `   — ${r.County} County` : ""}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Row label="County" value={has(r.County) ? `${r.County} County` : "—"} />
        <Row label="Parcel ID" value={txt(r.ParcelID)} />
        <Row label="Owner" value={owner || "—"} />
        <Row label="Ownership" value={txt(r.OwnershipCategory)} />
        <Row label="Site address" value={site || "—"} />
        <Row label="Taxpayer" value={taxpayer || "—"} />
        <Row label="Tax mailing" value={taxAddr || "—"} />
        <Row label="Land use" value={txt(r.LandUseCodeDescription)} />
        <Row
          label="Structure"
          value={
            (structure || "—") +
            (has(r.YearBuilt) ? `   built ${r.YearBuilt}` : "") +
            (has(r.BedRoom) ? `   ${r.BedRoom} bd` : "") +
            (has(r.LivingAreaSquareFeet) ? `   ${num(r.LivingAreaSquareFeet)} sqft` : "")
          }
        />
        <Row
          label="Lot size"
          value={
            (has(r.ParcelAcresDeed) ? `${r.ParcelAcresDeed} ac` : "—") +
            (has(r.ParcelSquareFeet) ? `   (${num(r.ParcelSquareFeet)} sqft)` : "")
          }
        />
        <Row
          label="Est. value"
          value={`${usd(r.EMVTotal)}  (land ${usd(r.EMVLand)} + bldg ${usd(r.EMVBuilding)})`}
        />
        <Row
          label="Total tax"
          value={`${usd(r.TotalTax)}${has(r.TaxYear) ? `  (${r.TaxYear})` : ""}`}
        />
        <Row label="Last sale" value={`${date(r.LastSaleDate)}   ${usd(r.SalePrice)}`} />
        <Row
          label="Coordinates"
          value={has(r.Latitude) ? `${r.Latitude}, ${r.Longitude}` : "—"}
        />
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Esc / ← back to results · Ctrl+C quit</Text>
      </Box>
    </Box>
  );
}

// ---------- results list ----------
function Results({ rows, selected, windowSize }) {
  if (rows.length === 0) {
    return (
      <Box marginTop={1}>
        <Text color="gray">No matches. Keep typing an owner or taxpayer name…</Text>
      </Box>
    );
  }
  // window the list around the selection so it fits the terminal
  const half = Math.floor(windowSize / 2);
  let start = Math.max(0, selected - half);
  const end = Math.min(rows.length, start + windowSize);
  start = Math.max(0, end - windowSize);
  const view = rows.slice(start, end);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray" dimColor>
        {"  "}
        {"County".padEnd(9)} {" "}
        {"Owner".padEnd(30)} {" "}
        {"Site address".padEnd(24)} {" "}
        {"City".padEnd(16)} {" "}
        {"Est. value".padStart(12)}
      </Text>
      {view.map((row, i) => {
        const idx = start + i;
        const active = idx === selected;
        return (
          <Box key={row.rowid}>
            <Text color={active ? "cyan" : undefined} inverse={active}>
              {active ? "› " : "  "}
              {txt(row.County).padEnd(9).slice(0, 9)} {" "}
              {txt(row.OwnerName).padEnd(30).slice(0, 30)} {" "}
              {txt(row.SiteAddress).padEnd(24).slice(0, 24)} {" "}
              {txt(row.SiteCityName).padEnd(16).slice(0, 16)} {" "}
              {usd(row.EMVTotal).padStart(12)}
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text color="gray">
          {rows.length} match{rows.length === 1 ? "" : "es"}
          {rows.length >= 200 ? " (showing first 200 — refine search)" : ""} · ↑↓ move · Enter
          open · Ctrl+C quit
        </Text>
      </Box>
    </Box>
  );
}

// ---------- search box ----------
// A small line editor in place of ink-text-input. Ink treats each stdin chunk as
// one key, so a held-down backspace can arrive as "\x7f\x7f\x7f" — which Ink
// doesn't recognize, and TextInput inserted as invisible characters. TextInput
// also read stale state for keys that landed before a re-render, dropping them.
// A reducer that walks every byte of the chunk avoids both.
function editLine({ value, cursor }, { input, key }) {
  if (key.leftArrow) return { value, cursor: Math.max(0, cursor - 1) };
  if (key.rightArrow) return { value, cursor: Math.min(value.length, cursor + 1) };
  if (key.backspace || key.delete) input = "\x7f";
  for (const ch of input) {
    if (ch === "\x7f" || ch === "\b") {
      if (cursor > 0) {
        value = value.slice(0, cursor - 1) + value.slice(cursor);
        cursor--;
      }
    } else if (ch >= " ") {
      value = value.slice(0, cursor) + ch + value.slice(cursor);
      cursor += ch.length;
    }
  }
  return { value, cursor };
}

function SearchBox({ value, cursor, placeholder }) {
  if (!value) {
    return (
      <Text>
        <Text inverse>{placeholder[0]}</Text>
        <Text color="gray">{placeholder.slice(1)}</Text>
      </Text>
    );
  }
  return (
    <Text>
      {value.slice(0, cursor)}
      <Text inverse>{value[cursor] ?? " "}</Text>
      {value.slice(cursor + 1)}
    </Text>
  );
}

// ---------- app ----------
export function App({ total }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [{ value: query, cursor }, edit] = useReducer(editLine, { value: "", cursor: 0 });
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState("search"); // "search" | "detail"
  const [searchBy, setSearchBy] = useState("owner"); // "owner" | "address"
  const [detailRowid, setDetailRowid] = useState(null);

  // how many result lines fit (leave room for header/input/footer)
  const windowSize = Math.max(5, (stdout?.rows || 24) - 9);

  // debounced search on query / field change
  useEffect(() => {
    const id = setTimeout(() => {
      const search = searchBy === "address" ? searchByAddress : searchByOwner;
      const r = query.trim() ? search(query, 200) : [];
      setRows(r);
      setSelected(0);
    }, 100);
    return () => clearTimeout(id);
  }, [query, searchBy]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (mode === "detail") {
      if (key.escape || key.leftArrow) setMode("search");
      return;
    }
    // search mode navigation
    if (key.tab) {
      setSearchBy((f) => (f === "owner" ? "address" : "owner"));
    } else if (key.downArrow) {
      setSelected((s) => Math.min(rows.length - 1, s + 1));
    } else if (key.upArrow) {
      setSelected((s) => Math.max(0, s - 1));
    } else if (key.return) {
      if (rows[selected]) {
        setDetailRowid(rows[selected].rowid);
        setMode("detail");
      }
    } else {
      edit({ input, key });
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="green">
          Ramsey + Hennepin County, MN — Parcel Search
        </Text>
        <Text color="gray">  ({total.toLocaleString()} parcels)</Text>
      </Box>

      {mode === "search" ? (
        <>
          <Box marginTop={1}>
            <Text>{searchBy === "address" ? "Address:    " : "Owner name: "}</Text>
            <SearchBox
              value={query}
              cursor={cursor}
              placeholder={
                searchBy === "address"
                  ? "e.g. 1930 rice st  /  labore rd"
                  : "e.g. smith  /  flex holding"
              }
            />
          </Box>
          <Box>
            <Text color="gray">
              Searching by{" "}
              <Text color="cyan" bold>
                {searchBy === "address" ? "address" : "owner name"}
              </Text>
              {" "}· Tab to search by {searchBy === "address" ? "owner name" : "address"}
            </Text>
          </Box>
          <Results rows={rows} selected={selected} windowSize={windowSize} />
        </>
      ) : (
        <Detail rowid={detailRowid} />
      )}
    </Box>
  );
}

// Auto-launch only when run directly (not when imported by tests).
if (import.meta.main) {
  const total = totalCount();
  render(<App total={total} />);
}
