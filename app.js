// ─── CSV Parsers ──────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.split('\n');
  if (!lines.length) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = parseCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => { row[h] = (vals[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === '\t' && !inQ) {
      result.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function parseCSVComma(text) {
  const lines = text.split('\n');
  if (!lines.length) return [];
  const headers = parseCSVLineComma(lines[0]).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = parseCSVLineComma(line);
    const row = {};
    headers.forEach((h, idx) => { row[h] = (vals[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

function parseCSVLineComma(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      result.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

// ─── State ────────────────────────────────────────────────────────────────────
let examFiles = {};   // title -> CSV file name in data/
let exams = {};       // title -> parsed rows, filled lazily by loadExam()
let currentExam = null;
let currentYear = null;
let currentMode = 'practice';
let currentQuestions = [];
let currentOrder = [];  // indices into getFilteredByExamAndYear(), kept so a saved attempt can be rebuilt
let userAnswers = {};
let timerInterval = null;
let timerSeconds = 0;
let examSubmitted = false;
let lastScoreData = null;
let examTitles = [];

// ─── Init ─────────────────────────────────────────────────────────────────────
window.onload = () => {
  fetch('data/index.json')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(index => {
      loadIndex(index);
      showResumeBanner();
      // Hide loading state, show content with a smooth fade-in
      document.getElementById('loading-state').style.display = 'none';
      const content = document.getElementById('content-ready');
      content.classList.remove('hidden');
      content.style.animation = 'fadeUp .35s ease';
    })
    .catch(err => {
      document.getElementById('loading-state').innerHTML =
        `<div style="width:100%;padding:14px 18px;background:#fce8e6;border-radius:8px;border-left:4px solid #ba0517;font-weight:700;color:#ba0517;">
          ⚠️ Could not load data/index.json — make sure the data folder is next to index.html and served over HTTP. (${err.message})
        </div>`;
    });
};

function loadIndex(index) {
  examFiles = {};
  index.forEach(e => { examFiles[e.title] = e.file; });
  exams = {};
  examTitles = Object.keys(examFiles);
  renderOptions('exam', examTitles, '');
}

function parseRows(text) {
  const firstLine = text.split('\n')[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  return tabCount > commaCount ? parseCSV(text) : parseCSVComma(text);
}

// Fetch one exam's CSV on first use and cache the parsed rows.
async function loadExam(title) {
  if (exams[title]) return exams[title];
  const res = await fetch('data/' + encodeURIComponent(examFiles[title]));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  exams[title] = parseRows((await res.text()).replace(/^﻿/, ''));
  return exams[title];
}

// ─── Helper: extract year from created_at ─────────────────────────────────────
function extractYear(row) {
  const raw = (row['created_at'] || '').trim();
  if (!raw) return null;
  const m = raw.match(/(\d{4})/);
  return m ? m[1] : null;
}

// ─── Step navigation ──────────────────────────────────────────────────────────
function setPillState(step) {
  for (let i = 1; i <= 3; i++) {
    const pill = document.getElementById(`pill-${i}`);
    if (!pill) continue;
    pill.classList.remove('active', 'done');
    if (i < step) pill.classList.add('done');
    else if (i === step) pill.classList.add('active');
  }
}

// ─── Searchable Dropdown ───────────────────────────────────────────────────────
let openDropdownId = null;
let dropdownHighlightIndex = {};

function toggleDropdown(id) {
  const trigger = document.getElementById(`${id}-trigger`);
  const dropdown = document.getElementById(`${id}-dropdown`);
  const input = document.getElementById(`${id}-search-input`);
  if (!trigger || !dropdown) return;

  const isOpen = dropdown.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen) {
    trigger.classList.add('open');
    dropdown.classList.add('open');
    openDropdownId = id;
    if (input) { input.value = ''; filterOptions(id, ''); setTimeout(() => input.focus(), 50); }
  }
}

function closeAllDropdowns() {
  ['exam'].forEach(id => {
    const t = document.getElementById(`${id}-trigger`);
    const d = document.getElementById(`${id}-dropdown`);
    if (t) t.classList.remove('open');
    if (d) d.classList.remove('open');
  });
  openDropdownId = null;
  dropdownHighlightIndex = {};
}

function filterOptions(id, query) {
  if (id === 'exam') {
    const filtered = examTitles.filter(t => t.toLowerCase().includes(query.toLowerCase()));
    renderOptions('exam', filtered, query);
  }
  dropdownHighlightIndex[id] = -1;
}

function renderOptions(id, titles, query) {
  const list = document.getElementById(`${id}-options-list`);
  if (!list) return;
  const currentVal = id === 'exam' ? currentExam : null;
  if (!titles.length) {
    list.innerHTML = '<div class="search-select-empty">No options found</div>';
    return;
  }
  list.innerHTML = titles.map((title, i) => {
    const display = query ? highlight(title, query) : escapeHtml(title);
    const isSel = title === currentVal ? ' selected' : '';
    return `<div class="search-select-option${isSel}" data-value="${escapeAttr(title)}"
      onclick="onDropdownSelect('${id}', '${escapeAttr(title)}')">${display}</div>`;
  }).join('');
}

function onDropdownSelect(id, value) {
  if (id === 'exam') {
    currentExam = value;
    const el = document.getElementById('exam-trigger-text');
    el.textContent = value.length > 72 ? value.substring(0, 72) + '…' : value;
    el.classList.remove('placeholder');
    closeAllDropdowns();
    return onExamSelected();
  }
}

function handleSearchKey(e, id) {
  const list = document.getElementById(`${id}-options-list`);
  const opts = list ? list.querySelectorAll('.search-select-option') : [];
  if (!opts.length) return;
  let hi = dropdownHighlightIndex[id] || -1;

  if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(hi + 1, opts.length - 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(hi - 1, 0); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (hi >= 0 && opts[hi]) opts[hi].click();
    else if (opts.length === 1) opts[0].click();
    return;
  } else if (e.key === 'Escape') { closeAllDropdowns(); return; }

  dropdownHighlightIndex[id] = hi;
  opts.forEach((o, i) => {
    o.classList.toggle('highlighted', i === hi);
    if (i === hi) o.scrollIntoView({ block: 'nearest' });
  });
}

document.addEventListener('click', (e) => {
  const wrap = document.getElementById('exam-search-select');
  if (wrap && !wrap.contains(e.target)) closeAllDropdowns();
});

// ─── After Exam Selected ──────────────────────────────────────────────────────
async function onExamSelected() {
  currentYear = null;

  document.getElementById('step-year').classList.remove('hidden');
  document.getElementById('step-options').classList.add('hidden');

  setPillState(2);

  const grid = document.getElementById('year-grid');
  const exam = currentExam;
  let rows;
  try {
    if (!exams[exam]) grid.innerHTML = '<div class="locked-field">Loading questions…</div>';
    rows = await loadExam(exam);
  } catch (err) {
    if (exam === currentExam) grid.innerHTML = `<div class="locked-field">⚠️ Could not load data/${escapeHtml(examFiles[exam])} (${escapeHtml(err.message)})</div>`;
    return;
  }
  if (exam !== currentExam) return; // user picked another exam while this one was loading

  const yearMap = {};
  rows.forEach(r => {
    const y = extractYear(r);
    if (y) yearMap[y] = (yearMap[y] || 0) + 1;
  });

  const years = Object.keys(yearMap).sort();

  if (!years.length) {
    grid.innerHTML = '<div class="locked-field">⚠️ No <code>created_at</code> data found — skipping year filter.</div>';
    currentYear = '__all__';
    onYearSelected();
    return;
  }

  grid.innerHTML = `
    <button class="year-btn" id="year-btn-__all__" onclick="selectYear('__all__')">
      All
      <span class="year-count">${rows.length} Qs</span>
    </button>
  ` + years.map(y => `
    <button class="year-btn" id="year-btn-${y}" onclick="selectYear('${y}')">
      ${y}
      <span class="year-count">${yearMap[y]} Qs</span>
    </button>
  `).join('');

  setTimeout(() => document.getElementById('step-year').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

function selectYear(year) {
  currentYear = year;

  document.querySelectorAll('.year-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`year-btn-${year}`);
  if (btn) btn.classList.add('active');

  document.getElementById('step-options').classList.remove('hidden');
  setPillState(3);
  showOptionsForYear();
}

function getFilteredByExamAndYear() {
  const rows = exams[currentExam] || [];
  if (currentYear === '__all__') return rows;
  return rows.filter(r => extractYear(r) === currentYear);
}

function showOptionsForYear() {
  const qs = getFilteredByExamAndYear();
  const types = { single: 0, multi: 0, open: 0 };
  qs.forEach(q => { const t = getQType(q); types[t]++; });

  document.getElementById('stats-row').innerHTML = `
    <div class="stat-chip"><span class="dot"></span>${qs.length} Questions</div>
    ${types.single ? `<div class="stat-chip"><span class="dot" style="background:#1967d2"></span>${types.single} Single</div>` : ''}
    ${types.multi ? `<div class="stat-chip"><span class="dot" style="background:#c5221f"></span>${types.multi} Multi</div>` : ''}
    ${types.open ? `<div class="stat-chip"><span class="dot" style="background:#b06000"></span>${types.open} Open</div>` : ''}
  `;
  document.getElementById('exam-stats-row').style.display = 'block';

  const examShort = currentExam.length > 48 ? currentExam.substring(0, 48) + '…' : currentExam;
  document.getElementById('selection-summary').innerHTML = `
    <span class="crumb"><span class="crumb-label">Exam</span>${escapeHtml(examShort)}</span>
    <span class="crumb-sep">›</span>
    <span class="crumb"><span class="crumb-label">Year</span>${currentYear === '__all__' ? 'All Years' : currentYear}</span>
  `;

  setTimeout(() => document.getElementById('step-options').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

// ─── Mode ─────────────────────────────────────────────────────────────────────
function selectMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
}

// ─── Start Exam ───────────────────────────────────────────────────────────────
function startExam() {
  if (!currentExam || !currentYear) return;

  let order = [...getFilteredByExamAndYear().keys()];
  if (document.getElementById('randomize-cb').checked) {
    order = order.sort(() => Math.random() - 0.5);
  }
  beginExam(order, {}, 0);
}

// Shared by a fresh start and a resumed attempt.
function beginExam(order, answers, seconds) {
  if (timerInterval) clearInterval(timerInterval);
  const rows = getFilteredByExamAndYear();
  currentOrder = order;
  currentQuestions = order.map(i => rows[i]);
  userAnswers = answers;
  examSubmitted = false;
  timerSeconds = seconds;

  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('exam-screen').style.display = 'block';
  document.getElementById('score-screen').style.display = 'none';

  const yearLabel = currentYear === '__all__' ? 'All Years' : currentYear;
  document.getElementById('topbar-title').textContent =
    `${currentExam.length > 40 ? currentExam.substring(0,40)+'…' : currentExam} · ${yearLabel}`;

  const badge = document.getElementById('mode-badge');
  badge.textContent = currentMode === 'practice' ? 'Practice' : 'Exam';
  badge.className = 'mode-badge ' + currentMode;

  const timerEl = document.getElementById('timer');
  if (currentMode === 'exam') {
    timerEl.style.display = 'block';
    timerEl.textContent = formatTime(timerSeconds);
    timerEl.classList.add('running');
    timerInterval = setInterval(() => {
      timerSeconds++;
      timerEl.textContent = formatTime(timerSeconds);
      saveProgress();
    }, 1000);
  } else {
    timerEl.style.display = 'none';
    if (timerInterval) clearInterval(timerInterval);
  }

  document.getElementById('submit-btn').textContent = currentMode === 'practice' ? 'Finish & See Results' : 'Submit Exam ✓';

  renderQuestions();
  restoreAnswersToDom();
  updateProgress();
  saveProgress();
  window.scrollTo(0, 0);
}

function restoreAnswersToDom() {
  Object.keys(userAnswers).forEach(idx => {
    const ans = userAnswers[idx] || [];
    if (!ans.length) return;
    const textarea = document.getElementById(`open-${idx}`);
    if (textarea) textarea.value = ans[0];
    else ans.forEach(label => {
      const el = document.getElementById(`opt-${idx}-${label}`);
      if (el) el.classList.add('selected');
    });
    const card = document.getElementById(`qcard-${idx}`);
    if (card) card.classList.add('answered');
  });
}

// ─── Saved progress (localStorage) ────────────────────────────────────────────
const PROGRESS_KEY = 'sf-exam-prep:progress';

function saveProgress() {
  if (examSubmitted) return;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({
      exam: currentExam,
      year: currentYear,
      mode: currentMode,
      total: getFilteredByExamAndYear().length,
      order: currentOrder,
      answers: userAnswers,
      seconds: timerSeconds,
      savedAt: Date.now(),
    }));
  } catch (e) { /* storage full or blocked — progress just isn't saved */ }
}

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY));
    return saved && examFiles[saved.exam] ? saved : null;
  } catch (e) { return null; }
}

function clearProgress() {
  try { localStorage.removeItem(PROGRESS_KEY); } catch (e) {}
}

function showResumeBanner() {
  const banner = document.getElementById('resume-banner');
  const saved = loadProgress();
  if (!saved) { banner.classList.add('hidden'); return; }
  const answered = Object.values(saved.answers || {}).filter(a => a && a.length).length;
  const yearLabel = saved.year === '__all__' ? 'All Years' : saved.year;
  const examShort = saved.exam.length > 48 ? saved.exam.substring(0, 48) + '…' : saved.exam;
  document.getElementById('resume-info').innerHTML = `
    ⏸ Unfinished attempt: ${escapeHtml(examShort)} · ${escapeHtml(yearLabel)}
    <small>${answered} / ${saved.order.length} answered · ${saved.mode === 'exam' ? 'Exam' : 'Practice'} mode · saved ${new Date(saved.savedAt).toLocaleString()}</small>
  `;
  banner.classList.remove('hidden');
}

async function resumeProgress() {
  const saved = loadProgress();
  if (!saved) return showResumeBanner();

  await onDropdownSelect('exam', saved.exam);
  if (!exams[saved.exam]) return; // CSV failed to load; onExamSelected already shows the error
  selectYear(saved.year);
  selectMode(saved.mode);

  // The question bank changed since the attempt was saved — indices no longer match.
  if (getFilteredByExamAndYear().length !== saved.total) {
    alert('This exam\'s question bank has changed since your attempt was saved, so it can\'t be resumed.');
    discardProgress();
    return;
  }
  beginExam(saved.order, saved.answers || {}, saved.seconds || 0);
}

function discardProgress() {
  clearProgress();
  showResumeBanner();
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

// ─── Render Questions ─────────────────────────────────────────────────────────
function renderQuestions() {
  const container = document.getElementById('questions-container');
  container.innerHTML = '';

  currentQuestions.forEach((q, idx) => {
    const qtype = getQType(q);
    const opts = getOptions(q);
    const card = document.createElement('div');
    card.className = 'question-card';
    card.id = `qcard-${idx}`;

    const typeLabel = qtype === 'single' ? 'Single Choice' : qtype === 'multi' ? 'Multi Choice' : 'Open Ended';
    const year = extractYear(q) || '—';

    let optionsHTML = '';
    if (qtype === 'single' || qtype === 'multi') {
      optionsHTML = `<div class="options-list" id="opts-${idx}">` +
        opts.map(o => `
          <div class="option-item" id="opt-${idx}-${o.label}" onclick="selectOption(${idx}, '${o.label}', '${qtype}')">
            <div class="${qtype === 'single' ? 'option-circle' : 'option-checkbox'}">${qtype === 'single' ? o.label : ''}</div>
            <div class="option-text">${o.text}</div>
          </div>
        `).join('') +
      `</div>`;
    } else {
      optionsHTML = `<textarea class="open-textarea" id="open-${idx}" placeholder="Type your answer here…" oninput="saveOpenAnswer(${idx}, this.value)"></textarea>`;
    }

    let actionsHTML = '';
    if (currentMode === 'practice') {
      actionsHTML = `
        <div class="card-actions">
          <button class="show-answer-btn" onclick="toggleAnswer(${idx})">💡 Show Answer</button>
        </div>
        <div class="answer-reveal" id="answer-reveal-${idx}">
          <div class="answer-label">Correct Answer</div>
          <div>${formatAnswer(q, opts)}</div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="question-meta">
        <div class="q-num">${idx + 1}</div>
        <div class="q-topic">Topic ${q['topic_number'] || '—'}</div>
        <div class="q-date">· ${year}</div>
        <div class="q-type-badge ${qtype}">${typeLabel}</div>
      </div>
      <div class="question-text">${(q['question'] || '').replace(/<br\s*\/?>/gi, '<br>')}</div>
      ${optionsHTML}
      ${actionsHTML}
      <div class="result-feedback" id="result-${idx}"></div>
    `;

    container.appendChild(card);
  });
}

function formatAnswer(q, opts) {
  const ans = (q['suggested_answer'] || '').trim();
  const ansArr = ans.split(',').map(a => a.trim());
  const parts = ansArr.map(a => {
    const opt = opts.find(o => o.label === a);
    return opt ? `<strong>${a}:</strong> ${opt.text}` : `<strong>${a}</strong>`;
  });
  return parts.join('<br>') || ans;
}

function toggleAnswer(idx) {
  const el = document.getElementById(`answer-reveal-${idx}`);
  el.classList.toggle('visible');
  const btn = el.previousElementSibling.querySelector('.show-answer-btn');
  btn.textContent = el.classList.contains('visible') ? '🙈 Hide Answer' : '💡 Show Answer';
}

// ─── Selection ────────────────────────────────────────────────────────────────
function selectOption(qIdx, label, qtype) {
  if (examSubmitted) return;
  if (!userAnswers[qIdx]) userAnswers[qIdx] = [];

  if (qtype === 'single') {
    if (userAnswers[qIdx].length) {
      const old = userAnswers[qIdx][0];
      const el = document.getElementById(`opt-${qIdx}-${old}`);
      if (el) el.classList.remove('selected');
    }
    userAnswers[qIdx] = [label];
    document.getElementById(`opt-${qIdx}-${label}`).classList.add('selected');
  } else {
    const existing = userAnswers[qIdx].indexOf(label);
    if (existing > -1) {
      userAnswers[qIdx].splice(existing, 1);
      document.getElementById(`opt-${qIdx}-${label}`).classList.remove('selected');
    } else {
      userAnswers[qIdx].push(label);
      document.getElementById(`opt-${qIdx}-${label}`).classList.add('selected');
    }
  }

  const card = document.getElementById(`qcard-${qIdx}`);
  if (userAnswers[qIdx].length > 0) card.classList.add('answered');
  else card.classList.remove('answered');
  updateProgress();
  saveProgress();
}

function saveOpenAnswer(qIdx, val) {
  userAnswers[qIdx] = val ? [val] : [];
  const card = document.getElementById(`qcard-${qIdx}`);
  if (val.trim()) card.classList.add('answered');
  else card.classList.remove('answered');
  updateProgress();
  saveProgress();
}

function updateProgress() {
  const total = currentQuestions.length;
  const answered = Object.keys(userAnswers).filter(k => userAnswers[k] && userAnswers[k].length > 0).length;
  document.getElementById('progress-text').textContent = `${answered} / ${total}`;
  document.getElementById('progress-bar').style.width = `${total ? (answered / total * 100) : 0}%`;
}

// ─── Submit ───────────────────────────────────────────────────────────────────
function submitExam() {
  if (timerInterval) clearInterval(timerInterval);
  document.getElementById('timer').classList.remove('running');
  examSubmitted = true;
  clearProgress();

  let correct = 0, total = 0;

  currentQuestions.forEach((q, idx) => {
    const qtype = getQType(q);
    const opts = getOptions(q);
    if (qtype === 'open') return;

    total++;
    const correct_ans = (q['suggested_answer'] || '').split(',').map(a => a.trim()).sort();
    const user_ans = (userAnswers[idx] || []).sort();
    const isCorrect = JSON.stringify(correct_ans) === JSON.stringify(user_ans);
    if (isCorrect) correct++;

    opts.forEach(o => {
      const el = document.getElementById(`opt-${idx}-${o.label}`);
      if (!el) return;
      el.classList.add('disabled');
      el.style.pointerEvents = 'none';
      if (correct_ans.includes(o.label)) el.classList.add('correct-answer');
      else if ((userAnswers[idx] || []).includes(o.label)) el.classList.add('wrong-answer');
    });

    const card = document.getElementById(`qcard-${idx}`);
    card.classList.remove('answered');
    card.classList.add(isCorrect ? 'correct' : 'incorrect');

    const fb = document.getElementById(`result-${idx}`);
    fb.className = `result-feedback visible ${isCorrect ? 'correct' : 'incorrect'}`;
    fb.innerHTML = isCorrect
      ? `<span>✅</span> Correct!`
      : `<span>❌</span> Incorrect — Correct answer: <strong>${correct_ans.join(', ')}</strong>`;

    if (currentMode === 'practice') {
      const ar = document.getElementById(`answer-reveal-${idx}`);
      if (ar) ar.classList.add('visible');
    }
  });

  document.querySelectorAll('.open-textarea').forEach(t => { t.disabled = true; });

  const pct = total > 0 ? Math.round(correct / total * 100) : 0;
  lastScoreData = { correct, total, pct, time: timerSeconds };
  setTimeout(() => showScore(correct, total, pct, timerSeconds), 600);
}

function showScore(correct, total, pct, time) {
  document.getElementById('exam-screen').style.display = 'none';
  document.getElementById('score-screen').style.display = 'block';
  window.scrollTo(0, 0);

  document.getElementById('score-fraction').textContent = `${correct} / ${total}`;
  document.getElementById('score-pct').textContent = `${pct}%`;
  document.getElementById('sd-correct').textContent = correct;
  document.getElementById('sd-wrong').textContent = total - correct;
  document.getElementById('sd-time').textContent = formatTime(time);
  document.getElementById('score-circle').style.setProperty('--pct', `${pct}%`);

  const msg = document.getElementById('score-message');
  if (pct >= 80) { msg.textContent = '🎉 Excellent! You passed!'; msg.className = 'score-message pass'; }
  else if (pct >= 60) { msg.textContent = '👍 Good effort! Keep studying.'; msg.className = 'score-message fail'; }
  else { msg.textContent = '📚 Keep practicing — you\'ll get there!'; msg.className = 'score-message fail'; }
}

function retakeExam() {
  document.getElementById('score-screen').style.display = 'none';
  startExam();
}

function reviewExam() {
  document.getElementById('score-screen').style.display = 'none';
  document.getElementById('exam-screen').style.display = 'block';
  window.scrollTo(0, 0);
}

function goBack() {
  if (timerInterval) clearInterval(timerInterval);
  document.getElementById('exam-screen').style.display = 'none';
  document.getElementById('score-screen').style.display = 'none';
  document.getElementById('setup-screen').style.display = 'block';
  showResumeBanner();
  window.scrollTo(0, 0);
}

// ─── Question helpers ─────────────────────────────────────────────────────────
function getQType(q) {
  const ans = (q['suggested_answer'] || '').trim();
  if (ans.includes(',')) return 'multi';
  if (/^[A-F]$/.test(ans)) return 'single';
  if (q['option_A']) {
    if (ans.includes(',')) return 'multi';
    if (/^[A-F]$/.test(ans)) return 'single';
  }
  return 'open';
}

function getOptions(q) {
  const keys = ['option_A','option_B','option_C','option_D','option_E','option_F'];
  const labels = ['A','B','C','D','E','F'];
  const opts = [];
  keys.forEach((k, i) => {
    if (q[k] && q[k].trim()) opts.push({ label: labels[i], text: q[k].trim() });
  });
  return opts;
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function highlight(text, query) {
  const escaped = escapeHtml(text);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(`(${escapedQuery})`, 'gi'), '<mark>$1</mark>');
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeAttr(s) {
  return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
