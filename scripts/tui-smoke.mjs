#!/usr/bin/env bun
// Headless smoke test of the TUI: render the App, type an owner name, navigate,
// open a record, and go back — asserting expected text appears at each step.
// Run with: bun run scripts/tui-smoke.mjs

import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/cli.jsx";
import { totalCount } from "../src/db.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
}

const { lastFrame, stdin } = render(React.createElement(App, { total: totalCount() }));
await sleep(50); // let the component mount before sending input

// 1. header renders
assert(/Ramsey \+ Hennepin County, MN — Parcel Search/.test(lastFrame()), "header renders");

// 2. type an owner query
stdin.write("flex holding");
await sleep(250); // wait past the 100ms debounce

const afterSearch = lastFrame();
assert(/FLEX HOLDING LLC/.test(afterSearch), "search shows FLEX HOLDING LLC result");
assert(/match/.test(afterSearch), "shows match count footer");
assert(/County/.test(afterSearch), "results list shows the County column");
assert(/Ramsey/.test(afterSearch), "results are tagged with a county");

// 3. open the highlighted record with Enter
stdin.write("\r");
await sleep(100);
const detail = lastFrame();
assert(/County\s+Ramsey County/.test(detail), "detail view shows County");
assert(/Parcel ID/.test(detail), "detail view shows Parcel ID label");
assert(/Est\. value/.test(detail), "detail view shows Est. value");
assert(/Land use/.test(detail), "detail view shows Land use");

// 4. go back to results with Escape
stdin.write("\x1b");
await sleep(100);
assert(/FLEX HOLDING LLC/.test(lastFrame()), "Esc returns to results list");

// 5. toggle to address search with Tab and query a site address
stdin.write("\t");
await sleep(50);
assert(/Searching by/.test(lastFrame()) && /address/.test(lastFrame()), "Tab switches to address search");
// clear the previous owner query, then type an address (space out the
// backspaces — rapid consecutive writes get coalesced and dropped)
for (let i = 0; i < "flex holding".length; i++) {
  stdin.write("\x7f");
  await sleep(15);
}
stdin.write("labore rd");
await sleep(250); // wait past the 100ms debounce
const afterAddr = lastFrame();
assert(/LABORE RD/.test(afterAddr), "address search (Ramsey) shows LABORE RD result");
assert(/match/.test(afterAddr), "address search shows match count footer");

// 6. address search that only Hennepin can answer (Minneapolis is in Hennepin)
for (let i = 0; i < "labore rd".length; i++) {
  stdin.write("\x7f");
  await sleep(15);
}
stdin.write("nicollet ave minneapolis");
await sleep(250);
const afterHenn = lastFrame();
assert(/NICOLLET AVE/.test(afterHenn), "address search finds Hennepin (Minneapolis) parcels");
assert(/Hennepin/.test(afterHenn), "Hennepin results are tagged Hennepin");

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
