(() => {
'use strict';

const SVG = 'http://www.w3.org/2000/svg';
const STORE = 'rodeo-formation-workflow-v1';
const COLORS = ['#e3aa43','#6aa9f8','#78c28a','#e47972','#b58af2','#61c9c0','#f0995b','#d6d36b'];
const ARENA = { minX: 205, maxX: 938, minY: 68, maxY: 492 };
const PATH_BOUNDS = { minX: 42, maxX: 938, minY: 72, maxY: 488 };
const CHUTE = { minX: 42, maxX: 176, minY: 232, maxY: 328 };

const ids = [
  'horseMinus','horsePlus','horseCountLabel','formationPresets','editFormationBtn','formationStatus',
  'selectAllBtn','selectNoneBtn','selectOddBtn','selectEvenBtn','horseRoster','selectionSummary','movementMode','drawBtn',
  'exitBtn','undoBtn','newBtn','saveBtn','exportBtn','routineName','stageInstruction','statusPill','restartBtn','playBtn',
  'arena','arenaSurface','routeLayer','formationLayer','draftLayer','horseLayer','emptyHelp','drawHelp',
  'formationBanner','formationBannerTitle','formationBannerText','cancelFormationBtn','saveFormationBtn',
  'reviewBar','reviewText','cleanupChoice','retryBtn','continueBtn','stopBtn',
  'actionCount','timeLabel','durationLabel','timeline','actionStrip','toast'
];
const els = {};
ids.forEach(id => els[id] = document.getElementById(id));

let state;
let pointerId = null;
let dragHorseId = null;
let toastTimer = 0;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
function deepPoints(points) { return points.map(p => ({ x:p.x, y:p.y })); }
function fmtTime(sec) {
  const s = Math.max(0, sec || 0);
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG, tag);
  Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k, v));
  return el;
}
function pathD(points) {
  return points.map((p,i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}
function average(points) {
  if (!points.length) return { x:574, y:280 };
  return points.reduce((a,p) => ({ x:a.x+p.x/points.length, y:a.y+p.y/points.length }), {x:0,y:0});
}
function horseById(id) { return state.horses.find(h => h.id === id); }
function selectedIds() { return [...state.selected].sort((a,b) => a-b); }
function allIds() { return state.horses.map(h => h.id); }

function localFormationSlots(ids, preset) {
  const slots = [];
  if (preset === 'lead') {
    if (ids.length) slots.push({ id:ids[0], row:0, colOffset:0 });
    const rest = ids.slice(1);
    rest.forEach((id,i) => {
      const row = 1 + Math.floor(i / 2);
      const pairIndex = i % 2;
      slots.push({ id, row, colOffset:pairIndex === 0 ? -0.5 : 0.5 });
    });
    return slots;
  }
  const wide = preset === 'four' ? 4 : preset === 'two' ? 2 : 1;
  ids.forEach((id,i) => {
    const row = Math.floor(i / wide);
    const inRow = i % wide;
    const countInRow = Math.min(wide, ids.length - row * wide);
    const colOffset = inRow - (countInRow - 1) / 2;
    slots.push({ id, row, colOffset });
  });
  return slots;
}

function formationLayout(ids, preset, center, heading, forChute = false) {
  const slots = localFormationSlots(ids, preset);
  const rows = slots.reduce((m,s) => Math.max(m,s.row), 0) + 1;
  const sideGap = preset === 'four' ? 22 : 28;
  let rowGap = 30;
  if (forChute && rows > 1) rowGap = Math.min(30, Math.max(9, (center.x - CHUTE.minX - 4) / (rows - 1)));
  const f = { x:Math.cos(heading), y:Math.sin(heading) };
  const right = { x:-Math.sin(heading), y:Math.cos(heading) };
  const out = {};
  slots.forEach(slot => {
    let x = center.x - f.x * slot.row * rowGap + right.x * slot.colOffset * sideGap;
    let y = center.y - f.y * slot.row * rowGap + right.y * slot.colOffset * sideGap;
    if (forChute) {
      x = clamp(x, CHUTE.minX, CHUTE.maxX);
      y = clamp(y, CHUTE.minY, CHUTE.maxY);
    } else {
      x = clamp(x, ARENA.minX, ARENA.maxX);
      y = clamp(y, ARENA.minY, ARENA.maxY);
    }
    out[slot.id] = { x, y };
  });
  return out;
}

function makeHorses(count, preset='two') {
  const ids = Array.from({length:count},(_,i)=>i+1);
  const positions = formationLayout(ids, preset, {x:166,y:280}, 0, true);
  return ids.map(id => ({ id, start:{...positions[id]} }));
}

function freshState(count=12) {
  const formationPreset = 'two';
  const horses = makeHorses(count, formationPreset);
  const positions = Object.fromEntries(horses.map(h => [h.id,{...h.start}]));
  return {
    version:1,
    horses,
    formationPreset,
    formationSaved:false,
    startingFormationName:'2 Wide',
    selected:new Set(horses.map(h=>h.id)),
    movementMode:'together',
    cleanup:'smooth',
    actions:[],
    editing:{ type:'start', horseIds:horses.map(h=>h.id), positions, preset:formationPreset, heading:0, center:{x:166,y:280} },
    drawing:false,
    pendingRaw:null,
    time:0,
    playing:false,
    lastFrame:0,
    raf:0,
    finished:false,
    name:'New Routine'
  };
}

function totalDuration() {
  return state.actions.reduce((m,a) => Math.max(m, a.start + a.duration), 0);
}
function meta(points) {
  const cum=[0]; let total=0;
  for(let i=1;i<points.length;i++){ total += dist(points[i-1],points[i]); cum.push(total); }
  return {points,cum,total};
}
function pointOn(points, progress) {
  if (!points || !points.length) return {x:166,y:280,angle:0};
  if (points.length === 1) return {...points[0],angle:0};
  const m=meta(points);
  if (m.total < .001) return {...points[0],angle:0};
  const target=clamp(progress,0,1)*m.total;
  let i=1; while(i<m.cum.length && m.cum[i]<target) i++;
  i=Math.min(i,points.length-1);
  const a=points[i-1], b=points[i], base=m.cum[i-1], len=Math.max(.001,m.cum[i]-base), t=(target-base)/len;
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle:Math.atan2(b.y-a.y,b.x-a.x)};
}
function poseAt(horseId,time) {
  const horse=horseById(horseId);
  let current=horse?{...horse.start,angle:0}:{x:166,y:280,angle:0};
  for(const action of state.actions){
    if(!action.horseIds.includes(horseId)) continue;
    if(time < action.start) return current;
    const points=action.paths[horseId];
    if(!points || !points.length) continue;
    const end=action.start+action.duration;
    if(time <= end) return pointOn(points,(time-action.start)/Math.max(.001,action.duration));
    const last=points[points.length-1], prev=points[Math.max(0,points.length-2)];
    current={x:last.x,y:last.y,angle:Math.atan2(last.y-prev.y,last.x-prev.x)};
  }
  return current;
}

function simplifyRdp(points, epsilon=2.6) {
  if(points.length<3) return points.slice();
  const first=points[0], last=points[points.length-1], dx=last.x-first.x, dy=last.y-first.y, denom=Math.hypot(dx,dy)||1;
  let max=0,idx=0;
  for(let i=1;i<points.length-1;i++){
    const p=points[i];
    const d=Math.abs(dy*p.x-dx*p.y+last.x*first.y-last.y*first.x)/denom;
    if(d>max){max=d;idx=i;}
  }
  if(max>epsilon){
    const left=simplifyRdp(points.slice(0,idx+1),epsilon), right=simplifyRdp(points.slice(idx),epsilon);
    return left.slice(0,-1).concat(right);
  }
  return [first,last];
}
function chaikin(points,passes=2){
  let out=points.slice();
  for(let p=0;p<passes;p++){
    if(out.length<3) break;
    const next=[out[0]];
    for(let i=0;i<out.length-1;i++){
      const a=out[i],b=out[i+1];
      next.push({x:a.x*.75+b.x*.25,y:a.y*.75+b.y*.25});
      next.push({x:a.x*.25+b.x*.75,y:a.y*.25+b.y*.75});
    }
    next.push(out[out.length-1]); out=next;
  }
  return out;
}
function smoothPath(points){ return points.length<3?points.slice():chaikin(simplifyRdp(points),2); }
function straightPath(points){ return points.length?[points[0],points[points.length-1]]:[]; }
function cleanupGuide(points,mode){ return mode==='raw'?points.slice():mode==='straight'?straightPath(points):smoothPath(points); }

function selectionLabel(ids=selectedIds()){
  if(!ids.length) return 'No horses selected';
  if(ids.length===state.horses.length) return `All ${ids.length} horses selected`;
  if(ids.length===1) return `Horse ${ids[0]} selected`;
  if(ids.length<=6) return `Horses ${ids.join(', ')} selected`;
  return `${ids.length} horses selected`;
}
function horseLabel(ids){
  if(ids.length===state.horses.length) return `All ${ids.length} horses`;
  if(ids.length===1) return `Horse ${ids[0]}`;
  if(ids.length<=4) return `Horses ${ids.join(', ')}`;
  return `${ids.length} horses`;
}
function presetName(preset){ return preset==='single'?'1 Wide':preset==='two'?'2 Wide':preset==='four'?'4 Wide':'Lead Center'; }

function guideForPreview(){ return state.pendingRaw?cleanupGuide(state.pendingRaw,state.cleanup):[]; }
function translatedPathsForSelected(){
  const guide=guideForPreview();
  const ids=selectedIds();
  if(guide.length<2 || !ids.length) return null;
  const origin=guide[0], start=totalDuration();
  const bases=ids.map(id=>({id,pose:poseAt(id,start)}));
  const centerY=bases.reduce((sum,b)=>sum+b.pose.y,0)/bases.length;
  const paths={};
  bases.forEach(({id,pose})=>{
    let mirrorSign=1;
    if(state.movementMode==='mirror' && bases.length>1){
      mirrorSign=pose.y>centerY+1?-1:1;
    }
    paths[id]=guide.map(p=>({
      x:clamp(pose.x+(p.x-origin.x),PATH_BOUNDS.minX,PATH_BOUNDS.maxX),
      y:clamp(pose.y+(p.y-origin.y)*mirrorSign,PATH_BOUNDS.minY,PATH_BOUNDS.maxY)
    }));
  });
  return {start,paths};
}
function moveDuration(paths){
  let longest=0; Object.values(paths).forEach(points=>{longest=Math.max(longest,meta(points).total);});
  return clamp(longest/46,1.2,24);
}

function setHorseCount(next){
  if(state.actions.length){ showToast('Start a new routine to change the horse count after choreography begins.'); return; }
  const count=clamp(Math.round(next),1,60);
  if(count===state.horses.length) return;
  state.horses=makeHorses(count,state.formationPreset);
  state.selected=new Set(state.horses.map(h=>h.id));
  state.formationSaved=false;
  beginStartFormation(state.formationPreset);
  renderAll();
}

function beginStartFormation(preset=state.formationPreset){
  stopPlayback(); clearDrawing();
  const ids=allIds();
  const positions=formationLayout(ids,preset,{x:166,y:280},0,true);
  state.editing={type:'start',horseIds:ids,positions,preset,heading:0,center:{x:166,y:280}};
  state.time=0;
  renderAll();
}
function averageHeadingForAction(action){
  let x=0,y=0,count=0;
  action.horseIds.forEach(id=>{
    const pts=action.paths[id];
    if(!pts || pts.length<2) return;
    const a=pts[pts.length-2],b=pts[pts.length-1];
    const len=Math.hypot(b.x-a.x,b.y-a.y)||1;
    x+=(b.x-a.x)/len; y+=(b.y-a.y)/len; count++;
  });
  return count?Math.atan2(y,x):0;
}
function beginStopFormation(action){
  stopPlayback();
  const positions={};
  action.horseIds.forEach(id=>{
    const pts=action.paths[id];
    const p=pts[pts.length-1];
    positions[id]={...p};
  });
  const center=average(Object.values(positions));
  state.editing={type:'stop',actionId:action.id,horseIds:action.horseIds.slice(),positions,preset:'manual',heading:averageHeadingForAction(action),center};
  state.time=action.start+action.duration;
  renderAll();
}
function applyFormationPreset(preset){
  if(!state.editing){
    if(!state.actions.length){ beginStartFormation(preset); }
    else showToast('Use “Stop + Set Formation” after a movement to create another formation.');
    return;
  }
  state.editing.preset=preset;
  if(state.editing.type==='start'){
    state.editing.positions=formationLayout(state.editing.horseIds,preset,{x:166,y:280},0,true);
  } else {
    state.editing.positions=formationLayout(state.editing.horseIds,preset,state.editing.center,state.editing.heading,false);
  }
  renderAll();
}
function saveFormation(){
  const edit=state.editing;
  if(!edit) return;
  if(edit.type==='start'){
    edit.horseIds.forEach(id=>{ const h=horseById(id); if(h) h.start={...edit.positions[id]}; });
    if(edit.preset!=='manual') state.formationPreset=edit.preset;
    state.startingFormationName=presetName(state.formationPreset);
    state.formationSaved=true;
    state.editing=null;
    state.selected=new Set(allIds());
    state.name='My Rodeo Routine';
    state.time=0;
    renderAll();
    showToast('Starting formation saved. The team is staged in the chute.');
    return;
  }
  const action=state.actions.find(a=>a.id===edit.actionId);
  if(!action){ state.editing=null; renderAll(); return; }
  let settle=0;
  edit.horseIds.forEach(id=>{
    const pts=action.paths[id];
    const end=pts[pts.length-1], target=edit.positions[id];
    settle=Math.max(settle,dist(end,target));
    if(dist(end,target)>1) pts.push({...target});
  });
  if(settle>1) action.duration += clamp(settle/38,.25,2.5);
  action.stopFormation={
    preset:edit.preset,
    positions:Object.fromEntries(edit.horseIds.map(id=>[id,{...edit.positions[id]}]))
  };
  state.editing=null;
  state.time=totalDuration();
  renderAll();
  showToast('Stop formation saved. Draw the next movement when ready.');
}
function cancelFormation(){
  if(!state.editing) return;
  const wasStart=state.editing.type==='start';
  state.editing=null;
  if(wasStart && !state.formationSaved) state.time=0;
  renderAll();
}

function clearDrawing(){
  state.drawing=false; state.pendingRaw=null; pointerId=null;
  els.reviewBar.classList.add('hidden'); els.drawHelp.classList.add('hidden'); els.drawBtn.classList.remove('active'); els.draftLayer.replaceChildren();
}
function beginDraw(){
  if(!state.formationSaved){ showToast('Save the starting formation first.'); beginStartFormation(state.formationPreset); return; }
  if(state.editing){ showToast('Save or cancel the formation you are editing first.'); return; }
  if(state.finished){ showToast('The routine has already exited. Undo the exit to keep editing.'); return; }
  if(!state.selected.size){ showToast('Select the horse or horses that should move.'); return; }
  stopPlayback();
  state.drawing=true; state.pendingRaw=null; state.cleanup='smooth'; pointerId=null;
  els.reviewBar.classList.add('hidden'); els.drawHelp.classList.remove('hidden'); els.drawBtn.classList.add('active');
  renderStatus(); renderDraft();
}
function finishStroke(){
  pointerId=null;
  if(!state.pendingRaw || state.pendingRaw.length<3 || meta(state.pendingRaw).total<18){
    state.pendingRaw=null; renderDraft(); showToast('Draw a little farther.'); return;
  }
  state.drawing=false;
  els.drawHelp.classList.add('hidden'); els.drawBtn.classList.remove('active'); els.reviewBar.classList.remove('hidden');
  setCleanup('smooth'); renderStatus(); renderDraft();
}
function setCleanup(mode){
  state.cleanup=mode;
  document.querySelectorAll('#cleanupChoice button').forEach(b=>b.classList.toggle('active',b.dataset.cleanup===mode));
  els.reviewText.textContent=mode==='raw'?'Keeps your finger path exactly as drawn.':mode==='straight'?'Makes this segment a perfectly straight run.':'Smooth removes shaky finger movement.';
  renderDraft();
}
function commitPending(stopAfter){
  const built=translatedPathsForSelected();
  const ids=selectedIds();
  if(!built || !ids.length) return;
  const action={
    id:Date.now()+Math.random(),
    type:'move',
    horseIds:ids,
    start:built.start,
    duration:moveDuration(built.paths),
    paths:built.paths,
    mode:state.movementMode,
    cleanup:state.cleanup,
    stopFormation:null
  };
  state.actions.push(action);
  state.name='My Rodeo Routine';
  state.time=action.start+action.duration;
  clearDrawing();
  if(stopAfter) beginStopFormation(action); else renderAll();
  showToast(stopAfter?'Movement added. Now set exactly how they stop.':'Movement added. Keep building from here.');
}
function retryDraw(){ state.pendingRaw=null; state.drawing=true; els.reviewBar.classList.add('hidden'); els.drawHelp.classList.remove('hidden'); els.drawBtn.classList.add('active'); renderStatus(); renderDraft(); }

function exitRoutine(){
  if(!state.formationSaved){ showToast('Save the starting formation first.'); return; }
  if(state.editing || state.drawing || state.pendingRaw){ showToast('Finish the current edit first.'); return; }
  if(state.finished) return;
  stopPlayback();
  const ids=allIds();
  const start=totalDuration();
  const finalPositions=formationLayout(ids,state.formationPreset,{x:166,y:280},0,true);
  const paths={};
  ids.forEach((id,index)=>{
    const base=poseAt(id,start), final=finalPositions[id];
    if(base.x<195){ paths[id]=[base,{...final}]; return; }
    const gateSpread=clamp(final.y,258,302);
    const approachX=Math.max(232,Math.min(base.x-45,330));
    paths[id]=[
      {x:base.x,y:base.y},
      {x:approachX,y:base.y},
      {x:225,y:gateSpread},
      {x:190,y:gateSpread},
      {x:final.x,y:final.y}
    ];
  });
  const action={id:Date.now()+Math.random(),type:'exit',horseIds:ids,start,duration:moveDuration(paths),paths,mode:'exit',cleanup:'auto',stopFormation:null};
  state.actions.push(action); state.finished=true; state.time=start; state.selected=new Set(ids); renderAll(); showToast('Exit added through the same left-side gate.');
}
function undoLast(){
  if(state.editing){ cancelFormation(); return; }
  clearDrawing();
  if(!state.actions.length){
    if(state.formationSaved){ state.formationSaved=false; beginStartFormation(state.formationPreset); }
    return;
  }
  const removed=state.actions.pop();
  if(removed.type==='exit') state.finished=false;
  state.time=totalDuration(); stopPlayback(); renderAll(); showToast('Last movement removed.');
}

function arenaPoint(evt){
  const pt=els.arena.createSVGPoint(); pt.x=evt.clientX; pt.y=evt.clientY;
  const ctm=els.arena.getScreenCTM();
  return ctm?pt.matrixTransform(ctm.inverse()):{x:0,y:0};
}
function editingBounds(){ return state.editing?.type==='start'?CHUTE:ARENA; }
function nearestHorseAt(point, idsToCheck=allIds(), positionsOverride=null){
  let best=null,bestD=25;
  idsToCheck.forEach(id=>{
    const p=positionsOverride?.[id] || poseAt(id,state.time);
    const d=dist(point,p);
    if(d<bestD){bestD=d;best=id;}
  });
  return best;
}
function onPointerDown(evt){
  if(evt.pointerType==='mouse' && evt.button!==0) return;
  const p=arenaPoint(evt);
  if(state.editing){
    const id=nearestHorseAt(p,state.editing.horseIds,state.editing.positions);
    if(id!=null){ dragHorseId=id; pointerId=evt.pointerId; try{els.arenaSurface.setPointerCapture(evt.pointerId);}catch{} }
    evt.preventDefault(); return;
  }
  if(state.drawing){
    pointerId=evt.pointerId; state.pendingRaw=[{x:p.x,y:p.y}];
    try{els.arenaSurface.setPointerCapture(evt.pointerId);}catch{}
    renderDraft(); evt.preventDefault(); return;
  }
  if(!state.pendingRaw){
    const id=nearestHorseAt(p);
    if(id!=null){ toggleHorse(id); evt.preventDefault(); }
  }
}
function onPointerMove(evt){
  if(pointerId!==evt.pointerId) return;
  const p=arenaPoint(evt);
  if(dragHorseId!=null && state.editing){
    const b=editingBounds();
    state.editing.positions[dragHorseId]={x:clamp(p.x,b.minX,b.maxX),y:clamp(p.y,b.minY,b.maxY)};
    state.editing.preset='manual'; renderHorses(); renderFormationGuides(); evt.preventDefault(); return;
  }
  if(state.drawing && state.pendingRaw){
    const last=state.pendingRaw[state.pendingRaw.length-1];
    if(dist(last,p)>=3) state.pendingRaw.push({x:clamp(p.x,PATH_BOUNDS.minX,PATH_BOUNDS.maxX),y:clamp(p.y,PATH_BOUNDS.minY,PATH_BOUNDS.maxY)});
    renderDraft(); evt.preventDefault();
  }
}
function onPointerUp(evt){
  if(pointerId!==evt.pointerId) return;
  try{els.arenaSurface.releasePointerCapture(evt.pointerId);}catch{}
  if(dragHorseId!=null){ dragHorseId=null; pointerId=null; return; }
  if(state.drawing) finishStroke();
}

function toggleHorse(id){
  if(state.editing || state.drawing || state.pendingRaw) return;
  if(state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
  renderRoster(); renderHorses(); renderControls();
}
function selectBy(kind){
  if(state.editing || state.drawing || state.pendingRaw) return;
  if(kind==='all') state.selected=new Set(allIds());
  else if(kind==='none') state.selected.clear();
  else if(kind==='odd') state.selected=new Set(allIds().filter(id=>id%2));
  else state.selected=new Set(allIds().filter(id=>id%2===0));
  renderRoster(); renderHorses(); renderControls();
}

function renderRoutes(){
  els.routeLayer.replaceChildren();
  state.actions.forEach((action,aIndex)=>{
    action.horseIds.forEach(id=>{
      const pts=action.paths[id]; if(!pts || pts.length<2) return;
      const path=svgEl('path',{d:pathD(pts),class:`route-path${state.selected.has(id)?' selected':''}`,stroke:COLORS[(id-1)%COLORS.length]});
      path.dataset.action=String(aIndex); els.routeLayer.append(path);
    });
  });
}
function renderFormationGuides(){
  els.formationLayer.replaceChildren();
  if(!state.editing || state.editing.type!=='stop') return;
  const action=state.actions.find(a=>a.id===state.editing.actionId); if(!action) return;
  state.editing.horseIds.forEach(id=>{
    const pts=action.paths[id]; if(!pts?.length) return;
    const from=pts[pts.length-1],to=state.editing.positions[id];
    if(dist(from,to)>1) els.formationLayer.append(svgEl('path',{d:`M ${from.x} ${from.y} L ${to.x} ${to.y}`,class:'formation-guide'}));
  });
}
function horsePoseForRender(id){
  if(state.editing?.positions?.[id]) return {...state.editing.positions[id],angle:state.editing.heading||0};
  return poseAt(id,state.time);
}
function renderHorses(){
  els.horseLayer.replaceChildren();
  state.horses.forEach(h=>{
    const p=horsePoseForRender(h.id);
    const selected=state.selected.has(h.id), editing=!!state.editing?.horseIds?.includes(h.id);
    const g=svgEl('g',{class:`horse${selected?' selected':''}${editing?' editing':''}`,transform:`translate(${p.x} ${p.y}) rotate(${(p.angle||0)*180/Math.PI+90})`});
    g.append(svgEl('circle',{class:'select-ring',cx:0,cy:0,r:16}));
    g.append(svgEl('ellipse',{class:'body',cx:0,cy:0,rx:7.5,ry:11}));
    g.append(svgEl('circle',{class:'head',cx:0,cy:-12,r:4.6}));
    const text=svgEl('text',{class:'num',x:0,y:1,transform:'rotate(-90)'}); text.textContent=String(h.id); g.append(text);
    els.horseLayer.append(g);
  });
}
function renderDraft(){
  els.draftLayer.replaceChildren();
  if(!state.pendingRaw || state.pendingRaw.length<2) return;
  const guide=state.drawing?state.pendingRaw:guideForPreview();
  if(guide.length>=2) els.draftLayer.append(svgEl('path',{d:pathD(guide),class:'draft-path'}));
  if(!state.drawing){
    const built=translatedPathsForSelected();
    if(built) selectedIds().forEach(id=>els.draftLayer.append(svgEl('path',{d:pathD(built.paths[id]),class:'draft-copy',stroke:COLORS[(id-1)%COLORS.length]})));
  }
}
function renderRoster(){
  els.horseRoster.replaceChildren();
  state.horses.forEach(h=>{
    const b=document.createElement('button'); b.textContent=String(h.id); b.classList.toggle('active',state.selected.has(h.id));
    b.addEventListener('click',()=>toggleHorse(h.id)); els.horseRoster.append(b);
  });
  els.selectionSummary.textContent=selectionLabel();
}
function renderTimeline(){
  els.actionStrip.replaceChildren();
  const makeCard=(cls,title,sub,time)=>{
    const card=document.createElement('div'); card.className=`action-card ${cls}`; card.dataset.time=String(time||0);
    const strong=document.createElement('strong'); strong.textContent=title; const span=document.createElement('span'); span.textContent=sub;
    card.append(strong,span); card.addEventListener('click',()=>{stopPlayback();state.time=Number(card.dataset.time)||0;renderAll();}); return card;
  };
  if(state.formationSaved){ els.actionStrip.append(makeCard('start','Starting Formation',`${state.startingFormationName} · ${state.horses.length} horses`,0)); }
  let moves=0,stops=0;
  state.actions.forEach(action=>{
    if(action.type==='exit'){
      els.actionStrip.append(makeCard('exit','Exit','Same left-side gate',action.start)); return;
    }
    moves++;
    els.actionStrip.append(makeCard('move',`Movement ${moves}`,`${horseLabel(action.horseIds)} · ${action.mode==='mirror'?'mirrored':'same path'}`,action.start));
    if(action.stopFormation){ stops++; els.actionStrip.append(makeCard('stop',`Stop Formation ${stops}`,action.stopFormation.preset==='manual'?'Custom arrangement':presetName(action.stopFormation.preset),action.start+action.duration)); }
  });
  if(!els.actionStrip.children.length){ const e=document.createElement('div');e.className='empty-action';e.textContent='1. Save the starting formation → 2. Draw movement → 3. Set stop formation → repeat.';els.actionStrip.append(e); }
  els.actionCount.textContent=state.formationSaved?`${moves} movement${moves===1?'':'s'} · ${stops} stop${stops===1?'':'s'}`:'Starting formation not saved';
  const duration=totalDuration(); els.timeline.max=String(Math.max(1,duration)); els.timeline.value=String(clamp(state.time,0,Math.max(1,duration))); els.timeLabel.textContent=fmtTime(state.time); els.durationLabel.textContent=fmtTime(duration);
}
function renderFormationBanner(){
  if(!state.editing){ els.formationBanner.classList.add('hidden'); return; }
  els.formationBanner.classList.remove('hidden');
  if(state.editing.type==='start'){
    els.formationBannerTitle.textContent='STEP 1 — SET STARTING FORMATION';
    els.formationBannerText.textContent='The horses are in the chute. Choose a preset or drag them into the exact lineup, then save.';
  } else {
    els.formationBannerTitle.textContent='SET THE STOP FORMATION';
    els.formationBannerText.textContent='Drag the stopped horses into the exact formation they should hold, then save.';
  }
}
function renderControls(){
  els.horseCountLabel.textContent=String(state.horses.length);
  els.formationStatus.textContent=state.formationSaved?`Saved · ${state.startingFormationName}`:'Not saved yet';
  els.formationStatus.classList.toggle('saved',state.formationSaved); els.formationStatus.classList.toggle('unsaved',!state.formationSaved);
  els.horseMinus.disabled=!!state.actions.length; els.horsePlus.disabled=!!state.actions.length;
  els.editFormationBtn.disabled=!!state.actions.length; els.editFormationBtn.textContent=state.formationSaved?'Edit Starting Formation':'Arrange Starting Formation';
  document.querySelectorAll('#formationPresets button').forEach(b=>{
    const activePreset=state.editing?.preset==='manual'?null:(state.editing?.preset||state.formationPreset);
    b.classList.toggle('active',b.dataset.preset===activePreset);
  });
  document.querySelectorAll('#movementMode button').forEach(b=>b.classList.toggle('active',b.dataset.mode===state.movementMode));
  const blocked=!state.formationSaved||!!state.editing||state.finished||!state.selected.size;
  els.drawBtn.disabled=blocked; els.drawBtn.classList.toggle('disabled',blocked);
  els.exitBtn.disabled=!state.formationSaved||!!state.editing||state.finished||state.drawing||!!state.pendingRaw;
  els.undoBtn.disabled=!state.actions.length&&!state.formationSaved&&!state.editing;
  els.selectionSummary.textContent=selectionLabel();
}
function renderStatus(){
  if(state.editing){
    els.statusPill.textContent=state.editing.type==='start'?'Starting formation':'Stop formation';
    els.stageInstruction.textContent=state.editing.type==='start'?'Step 1: arrange the team in the chute and save the formation.':'Arrange exactly how the selected horses stop, then save the formation.';
  } else if(state.drawing){
    els.statusPill.textContent='Drawing movement'; els.stageInstruction.textContent='Draw the path the selected horses should follow.';
  } else if(state.pendingRaw){
    els.statusPill.textContent='Review movement'; els.stageInstruction.textContent='Choose Keep Moving or Stop + Set Formation.';
  } else if(state.finished){
    els.statusPill.textContent='Routine exits left'; els.stageInstruction.textContent='The routine finishes through the same left-side entrance / exit gate.';
  } else if(!state.formationSaved){
    els.statusPill.textContent='Starting formation'; els.stageInstruction.textContent='Step 1: set the starting formation in the chute.';
  } else {
    els.statusPill.textContent='Ready'; els.stageInstruction.textContent='Select the horses for the next movement, then draw where they go.';
  }
  els.routineName.textContent=state.name;
  els.emptyHelp.classList.toggle('hidden',!!state.formationSaved||!!state.editing||state.drawing||!!state.pendingRaw);
}
function renderAll(){ renderControls();renderRoster();renderRoutes();renderFormationGuides();renderHorses();renderDraft();renderTimeline();renderFormationBanner();renderStatus(); }

function stopPlayback(){ if(state.raf) cancelAnimationFrame(state.raf); state.raf=0; state.playing=false; els.playBtn.innerHTML='▶ <span>PLAY</span>'; }
function play(){
  const duration=totalDuration(); if(duration<=0){showToast('Add a movement first.');return;}
  if(state.editing||state.drawing||state.pendingRaw){showToast('Finish the current edit first.');return;}
  if(state.playing){stopPlayback();return;}
  if(state.time>=duration-.02) state.time=0;
  state.playing=true; state.lastFrame=performance.now(); els.playBtn.innerHTML='Ⅱ <span>PAUSE</span>';
  const tick=now=>{
    if(!state.playing)return;
    state.time+=Math.min(.05,(now-state.lastFrame)/1000); state.lastFrame=now;
    if(state.time>=duration){state.time=duration;stopPlayback();renderAll();return;}
    renderHorses();renderTimeline(); state.raf=requestAnimationFrame(tick);
  };
  state.raf=requestAnimationFrame(tick);
}
function restart(){ stopPlayback(); state.time=0; renderAll(); }

function serializable(){
  return {
    version:1,name:state.name,formationPreset:state.formationPreset,formationSaved:state.formationSaved,startingFormationName:state.startingFormationName,
    horses:state.horses,actions:state.actions,movementMode:state.movementMode,finished:state.finished
  };
}
function saveLocal(){ localStorage.setItem(STORE,JSON.stringify(serializable())); showToast('Routine saved on this device.'); }
function loadLocal(){
  try{
    const raw=localStorage.getItem(STORE); if(!raw)return false;
    const data=JSON.parse(raw); if(data?.version!==1||!Array.isArray(data.horses))return false;
    state=freshState(Math.max(1,data.horses.length));
    state.name=data.name||'My Rodeo Routine'; state.formationPreset=data.formationPreset||'two'; state.formationSaved=!!data.formationSaved; state.startingFormationName=data.startingFormationName||presetName(state.formationPreset);
    state.horses=data.horses.map(h=>({id:h.id,start:{x:h.start.x,y:h.start.y}})); state.actions=Array.isArray(data.actions)?data.actions:[]; state.movementMode=data.movementMode||'together'; state.finished=!!data.finished;
    state.selected=new Set(state.horses.map(h=>h.id)); state.editing=state.formationSaved?null:freshState(state.horses.length).editing; state.time=0; state.playing=false; state.pendingRaw=null; state.drawing=false;
    return true;
  }catch{return false;}
}
function exportRoutine(){
  const blob=new Blob([JSON.stringify({
    ...serializable(),
    gate:'single left-side entrance and exit',
    workflow:'starting formation -> movement -> optional stop formation -> movement -> exit through left gate'
  },null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='rodeo-routine.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function resetRoutine(){ stopPlayback(); localStorage.removeItem(STORE); state=freshState(12); clearDrawing(); renderAll(); }
function showToast(message){ clearTimeout(toastTimer); els.toast.textContent=message; els.toast.classList.add('show'); toastTimer=setTimeout(()=>els.toast.classList.remove('show'),2200); }

els.horseMinus.addEventListener('click',()=>setHorseCount(state.horses.length-1));
els.horsePlus.addEventListener('click',()=>setHorseCount(state.horses.length+1));
els.formationPresets.addEventListener('click',e=>{const b=e.target.closest('button[data-preset]');if(b)applyFormationPreset(b.dataset.preset);});
els.editFormationBtn.addEventListener('click',()=>beginStartFormation(state.formationPreset));
els.saveFormationBtn.addEventListener('click',saveFormation); els.cancelFormationBtn.addEventListener('click',cancelFormation);
els.selectAllBtn.addEventListener('click',()=>selectBy('all')); els.selectNoneBtn.addEventListener('click',()=>selectBy('none')); els.selectOddBtn.addEventListener('click',()=>selectBy('odd')); els.selectEvenBtn.addEventListener('click',()=>selectBy('even'));
els.movementMode.addEventListener('click',e=>{const b=e.target.closest('button[data-mode]');if(!b)return;state.movementMode=b.dataset.mode;renderControls();});
els.drawBtn.addEventListener('click',beginDraw); els.retryBtn.addEventListener('click',retryDraw); els.continueBtn.addEventListener('click',()=>commitPending(false)); els.stopBtn.addEventListener('click',()=>commitPending(true));
els.cleanupChoice.addEventListener('click',e=>{const b=e.target.closest('button[data-cleanup]');if(b)setCleanup(b.dataset.cleanup);});
els.exitBtn.addEventListener('click',exitRoutine); els.undoBtn.addEventListener('click',undoLast);
els.newBtn.addEventListener('click',resetRoutine); els.saveBtn.addEventListener('click',saveLocal); els.exportBtn.addEventListener('click',exportRoutine);
els.playBtn.addEventListener('click',play); els.restartBtn.addEventListener('click',restart);
els.timeline.addEventListener('input',()=>{stopPlayback();state.time=Number(els.timeline.value)||0;renderHorses();renderTimeline();});
els.arenaSurface.addEventListener('pointerdown',onPointerDown); els.arenaSurface.addEventListener('pointermove',onPointerMove); els.arenaSurface.addEventListener('pointerup',onPointerUp); els.arenaSurface.addEventListener('pointercancel',onPointerUp);

document.addEventListener('gesturestart',e=>e.preventDefault(),{passive:false});
document.addEventListener('gesturechange',e=>e.preventDefault(),{passive:false});
document.addEventListener('gestureend',e=>e.preventDefault(),{passive:false});
document.addEventListener('dblclick',e=>e.preventDefault(),{passive:false});

if(!loadLocal()) state=freshState(12);
renderAll();
})();