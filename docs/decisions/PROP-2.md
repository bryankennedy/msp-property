### PROP-2 — Mouse clicks open search results

**Decision:** Turn on SGR mouse reporting (`?1000` + `?1006`) only while the
results list is showing, and map a left click's screen row to a result row. A
click opens that record straight away, the same as `Enter`. The scroll wheel
moves the selection.

**Why:**
- A terminal app only gets clicks if it asks for them. SGR (1006) has no
  coordinate limit, and most terminals support it.
- Click coordinates count from the top-left of the screen, but Ink draws from
  wherever the cursor happened to be. On a TTY, launch now clears the screen and
  homes the cursor, so the app's first line is screen row 1. That fixes the
  results at row 7 (`resultsTop` in `src/cli.jsx`). The search view already
  fills the terminal height (PROP-1), so this barely changes what you see.
  Querying the cursor position (`DSR`) was the other choice, but it is async and
  breaks if the terminal never answers.
- While mouse reporting is on, the terminal's wheel scrolling and drag-to-select
  stop working. The wheel now moves the selection, so it still does something
  useful. Reporting goes off in the detail view, so you can select a parcel ID
  or address there without holding a modifier.
- An `exit` handler turns reporting off, so a crash can't leave the shell
  printing escape codes on every click.
