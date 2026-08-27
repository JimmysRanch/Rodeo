(() => {
'use strict';

const SVG='http://www.w3.org/2000/svg';
const STORE='rodeo-formation-workflow-v2';
const COLORS=['#e3aa43','#6aa9f8','#78c28a','#e47972','#b58af2','#61c9c0','#f0995b','#d6d36b'];
const ARENA={minX:205,maxX:938,minY:68,maxY:492};
const CHUTE={minX:42,maxX:176,minY:232,maxY:328};
const GATE={minY:238,maxY:322,trackY:280};
const SPEED=46;
const FOLLOW_GAP_PX=38;

const ids=[
'horseMinus','horsePlus','horseCountLabel','formationPresets','editFormationBtn','formationStatus',
'selectAllBtn','selectNoneBtn','selectOddBtn','selectEvenBtn','horseRoster','selectionSummary','movementMode','drawBtn',
'exitBtn','undoBtn','newBtn','saveBtn','exportBtn','routineName','stageInstruction','statusPill','restartBtn','playBtn',
'arena','arenaSurface','routeLayer','formationLayer','draftLayer','horseLayer','emptyHelp','drawHelp',
'formationBanner','formationBannerTitle','formationBannerText','cancelFormationBtn','saveFormationBtn',
'reviewBar','reviewText','cleanupChoice','retryBtn','continueBtn','stopBtn',
'actionCount','timeLabel','durationLabel','timeline','actionStrip','toast'];
const els={}; ids.forEach(id=>els[id]=document.getElementById(id));

let state,pointerId=null,dragHorseId=null,toastTimer=0,drawPointerStart=null;

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const dist=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
const deepPoints=pts=>pts.map(p=>({x:p.x,y:p.y}));
const allIds=()=>state.horses.map(h=>h.id);
const selectedIds=()=>[...state.selected].sort((a,b)=>a-b);
const horseById=id=>state.horses.find(h=>h.id===id);
const fmtTime=sec=>`${Math.floor(Math.max(0,sec)/60)}:${Math.floor(Math.max(0,sec)%60).toString().padStart(2,'0')}`;
function svgEl(tag,attrs={}){const el=document.createElementNS(SVG,tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));return el;}
const pathD=pts=>pts.map((p,i)=>`${i?'L':'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
function average(points){if(!points.length)return{x:574,y:280};return points.reduce((a,p)=>({x:a.x+p.x/points.length,y:a.y+p.y/points.length}),{x:0,y:0});}
function meta(points){const cum=[0];let total=0;for(let i=1;i<points.length;i++){total+=dist(points[i-1],points[i]);cum.push(total);}return{cum,total};}
function pointOn(points,progress){
 if(!points?.length)return{x:166,y:280,angle:0};
 if(points.length===1)return{...points[0],angle:0};
 const m=meta(points); if(m.total<.001)return{...points[0],angle:0};
 const target=clamp(progress,0,1)*m.total; let i=1; while(i<m.cum.length&&m.cum[i]<target)i++; i=Math.min(i,points.length-1);
 const a=points[i-1],b=points[i],base=m.cum[i-1],len=Math.max(.001,m.cum[i]-base),t=(target-base)/len;
 return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle:Math.atan2(b.y-a.y,b.x-a.x)};
}

function localFormationSlots(ids,preset){
 const slots=[];
 if(preset==='lead'){
   if(ids.length)slots.push({id:ids[0],row:0,colOffset:0});
   ids.slice(1).forEach((id,i)=>slots.push({id,row:1+Math.floor(i/2),colOffset:i%2?-0.5:0.5}));
   return slots;
 }
 const wide=preset==='four'?4:preset==='two'?2:1;
 ids.forEach((id,i)=>{const row=Math.floor(i/wide),inRow=i%wide,count=Math.min(wide,ids.length-row*wide);slots.push({id,row,colOffset:inRow-(count-1)/2});});
 return slots;
}
function formationLayout(ids,preset,center,heading,forChute=false){
 const slots=localFormationSlots(ids,preset),rows=slots.reduce((m,s)=>Math.max(m,s.row),0)+1;
 const sideGap=preset==='four'?22:28; let rowGap=30;
 if(forChute&&rows>1)rowGap=Math.min(30,Math.max(9,(center.x-CHUTE.minX-4)/(rows-1)));
 const f={x:Math.cos(heading),y:Math.sin(heading)},r={x:-Math.sin(heading),y:Math.cos(heading)},out={};
 slots.forEach(s=>{
   let x=center.x-f.x*s.row*rowGap+r.x*s.colOffset*sideGap;
   let y=center.y-f.y*s.row*rowGap+r.y*s.colOffset*sideGap;
   if(forChute){x=clamp(x,CHUTE.minX,CHUTE.maxX);y=clamp(y,CHUTE.minY,CHUTE.maxY);}
   else{x=clamp(x,ARENA.minX+8,ARENA.maxX-8);y=clamp(y,ARENA.minY+8,ARENA.maxY-8);}
   out[s.id]={x,y};
 });
 return out;
}
function makeHorses(count,preset='two'){
 const ids=Array.from({length:count},(_,i)=>i+1),pos=formationLayout(ids,preset,{x:166,y:280},0,true);
 return ids.map(id=>({id,start:{...pos[id]}}));
}
function freshState(count=12){
 const formationPreset='two',horses=makeHorses(count,formationPreset),positions=Object.fromEntries(horses.map(h=>[h.id,{...h.start}]));
 return{version:2,horses,formationPreset,formationSaved:false,startingFormationName:'2 Wide',selected:new Set(horses.map(h=>h.id)),
 movementMode:'together',cleanup:'smooth',actions:[],editing:{type:'start',horseIds:horses.map(h=>h.id),positions,preset:formationPreset,heading:0,center:{x:166,y:280}},
 drawing:false,pendingRaw:null,time:0,playing:false,lastFrame:0,raf:0,finished:false,name:'New Routine'};
}
function totalDuration(){return state.actions.reduce((m,a)=>Math.max(m,a.start+a.duration),0);}
function poseAt(horseId,time){
 const horse=horseById(horseId); let current=horse?{...horse.start,angle:0}:{x:166,y:280,angle:0};
 for(const action of state.actions){
   if(!action.horseIds.includes(horseId))continue;
   const points=action.paths[horseId]; if(!points?.length)continue;
   const delay=action.delays?.[horseId]||0,travel=action.horseDurations?.[horseId]||action.travelDuration||action.duration;
   const start=action.start+delay,end=start+travel;
   if(time<start)return current;
   if(time<=end)return pointOn(points,(time-start)/Math.max(.001,travel));
   const last=points.at(-1),prev=points.at(-2)||last; current={x:last.x,y:last.y,angle:Math.atan2(last.y-prev.y,last.x-prev.x)};
 }
 return current;
}

function simplifyRdp(points,epsilon=2.6){
 if(points.length<3)return points.slice(); const first=points[0],last=points.at(-1),dx=last.x-first.x,dy=last.y-first.y,den=Math.hypot(dx,dy)||1;
 let max=0,idx=0; for(let i=1;i<points.length-1;i++){const p=points[i],d=Math.abs(dy*p.x-dx*p.y+last.x*first.y-last.y*first.x)/den;if(d>max){max=d;idx=i;}}
 if(max>epsilon){const l=simplifyRdp(points.slice(0,idx+1),epsilon),r=simplifyRdp(points.slice(idx),epsilon);return l.slice(0,-1).concat(r);}return[first,last];
}
function chaikin(points,passes=2){let out=points.slice();for(let p=0;p<passes;p++){if(out.length<3)break;const n=[out[0]];for(let i=0;i<out.length-1;i++){const a=out[i],b=out[i+1];n.push({x:a.x*.75+b.x*.25,y:a.y*.75+b.y*.25},{x:a.x*.25+b.x*.75,y:a.y*.25+b.y*.75});}n.push(out.at(-1));out=n;}return out;}
const smoothPath=pts=>pts.length<3?pts.slice():chaikin(simplifyRdp(pts),2);
const straightPath=pts=>pts.length?[pts[0],pts.at(-1)]:[];
const cleanupGuide=(pts,mode)=>mode==='raw'?pts.slice():mode==='straight'?straightPath(pts):smoothPath(pts);
function presetName(p){return p==='single'?'1 Wide':p==='two'?'2 Wide':p==='four'?'4 Wide':'Lead Center';}
function selectionLabel(ids=selectedIds()){if(!ids.length)return'No horses selected';if(ids.length===state.horses.length)return`All ${ids.length} horses selected`;if(ids.length===1)return`Horse ${ids[0]} selected`;if(ids.length<=6)return`Horses ${ids.join(', ')} selected`;return`${ids.length} horses selected`;}
function horseLabel(ids){if(ids.length===state.horses.length)return`All ${ids.length} horses`;if(ids.length===1)return`Horse ${ids[0]}`;if(ids.length<=4)return`Horses ${ids.join(', ')}`;return`${ids.length} horses`;}
function showToast(msg){clearTimeout(toastTimer);els.toast.textContent=msg;els.toast.classList.add('show');toastTimer=setTimeout(()=>els.toast.classList.remove('show'),1800);}

function constrainRoutinePath(points,startPose){
 let entered=startPose.x>=ARENA.minX; const out=[];
 for(const p0 of points){
   let p={...p0};
   if(entered){
     p.x=clamp(p.x,ARENA.minX+4,ARENA.maxX-4); p.y=clamp(p.y,ARENA.minY+4,ARENA.maxY-4);
   }else if(p.x>=ARENA.minX){
     entered=true; p.x=clamp(p.x,ARENA.minX+4,ARENA.maxX-4); p.y=clamp(p.y,ARENA.minY+4,ARENA.maxY-4);
   }else{
     p.x=clamp(p.x,CHUTE.minX,ARENA.minX); p.y=clamp(p.y,GATE.minY,GATE.maxY);
   }
   const prev=out.at(-1); if(!prev||dist(prev,p)>.4)out.push(p);
 }
 return out.length>1?out:[{...startPose},{...startPose,x:startPose.x+1}];
}
function guideForPreview(){return state.pendingRaw?cleanupGuide(state.pendingRaw,state.cleanup):[];}
function leaderOrder(ids,start){
 return ids.map(id=>({id,pose:poseAt(id,start)})).sort((a,b)=>{
   const aInside=a.pose.x>=ARENA.minX,bInside=b.pose.x>=ARENA.minX;
   if(aInside!==bInside)return aInside?-1:1;
   if(Math.abs(b.pose.x-a.pose.x)>2)return b.pose.x-a.pose.x;
   const ac=Math.abs(a.pose.y-GATE.trackY),bc=Math.abs(b.pose.y-GATE.trackY);
   return ac-bc||a.id-b.id;
 });
}
function buildFollowLeader(guide,ids,start){
 const ordered=leaderOrder(ids,start),leader=ordered[0],origin=guide[0];
 const trackStart=leader.pose.x<ARENA.minX?{x:ARENA.minX+12,y:GATE.trackY}:{x:leader.pose.x,y:leader.pose.y};
 let master=[trackStart,...guide.slice(1).map(p=>({x:trackStart.x+(p.x-origin.x),y:trackStart.y+(p.y-origin.y)}))];
 master=constrainRoutinePath(master,trackStart);
 const paths={},delays={},horseDurations={};
 ordered.forEach(({id,pose},index)=>{
   let path;
   if(dist(pose,trackStart)<4)path=deepPoints(master);
   else{
     const join=[{x:pose.x,y:pose.y}];
     if(pose.x<ARENA.minX){
       join.push({x:Math.min(ARENA.minX-4,Math.max(pose.x+12,CHUTE.maxX)),y:clamp(pose.y,GATE.minY,GATE.maxY)});
       join.push({x:trackStart.x,y:trackStart.y});
     }else join.push({x:trackStart.x,y:trackStart.y});
     path=join.concat(master.slice(1));
   }
   path=constrainRoutinePath(path,pose);
   paths[id]=path; delays[id]=index*(FOLLOW_GAP_PX/SPEED); horseDurations[id]=Math.max(1.1,meta(path).total/SPEED);
 });
 const duration=Math.max(...ordered.map(({id})=>delays[id]+horseDurations[id]));
 return{paths,delays,horseDurations,duration,leaderId:leader.id};
}
function buildMirror(guide,ids,start){
 const origin=guide[0],bases=ids.map(id=>({id,pose:poseAt(id,start)})),centerY=bases.reduce((s,b)=>s+b.pose.y,0)/bases.length;
 const paths={},delays={},horseDurations={};
 bases.forEach(({id,pose})=>{
   const sign=bases.length>1&&pose.y>centerY+1?-1:1;
   const raw=guide.map(p=>({x:pose.x+(p.x-origin.x),y:pose.y+(p.y-origin.y)*sign}));
   paths[id]=constrainRoutinePath(raw,pose); delays[id]=0; horseDurations[id]=Math.max(1.1,meta(paths[id]).total/SPEED);
 });
 const duration=Math.max(...Object.values(horseDurations));
 return{paths,delays,horseDurations,duration};
}
function buildPendingMove(){
 const guide=guideForPreview(),ids=selectedIds(); if(guide.length<2||!ids.length)return null;
 const start=totalDuration();
 const built=state.movementMode==='together'?buildFollowLeader(guide,ids,start):buildMirror(guide,ids,start);
 return{...built,start,horseIds:ids};
}

function setHorseCount(next){
 if(state.actions.length){showToast('Start a new routine to change horse count after choreography begins.');return;}
 const count=clamp(Math.round(next),1,60); if(count===state.horses.length)return;
 state.horses=makeHorses(count,state.formationPreset);state.selected=new Set(allIds());state.formationSaved=false;beginStartFormation(state.formationPreset);renderAll();
}
function beginStartFormation(preset=state.formationPreset){
 stopPlayback();clearDrawing();const ids=allIds(),positions=formationLayout(ids,preset,{x:166,y:280},0,true);
 state.editing={type:'start',horseIds:ids,positions,preset,heading:0,center:{x:166,y:280}};state.time=0;renderAll();
}
function averageHeadingForAction(action){
 let x=0,y=0,n=0;action.horseIds.forEach(id=>{const pts=action.paths[id];if(pts?.length>1){const a=pts.at(-2),b=pts.at(-1),l=Math.hypot(b.x-a.x,b.y-a.y)||1;x+=(b.x-a.x)/l;y+=(b.y-a.y)/l;n++;}});
 return n?Math.atan2(y,x):0;
}
function beginStopFormation(action){
 stopPlayback(); const ends=action.horseIds.map(id=>action.paths[id].at(-1)),center=average(ends),heading=averageHeadingForAction(action);
 const positions=formationLayout(action.horseIds,state.formationPreset,center,heading,false);
 state.editing={type:'stop',actionId:action.id,horseIds:action.horseIds.slice(),positions,preset:state.formationPreset,heading,center};state.time=action.start+action.duration;renderAll();
}
function applyFormationPreset(preset){
 if(!state.editing){if(!state.actions.length)beginStartFormation(preset);else showToast('Use Stop + Set Formation after a movement.');return;}
 state.editing.preset=preset;
 state.editing.positions=state.editing.type==='start'?formationLayout(state.editing.horseIds,preset,{x:166,y:280},0,true):formationLayout(state.editing.horseIds,preset,state.editing.center,state.editing.heading,false);
 renderAll();
}
function recomputeActionTiming(action){
 let max=0;action.horseIds.forEach(id=>{const d=Math.max(1.1,meta(action.paths[id]).total/SPEED);action.horseDurations[id]=d;max=Math.max(max,(action.delays[id]||0)+d);});action.duration=max;
}
function saveFormation(){
 const e=state.editing;if(!e)return;
 if(e.type==='start'){
   e.horseIds.forEach(id=>{const h=horseById(id);if(h)h.start={...e.positions[id]};});if(e.preset!=='manual')state.formationPreset=e.preset;
   state.startingFormationName=presetName(state.formationPreset);state.formationSaved=true;state.editing=null;state.selected=new Set(allIds());state.name='My Rodeo Routine';state.time=0;renderAll();showToast('Starting formation saved');
 }else{
   const a=state.actions.find(x=>x.id===e.actionId);if(!a)return;
   e.horseIds.forEach(id=>{let pts=a.paths[id];const end=e.positions[id];if(dist(pts.at(-1),end)>1)pts=pts.concat([{...end}]);else pts[pts.length-1]={...end};a.paths[id]=constrainRoutinePath(pts,pts[0]);});
   a.stopFormation=Object.fromEntries(e.horseIds.map(id=>[id,{...e.positions[id]}]));a.stopPreset=e.preset;recomputeActionTiming(a);
   state.editing=null;state.time=a.start+a.duration;renderAll();showToast('Stop formation saved');
 }
}
function cancelFormation(){
 if(state.editing?.type==='start'&&!state.formationSaved)return showToast('Save the starting formation first.');
 state.editing=null;renderAll();
}

function clearDrawing(){state.drawing=false;state.pendingRaw=null;pointerId=null;drawPointerStart=null;els.drawHelp.classList.add('hidden');els.reviewBar.classList.add('hidden');els.drawBtn.classList.remove('active');els.draftLayer.replaceChildren();}
function beginDraw(){
 if(!state.formationSaved)return showToast('Save the starting formation first.');
 if(state.editing)return showToast('Save the formation before drawing the next movement.');
 if(state.finished)return showToast('The routine has already exited.');
 if(!state.selected.size)return showToast('Select at least one horse.');
 stopPlayback();state.drawing=true;state.pendingRaw=null;state.cleanup='smooth';els.drawHelp.classList.remove('hidden');els.drawBtn.classList.add('active');els.reviewBar.classList.add('hidden');
 els.statusPill.textContent='Drawing';els.stageInstruction.textContent=state.movementMode==='together'?'Draw the leader track. Every selected horse will follow this exact track in single file.':'Draw one side; the other side mirrors it.';
}
function finishStroke(){
 pointerId=null;drawPointerStart=null;
 if(!state.pendingRaw||state.pendingRaw.length<3||meta(state.pendingRaw).total<18){state.pendingRaw=null;showToast('Draw a little farther.');renderDraft();return;}
 state.drawing=false;els.drawHelp.classList.add('hidden');els.drawBtn.classList.remove('active');els.reviewBar.classList.remove('hidden');setCleanup('smooth');els.statusPill.textContent='Review movement';
}
function setCleanup(mode){state.cleanup=mode;document.querySelectorAll('#cleanupChoice button').forEach(b=>b.classList.toggle('active',b.dataset.cleanup===mode));els.reviewText.textContent=mode==='raw'?'Keeps your exact finger line.':mode==='straight'?'Turns this into one clean straight run.':'Smooth removes finger wobble.';renderDraft();}
function commitPending(stopAfter){
 const built=buildPendingMove();if(!built)return;
 const action={id:Date.now()+Math.random(),type:'move',horseIds:built.horseIds,start:built.start,duration:built.duration,paths:built.paths,delays:built.delays,horseDurations:built.horseDurations,mode:state.movementMode,cleanup:state.cleanup,leaderId:built.leaderId||null};
 state.actions.push(action);state.time=action.start+action.duration;state.name='My Rodeo Routine';clearDrawing();renderAll();
 if(stopAfter)beginStopFormation(action);else showToast(state.movementMode==='together'?'Follow-the-leader movement added':'Mirrored movement added');
}
function addExit(){
 if(!state.formationSaved||state.editing||state.drawing)return showToast('Finish the current formation or movement first.');
 if(state.finished)return;stopPlayback();
 const start=totalDuration(),ids=allIds(),ordered=ids.map(id=>({id,pose:poseAt(id,start)})).sort((a,b)=>a.pose.x-b.pose.x||a.id-b.id);
 const paths={},delays={},horseDurations={};
 ordered.forEach(({id,pose},i)=>{
   const y=GATE.trackY,insideGate={x:ARENA.minX+10,y},atGate={x:ARENA.minX-4,y},chute={x:92,y};
   paths[id]=[{x:pose.x,y:pose.y},insideGate,atGate,chute];delays[id]=i*(FOLLOW_GAP_PX/SPEED);horseDurations[id]=Math.max(1.1,meta(paths[id]).total/SPEED);
 });
 const duration=Math.max(...ids.map(id=>delays[id]+horseDurations[id]));
 state.actions.push({id:Date.now()+Math.random(),type:'exit',horseIds:ids,start,duration,paths,delays,horseDurations,mode:'exit',cleanup:'exit'});
 state.finished=true;state.time=start;renderAll();showToast('Exit added through the left gate');
}
function undo(){
 if(state.editing?.type==='stop'){state.editing=null;renderAll();return;}
 if(!state.actions.length)return showToast('Nothing to undo.');
 state.actions.pop();state.finished=false;state.time=totalDuration();renderAll();showToast('Last movement removed');
}

function pointerToSvg(e){const r=els.arena.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*1000,y:(e.clientY-r.top)/r.height*560};}
function onArenaDown(e){
 const p=pointerToSvg(e);
 if(state.editing){
   const hit=state.editing.horseIds.map(id=>({id,p:state.editing.positions[id]})).find(h=>dist(h.p,p)<20);
   if(hit){dragHorseId=hit.id;pointerId=e.pointerId;els.arena.setPointerCapture?.(e.pointerId);e.preventDefault();}return;
 }
 if(!state.drawing)return;
 pointerId=e.pointerId;drawPointerStart=p;state.pendingRaw=[p];els.arena.setPointerCapture?.(e.pointerId);e.preventDefault();renderDraft();
}
function onArenaMove(e){
 if(pointerId!==e.pointerId)return;const p=pointerToSvg(e);
 if(dragHorseId&&state.editing){
   const box=state.editing.type==='start'?CHUTE:ARENA;
   state.editing.positions[dragHorseId]={x:clamp(p.x,box.minX,box.maxX),y:clamp(p.y,box.minY,box.maxY)};renderHorses();renderFormationGhost();return;
 }
 if(state.drawing&&state.pendingRaw){const last=state.pendingRaw.at(-1);if(dist(last,p)>3){state.pendingRaw.push(p);renderDraft();}}
}
function onArenaUp(e){
 if(pointerId!==e.pointerId)return;
 if(dragHorseId){dragHorseId=null;pointerId=null;return;}
 if(state.drawing)finishStroke();
}

function renderRoster(){
 els.horseCountLabel.textContent=state.horses.length;els.horseRoster.replaceChildren();
 state.horses.forEach(h=>{const b=document.createElement('button');b.textContent=h.id;b.classList.toggle('active',state.selected.has(h.id));b.onclick=()=>{if(state.editing)return;state.selected.has(h.id)?state.selected.delete(h.id):state.selected.add(h.id);renderRoster();renderHorses();};els.horseRoster.appendChild(b);});
 els.selectionSummary.textContent=selectionLabel();
}
function renderFormationControls(){
 document.querySelectorAll('#formationPresets button').forEach(b=>b.classList.toggle('active',(state.editing?.preset||state.formationPreset)===b.dataset.preset));
 els.formationStatus.textContent=state.formationSaved?`${state.startingFormationName} saved`:'Not saved yet';els.formationStatus.classList.toggle('unsaved',!state.formationSaved);
 els.formationBanner.classList.toggle('hidden',!state.editing);
 if(state.editing){els.formationBannerTitle.textContent=state.editing.type==='start'?'SET STARTING FORMATION':'SET STOP FORMATION';els.formationBannerText.textContent=state.editing.type==='start'?'Drag horses in the chute, then save.':'Arrange the stopped horses exactly how they should hold, then save.';}
}
function renderRoutes(){
 els.routeLayer.replaceChildren();
 state.actions.forEach(a=>a.horseIds.forEach(id=>{const pts=a.paths[id];if(!pts?.length)return;const p=svgEl('path',{d:pathD(pts),class:'route-path',stroke:COLORS[(id-1)%COLORS.length]});if(a.mode==='together')p.setAttribute('opacity',id===a.leaderId?'.9':'.35');els.routeLayer.appendChild(p);}));
}
function renderFormationGhost(){
 els.formationLayer.replaceChildren();if(!state.editing)return;
 const pts=Object.values(state.editing.positions);if(pts.length>1){const hull=svgEl('path',{d:pathD(pts),class:'formation-path'});els.formationLayer.appendChild(hull);}
}
function horseNode(id,pose,selected){
 const g=svgEl('g',{class:`horse${selected?' selected':''}`,transform:`translate(${pose.x} ${pose.y}) rotate(${(pose.angle||0)*180/Math.PI})`});
 g.dataset.id=id;g.append(svgEl('ellipse',{class:'select-ring',cx:0,cy:0,rx:13,ry:18}),svgEl('ellipse',{class:'body',cx:0,cy:0,rx:7,ry:11}),svgEl('circle',{class:'head',cx:0,cy:-11,r:4}));
 const t=svgEl('text',{class:'num',x:0,y:0});t.textContent=id;g.appendChild(t);return g;
}
function renderHorses(){
 els.horseLayer.replaceChildren();state.horses.forEach(h=>{
   let p;if(state.editing?.positions[h.id])p={...state.editing.positions[h.id],angle:state.editing.heading||0};else p=poseAt(h.id,state.time);
   els.horseLayer.appendChild(horseNode(h.id,p,state.selected.has(h.id)));
 });
}
function renderDraft(){
 els.draftLayer.replaceChildren();if(!state.pendingRaw)return;
 const guide=cleanupGuide(state.pendingRaw,state.cleanup),gp=svgEl('path',{d:pathD(guide),class:'draft-path'});els.draftLayer.appendChild(gp);
 const built=buildPendingMove();if(built)built.horseIds.forEach(id=>els.draftLayer.appendChild(svgEl('path',{d:pathD(built.paths[id]),class:'draft-copy'})));
}
function renderTimeline(){
 const dur=totalDuration();els.timeline.max=Math.max(.01,dur);els.timeline.value=clamp(state.time,0,Math.max(.01,dur));els.timeLabel.textContent=fmtTime(state.time);els.durationLabel.textContent=fmtTime(dur);
 els.actionCount.textContent=!state.formationSaved?'Starting formation not saved':`${state.actions.length} movement${state.actions.length===1?'':'s'}`;
 els.actionStrip.replaceChildren();
 if(state.formationSaved){const c=document.createElement('div');c.className='action-card';c.innerHTML=`<strong>Starting Formation</strong><span>${state.startingFormationName}</span><em>CHUTE</em>`;c.onclick=()=>{state.time=0;stopPlayback();renderAll();};els.actionStrip.appendChild(c);}
 state.actions.forEach((a,i)=>{const c=document.createElement('div');c.className='action-card';const label=a.type==='exit'?'Exit Left Gate':a.stopFormation?'Move → Stop Formation':a.mode==='together'?'Follow Leader':'Mirrored Move';c.innerHTML=`<strong>${i+1}. ${label}</strong><span>${horseLabel(a.horseIds)}</span><em>${fmtTime(a.start)}–${fmtTime(a.start+a.duration)}</em>`;c.onclick=()=>{state.time=a.start;stopPlayback();renderAll();};els.actionStrip.appendChild(c);});
 if(!state.formationSaved){const e=document.createElement('div');e.className='empty-action';e.textContent='Save the starting formation first.';els.actionStrip.appendChild(e);}
}
function renderStageText(){
 els.routineName.textContent=state.name;
 if(state.editing){els.statusPill.textContent=state.editing.type==='start'?'Starting formation':'Stop formation';els.stageInstruction.textContent=state.editing.type==='start'?'Arrange the team in the chute and save.':'Arrange the stopped horses and save the formation.';}
 else if(state.drawing){els.statusPill.textContent='Drawing';}
 else if(state.finished){els.statusPill.textContent='Routine finished';els.stageInstruction.textContent='The team exits through the left gate.';}
 else{els.statusPill.textContent='Ready';els.stageInstruction.textContent=state.movementMode==='together'?'Same Path = exact follow-the-leader track, one horse behind the next.':'Mirror Left / Right = opposite turns from one guide.';}
 els.emptyHelp.classList.toggle('hidden',state.formationSaved||!!state.editing&&state.editing.type!=='start');
 document.querySelectorAll('#movementMode button').forEach(b=>b.classList.toggle('active',b.dataset.mode===state.movementMode));
}
function renderAll(){renderRoster();renderFormationControls();renderRoutes();renderFormationGhost();renderHorses();renderDraft();renderTimeline();renderStageText();}

function stopPlayback(){state.playing=false;if(state.raf)cancelAnimationFrame(state.raf);state.raf=0;els.playBtn.innerHTML='▶ <span>PLAY</span>';}
function play(){
 if(state.editing||state.drawing)return showToast('Finish editing first.');const dur=totalDuration();if(!dur)return showToast('Add a movement first.');
 if(state.playing){stopPlayback();return;}if(state.time>=dur-.01)state.time=0;state.playing=true;state.lastFrame=performance.now();els.playBtn.innerHTML='Ⅱ <span>PAUSE</span>';
 const tick=now=>{if(!state.playing)return;state.time+=Math.max(0,(now-state.lastFrame)/1000);state.lastFrame=now;if(state.time>=dur){state.time=dur;stopPlayback();}renderHorses();renderTimeline();if(state.playing)state.raf=requestAnimationFrame(tick);};state.raf=requestAnimationFrame(tick);
}
function saveLocal(){
 const data={version:2,name:state.name,formationPreset:state.formationPreset,formationSaved:state.formationSaved,startingFormationName:state.startingFormationName,horses:state.horses,actions:state.actions,finished:state.finished};
 localStorage.setItem(STORE,JSON.stringify(data));showToast('Routine saved');
}
function exportRoutine(){
 const data={version:2,name:state.name,startingFormation:state.startingFormationName,horses:state.horses,actions:state.actions};
 const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='rodeo-routine.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
}
function newRoutine(){stopPlayback();state=freshState();clearDrawing();renderAll();showToast('New routine');}
function loadSaved(){
 try{const raw=localStorage.getItem(STORE);if(!raw)return false;const d=JSON.parse(raw);if(d.version!==2)return false;
 state=freshState(d.horses?.length||12);state.name=d.name||'My Rodeo Routine';state.formationPreset=d.formationPreset||'two';state.formationSaved=!!d.formationSaved;state.startingFormationName=d.startingFormationName||presetName(state.formationPreset);state.horses=d.horses||state.horses;state.actions=d.actions||[];state.finished=!!d.finished;state.selected=new Set(allIds());state.editing=state.formationSaved?null:state.editing;return true;
 }catch{return false;}
}

els.horseMinus.onclick=()=>setHorseCount(state.horses.length-1);
els.horsePlus.onclick=()=>setHorseCount(state.horses.length+1);
els.formationPresets.addEventListener('click',e=>{const b=e.target.closest('button[data-preset]');if(b)applyFormationPreset(b.dataset.preset);});
els.editFormationBtn.onclick=()=>beginStartFormation(state.formationPreset);
els.saveFormationBtn.onclick=saveFormation;els.cancelFormationBtn.onclick=cancelFormation;
els.selectAllBtn.onclick=()=>{state.selected=new Set(allIds());renderAll();};
els.selectNoneBtn.onclick=()=>{state.selected.clear();renderAll();};
els.selectOddBtn.onclick=()=>{state.selected=new Set(allIds().filter(id=>id%2));renderAll();};
els.selectEvenBtn.onclick=()=>{state.selected=new Set(allIds().filter(id=>!(id%2)));renderAll();};
els.movementMode.addEventListener('click',e=>{const b=e.target.closest('button[data-mode]');if(!b)return;state.movementMode=b.dataset.mode;renderAll();showToast(state.movementMode==='together'?'Same Path: exact follow-the-leader track':'Mirror Left / Right selected');});
els.drawBtn.onclick=beginDraw;els.retryBtn.onclick=()=>{clearDrawing();beginDraw();};
els.cleanupChoice.addEventListener('click',e=>{const b=e.target.closest('button[data-cleanup]');if(b)setCleanup(b.dataset.cleanup);});
els.continueBtn.onclick=()=>commitPending(false);els.stopBtn.onclick=()=>commitPending(true);
els.exitBtn.onclick=addExit;els.undoBtn.onclick=undo;els.playBtn.onclick=play;
els.restartBtn.onclick=()=>{stopPlayback();state.time=0;renderAll();};
els.timeline.addEventListener('input',()=>{stopPlayback();state.time=Number(els.timeline.value)||0;renderHorses();renderTimeline();});
els.newBtn.onclick=newRoutine;els.saveBtn.onclick=saveLocal;els.exportBtn.onclick=exportRoutine;
els.arenaSurface.addEventListener('pointerdown',onArenaDown);
els.arena.addEventListener('pointermove',onArenaMove);
els.arena.addEventListener('pointerup',onArenaUp);
els.arena.addEventListener('pointercancel',onArenaUp);
document.addEventListener('gesturestart',e=>e.preventDefault(),{passive:false});
document.addEventListener('gesturechange',e=>e.preventDefault(),{passive:false});
document.addEventListener('gestureend',e=>e.preventDefault(),{passive:false});

state=freshState();
loadSaved();
renderAll();
})();