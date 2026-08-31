# NYC Subway Trip Network

A dual-panel D3 visualization of where subway riders actually go. The left panel is a
force-directed network of the destinations reached from one station complex; the right panel is a
point map of all 424 complexes in the system. Selecting a complex rebuilds the network around it
and re-shades the map by the flow out of it, so the abstract structure of a station's travel
patterns and the real geography of the city can be read against each other.

Built with [D3.js](https://d3js.org). No build step — plain HTML, CSS, and JavaScript.

---

## Live demo

[View on GitHub Pages](https://ssitari.github.io/MTASubwayNetwork/)

---

## The two panels do not show the same thing

This is the deliberate departure from the two earlier versions of this tool. In those, the network
and the map showed the same node set — the same states, the same neighborhoods — in two different
projections.

Here they do not. **The map always keeps all 424 station complexes. The network shows only the top
destinations from the selected one.** Detail is cheap on a map, where 424 dots are still legible,
and expensive in a force layout, where 424 nodes and their edges are a hairball. So each panel
carries the resolution it can actually support, and the selection is what ties them together.

A pruned graph is not a lossy version of the map — it is a different question about the same data.

## The metric

Edge weight defaults to **the share of the origin complex's riders** that a flow represents, the
same choice made in the state-migration version of this tool. Raw rider counts mostly restate which
stations are busy: every list would be topped by the same handful of Midtown transfer points, and a
quiet outer-borough station would have no legible structure at all. The share metric asks a
different question — of everyone who boards *here*, where do they actually go? — and it makes small
stations as readable as large ones. A toggle switches back to raw estimates for comparison.

One finding from the source data is worth stating up front, because it is the opposite of what the
project assumed going in: **subway flows are not hub-and-spoke.** Across the whole system in the
morning peak, the top ten destination complexes absorb only **24.8%** of trips, and the single
largest — Grand Central — takes **4.1%**. Off-peak it is flatter still: 15.2% and 3.0% in the
evening. There is no dominant sink. The structure is genuinely distributed, which is what makes a
per-station ego network worth drawing at all.

The flip side is how *thinly* that traffic spreads. Over a four-hour peak the median complex sends
at least a fraction of a rider to **about 418 of the other 423 complexes** — nearly the entire
system. Almost every pair is non-zero. That is precisely why the network panel has to be pruned
and the map does not.

## Reading the panels

- **Network (left)** — the selected complex plus its top destinations, sized by total traffic and
  colored by trunk line. With *Link destinations to each other* on, edges among the destinations
  themselves are drawn too, which is what turns a bare star into a graph with visible clusters.
- **Map (right)** — all 424 complexes, shaded by flow from the selection on a sequential scale.
  Complexes outside the selection's top 50 stay unshaded. The map is drawn from the *full*
  destination list, so it shows more than the network does.
- **Time of day** — four periods; the play button cycles them. Watching the AM and PM peaks in
  sequence is the point of the time dimension: the same station's flows largely reverse.
- **Destinations shown** — prunes the network without touching the map.

## Data

MTA, [Subway Origin-Destination Ridership Estimate,
2025](https://data.ny.gov/d/y2qv-fytt), via the New York State Open Data portal.

Four things about this source are worth knowing before drawing conclusions:

- **The destinations are modeled, not counted.** Origins come from fare transactions; MTA *infers*
  where each rider got off. `estimated_average_ridership` is fractional for this reason. These are
  estimates with real uncertainty, and the numbers shown here should be read the way an ACS
  estimate is read, not as a turnstile count. MTA's methodology is linked from the dataset page.
- **Weekdays only, averaged over all of 2025.** Each source row is already an average for one
  (month, day-of-week, hour) cell, so the build sums the cells in a period and divides by
  12 months × 5 weekdays. The result is *estimated riders on a typical weekday*, not a total.
  Weekend travel is genuinely different and is deliberately excluded rather than blended in.
- **Only the top 50 destinations per complex are kept**, and that is a real simplification worth
  being explicit about. Measured on the shipped data, top-50 covers this much of a complex's
  riders:

  | Period | Median coverage | Worst case |
  |---|---|---|
  | AM peak | 74.1% | 56.2% |
  | Midday | 68.3% | 51.5% |
  | PM peak | 65.4% | 45.9% |
  | Evening | 62.4% | 41.9% |

  Coverage falls off-peak because travel is less concentrated then, and it is lower across the
  board than it would be for a single hour — averaging a four- to ten-hour window mixes several
  travel patterns together and spreads each station's riders over more destinations. The coverage
  for the current selection is reported in the sidebar, so the pruning is never silent.
- **Complexes, not stations.** The unit is the fare-control complex MTA reports on, so Times Sq–42
  St and its connected platforms are one node, not several. 426 complexes appear in the data;
  **424 are used.** Staten Island Railway's two — St George and Tompkinsville — are dropped,
  because each appears in exactly *one* hour-cell in all of 2025 against 1,440 possible. SIR fares
  are not collected the way subway fares are, so there is nothing to model destinations from.
  Including them would have drawn two ghost stations carrying no riders.

Station coordinates ship inline with every row of the source data; no separate station geography is
needed. The borough basemap is NYC Open Data's [Borough
Boundaries](https://data.cityofnewyork.us/d/gthc-hcne), simplified to ~4% of its original vertex
count for use as a backdrop.

## Running locally

The app loads its data via `fetch()`, so it must be served over HTTP:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Rebuilding the data

Both scripts cache into `data/cache/` (gitignored) and are safe to re-run or resume.

```bash
pip install requests

python build_subway_data.py   # -> data/subway_network.json
python build_basemap.py       # -> data/boroughs.geojson
```

### How the source is queried, and why it looks the way it does

The source table is roughly **121 million rows**. How you ask for an aggregate matters enormously,
and most of the obvious approaches do not work at all. Measured against the live API:

| Query shape | Result |
|---|---|
| Aggregate with no `month` filter | Never returned; killed after 30 minutes |
| Filter to a single origin complex | ~11 minutes for one complex → ~14 hours for all 424 |
| Filter to one month × one period | **~10 seconds** |

The origin column does not appear to be indexed, so the intuitive "loop over stations" approach is
by far the worst one. The harvest is therefore 12 months × 4 periods, each paged 50,000 rows at a
time — about 190 requests, roughly half an hour — and every page is cached, so an interrupted run
resumes where it stopped.

### Output

| File | What it is |
|---|---|
| `data/subway_network.json` | 424 complexes with coordinates, routes, trunk color, and per-period boardings/arrivals; plus each complex's top-50 destinations per period |
| `data/boroughs.geojson` | Five boroughs, WGS 84, simplified for use as a backdrop |

---

## Related

The same linked network-and-map idea applied to other geographies:

- [StateMigrationNetwork](https://github.com/ssitari/StateMigrationNetwork) — US interstate migration
- [LinkedNetworkGraphChoroplethMap](https://github.com/ssitari/LinkedNetworkGraphChoroplethMap) — NYC Citi Bike trips

## Acknowledgements

Built with assistance from Claude (Anthropic).

## License

[MIT](LICENSE)
