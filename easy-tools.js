(() => {
  'use strict';

  const KEY = 'rodeo-drill-designer-v3';
  const SELECTED_KEY = 'rodeo-easy-selected-line';
  const TOAST_KEY = 'rodeo-easy-toast';
  const ARENA = { x:52, y:52, width:896, height:456, lengthFt:200, widthFt:100 };
  const COLORS = ['#f0b84e','#60a5fa','#ef6f6c','#65c18c'];
  const $ = id => document.getElementById(id);
  const uid = p => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  const clamp = (v,a,b) => Math.min(b,Math.max(a,v));
  const dist = (a,b) => Math.hypot(b.x-a.x,b.y-a.y);

  function toast(message){
    const el=$('toast'); if(!el)return;
    el.textContent=message; el.classList.add('show');
    setTimeout(()=>el.classList.remove('show'),2800);
  }
  function read(){
    try{return JSON.parse(localStorage.getItem(KEY)||'null');}catch{return null;}
  }
  function saveCurrent(){
    $('saveBtn')?.click();
    return read();
  }
  function currentName(){ return $('editorTitle')?.textContent?.trim()||''; }
  function selectedLine(drill){
    const name=currentName();
    let line=drill?.lines?.find(l=>l.name===name)||drill?.lines?.[0]||null;
    if(line?.matchedGroupId&&line.matchedRole!=='master') line=drill.lines.find(l=>l.matchedGroupId===line.matchedGroupId&&l.matchedRole==='master')||line;
    return line;
  }
  function rememberSelection(name){ if(name)sessionStorage.setItem(SELECTED_KEY,name); }
  function commit(drill,message,lineName){
    if(!drill)return;
    drill.updatedAt=new Date().toISOString();
    localStorage.setItem(KEY,JSON.stringify(drill));
    if(message)sessionStorage.setItem(TOAST_KEY,message);
    rememberSelection(lineName||currentName());
    location.reload();
  }
  function restoreUi(){
    const msg=sessionStorage.getItem(TOAST_KEY); if(msg){sessionStorage.removeItem(TOAST_KEY);setTimeout(()=>toast(msg),120);}
    const name=sessionStorage.getItem(SELECTED_KEY); if(name){sessionStorage.removeItem(SELECTED_KEY);setTimeout(()=>{[...document.querySelectorAll('.line-card')].find(b=>b.textContent.includes(name))?.click();},80);}
    const strength=$('straightenStrength'); if(strength&&strength.value!=='strong'){strength.value='strong';strength.dispatchEvent(new Event('change',{bubbles:true}));}
  }

  function perpendicular(p,a,b){
    const dx=b.x-a.x,dy=b.y-a.y;if(!dx&&!dy)return dist(p,a);
    const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy),q={x:a.x+t*dx,y:a.y+t*dy};return dist(p,q);
  }
  function snapAxis(a,b,deg=25){
    const dx=b.x-a.x,dy=b.y-a.y,adx=Math.abs(dx),ady=Math.abs(dy),tan=Math.tan(deg*Math.PI/180),out={x:b.x,y:b.y};
    if(adx<=ady*tan)out.x=a.x; else if(ady<=adx*tan)out.y=a.y;
    else if(Math.max(adx,ady)&&Math.abs(adx-ady)/Math.max(adx,ady)<.13){const d=Math.min(adx,ady);out.x=a.x+Math.sign(dx)*d;out.y=a.y+Math.sign(dy)*d;}
    return out;
  }
  function nearStraight(points){
    if(!points||points.length<2)return false;
    const a=points[0],b=points[points.length-1],chord=dist(a,b); if(chord<45)return false;
    let path=0,maxDev=0;for(let i=1;i<points.length;i++){path+=dist(points[i-1],points[i]);if(i<points.length-1)maxDev=Math.max(maxDev,perpendicular(points[i],a,b));}
    return maxDev<=26||path/chord<=1.095;
  }
  function lastMove(segments){ for(let i=segments.length-1;i>=0;i--)if(segments[i].type==='move'&&segments[i].points?.length>=2)return segments[i];return null; }
  function editableSegments(line){ return line?.matchedGroupId?(line.mirrorRawSegments=line.mirrorRawSegments||[]):line?.segments; }
  function makePerfectStraight(){
    const drill=saveCurrent(),line=selectedLine(drill);if(!line)return toast('Select a line first.');
    const move=lastMove(editableSegments(line)||[]);if(!move)return toast('Draw a movement first.');
    const start={...move.points[0]},end=snapAxis(start,move.points[move.points.length-1],30);move.points=[start,end];
    commit(drill,'Last movement made perfectly straight',line.name);
  }
  function chaikin(points,passes=3){
    let out=points.map(p=>({...p}));for(let pass=0;pass<passes;pass++){if(out.length<3)break;const next=[out[0]];for(let i=0;i<out.length-1;i++){const a=out[i],b=out[i+1];next.push({x:a.x*.75+b.x*.25,y:a.y*.75+b.y*.25},{x:a.x*.25+b.x*.75,y:a.y*.25+b.y*.75});}next.push(out[out.length-1]);out=next;}return out;
  }
  function smoothLastCurve(){
    const drill=saveCurrent(),line=selectedLine(drill);if(!line)return toast('Select a line first.');
    const move=lastMove(editableSegments(line)||[]);if(!move)return toast('Draw a movement first.');
    if(move.points.length<3)return toast('That movement is already straight.');
    move.points=chaikin(move.points,3);commit(drill,'Last curve smoothed into a clean professional arc',line.name);
  }
  function figureEightPoints(cx=500,cy=280,rx=175,ry=125,steps=96){
    const pts=[];for(let i=0;i<=steps;i++){const t=i/steps*Math.PI*2;pts.push({x:clamp(cx+rx*Math.sin(t),60,940),y:clamp(cy+ry*Math.sin(t)*Math.cos(t)*2,60,500)});}return pts;
  }
  function addPerfectFigureEight(){
    const drill=saveCurrent(),line=selectedLine(drill);if(!line)return toast('Select a line first.');
    const segments=editableSegments(line);const prev=lastMove(segments);const end=prev?.points?.[prev.points.length-1];
    if(end&&dist(end,{x:500,y:280})>12)segments.push({type:'move',id:uid('move'),points:[{...end},snapAxis(end,{x:500,y:280},12)]});
    segments.push({type:'move',id:uid('move'),points:figureEightPoints()});
    commit(drill,'Perfect figure 8 added',line.name);
  }

  function catmull(anchors,steps=10){
    const a=anchors.map(([x,y])=>({x,y})),out=[];
    for(let i=0;i<a.length-1;i++){const p0=a[Math.max(0,i-1)],p1=a[i],p2=a[i+1],p3=a[Math.min(a.length-1,i+2)];const count=i===a.length-2?steps+1:steps;for(let s=0;s<count;s++){const t=s/steps,t2=t*t,t3=t2*t;out.push({x:.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),y:.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3)});}}
    return out.map(p=>({x:clamp(p.x,57,943),y:clamp(p.y,57,503)}));
  }
  function buildMirroredFigureEight(){
    const before=saveCurrent(),total=before?.lines?.reduce((s,l)=>s+(Number(l.horseCount)||0),0)||12,per=clamp(Math.round(total/2),3,24),speed=10.5,spacing=18,headway=spacing/(speed*1.4666667);
    const left=[[486,500],[486,430],[470,390],[390,350],[285,320],[215,255],[230,180],[315,125],[410,155],[500,280],[590,405],[690,445],[790,410],[850,330],[830,250],[750,190],[640,205],[500,280],[420,345],[380,405],[430,465],[486,490]],right=left.map(([x,y])=>[1000-x,y]);
    const drill={version:3,id:uid('drill'),name:'Perfect Mirrored Figure 8',venue:'Frost Bank Center / AT&T Center, San Antonio, Texas',arena:{lengthFt:200,widthFt:100},autoWeave:true,smartStraighten:true,straightenStrength:'strong',routineNote:'Easy Build: two mathematically mirrored lines leave the south chute side-by-side, split left/right, make matching figure-eight sweeps, and alternate one-by-one through the center crossings.',updatedAt:new Date().toISOString(),lines:[
      {id:uid('line'),name:'Gold — Left',color:COLORS[0],horseCount:per,speedMph:speed,spacingFt:spacing,startDelay:0,formation:'single',lateralGapFt:8,segments:[{type:'move',id:uid('move'),points:catmull(left)}]},
      {id:uid('line'),name:'Blue — Right',color:COLORS[1],horseCount:per,speedMph:speed,spacingFt:spacing,startDelay:headway/2,formation:'single',lateralGapFt:8,segments:[{type:'move',id:uid('move'),points:catmull(right)}]}
    ]};
    commit(drill,'Perfect mirrored figure 8 built — press Play','Gold — Left');
  }

  function autoCorrectAfterDraw(){
    setTimeout(()=>{
      const drill=saveCurrent(),line=selectedLine(drill);if(!line)return;
      const move=lastMove(editableSegments(line)||[]);if(!move||!nearStraight(move.points))return;
      const start={...move.points[0]},end=snapAxis(start,move.points[move.points.length-1],25);move.points=[start,end];
      commit(drill,'Straight run snapped perfectly straight',line.name);
    },40);
  }

  $('perfectStraightBtn')?.addEventListener('click',makePerfectStraight);
  $('smoothCurveBtn')?.addEventListener('click',smoothLastCurve);
  $('figureEightBtn')?.addEventListener('click',addPerfectFigureEight);
  $('mirrorFigureEightBtn')?.addEventListener('click',buildMirroredFigureEight);
  $('interactionSurface')?.addEventListener('pointerup',autoCorrectAfterDraw);
  restoreUi();
})();