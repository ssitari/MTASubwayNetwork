'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const LAND_COLOR    = '#242424';   // map fill for complexes with no flow from the selection
const BASEMAP_FILL  = '#1e1e1e';
const BASEMAP_LINE  = '#2f2f2f';
const DEFAULT_COLOR = '#999';

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  period: 0,          // index into data.periods
  metric: 'share',    // 'share' | 'riders'
  topN:   25,
  secondOrder: true,
};

let selectedIndex = null;   // index into data.stations
let data       = null;
let stations   = [];
let simNodes   = [];        // nodes currently in the network (subset of stations)
let simLinks   = [];
let playTimer  = null;
let simulation = null;
let projection = null;

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

// Sequential ramp for "share of the selected station's riders arriving here".
const shareScale = d3.scaleSequential(d3.interpolateYlGnBu);

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

// ── Data load ────────────────────────────────────────────────────────────────
// The borough basemap is optional: it only orients the eye. If it is missing the
// 424 complexes still draw the shape of the system on their own.
Promise.all([
  d3.json('data/subway_network.json'),
  d3.json('data/boroughs.geojson').catch(() => null),
]).then(([net, geo]) => {
  document.getElementById('loading').style.display = 'none';
  data = net;
  stations = net.stations;

  buildLegend();
  buildDatalist();
  buildPeriodControls();
  initControls();
  initMap(geo);
  buildMapLegend();

  // Open on the busiest complex rather than an empty canvas -- the network panel
  // has nothing to show until something is selected.
  const busiest = d3.maxIndex(stations, s => s.out[state.period] + s.in[state.period]);
  select(busiest);
});

// ── Accessors ────────────────────────────────────────────────────────────────
function egoEdges(i) {
  const e = data.ego[String(i)];
  if (!e) return [];
  return e[data.periods[state.period].key] || [];
}

function outTotal(i)  { return stations[i].out[state.period]; }
function inTotal(i)   { return stations[i].in[state.period]; }
function bothTotal(i) { return outTotal(i) + inTotal(i); }

// Edge weight is the share of the ORIGIN station's riders in this period, carried over from
// the state-migration version of this tool. Raw counts would just restate which stations are
// busy; the share says where a station's own riders actually go.
function shareOf(originIndex, riders) {
  const tot = outTotal(originIndex);
  return tot > 0 ? riders / tot : 0;
}

function weightOf(l) { return state.metric === 'share' ? l.share : l.riders; }

// Largest single origin-destination flow anywhere in the current period, used as the map's
// colour domain under the raw-riders metric. Cached: it is a scan of every stored edge.
const maxRidersCache = new Map();
function globalMaxRiders() {
  const key = state.period;
  if (!maxRidersCache.has(key)) {
    let m = 0;
    for (const k in data.ego) {
      for (const [, r] of egoEdges(+k)) if (r > m) m = r;
    }
    maxRidersCache.set(key, m || 1);
  }
  return maxRidersCache.get(key);
}

// ── Network construction ─────────────────────────────────────────────────────
// Nodes = the selected complex plus its top-N destinations. Edges = the selected complex to
// each destination, plus (optionally) edges among the destinations themselves, pulled from
// each destination's own top-N list. The second-order edges are what turn a bare star into a
// graph with readable clusters.
function buildNetwork() {
  if (selectedIndex === null) return { nodes: [], links: [] };

  const top = egoEdges(selectedIndex).slice(0, state.topN);
  const members = new Set([selectedIndex]);
  top.forEach(([j]) => members.add(j));

  const links = [];
  const seen = new Set();
  const addLink = (a, b, riders, primary) => {
    const key = a + '-' + b;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ s: a, t: b, riders, share: shareOf(a, riders), primary });
  };

  top.forEach(([j, riders]) => addLink(selectedIndex, j, riders, true));

  if (state.secondOrder) {
    for (const a of members) {
      if (a === selectedIndex) continue;
      for (const [b, riders] of egoEdges(a)) {
        if (b !== selectedIndex && members.has(b)) addLink(a, b, riders, false);
      }
    }
  }

  const nodes = Array.from(members);
  return { nodes, links };
}

// ── Main render ──────────────────────────────────────────────────────────────
function draw() {
  const { nodes, links } = buildNetwork();
  const { w, h } = dims();

  // Keep positions across redraws so changing period or top-N animates rather than resetting.
  const prev = new Map(simNodes.map(d => [d.index, d]));
  simNodes = nodes.map(i => {
    const p = prev.get(i);
    if (p) return p;
    return {
      index: i,
      x: w / 2 + (Math.random() - 0.5) * 300,
      y: h / 2 + (Math.random() - 0.5) * 300,
    };
  });
  const byIndex = new Map(simNodes.map(d => [d.index, d]));
  simLinks = links.map(l => ({ ...l, source: byIndex.get(l.s), target: byIndex.get(l.t) }));

  const maxWeight = d3.max(simLinks, weightOf) || 1;
  const maxNode   = d3.max(simNodes, d => bothTotal(d.index)) || 1;
  const rScale = d3.scaleSqrt().domain([0, maxNode]).range([3.5, 20]);
  const wScale = d3.scalePow().exponent(0.5).domain([0, maxWeight]).range([0.4, 7]).clamp(true);

  if (!simulation) {
    simulation = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink([]).id(d => d.index).distance(60))
      .force('charge', d3.forceManyBody().strength(-240))
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
    .text(d => shortName(stations[d.index].name));

  simulation.force('collision', d3.forceCollide().radius(d => rScale(bothTotal(d.index)) + 3));
  simulation.force('link')
    .links(simLinks)
    .distance(l => l.primary ? 55 : 95)
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

  // Value painted on the map for every complex: the share of the selected station's riders
  // (or the raw rider estimate) arriving there in this period. Computed from the FULL ego list,
  // not the pruned top-N, so the map shows more than the network does.
  const values = new Map();
  if (sel !== null) {
    for (const [j, riders] of egoEdges(sel)) {
      values.set(j, state.metric === 'share' ? shareOf(sel, riders) : riders);
    }
  }

  // Under 'share' the ramp is rescaled to the selection: share is riders divided by a constant
  // (the origin's own total), so a per-selection domain is the only thing that distinguishes the
  // two metrics at all -- normalized against its own max, a share ramp and a rider ramp are the
  // identical picture. Under 'riders' the domain is instead global to the period, so a quiet
  // station reads as genuinely pale next to a busy one and two selections can be compared.
  const maxVal = state.metric === 'share'
    ? (d3.max(Array.from(values.values())) || 1)
    : globalMaxRiders();
  shareScale.domain([0, maxVal]);
  const colorOf = i => (values.has(i) ? shareScale(values.get(i)) : LAND_COLOR);

  const inNetwork = new Set(simNodes.map(d => d.index));

  // Network nodes keep their trunk-line colour; the selected one is ringed white.
  nodeLayer.selectAll('g.node circle')
    .attr('fill', d => stations[d.index].trunk || DEFAULT_COLOR)
    .attr('stroke', d => d.index === sel ? '#fff' : 'rgba(0,0,0,0.45)')
    .attr('stroke-width', d => d.index === sel ? 3 : 0.9);

  const maxDot = d3.max(stations, (s, i) => bothTotal(i)) || 1;
  const dotR = d3.scaleSqrt().domain([0, maxDot]).range([1.6, 9]);

  dotLayer.selectAll('circle')
    // With nothing selected there is no flow to shade by, so the map falls back to trunk-line
    // colour -- which draws the system as a recognisable subway map rather than a grey field.
    .attr('fill', (s, i) => i === sel ? '#fff'
      : (sel === null ? (s.trunk || DEFAULT_COLOR) : colorOf(i)))
    .attr('r', (s, i) => dotR(bothTotal(i)) * (i === sel ? 1.5 : 1))
    .attr('stroke', (s, i) => i === sel ? '#fff' : (inNetwork.has(i) ? '#eee' : 'rgba(0,0,0,0.5)'))
    .attr('stroke-width', (s, i) => i === sel ? 2 : (inNetwork.has(i) ? 1.1 : 0.4))
    .attr('opacity', (s, i) => (sel === null || i === sel || values.has(i)) ? 1 : 0.25);

  updateMapLegend(0, maxVal);
  updateSubtitles();
}

function updateSubtitles() {
  const p = data.periods[state.period].label;
  if (selectedIndex === null) {
    document.getElementById('network-sub').textContent = 'Select a station complex.';
    document.getElementById('map-sub').textContent = '';
    return;
  }
  const name = stations[selectedIndex].name;
  document.getElementById('network-sub').textContent =
    'Top ' + state.topN + ' destinations from ' + name + ' · ' + p;
  document.getElementById('map-sub').textContent =
    'All 424 complexes, shaded by flow from ' + name;
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
  const s = stations[i];
  const p = data.periods[state.period].label;
  let html = '<strong>' + s.name.replace(/\s*\([^()]*\)\s*$/, '') + '</strong><br>' +
    '<span class="routes">' + (s.routes || []).join(' · ') + ' · ' + p + '</span><br>' +
    '<span class="num">Boardings: ' + fmt(outTotal(i)) + '<br>' +
    'Arrivals: ' + fmt(inTotal(i)) + '</span>';

  if (selectedIndex !== null && selectedIndex !== i) {
    const edge = egoEdges(selectedIndex).find(([j]) => j === i);
    const back = egoEdges(i).find(([j]) => j === selectedIndex);
    const selName = shortName(stations[selectedIndex].name);
    const thisName = shortName(s.name);
    html += '<hr style="border:none;border-top:1px solid #444;margin:6px 0"><span class="num">';
    html += selName + ' → ' + thisName + ': ' +
      (edge ? fmt1(edge[1]) + ' (' + pct(shareOf(selectedIndex, edge[1])) + ')' : 'below top 50');
    html += '<br>' + thisName + ' → ' + selName + ': ' +
      (back ? fmt1(back[1]) + ' (' + pct(shareOf(i, back[1])) + ')' : 'below top 50');
    html += '</span>';
  }
  tooltip.style('display', 'block').html(html);
  moveTooltip(event);
}

function moveTooltip(event) {
  tooltip.style('left', (event.pageX + 14) + 'px').style('top', (event.pageY - 32) + 'px');
}
function hideTooltip() { tooltip.style('display', 'none'); }

// Station names carry their routes in a trailing parenthesis -- too long for a node label.
function shortName(name) {
  return name.replace(/\s*\([^()]*\)\s*$/, '');
}

// ── Stats ────────────────────────────────────────────────────────────────────
function updateStats() {
  document.getElementById('stat-edges').textContent = fmt(simLinks.length);

  let cov = '—';
  if (selectedIndex !== null) {
    const all = egoEdges(selectedIndex);
    const shown = all.slice(0, state.topN);
    const totShown = d3.sum(shown, d => d[1]);
    const tot = outTotal(selectedIndex);
    if (tot > 0) cov = pct(totShown / tot);
  }
  document.getElementById('stat-coverage').textContent = cov;
  document.getElementById('stat-trips').textContent =
    fmt(d3.sum(stations, (s, i) => outTotal(i)));
}

function updateSelectedReadout() {
  const el = document.getElementById('selected');
  if (selectedIndex === null) {
    el.innerHTML = '<span class="sel-sub">No station selected.</span>';
    return;
  }
  const s = stations[selectedIndex];
  el.innerHTML =
    '<div class="sel-name">' + shortName(s.name) + '</div>' +
    '<div class="sel-sub">' + (s.routes || []).join(' · ') + ' · ' + s.trunk_label + '</div>' +
    '<div class="sel-sub num">' + fmt(outTotal(selectedIndex)) + ' out · ' +
    fmt(inTotal(selectedIndex)) + ' in</div>';
}

// ── Controls ─────────────────────────────────────────────────────────────────
function buildPeriodControls() {
  const box = d3.select('#period-group');
  data.periods.forEach((p, i) => {
    const id = 'per-' + p.key;
    const label = box.append('label');
    label.append('input')
      .attr('type', 'radio').attr('name', 'period').attr('id', id).attr('value', i)
      .property('checked', i === state.period)
      .on('change', function () { setPeriod(+this.value); });
    label.append('span').text(p.label + ' (' + p.n_hours + 'h)');
  });
}

function setPeriod(i) {
  state.period = i;
  document.querySelector('input[name="period"][value="' + i + '"]').checked = true;
  draw();
  updateSelectedReadout();
}

function buildDatalist() {
  const dl = document.getElementById('station-list');
  stations.forEach(s => {
    const o = document.createElement('option');
    o.value = s.name;
    dl.appendChild(o);
  });
}

function initControls() {
  document.getElementById('search').addEventListener('change', function () {
    const i = stations.findIndex(s => s.name === this.value);
    if (i >= 0) select(i);
  });

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
      clearInterval(playTimer); playTimer = null; this.textContent = '▶';
      return;
    }
    this.textContent = '❚❚';
    playTimer = setInterval(() => setPeriod((state.period + 1) % data.periods.length), 1600);
  });

  updateMetricHint();
}

function updateMetricHint() {
  document.getElementById('metric-hint').textContent = state.metric === 'share'
    ? 'Where this station’s own riders go, so small stations read as clearly as big ones. The map ramp rescales to each selection.'
    : 'Raw estimates on one system-wide ramp, so selections are comparable and quiet stations stay pale.';
}

// ── Map ──────────────────────────────────────────────────────────────────────
function initMap(geo) {
  const r = mapContainer.getBoundingClientRect();
  const points = {
    type: 'FeatureCollection',
    features: stations.map(s => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    })),
  };
  // Fit to the station points, not the basemap: the complexes are the subject, and Staten
  // Island's landmass would otherwise push the system into a corner.
  projection = d3.geoMercator().fitSize([r.width * 0.9, r.height * 0.88], points);
  const path = d3.geoPath(projection);

  if (geo) {
    basemapLayer.selectAll('path')
      .data(geo.features)
      .enter().append('path')
      .attr('d', path)
      .attr('fill', BASEMAP_FILL)
      .attr('stroke', BASEMAP_LINE)
      .attr('stroke-width', 0.7)
      .attr('pointer-events', 'none');
  }

  dotLayer.selectAll('circle')
    .data(stations)
    .enter().append('circle')
    .attr('cx', s => projection([s.lon, s.lat])[0])
    .attr('cy', s => projection([s.lon, s.lat])[1])
    .attr('cursor', 'pointer')
    .on('mouseover', function (event, s) { showTooltip(event, stations.indexOf(s)); })
    .on('mousemove', moveTooltip)
    .on('mouseout', hideTooltip)
    .on('click', function (event, s) {
      event.stopPropagation();
      const i = stations.indexOf(s);
      select(i === selectedIndex ? null : i);
    });

  mapSvg.on('click', () => select(null));
  centreMap();

  window.addEventListener('resize', () => {
    const nr = mapContainer.getBoundingClientRect();
    projection.fitSize([nr.width * 0.9, nr.height * 0.88], points);
    basemapLayer.selectAll('path').attr('d', path);
    dotLayer.selectAll('circle')
      .attr('cx', s => projection([s.lon, s.lat])[0])
      .attr('cy', s => projection([s.lon, s.lat])[1]);
    centreMap();
    positionMapLegend();
  });

  function centreMap() {
    const b = mapG.node().getBBox();
    const nr = mapContainer.getBoundingClientRect();
    mapG.attr('transform', 'translate(' +
      ((nr.width - b.width) / 2 - b.x) + ',' +
      ((nr.height - b.height) / 2 - b.y - 6) + ')');
  }
}

function buildMapLegend() {
  const defs = mapSvg.append('defs');
  const grad = defs.append('linearGradient').attr('id', 'grad-share');
  d3.range(0, 1.001, 0.05).forEach(t => {
    grad.append('stop')
      .attr('offset', (t * 100).toFixed(0) + '%')
      .attr('stop-color', d3.interpolateYlGnBu(t));
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
  const label = v => state.metric === 'share' ? pct(v) : fmt(Math.round(v));
  mapSvg.select('.legend-title').text(selectedIndex === null
    ? ''
    : (state.metric === 'share'
        ? 'Share of ' + shortName(stations[selectedIndex].name) + '’s riders'
        : 'Riders from ' + shortName(stations[selectedIndex].name)));
  mapSvg.select('.legend-min').text(label(min));
  mapSvg.select('.legend-max').text(label(max));
}

// ── Legend ───────────────────────────────────────────────────────────────────
function buildLegend() {
  const seen = new Map();
  stations.forEach(s => { if (!seen.has(s.trunk_label)) seen.set(s.trunk_label, s.trunk); });
  const cont = d3.select('#legend');
  Array.from(seen.entries()).forEach(([label, color]) => {
    const row = cont.append('div').attr('class', 'legend-item');
    row.append('div').attr('class', 'swatch').style('background', color);
    row.append('span').text(label);
  });
}
