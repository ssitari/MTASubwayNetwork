// ============================================================
//  config.js  —  Edit this file to use your own data
// ============================================================
//
//  QUICK START
//  1. Build a data file matching DATA_FORMAT.md and drop it in data/
//  2. Update DATA_FILE (and BASEMAP_FILE, or set it to null)
//  3. Rewrite the VOCABULARY block so the page talks about your subject
//     instead of subway riders
//  4. Set APP_TITLE, APP_SUBTITLE and CREDIT_HTML so the page describes
//     YOUR data and cites YOUR source
//  5. Serve over HTTP and you're done
//
//  Everything the page says about itself lives in this file — you should
//  never need to edit index.html or app.js to publish your own network.
//  Anything that depends on the data itself (how many nodes there are, how
//  deep the stored destination lists go, the group legend) is read from the
//  data file at load, not set here, so it can never fall out of sync.
//
// ============================================================

// ============================================================
//  DATA
//  BASEMAP_FILE is optional context behind the dots — any GeoJSON in
//  WGS 84. Set it to null to draw the nodes on an empty ground; the map
//  still works, because the nodes carry their own coordinates.
// ============================================================

export const DATA_FILE   = 'data/subway_network.json';
export const BASEMAP_FILE = 'data/boroughs.geojson';

// ============================================================
//  PAGE IDENTITY
//  Shown in the browser tab, the sidebar heading, and the footer.
//  CREDIT_HTML is inserted as markup, so links are allowed — cite the
//  source of your data here. Set it to '' to hide the footer.
// ============================================================

export const APP_TITLE    = 'NYC Subway Trip Network';
export const APP_SUBTITLE = 'Trip flows between station complexes, 2025';

export const CREDIT_HTML = `
  Data:
  <a href="https://data.ny.gov/d/y2qv-fytt" rel="noopener" target="_blank">MTA Subway Origin-Destination Ridership Estimate, 2025</a>.
  Source code and method notes:
  <a href="https://github.com/ssitari/MTASubwayNetwork" rel="noopener" target="_blank">ssitari/MTASubwayNetwork</a>.
`;

// ============================================================
//  VOCABULARY
//  Every domain word on the page. The defaults describe subway riders;
//  for airline routes you would say 'airport' / 'passengers' / 'departures',
//  for migration 'state' / 'movers' / 'out-migrants', and so on.
//
//  NODE_LABEL is used in running text ("Select a station complex"), so give
//  it in lower case unless it is a proper noun.
// ============================================================

export const NODE_LABEL        = 'station complex';
export const NODE_LABEL_PLURAL = 'station complexes';

// What one unit of flow is called. VALUE_LABEL appears in running text;
// OUT_LABEL and IN_LABEL name the two directions in tooltips and the readout.
export const VALUE_LABEL = 'riders';
export const OUT_LABEL   = 'Boardings';
export const IN_LABEL    = 'Arrivals';

// What the node colouring means — the heading over the colour legend.
export const GROUP_LABEL = 'Trunk line';

// The two edge-weight metrics. 'share' divides each flow by the origin's own
// outbound total; 'count' uses the raw stored value. The hints explain the
// consequence of each choice, which differs by dataset — rewrite them.
export const SHARE_METRIC_LABEL = 'Share of the station’s riders';
export const SHARE_METRIC_HINT  =
  'Where this station’s own riders go, so small stations read as clearly as big ones. ' +
  'The map ramp rescales to each selection.';

export const COUNT_METRIC_LABEL = 'Estimated riders';
export const COUNT_METRIC_HINT  =
  'Raw estimates on one system-wide ramp, so selections are comparable and quiet stations stay pale.';

// Sidebar control headings and the two panel captions.
export const PERIOD_LABEL      = 'Time of day';   // set to '' if your data has one period
export const NODE_PICKER_LABEL = 'Station';
export const METRIC_LABEL      = 'Edge weight';
export const TOP_N_LABEL       = 'Destinations shown';
export const SECOND_ORDER_LABEL = 'Link destinations to each other';

export const NETWORK_PANEL_TITLE = 'Network';
export const MAP_PANEL_TITLE     = 'Map';

// Sidebar footer statistics.
export const STAT_EDGES_LABEL    = 'Network edges';
export const STAT_COVERAGE_LABEL = 'Riders covered';
export const STAT_TOTAL_LABEL    = 'Trips this period';

// ============================================================
//  DEFAULTS
//  Where the page opens. TOP_N is clamped at load to the number of
//  destinations the data file actually stores (meta.top_n), so setting it
//  too high is harmless.
// ============================================================

export const DEFAULT_TOP_N        = 25;
export const MIN_TOP_N            = 5;
export const DEFAULT_METRIC       = 'share';   // 'share' | 'count'
export const DEFAULT_SECOND_ORDER = true;
export const PLAY_INTERVAL_MS     = 1600;      // period auto-advance

// Which node the page opens on. 'busiest' picks the largest node by total
// flow; 'none' opens with an empty network panel; or give a node id as a
// string to always open on the same one.
export const OPEN_ON = 'busiest';

// ============================================================
//  COLOUR
//  COLOR_RAMP is the name of any d3 sequential interpolator —
//  'interpolateYlGnBu', 'interpolateViridis', 'interpolateMagma'…
//  It drives both the map shading and its legend gradient.
// ============================================================

export const COLOR_RAMP = 'interpolateYlGnBu';

export const LAND_COLOR         = '#242424';  // nodes with no flow from the selection
export const BASEMAP_FILL       = '#1e1e1e';
export const BASEMAP_LINE       = '#2f2f2f';
export const DEFAULT_GROUP_COLOR = '#999';    // nodes whose group has no colour
export const SELECTION_COLOR    = '#fff';

// ============================================================
//  LAYOUT TUNING
//  Sensible for a few dozen nodes on screen. Raise CHARGE_STRENGTH's
//  magnitude to spread a crowded graph; raise the radius ranges if your
//  node totals span a narrower range than subway ridership does.
// ============================================================

export const CHARGE_STRENGTH        = -240;
export const LINK_DISTANCE_PRIMARY  = 55;   // selection → destination
export const LINK_DISTANCE_SECOND   = 95;   // destination → destination
export const NODE_RADIUS_RANGE      = [3.5, 20];
export const EDGE_WIDTH_RANGE       = [0.4, 7];
export const MAP_DOT_RADIUS_RANGE   = [1.6, 9];

// Fraction of the map panel the node cloud is fitted into. Below 1 it leaves
// a margin; the basemap is allowed to overflow that box, since it is backdrop.
export const MAP_FIT_PADDING = [0.9, 0.88];
