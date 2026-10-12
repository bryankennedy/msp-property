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

// 4b. the mouse (PROP-2): terminals report a click as "\x1b[<button;col;rowM",
// 1-based. Results start on the seventh line; click the second one and its
// record opens.
const resultLines = lastFrame().split("\n");
const secondRow = resultLines[7];
assert(/^ {2}\S/.test(secondRow), "a second result row sits on screen row 8");
const secondAddr = secondRow.slice(2 + 9 + 2 + 30 + 2, 2 + 9 + 2 + 30 + 2 + 24).trim();
stdin.write("\x1b[<65;10;8M\x1b[<65;10;8M"); // wheel down twice, in one chunk
await sleep(50);
assert(/^› /.test(lastFrame().split("\n")[8]), "wheel down moves the selection");
stdin.write("\x1b[<64;10;8M"); // wheel up
await sleep(50);
assert(/^› /.test(lastFrame().split("\n")[7]), "wheel up moves the selection back");
assert(/Owner name:\s+flex holding\s*$/m.test(lastFrame()), "mouse input never lands in the search box");
stdin.write("\x1b[<0;20;3M\x1b[<0;20;3m"); // click the search box: nothing opens
await sleep(50);
assert(/Searching by/.test(lastFrame()), "clicking outside the results opens nothing");
stdin.write("\x1b[<0;20;8M");
await sleep(100);
const clicked = lastFrame();
assert(/Parcel ID/.test(clicked), "clicking a result opens its record");
const siteLine = clicked.split("\n").find((l) => l.startsWith("Site address")) ?? "";
assert(siteLine.slice(16).startsWith(secondAddr), `clicked record is the one clicked (${secondAddr})`);
stdin.write("\x1b[<0;20;8m"); // the release lands in the detail view and is ignored
await sleep(50);
assert(/Parcel ID/.test(lastFrame()), "a stray release in the detail view does nothing");
stdin.write("\x1b");
await sleep(100);

// 5. toggle to address search with Tab and query a site address
stdin.write("\t");
await sleep(50);
assert(/Searching by/.test(lastFrame()) && /address/.test(lastFrame()), "Tab switches to address search");
// clear the previous owner query with a burst of backspaces in one chunk — how a
// held-down key arrives from a real terminal
stdin.write("\x7f".repeat("flex holding".length));
await sleep(50);
assert(/Address:\s+e\.g\./.test(lastFrame()), "one-chunk backspace burst fully clears the search box");
stdin.write("labore rd");
await sleep(250); // wait past the 100ms debounce
const afterAddr = lastFrame();
assert(/LABORE RD/.test(afterAddr), "address search (Ramsey) shows LABORE RD result");
assert(/match/.test(afterAddr), "address search shows match count footer");

// 6. address search that only Hennepin can answer (Minneapolis is in Hennepin)
// separate backspaces with no pause, so they land before a re-render
for (let i = 0; i < "labore rd".length; i++) stdin.write("\x7f");
await sleep(50);
assert(/Address:\s+e\.g\./.test(lastFrame()), "rapid separate backspaces fully clear the search box");
stdin.write("nicollet ave minneapolis");
await sleep(250);
const afterHenn = lastFrame();
assert(/NICOLLET AVE/.test(afterHenn), "address search finds Hennepin (Minneapolis) parcels");
assert(/Hennepin/.test(afterHenn), "Hennepin results are tagged Hennepin");

// 7. a long result list must not scroll the search box away (PROP-1). The test
// stdout is 100 columns with no rows, so the app budgets for a 24-line terminal;
// Ink scrolls the screen once a frame reaches that height.
const lines = afterHenn.split("\n");
assert(lines.length < 24, `long result list fits the terminal (${lines.length} < 24 lines)`);
assert(/^Address:/.test(lines[2]), "search box stays on the third line");
assert(lines.every((l) => l.length <= 100), "no line is wider than the terminal");
stdin.write(" and a very long tail that runs well past the edge of the terminal window");
await sleep(250);
const longLines = lastFrame().split("\n");
assert(/^Address:/.test(longLines[2]) && /window\s*$/.test(longLines[2]), "long query scrolls sideways on one line, cursor in view");
assert(/Searching by/.test(longLines[3]), "long query does not wrap onto the next line");

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
