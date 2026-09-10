# Data format

`app.js` reads one JSON file describing origin-destination flows between placed
nodes. Nothing in it is subway-specific: if your data fits this shape, the viewer
will draw it. Point `DATA_FILE` in [`config.js`](config.js) at your file and
rewrite the vocabulary block so the page uses your words.

[`build_subway_data.py`](build_subway_data.py) is one producer of this format.
You do not have to use it, or Python — anything that writes the document below
will do.

---

## The document

```jsonc
{
  "meta":    { … },        // required — see below
  "periods": [ … ],        // required — at least one
  "nodes":   [ … ],        // required — at least one
  "ego":     { … }         // required
}
```

### `meta`

| Key | Required | What it is |
|---|---|---|
| `top_n` | **yes** | How many destinations each ego list stores. Drives the top-N slider's maximum and the "below top N" wording in tooltips. |
| `group_order` | no | `[[label, color], …]` — the colour legend, in the order you want it read. Without it the legend falls back to first-seen order, which is whatever sequence your nodes happen to be in. |
| `note` | no | A caveat about the numbers. Shown on hover over the sidebar statistics. |
| `generated` | no | Build date, appended to the page credit. |

Anything else you put in `meta` is carried along and ignored — a good place for
provenance (`source`, `source_url`, `units`, coverage measurements).

### `periods`

One entry per time slice. Order is the order they appear in the control and the
order the play button cycles.

```jsonc
[
  { "key": "am", "label": "AM peak", "note": "4h" },
  { "key": "mid", "label": "Midday", "note": "6h" }
]
```

`key` indexes into `ego`; `label` is what the reader sees; `note` is optional and
appears in parentheses after the label.

**If your data has no time dimension, ship exactly one period.** The viewer hides
the period control and the play button entirely rather than rendering a radio
group of one.

### `nodes`

An array. **Position is identity** — `ego` addresses nodes by their index here, so
the order must not change between the two.

```jsonc
{
  "id": "1",                          // optional, but needed for config.OPEN_ON
  "name": "Astoria-Ditmars Blvd (N,W)",  // required — full name, used in search
  "short": "Astoria-Ditmars Blvd",    // optional — the graph label
  "lat": 40.775036,                   // required — WGS 84
  "lon": -73.912034,                  // required — WGS 84
  "tags": ["N", "W"],                 // optional — shown in tooltips
  "group": "#FCCC0A",                 // optional — node fill colour
  "group_label": "N/Q/R/W",           // optional — legend entry for that colour
  "out": [4807.9, 3143.6, 2073.2, 1052.8],  // required — one per period
  "in":  [1079.8, 2914.8, 4726.6, 2121.5]   // required — one per period
}
```

`out` and `in` are the node's **total** outbound and inbound flow per period —
totals over everything, not just the stored top-N. They size the nodes, fill the
readout, and give the share metric its denominator, so computing them from a
truncated list would quietly inflate every share on the page.

**On `short`.** This is the label drawn next to each node and used in the
tooltip's `A → B` lines, so it has to identify the node on its own. Shortening is
your builder's job, because only it can see the whole list and know which
shortenings collide. In the MTA data, dropping the route suffix would have put
the label "86 St" on six different complexes and "23 St" on five — 133 of 424
nodes made ambiguous — so the builder shortens a name only when the result stays
unique. Omit `short` and the full `name` is drawn.

### `ego`

Each node's top destinations, per period. Keys are node **indices as strings**;
inner keys are period `key`s.

```jsonc
{
  "0": {
    "am":  [[404, 323.4], [402, 282.94], [398, 272.38], …],
    "mid": [[404, 210.1], …]
  },
  "1": { … }
}
```

Each entry is `[destinationIndex, value]`.

Three invariants the viewer depends on:

1. **Sorted descending by value.** The top-N slider is a `slice()`, not a sort. An
   unsorted list will draw the wrong destinations without erroring.
2. **At most `meta.top_n` entries.**
3. **`destinationIndex` is a valid index into `nodes`.** Checked at load, because
   an off-by-one here would silently draw a plausible wrong graph.

A node with no outbound flow may be omitted, or given an empty array.

---

## Why the two panels carry different resolutions

The map draws every node; the network draws only the selected node's top-N. That
asymmetry is the point of the tool, and it is why `ego` is truncated while `out`
and `in` are not — detail is cheap on a map and expensive in a force layout.

The consequence to be honest about: **an absent pair means "not in the stored
list", not "zero".** The tooltip says "below top N" rather than "0" for exactly
this reason. If truncation loses a lot of your data, say so — the MTA build
measures per-period coverage and the README publishes it.

---

## Preflight

`app.js` validates the document at load and, if it does not fit, replaces the
loading message with a list of what is wrong rather than failing silently. The
checks are in `preflight()` — required keys, one `out`/`in` entry per period, and
in-range ego indices.
