// ── Config ──────────────────────────────────────────────────────────────────
const API_URL = 'https://meetcheck-proxy.oscarsa85.workers.dev';
const MODEL = 'anthropic/claude-haiku-4-5';
const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
let DEV_MODE = false;

const CURRENCY_SYMBOLS = { EUR: '€', USD: '$' };

// ── Header tagline rotation — one picked at random per page load ────────────
const TAGLINES = [
  'Know before you accept.',
  'Could this have been an email?',
  'Your calendar has a price tag.',
  'Stop guessing if it\'s worth your hour.',
  'The meeting is free. Your time isn\'t.',
  'Paste the invite. Get the verdict.',
  'Built by a PM who\'s done the math.',
  'Not every meeting deserves a room.',
];

function startTaglineRotation() {
  const el = document.getElementById('header-tagline');
  if (!el) return;
  el.textContent = TAGLINES[Math.floor(Math.random() * TAGLINES.length)];
}

const LOADING_MESSAGES = [
  'Reading the room...',
  'Checking for an agenda...',
  'Doing the math on your time...',
  'Judging this meeting...',
  'Looking for a reason this needs to be live...',
  'Adding up everyone\'s hourly rate...',
  'Deciding if this could\'ve been an email...',
  'Weighing the invite against your calendar...',
];

// ── Mock verdicts — used only in Dev mode (localhost), no API call ──────────
const MOCK_VERDICTS = [
  {
    has_agenda: { value: true, reason: '3 topics listed with owners' },
    has_objective: { value: true, reason: 'Vendor decision due by Friday' },
    could_be_async: { value: false, reason: 'Needs live back-and-forth to decide' },
    duration_matches_scope: { value: true, reason: '45 min fits a 3-topic decision' },
    verdict: 'green', verdict_title: 'This one earns its slot',
    verdict_reason: 'Clear agenda, clear decision to make. Worth the room.'
  },
  {
    has_agenda: { value: true, reason: 'Topics listed, no order or owners' },
    has_objective: { value: false, reason: 'Body says "align" — no clear ask' },
    could_be_async: { value: true, reason: 'A shared doc could cover this' },
    duration_matches_scope: { value: true, reason: '30 min is fine for the topics listed' },
    verdict: 'amber', verdict_title: 'Trim it or tighten it',
    verdict_reason: 'There\'s an agenda, but no clear decision at the end. Could work as a shorter, focused session.'
  },
  {
    has_agenda: { value: false, reason: 'No topics or structure in the body' },
    has_objective: { value: true, reason: 'Reads as a one-way status update' },
    could_be_async: { value: true, reason: 'Nothing here needs a live room' },
    duration_matches_scope: { value: true, reason: 'Duration is short, at least' },
    verdict: 'red', verdict_title: 'This could have been an email',
    verdict_reason: 'No agenda attached, and the body reads like a status update — nothing here requires people in a room.'
  },
  {
    has_agenda: { value: true, reason: 'Clear topic and decision point' },
    has_objective: { value: true, reason: 'Sign-off needed on the proposal' },
    could_be_async: { value: false, reason: 'Sign-off needs live discussion' },
    duration_matches_scope: { value: false, reason: '60 min for a 2-line update' },
    verdict: 'amber', verdict_title: 'Good meeting, wrong length',
    verdict_reason: 'Agenda and decision are both there — but an hour for a two-line update is generous. Try 20 minutes.'
  },
];
let mockIndex = 0;

// ── DOM refs ────────────────────────────────────────────────────────────────
const formSection = document.getElementById('form-section');
const loadingSection = document.getElementById('loading-section');
const resultSection = document.getElementById('result-section');
const errorSection = document.getElementById('error-section');
const loadingText = document.getElementById('loading-text');

const subjectInput = document.getElementById('subject');
const bodyInput = document.getElementById('body');
const attendeesInput = document.getElementById('attendees');
const durationInput = document.getElementById('duration');
const rateInput = document.getElementById('rate');
const currencySelect = document.getElementById('currency');
const submitBtn = document.getElementById('submit-btn');

document.getElementById('reset-btn').addEventListener('click', resetForm);
document.getElementById('error-reset-btn').addEventListener('click', resetForm);
submitBtn.addEventListener('click', handleSubmit);

startTaglineRotation();

// ── Theme toggle ──────────────────────────────────────────────────────────────
const themeToggle = document.getElementById('theme-toggle');
const savedTheme = localStorage.getItem('meetcheck-theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
updateThemeButton(savedTheme);

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('meetcheck-theme', next);
  updateThemeButton(next);
});

function updateThemeButton(theme) {
  themeToggle.textContent = theme === 'dark' ? '☀ Light' : '☾ Dark';
}

// ── Dev mode toggle — visible only on localhost ──────────────────────────────
if (isLocalhost) {
  const toggle = document.getElementById('dev-mode-toggle');
  toggle.hidden = false;
  document.getElementById('dev-mode-checkbox').addEventListener('change', (e) => {
    DEV_MODE = e.target.checked;
  });
}

// ── Escaping helper — never trust text going into innerHTML ──────────────────
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ── Loading message rotation — random pick each tick, so even a fast (mock) ──
// response shows a different message per run instead of always the first one.
let loadingInterval = null;
function pickLoadingMessage() {
  return LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
}
function startLoadingRotation() {
  loadingText.textContent = pickLoadingMessage();
  loadingInterval = setInterval(() => {
    loadingText.textContent = pickLoadingMessage();
  }, 1600);
}
function stopLoadingRotation() {
  clearInterval(loadingInterval);
  loadingInterval = null;
}

// ── View state ──────────────────────────────────────────────────────────────
function showSection(section) {
  formSection.hidden = section !== 'form';
  loadingSection.hidden = section !== 'loading';
  resultSection.hidden = section !== 'result';
  errorSection.hidden = section !== 'error';
}

function resetForm() {
  showSection('form');
}

// ── Cost calculation ───────────────────────────────────────────────────────
function calculateCost(attendees, durationMinutes, ratePerHour) {
  const hours = durationMinutes / 60;
  return attendees * hours * ratePerHour;
}

function formatCost(amount, currency) {
  const symbol = CURRENCY_SYMBOLS[currency] || '€';
  return `${symbol}${amount.toFixed(0)}`;
}

// ── Prompt ──────────────────────────────────────────────────────────────────
function buildPrompt(subject, body, durationMinutes) {
  return `You are evaluating whether a meeting is well-structured, based only on its calendar invite (subject + body) and its scheduled duration. Be direct and a little sharp — you're not scoring the person who wrote it, you're judging the meeting itself.

Subject: ${subject || '(no subject provided)'}
Body:
${body || '(no body provided)'}
Scheduled duration: ${durationMinutes} minutes

Return ONLY a JSON object with this exact shape, no markdown fences, no commentary:

{
  "has_agenda": { "value": true or false, "reason": "max 60 characters, specific to this invite" },
  "has_objective": { "value": true or false, "reason": "max 60 characters, specific to this invite" },
  "could_be_async": { "value": true or false, "reason": "max 60 characters, specific to this invite" },
  "duration_matches_scope": { "value": true or false, "reason": "max 60 characters, specific to this invite" },
  "verdict": "green" or "amber" or "red",
  "verdict_title": "a short punchy verdict headline, max 8 words",
  "verdict_reason": "one or two sentences explaining the verdict, direct tone, max 240 characters"
}

Each "reason" must reference something specific from THIS invite (a phrase, a missing element, the duration itself) — never a generic restatement of the label. Keep them short enough to sit as a one-line caption under each check.

Rules for duration_matches_scope: false if the duration is clearly mismatched with what the subject/body describe — e.g. 60+ minutes for a "quick sync" or one-line status update, or 15 minutes for something that names a decision, negotiation, or multi-topic agenda. true if the duration is reasonable for the described scope, or if there isn't enough content to judge (don't penalize a thin invite twice — that's what has_agenda/has_objective are for).

Rules for verdict:
- "green": has a clear agenda AND a clear decision/outcome to reach AND the duration matches the scope. This meeting earns its place on the calendar.
- "amber": has some structure but is missing agenda or objective, or the duration is off — improvable, not indefensible.
- "red": no agenda, no clear objective, or the content could obviously be resolved async (a status update, an FYI, a one-way announcement).

If the body is empty or extremely thin, lean toward "red" — an invite that can't explain itself in writing usually doesn't need a room.`;
}

// ── API call ────────────────────────────────────────────────────────────────
async function getVerdict(subject, body, durationMinutes) {
  if (DEV_MODE) {
    await new Promise((r) => setTimeout(r, 1400));
    const verdict = MOCK_VERDICTS[mockIndex];
    mockIndex = (mockIndex + 1) % MOCK_VERDICTS.length;
    return verdict;
  }

  // Sent as text/plain (not application/json) so the browser treats this as a
  // CORS "simple request" and skips the OPTIONS preflight — some corporate
  // proxies (e.g. Netskope TLS inspection) mangle the preflight to *.workers.dev
  // and break it. The Worker still parses the body as JSON either way.
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: buildPrompt(subject, body, durationMinutes) }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${response.status}`);
  }

  const data = await response.json();
  let text = data.choices[0].message.content.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(text);
}

// ── Render result ───────────────────────────────────────────────────────────
function renderResult(verdict, cost, currency, attendees, durationMinutes, ratePerHour) {
  const card = document.getElementById('verdict-card');
  card.className = `verdict-card verdict-${verdict.verdict}`;

  const badge = document.getElementById('verdict-badge');
  const badgeIcons = { green: '✓', amber: '!', red: '✕' };
  badge.textContent = badgeIcons[verdict.verdict] || '?';

  document.getElementById('verdict-title').textContent = verdict.verdict_title || '';
  document.getElementById('verdict-reason').textContent = verdict.verdict_reason || '';

  document.getElementById('cost-amount').textContent = formatCost(cost, currency);
  const symbol = CURRENCY_SYMBOLS[currency] || '€';
  document.getElementById('cost-breakdown').textContent =
    `${attendees} attendee${attendees === 1 ? '' : 's'} × ${durationMinutes} min × ${symbol}${ratePerHour}/h`;

  setCheckRow('check-agenda', verdict.has_agenda.value, verdict.has_agenda.reason);
  setCheckRow('check-objective', verdict.has_objective.value, verdict.has_objective.reason);
  setCheckRow('check-async', !verdict.could_be_async.value, verdict.could_be_async.reason);
  setCheckRow('check-duration', verdict.duration_matches_scope.value, verdict.duration_matches_scope.reason);

  showSection('result');
}

function setCheckRow(id, isPositive, reason) {
  const row = document.getElementById(id);
  row.classList.remove('yes', 'no');
  row.classList.add(isPositive ? 'yes' : 'no');
  row.querySelector('.check-icon').innerHTML = isPositive ? '✓' : '✕';
  const reasonEl = row.querySelector('.check-reason');
  if (reasonEl) reasonEl.textContent = reason || '';
}

// ── Submit handler ──────────────────────────────────────────────────────────
async function handleSubmit() {
  const subject = subjectInput.value.trim();
  const body = bodyInput.value.trim();
  const attendees = Math.max(1, parseInt(attendeesInput.value, 10) || 1);
  const duration = Math.max(5, parseInt(durationInput.value, 10) || 30);
  const rate = Math.max(1, parseFloat(rateInput.value) || 75);
  const currency = currencySelect.value;

  if (!subject && !body) {
    showError('Paste at least a subject or a body — we need something to judge.');
    return;
  }

  showSection('loading');
  startLoadingRotation();

  try {
    const verdict = await getVerdict(subject, body, duration);
    const cost = calculateCost(attendees, duration, rate);
    stopLoadingRotation();
    renderResult(verdict, cost, currency, attendees, duration, rate);
  } catch (err) {
    stopLoadingRotation();
    showError(err.message || 'Something went wrong. Try again in a moment.');
  }
}

function showError(message) {
  document.getElementById('error-text').textContent = message;
  showSection('error');
}
