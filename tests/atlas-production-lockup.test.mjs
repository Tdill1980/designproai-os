import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {planProductionPanelLockup,planElementLockup}=require('../runtime/atlas-element-lockup.cjs');
const panels=[['driver',878,361],['passenger',878,367],['roof',457,355],['hood',440,355],['rear',468,344],['front',749,243]]
  .map(([surfaceKey,width,height])=>({surfaceKey,rect:{left:0,top:0,width,height}}));
const elements=[['logo',512,512],['typography',1600,334],['contact',1600,404]]
  .map(([role,width,height],i)=>({role,width,height,contentHash:String(i).repeat(64),storagePath:`original/${role}`,byteSize:100+i}));
const plan=assets=>planProductionPanelLockup({panels,elements:assets||elements});
const overlap=(a,b)=>Math.min(a.xPct+a.wPct,b.xPct+b.wPct)>Math.max(a.xPct,b.xPct)
  &&Math.min(a.yPct+a.hPct,b.yPct+b.hPct)>Math.max(a.yPct,b.yPct);

test('actual production crops retain every original once per nonroof panel, with wide type independent of square logo',()=>{
  const out=plan();assert.equal(out.contract,'designpro.production-panel-lockup.v1');assert.equal(out.placements.length,15);
  for(const panel of panels){
    const placed=out.placements.filter(p=>p.surfaceKey===panel.surfaceKey);
    if(panel.surfaceKey==='roof'){assert.equal(placed.length,0);continue;}
    assert.deepEqual(placed.map(p=>p.role),elements.map(e=>e.role));
    const logo=placed.find(p=>p.role==='logo');
    for(const p of placed){
      const original=elements.find(e=>e.role===p.role),b=p.box;
      assert.equal(p.contentHash,original.contentHash);assert.equal(p.storagePath,original.storagePath);assert.equal(p.byteSize,original.byteSize);
      assert.equal(p.flipped,false);assert.equal(p.mirroredFrom,null);
      assert.ok(b.xPct>=0.08&&b.yPct>=0.08&&b.xPct+b.wPct<=0.92&&b.yPct+b.hPct<=0.92);
      const actual=b.wPct*panel.rect.width/(b.hPct*panel.rect.height),expected=original.width/original.height;
      assert.ok(Math.abs(actual/expected-1)<0.0001,`${panel.surfaceKey}/${p.role} aspect preserved`);
      if(p.role!=='logo'){assert.ok(b.wPct>=0.55,`${panel.surfaceKey} text gets most of panel width`);assert.ok(b.wPct>=3*logo.box.wPct);}
    }
    for(let i=0;i<placed.length;i++)for(let j=i+1;j<placed.length;j++)assert.equal(overlap(placed[i].box,placed[j].box),false);
  }
  const tallLogo=plan(elements.map(e=>e.role==='logo'?{...e,width:200,height:1800}:e));
  assert.deepEqual(tallLogo.placements.filter(p=>p.role!=='logo'),out.placements.filter(p=>p.role!=='logo'),'logo shape never shrinks text');
  assert.notDeepEqual(out.placements.find(p=>p.surfaceKey==='driver'&&p.role==='typography').box,
    out.placements.find(p=>p.surfaceKey==='passenger'&&p.role==='typography').box,'each measured crop has its own aspect');
});

test('production planner handles all nonempty known asset subsets without silently omitting any',()=>{
  for(let mask=1;mask<8;mask++){
    const selected=elements.filter((_,i)=>mask&(1<<i));const out=plan(selected);
    assert.equal(out.placements.length,selected.length*5);
    for(const surface of out.surfaces)assert.deepEqual(out.placements.filter(p=>p.surfaceKey===surface).map(p=>p.role),selected.map(e=>e.role));
  }
  assert.deepEqual(plan([...elements].reverse()),plan(),'input asset order never changes final hierarchy');
});

test('production planner refuses unknown/duplicate roles, invalid crops and unreadably tall type',()=>{
  for(const assets of [[],[...elements,elements[0]], [...elements,{role:'mystery',width:20,height:20}],elements.map(e=>e.role==='typography'?{...e,width:NaN}:e),elements.map(e=>e.role==='contact'?{...e,height:Infinity}:e)])
    assert.throws(()=>plan(assets),{code:'atlas_lockup_element_invalid'});
  for(const measured of [panels.slice(1),[...panels.slice(1),panels[1]],panels.map((p,i)=>i?p:{...p,surfaceKey:'unknown'}),panels.map((p,i)=>i?p:{...p,rect:{width:Infinity,height:100}}),panels.map((p,i)=>i?p:{...p,rect:{width:100,height:0}})])
    assert.throws(()=>planProductionPanelLockup({panels:measured,elements}),{code:'atlas_lockup_zone_invalid'});
  assert.throws(()=>plan(elements.map(e=>e.role==='typography'?{...e,width:100,height:2000}:e)),{code:'atlas_lockup_text_unreadable'});
});

test('legacy planner keeps its existing shared-width and passenger-box mirroring contract',()=>{
  const legacy=planElementLockup({zones:[{surfaceKey:'driver',trim:{w:878,h:361}}],elements});
  assert.equal(legacy.contract,'designpro.atlas-element-lockup.v1');assert.equal(legacy.placements.length,6);
  assert.equal(new Set(legacy.placements.map(p=>p.box.wPct)).size,1);
  assert.ok(legacy.placements.filter(p=>p.surfaceKey==='passenger').every(p=>p.mirroredFrom==='driver'));
});
