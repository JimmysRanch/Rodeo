(() => {
'use strict';
const SVG='http://www.w3.org/2000/svg';
const STORE='rodeo-draw-first-v1';
const COLORS=['#e9b34b','#60a5fa','#ef7770','#69c38d'];
const $=id=>document.getElementById(id);
const els={};
['lineCount','horsesPerLine','horseGap','pace','motionMode','drawBtn','holdBtn','exitBtn','polishBtn','undoBtn','newBtn','saveBtn','exportBtn','restartBtn','playBtn','routineName','teamSummary','statusPill','arena','arenaSurface','routeLayer','startLayer','draftLayer','horseLayer','emptyMessage','drawMessage','reviewBar','reviewHint','cleanupChoice','retryBtn','useBtn','timeline','timeLabel','durationLabel','stepCount','stepStrip','toast'].forEach(id=>els[id]=$(id));
let state={
lines:2,horses:6,gapFt:26,pace:'show',mode:'mirror',steps:[],name:'New Routine',
time:0,duration:0,playing:false,last:0,raf:0,
routes:[],segments:[],endpoints:[],
drawing:false,pointerId:null,pointerStart:null,rawDelta:[],draftCleanup:'smooth',draftProcessed:[],
};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
const clonePts=p=>p.map(q=>({x:q.x,y:q.y}));
const slotValues=n=>n===1?[0]:n===2?[-.5,.5]:n===3?[-1,0,1]:[-1.5,-.5,.5,1.5];
const laneGap=()=>state.lines===4?30:36;
const startPositions=()=>slotValues(state.lines).map(s=>({x:120,y:280+s*laneGap()}));
const speedPx=()=>state.pace==='walk'?72:state.pace==='fast'?118:94;
const spacingPx=()=>state.gapFt*2.8;
const horseHeadway=()=>spacingPx()/speedPx();
function svgEl(tag,attrs={}){const e=document.createElementNS(SVG,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));return e;}
function pathD(points){return points.map((p,i)=>(i?'L':'M')+` ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');}
function linePoints(a,b,steps=12){const out=[];for(let i=0;i<=steps;i++){const t=i/steps;out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}return out;}
function pathLength(points){let n=0;for(let i=1;i<points.length;i++)n+=dist(points[i-1],points[i]);return n;}
function segmentMeta(points,type='move',hold=0){const cum=[0];let total=0;for(let i=1;i<points.length;i++){total+=dist(points[i-1],points[i]);cum.push(total);}return{points,cum,total,type,hold};}
function pointOn(seg,t){
if(seg.type==='hold')return{...seg.points[0],angle:0};
if(seg.total<.001)return{...seg.points[0],angle:0};
const d=clamp(t,0,1)*seg.total;let i=1;while(i<seg.cum.length&&seg.cum[i]<d)i++;i=Math.min(i,seg.points.length-1);
const a=seg.points[i-1],b=seg.points[i],base=seg.cum[i-1],len=Math.max(.001,seg.cum[i]-base),u=(d-base)/len;
return{x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u,angle:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI};
}
function formatTime(s){s=Math.max(0,s||0);return`${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;}
function resample(points,spacing=10){
if(points.length<2)return clonePts(points);
const out=[{...points[0]}];let carry=0;
for(let i=1;i<points.length;i++){
let a={...points[i-1]},b=points[i],seg=dist(a,b);
if(seg<.01)continue;
while(carry+seg>=spacing){
const t=(spacing-carry)/seg;
a={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
out.push({...a});seg=dist(a,b);carry=0;
}
carry+=seg;
}
const last=points[points.length-1];
if(dist(out[out.length-1],last)>2)out.push({...last});
return out;
}
function rdp(points,epsilon=5){
if(points.length<3)return clonePts(points);
const first=points[0],last=points[points.length-1];
const dx=last.x-first.x,dy=last.y-first.y,den=Math.max(.001,Math.hypot(dx,dy));
let max=0,index=0;
for(let i=1;i<points.length-1;i++){
const p=points[i],d=Math.abs(dy*p.x-dx*p.y+last.x*first.y-last.y*first.x)/den;
if(d>max){max=d;index=i;}
}
if(max>epsilon){
const left=rdp(points.slice(0,index+1),epsilon),right=rdp(points.slice(index),epsilon);
return left.slice(0,-1).concat(right);
}
return[{...first},{...last}];
}
function catmull(points,steps=6){
if(points.length<3)return clonePts(points);
const out=[];
for(let i=0;i<points.length-1;i++){
const p0=points[Math.max(0,i-1)],p1=points[i],p2=points[i+1],p3=points[Math.min(points.length-1,i+2)];
for(let s=0;s<(i===points.length-2?steps+1:steps);s++){
const t=s/steps,t2=t*t,t3=t2*t;
out.push({
x:.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
y:.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3)
});
}
}
out[0]={...points[0]};out[out.length-1]={...points[points.length-1]};
return out;
}
function lineDeviation(points){
if(points.length<3)return 0;
const a=points[0],b=points[points.length-1],dx=b.x-a.x,dy=b.y-a.y,den=Math.max(.001,Math.hypot(dx,dy));
let sum=0,max=0;
for(const p of points){const d=Math.abs(dy*p.x-dx*p.y+b.x*a.y-b.y*a.x)/den;sum+=d;max=Math.max(max,d);}
return{avg:sum/points.length,max};
}
function smoothDelta(raw){
if(raw.length<2)return clonePts(raw);
const sampled=resample(raw,9);
const simplified=rdp(sampled,5.5);
if(simplified.length===2)return linePoints(simplified[0],simplified[1],16);
return catmull(simplified,7);
}
function smartPolish(raw){
if(raw.length<2)return clonePts(raw);
const dev=lineDeviation(raw),chord=dist(raw[0],raw[raw.length-1]),length=pathLength(raw);
if(chord>70 && dev.max<15 && length/chord<1.10)return linePoints(raw[0],raw[raw.length-1],18);
return smoothDelta(raw);
}
function processedDraft(){
if(state.draftCleanup==='raw')return clonePts(state.rawDelta);
if(state.draftCleanup==='straight'){
const end=state.rawDelta[state.rawDelta.length-1]||{x:120,y:0};
return linePoints({x:0,y:0},end,18);
}
return smoothDelta(state.rawDelta);
}
function transformDelta(delta,current,lineIndex,mode){
if(mode==='together'){
return delta.map(p=>({x:clamp(current.x+p.x,58,942),y:clamp(current.y+p.y,58,502)}));
}
const slots=slotValues(state.lines),slot=slots[lineIndex];
const sign=slot<0?1:slot>0?-1:0;
const strength=slot===0?0:1;
return delta.map(p=>({x:clamp(current.x+p.x,58,942),y:clamp(current.y+p.y*sign*strength,58,502)}));
}
function buildRoutes(){
const starts=startPositions();
state.routes=[];state.segments=[];state.endpoints=[];
let totalDuration=0;
for(let li=0;li<state.lines;li++){
const entryStart={x:48,y:starts[li].y},entryEnd={...starts[li]};
let current={...entryEnd},route=linePoints(entryStart,entryEnd,10),segs=[segmentMeta(route,'entry')];
for(const step of state.steps){
if(step.type==='draw'){
const pts=transformDelta(step.points,current,li,step.mode);
if(pts.length && dist(current,pts[0])>1)pts.unshift({...current});
const seg=segmentMeta(pts,'move');segs.push(seg);route.push(...pts.slice(1));current=pts[pts.length-1]||current;
}else if(step.type==='hold'){
const pts=[{...current},{...current}];segs.push(segmentMeta(pts,'hold',step.seconds));route.push({...current});
}else if(step.type==='exit'){
const target={x:948,y:current.y},pts=linePoints(current,target,16);segs.push(segmentMeta(pts,'exit'));route.push(...pts.slice(1));current=target;
}
}
state.routes.push(route);state.segments.push(segs);state.endpoints.push(current);
}
const segs=state.segments[0]||[];
totalDuration=segs.reduce((sum,s)=>sum+(s.type==='hold'?s.hold:Math.max(.55,s.total/speedPx())),0);
state.duration=totalDuration+(state.horses-1)*horseHeadway()+1;
state.time=clamp(state.time,0,state.duration||0);
}
function linePhase(lineIndex){
if(state.lines<=1)return 0;
return (lineIndex%2)*horseHeadway()*.5 + Math.floor(lineIndex/2)*horseHeadway()*.12;
}
function routePose(lineIndex,time,horseIndex){
const t=time-horseIndex*horseHeadway()-linePhase(lineIndex);
if(t<0)return null;
const segs=state.segments[lineIndex]||[];
let cursor=0;
for(const seg of segs){
const dur=seg.type==='hold'?seg.hold:Math.max(.55,seg.total/speedPx());
if(t<=cursor+dur){
const u=dur?((t-cursor)/dur):1;
return pointOn(seg,u);
}
cursor+=dur;
}
return null;
}
function renderRoutes(){
els.routeLayer.replaceChildren();
state.routes.forEach((pts,i)=>{
if(pts.length<2)return;
els.routeLayer.appendChild(svgEl('path',{d:pathD(pts),class:'route-shadow'}));
els.routeLayer.appendChild(svgEl('path',{d:pathD(pts),class:'route-path',stroke:COLORS[i]}));
});
}
function renderStartDots(){
els.startLayer.replaceChildren();
const points=state.endpoints.length?state.endpoints:startPositions();
points.forEach((p,i)=>{
const c=svgEl('circle',{cx:p.x,cy:p.y,r:6,fill:COLORS[i],class:'current-dot'});els.startLayer.appendChild(c);
});
if(state.drawing && points[0]){
const t=svgEl('text',{x:points[0].x+10,y:points[0].y-10,class:'current-label'});t.textContent='NEXT START';els.startLayer.appendChild(t);
}
}
function renderDraft(){
els.draftLayer.replaceChildren();
if(!state.rawDelta.length)return;
const pts=processedDraft();state.draftProcessed=pts;
const currents=state.endpoints.length?state.endpoints:startPositions();
currents.forEach((cur,li)=>{
const transformed=transformDelta(pts,cur,li,state.mode);
els.draftLayer.appendChild(svgEl('path',{d:pathD(transformed),class:'draft-copy',stroke:COLORS[li]}));
});
}
function renderHorses(){
els.horseLayer.replaceChildren();
for(let li=0;li<state.lines;li++){
for(let h=0;h<state.horses;h++){
const p=routePose(li,state.time,h);if(!p)continue;
const g=svgEl('g',{class:'horse',transform:`translate(${p.x} ${p.y}) rotate(${p.angle+90})`});
const body=svgEl('ellipse',{cx:0,cy:0,rx:7.2,ry:10.5,fill:COLORS[li],class:'horse-body'});
const head=svgEl('circle',{cx:0,cy:-11.8,r:3.6,class:'horse-head'});
const txt=svgEl('text',{x:0,y:.5,class:'horse-num'});txt.textContent=h+1;
g.append(body,head,txt);els.horseLayer.appendChild(g);
}
}
}
function renderSteps(){
els.stepStrip.replaceChildren();
if(!state.steps.length){
const e=document.createElement('div');e.className='empty-step';e.textContent='Your movements will appear here in order.';els.stepStrip.appendChild(e);
}else{
state.steps.forEach((s,i)=>{
const card=document.createElement('div');card.className='step-card'+(s.polished?' polished':'');
const title=s.type==='draw'?(s.mode==='mirror'?'Mirrored movement':'Together movement'):s.type==='hold'?'5-sec stop':'Exit right';
const sub=s.type==='draw'?(s.style==='raw'?'kept as drawn':s.style==='straight'?'perfect straight':'smoothed'):(s.type==='hold'?'all horses hold':'finish');
card.innerHTML=`<b>${i+1}. ${title}</b><span>${sub}</span><button data-remove="${i}" aria-label="Remove movement">×</button>`;
els.stepStrip.appendChild(card);
});
}
els.stepCount.textContent=`${state.steps.length} movement${state.steps.length===1?'':'s'}`;
}
function renderUI(){
buildRoutes();renderRoutes();renderStartDots();renderHorses();renderSteps();
els.emptyMessage.classList.toggle('hidden',state.steps.length>0||state.drawing||state.rawDelta.length>0);
els.teamSummary.textContent=`${state.lines} line${state.lines===1?'':'s'} · ${state.horses} horses each · ${state.gapFt} ft gap · enters LEFT gate`;
els.statusPill.textContent=state.drawing?'Drawing…':state.rawDelta.length?'Review movement':state.steps.length?'Ready to play':'Ready to draw';
els.timeline.max=Math.max(.01,state.duration);els.timeline.value=state.time;els.timeLabel.textContent=formatTime(state.time);els.durationLabel.textContent=formatTime(state.duration);
document.querySelectorAll('#lineCount [data-lines]').forEach(b=>b.classList.toggle('active',Number(b.dataset.lines)===state.lines));
document.querySelectorAll('#motionMode [data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===state.mode));
els.horsesPerLine.value=state.horses;els.horseGap.value=state.gapFt;els.pace.value=state.pace;
els.playBtn.innerHTML=state.playing?'❚❚ <span>PAUSE</span>':'▶ <span>PLAY</span>';
}
function toast(msg){els.toast.textContent=msg;els.toast.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.classList.remove('show'),1600);}
function stop(){state.playing=false;if(state.raf)cancelAnimationFrame(state.raf);state.raf=0;}
function play(){
if(!state.steps.length){toast('Draw at least one movement first');return;}
if(state.playing){stop();renderUI();return;}
if(state.time>=state.duration-.05)state.time=0;
state.playing=true;state.last=performance.now();tick(state.last);
}
function tick(now){
if(!state.playing)return;
state.time+=(now-state.last)/1000;state.last=now;
if(state.time>=state.duration){state.time=state.duration;stop();}
renderHorses();els.timeline.value=state.time;els.timeLabel.textContent=formatTime(state.time);els.playBtn.innerHTML=state.playing?'❚❚ <span>PAUSE</span>':'▶ <span>PLAY</span>';
if(state.playing)state.raf=requestAnimationFrame(tick);
}
function arenaPoint(evt){
const r=els.arena.getBoundingClientRect();
return{x:(evt.clientX-r.left)/r.width*1000,y:(evt.clientY-r.top)/r.height*560};
}
function beginDraw(){
stop();state.drawing=true;state.rawDelta=[];state.pointerStart=null;state.draftCleanup='smooth';state.time=0;
els.drawBtn.classList.add('active');els.drawMessage.classList.remove('hidden');els.reviewBar.classList.add('hidden');
els.cleanupChoice.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.cleanup==='smooth'));
renderUI();
}
function cancelDraft(){
state.drawing=false;state.rawDelta=[];state.pointerStart=null;state.pointerId=null;state.draftProcessed=[];
els.drawBtn.classList.remove('active');els.drawMessage.classList.add('hidden');els.reviewBar.classList.add('hidden');renderUI();
}
function finishStroke(){
if(state.rawDelta.length<2 || pathLength(state.rawDelta)<18){cancelDraft();toast('Draw a little farther');return;}
state.drawing=false;state.draftCleanup='smooth';els.drawBtn.classList.remove('active');els.drawMessage.classList.add('hidden');els.reviewBar.classList.remove('hidden');renderDraft();renderStartDots();els.statusPill.textContent='Review movement';
}
function useDraft(){
if(state.rawDelta.length<2)return;
const pts=processedDraft();
state.steps.push({type:'draw',mode:state.mode,points:pts,style:state.draftCleanup,polished:state.draftCleanup!=='raw'});
state.name='My Rodeo Routine';els.routineName.textContent=state.name;
state.rawDelta=[];state.draftProcessed=[];els.reviewBar.classList.add('hidden');state.time=0;renderUI();toast('Movement added');
}
function polishWhole(){
stop();let changed=0;
state.steps=state.steps.map(s=>{
if(s.type!=='draw')return s;
const polished=smartPolish(s.points);
changed++;return{...s,points:polished,style:(lineDeviation(polished).max<2?'straight':'smooth'),polished:true};
});
state.time=0;renderUI();toast(changed?`Polished ${changed} movement${changed===1?'':'s'}`:'Nothing to polish yet');
}
function addHold(){stop();state.steps.push({type:'hold',seconds:5});state.time=0;renderUI();toast('5-second stop added');}
function addExit(){stop();if(state.steps.some(s=>s.type==='exit')){toast('Exit is already in the routine');return;}state.steps.push({type:'exit'});state.time=0;renderUI();toast('Exit added');}
function reset(){stop();state.steps=[];state.name='New Routine';els.routineName.textContent=state.name;state.time=0;cancelDraft();renderUI();}
function save(){
const data={version:1,lines:state.lines,horses:state.horses,gapFt:state.gapFt,pace:state.pace,mode:state.mode,steps:state.steps,name:state.name};
localStorage.setItem(STORE,JSON.stringify(data));toast('Routine saved on this device');
}
function load(){
try{
const d=JSON.parse(localStorage.getItem(STORE)||'null');if(!d)return;
state.lines=clamp(Number(d.lines)||2,1,4);state.horses=Number(d.horses)||6;state.gapFt=Number(d.gapFt)||26;state.pace=d.pace||'show';state.mode=d.mode||'mirror';
state.steps=Array.isArray(d.steps)?d.steps:[];state.name=d.name||'Saved Routine';els.routineName.textContent=state.name;
}catch{}
}
function exportRoutine(){
const data={version:1,name:state.name,lines:state.lines,horsesPerLine:state.horses,horseGapFt:state.gapFt,pace:state.pace,steps:state.steps};
const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
a.href=url;a.download='rodeo-routine.json';a.click();URL.revokeObjectURL(url);toast('Routine exported');
}
els.lineCount.addEventListener('click',e=>{const b=e.target.closest('[data-lines]');if(!b)return;stop();state.lines=Number(b.dataset.lines);if(state.lines===1)state.mode='together';state.time=0;renderUI();});
els.motionMode.addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(!b)return;if(state.lines===1&&b.dataset.mode==='mirror'){toast('Mirror needs at least 2 lines');return;}state.mode=b.dataset.mode;renderUI();});
els.horsesPerLine.addEventListener('change',()=>{stop();state.horses=Number(els.horsesPerLine.value);state.time=0;renderUI();});
els.horseGap.addEventListener('change',()=>{stop();state.gapFt=Number(els.horseGap.value);state.time=0;renderUI();});
els.pace.addEventListener('change',()=>{stop();state.pace=els.pace.value;state.time=0;renderUI();});
els.drawBtn.addEventListener('click',()=>state.drawing?cancelDraft():beginDraw());
els.holdBtn.addEventListener('click',addHold);els.exitBtn.addEventListener('click',addExit);els.polishBtn.addEventListener('click',polishWhole);
els.undoBtn.addEventListener('click',()=>{stop();if(state.steps.length){state.steps.pop();state.time=0;renderUI();}});
els.newBtn.addEventListener('click',reset);els.saveBtn.addEventListener('click',save);els.exportBtn.addEventListener('click',exportRoutine);
els.restartBtn.addEventListener('click',()=>{stop();state.time=0;renderUI();});els.playBtn.addEventListener('click',play);
els.timeline.addEventListener('input',()=>{stop();state.time=Number(els.timeline.value)||0;renderHorses();els.timeLabel.textContent=formatTime(state.time);});
els.stepStrip.addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(!b)return;stop();state.steps.splice(Number(b.dataset.remove),1);state.time=0;renderUI();});
els.cleanupChoice.addEventListener('click',e=>{const b=e.target.closest('[data-cleanup]');if(!b)return;state.draftCleanup=b.dataset.cleanup;els.cleanupChoice.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));els.reviewHint.textContent=state.draftCleanup==='raw'?'Exactly what you drew.':state.draftCleanup==='straight'?'Turns this movement into one perfect straight run.':'Smooth removes finger wobble.';renderDraft();});
els.retryBtn.addEventListener('click',beginDraw);els.useBtn.addEventListener('click',useDraft);
els.arenaSurface.addEventListener('pointerdown',e=>{
if(!state.drawing)return;e.preventDefault();els.arenaSurface.setPointerCapture(e.pointerId);state.pointerId=e.pointerId;state.pointerStart=arenaPoint(e);state.rawDelta=[{x:0,y:0}];renderDraft();
});
els.arenaSurface.addEventListener('pointermove',e=>{
if(!state.drawing||state.pointerId!==e.pointerId||!state.pointerStart)return;e.preventDefault();const p=arenaPoint(e),d={x:p.x-state.pointerStart.x,y:p.y-state.pointerStart.y};const last=state.rawDelta[state.rawDelta.length-1];if(!last||dist(last,d)>3){state.rawDelta.push(d);renderDraft();}
});
els.arenaSurface.addEventListener('pointerup',e=>{if(state.pointerId!==e.pointerId)return;e.preventDefault();state.pointerId=null;finishStroke();});
els.arenaSurface.addEventListener('pointercancel',()=>cancelDraft());
load();renderUI();
})();