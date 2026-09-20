import assert from 'node:assert/strict';
import test from 'node:test';
import { createGateway } from '../src/server.mjs';
const id=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const owner=id('a'),generation=id('b'),purchased=id('c'),newer=id('d'),oldRun=id('e'),newRun=id('f');
const headers={cookie:'dp_session=test-token'};
async function fixture(t){
  const reads=[];
  const make=(run,revision)=>({id:run,revision_id:revision,revision_snapshot_hash:'a'.repeat(64),workflow_type:'designpro.production_pack',status:'waiting',results:{generationId:generation}});
  // Return both revisions deliberately: the gateway must never fall back from
  // the purchased revision to a newer run even with unordered upstream rows.
  const runs=[make(newRun,newer),make(oldRun,purchased)];
  for(const [index,sourceId]of [[0,id('2')],[1,id('3')]]){
    const parent=runs[index];parent.artifact_set_hash='b'.repeat(64);parent.input={sourceEnticeRunId:sourceId};
    runs.push({...parent,id:sourceId,workflow_type:'designpro.entice_pack',input:{}});
  }
  const server=createGateway({env:{NODE_ENV:'test',SUPABASE_URL:'https://project.supabase.test',SUPABASE_PUBLISHABLE_KEY:'fixture'},fetchImpl:async value=>{
    const url=String(value);reads.push(url);
    if(url.endsWith('/auth/v1/user'))return Response.json({id:owner});
    if(url.includes('/designpro_workflow_runs?'))return Response.json(runs);
    if(url.includes('/designpro_workflow_stages?'))return Response.json([{stage_key:'await_purchase',status:'waiting'}]);
    if(url.includes('/designpro_revision_sources?'))return Response.json([{generation_id:generation,snapshot:{generationId:generation,designId:'DID-BBBBBBBB',orderNumber:'ORDER-1'}}]);
    if(url.includes('/designpro_artifacts?'))return Response.json([]);
    throw new Error(`unexpected ${url}`);
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {reads,base:`http://127.0.0.1:${server.address().port}`};
}
test('purchased revision status stays on its waiting payment gate after a newer revision exists',async t=>{
  const f=await fixture(t),response=await fetch(`${f.base}/api/jobs/${generation}?revisionId=${purchased}`,{headers});
  assert.equal(response.status,200);
  assert.ok(f.reads.some(url=>url.includes(`revision_id=eq.${purchased}`)));
  assert.ok(f.reads.some(url=>url.includes(`run_id=eq.${oldRun}`)));
  assert.ok(!f.reads.some(url=>url.includes(`run_id=eq.${newRun}`)));
  assert.ok(!f.reads.some(url=>url.includes('/internal/')||url.includes('/rpc/')),'reading progress cannot start production or grant payment');
});
test('missing or invalid purchased revision never falls back to current generation',async t=>{
  const f=await fixture(t);
  for(const suffix of ['', '/artifacts']){
    const missing=await fetch(`${f.base}/api/jobs/${generation}${suffix}?revisionId=${id('1')}`,{headers});
    assert.equal(missing.status,404);
    const invalid=await fetch(`${f.base}/api/jobs/${generation}${suffix}?revisionId=bad`,{headers});
    assert.equal(invalid.status,400);
  }
  assert.ok(!f.reads.some(url=>url.includes('/designpro_workflow_stages?')||url.includes('/designpro_artifacts?')));
});
test('without a pinned revision the existing current-generation status behavior remains',async t=>{
  const f=await fixture(t),response=await fetch(`${f.base}/api/jobs/${generation}`,{headers});
  assert.equal(response.status,200);
  assert.ok(f.reads.some(url=>url.includes(`run_id=eq.${newRun}`)));
});

test('pinned artifact reads include only the purchased production and its exact source',async t=>{
  const f=await fixture(t),response=await fetch(`${f.base}/api/jobs/${generation}/artifacts?revisionId=${purchased}`,{headers});
  assert.equal(response.status,200);
  const reads=f.reads.filter(url=>url.includes('/designpro_artifacts?'));
  assert.equal(reads.length,2);
  assert.ok(reads.some(url=>url.includes(`run_id=eq.${oldRun}`)));
  assert.ok(reads.some(url=>url.includes(`run_id=eq.${id('3')}`)));
  assert.ok(!reads.some(url=>url.includes(`run_id=eq.${newRun}`)));
});
