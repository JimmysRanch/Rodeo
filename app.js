(() => {
'use strict';
const SVG='http://www.w3.org/2000/svg';
const STORE='rodeo-simple-v2';
const COLORS=['#f0b84e','#60a5fa','#ef6f6c','#65c18c'];
const LABELS={straight:'Straight',split:'Split',curveUp:'Curve Up',curveDown:'Curve Down',together:'Together',circle:'Circle',figure8:'Figure 8',cross:'Cross',hold:'Stop',finish:'Finish / Exit',hand:'Hand Drawn',handSmooth:'Hand Drawn · Smoothed'};
const els={};['lineCount','horsesPerLine','pace','proBtn','drawBtn','moveGrid','routineList','moveCount','undoBtn','clearBtn','newBtn','arena','arenaSurface','routeLayer','draftLayer','targetLayer','horseLayer','arenaEmpty','drawHint','drawReview','keepRawBtn','smoothBtn','cancelDrawBtn','centerTargetBtn','targetText','playBtn','restartBtn','timeline','timeLabel','durationLabel','routineName','teamSummary','statusPill','saveBtn','exportBtn','toast'].forEach(id=>els[id]=document.getElementById(id));
let state={lines:2,horses:6,pace:'show',moves:[],name:'New Routine',playing:false,time:0,last:0,raf:0,routes:[],segments:[],duration:0,target:{x:560,y:280},drawMode:false,drawing:false,draft:[],pendingDraft:null};
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const dist=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
function slots(n){return n===2?[-.5,.5]:n===3?[-1,0,1]:[-1.5,-.5,.5,1.5];}
function startPoint(slot){return{x:68,y:280+slot*54};}
function svgEl(tag,attrs={}){const e=document.createElementNS(SVG,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));return e;}
function pathD(points){return points.map((p,i)=>(i?'L':'M')+` ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');}
function pointDist(a,b){return Math.hypot(b.x-a.x,b.y-a.y)}
function linePoints(a,b,steps=14){const out=[];for(let i=0;i<=steps;i++){const t=i/steps;out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}return out;}
function catmull(anchors,steps=8){const a=anchors.map(p=>Array.isArray(p)?{x:p[0],y:p[1]}:{...p}),out=[];if(a.length<2)return a;for(let i=0;i<a.length-1;i++){const p0=a[Math.max(0,i-1)],p1=a[i],p2=a[i+1],p3=a[Math.min(a.length-1,i+2)];for(let s=0;s<(i===a.length-2?steps+1:steps);s++){const t=s/steps,t2=t*t,t3=t2*t;out.push({x:.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),y:.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3)});}}return out.map(p=>({x:clamp(p.x,58,942),y:clamp(p.y,58,502)}));}
function circlePoints(cx,cy,rx,ry,start=0,steps=56){const out=[];for(let i=0;i<=steps;i++){const t=start+i/steps*Math.PI*2;out.push({x:cx+Math.cos(t)*rx,y:cy+Math.sin(t)*ry});}return out;}
function figureEight(cx,cy,rx,ry,flip=1,steps=84){const out=[];for(let i=0;i<=steps;i++){const t=i/steps*Math.PI*2;out.push({x:cx+flip*rx*Math.sin(t),y:cy+ry*Math.sin(2*t)});}return out;}
function chaikin(points,passes=3){let out=points.map(p=>({...p}));for(let pass=0;pass<passes;pass++){if(out.length<3)break;const next=[out[0]];for(let i=0;i<out.length-1;i++){const a=out[i],b=out[i+1];next.push({x:a.x*.75+b.x*.25,y:a.y*.75+b.y*.25},{x:a.x*.25+b.x*.75,y:a.y*.25+b.y*.75});}next.push(out[out.length-1]);out=next;}return out;}
function segmentMeta(points,type='move'){let cum=[0],total=0;for(let i=1;i<points.length;i++){total+=pointDist(points[i-1],points[i]);cum.push(total);}return{points,cum,total,type};}
function pointOn(seg,p){if(seg.type==='hold')return{...seg.points[0],angle:0};const d=clamp(p,0,1)*seg.total;if(!seg.total)return{...seg.points[0],angle:0};let i=1;while(i<seg.cum.length&&seg.cum[i]<d)i++;i=Math.min(i,seg.points.length-1);const a=seg.points[i-1],b=seg.points[i],base=seg.cum[i-1],len=Math.max(.001,seg.cum[i]-base),t=(d-base)/len;return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI};}
function moveSeconds(move){if(move.type==='hold')return 2.2;if(move.type==='figure8'||move.type==='circle'||move.type==='cross')return state.pace==='fast'?5.1:state.pace==='smooth'?7.0:6.0;if(move.type==='hand'||move.type==='handSmooth')return state.pace==='fast'?4.8:state.pace==='smooth'?6.4:5.5;return state.pace==='fast'?3.9:state.pace==='smooth'?5.5:4.6;}
function horseGap(){return state.pace==='fast'?1.0:state.pace==='smooth'?1.45:1.25;}
function connect(current,pts){if(!pts.length)return[{...current}];if(dist(current,pts[0])<2)return pts;return catmull([[current.x,current.y],[(current.x+pts[0].x)/2,(current.y+pts[0].y)/2],[pts[0].x,pts[0].y]],6).concat(pts.slice(1));}
function createManeuver(move,current,slot,lineIndex){const type=move.type,t=move.target||state.target,side=slot===0?(lineIndex%2?1:-1):Math.sign(slot)||1;let pts=[];
  if(type==='straight'){
    const tx=clamp(Math.max(current.x+150,t.x),120,915);pts=linePoints(current,{x:tx,y:current.y},18);
  } else if(type==='curveUp'||type==='curveDown'){
    const dir=type==='curveUp'?-1:1,tx=clamp(Math.max(current.x+150,t.x),150,890),ty=clamp(t.y+dir*95,90,470);pts=catmull([[current.x,current.y],[current.x+85,current.y],[tx-70,ty],[tx,ty]],10);
  } else if(type==='split'){
    const tx=clamp(Math.max(current.x+135,t.x),160,885),spread=state.lines===4?62:78,ty=clamp(t.y+slot*spread,95,465);pts=catmull([[current.x,current.y],[current.x+70,current.y],[tx-55,ty],[tx,ty]],9);
  } else if(type==='together'){
    const tx=clamp(Math.max(current.x+125,t.x),160,890),ty=clamp(t.y+slot*24,100,460);pts=catmull([[current.x,current.y],[current.x+60,current.y],[tx-55,ty],[tx,ty]],9);
  } else if(type==='circle'){
    const cx=clamp(t.x+slot*72,150,850),cy=clamp(t.y,135,425),rx=72,ry=58,start=Math.PI;const loop=circlePoints(cx,cy,rx,ry,start,60);pts=connect(current,loop);
  } else if(type==='figure8'){
    const cx=clamp(t.x,210,790),cy=clamp(t.y+slot*34,145,415),loop=figureEight(cx,cy,125,65,side,88);pts=connect(current,loop);
  } else if(type==='cross'){
    const cx=clamp(t.x,210,790),cy=clamp(t.y,140,420),sy=slot*74;const endY=cy-sy;pts=catmull([[current.x,current.y],[cx-115,current.y],[cx,cy],[cx+125,endY]],10);
  } else if(type==='hold'){
    pts=[{...current},{...current}];
  } else if(type==='finish'){
    const ty=clamp(280+slot*46,120,440);pts=catmull([[current.x,current.y],[Math.max(current.x+95,760),(current.y+ty)/2],[930,ty]],11);
  } else if(type==='hand'||type==='handSmooth'){
    const raw=move.points||[];if(raw.length<2)return[{...current},{...current}];const base=raw[0];pts=raw.map(p=>({x:clamp(current.x+(p.x-base.x),58,942),y:clamp(current.y+(p.y-base.y),58,502)}));
  }
  return pts;
}
function buildRoutes(){const ss=slots(state.lines);state.routes=[];state.segments=[];for(let li=0;li<state.lines;li++){let current=startPoint(ss[li]),all=[{...current}],segs=[];for(const move of state.moves){let pts=createManeuver(move,current,ss[li],li);if(pts.length&&dist(current,pts[0])>1)pts=connect(current,pts);const seg=segmentMeta(pts,move.type==='hold'?'hold':'move');segs.push(seg);all.push(...pts.slice(1));current=pts[pts.length-1]||current;}state.routes.push(all);state.segments.push(segs);}let total=0;for(const m of state.moves)total+=moveSeconds(m);state.duration=total+(state.horses-1)*horseGap()+1.0;state.time=clamp(state.time,0,state.duration||0);}
function segmentAtTime(time){let elapsed=0;for(let i=0;i<state.moves.length;i++){const d=moveSeconds(state.moves[i]);if(time<=elapsed+d)return{i,local:(time-elapsed)/d};elapsed+=d;}return null;}
function routePose(lineIndex,time,horseIndex){if(!state.moves.length)return null;const linePhase=lineIndex*(horseGap()/Math.max(2,state.lines))*0.45;const t=time-linePhase-horseIndex*horseGap();if(t<0)return null;const hit=segmentAtTime(t);if(!hit)return null;return pointOn(state.segments[lineIndex][hit.i],hit.local);}
function renderRoutes(){els.routeLayer.replaceChildren();state.routes.forEach((pts,i)=>{if(pts.length<2)return;els.routeLayer.appendChild(svgEl('path',{d:pathD(pts),class:'route-shadow'}));els.routeLayer.appendChild(svgEl('path',{d:pathD(pts),class:'route-path',stroke:COLORS[i]}));});}
function renderTarget(){els.targetLayer.replaceChildren();if(state.drawMode)return;const t=state.target;els.targetLayer.appendChild(svgEl('circle',{cx:t.x,cy:t.y,r:18,class:'target-ring'}));els.targetLayer.appendChild(svgEl('line',{x1:t.x-10,y1:t.y,x2:t.x+10,y2:t.y,class:'target-cross'}));els.targetLayer.appendChild(svgEl('line',{x1:t.x,y1:t.y-10,x2:t.x,y2:t.y+10,class:'target-cross'}));const label=svgEl('text',{x:t.x,y:t.y-25,class:'target-label'});label.textContent='NEXT MOVE';els.targetLayer.appendChild(label);els.targetText.textContent=`x ${Math.round(t.x)} · y ${Math.round(t.y)}`;}
function renderDraft(){els.draftLayer.replaceChildren();const pts=state.pendingDraft||state.draft;if(pts?.length>1)els.draftLayer.appendChild(svgEl('path',{d:pathD(pts),class:'draft-path'}));}
function renderHorses(){els.horseLayer.replaceChildren();for(let li=0;li<state.lines;li++){for(let h=0;h<state.horses;h++){const p=routePose(li,state.time,h);if(!p)continue;const g=svgEl('g',{class:'horse',transform:`translate(${p.x} ${p.y}) rotate(${p.angle+90})`});const body=svgEl('ellipse',{cx:0,cy:0,rx:7.5,ry:11,fill:COLORS[li],class:'horse-body'});const head=svgEl('circle',{cx:0,cy:-12,r:3.8,class:'horse-head'});const txt=svgEl('text',{x:0,y:.5,class:'horse-num'});txt.textContent=h+1;g.append(body,head,txt);els.horseLayer.appendChild(g);}}}
function movePlace(move){if(['circle','figure8','split','together','cross'].includes(move.type)&&move.target)return` @ ${Math.round(move.target.x)},${Math.round(move.target.y)}`;return'';}
function renderList(){els.routineList.replaceChildren();if(!state.moves.length)els.routineList.innerHTML='<div class="empty-list">Add a move above.</div>';else state.moves.slice(0,10).forEach((m,i)=>{const row=document.createElement('div');row.className='move-row';row.title=LABELS[m.type]+movePlace(m);row.innerHTML=`<b>${i+1}</b><span>${LABELS[m.type]}</span>`;els.routineList.appendChild(row);});els.moveCount.textContent=`${state.moves.length} move${state.moves.length===1?'':'s'}`;}
function renderUi(){buildRoutes();renderRoutes();renderTarget();renderDraft();renderHorses();renderList();els.arenaEmpty.classList.toggle('hidden',state.moves.length>0||state.drawMode);els.routineName.textContent=state.name;els.teamSummary.textContent=`${state.lines} lines · ${state.horses} horses each · LEFT → RIGHT · wider spacing`;els.statusPill.textContent=state.drawMode?'Drawing':state.moves.length?'Synchronized':'Ready';els.timeline.max=Math.max(.01,state.duration);els.timeline.value=state.time;els.timeLabel.textContent=formatTime(state.time);els.durationLabel.textContent=formatTime(state.duration);document.querySelectorAll('#lineCount button').forEach(b=>b.classList.toggle('active',Number(b.dataset.lines)===state.lines));els.horsesPerLine.value=state.horses;els.pace.value=state.pace;els.playBtn.innerHTML=state.playing?'❚❚ <span>PAUSE</span>':'▶ <span>PLAY ROUTINE</span>';}
function formatTime(s){s=Math.max(0,s||0);return`${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;}
function toast(msg){els.toast.textContent=msg;els.toast.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.classList.remove('show'),1900);}
function stop(){state.playing=false;if(state.raf)cancelAnimationFrame(state.raf);state.raf=0;}
function play(){if(state.drawMode||state.pendingDraft){toast('Finish the hand-drawn move first');return;}if(!state.moves.length){toast('Add a move first');return;}if(state.playing){stop();renderUi();return;}if(state.time>=state.duration-.05)state.time=0;state.playing=true;state.last=performance.now();tick(state.last);}
function tick(now){if(!state.playing)return;state.time+=(now-state.last)/1000;state.last=now;if(state.time>=state.duration){state.time=state.duration;stop();}renderHorses();els.timeline.value=state.time;els.timeLabel.textContent=formatTime(state.time);els.playBtn.innerHTML=state.playing?'❚❚ <span>PAUSE</span>':'▶ <span>PLAY ROUTINE</span>';if(state.playing)state.raf=requestAnimationFrame(tick);}
function addMove(type){stop();if(state.drawMode||state.pendingDraft){toast('Finish or cancel the hand-drawn move first');return;}if(state.moves.length>=10){toast('Routine is full — undo a move first');return;}const move={type};if(['circle','figure8','split','together','cross','curveUp','curveDown'].includes(type))move.target={...state.target};state.moves.push(move);state.name='My Routine';state.time=0;renderUi();toast(`${LABELS[type]} added`);}
function proRoutine(){stop();cancelDrawing(false);state.moves=[
  {type:'straight',target:{x:255,y:280}},
  {type:'split',target:{x:365,y:280}},
  {type:'circle',target:{x:470,y:280}},
  {type:'together',target:{x:570,y:280}},
  {type:'figure8',target:{x:675,y:280}},
  {type:'cross',target:{x:790,y:280}},
  {type:'finish',target:{x:900,y:280}}
];state.name='Professional Left-to-Right Routine';state.time=0;state.target={x:675,y:280};renderUi();toast('Full synchronized routine built left to right');}
function reset(){stop();cancelDrawing(false);state.moves=[];state.name='New Routine';state.time=0;state.target={x:560,y:280};renderUi();}
function save(){const data={version:2,lines:state.lines,horses:state.horses,pace:state.pace,moves:state.moves,name:state.name,target:state.target};localStorage.setItem(STORE,JSON.stringify(data));toast('Routine saved on this device');}
function load(){try{const d=JSON.parse(localStorage.getItem(STORE)||'null');if(!d)return;Object.assign(state,{lines:d.lines||2,horses:d.horses||6,pace:d.pace||'show',moves:Array.isArray(d.moves)?d.moves:[],name:d.name||'Saved Routine',target:d.target||{x:560,y:280}});}catch{}}
function exportRoutine(){const blob=new Blob([JSON.stringify({version:2,name:state.name,entrance:'left-to-right',lines:state.lines,horsesPerLine:state.horses,pace:state.pace,moves:state.moves},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='rodeo-routine.json';a.click();URL.revokeObjectURL(url);toast('Routine exported');}
function arenaPoint(e){const p=els.arena.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const m=els.arena.getScreenCTM();if(!m)return null;const q=p.matrixTransform(m.inverse());return{x:clamp(q.x,58,942),y:clamp(q.y,58,502)};}
function masterEnd(){buildRoutes();return state.routes[0]?.[state.routes[0].length-1]||startPoint(slots(state.lines)[0]);}
function beginDrawing(){stop();if(state.pendingDraft){toast('Choose Keep, Smooth, or Cancel first');return;}state.drawMode=true;state.drawing=false;state.draft=[];els.drawHint.classList.remove('hidden');els.drawReview.classList.add('hidden');renderUi();toast('Draw the next move on the arena');}
function cancelDrawing(render=true){state.drawMode=false;state.drawing=false;state.draft=[];state.pendingDraft=null;els.drawHint?.classList.add('hidden');els.drawReview?.classList.add('hidden');if(render)renderUi();}
function onArenaDown(e){e.preventDefault();const p=arenaPoint(e);if(!p)return;if(!state.drawMode){state.target=p;renderTarget();toast('Next shape location moved');return;}state.drawing=true;els.arenaSurface.setPointerCapture?.(e.pointerId);const start=masterEnd();state.draft=[{...start}];if(dist(start,p)>3)state.draft.push(p);renderDraft();}
function onArenaMove(e){if(!state.drawMode||!state.drawing)return;e.preventDefault();const p=arenaPoint(e);if(!p)return;const last=state.draft[state.draft.length-1];if(!last||dist(last,p)>=4){state.draft.push(p);renderDraft();}}
function onArenaUp(e){if(!state.drawMode||!state.drawing)return;e.preventDefault();state.drawing=false;if(state.draft.length<3||state.draft.slice(1).reduce((s,p,i)=>s+dist(state.draft[i],p),0)<28){toast('Draw a longer path');state.draft=[];renderDraft();return;}state.pendingDraft=state.draft.map(p=>({...p}));state.draft=[];state.drawMode=false;els.drawHint.classList.add('hidden');els.drawReview.classList.remove('hidden');renderDraft();els.statusPill.textContent='Review drawing';}
function commitDraft(smooth){if(!state.pendingDraft)return;let points=state.pendingDraft.map(p=>({...p}));if(smooth)points=chaikin(points,3);state.moves.push({type:smooth?'handSmooth':'hand',points});state.pendingDraft=null;els.drawReview.classList.add('hidden');state.name='My Routine';state.time=0;renderUi();toast(smooth?'Hand-drawn move smoothed and added':'Hand-drawn move kept as drawn');}
els.lineCount.addEventListener('click',e=>{const b=e.target.closest('[data-lines]');if(!b)return;stop();state.lines=Number(b.dataset.lines);state.time=0;renderUi();});
els.horsesPerLine.addEventListener('change',()=>{stop();state.horses=Number(els.horsesPerLine.value);state.time=0;renderUi();});
els.pace.addEventListener('change',()=>{stop();state.pace=els.pace.value;state.time=0;renderUi();});
els.moveGrid.addEventListener('click',e=>{const b=e.target.closest('[data-move]');if(b)addMove(b.dataset.move);});
els.proBtn.addEventListener('click',proRoutine);els.drawBtn.addEventListener('click',beginDrawing);els.keepRawBtn.addEventListener('click',()=>commitDraft(false));els.smoothBtn.addEventListener('click',()=>commitDraft(true));els.cancelDrawBtn.addEventListener('click',()=>cancelDrawing(true));
els.arenaSurface.addEventListener('pointerdown',onArenaDown);els.arenaSurface.addEventListener('pointermove',onArenaMove);els.arenaSurface.addEventListener('pointerup',onArenaUp);els.arenaSurface.addEventListener('pointercancel',onArenaUp);
els.centerTargetBtn.addEventListener('click',()=>{state.target={x:560,y:280};renderTarget();});
els.undoBtn.addEventListener('click',()=>{stop();if(state.moves.length){state.moves.pop();state.time=0;renderUi();}});els.clearBtn.addEventListener('click',reset);els.newBtn.addEventListener('click',reset);els.playBtn.addEventListener('click',play);els.restartBtn.addEventListener('click',()=>{stop();state.time=0;renderUi();});els.timeline.addEventListener('input',()=>{stop();state.time=Number(els.timeline.value)||0;renderHorses();els.timeLabel.textContent=formatTime(state.time);});els.saveBtn.addEventListener('click',save);els.exportBtn.addEventListener('click',exportRoutine);
load();renderUi();
})();
