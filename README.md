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

## Vs. expected

The share metric says where a station's riders go, but much of the answer is still "somewhere busy,
not too far away." **Vs. expected** divides each flow by what a gravity model predicts for it, so
what stands out is what busyness and distance cannot explain. It is the same idea as the
[Citi Bike station network](https://github.com/ssitari/CitiBikeStationNetwork), adapted for trains.

### The model

A Poisson regression over every ordered pair of complexes — all 179,352, not just the stored top
50 — fitted separately for each period:

```
log E[riders_ij] = o_i + d_j + f(km_ij)
```

- **`o_i`, `d_j`** — one term per complex for boarding and one for arriving. They absorb how busy
  each complex is in each direction, so every complex's expected boardings and arrivals equal its
  actual ones and what is left says only *who* it trades with. Separate terms matter here in a way
  they did not for bikes: in the AM peak, Rockefeller Ctr takes in 16 riders for every one it sends
  out.
- **`f(km)`** — straight-line distance as a piecewise-linear curve in log(km), bending at 1, 2, 4,
  8 and 16 km. Its shape is learned from the data, and at short range it runs the opposite way
  from a bike-share curve. AM peak slopes: **+1.5** under 1 km and +0.6 from 1–2 km, then −0.3
  (2–4), −1.0 (4–8), −1.4 (8–16) and −1.9 beyond. Compared with busyness alone, pairs under 500 m
  apart carry 0.32× their share of riders and pairs 2–3 km apart 1.85×. Below a kilometre people
  walk. Beyond about 8 km, trips fall below 1× again.

| Period | Deviance explained | Of what busyness alone leaves, distance explains |
|---|---|---|
| AM peak | 74.7% | 21.9% |
| Midday | 75.6% | 26.1% |
| PM peak | 77.9% | 23.6% |
| Evening | 74.7% | 13.3% |

Deviance explained is the Poisson analogue of R². The first column is measured against a flat
model, the same baseline the Citi Bike tools report (88.7% at station level). The second is
measured against busyness alone.

The model is fitted in `build_subway_data.py` (`fit_expected`: numpy, Newton–Raphson on all ~850
parameters, about 15 seconds for the four periods), and each stored destination carries its
expected value.

### What it shows

Straight-line distance does not know where the tracks run, so the strongest results are mostly
one-seat rides. In the AM peak, 34 St-Penn Station (1,2,3) → Wall St (2,3) runs at **9.9×**
(1,479 riders against 149 expected), 72 St → Chambers St on the 1/2/3 at 9.2×, and 1 Av → Bedford
Av on the L at 9.3×. The commute reverses in the PM: Wall St → Penn Station at 9.1×.

The busy pairs furthest *under* expected mostly need a transfer between nearby lines: Penn Station
(1,2,3) → 14 St-Union Sq at 0.12× (79 riders against 648 expected), and 2 Av → Fulton St at 0.09×.

That is the tradeoff with this model: much of what it flags amounts to "these two stations share a
line." A model that also controlled for shared routes or scheduled travel time would pull those
back toward 1× and leave only the pairings the network itself does not explain. That was
considered and deferred. The line structure is worth seeing first.

### Caveats

- **Thin pairs produce wild ratios.** A quiet complex's 50th destination can be a handful of
  riders, and a handful against an expectation near zero posts 100×. Livonia Av → Junius St, a
  one-block out-of-system transfer, shows 8 riders against 0.06 expected. The map's top class is
  simply "> 2×"; the tooltip gives the actual counts.
- **The stored destinations lean over 1×.** They are each complex's *busiest* destinations, so 72%
  of stored AM edges (79% in the PM) are above expected. Compare colours with each other, not
  against an even split.
- **Straight-line distance is not track distance**, as above. Rivers and the shape of the network
  are invisible to the model.
- **The destinations are modeled by MTA** (see [Data](#data)), and the model inherits that
  uncertainty.

## Reading the panels

- **Network (left)** — the selected complex plus its top destinations, sized by total traffic and
  colored by trunk line. With *Link destinations to each other* on, edges among the destinations
  themselves are drawn too, which is what turns a bare star into a graph with visible clusters.
  Under vs. expected, orange edges carry more riders than expected and blue fewer; thicker means
  further from expected, and only over-expected pairs pull their nodes together.
- **Map (right)** — all 424 complexes, shaded by flow from the selection on a sequential scale, or
  under vs. expected in five classes of ColorBrewer RdBu with breaks at 0.5, 0.8, 1.25 and 2×.
  Complexes outside the selection's top 50 stay unshaded. The map is drawn from the complete
  *stored* destination list — all 50 — while the network draws only as many as the slider asks
  for, so the map always shows at least as much as the network does.
- **Time of day** — four periods; the play button cycles them. Watching the AM and PM peaks in
  sequence is the point of the time dimension: the same station's flows largely reverse.
- **Destinations shown** — prunes the network without touching the map.

## Data

MTA, [Subway Origin-Destination Ridership Estimate,
2025](https://data.ny.gov/d/y2qv-fytt), via the New York State Open Data portal.

Every figure quoted below and above — the 424 complexes, the concentration shares, the coverage
table — is measured against the build committed here (`meta.generated` in the data file). Re-run
the build against a different year and they will move; the page reads its own numbers from the
data, but this README does not.

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
pip install requests numpy

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
| `data/subway_network.json` | 424 complexes with coordinates, routes, trunk color, and per-period boardings/arrivals; plus each complex's top-50 destinations per period, each with its riders and the gravity model's expected riders. Shape is specified in [DATA_FORMAT.md](DATA_FORMAT.md) |
| `data/boroughs.geojson` | Five boroughs, WGS 84, simplified for use as a backdrop |

---

## Using this with your own data

The viewer is not subway-specific. `app.js` reads a generic origin-destination document —
placed nodes, plus each node's top destinations per period — and takes every word it says
about itself from `config.js`. Nothing in it mentions trains.

To point it at different flows:

1. **Write a data file** matching [DATA_FORMAT.md](DATA_FORMAT.md). Any language; the shape is
   what matters. `build_subway_data.py` is one producer of it, not the only possible one.
2. **Edit [`config.js`](config.js)** — the data file's path, the page title and credit, and the
   vocabulary block that decides whether the page talks about *station complexes and riders* or
   *airports and passengers*.
3. **Serve it.** You should not need to touch `index.html` or `app.js`.

Anything that depends on the data — how many nodes there are, how deep the stored destination
lists go, what the colour legend says — is read from the data file at load rather than set in
config, so those can't drift out of sync with what is actually being drawn. If the data file
doesn't fit the contract, the page says which part is wrong instead of failing silently.

What travels well: any flow measured between fixed places over a repeating time slice —
commutes, migration, airline routes, trade, citations between institutions. What does not: flows
whose endpoints aren't points on a map, and datasets small enough that pruning to a top-N ego
network throws away the interesting part.

---

## Related

The same linked network-and-map idea applied to other geographies:

- [StateMigrationNetwork](https://github.com/ssitari/StateMigrationNetwork) — US interstate migration
- [LinkedNetworkGraphChoroplethMap](https://github.com/ssitari/LinkedNetworkGraphChoroplethMap) — NYC Citi Bike trips
- [CitiBikeStationNetwork](https://github.com/ssitari/CitiBikeStationNetwork) — Citi Bike trips by station, where the vs. expected metric started

## Acknowledgements

Built with assistance from Claude (Anthropic).

## License

[MIT](LICENSE)
