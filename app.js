(() => {
'use strict';

const SVG = 'http://www.w3.org/2000/svg';
const STORE = 'rodeo-horse-first-v1';
const COLORS = ['#e3aa43','#6aa9f8','#78c28a','#e47972','#b58af2','#61c9c0','#f0995b','#d6d36b'];
const ARENA = { minX: 65, maxX: 935, minY: 65, maxY: 495 };

const ids = ['horseMinus','horsePlus','horseCountLabel','setStartsBtn','doneStartsBtn','horseRoster','selectionSummary','selectAllBtn','selectNoneBtn','selectOddBtn','selectEvenBtn','timingMode','drawBtn','holdBtn','polishBtn','undoBtn','newBtn','saveBtn','exportBtn','routineName','stageInstruction','statusPill','restartBtn','playBtn','arena','arenaSurface','routeLayer','draftLayer','horseLayer','emptyHelp','drawHelp','reviewBar','reviewText','cleanupChoice','retryBtn','useBtn','startModeBanner','actionCount','timeLabel','durationLabel','timeline','actionStrip','toast'];
const els = {};
ids.forEach(id => els[id] = document.getElementById(id));

let state;
let pointerId = null;
let dragHorseId = null;
let toastTimer = 0;

function freshState() {
  const horses = makeHorses(12);
  return {
    horses,
    selected: new Set([1]),
    actions: [],
    timing: 'next',
    cleanup: 'smooth',
    drawing: false,
    pendingRaw: null,
    pendingPreview: null,
    startMode: false,
    time: 0,
    playing: false,
    lastFrame: 0,
    raf: 0,
    name: 'New Routine'
  };
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
function fmtTime(sec) {
  const s = Math.max(0, sec || 0);
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function pathD(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}
function horseById(id) { return state.horses.find(h => h.id === id); }

function defaultStart(index, count) {
  if (count === 1) return { x: 92, y: 280 };
  const rows = Math.min(6, count);
  const row = index % rows;
  const col = Math.floor(index / rows);
  const y = rows === 1 ? 280 : 205 + row * (150 / (rows - 1));
  return { x: 92 + col * 20, y };
}
function makeHorses(count) {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, start: defaultStart(i, count) }));
}

function setHorseCount(next) {
  const count = clamp(Math.round(next), 1, 60);
  const old = state.horses.length;
  if (count === old) return;
  if (count > old) {
    for (let i = old; i < count; i++) state.horses.push({ id: i + 1, start: defaultStart(i, count) });
  } else {
    const keep = new Set(Array.from({ length: count }, (_, i) => i + 1));
    state.horses = state.horses.filter(h => keep.has(h.id));
    state.selected = new Set([...state.selected].filter(id => keep.has(id)));
    state.actions = state.actions.map(action => {
      const horseIds = action.horseIds.filter(id => keep.has(id));
      const paths = {};
      horseIds.forEach(id => { if (action.paths && action.paths[id]) paths[id] = action.paths[id]; });
      return { ...action, horseIds, paths };
    }).filter(action => action.horseIds.length);
  }
  if (!state.selected.size && state.horses[0]) state.selected.add(state.horses[0].id);
  state.time = 0;
  stopPlayback();
  renderAll();
}

function totalDuration() {
  return state.actions.reduce((m, a) => Math.max(m, a.start + a.duration), 0);
}
function sortedActionsForHorse(id) {
  return state.actions.filter(a => a.horseIds.includes(id)).slice().sort((a, b) => a.start - b.start || a.id - b.id);
}
function meta(points) {
  const cum = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) { total += dist(points[i - 1], points[i]); cum.push(total); }
  return { points, cum, total };
}
function pointOn(points, progress) {
  if (!points || !points.length) return { x: 92, y: 280, angle: 0 };
  if (points.length === 1) return { ...points[0], angle: 0 };
  const m = meta(points);
  if (m.total < 0.001) return { ...points[0], angle: 0 };
  const target = clamp(progress, 0, 1) * m.total;
  let i = 1;
  while (i < m.cum.length && m.cum[i] < target) i++;
  i = Math.min(i, points.length - 1);
  const a = points[i - 1], b = points[i];
  const base = m.cum[i - 1];
  const len = Math.max(0.001, m.cum[i] - base);
  const t = (target - base) / len;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI };
}
function poseAt(horseId, time) {
  const horse = horseById(horseId);
  let current = horse ? { ...horse.start, angle: 90 } : { x: 92, y: 280, angle: 90 };
  for (const action of sortedActionsForHorse(horseId)) {
    if (time < action.start) return current;
    const end = action.start + action.duration;
    if (action.type === 'hold') { if (time <= end) return current; continue; }
    const points = action.paths[horseId];
    if (!points || !points.length) continue;
    if (time <= end) return pointOn(points, (time - action.start) / Math.max(0.001, action.duration));
    const last = points[points.length - 1], prev = points[Math.max(0, points.length - 2)];
    current = { x: last.x, y: last.y, angle: Math.atan2(last.y - prev.y, last.x - prev.x) * 180 / Math.PI };
  }
  return current;
}

function resolveStart() {
  if (!state.actions.length) return 0;
  if (state.timing === 'same') return state.actions[state.actions.length - 1].start;
  return totalDuration();
}
function intervalConflict(horseIds, start, duration) {
  const end = start + duration;
  return state.actions.some(a => {
    if (!a.horseIds.some(id => horseIds.includes(id))) return false;
    const aEnd = a.start + a.duration;
    return start < aEnd - 0.01 && end > a.start + 0.01;
  });
}

function simplifyRdp(points, epsilon = 2.5) {
  if (points.length < 3) return points.slice();
  const first = points[0], last = points[points.length - 1];
  const dx = last.x - first.x, dy = last.y - first.y;
  const denom = Math.hypot(dx, dy) || 1;
  let max = 0, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const d = Math.abs(dy * p.x - dx * p.y + last.x * first.y - last.y * first.x) / denom;
    if (d > max) { max = d; idx = i; }
  }
  if (max > epsilon) {
    const left = simplifyRdp(points.slice(0, idx + 1), epsilon);
    const right = simplifyRdp(points.slice(idx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}
function chaikin(points, passes = 2) {
  let out = points.slice();
  for (let p = 0; p < passes; p++) {
    if (out.length < 3) break;
    const next = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i], b = out[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}
function smoothPath(points) { return points.length < 3 ? points.slice() : chaikin(simplifyRdp(points, 2.8), 2); }
function straightPath(points) { return points.length ? [points[0], points[points.length - 1]] : []; }
function nearStraight(points) {
  if (points.length < 3) return true;
  const a = points[0], b = points[points.length - 1], chord = dist(a, b);
  if (chord < 20) return false;
  let path = 0, maxDev = 0;
  const dx = b.x - a.x, dy = b.y - a.y, denom = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < points.length; i++) path += dist(points[i - 1], points[i]);
  for (const p of points) maxDev = Math.max(maxDev, Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / denom);
  return maxDev <= 18 || path / chord <= 1.07;
}
function cleanupGuide(points, mode) { return mode === 'raw' ? points.slice() : mode === 'straight' ? straightPath(points) : smoothPath(points); }

function selectedIds() { return [...state.selected].sort((a, b) => a - b); }
function selectionLabel(ids = selectedIds()) {
  if (!ids.length) return 'No horses selected';
  if (ids.length === 1) return `Horse ${ids[0]} selected`;
  if (ids.length <= 5) return `Horses ${ids.join(', ')} selected`;
  return `${ids.length} horses selected`;
}
function actionHorseLabel(ids) {
  if (ids.length === 1) return `Horse ${ids[0]}`;
  if (ids.length <= 4) return `Horses ${ids.join(', ')}`;
  if (ids.length === state.horses.length) return `All ${ids.length} horses`;
  return `${ids.length} horses`;
}
function guideForPreview() { return state.pendingRaw ? cleanupGuide(state.pendingRaw, state.cleanup) : []; }
function translatedPathsForSelected() {
  const guide = guideForPreview();
  if (guide.length < 2) return null;
  const origin = guide[0], start = resolveStart(), paths = {};
  for (const id of selectedIds()) {
    const base = poseAt(id, start);
    paths[id] = guide.map(p => ({ x: clamp(base.x + (p.x - origin.x), ARENA.minX, ARENA.maxX), y: clamp(base.y + (p.y - origin.y), ARENA.minY, ARENA.maxY) }));
  }
  return { start, paths };
}
function moveDuration(paths) {
  let longest = 0;
  Object.values(paths).forEach(points => { longest = Math.max(longest, meta(points).total); });
  return clamp(longest / 46, 1.2, 20);
}
function addPendingMove() {
  const ids = selectedIds();
  if (!ids.length || !state.pendingRaw) return;
  const built = translatedPathsForSelected();
  if (!built) return;
  const duration = moveDuration(built.paths);
  if (intervalConflict(ids, built.start, duration)) { showToast('One of those horses already has an action at that time. Use “After previous” or select different horses.'); return; }
  state.actions.push({ id: Date.now() + Math.random(), type: 'move', horseIds: ids, start: built.start, duration, paths: built.paths, cleanup: state.cleanup, polished: false });
  state.name = 'My Rodeo Routine'; state.time = built.start; clearDrawing(); renderAll(); showToast(`${actionHorseLabel(ids)} movement added`);
}
function addHold() {
  const ids = selectedIds();
  if (!ids.length) { showToast('Select at least one horse first'); return; }
  const start = resolveStart(), duration = 5;
  if (intervalConflict(ids, start, duration)) { showToast('One of those horses is already moving at that time'); return; }
  state.actions.push({ id: Date.now() + Math.random(), type: 'hold', horseIds: ids, start, duration, paths: {}, cleanup: 'hold', polished: true });
  state.name = 'My Rodeo Routine'; state.time = start; stopPlayback(); renderAll(); showToast(`${actionHorseLabel(ids)} will hold for 5 seconds`);
}
function polishWholeRoutine() {
  let count = 0;
  state.actions.forEach(action => {
    if (action.type !== 'move') return;
    for (const id of action.horseIds) { const points = action.paths[id]; action.paths[id] = nearStraight(points) ? straightPath(points) : smoothPath(points); }
    action.cleanup = 'polished'; action.polished = true; count++;
  });
  renderAll(); showToast(count ? 'Routine polished' : 'Add a movement first');
}

function clearDrawing() {
  state.drawing = false; state.pendingRaw = null; state.pendingPreview = null; pointerId = null;
  els.reviewBar.classList.add('hidden'); els.drawHelp.classList.add('hidden'); els.drawBtn.classList.remove('active'); els.draftLayer.replaceChildren();
}
function beginDraw() {
  if (!state.selected.size) { showToast('Select the horse or horses that should move'); return; }
  if (state.startMode) return;
  stopPlayback(); state.drawing = true; state.pendingRaw = null; state.cleanup = 'smooth';
  els.reviewBar.classList.add('hidden'); els.drawHelp.classList.remove('hidden'); els.drawBtn.classList.add('active');
  els.statusPill.textContent = `Drawing for ${selectionLabel().replace(' selected','')}`;
  els.stageInstruction.textContent = 'Draw anywhere in the arena. Only the selected horses will receive this movement.'; els.draftLayer.replaceChildren();
}
function finishStroke() {
  pointerId = null;
  if (!state.pendingRaw || state.pendingRaw.length < 3 || dist(state.pendingRaw[0], state.pendingRaw[state.pendingRaw.length - 1]) < 8) {
    state.pendingRaw = null; showToast('Draw a little farther'); renderDraft(); return;
  }
  state.drawing = false; els.drawHelp.classList.add('hidden'); els.drawBtn.classList.remove('active'); els.reviewBar.classList.remove('hidden'); setCleanup('smooth');
  els.statusPill.textContent = 'Review movement'; els.stageInstruction.textContent = 'Choose Raw, Smooth, or Perfect Straight, then use the move.';
}
function setCleanup(mode) {
  state.cleanup = mode;
  document.querySelectorAll('#cleanupChoice button').forEach(b => b.classList.toggle('active', b.dataset.cleanup === mode));
  els.reviewText.textContent = mode === 'raw' ? 'Keeps your exact finger path.' : mode === 'straight' ? 'Uses only the start and end point for a perfectly straight run.' : 'Removes shaky finger movement but keeps the shape you drew.';
  renderDraft();
}
function renderDraft() {
  els.draftLayer.replaceChildren();
  if (!state.pendingRaw || state.pendingRaw.length < 2) return;
  if (state.drawing) { els.draftLayer.appendChild(svgEl('path', { d: pathD(state.pendingRaw), class: 'draft-path' })); return; }
  const built = translatedPathsForSelected(); if (!built) return;
  for (const [id, points] of Object.entries(built.paths)) els.draftLayer.appendChild(svgEl('path', { d: pathD(points), class: 'draft-copy', stroke: COLORS[(Number(id) - 1) % COLORS.length] }));
}

function renderRoutes() {
  els.routeLayer.replaceChildren();
  const selected = state.selected;
  state.actions.forEach(action => {
    if (action.type !== 'move') return;
    action.horseIds.forEach(id => {
      const points = action.paths[id]; if (!points || points.length < 2) return;
      els.routeLayer.appendChild(svgEl('path', { d: pathD(points), class: `route-path${selected.has(id) ? ' selected' : ''}`, stroke: COLORS[(id - 1) % COLORS.length] }));
    });
  });
}
function renderHorses() {
  els.horseLayer.replaceChildren();
  for (const horse of state.horses) {
    const p = poseAt(horse.id, state.time);
    const g = svgEl('g', { class: `horse${state.selected.has(horse.id) ? ' selected' : ''}`, transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${(p.angle || 0) + 90})`, 'data-horse-id': horse.id });
    const ring = svgEl('circle', { cx: 0, cy: 0, r: 16, class: 'select-ring' });
    const body = svgEl('ellipse', { cx: 0, cy: 0, rx: 8, ry: 12, class: 'body' });
    const head = svgEl('circle', { cx: 0, cy: -13, r: 4, class: 'head' });
    const num = svgEl('text', { x: 0, y: 0.5, class: 'num' }); num.textContent = horse.id;
    g.append(ring, body, head, num); els.horseLayer.appendChild(g);
  }
}
function renderRoster() {
  els.horseRoster.replaceChildren();
  state.horses.forEach(h => { const b = document.createElement('button'); b.textContent = h.id; b.dataset.horseId = h.id; b.className = state.selected.has(h.id) ? 'active' : ''; els.horseRoster.appendChild(b); });
}
function renderActionStrip() {
  els.actionStrip.replaceChildren();
  if (!state.actions.length) els.actionStrip.innerHTML = '<div class="empty-action">Actions appear here. Each card says exactly which horses move.</div>';
  else state.actions.forEach((action, index) => {
    const card = document.createElement('div'); card.className = 'action-card'; card.dataset.actionId = action.id;
    const kind = action.type === 'hold' ? '5-sec hold' : action.polished ? 'polished move' : `${action.cleanup} move`;
    card.innerHTML = `<strong>${index + 1}. ${actionHorseLabel(action.horseIds)}</strong><span>${fmtTime(action.start)} · ${kind}</span><em>${action.start === (state.actions[index - 1]?.start ?? -1) ? 'same time' : 'next'}</em><button aria-label="Delete action">×</button>`;
    els.actionStrip.appendChild(card);
  });
  els.actionCount.textContent = `${state.actions.length} action${state.actions.length === 1 ? '' : 's'}`;
}
function renderSelection() {
  els.selectionSummary.textContent = selectionLabel(); els.drawBtn.classList.toggle('disabled', !state.selected.size); els.horseCountLabel.textContent = state.horses.length;
  const ids = selectedIds();
  if (state.startMode) els.stageInstruction.textContent = 'Drag any horse to set its starting spot.';
  else if (state.drawing) els.stageInstruction.textContent = 'Draw anywhere in the arena. Only the selected horses will receive this movement.';
  else if (state.pendingRaw) els.stageInstruction.textContent = 'Choose how the movement should be cleaned up.';
  else if (ids.length === 1) els.stageInstruction.textContent = `Horse ${ids[0]} is selected. Draw a move and only Horse ${ids[0]} will do it.`;
  else if (ids.length) els.stageInstruction.textContent = `${ids.length} horses selected. The next action applies only to those horses.`;
  else els.stageInstruction.textContent = 'Tap a horse in the arena or roster to select it.';
}
function renderTimeline() {
  const duration = totalDuration(); state.time = clamp(state.time, 0, duration || 0); els.timeline.max = Math.max(0.01, duration); els.timeline.value = state.time; els.timeLabel.textContent = fmtTime(state.time); els.durationLabel.textContent = fmtTime(duration);
}
function renderAll() {
  renderRoster(); renderSelection(); renderRoutes(); renderHorses(); renderDraft(); renderActionStrip(); renderTimeline();
  document.querySelectorAll('#timingMode button').forEach(b => b.classList.toggle('active', b.dataset.timing === state.timing));
  els.emptyHelp.classList.toggle('hidden', state.actions.length > 0 || state.drawing || !!state.pendingRaw || state.startMode);
  els.startModeBanner.classList.toggle('hidden', !state.startMode); els.setStartsBtn.textContent = state.startMode ? 'Setting starting spots…' : 'Set starting spots';
  els.statusPill.textContent = state.startMode ? 'Setting starts' : state.drawing ? 'Drawing' : state.pendingRaw ? 'Review movement' : state.actions.length ? `${state.selected.size} selected` : 'Ready';
  els.playBtn.innerHTML = state.playing ? '❚❚ <span>PAUSE</span>' : '▶ <span>PLAY</span>';
}
function toggleHorse(id, additive = true) { if (!additive) state.selected.clear(); if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id); renderAll(); }
function setSelection(ids) { state.selected = new Set(ids.filter(id => horseById(id))); renderAll(); }

function arenaPoint(evt) {
  const pt = els.arena.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY; const m = els.arena.getScreenCTM(); if (!m) return { x: 500, y: 280 };
  const p = pt.matrixTransform(m.inverse()); return { x: clamp(p.x, ARENA.minX, ARENA.maxX), y: clamp(p.y, ARENA.minY, ARENA.maxY) };
}
function nearestHorse(point, atTime = state.time) {
  let best = null, bestD = Infinity;
  state.horses.forEach(h => { const p = state.startMode ? h.start : poseAt(h.id, atTime); const d = dist(point, p); if (d < bestD) { bestD = d; best = h; } });
  return bestD <= 24 ? best : null;
}
function onArenaPointerDown(evt) {
  if (state.playing) return;
  const p = arenaPoint(evt);
  if (state.startMode) { const horse = nearestHorse(p, 0); if (!horse) return; dragHorseId = horse.id; pointerId = evt.pointerId; els.arenaSurface.setPointerCapture?.(evt.pointerId); return; }
  if (!state.drawing) { pointerId = evt.pointerId; return; }
  pointerId = evt.pointerId; state.pendingRaw = [p]; els.arenaSurface.setPointerCapture?.(evt.pointerId); renderDraft();
}
function onArenaPointerMove(evt) {
  if (evt.pointerId !== pointerId) return;
  const p = arenaPoint(evt);
  if (state.startMode && dragHorseId) { const horse = horseById(dragHorseId); if (horse) horse.start = p; renderHorses(); return; }
  if (!state.drawing || !state.pendingRaw) return;
  const last = state.pendingRaw[state.pendingRaw.length - 1]; if (dist(last, p) >= 2) state.pendingRaw.push(p); renderDraft();
}
function onArenaPointerUp(evt) {
  const p = arenaPoint(evt);
  if (state.startMode) { dragHorseId = null; pointerId = null; return; }
  if (state.drawing && state.pendingRaw) { const last = state.pendingRaw[state.pendingRaw.length - 1]; if (dist(last, p) >= 2) state.pendingRaw.push(p); finishStroke(); return; }
  if (evt.pointerId === pointerId) { const horse = nearestHorse(p); pointerId = null; if (horse) toggleHorse(horse.id); }
}
function startPositionMode() {
  if (state.actions.length) { showToast('Starting spots can be changed before the first action. Use New to reset them.'); return; }
  clearDrawing(); state.startMode = true; stopPlayback(); renderAll();
}
function stopPositionMode() { state.startMode = false; dragHorseId = null; pointerId = null; renderAll(); }

function stopPlayback() { state.playing = false; if (state.raf) cancelAnimationFrame(state.raf); state.raf = 0; }
function togglePlay() {
  const duration = totalDuration(); if (!duration) { showToast('Add an action first'); return; }
  if (state.playing) { stopPlayback(); renderAll(); return; }
  clearDrawing(); if (state.time >= duration - 0.02) state.time = 0; state.playing = true; state.lastFrame = performance.now(); tick(state.lastFrame); renderAll();
}
function tick(now) {
  if (!state.playing) return; state.time += (now - state.lastFrame) / 1000; state.lastFrame = now; const duration = totalDuration(); if (state.time >= duration) { state.time = duration; stopPlayback(); }
  renderHorses(); els.timeline.value = state.time; els.timeLabel.textContent = fmtTime(state.time); els.playBtn.innerHTML = state.playing ? '❚❚ <span>PAUSE</span>' : '▶ <span>PLAY</span>'; if (state.playing) state.raf = requestAnimationFrame(tick);
}
function deleteAction(id) { stopPlayback(); state.actions = state.actions.filter(a => a.id !== id); state.time = 0; renderAll(); }
function undoLast() { if (!state.actions.length) return; stopPlayback(); state.actions.pop(); state.time = 0; renderAll(); }

function saveRoutine() {
  const data = { version: 1, name: state.name, horses: state.horses, actions: state.actions, timing: state.timing };
  localStorage.setItem(STORE, JSON.stringify(data)); showToast('Routine saved on this device');
}
function loadRoutine() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE) || 'null'); if (!d || !Array.isArray(d.horses)) return false; state = freshState();
    state.horses = d.horses.map(h => ({ id: Number(h.id), start: { x: Number(h.start.x), y: Number(h.start.y) } })); state.actions = Array.isArray(d.actions) ? d.actions : []; state.name = d.name || 'Saved Routine'; state.timing = d.timing === 'same' ? 'same' : 'next'; state.selected = new Set(state.horses[0] ? [state.horses[0].id] : []); return true;
  } catch { return false; }
}
function exportRoutine() {
  const data = { version: 1, name: state.name, horses: state.horses, actions: state.actions };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'rodeo-routine.json'; a.click(); URL.revokeObjectURL(url); showToast('Routine exported');
}
function newRoutine() { stopPlayback(); state = freshState(); renderAll(); showToast('Started a blank horse-first routine'); }
function showToast(msg) { els.toast.textContent = msg; els.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200); }

els.horseMinus.addEventListener('click', () => setHorseCount(state.horses.length - 1));
els.horsePlus.addEventListener('click', () => setHorseCount(state.horses.length + 1));
els.setStartsBtn.addEventListener('click', startPositionMode); els.doneStartsBtn.addEventListener('click', stopPositionMode);
els.selectAllBtn.addEventListener('click', () => setSelection(state.horses.map(h => h.id))); els.selectNoneBtn.addEventListener('click', () => setSelection([])); els.selectOddBtn.addEventListener('click', () => setSelection(state.horses.filter(h => h.id % 2).map(h => h.id))); els.selectEvenBtn.addEventListener('click', () => setSelection(state.horses.filter(h => !(h.id % 2)).map(h => h.id)));
els.horseRoster.addEventListener('click', evt => { const b = evt.target.closest('[data-horse-id]'); if (b) toggleHorse(Number(b.dataset.horseId)); });
els.timingMode.addEventListener('click', evt => { const b = evt.target.closest('[data-timing]'); if (!b) return; state.timing = b.dataset.timing; renderAll(); });
els.drawBtn.addEventListener('click', beginDraw); els.holdBtn.addEventListener('click', addHold);
els.cleanupChoice.addEventListener('click', evt => { const b = evt.target.closest('[data-cleanup]'); if (b) setCleanup(b.dataset.cleanup); });
els.retryBtn.addEventListener('click', beginDraw); els.useBtn.addEventListener('click', addPendingMove); els.polishBtn.addEventListener('click', polishWholeRoutine); els.undoBtn.addEventListener('click', undoLast);
els.newBtn.addEventListener('click', newRoutine); els.saveBtn.addEventListener('click', saveRoutine); els.exportBtn.addEventListener('click', exportRoutine);
els.restartBtn.addEventListener('click', () => { stopPlayback(); state.time = 0; renderAll(); }); els.playBtn.addEventListener('click', togglePlay);
els.timeline.addEventListener('input', () => { stopPlayback(); state.time = Number(els.timeline.value) || 0; renderHorses(); els.timeLabel.textContent = fmtTime(state.time); els.playBtn.innerHTML = '▶ <span>PLAY</span>'; });
els.actionStrip.addEventListener('click', evt => { const card = evt.target.closest('[data-action-id]'); if (!card) return; const action = state.actions.find(a => String(a.id) === card.dataset.actionId); if (!action) return; if (evt.target.closest('button')) { deleteAction(action.id); return; } stopPlayback(); state.time = action.start; renderAll(); });
els.arenaSurface.addEventListener('pointerdown', onArenaPointerDown); els.arenaSurface.addEventListener('pointermove', onArenaPointerMove); els.arenaSurface.addEventListener('pointerup', onArenaPointerUp); els.arenaSurface.addEventListener('pointercancel', () => { pointerId = null; dragHorseId = null; });

state = freshState(); loadRoutine(); renderAll();
})();