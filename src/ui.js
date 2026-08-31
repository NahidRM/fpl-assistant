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

export function renderWeights(container, weights, onChange) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
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
      onChange(key, Number(event.target.value));
    });
    container.appendChild(wrapper);
  }
}

export function renderTable(head, body, rows, sortKey, onSort) {
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
