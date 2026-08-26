(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ARENA = {
    x: 52,
    y: 52,
    width: 896,
    height: 456,
    lengthFt: 200,
    widthFt: 100,
  };
  const STORAGE_KEY = 'rodeo-drill-designer-v1';
  const ROUTE_COLORS = ['#f0b84e', '#60a5fa', '#ef6f6c', '#65c18c', '#b78cff', '#f28cc5', '#50c8c6', '#f39c5a'];

  const $ = (id) => document.getElementById(id);
  const els = {
    drillName: $('drillName'),
    addLineBtn: $('addLineBtn'),
    addLineEmptyBtn: $('addLineEmptyBtn'),
    lineList: $('lineList'),
    noSelection: $('noSelection'),
    lineEditor: $('lineEditor'),
    editorTitle: $('editorTitle'),
    lineName: $('lineName'),
    lineColor: $('lineColor'),
    horseCount: $('horseCount'),
    startDelay: $('startDelay'),
    lineSpeed: $('lineSpeed'),
    horseSpacing: $('horseSpacing'),
    drawSegmentBtn: $('drawSegmentBtn'),
    holdSeconds: $('holdSeconds'),
    addHoldBtn: $('addHoldBtn'),
    sequenceList: $('sequenceList'),
    stepCount: $('stepCount'),
    deleteLineBtn: $('deleteLineBtn'),
    clearLineBtn: $('clearLineBtn'),
    undoBtn: $('undoBtn'),
    routeLayer: $('routeLayer'),
    draftLayer: $('draftLayer'),
    horseLayer: $('horseLayer'),
    arena: $('arena'),
    interactionSurface: $('interactionSurface'),
    drawHint: $('drawHint'),
    emptyArena: $('emptyArena'),
    playBtn: $('playBtn'),
    restartBtn: $('restartBtn'),
    timeline: $('timeline'),
    timeLabel: $('timeLabel'),
    durationLabel: $('durationLabel'),
    playbackRate: $('playbackRate'),
    distanceStat: $('distanceStat'),
    lineTimeStat: $('lineTimeStat'),
    holdsStat: $('holdsStat'),
    teamStat: $('teamStat'),
    saveBtn: $('saveBtn'),
    exampleBtn: $('exampleBtn'),
    exportBtn: $('exportBtn'),
    importBtn: $('importBtn'),
    importInput: $('importInput'),
    presentationBtn: $('presentationBtn'),
    fitBtn: $('fitBtn'),
    toast: $('toast'),
  };

  const state = {
    drill: makeEmptyDrill(),
    selectedLineId: null,
    drawMode: false,
    drawing: false,
    draftPoints: [],
    isPlaying: false,
    currentTime: 0,
    playbackRate: 1,
    lastFrame: 0,
    raf: 0,
    dirty: false,
    toastTimer: 0,
  };

  function uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function makeEmptyDrill() {
    return {
      version: 1,
      id: uid('drill'),
      name: 'San Antonio Grand Entry',
      venue: 'Frost Bank Center / AT&T Center, San Antonio, Texas',
      arena: { lengthFt: ARENA.lengthFt, widthFt: ARENA.widthFt },
      lines: [],
      updatedAt: new Date().toISOString(),
    };
  }

  function makeLine() {
    const index = state.drill.lines.length;
    return {
      id: uid('line'),
      name: `Line ${index + 1}`,
      color: ROUTE_COLORS[index % ROUTE_COLORS.length],
      horseCount: 4,
      speedMph: 10,
      spacingFt: 12,
      startDelay: 0,
      segments: [],
    };
  }

  function selectedLine() {
    return state.drill.lines.find((line) => line.id === state.selectedLineId) || null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function distPx(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function distFt(a, b) {
    const dxFt = ((b.x - a.x) / ARENA.width) * state.drill.arena.lengthFt;
    const dyFt = ((b.y - a.y) / ARENA.height) * state.drill.arena.widthFt;
    return Math.hypot(dxFt, dyFt);
  }

  function pointsDistanceFt(points) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) total += distFt(points[i - 1], points[i]);
    return total;
  }

  function mphToFps(mph) {
    return Math.max(0.1, Number(mph) || 0) * 1.4666667;
  }

  function holdTotal(line) {
    return line.segments.reduce((sum, segment) => sum + (segment.type === 'hold' ? Number(segment.duration) || 0 : 0), 0);
  }

  function getLastMoveEnd(line) {
    for (let i = line.segments.length - 1; i >= 0; i -= 1) {
      const segment = line.segments[i];
      if (segment.type === 'move' && segment.points.length) return segment.points[segment.points.length - 1];
    }
    return null;
  }

  function compileLine(line) {
    const speedFps = mphToFps(line.speedMph);
    const events = [];
    let cumulativeDistance = 0;
    let elapsed = Math.max(0, Number(line.startDelay) || 0);

    for (const segment of line.segments) {
      if (segment.type === 'move') {
        const distance = pointsDistanceFt(segment.points);
        const duration = distance / speedFps;
        events.push({ type: 'move', startTime: elapsed, endTime: elapsed + duration, startDistance: cumulativeDistance, endDistance: cumulativeDistance + distance, duration, distance });
        cumulativeDistance += distance;
        elapsed += duration;
      } else if (segment.type === 'hold') {
        const duration = Math.max(0, Number(segment.duration) || 0);
        events.push({ type: 'hold', startTime: elapsed, endTime: elapsed + duration, distance: cumulativeDistance, duration });
        elapsed += duration;
      }
    }

    const tailDistance = Math.max(0, (Math.max(1, line.horseCount) - 1) * Math.max(0, line.spacingFt));
    const tailDuration = cumulativeDistance > 0 ? tailDistance / speedFps : 0;
    return {
      events,
      speedFps,
      totalDistance: cumulativeDistance,
      choreographyEnd: elapsed,
      tailDuration,
      totalTime: cumulativeDistance > 0 ? elapsed + tailDuration : 0,
    };
  }

  function drillDuration() {
    return state.drill.lines.reduce((max, line) => Math.max(max, compileLine(line).totalTime), 0);
  }

  function leadDistanceAtTime(line, time) {
    const compiled = compileLine(line);
    if (!compiled.totalDistance) return { distance: 0, active: false, compiled };
    const delay = Math.max(0, Number(line.startDelay) || 0);
    if (time < delay) return { distance: 0, active: true, compiled };

    for (const event of compiled.events) {
      if (time < event.startTime) break;
      if (time <= event.endTime) {
        if (event.type === 'hold') return { distance: event.distance, active: true, compiled };
        const progress = event.duration ? clamp((time - event.startTime) / event.duration, 0, 1) : 1;
        return { distance: event.startDistance + event.distance * progress, active: true, compiled };
      }
    }

    const after = Math.max(0, time - compiled.choreographyEnd);
    return { distance: compiled.totalDistance + after * compiled.speedFps, active: time <= compiled.totalTime, compiled };
  }

  function routePoints(line) {
    const points = [];
    for (const segment of line.segments) {
      if (segment.type !== 'move' || !segment.points.length) continue;
      for (const point of segment.points) {
        if (!points.length || distPx(points[points.length - 1], point) > 0.01) points.push(point);
      }
    }
    return points;
  }

  function pointAtDistance(line, targetFt) {
    const points = routePoints(line);
    if (!points.length) return null;
    if (points.length === 1) return { ...points[0], angle: 0 };
    if (targetFt <= 0) {
      const next = points[1];
      return { ...points[0], angle: Math.atan2(next.y - points[0].y, next.x - points[0].x) * 180 / Math.PI };
    }

    let walked = 0;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const segmentFt = distFt(a, b);
      if (walked + segmentFt >= targetFt) {
        const t = segmentFt ? (targetFt - walked) / segmentFt : 0;
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI,
        };
      }
      walked += segmentFt;
    }

    const a = points[points.length - 2];
    const b = points[points.length - 1];
    return { ...b, angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI };
  }

  function formatTime(seconds, tenths = false) {
    const value = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(value / 60);
    const secs = value - minutes * 60;
    return tenths ? `${minutes}:${secs.toFixed(1).padStart(4, '0')}` : `${minutes}:${Math.floor(secs).toString().padStart(2, '0')}`;
  }

  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined && value !== null) el.setAttribute(key, String(value));
    }
    return el;
  }

  function pathD(points) {
    if (!points.length) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i += 1) {
      const midX = (points[i].x + points[i + 1].x) / 2;
      const midY = (points[i].y + points[i + 1].y) / 2;
      d += ` Q ${points[i].x} ${points[i].y} ${midX} ${midY}`;
    }
    const last = points[points.length - 1];
    d += ` L ${last.x} ${last.y}`;
    return d;
  }

  function renderAll() {
    renderLineList();
    renderEditor();
    renderRoutes();
    renderPlayback();
    updateEmptyState();
  }

  function renderLineList() {
    els.lineList.replaceChildren();
    for (const line of state.drill.lines) {
      const card = document.createElement('button');
      card.className = `line-card${line.id === state.selectedLineId ? ' selected' : ''}`;
      card.type = 'button';
      card.innerHTML = `
        <span class="line-swatch" style="background:${escapeHtml(line.color)}"></span>
        <span>
          <span class="line-card-name">${escapeHtml(line.name)}</span>
          <span class="line-card-meta">${line.horseCount} horse${line.horseCount === 1 ? '' : 's'} · ${line.segments.length} step${line.segments.length === 1 ? '' : 's'}</span>
        </span>
        <span class="line-card-badge">${line.horseCount}</span>`;
      card.addEventListener('click', () => selectLine(line.id));
      els.lineList.appendChild(card);
    }
  }

  function renderEditor() {
    const line = selectedLine();
    els.noSelection.classList.toggle('hidden', !!line);
    els.lineEditor.classList.toggle('hidden', !line);
    els.clearLineBtn.disabled = !line || !line.segments.length;
    els.undoBtn.disabled = !line || !line.segments.length;
    if (!line) return;

    els.editorTitle.textContent = line.name;
    setInputValue(els.lineName, line.name);
    setInputValue(els.lineColor, line.color);
    setInputValue(els.horseCount, line.horseCount);
    setInputValue(els.startDelay, line.startDelay);
    setInputValue(els.lineSpeed, line.speedMph);
    setInputValue(els.horseSpacing, line.spacingFt);

    const hasMove = line.segments.some((segment) => segment.type === 'move');
    const last = line.segments[line.segments.length - 1];
    els.addHoldBtn.disabled = !hasMove || !last || last.type === 'hold';
    els.drawSegmentBtn.textContent = hasMove ? 'Draw next movement' : 'Draw first movement';
    els.drawSegmentBtn.classList.toggle('active', state.drawMode);

    els.sequenceList.replaceChildren();
    line.segments.forEach((segment, index) => {
      const item = document.createElement('div');
      item.className = 'sequence-item';
      const isMove = segment.type === 'move';
      const detail = isMove
        ? `${Math.round(pointsDistanceFt(segment.points))} ft movement`
        : `${Number(segment.duration).toFixed(Number(segment.duration) % 1 ? 1 : 0)} sec hold`;
      item.innerHTML = `
        <span class="sequence-number">${index + 1}</span>
        <span class="sequence-main"><strong>${isMove ? 'Movement' : 'Stop / hold'}</strong><span>${detail}</span></span>
        <button class="sequence-remove" type="button" aria-label="Remove step ${index + 1}">×</button>`;
      item.querySelector('button').addEventListener('click', () => removeSegment(index));
      els.sequenceList.appendChild(item);
    });

    els.stepCount.textContent = `${line.segments.length} step${line.segments.length === 1 ? '' : 's'}`;
    const compiled = compileLine(line);
    els.distanceStat.textContent = `${Math.round(compiled.totalDistance)} ft`;
    els.lineTimeStat.textContent = formatTime(compiled.totalTime);
    els.holdsStat.textContent = `${holdTotal(line).toFixed(holdTotal(line) % 1 ? 1 : 0)} sec`;
    els.teamStat.textContent = `${teamHorseCount()} horses`;
  }

  function renderRoutes() {
    els.routeLayer.replaceChildren();
    for (const line of state.drill.lines) renderLineRoute(line);
    renderDraft();
    renderHorses();
  }

  function renderLineRoute(line) {
    const isSelected = line.id === state.selectedLineId;
    let firstPoint = null;
    let lastPoint = null;
    let lastMovementEnd = null;
    let movementIndex = 0;

    for (const segment of line.segments) {
      if (segment.type === 'move' && segment.points.length >= 2) {
        movementIndex += 1;
        const d = pathD(segment.points);
        els.routeLayer.appendChild(svgEl('path', { d, class: 'route-path-shadow' }));
        els.routeLayer.appendChild(svgEl('path', {
          d,
          class: `route-path${isSelected ? '' : ' unselected'}`,
          stroke: line.color,
        }));

        const mid = segment.points[Math.floor(segment.points.length / 2)];
        const labelBg = svgEl('circle', { cx: mid.x, cy: mid.y, r: 10, fill: '#17140f', opacity: isSelected ? '.85' : '.55' });
        const label = svgEl('text', { x: mid.x, y: mid.y + 0.3, class: 'segment-index' });
        label.textContent = movementIndex;
        els.routeLayer.append(labelBg, label);

        if (!firstPoint) firstPoint = segment.points[0];
        lastPoint = segment.points[segment.points.length - 1];
        lastMovementEnd = lastPoint;
      } else if (segment.type === 'hold' && lastMovementEnd) {
        const ring = svgEl('circle', {
          cx: lastMovementEnd.x,
          cy: lastMovementEnd.y,
          r: 16,
          class: 'stop-marker-ring',
          stroke: line.color,
        });
        const text = svgEl('text', { x: lastMovementEnd.x, y: lastMovementEnd.y + 0.5, class: 'stop-marker-text' });
        text.textContent = `${segment.duration}s`;
        els.routeLayer.append(ring, text);
      }
    }

    if (firstPoint) {
      els.routeLayer.appendChild(svgEl('circle', { cx: firstPoint.x, cy: firstPoint.y, r: 7, fill: line.color, class: 'route-start' }));
    }
    if (lastPoint) {
      els.routeLayer.appendChild(svgEl('circle', { cx: lastPoint.x, cy: lastPoint.y, r: 6, class: 'route-end', stroke: line.color }));
    }
  }

  function renderDraft() {
    els.draftLayer.replaceChildren();
    if (state.draftPoints.length > 1) {
      els.draftLayer.appendChild(svgEl('path', { d: pathD(state.draftPoints), class: 'draft-path' }));
    }
  }

  function renderHorses() {
    els.horseLayer.replaceChildren();
    const time = state.currentTime;
    for (const line of state.drill.lines) {
      const lead = leadDistanceAtTime(line, time);
      if (!lead.compiled.totalDistance) continue;
      for (let i = 0; i < line.horseCount; i += 1) {
        const horseDistance = lead.distance - i * line.spacingFt;
        if (horseDistance < -0.01 || horseDistance > lead.compiled.totalDistance + 0.01) continue;
        const point = pointAtDistance(line, clamp(horseDistance, 0, lead.compiled.totalDistance));
        if (!point) continue;
        els.horseLayer.appendChild(makeHorseMarker(point, line, i + 1));
      }
    }
  }

  function makeHorseMarker(point, line, number) {
    const g = svgEl('g', {
      class: 'horse-marker',
      transform: `translate(${point.x} ${point.y}) rotate(${point.angle + 90})`,
    });
    const body = svgEl('ellipse', { cx: 0, cy: 0, rx: 8.5, ry: 12.5, fill: line.color, class: 'horse-body' });
    const head = svgEl('circle', { cx: 0, cy: -13, r: 4.3, class: 'horse-head' });
    const direction = svgEl('path', { d: 'M -3 -20 L 0 -25 L 3 -20 Z', class: 'horse-direction' });
    const numberText = svgEl('text', { x: 0, y: 0.5, class: 'horse-number', transform: 'rotate(0)' });
    numberText.textContent = number;
    g.append(body, head, direction, numberText);
    return g;
  }

  function renderPlayback() {
    const duration = drillDuration();
    state.currentTime = clamp(state.currentTime, 0, duration || 0);
    els.timeline.max = String(Math.max(0.01, duration));
    els.timeline.value = String(state.currentTime);
    els.timeLabel.textContent = formatTime(state.currentTime, true);
    els.durationLabel.textContent = formatTime(duration, true);
    els.playBtn.textContent = state.isPlaying ? '❚❚' : '▶';
    els.playBtn.setAttribute('aria-label', state.isPlaying ? 'Pause drill' : 'Play drill');
  }

  function updateEmptyState() {
    const hasMovement = state.drill.lines.some((line) => line.segments.some((segment) => segment.type === 'move'));
    els.emptyArena.classList.toggle('hidden', hasMovement || state.drawMode);
    els.drawHint.classList.toggle('hidden', !state.drawMode);
  }

  function selectLine(id) {
    stopDrawing();
    state.selectedLineId = id;
    renderAll();
  }

  function addLine() {
    pause();
    const line = makeLine();
    state.drill.lines.push(line);
    state.selectedLineId = line.id;
    markDirty();
    renderAll();
    requestAnimationFrame(() => els.lineName.focus());
  }

  function deleteSelectedLine() {
    const line = selectedLine();
    if (!line) return;
    const index = state.drill.lines.findIndex((item) => item.id === line.id);
    state.drill.lines.splice(index, 1);
    state.selectedLineId = state.drill.lines[Math.min(index, state.drill.lines.length - 1)]?.id || null;
    state.currentTime = 0;
    markDirty();
    renderAll();
    toast('Line deleted');
  }

  function clearSelectedLine() {
    const line = selectedLine();
    if (!line || !line.segments.length) return;
    line.segments = [];
    state.currentTime = 0;
    markDirty();
    renderAll();
    toast('Selected route cleared');
  }

  function removeSegment(index) {
    const line = selectedLine();
    if (!line) return;
    line.segments.splice(index, 1);
    normalizeSegmentStarts(line);
    state.currentTime = 0;
    markDirty();
    renderAll();
  }

  function undoLastStep() {
    const line = selectedLine();
    if (!line || !line.segments.length) return;
    line.segments.pop();
    state.currentTime = 0;
    markDirty();
    renderAll();
    toast('Last step removed');
  }

  function normalizeSegmentStarts(line) {
    let end = null;
    for (const segment of line.segments) {
      if (segment.type === 'move' && segment.points.length) {
        if (end) segment.points[0] = { ...end };
        end = segment.points[segment.points.length - 1];
      }
    }
  }

  function beginDrawMode() {
    const line = selectedLine();
    if (!line) {
      addLine();
      return;
    }
    pause();
    state.drawMode = !state.drawMode;
    state.drawing = false;
    state.draftPoints = [];
    els.interactionSurface.style.cursor = state.drawMode ? 'crosshair' : '';
    renderEditor();
    renderDraft();
    updateEmptyState();
  }

  function stopDrawing() {
    state.drawMode = false;
    state.drawing = false;
    state.draftPoints = [];
    els.interactionSurface.style.cursor = '';
    renderDraft();
    updateEmptyState();
  }

  function pointerToArena(event) {
    const point = els.arena.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = els.arena.getScreenCTM();
    if (!matrix) return null;
    const svgPoint = point.matrixTransform(matrix.inverse());
    return {
      x: clamp(svgPoint.x, ARENA.x, ARENA.x + ARENA.width),
      y: clamp(svgPoint.y, ARENA.y, ARENA.y + ARENA.height),
    };
  }

  function onPointerDown(event) {
    if (!state.drawMode || !selectedLine()) return;
    event.preventDefault();
    els.interactionSurface.setPointerCapture?.(event.pointerId);
    state.drawing = true;
    const point = pointerToArena(event);
    if (!point) return;
    const lastEnd = getLastMoveEnd(selectedLine());
    state.draftPoints = lastEnd ? [{ ...lastEnd }] : [];
    if (!lastEnd || distPx(lastEnd, point) > 2) state.draftPoints.push(point);
    renderDraft();
  }

  function onPointerMove(event) {
    if (!state.drawMode || !state.drawing) return;
    event.preventDefault();
    const point = pointerToArena(event);
    if (!point) return;
    const last = state.draftPoints[state.draftPoints.length - 1];
    if (!last || distPx(last, point) >= 4) {
      state.draftPoints.push(point);
      renderDraft();
    }
  }

  function onPointerUp(event) {
    if (!state.drawMode || !state.drawing) return;
    event.preventDefault();
    state.drawing = false;
    const line = selectedLine();
    if (!line) return stopDrawing();
    const simplified = simplifyPoints(state.draftPoints, 3);
    if (simplified.length >= 2 && pointsDistanceFt(simplified) >= 3) {
      line.segments.push({ type: 'move', id: uid('move'), points: simplified });
      state.currentTime = 0;
      markDirty();
      toast('Movement added. Add a stop or draw the next movement.');
    } else {
      toast('Draw a longer movement path');
    }
    stopDrawing();
    renderAll();
  }

  function simplifyPoints(points, minPx) {
    if (points.length <= 2) return points.map((point) => ({ ...point }));
    const result = [{ ...points[0] }];
    for (let i = 1; i < points.length - 1; i += 1) {
      if (distPx(result[result.length - 1], points[i]) >= minPx) result.push({ ...points[i] });
    }
    const last = points[points.length - 1];
    if (distPx(result[result.length - 1], last) > 0.5) result.push({ ...last });
    return result;
  }

  function addHold() {
    const line = selectedLine();
    if (!line) return;
    const last = line.segments[line.segments.length - 1];
    if (!last || last.type !== 'move') return;
    const duration = clamp(Number(els.holdSeconds.value) || 10, 0.5, 300);
    line.segments.push({ type: 'hold', id: uid('hold'), duration });
    state.currentTime = 0;
    markDirty();
    renderAll();
    toast(`${duration}-second stop added`);
  }

  function playPause() {
    const duration = drillDuration();
    if (!duration) {
      toast('Draw at least one movement before playing');
      return;
    }
    if (state.isPlaying) return pause();
    if (state.currentTime >= duration - 0.01) state.currentTime = 0;
    state.isPlaying = true;
    state.lastFrame = performance.now();
    renderPlayback();
    state.raf = requestAnimationFrame(tick);
  }

  function pause() {
    state.isPlaying = false;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    renderPlayback();
  }

  function tick(now) {
    if (!state.isPlaying) return;
    const delta = Math.min(0.08, (now - state.lastFrame) / 1000);
    state.lastFrame = now;
    state.currentTime += delta * state.playbackRate;
    const duration = drillDuration();
    if (state.currentTime >= duration) {
      state.currentTime = duration;
      state.isPlaying = false;
    }
    renderHorses();
    renderPlayback();
    if (state.isPlaying) state.raf = requestAnimationFrame(tick);
  }

  function restart() {
    pause();
    state.currentTime = 0;
    renderHorses();
    renderPlayback();
  }

  function updateLineField(field, value) {
    const line = selectedLine();
    if (!line) return;
    line[field] = value;
    markDirty();
    state.currentTime = Math.min(state.currentTime, drillDuration());
    renderLineList();
    renderRoutes();
    renderPlayback();
    renderEditor();
  }

  function teamHorseCount() {
    return state.drill.lines.reduce((sum, line) => sum + Math.max(0, Number(line.horseCount) || 0), 0);
  }

  function markDirty() {
    state.dirty = true;
    state.drill.updatedAt = new Date().toISOString();
    els.saveBtn.textContent = 'Save';
  }

  function saveDrill(showToast = true) {
    try {
      state.drill.name = els.drillName.value.trim() || 'Untitled Drill';
      state.drill.updatedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.drill));
      state.dirty = false;
      els.saveBtn.textContent = 'Saved';
      if (showToast) toast('Drill saved on this device');
      setTimeout(() => { if (!state.dirty) els.saveBtn.textContent = 'Save'; }, 1200);
    } catch (error) {
      console.error(error);
      toast('Could not save this drill');
    }
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!validateDrill(parsed)) return false;
      state.drill = parsed;
      state.selectedLineId = parsed.lines[0]?.id || null;
      els.drillName.value = parsed.name || 'San Antonio Grand Entry';
      return true;
    } catch (error) {
      console.warn('Saved drill could not be loaded', error);
      return false;
    }
  }

  function validateDrill(drill) {
    return !!drill && typeof drill === 'object' && Array.isArray(drill.lines) && drill.lines.every((line) => line && Array.isArray(line.segments));
  }

  function exportDrill() {
    saveDrill(false);
    const data = JSON.stringify(state.drill, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${slugify(state.drill.name || 'rodeo-drill')}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast('Drill exported');
  }

  function importDrill(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!validateDrill(parsed)) throw new Error('Invalid drill file');
        pause();
        state.drill = parsed;
        state.selectedLineId = parsed.lines[0]?.id || null;
        state.currentTime = 0;
        els.drillName.value = parsed.name || 'Imported Drill';
        markDirty();
        renderAll();
        saveDrill(false);
        toast('Drill imported');
      } catch (error) {
        console.error(error);
        toast('That file is not a valid Rodeo drill');
      }
      els.importInput.value = '';
    };
    reader.readAsText(file);
  }

  function loadExample() {
    pause();
    const lineA = {
      id: uid('line'), name: 'Silver A', color: '#f0b84e', horseCount: 4, speedMph: 11, spacingFt: 12, startDelay: 0,
      segments: [
        { type: 'move', id: uid('move'), points: sampleCurve([[55,280],[140,280],[270,170],[455,120],[500,150],[500,280]]) },
        { type: 'hold', id: uid('hold'), duration: 10 },
        { type: 'move', id: uid('move'), points: sampleCurve([[500,280],[620,350],[790,410],[944,280]]) },
      ],
    };
    const lineB = {
      id: uid('line'), name: 'Silver B', color: '#60a5fa', horseCount: 4, speedMph: 11, spacingFt: 12, startDelay: 0,
      segments: [
        { type: 'move', id: uid('move'), points: sampleCurve([[945,280],[860,280],[730,170],[545,120],[500,150],[500,280]]) },
        { type: 'hold', id: uid('hold'), duration: 10 },
        { type: 'move', id: uid('move'), points: sampleCurve([[500,280],[380,350],[210,410],[56,280]]) },
      ],
    };
    state.drill = makeEmptyDrill();
    state.drill.name = 'Two-Line Grand Entry Example';
    state.drill.lines = [lineA, lineB];
    state.selectedLineId = lineA.id;
    state.currentTime = 0;
    els.drillName.value = state.drill.name;
    markDirty();
    renderAll();
    toast('Example loaded — press Play');
  }

  function sampleCurve(anchors) {
    const points = [];
    for (let i = 1; i < anchors.length; i += 1) {
      const [x1, y1] = anchors[i - 1];
      const [x2, y2] = anchors[i];
      const steps = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 18));
      for (let s = i === 1 ? 0 : 1; s <= steps; s += 1) {
        const t = s / steps;
        points.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
      }
    }
    return points;
  }

  function slugify(value) {
    return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'rodeo-drill';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'\"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;' }[char]));
  }

  function setInputValue(input, value) {
    if (document.activeElement !== input) input.value = String(value ?? '');
  }

  function toast(message) {
    clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add('show');
    state.toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  function togglePresentation() {
    document.body.classList.toggle('presentation');
    const active = document.body.classList.contains('presentation');
    els.presentationBtn.textContent = active ? 'Exit Team View' : 'Team View';
    if (active) toast('Team View — press Esc to exit');
  }

  function bindEvents() {
    els.addLineBtn.addEventListener('click', addLine);
    els.addLineEmptyBtn.addEventListener('click', addLine);
    els.deleteLineBtn.addEventListener('click', deleteSelectedLine);
    els.clearLineBtn.addEventListener('click', clearSelectedLine);
    els.undoBtn.addEventListener('click', undoLastStep);
    els.drawSegmentBtn.addEventListener('click', beginDrawMode);
    els.addHoldBtn.addEventListener('click', addHold);

    els.interactionSurface.addEventListener('pointerdown', onPointerDown);
    els.interactionSurface.addEventListener('pointermove', onPointerMove);
    els.interactionSurface.addEventListener('pointerup', onPointerUp);
    els.interactionSurface.addEventListener('pointercancel', onPointerUp);

    els.playBtn.addEventListener('click', playPause);
    els.restartBtn.addEventListener('click', restart);
    els.timeline.addEventListener('input', () => {
      pause();
      state.currentTime = Number(els.timeline.value) || 0;
      renderHorses();
      renderPlayback();
    });
    els.playbackRate.addEventListener('change', () => { state.playbackRate = Number(els.playbackRate.value) || 1; });

    els.lineName.addEventListener('input', () => updateLineField('name', els.lineName.value || 'Untitled Line'));
    els.lineColor.addEventListener('input', () => updateLineField('color', els.lineColor.value));
    els.horseCount.addEventListener('change', () => updateLineField('horseCount', clamp(Math.round(Number(els.horseCount.value) || 1), 1, 60)));
    els.startDelay.addEventListener('change', () => updateLineField('startDelay', clamp(Number(els.startDelay.value) || 0, 0, 300)));
    els.lineSpeed.addEventListener('change', () => updateLineField('speedMph', clamp(Number(els.lineSpeed.value) || 1, 1, 35)));
    els.horseSpacing.addEventListener('change', () => updateLineField('spacingFt', clamp(Number(els.horseSpacing.value) || 3, 3, 80)));

    els.drillName.addEventListener('input', () => {
      state.drill.name = els.drillName.value;
      markDirty();
    });
    els.saveBtn.addEventListener('click', () => saveDrill(true));
    els.exampleBtn.addEventListener('click', loadExample);
    els.exportBtn.addEventListener('click', exportDrill);
    els.importBtn.addEventListener('click', () => els.importInput.click());
    els.importInput.addEventListener('change', () => importDrill(els.importInput.files?.[0]));
    els.presentationBtn.addEventListener('click', togglePresentation);
    els.fitBtn.addEventListener('click', () => toast('Arena automatically fits the available screen'));

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (state.drawMode) stopDrawing();
        else if (document.body.classList.contains('presentation')) togglePresentation();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveDrill(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && document.activeElement?.tagName !== 'INPUT') {
        event.preventDefault();
        undoLastStep();
      }
      if (event.code === 'Space' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'SELECT') {
        event.preventDefault();
        playPause();
      }
    });

    window.addEventListener('beforeunload', () => { if (state.dirty) saveDrill(false); });
  }

  function init() {
    bindEvents();
    loadSaved();
    els.drillName.value = state.drill.name || 'San Antonio Grand Entry';
    renderAll();
  }

  init();
})();
