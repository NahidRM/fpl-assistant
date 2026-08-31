import { COMPONENTS, POSITION_NAMES, NOISY_UNTIL_GAMEWEEK } from './config.js';

const LABELS = {
  attack: 'Attack', defence: 'Defence', minutes: 'Minutes',
  fixture: 'Fixtures', form: 'Form', setPieces: 'Set pieces',
};

const COLUMNS = [
  // name and teamName come from the same untrusted API payload as news, so they
  // are escaped too. Numeric columns are safe: toFixed/String cannot emit markup.
  { key: 'name', label: 'Player', format: (r) => escapeHtml(r.name) + badges(r) },
  { key: 'teamName', label: 'Team', format: (r) => escapeHtml(r.teamName) },
  { key: 'price', label: 'Price', format: (r) => r.price.toFixed(1) },
  { key: 'score', label: 'Score', format: (r) => r.score.toFixed(3) },
  { key: 'xp', label: 'xP/match', format: (r) => r.xp.toFixed(2) },
  { key: 'valuePerMillion', label: 'xP per £m', format: (r) => r.valuePerMillion.toFixed(3) },
  { key: 'expectedMinutes', label: 'Exp mins', format: (r) => r.expectedMinutes.toFixed(0) },
  { key: 'minutes', label: 'Mins', format: (r) => String(r.minutes) },
  { key: 'form', label: 'Form', format: (r) => r.form.toFixed(1) },
  { key: 'xgi90', label: 'xGI/90', format: (r) => r.xgi90.toFixed(2) },
  { key: 'dc90', label: 'DC/90', format: (r) => r.dc90.toFixed(1) },
  { key: 'baseline', label: 'Pts/match', format: (r) => r.baseline.toFixed(2) },
];

function badges(row) {
  let out = '';
  if (row.status !== 'a') {
    const label = row.chance_of_playing === null ? 'OUT' : row.chance_of_playing + '%';
    const cls = row.chance_of_playing === null ? 'out' : 'doubt';
    out += ` <span class="badge ${cls}" title="${escapeHtml(row.news || '')}">${label}</span>`;
  }
  if (row.isOutlier) out += ' <span class="badge outlier" title="More than 3 SD above the position field">outlier</span>';
  return out;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Type-aware sort comparator for board rows.
 *
 * The original inline `(b[key] ?? 0) - (a[key] ?? 0)` returns NaN for string
 * columns (name, teamName), leaving Array.sort in undefined order while the
 * column header falsely claims aria-sort="descending".  This function sorts
 * numbers descending and strings A→Z, so every clickable header actually works.
 *
 * Exported so it can be unit-tested without a DOM.
 */
export function compareRows(a, b, key) {
  const av = a[key] ?? 0;
  const bv = b[key] ?? 0;
  if (typeof av === 'string' || typeof bv === 'string') {
    return String(av).localeCompare(String(bv));
  }
  return bv - av;
}

export function renderTabs(container, positions, active, onSelect) {
  container.innerHTML = '';
  for (const position of positions) {
    const button = document.createElement('button');
    button.textContent = POSITION_NAMES[position];
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(position === active));
    button.addEventListener('click', () => onSelect(position));
    container.appendChild(button);
  }
}

/**
 * Render the six weight sliders.
 *
 * On the first call (empty container) the DOM is built and event listeners are
 * attached once.  On every subsequent call — triggered by each slider tick —
 * only the input values and percentage labels are updated in place.
 *
 * The old code did `container.innerHTML = ''` on every call, which destroyed
 * the slider node the user was actively dragging, breaking pointer capture and
 * stalling the drag mid-track.  Browser-verified: the same drag reached max on
 * a stable node but stalled at 80/100 on a rebuilt one.
 *
 * The event listener captures `container._onChange` (set fresh on every call)
 * rather than the `onChange` argument at construction time, so the correct
 * callback is always invoked even after re-renders or position switches.
 */
export function renderWeights(container, weights, onChange) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;

  // Store the current callback so listeners always call the latest version,
  // even though the listener itself is only attached once.
  container._onChange = onChange;

  const existing = container.querySelectorAll('input[data-key]');
  if (!existing.length) {
    // First call: build DOM and attach listeners once.
    container.innerHTML = '';
    for (const key of COMPONENTS) {
      const wrapper = document.createElement('div');
      wrapper.className = 'weight';
      const effective = ((weights[key] / total) * 100).toFixed(0);
      wrapper.innerHTML =
        `<label>${LABELS[key]}` +
        `<input type="range" min="0" max="100" value="${weights[key]}" data-key="${key}">` +
        `<span class="pct">${effective}%</span></label>`;
      wrapper.querySelector('input').addEventListener('input', (event) => {
        container._onChange(event.target.dataset.key, Number(event.target.value));
      });
      container.appendChild(wrapper);
    }
    return;
  }

  // Subsequent calls: update values and percentage labels without touching nodes.
  for (const input of existing) {
    const key = input.dataset.key;
    input.value = String(weights[key]);
    input.nextElementSibling.textContent = ((weights[key] / total) * 100).toFixed(0) + '%';
  }
}

/**
 * Render the board table.
 *
 * When `rows` is empty, a full-width message row is shown instead of a blank
 * tbody — a silent empty table was indistinguishable from a loading failure.
 * The caller supplies `emptyMessage` so context-specific text can be shown
 * (e.g. "no snapshot data yet" vs "no players match your filters").
 */
export function renderTable(head, body, rows, sortKey, onSort,
  emptyMessage = 'No players match the current filters.') {
  head.innerHTML = '';
  const headRow = document.createElement('tr');
  for (const column of COLUMNS) {
    const th = document.createElement('th');
    th.textContent = column.label;
    if (column.key === sortKey) th.setAttribute('aria-sort', 'descending');
    th.addEventListener('click', () => onSort(column.key));
    headRow.appendChild(th);
  }
  head.appendChild(headRow);

  body.innerHTML = '';

  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = COLUMNS.length;
    td.className = 'empty-message';
    td.textContent = emptyMessage;
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const column of COLUMNS) {
      const td = document.createElement('td');
      td.innerHTML = column.format(row);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

export function renderBanner(element, payload, error) {
  element.classList.toggle('error', Boolean(error));
  if (error) {
    element.textContent = `Could not load player data: ${error}. The board cannot be shown.`;
    return;
  }
  const parts = [`Updated ${new Date(payload.generated_at).toLocaleString()}`];
  if (payload.current_gameweek !== null && payload.current_gameweek < NOISY_UNTIL_GAMEWEEK) {
    parts.push(`Only ${payload.current_gameweek} gameweek(s) played — treat rankings as noisy.`);
  }
  if (!payload.data_checked) parts.push('Latest gameweek is provisional; bonus points may change.');
  element.textContent = parts.join(' · ');
}
