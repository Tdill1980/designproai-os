import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const atlas = require('../runtime/flat-first-atlas.cjs');
const sharp = require('../runtime/node_modules/sharp');
const teaching = require('../runtime/flat-atlas-topology-examples.cjs').loadBundledAtlasTeachingProof();
// Owner ruling 2026-09-07: the runtime lays the canonical GENIE manifest out as
// field territories before authoring, so a fixture that paints its synthetic
// master at legacy zone geometry no longer lines up with the zones the loop
// reads. Build the fixture master through the SAME layout the product uses.
const { buildFieldTerritories } = require('../runtime/atlas-field-territories.cjs');
const productManifest = (...a) => atlas.buildAtlasManifest(...a);
const sha = atlas._test.sha256;
const surfaces = [ ['driver',153,56], ['passenger',153,56], ['hood',71.5,56],
  ['roof',74.3,54.8], ['front',129,34], ['rear',76,54] ].map(([surfaceKey,widthInches,heightInches]) => ({
    surfaceKey,widthInches,heightInches,bleed:{top:5,right:5,bottom:5,left:5},
  }));
const geometryResolution = { contract:'designpro.genie-manifest.v1', genieManifestId:'0'.repeat(32),
  genieManifestHash:'0'.repeat(64), state:'derived', derivationContract:'designpro.genie-front-derived.v1',
  derivedSurfaces:['front'], geometrySourceRowId:'fixture', productionEligible:false, operatorValidated:false };
const input = {contractVersion:atlas.INPUT_CONTRACT,pipelineMode:atlas.PIPELINE_MODE,mode:'commercial',
  companyName:'Precision Climate Solutions',brief:'Blue and orange HVAC wrap',
  vehicle:{year:'2022',make:'Ford',model:'F250 Crew Cab',type:'truck'}};
const extras = {teachingProofStoragePath:`atlas-call1-inputs/${teaching.flattenedTopView.contentHash}.png`,
  teachingProofIdentity:teaching.identity,guideStoragePath:`atlas-call1-inputs/${'a'.repeat(64)}.png`,referenceImagesBase64:[]};
const creativeBody = ({ providerRequest: _transportOnly, ...body }) => body;

// Execute the real authoring function, including normalization, gates, storage,
// extraction and lineage. The provider is replaced only at its network seam.
// Six different pixel patterns expose a duplicated register even when its
// dimensions, PNG hashes and opacity are otherwise valid.
test('one authored topology preserves all six distinct source regions through persistence', async () => {
  const manifest = productManifest(surfaces, undefined, 'truck');
  manifest.geometryResolution = geometryResolution;
  const layers = [];
  for (const [i,z] of manifest.zones.entries()) {
    const raw = Buffer.alloc(z.w*z.h*3);
    for (let y=0;y<z.h;y++) for(let x=0;x<z.w;x++) {
      const offset=(y*z.w+x)*3;
      raw[offset]=45+i*25;
      raw[offset+1]=50+Math.round(x/z.w*145);
      raw[offset+2]=55+Math.round(y/z.h*140);
    }
    layers.push({input:await sharp(raw,{raw:{width:z.w,height:z.h,channels:3}}).png().toBuffer(),left:z.x,top:z.y});
  }
  const source=await sharp({create:{width:4096,height:4096,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
    .composite(layers).png().toBuffer();
  const expected=await atlas.cutCallOnePanels(source,manifest,sha(source));
  const stored=new Map();let inserted;let calls=0;
  const query={select(){return this},eq(){return this},order(){return this},limit(){return this},
    async maybeSingle(){return {data:null,error:null}},
    insert(row){inserted=row;return this},async single(){return {data:inserted,error:null}}};
  const result=await atlas.generateOrReuseFlatAtlas({
    input,surfaces,geometryResolution,requestId:'11111111-1111-4111-8111-111111111111',
    generationId:'22222222-2222-4222-8222-222222222222',ownerId:'33333333-3333-4333-8333-333333333333',
    tenantKey:'user_33333333-3333-4333-8333-333333333333',claimToken:'44444444-4444-4444-8444-444444444444',
    provider:{},
    supabase:{from(){return query},async rpc(){return {data:true,error:null}}},
    store:{async putImmutableBytes(row){stored.set(row.storagePath,row.bytes);return {storagePath:row.storagePath,contentHash:sha(row.bytes),byteSize:row.bytes.length}}},
    callEdge:async body=>{
      calls++;
      // Owner ruling 2026-09-07: the product authors one field and cuts six
      // code-only territories. No structural image reaches the model, and the
      // six regions still travel as OS data the edge validates.
      assert.equal(body.fieldContract,undefined);
      assert.equal(body.noseEdge,undefined);
      assert.equal(body.panels.length,6);
      assert.equal(sha(stored.get(body.teachingProofStoragePath)),teaching.flattenedTopView.contentHash);
      assert.ok(stored.get(body.guideStoragePath));
      // Both pinned inputs are still BUILT and stored -- installer map and
      // forensic record -- they simply do not travel to the model.
      assert.equal(stored.size>0,true);
      return {bytes:source,provenance:{imageRequestCount:1,masterSha256:sha(source)}};
    },
  });
  assert.equal(calls,1);
  assert.equal(result.metadata.atlasFieldContract,null);
  assert.equal(result.metadata.atlasFieldComposeContract,undefined);
  // Owner ruling 2026-09-07: the receipt now records what actually reached
  // the model. Under the one-field contract no teaching example is sent, so
  // this is false there and true on the six-container branch.
  assert.equal(result.metadata.atlasDesignTeachingExampleApplied,true);
  assert.equal(inserted.metadata.callOnePanels.length,6);
  for(const original of expected){
    const panel=inserted.metadata.callOnePanels.find(p=>p.surfaceKey===original.surfaceKey);
    const actual=await sharp(stored.get(panel.storagePath)).ensureAlpha().raw().toBuffer();
    const wanted=await sharp(original.bytes).ensureAlpha().raw().toBuffer();
    assert.equal(sha(actual),sha(wanted),`${panel.surfaceKey} must preserve its own authored pixels`);
    assert.equal(panel.sourceMasterHash,inserted.master_content_hash);
    assert.equal(panel.bleedInches,5);
    assert.equal(panel.printWidthIn,panel.trimWidthIn+10);
    assert.equal(panel.printHeightIn,panel.trimHeightIn+10);
  }
});

test('six-surface transport rejects field-mode, missing teaching identity and missing guide inputs', async t=>{
  const previous={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY};
  process.env.SUPABASE_URL='https://fixture.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-only-not-a-real-key-'.repeat(3);
  t.after(()=>{for(const [name,value] of [['SUPABASE_URL',previous.url],['SUPABASE_SERVICE_ROLE_KEY',previous.key]]){
    if(value===undefined) delete process.env[name];else process.env[name]=value;
  }});
  const bytes=Buffer.from('mock transport bytes');let downloads=0;
  const body=atlas._test.atlasEdgeRequestBody(input,atlas.buildAtlasManifest(surfaces),extras);
  const reply={success:true,imageRequestCount:1,fieldContract:null,teachingProofIdentity:teaching.identity,
    modelInputImageCount:2,promptVersion:'atlas-artboard-designiq.20260901.v23-orthographic-restored',
    masterStoragePath:'fixture.png',masterSha256:sha(bytes)};
  const transport={supabase:{storage:{from(){return {async download(){downloads++;return {data:new Blob([bytes]),error:null}}}}}},
    fetchImpl:async()=>({ok:true,status:200,json:async()=>reply})};
  const downloaded=await atlas._test.callAtlasArtboardEdge(body,transport);
  assert.equal(sha(downloaded.bytes),sha(bytes));
  assert.equal(downloaded.provenance.masterStoragePath,reply.masterStoragePath);
  assert.equal(downloads,1);
  for(const override of [{fieldContract:'designpro.atlas-field-prompt.v2'}, {teachingProofIdentity:null},
    {modelInputImageCount:0},{promptVersion:'stale'},
    {teachingProofIdentity:{...teaching.identity,flattenedTopViewContentHash:'f'.repeat(64)}}]){
    await assert.rejects(atlas._test.callAtlasArtboardEdge(body,{...transport,
      fetchImpl:async()=>({ok:true,status:200,json:async()=>({...reply,...override})})}),
      error=>error.code==='flat_atlas_edge_topology_contract_mismatch');
  }
  await assert.rejects(atlas._test.callAtlasArtboardEdge({...body,guideStoragePath:undefined},transport),
    error=>error.code==='flat_atlas_edge_topology_contract_mismatch');
  assert.equal(downloads,1,'invalid responses must fail before master download');
});

// The two halves ship through different workflows, so an edge/runtime skew is
// a real deploy state, not a hypothetical. On the field branch it is silent by
// construction -- contract matches, image count matches, master is valid -- and
// the only thing wrong is that the master was authored with the previous tail.
test('the field branch refuses an edge running a different prompt version', async t => {
  const previous={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY};
  process.env.SUPABASE_URL='https://fixture.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-only-not-a-real-key-'.repeat(3);
  t.after(()=>{for(const [name,value] of [['SUPABASE_URL',previous.url],['SUPABASE_SERVICE_ROLE_KEY',previous.key]]){
    if(value===undefined) delete process.env[name];else process.env[name]=value;
  }});
  const bytes=Buffer.from('mock transport bytes');let downloads=0;
  // The field branch is no longer selected by production (v23 restore), but the
  // guard still protects it, so the test names the contract explicitly.
  const body={...atlas._test.atlasEdgeRequestBody(input,productManifest(surfaces,undefined,'truck'),
    {referenceImagesBase64:[]}), fieldContract:'designpro.atlas-field-prompt.v2'};
  const current=/ATLAS_ARTBOARD_EDGE_PROMPT_VERSION = "([^"]+)"/
    .exec(readFileSync(new URL('../runtime/flat-first-atlas.cjs',import.meta.url),'utf8'))[1];
  const reply={success:true,imageRequestCount:1,fieldContract:'designpro.atlas-field-prompt.v2',
    modelInputImageCount:0,promptVersion:current,
    masterStoragePath:'fixture.png',masterSha256:sha(bytes)};
  const transport={supabase:{storage:{from(){return {async download(){downloads++;return {data:new Blob([bytes]),error:null}}}}}},
    fetchImpl:async()=>({ok:true,status:200,json:async()=>reply})};
  // Matching version: accepted.
  assert.equal(sha((await atlas._test.callAtlasArtboardEdge(body,transport)).bytes),sha(bytes));
  // A stale edge is refused BEFORE the master is downloaded.
  for(const stale of ['atlas-artboard-designiq.20260906.v25-rectangular-media',
                      'atlas-artboard-designiq.20260902.v24-one-field','']){
    await assert.rejects(atlas._test.callAtlasArtboardEdge(body,{...transport,
      fetchImpl:async()=>({ok:true,status:200,json:async()=>({...reply,promptVersion:stale})})}),
      error=>error.code==='flat_atlas_edge_prompt_version_mismatch');
  }
  assert.equal(downloads,1,'a skewed edge must fail before the master download');
});

// Exercise the actual acceptance loop. A cutout classification is a refusal
// under the restored no-heal contract, and must consume the same bounded
// fallback as any other refused candidate. This fixture isolates control flow;
// it does not stand in for the inaccessible 3b9b3209 production artwork.
async function cutoutLoopFixtures() {
  const manifest=productManifest(surfaces,undefined,'truck');
  const layers=await Promise.all(manifest.zones.map(async z=>({
    input:await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${z.w}" height="${z.h}">
      <defs><linearGradient id="g"><stop stop-color="#227daa"/><stop offset="1" stop-color="#f9b85a"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
    </svg>`)).png().toBuffer(),left:z.x,top:z.y,
  })));
  const clean=await sharp({create:{width:4096,height:4096,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
    .composite(layers).png().toBuffer();
  const hood=manifest.zones.find(z=>z.surfaceKey==='hood');
  const hole=await sharp(clean).composite([{
    input:await sharp({create:{width:Math.round(hood.w*.25),height:Math.round(hood.h*.25),
      channels:3,background:'#000000'}}).png().toBuffer(),
    left:hood.x+Math.round(hood.w*.4),top:hood.y+Math.round(hood.h*.4),
  }]).png().toBuffer();
  const qc=require('../runtime/atlas-master-qc.cjs');
  const checks=await qc.deterministicMasterChecks(hole,manifest);
  assert.deepEqual(checks.blockingFailures,[],'isolate a cutout-only refusal');
  assert.deepEqual([...new Set(checks.cutoutFindings.map(x=>x.surfaceKey))],['hood']);
  assert.equal((await qc.deterministicMasterChecks(clean,manifest)).accepted,true);
  return {clean,hole};
}

function runCutoutLoop(candidates) {
  const requests=[],stored=new Map();let inserted=null;let publications=0;
  const query={select(){return this},eq(){return this},order(){return this},limit(){return this},
    async maybeSingle(){return {data:null,error:null}},
    insert(row){inserted=row;return this},async single(){return {data:inserted,error:null}}};
  const paths=candidates.map((_,i)=>`atlas-call1/55555555-5555-4555-8555-55555555555${i}.png`);
  const done=atlas.generateOrReuseFlatAtlas({
    input,surfaces,geometryResolution,requestId:'11111111-1111-4111-8111-111111111111',
    generationId:'22222222-2222-4222-8222-222222222222',ownerId:'33333333-3333-4333-8333-333333333333',
    tenantKey:'user_33333333-3333-4333-8333-333333333333',claimToken:'44444444-4444-4444-8444-444444444444',
    provider:{},
    supabase:{from(){return query},async rpc(){return {data:true,error:null}}},
    store:{async putImmutableBytes(row){stored.set(row.storagePath,row.bytes);return {storagePath:row.storagePath,contentHash:sha(row.bytes),byteSize:row.bytes.length}}},
    onMasterReady(){publications++},
    callEdge:async body=>{
      const index=requests.length;requests.push(body);
      assert.ok(index<candidates.length,'must not make a third authoring request');
      return {bytes:candidates[index],provenance:{imageRequestCount:1,
        masterStoragePath:paths[index],masterSha256:sha(candidates[index])}};
    },
  });
  return {done,requests,stored,paths,get inserted(){return inserted},get publications(){return publications}};
}

test('cutout-only first candidate uses the unchanged fallback and publishes only a clean master',async()=>{
  const {clean,hole}=await cutoutLoopFixtures();
  const run=runCutoutLoop([hole,clean]);
  const result=await run.done;
  assert.equal(run.requests.length,2);
  assert.deepEqual(creativeBody(run.requests[1]),creativeBody(run.requests[0]),'the fallback cannot rewrite the brief or prompt');
  assert.deepEqual(run.requests.map((body)=>body.providerRequest.attemptKey),['master:1','master:2']);
  assert.equal(run.publications,1);
  assert.equal(result.metadata.masterAuthoringAttempts,2);
  const actual=await sharp(run.stored.get(run.inserted.master_storage_path)).ensureAlpha().raw().toBuffer();
  const expected=await sharp(clean).ensureAlpha().raw().toBuffer();
  assert.equal(sha(actual),sha(expected),'accepted artwork must be the clean authored candidate, with no healing');
  assert.equal(run.inserted.metadata.callOnePanels.length,6);
});

test('two cutout candidates fail closed with retrievable paths and the measured surface finding',async()=>{
  const {hole}=await cutoutLoopFixtures();
  const run=runCutoutLoop([hole,hole]);
  await assert.rejects(run.done,error=>{
    assert.equal(error.code,'flat_atlas_unrepaired_cutout');
    assert.equal(error.retryable,false,'the worker must not restart the provider budget');
    assert.match(error.message,/hood/);
    assert.match(error.message,/largestCutoutComponentRatio=/);
    assert.ok(error.message.length<=1000,'the worker persists at most 1000 characters');
    for(const path of run.paths) assert.ok(error.message.includes(path));
    assert.ok(error.message.includes(sha(hole)),'retain the raw-byte identity, never a signed URL');
    return true;
  });
  assert.equal(run.requests.length,2,'a cutout refusal must use exactly the existing two-attempt budget');
  assert.deepEqual(creativeBody(run.requests[1]),creativeBody(run.requests[0]));
  assert.equal(run.inserted,null,'refused artwork cannot become an atlas revision');
  assert.equal(run.publications,0,'refused artwork cannot start proofs');
  assert.equal([...run.stored.keys()].some(path=>path.includes('/master/')||path.includes('/panels/')),false);
});
