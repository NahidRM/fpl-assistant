import { GK, DEF, MID, FWD, DEFAULT_WEIGHTS, DEFAULT_HORIZON, FIXTURE_HORIZONS, SHRINK_K } from './config.js';
import { buildBoard } from './board.js';
import { renderBanner, renderTabs, renderTable, renderWeights } from './ui.js';

const POSITIONS = [GK, DEF, MID, FWD];
const TIMEFRAMES = [
  { key: 'season', label: 'Season to date' },
  { key: 'last4', label: 'Last 4 GWs' },
  { key: 'last2', label: 'Last 2 GWs' },
];

const state = {
  payload: null,
  position: MID,
  weights: structuredClone(DEFAULT_WEIGHTS),
  horizon: DEFAULT_HORIZON,
  timeframe: 'season',
  shrinkK: SHRINK_K,
  hideUnavailable: true,
  minMinutes: 0,
  maxPrice: 15.0,
  sortKey: 'score',
};

const el = (id) => document.getElementById(id);

async function load() {
  // Cache-bust: the Pages CDN will otherwise serve stale JSON after a refresh (spec 7).
  const response = await fetch(`data/players.json?v=${Date.now()}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function baselinePoints(player, teamMatches) {
  return teamMatches > 0 ? player.total_points / teamMatches : 0;
}

function visibleRows() {
  const board = buildBoard(state.payload, state.position, state.weights[state.position], state.horizon, state.shrinkK);
  const teams = new Map(state.payload.teams.map((t) => [t.id, t.short_name]));
  const matches = state.payload.team_matches_played || {};

  // Outliers are measured against players who actually feature, at 3 SD not 2.
  // Measured on live data: xP is right-skewed, so 2 SD flagged 16 of 231 midfielders —
  // most of the visible board — which makes the badge meaningless. 3 SD flags 0-2.
  const playing = board.filter((r) => r.expectedMinutes > 0).map((r) => r.xp);
  const mean = playing.reduce((a, b) => a + b, 0) / (playing.length || 1);
  const sd = Math.sqrt(playing.reduce((a, b) => a + (b - mean) ** 2, 0) / (playing.length || 1));

  return board
    .map((row) => {
      const teamMatches = Number(matches[row.team] ?? 0);
      return {
        ...row,
        teamName: teams.get(row.team) ?? '?',
        valuePerMillion: row.xp / row.price,
        baseline: baselinePoints(row, teamMatches),
        isOutlier: sd > 0 && row.xp > mean + 3 * sd,
      };
    })
    .filter((row) => {
      if (state.hideUnavailable && row.status !== 'a') return false;
      if (row.expectedMinutes < state.minMinutes) return false;
      if (row.price > state.maxPrice) return false;
      if (state.timeframe !== 'season' && !row[state.timeframe]) return false;
      return true;
    })
    .sort((a, b) => (b[state.sortKey] ?? 0) - (a[state.sortKey] ?? 0));
}

function render() {
  renderTabs(el('tabs'), POSITIONS, state.position, (position) => {
    state.position = position;
    render();
  });
  renderWeights(el('weights'), state.weights[state.position], (key, value) => {
    state.weights[state.position][key] = value;
    render();
  });
  renderTable(el('board-head'), el('board-body'), visibleRows(), state.sortKey, (key) => {
    state.sortKey = key;
    render();
  });
  el('footer-note').textContent =
    'Scores are percentiles within position, so they are not comparable across tabs. ' +
    'This model has not been shown to predict better than simple heuristics — see the README.';
}

function wireControls() {
  const horizon = el('horizon');
  horizon.innerHTML = FIXTURE_HORIZONS.map((n) => `<option value="${n}">${n} GWs</option>`).join('');
  horizon.value = String(state.horizon);
  horizon.addEventListener('change', () => { state.horizon = Number(horizon.value); render(); });

  const timeframe = el('timeframe');
  timeframe.innerHTML = TIMEFRAMES.map((t) => `<option value="${t.key}">${t.label}</option>`).join('');
  timeframe.addEventListener('change', () => { state.timeframe = timeframe.value; render(); });

  el('hide-unavailable').addEventListener('change', (event) => {
    state.hideUnavailable = event.target.checked;
    render();
  });

  el('min-minutes').addEventListener('input', (event) => {
    state.minMinutes = Number(event.target.value);
    el('min-minutes-value').textContent = event.target.value;
    render();
  });

  el('max-price').addEventListener('input', (event) => {
    state.maxPrice = Number(event.target.value) / 10;
    el('max-price-value').textContent = state.maxPrice.toFixed(1);
    render();
  });

  const shrinkK = el('shrink-k');
  shrinkK.value = String(state.shrinkK);
  el('shrink-k-value').textContent = String(state.shrinkK);
  shrinkK.addEventListener('input', (event) => {
    state.shrinkK = Number(event.target.value);
    el('shrink-k-value').textContent = event.target.value;
    render();
  });

  el('reset-weights').addEventListener('click', () => {
    state.weights[state.position] = { ...DEFAULT_WEIGHTS[state.position] };
    render();
  });
}

async function main() {
  try {
    state.payload = await load();
  } catch (error) {
    renderBanner(el('status-banner'), null, error.message);
    return;
  }
  renderBanner(el('status-banner'), state.payload, null);
  wireControls();
  render();
}

main();
