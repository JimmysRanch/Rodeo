(() => {
'use strict';
const SVG='http://www.w3.org/2000/svg';
const STORE='rodeo-simple-v1';
const COLORS=['#f0b84e','#60a5fa','#ef6f6c','#65c18c'];
const LABELS={straight:'Straight Run',split:'Matched Split',figure8:'Figure 8 Cross',weave:'Alternating Weave',circle:'Matched Circles',diamond:'Diamond Cross',pinwheel:'Pinwheel',clover:'Cloverleaf',sweep:'S-Curve Sweep',hold:'Stop / Salute',finish:'Return to Chute'};
const els={};['lineCount','horsesPerLine','pace','proBtn','moveGrid','routineList','moveCount','undoBtn','clearBtn','newBtn','arena','routeLayer','horseLayer','arenaEmpty','playBtn','restartBtn','timeline','timeLabel','durationLabel','routineName','teamSummary','statusPill','saveBtn','exportBtn','toast'].forEach(id=>els[id]=document.getElementById(id));
let state={lines:2,horses:6,pace:'show',moves:[],name:'New Routine',playing:false,time:0,last:0,raf:0,routes:[],segments:[],duration:0,variant:0};
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
function slots(n){return n===2?[-.5,.5]:n===3?[-1,0,1]:[-1.5,-.5,.5,1.5];}
function slotX(slot,spread=38){return 500+slot*spread;}
function svgEl(tag,attrs={}){const e=document.createElementNS(SVG,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;}
function pathD(points){return points.map((p,i)=>(i?'L':'M')+` ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');}
function catmull(anchors,steps=8){const a=anchors.map(p=>({x:p[0],y:p[1]})),out=[];if(a.length<2)return a;for(let i=0;i<a.length-1;i++){const p0=a[Math.max(0,i-1)],p1=a[i],p2=a[i+1],p3=a[Math.min(a.length-1,i+2)];for(let s=0;s<(i===a.length-2?steps+1:steps);s++){const t=s/steps,t2=t*t,t3=t2*t;out.push({x:.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),y:.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3)});}}return out.map(p=>({x:clamp(p.x,60,940),y:clamp(p.y,60,500)}));}
function linePoints(a,b,steps=14){const out=[];for(let i=0;i<=steps;i++){const t=i/steps;out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}return out;}
function circlePoints(cx,cy,rx,ry,startAngle=0,turns=1,steps=48){const out=[];for(let i=0;i<=steps;i++){const t=startAngle+(i/steps)*Math.PI*2*turns;out.push({x:cx+Math.cos(t)*rx,y:cy+Math.sin(t)*ry});}return out;}
function lemniscate(cx,cy,rx,ry,flip=1,steps=72){const out=[];for(let i=0;i<=steps;i++){const t=i/steps*Math.PI*2;out.push({x:cx+flip*rx*Math.sin(t),y:cy+ry*Math.sin(2*t)});}return out;}
function pointDist(a,b){return Math.hypot(b.x-a.x,b.y-a.y)}
function segmentMeta(points,type='move'){let cum=[0],total=0;for(let i=1;i<points.length;i++){total+=pointDist(points[i-1],points[i]);cum.push(total);}return{points,cum,total,type};}
function pointOn(seg,p){if(seg.type==='hold')return{...seg.points[0],angle:0};const d=clamp(p,0,1)*seg.total;if(!seg.total)return{...seg.points[0],angle:0};let i=1;while(i<seg.cum.length&&seg.cum[i]<d)i++;i=Math.min(i,seg.points.length-1);const a=seg.points[i-1],b=seg.points[i],base=seg.cum[i-1],len=Math.max(.001,seg.cum[i]-base),t=(d-base)/len;return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI};}
function moveSeconds(){return state.pace==='fast'?3.6:state.pace==='smooth'?5.6:4.6;}
function horseGap(){return state.pace==='fast'?.42:state.pace==='smooth'?.68:.55;}
function createManeuver(type,index,current,slot,lineIndex){
  const zones=[420,350,280,190,125,235,320,400,455,300];
  const zone=zones[index%zones.length],side=slot===0?(lineIndex%2?1:-1):Math.sign(slot),mag=1+Math.abs(slot)*.10;
  let pts=[];
  if(type==='straight'){
    pts=linePoints(current,{x:current.x,y:zone},18);
  } else if(type==='split'){
    const tx=clamp(500+slot*245,125,875);
    pts=catmull([[current.x,current.y],[current.x,(current.y+zone)/2],[tx,zone]],10);
  } else if(type==='figure8'){
    const rx=245*mag,ry=90,loop=lemniscate(500,zone,rx,ry,side,92);
    pts=catmull([[current.x,current.y],[500+side*155,(current.y+zone)/2],[loop[0].x,loop[0].y]],8).concat(loop.slice(1));
  } else if(type==='weave'){
    const top=clamp(zone-80,85,420),bottom=clamp(zone+80,140,475),fromTop=current.y<zone;
    const y0=fromTop?top:bottom,y1=fromTop?bottom:top,anchors=[[current.x,current.y],[500+side*140,y0]];
    for(let k=1;k<=6;k++){const t=k/6;anchors.push([500+(k%2?side:-side)*(135+Math.abs(slot)*28),y0+(y1-y0)*t]);}
    pts=catmull(anchors,7);
  } else if(type==='circle'){
    const cx=500+side*(220+Math.abs(slot)*18),cy=zone,r=92+Math.abs(slot)*6,start=side>0?Math.PI:0;
    const loop=circlePoints(cx,cy,r,r*.70,start,1,64);
    pts=catmull([[current.x,current.y],[500+side*150,(current.y+cy)/2],[loop[0].x,loop[0].y]],7).concat(loop.slice(1));
  } else if(type==='diamond'){
    const cy=zone,sx=side*(205+Math.abs(slot)*14),sy=95;
    pts=catmull([[current.x,current.y],[500,cy+sy],[500+sx,cy],[500,cy-sy],[500-sx,cy],[500,cy+sy]],7);
  } else if(type==='pinwheel'){
    const cy=zone,cx=500,r=120+Math.abs(slot)*26,phase=(lineIndex/state.lines)*Math.PI*2;
    const loop=circlePoints(cx,cy,r,r*.72,phase,1.12,72);
    pts=catmull([[current.x,current.y],[loop[0].x,loop[0].y]],7).concat(loop.slice(1));
  } else if(type==='clover'){
    const cy=zone,cx=500,r=112+Math.abs(slot)*10,out=[];
    for(let k=0;k<4;k++){const a=(k*Math.PI/2)+(side<0?Math.PI:0),lx=cx+Math.cos(a)*r,ly=cy+Math.sin(a)*r*.72;const loop=circlePoints((cx+lx)/2,(cy+ly)/2,r*.50,r*.36,a+Math.PI,1,30);out.push(...(k?loop.slice(1):loop));}
    pts=catmull([[current.x,current.y],[cx,cy]],7).concat(out);
  } else if(type==='sweep'){
    pts=catmull([[current.x,current.y],[500+side*255,(current.y+zone)/2-35],[500-side*250,(current.y+zone)/2+35],[500+side*90,zone]],11);
  } else if(type==='hold'){
    pts=[{...current},{...current}];
  } else if(type==='finish'){
    const tx=slotX(slot,34);
    pts=catmull([[current.x,current.y],[500+side*155,390],[tx,500]],10);
  }
  return pts;
}
function buildRoutes(){const ss=slots(state.lines);state.routes=[];state.segments=[];for(let li=0;li<state.lines;li++){let current={x:slotX(ss[li],34),y:500},all=[{...current}],segs=[];state.moves.forEach((type,idx)=>{let pts=createManeuver(type,idx,current,ss[li],li);if(pts.length&&pointDist(current,pts[0])>1)pts=[...linePoints(current,pts[0],5),...pts.slice(1)];const seg=segmentMeta(pts,type);segs.push(seg);all.push(...pts.slice(1));current=pts[pts.length-1]||current;});state.routes.push(all);state.segments.push(segs);}const moveDur=moveSeconds(),tail=(state.horses-1)*horseGap()+1.2;state.duration=state.moves.length*moveDur+tail;state.time=clamp(state.time,0,state.duration||0);}
function routePose(lineIndex,time,horseIndex){if(!state.moves.length)return null;const phase=lineIndex*(horseGap()/state.lines);const t=time-phase-horseIndex*horseGap();if(t<0)return null;const moveDur=moveSeconds();const idx=Math.min(state.moves.length-1,Math.floor(t/moveDur));if(t>=state.moves.length*moveDur)return null;const local=(t-idx*moveDur)/moveDur;const seg=state.segments[lineIndex][idx];return pointOn(seg,local);}
function renderRoutes(){els.routeLayer.replaceChildren();state.routes.forEach((pts,i)=>{if(pts.length<2)return;els.routeLayer.appendChild(svgEl('path',{d:pathD(pts),class:'route-shadow'}));els.routeLayer.appendChild(svgEl('path',{d:pathD(pts),class:'route-path',stroke:COLORS[i]}));});}
function renderHorses(){els.horseLayer.replaceChildren();for(let li=0;li<state.lines;li++){for(let h=0;h<state.horses;h++){const p=routePose(li,state.time,h);if(!p)continue;const g=svgEl('g',{class:'horse',transform:`translate(${p.x} ${p.y}) rotate(${p.angle+90})`});const body=svgEl('ellipse',{cx:0,cy:0,rx:7.5,ry:11,fill:COLORS[li],class:'horse-body'});const head=svgEl('circle',{cx:0,cy:-12,r:3.8,class:'horse-head'});const txt=svgEl('text',{x:0,y:.5,class:'horse-num'});txt.textContent=h+1;g.append(body,head,txt);els.horseLayer.appendChild(g);}}}
function renderList(){els.routineList.replaceChildren();if(!state.moves.length){els.routineList.innerHTML='<div class="empty-list">Tap “Make a Pro Routine” or add moves above.</div>';}else state.moves.slice(0,8).forEach((m,i)=>{const row=document.createElement('div');row.className='move-row';row.innerHTML=`<b>${i+1}</b><span>${LABELS[m]}</span><small>${m==='hold'?'hold':'synced'}</small>`;els.routineList.appendChild(row);});if(state.moves.length>8){const row=document.createElement('div');row.className='move-row';row.innerHTML=`<b>+</b><span>${state.moves.length-8} more moves</span><small>synced</small>`;els.routineList.appendChild(row);}els.moveCount.textContent=`${state.moves.length} move${state.moves.length===1?'':'s'}`;}
function renderUi(){buildRoutes();renderRoutes();renderHorses();renderList();els.arenaEmpty.classList.toggle('hidden',state.moves.length>0);els.routineName.textContent=state.name;els.teamSummary.textContent=`${state.lines} lines · ${state.horses} horses each · synchronized`;els.statusPill.textContent=state.moves.length?'Synchronized':'Ready';els.timeline.max=Math.max(.01,state.duration);els.timeline.value=state.time;els.timeLabel.textContent=formatTime(state.time);els.durationLabel.textContent=formatTime(state.duration);document.querySelectorAll('#lineCount button').forEach(b=>b.classList.toggle('active',Number(b.dataset.lines)===state.lines));els.horsesPerLine.value=state.horses;els.pace.value=state.pace;els.playBtn.innerHTML=state.playing?'❚❚ <span>PAUSE</span>':'▶ <span>PLAY ROUTINE</span>';}
function formatTime(s){s=Math.max(0,s||0);return`${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;}
function toast(msg){els.toast.textContent=msg;els.toast.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.classList.remove('show'),1800);}
function stop(){state.playing=false;if(state.raf)cancelAnimationFrame(state.raf);state.raf=0;}
function play(){if(!state.moves.length){toast('Build a routine first');return;}if(state.playing){stop();renderUi();return;}if(state.time>=state.duration-.05)state.time=0;state.playing=true;state.last=performance.now();tick(state.last);}
function tick(now){if(!state.playing)return;state.time+=(now-state.last)/1000;state.last=now;if(state.time>=state.duration){state.time=state.duration;stop();}renderHorses();els.timeline.value=state.time;els.timeLabel.textContent=formatTime(state.time);els.playBtn.innerHTML=state.playing?'❚❚ <span>PAUSE</span>':'▶ <span>PLAY ROUTINE</span>';if(state.playing)state.raf=requestAnimationFrame(tick);}
function addMove(m){stop();if(state.moves.length>=10){toast('Routine is full — play it or undo a move');return;}state.moves.push(m);state.name='My Professional Routine';state.time=0;renderUi();toast(`${LABELS[m]} added`);}
function proRoutine(){stop();const choices=[['straight','split','figure8','weave','circle','diamond','finish'],['split','pinwheel','figure8','weave','clover','diamond','finish'],['straight','sweep','diamond','figure8','pinwheel','clover','finish'],['split','circle','weave','figure8','diamond','pinwheel','clover','finish']];state.moves=choices[state.variant%choices.length].slice();state.variant++;state.name='Professional Show Routine';state.time=0;renderUi();toast('Complete synchronized routine built');}
function reset(){stop();state.moves=[];state.name='New Routine';state.time=0;renderUi();}
function save(){const data={lines:state.lines,horses:state.horses,pace:state.pace,moves:state.moves,name:state.name,variant:state.variant};localStorage.setItem(STORE,JSON.stringify(data));toast('Routine saved on this device');}
function load(){try{const d=JSON.parse(localStorage.getItem(STORE)||'null');if(!d)return;Object.assign(state,{lines:d.lines||2,horses:d.horses||6,pace:d.pace||'show',moves:Array.isArray(d.moves)?d.moves:[],name:d.name||'Saved Routine',variant:d.variant||0});}catch{}}
function exportRoutine(){const blob=new Blob([JSON.stringify({version:1,name:state.name,lines:state.lines,horsesPerLine:state.horses,pace:state.pace,moves:state.moves},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='rodeo-routine.json';a.click();URL.revokeObjectURL(url);toast('Routine exported');}
els.lineCount.addEventListener('click',e=>{const b=e.target.closest('[data-lines]');if(!b)return;stop();state.lines=Number(b.dataset.lines);state.time=0;renderUi();});
els.horsesPerLine.addEventListener('change',()=>{stop();state.horses=Number(els.horsesPerLine.value);state.time=0;renderUi();});
els.pace.addEventListener('change',()=>{stop();state.pace=els.pace.value;state.time=0;renderUi();});
els.proBtn.addEventListener('click',proRoutine);els.moveGrid.addEventListener('click',e=>{const b=e.target.closest('[data-move]');if(b)addMove(b.dataset.move);});
els.undoBtn.addEventListener('click',()=>{stop();if(state.moves.length){state.moves.pop();state.time=0;renderUi();}});els.clearBtn.addEventListener('click',reset);els.newBtn.addEventListener('click',reset);els.playBtn.addEventListener('click',play);els.restartBtn.addEventListener('click',()=>{stop();state.time=0;renderUi();});els.timeline.addEventListener('input',()=>{stop();state.time=Number(els.timeline.value)||0;renderHorses();els.timeLabel.textContent=formatTime(state.time);});els.saveBtn.addEventListener('click',save);els.exportBtn.addEventListener('click',exportRoutine);
load();renderUi();
})();
