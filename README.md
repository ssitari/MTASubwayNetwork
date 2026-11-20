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

*Rank destinations by* decides both which destinations a station's network shows and how its edges
are weighted. There are three choices:

- **Share of the station's riders** (the default) — the station's busiest destinations, each
  weighted by the share of the origin complex's riders it carries, the same choice made in the
  state-migration version of this tool. Raw rider counts mostly restate which stations are busy:
  every list would be topped by the same handful of Midtown transfer points, and a quiet
  outer-borough station would have no legible structure at all. The share metric asks a different
  question — of everyone who boards *here*, where do they actually go? — and it makes small
  stations as readable as large ones.
- **Most over expected** and **Most under expected** — the destinations furthest above or below
  what a gravity model predicts, ranked by that ratio rather than by size. See
  [Vs. expected](#vs-expected).

An earlier version also offered raw rider estimates. It was dropped: ranked by size, it picked the
same destinations as share and differed only in the map's colour scale.

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
not too far away." The two vs. expected rankings divide each flow by what a gravity model predicts
for it, so what stands out is what busyness and distance cannot explain. It is the same idea as the
[Citi Bike station network](https://github.com/ssitari/CitiBikeStationNetwork), adapted for trains.

They also *choose* the destinations by that ratio. Choosing by riders and only colouring by the
ratio, as an earlier version did, buried exactly the ties this view exists to find: a quiet pair
with an unusually strong link never made a station's busiest 50. Ranked by ratio, **17%** of the
destinations in a station's AM "most over" top 25 are ones its busiest-50 list never contained.
At Flushing-Main St it is 12 of 25.

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
parameters, about 15 seconds for the four periods).

### How the rankings are built

For each complex and period, the build keeps two lists beside its busiest 50:

- **over** — up to 50 destinations with more riders than expected, highest ratio first;
- **under** — up to 50 with fewer, lowest ratio first. Ties, mostly pairs with no riders at all, go
  to the larger expectation: none against 70 expected says more than none against 2.

A pair is ranked only if the model expects **at least 2 riders** for it on a typical weekday in the
period — about 500 trips a year. Below that the ratio mostly measures the model's own blind spots.
Livonia Av → Junius St, a one-block out-of-system transfer, has 8 riders against 0.06 expected:
143×. The floor is kept low on purpose. At 10, most quiet stations had almost nothing left to rank,
and surfacing their unusual ties is the point.

Each list keeps only its own side of 1×, so it can run short. In the AM the median complex has 48
qualifying destinations above expected; 223 of the 424 have fewer than 50, and in the evening 309
do. The page says "All 22 destinations … that qualify" rather than padding the list with pairs from
the other side.

### What it shows

Straight-line distance does not know where the tracks run, so the strongest results are mostly
one-seat rides. In the AM peak, Wall St (2,3)'s riders go to 50 St on the 1 at **10.6×** (148
riders against 14 expected) and to 34 St-Penn Station (1,2,3) at 8.5×. From Bedford Av on the L, 3
Av runs at 9.9× and 1 Av at 6.1×. From Flushing-Main St, the top of the list is the rest of the 7:
Queensboro Plaza at 4.1×, 69 St at 3.9×.

The *under* lists are mostly trips that need a transfer, or that run the length of the system the
wrong way. From Wall St, Grand St (B,D) has 0.5 riders against 20 expected (0.03×), and stations on
the G come close behind. From Flushing, the bottom of the list is the far end of the A line — Far Rockaway, Howard Beach
— and the Bronx.

That is the tradeoff with this model: much of what it flags amounts to "these two stations share a
line." A model that also controlled for shared routes or scheduled travel time would pull those
back toward 1× and leave only the pairings the network itself does not explain. That was
considered and deferred. The line structure is worth seeing first.

### Caveats

- **The ratio is not the size.** A ranked list deliberately mixes big flows with small ones. The
  tooltip gives the riders and the expected count behind every ratio, and the node sizes still show
  how busy each station is overall.
- **Zero-rider pairs.** About 3% of AM *under* entries (597 of 20,449) have no riders at all. About
  four in ten of those are within 1.5 km of each other, like 86 St on the Q and 86 St on the 4/5/6,
  where people walk. But 60 of them (one in ten) share a line as well, which may reflect how MTA
  infers destinations rather than how people ride.
- **Straight-line distance is not track distance**, as above. Rivers and the shape of the network
  are invisible to the model.
- **The destinations are modeled by MTA** (see [Data](#data)), and the model inherits that
  uncertainty.

## Reading the panels

- **Network (left)** — the selected complex plus its top destinations under the current ranking,
  sized by total traffic and colored by trunk line. With *Link destinations to each other* on,
  edges among the destinations themselves are drawn too, from each destination's own list for the
  same ranking — under *most over*, a link between two destinations means they too ride more than
  expected. This is what turns a bare star into a graph with visible clusters. Under the two
  vs. expected rankings, edges are orange (over) or blue (under) and thicker the further from
  expected; under *most over*, the further above expected a pair is, the harder it pulls its nodes
  together.
- **Map (right)** — all 424 complexes. Under share, the selection's stored destinations are
  shaded on a sequential scale. Under the vs. expected rankings they fall into five quantile
  classes of the ratios in view — ColorBrewer OrRd above expected, Blues below — darkest furthest
  from expected, with each class labelled by its range. Complexes not in the stored list stay
  unshaded. The map is drawn from the complete stored list — up to 50 — while the network draws
  only as many as the slider asks for, so the map always shows at least as much as the network does.
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
| `data/subway_network.json` | 424 complexes with coordinates, routes, trunk color, and per-period boardings/arrivals; plus three lists of up to 50 destinations per complex per period — busiest, furthest over expected, furthest under — each entry with its riders and the gravity model's expected riders. Shape is specified in [DATA_FORMAT.md](DATA_FORMAT.md) |
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
