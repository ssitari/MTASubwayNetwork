'use strict';

// Visualization engine. Nothing in this file knows it is drawing a subway: every
// domain word comes from config.js, and every number that depends on the dataset
// (node count, stored destination depth, group legend) is read from the data file.
// To point it at different flows, write config.js and a data file — not this.
import * as CFG from './config.js';

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  period: 0,                          // index into data.periods
  metric: CFG.DEFAULT_METRIC,         // 'share' | 'count'
  topN:   CFG.DEFAULT_TOP_N,
  secondOrder: CFG.DEFAULT_SECOND_ORDER,
};

let selectedIndex = null;   // index into nodes
let data      = null;
let nodes     = [];
let topNMax   = 50;         // from data.meta.top_n; how deep the stored lists go
let simNodes  = [];         // nodes currently in the network (subset of nodes)
let simLinks  = [];
let playTimer = null;
let simulation = null;
let projection = null;

const ramp = d3[CFG.COLOR_RAMP];

// ── SVG / layout ─────────────────────────────────────────────────────────────
const container = document.getElementById('chart-container');
const svg       = d3.select('#chart');
const g         = svg.append('g');
const linkLayer = g.append('g').attr('class', 'links');
const nodeLayer = g.append('g').attr('class', 'nodes');

const mapContainer = document.getElementById('map-container');
const mapSvg       = d3.select('#map');
const mapG         = mapSvg.append('g');
const basemapLayer = mapG.append('g').attr('class', 'basemap');
const dotLayer     = mapG.append('g').attr('class', 'dots');

// Sequential ramp for "share of the selected node's flow arriving here".
const shareScale = d3.scaleSequential(ramp);

const tooltip = d3.select('#tooltip');

const fmt  = d3.format(',d');
const fmt1 = d3.format(',.1f');
const pct  = d3.format('.1%');

function dims() {
  const r = container.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

svg.call(d3.zoom().scaleExtent([0.2, 10]).on('zoom', e => g.attr('transform', e.transform)));
svg.on('click.deselect', () => select(null));

// ── Preflight ────────────────────────────────────────────────────────────────
// A template's most likely first-run failure is a data file that does not match
// the contract, so say exactly what is wrong instead of leaving "Loading…" up
// forever or throwing something cryptic from deep inside the render.
function preflight(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object') return ['the data file is not a JSON object'];

  if (!Array.isArray(doc.nodes) || !doc.nodes.length) problems.push('`nodes` is missing or empty');
  if (!Array.isArray(doc.periods) || !doc.periods.length) problems.push('`periods` is missing or empty');
  if (!doc.ego || typeof doc.ego !== 'object') problems.push('`ego` is missing');
  if (problems.length) return problems;

  const keys = doc.periods.map(p => p.key);
  if (keys.some(k => !k)) problems.push('every entry in `periods` needs a `key`');

  doc.nodes.slice(0, 1).forEach(n => {
    ['name', 'lat', 'lon'].forEach(f => {
      if (n[f] === undefined) problems.push('nodes are missing `' + f + '`');
    });
    if (!Array.isArray(n.out) || n.out.length !== doc.periods.length) {
      problems.push('each node needs `out` and `in` arrays with one entry per period');
    }
  });

  // ego indices address the nodes array positionally; an off-by-one here would
  // silently draw the wrong edges rather than fail, so check it up front.
  const n = doc.nodes.length;
  const first = doc.ego[Object.keys(doc.ego)[0]];
  if (first && Array.isArray(first[keys[0]])) {
    const bad = first[keys[0]].find(e => !Array.isArray(e) || e[0] < 0 || e[0] >= n);
    if (bad) problems.push('`ego` contains a destination index outside 0…' + (n - 1));
  }
  if (!Number.isFinite(doc.meta && doc.meta.top_n)) {
    problems.push('`meta.top_n` is missing (how many destinations each ego list stores)');
  }
  return problems;
}

function fail(message, detail, seeSpec) {
  const el = document.getElementById('loading');
  el.style.display = 'flex';
  el.innerHTML = '<div style="max-width:34em;line-height:1.6;text-align:left">' +
    '<strong style="color:#c66">' + message + '</strong>' +
    (detail ? '<div style="margin-top:8px;font-size:13px">' + detail + '</div>' : '') +
    (seeSpec ? '<div style="margin-top:10px;font-size:12px;color:#666">' +
      'See DATA_FORMAT.md for the expected shape.</div>' : '') + '</div>';
}

// ── Data load ────────────────────────────────────────────────────────────────
// The basemap is optional: it only orients the eye. If it is missing the nodes
// still draw the shape of the network on their own.
Promise.all([
  d3.json(CFG.DATA_FILE),
  CFG.BASEMAP_FILE ? d3.json(CFG.BASEMAP_FILE).catch(() => null) : Promise.resolve(null),
]).then(([net, geo]) => {
  const problems = preflight(net);
  if (problems.length) {
    fail('That data file does not match the expected format.',
         '<ul style="margin:0 0 0 1.1em;padding:0">' +
         problems.map(p => '<li>' + p + '</li>').join('') + '</ul>', true);
    return;
  }

  document.getElementById('loading').style.display = 'none';
  data = net;
  nodes = net.nodes;
  // Index every node once. The map's event handlers used to recover it with
  // nodes.indexOf(d), which is a linear scan on every hover.
  nodes.forEach((n, i) => { n.i = i; });

  topNMax = net.meta.top_n;
  state.topN = Math.min(state.topN, topNMax);

  applyStaticText();
  buildLegend();
  buildDatalist();
  buildPeriodControls();
  initControls();
  initMap(geo);
  buildMapLegend();
  installResize();

  select(openingNode());
}).catch(err => {
  fail('Could not load ' + CFG.DATA_FILE + '.',
       'The page fetches its data over HTTP, so it must be served rather than opened ' +
       'as a file:// URL — try <code>python3 -m http.server 8000</code>. ' +
       'The browser reported: ' + err.message);
});

// Opening selection: the network panel has nothing to show until something is
// selected, so landing on an empty canvas wastes the first impression.
function openingNode() {
  if (CFG.OPEN_ON === 'none') return null;
  if (CFG.OPEN_ON !== 'busiest') {
    const i = nodes.findIndex(n => String(n.id) === String(CFG.OPEN_ON));
    if (i >= 0) return i;
  }
  return d3.maxIndex(nodes, n => n.out[state.period] + n.in[state.period]);
}

// ── Static text ──────────────────────────────────────────────────────────────
// Everything the page says about itself, written once from config so that
// index.html carries structure only.
function applyStaticText() {
  document.title = CFG.APP_TITLE;
  document.getElementById('app-title').innerHTML =
    CFG.APP_TITLE + (CFG.APP_SUBTITLE ? '<br>' + CFG.APP_SUBTITLE : '');

  const set = (id, text) => { document.getElementById(id).textContent = text; };
  set('period-label', CFG.PERIOD_LABEL);
  set('node-picker-label', CFG.NODE_PICKER_LABEL);
  set('metric-label', CFG.METRIC_LABEL);
  set('topn-label', CFG.TOP_N_LABEL);
  set('second-order-label', CFG.SECOND_ORDER_LABEL);
  set('group-label', CFG.GROUP_LABEL);
  set('network-panel-title', CFG.NETWORK_PANEL_TITLE);
  set('map-panel-title', CFG.MAP_PANEL_TITLE);
  set('metric-share-label', CFG.SHARE_METRIC_LABEL);
  set('metric-count-label', CFG.COUNT_METRIC_LABEL);
  set('stat-edges-label', CFG.STAT_EDGES_LABEL);
  set('stat-coverage-label', CFG.STAT_COVERAGE_LABEL);
  set('stat-total-label', CFG.STAT_TOTAL_LABEL);

  document.getElementById('search').placeholder = 'Search ' + CFG.NODE_LABEL_PLURAL + '…';

  // The node count and the stored depth are facts about the data, never config.
  document.getElementById('topn-hint').textContent =
    'The network draws only this many destinations. The map always keeps all ' +
    nodes.length + ' ' + CFG.NODE_LABEL_PLURAL + '.';

  const credit = document.getElementById('credit');
  if (CFG.CREDIT_HTML.trim()) {
    credit.innerHTML = CFG.CREDIT_HTML +
      (data.meta.generated ? ' <span style="color:#6a6a6a">Data built ' +
        data.meta.generated + '.</span>' : '');
  } else {
    credit.remove();
  }

  // meta.note is the caveat the builder wanted carried to the reader — usually
  // how the numbers were derived. Park it where hovering the stats finds it.
  if (data.meta.note) document.getElementById('stats').title = data.meta.note;

  const slider = document.getElementById('topn-slider');
  slider.min = CFG.MIN_TOP_N;
  slider.max = topNMax;              // never offer more than the data stores
  slider.value = state.topN;
  document.getElementById('topn-val').textContent = state.topN;

  document.querySelector('input[name="metric"][value="' + state.metric + '"]').checked = true;
  document.getElementById('second-order').checked = state.secondOrder;
}

// ── Accessors ────────────────────────────────────────────────────────────────
function egoEdges(i) {
  const e = data.ego[String(i)];
  if (!e) return [];
  return e[data.periods[state.period].key] || [];
}

function outTotal(i)  { return nodes[i].out[state.period]; }
function inTotal(i)   { return nodes[i].in[state.period]; }
function bothTotal(i) { return outTotal(i) + inTotal(i); }

function label(i)     { return nodes[i].short || nodes[i].name; }

// Edge weight is the share of the ORIGIN node's outbound flow in this period, carried
// over from the state-migration version of this tool. Raw counts would just restate
// which nodes are busy; the share says where a node's own flow actually goes.
function shareOf(originIndex, value) {
  const tot = outTotal(originIndex);
  return tot > 0 ? value / tot : 0;
}

function weightOf(l) { return state.metric === 'share' ? l.share : l.value; }

// Largest single origin-destination flow anywhere in the current period, used as the map's
// colour domain under the raw-count metric. Cached: it is a scan of every stored edge.
const maxValueCache = new Map();
function globalMaxValue() {
  const key = state.period;
  if (!maxValueCache.has(key)) {
    let m = 0;
    for (const k in data.ego) {
      for (const [, v] of egoEdges(+k)) if (v > m) m = v;
    }
    maxValueCache.set(key, m || 1);
  }
  return maxValueCache.get(key);
}

// ── Network construction ─────────────────────────────────────────────────────
// Nodes = the selected node plus its top-N destinations. Edges = the selected node to
// each destination, plus (optionally) edges among the destinations themselves, pulled
// from each destination's own stored list. The second-order edges are what turn a bare
// star into a graph with readable clusters.
function buildNetwork() {
  if (selectedIndex === null) return { nodes: [], links: [] };

  const top = egoEdges(selectedIndex).slice(0, state.topN);
  const members = new Set([selectedIndex]);
  top.forEach(([j]) => members.add(j));

  const links = [];
  const seen = new Set();
  const addLink = (a, b, value, primary) => {
    const key = a + '-' + b;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ s: a, t: b, value, share: shareOf(a, value), primary });
  };

  top.forEach(([j, value]) => addLink(selectedIndex, j, value, true));

  if (state.secondOrder) {
    for (const a of members) {
      if (a === selectedIndex) continue;
      for (const [b, value] of egoEdges(a)) {
        if (b !== selectedIndex && members.has(b)) addLink(a, b, value, false);
      }
    }
  }

  return { nodes: Array.from(members), links };
}

// ── Main render ──────────────────────────────────────────────────────────────
function draw() {
  const built = buildNetwork();
  const { w, h } = dims();

  // Keep positions across redraws so changing period or top-N animates rather than resetting.
  const prev = new Map(simNodes.map(d => [d.index, d]));
  simNodes = built.nodes.map(i => prev.get(i) || {
    index: i,
    x: w / 2 + (Math.random() - 0.5) * 300,
    y: h / 2 + (Math.random() - 0.5) * 300,
  });
  const byIndex = new Map(simNodes.map(d => [d.index, d]));
  simLinks = built.links.map(l => ({ ...l, source: byIndex.get(l.s), target: byIndex.get(l.t) }));

  const maxWeight = d3.max(simLinks, weightOf) || 1;
  const maxNode   = d3.max(simNodes, d => bothTotal(d.index)) || 1;
  const rScale = d3.scaleSqrt().domain([0, maxNode]).range(CFG.NODE_RADIUS_RANGE);
  const wScale = d3.scalePow().exponent(0.5).domain([0, maxWeight])
    .range(CFG.EDGE_WIDTH_RANGE).clamp(true);

  if (!simulation) {
    simulation = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink([]).id(d => d.index).distance(CFG.LINK_DISTANCE_PRIMARY))
      .force('charge', d3.forceManyBody().strength(CFG.CHARGE_STRENGTH))
      .force('center', d3.forceCenter(w / 2, h / 2))
      .force('collision', d3.forceCollide(10))
      .alphaDecay(0.025)
      .on('tick', ticked);
  } else {
    simulation.nodes(simNodes);
    simulation.force('center', d3.forceCenter(w / 2, h / 2));
  }

  // ── Links ──
  const linkSel = linkLayer.selectAll('line').data(simLinks, l => l.s + '-' + l.t);
  linkSel.exit().remove();
  linkSel.enter().append('line')
    .attr('stroke', '#8a8a8a')
    .merge(linkSel)
    .attr('stroke-width', l => wScale(weightOf(l)))
    .attr('stroke-opacity', l => l.primary ? 0.75 : 0.16);

  // ── Nodes ──
  const nodeSel = nodeLayer.selectAll('g.node').data(simNodes, d => d.index);
  nodeSel.exit().remove();
  const nodeEnter = nodeSel.enter().append('g')
    .attr('class', 'node')
    .attr('cursor', 'pointer')
    .call(drag())
    .on('mouseover', (event, d) => showTooltip(event, d.index))
    .on('mousemove', moveTooltip)
    .on('mouseout', hideTooltip)
    .on('click', (event, d) => {
      event.stopPropagation();
      select(d.index === selectedIndex ? null : d.index);
    });

  nodeEnter.append('circle').attr('stroke', '#fff').attr('stroke-width', 1.1);
  nodeEnter.append('text')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'hanging')
    .attr('pointer-events', 'none')
    .attr('fill', '#ddd')
    .attr('font-size', '9px')
    .attr('font-weight', '600')
    .attr('paint-order', 'stroke')
    .attr('stroke', '#141414')
    .attr('stroke-width', '3px')
    .attr('stroke-linejoin', 'round')
    .style('font-family', 'system-ui, sans-serif');

  const nodeAll = nodeEnter.merge(nodeSel);
  nodeAll.select('circle').attr('r', d => rScale(bothTotal(d.index)));
  nodeAll.select('text')
    .attr('dy', d => rScale(bothTotal(d.index)) + 3)
    .text(d => label(d.index));

  simulation.force('collision', d3.forceCollide().radius(d => rScale(bothTotal(d.index)) + 3));
  simulation.force('link')
    .links(simLinks)
    .distance(l => l.primary ? CFG.LINK_DISTANCE_PRIMARY : CFG.LINK_DISTANCE_SECOND)
    .strength(l => Math.min(1, weightOf(l) / (maxWeight || 1)) * (l.primary ? 1 : 0.35));
  simulation.alpha(0.7).restart();

  paint();
  updateStats();
}

// ── Selection and colouring ──────────────────────────────────────────────────
function select(i) {
  selectedIndex = i;
  // The node set changes with the selection, so this is a full rebuild, not just a repaint.
  updateSelectedReadout();
  draw();
}

function paint() {
  const sel = selectedIndex;

  // Value painted on the map for every node: the share of the selected node's flow
  // (or the raw value) arriving there in this period. Computed from the whole stored
  // ego list, not the pruned top-N, so the map shows more than the network does.
  const values = new Map();
  if (sel !== null) {
    for (const [j, v] of egoEdges(sel)) {
      values.set(j, state.metric === 'share' ? shareOf(sel, v) : v);
    }
  }

  // Under 'share' the ramp is rescaled to the selection: share is a value divided by a
  // constant (the origin's own total), so a per-selection domain is the only thing that
  // distinguishes the two metrics at all -- normalized against its own max, a share ramp
  // and a count ramp are the identical picture. Under 'count' the domain is instead global
  // to the period, so a quiet node reads as genuinely pale next to a busy one and two
  // selections can be compared.
  const maxVal = state.metric === 'share'
    ? (d3.max(Array.from(values.values())) || 1)
    : globalMaxValue();
  shareScale.domain([0, maxVal]);
  const colorOf = i => (values.has(i) ? shareScale(values.get(i)) : CFG.LAND_COLOR);

  const inNetwork = new Set(simNodes.map(d => d.index));

  // Network nodes keep their group colour; the selected one is ringed.
  nodeLayer.selectAll('g.node circle')
    .attr('fill', d => nodes[d.index].group || CFG.DEFAULT_GROUP_COLOR)
    .attr('stroke', d => d.index === sel ? CFG.SELECTION_COLOR : 'rgba(0,0,0,0.45)')
    .attr('stroke-width', d => d.index === sel ? 3 : 0.9);

  const maxDot = d3.max(nodes, (n, i) => bothTotal(i)) || 1;
  const dotR = d3.scaleSqrt().domain([0, maxDot]).range(CFG.MAP_DOT_RADIUS_RANGE);

  dotLayer.selectAll('circle')
    // With nothing selected there is no flow to shade by, so the map falls back to group
    // colour -- which draws the system as a recognisable map rather than a grey field.
    .attr('fill', n => n.i === sel ? CFG.SELECTION_COLOR
      : (sel === null ? (n.group || CFG.DEFAULT_GROUP_COLOR) : colorOf(n.i)))
    .attr('r', n => dotR(bothTotal(n.i)) * (n.i === sel ? 1.5 : 1))
    .attr('stroke', n => n.i === sel ? CFG.SELECTION_COLOR
      : (inNetwork.has(n.i) ? '#eee' : 'rgba(0,0,0,0.5)'))
    .attr('stroke-width', n => n.i === sel ? 2 : (inNetwork.has(n.i) ? 1.1 : 0.4))
    .attr('opacity', n => (sel === null || n.i === sel || values.has(n.i)) ? 1 : 0.25);

  updateMapLegend(0, maxVal);
  updateSubtitles();
}

function updateSubtitles() {
  const p = data.periods[state.period].label;
  if (selectedIndex === null) {
    document.getElementById('network-sub').textContent = 'Select a ' + CFG.NODE_LABEL + '.';
    document.getElementById('map-sub').textContent = '';
    return;
  }
  const name = label(selectedIndex);
  document.getElementById('network-sub').textContent =
    'Top ' + state.topN + ' destinations from ' + name + ' · ' + p;
  document.getElementById('map-sub').textContent =
    'All ' + nodes.length + ' ' + CFG.NODE_LABEL_PLURAL + ', shaded by flow from ' + name;
}

// ── Tick / drag ──────────────────────────────────────────────────────────────
function ticked() {
  linkLayer.selectAll('line')
    .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
  nodeLayer.selectAll('g.node').attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
}

function drag() {
  return d3.drag()
    .on('start', (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
    })
    .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
    .on('end', (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null; d.fy = null;
    });
}

// ── Tooltip ──────────────────────────────────────────────────────────────────
function showTooltip(event, i) {
  const n = nodes[i];
  const p = data.periods[state.period].label;
  const tags = (n.tags || []).join(' · ');
  let html = '<strong>' + label(i) + '</strong><br>' +
    '<span class="routes">' + (tags ? tags + ' · ' : '') + p + '</span><br>' +
    '<span class="num">' + CFG.OUT_LABEL + ': ' + fmt(outTotal(i)) + '<br>' +
    CFG.IN_LABEL + ': ' + fmt(inTotal(i)) + '</span>';

  if (selectedIndex !== null && selectedIndex !== i) {
    const edge = egoEdges(selectedIndex).find(([j]) => j === i);
    const back = egoEdges(i).find(([j]) => j === selectedIndex);
    const selName = label(selectedIndex);
    const thisName = label(i);
    // Ego lists are truncated, so an absent pair is "not in the stored list", not zero.
    const missing = 'below top ' + topNMax;
    html += '<hr style="border:none;border-top:1px solid #444;margin:6px 0"><span class="num">';
    html += selName + ' → ' + thisName + ': ' +
      (edge ? fmt1(edge[1]) + ' (' + pct(shareOf(selectedIndex, edge[1])) + ')' : missing);
    html += '<br>' + thisName + ' → ' + selName + ': ' +
      (back ? fmt1(back[1]) + ' (' + pct(shareOf(i, back[1])) + ')' : missing);
    html += '</span>';
  }
  tooltip.style('display', 'block').html(html);
  moveTooltip(event);
}

function moveTooltip(event) {
  tooltip.style('left', (event.pageX + 14) + 'px').style('top', (event.pageY - 32) + 'px');
}
function hideTooltip() { tooltip.style('display', 'none'); }

// ── Stats ────────────────────────────────────────────────────────────────────
function updateStats() {
  document.getElementById('stat-edges').textContent = fmt(simLinks.length);

  let cov = '—';
  if (selectedIndex !== null) {
    const all = egoEdges(selectedIndex);
    const totShown = d3.sum(all.slice(0, state.topN), d => d[1]);
    const tot = outTotal(selectedIndex);
    if (tot > 0) cov = pct(totShown / tot);
  }
  document.getElementById('stat-coverage').textContent = cov;
  document.getElementById('stat-total').textContent =
    fmt(d3.sum(nodes, (n, i) => outTotal(i)));
}

function updateSelectedReadout() {
  const el = document.getElementById('selected');
  if (selectedIndex === null) {
    el.innerHTML = '<span class="sel-sub">No ' + CFG.NODE_LABEL + ' selected.</span>';
    return;
  }
  const n = nodes[selectedIndex];
  const sub = [(n.tags || []).join(' · '), n.group_label].filter(Boolean).join(' · ');
  el.innerHTML =
    '<div class="sel-name">' + label(selectedIndex) + '</div>' +
    (sub ? '<div class="sel-sub">' + sub + '</div>' : '') +
    '<div class="sel-sub num">' + fmt(outTotal(selectedIndex)) + ' out · ' +
    fmt(inTotal(selectedIndex)) + ' in</div>';
}

// ── Controls ─────────────────────────────────────────────────────────────────
function buildPeriodControls() {
  // A dataset with no time dimension ships one period. Offering a radio group of
  // one and a play button that cycles to itself would be noise, so hide the whole
  // control rather than render a degenerate version of it.
  if (data.periods.length < 2) {
    document.getElementById('period-control').style.display = 'none';
    return;
  }
  const box = d3.select('#period-group');
  data.periods.forEach((p, i) => {
    const lab = box.append('label');
    lab.append('input')
      .attr('type', 'radio').attr('name', 'period').attr('id', 'per-' + p.key).attr('value', i)
      .property('checked', i === state.period)
      .on('change', function () { setPeriod(+this.value); });
    lab.append('span').text(p.label + (p.note ? ' (' + p.note + ')' : ''));
  });
}

function setPeriod(i) {
  state.period = i;
  const radio = document.querySelector('input[name="period"][value="' + i + '"]');
  if (radio) radio.checked = true;
  draw();
  updateSelectedReadout();
}

function buildDatalist() {
  const dl = document.getElementById('node-list');
  nodes.forEach(n => {
    const o = document.createElement('option');
    o.value = n.name;
    dl.appendChild(o);
  });
}

// Exact match first (that is what picking from the datalist gives), then a
// case-insensitive prefix, then a substring. Typing "grand central" and pressing
// enter used to do nothing at all, silently.
function findNode(query) {
  const q = query.trim().toLowerCase();
  if (!q) return -1;
  const names = nodes.map(n => n.name.toLowerCase());
  let i = names.indexOf(q);
  if (i >= 0) return i;
  i = names.findIndex(n => n.startsWith(q));
  if (i >= 0) return i;
  return names.findIndex(n => n.includes(q));
}

function initControls() {
  const search = document.getElementById('search');
  const runSearch = () => {
    const i = findNode(search.value);
    if (i >= 0) {
      select(i);
      search.setCustomValidity('');
      search.style.borderColor = '';
    } else if (search.value.trim()) {
      // Say so, rather than leaving the previous selection up as if it had worked.
      search.style.borderColor = '#a15';
    }
  };
  search.addEventListener('change', runSearch);
  search.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
  search.addEventListener('input', () => { search.style.borderColor = ''; });

  d3.selectAll('input[name="metric"]').on('change', function () {
    state.metric = this.value;
    updateMetricHint();
    draw();
  });

  document.getElementById('topn-slider').addEventListener('input', function () {
    state.topN = +this.value;
    document.getElementById('topn-val').textContent = this.value;
    draw();
  });

  document.getElementById('second-order').addEventListener('change', function () {
    state.secondOrder = this.checked;
    draw();
  });

  document.getElementById('play').addEventListener('click', function () {
    if (playTimer) {
      clearInterval(playTimer); playTimer = null;
      this.textContent = '▶'; this.setAttribute('aria-label', 'Play through periods');
      return;
    }
    this.textContent = '❚❚'; this.setAttribute('aria-label', 'Pause');
    playTimer = setInterval(() => setPeriod((state.period + 1) % data.periods.length),
                            CFG.PLAY_INTERVAL_MS);
  });

  updateMetricHint();
}

function updateMetricHint() {
  document.getElementById('metric-hint').textContent =
    state.metric === 'share' ? CFG.SHARE_METRIC_HINT : CFG.COUNT_METRIC_HINT;
}

// ── Resize ───────────────────────────────────────────────────────────────────
// Both panels have to follow the window. The network's force centre in particular
// is only set inside draw(), so without this a resized window leaves the graph
// pinned wherever the old centre was — off the edge of a narrowed panel.
function installResize() {
  let raf = null;
  window.addEventListener('resize', () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = null;
      const { w, h } = dims();
      if (simulation) {
        simulation.force('center', d3.forceCenter(w / 2, h / 2));
        simulation.alpha(0.3).restart();
      }
      resizeMap();
    });
  });
}

// ── Map ──────────────────────────────────────────────────────────────────────
let mapPoints = null;
let mapPath = null;

function initMap(geo) {
  const r = mapContainer.getBoundingClientRect();
  mapPoints = {
    type: 'FeatureCollection',
    features: nodes.map(n => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [n.lon, n.lat] },
    })),
  };
  // Fit to the nodes, not the basemap: the nodes are the subject, and a large
  // empty region of the backdrop would otherwise push them into a corner.
  projection = d3.geoMercator()
    .fitSize([r.width * CFG.MAP_FIT_PADDING[0], r.height * CFG.MAP_FIT_PADDING[1]], mapPoints);
  mapPath = d3.geoPath(projection);

  if (geo) {
    basemapLayer.selectAll('path')
      .data(geo.features)
      .enter().append('path')
      .attr('d', mapPath)
      .attr('fill', CFG.BASEMAP_FILL)
      .attr('stroke', CFG.BASEMAP_LINE)
      .attr('stroke-width', 0.7)
      .attr('pointer-events', 'none');
  }

  dotLayer.selectAll('circle')
    .data(nodes)
    .enter().append('circle')
    .attr('cx', n => projection([n.lon, n.lat])[0])
    .attr('cy', n => projection([n.lon, n.lat])[1])
    .attr('cursor', 'pointer')
    .on('mouseover', (event, n) => showTooltip(event, n.i))
    .on('mousemove', moveTooltip)
    .on('mouseout', hideTooltip)
    .on('click', (event, n) => {
      event.stopPropagation();
      select(n.i === selectedIndex ? null : n.i);
    });

  mapSvg.on('click', () => select(null));
  centreMap();
}

function resizeMap() {
  const r = mapContainer.getBoundingClientRect();
  projection.fitSize([r.width * CFG.MAP_FIT_PADDING[0], r.height * CFG.MAP_FIT_PADDING[1]],
                     mapPoints);
  basemapLayer.selectAll('path').attr('d', mapPath);
  dotLayer.selectAll('circle')
    .attr('cx', n => projection([n.lon, n.lat])[0])
    .attr('cy', n => projection([n.lon, n.lat])[1]);
  centreMap();
  positionMapLegend();
}

// Centre on the projected NODES, not on the whole drawing. Centring on the full
// bbox let an empty corner of the basemap — Staten Island, which has no subway —
// shove the network into the top-left and waste most of the panel. The basemap is
// allowed to overflow and clip; it is backdrop.
function centreMap() {
  const r = mapContainer.getBoundingClientRect();
  const xy = nodes.map(n => projection([n.lon, n.lat]));
  const x0 = d3.min(xy, p => p[0]), x1 = d3.max(xy, p => p[0]);
  const y0 = d3.min(xy, p => p[1]), y1 = d3.max(xy, p => p[1]);
  mapG.attr('transform', 'translate(' +
    ((r.width - (x1 - x0)) / 2 - x0) + ',' +
    ((r.height - (y1 - y0)) / 2 - y0) + ')');
}

function buildMapLegend() {
  const defs = mapSvg.append('defs');
  const grad = defs.append('linearGradient').attr('id', 'grad-share');
  d3.range(0, 1.001, 0.05).forEach(t => {
    grad.append('stop')
      .attr('offset', (t * 100).toFixed(0) + '%')
      .attr('stop-color', ramp(t));
  });

  const lg = mapSvg.append('g').attr('class', 'map-legend').attr('pointer-events', 'none');
  lg.append('text').attr('class', 'legend-title')
    .attr('y', -6).attr('fill', '#bbb').attr('font-size', '10px')
    .attr('font-weight', '600').style('font-family', 'system-ui, sans-serif');
  lg.append('rect').attr('class', 'legend-bar')
    .attr('y', 0).attr('height', 8).attr('fill', 'url(#grad-share)');
  lg.append('text').attr('class', 'legend-min')
    .attr('y', 19).attr('fill', '#888').attr('font-size', '9px')
    .style('font-family', 'system-ui, sans-serif');
  lg.append('text').attr('class', 'legend-max')
    .attr('y', 19).attr('text-anchor', 'end').attr('fill', '#888').attr('font-size', '9px')
    .style('font-family', 'system-ui, sans-serif');
  positionMapLegend();
}

function positionMapLegend() {
  const r = mapContainer.getBoundingClientRect();
  const lw = Math.min(200, r.width - 24);
  mapSvg.select('.map-legend').attr('transform', 'translate(12,' + (r.height - 30) + ')');
  mapSvg.select('.legend-bar').attr('width', lw);
  mapSvg.select('.legend-max').attr('x', lw);
}

function updateMapLegend(min, max) {
  const fmtVal = v => state.metric === 'share' ? pct(v) : fmt(Math.round(v));
  mapSvg.select('.legend-title').text(selectedIndex === null
    ? ''
    : (state.metric === 'share'
        ? 'Share of ' + label(selectedIndex) + '’s ' + CFG.VALUE_LABEL
        : CFG.VALUE_LABEL.replace(/^./, c => c.toUpperCase()) + ' from ' + label(selectedIndex)));
  mapSvg.select('.legend-min').text(fmtVal(min));
  mapSvg.select('.legend-max').text(fmtVal(max));
}

// ── Group legend ─────────────────────────────────────────────────────────────
// meta.group_order gives the builder's own ordering. Falling back to first-seen
// order means a data file without it still legends correctly, just arbitrarily.
function buildLegend() {
  let entries = data.meta.group_order;
  if (!Array.isArray(entries) || !entries.length) {
    const seen = new Map();
    nodes.forEach(n => { if (n.group_label && !seen.has(n.group_label)) seen.set(n.group_label, n.group); });
    entries = Array.from(seen.entries());
  }
  if (!entries.length) {
    document.getElementById('group-control').style.display = 'none';
    return;
  }
  const cont = d3.select('#legend');
  entries.forEach(([lab, color]) => {
    const row = cont.append('div').attr('class', 'legend-item');
    row.append('div').attr('class', 'swatch').style('background', color);
    row.append('span').text(lab);
  });
}
