import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const atlas = require("../runtime/flat-first-atlas.cjs");
const sharp = require("../runtime/node_modules/sharp");
const { assembleFinishedMaster } = require("../runtime/atlas-finished-master.cjs");
const { finishPanel } = require("../runtime/atlas-panel-authoring.cjs");
const { sha256 } = atlas._test;

const surfaces = [["driver",153,56],["passenger",153,56],["hood",71.5,56],
  ["roof",74.3,54.8],["front",129,34],["rear",76,54]].map(([surfaceKey,widthInches,heightInches]) => ({
  surfaceKey,widthInches,heightInches,bleed:{top:5,right:5,bottom:5,left:5},
}));
const geometryResolution = { contract:"designpro.genie-manifest.v1",genieManifestId:"a".repeat(32),
  genieManifestHash:"a".repeat(64),state:"derived",derivationContract:"designpro.genie-front-derived.v1",
  derivedSurfaces:["front"],geometrySourceRowId:"fixture",productionEligible:false,operatorValidated:false };
const input = {contractVersion:atlas.INPUT_CONTRACT,pipelineMode:atlas.PIPELINE_MODE,mode:"commercial",
  companyName:"Recovery Fixture",brief:"Blue and orange test artwork",vehicle:{year:"2022",make:"Ford",model:"F250 Crew Cab",type:"truck"}};
const identities = { requestId:"11111111-1111-4111-8111-111111111111",
  generationId:"22222222-2222-4222-8222-222222222222",ownerId:"33333333-3333-4333-8333-333333333333",
  tenantKey:"user_33333333-3333-4333-8333-333333333333",claimToken:"44444444-4444-4444-8444-444444444444" };
let fixturePromise;
function fixture() {
  return fixturePromise ||= (async () => {
    const manifest = atlas.buildAtlasManifest(surfaces,undefined,"truck");
    manifest.geometryResolution = geometryResolution;
    const layers = [];
    for (const [i,zone] of manifest.zones.entries()) {
      const raw = Buffer.alloc(zone.w*zone.h*3);
      for (let y=0;y<zone.h;y++) for (let x=0;x<zone.w;x++) {
        const at=(y*zone.w+x)*3;
        raw[at]=45+i*25;raw[at+1]=50+Math.round(x/zone.w*145);raw[at+2]=55+Math.round(y/zone.h*140);
      }
      layers.push({input:await sharp(raw,{raw:{width:zone.w,height:zone.h,channels:3}}).png().toBuffer(),left:zone.x,top:zone.y});
    }
    const source = await sharp({create:{width:4096,height:4096,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
      .composite(layers).png().toBuffer();
    return {manifest,source};
  })();
}

function harness(source) {
  const bytes = new Map();
  const publicMasters = [], publicPanels = [], masterCalls = [], finishCalls = [];
  let inserted = null, pendingRow = null, fenceCalls = 0;
  let insertFailure = false, finishFailure = null, forceCacheOnly = false, corruptReads = null, whiteFinish = false;
  let checkpointRace = null;
  const query = {select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},
    async maybeSingle(){return {data:inserted,error:null};},
    insert(row){pendingRow=row;return this;},
    async single(){
      if (insertFailure) return {data:null,error:{message:"simulated database interruption"}};
      inserted=pendingRow;return {data:inserted,error:null};
    }};
  const supabase = {from(){return query;},async rpc(){fenceCalls++;return {data:!forceCacheOnly&&fenceCalls===1,error:null};},
    storage:{from(){return {async download(path){
      if (corruptReads === path) return {data:new Blob([Buffer.from("corrupt")]),error:null};
      if (!bytes.has(path)) return {data:null,error:{statusCode:"404",message:"Object not found"}};
      return {data:new Blob([bytes.get(path)]),error:null};
    }};}}};
  const store = {async putImmutableBytes({storagePath,bytes:body}){
    if(checkpointRace && storagePath.endsWith("/accepted.json")){
      const winner=JSON.parse(body);
      winner.record.revisionId=checkpointRace.revisionId;
      if(checkpointRace.inputHash)winner.record.inputHash=checkpointRace.inputHash;
      winner.recordHash=sha256(atlas._test.canonicalBytes(winner.record));
      bytes.set(storagePath,Buffer.from(JSON.stringify(winner)));
      checkpointRace=null;
      throw new Error("Immutable object already holds different bytes");
    }
    if (bytes.has(storagePath)) assert.equal(sha256(bytes.get(storagePath)),sha256(body),"immutable persistence must never overwrite");
    bytes.set(storagePath,Buffer.from(body));
    return {storagePath,contentHash:sha256(body),byteSize:body.length};
  }};
  const run = (extra={}) => atlas.generateOrReuseFlatAtlas({
    input,surfaces,geometryResolution,...identities,provider:{},supabase,store,
    callEdge:async body=>{masterCalls.push(body);return {bytes:source,provenance:{imageRequestCount:1,masterSha256:sha256(source)}};},
    callPanelEdge:async body=>{
      finishCalls.push(body);
      if (finishFailure === body.surfaceKey) throw Object.assign(new Error("provider_outcome_unknown"),{code:"provider_outcome_unknown",retryable:true});
      const subject = bytes.get(body.sourcePanelStoragePath);
      const meta = await sharp(subject).metadata();
      const output = whiteFinish ? await sharp({create:{width:meta.width,height:meta.height,channels:3,background:"#ffffff"}}).png().toBuffer()
        : await sharp(subject).linear(0.85,18).png().toBuffer();
      const path = `atlas-panel/${body.surfaceKey}.png`;
      bytes.set(path,output);
      return {panelStoragePath:path,panelSha256:sha256(output),panelBytes:output.length,imageRequestCount:1,
        userTurn:{role:"user",parts:[{text:`Exact original ${body.surfaceKey} instructions`},
          {imageRef:{storagePath:body.sourcePanelStoragePath,contentHash:body.sourcePanelHash}}]},
        modelTurn:{role:"model",parts:[{text:"Private provider thought",thought:true},
          {imageRef:{storagePath:path,contentHash:sha256(output)},thoughtSignature:`opaque-${body.surfaceKey}`}]},
        historyImageBytes:subject.length+output.length,thoughtSignatureCount:1};
    },
    onMasterReady(value){
      const accepted = [...bytes.keys()].find(path=>path.endsWith("/accepted.json")
        && JSON.parse(bytes.get(path)).record.revisionId===value.revisionId);
      assert.ok(accepted,"the accepted checkpoint must be durable before any public event");
      const record = JSON.parse(bytes.get(accepted)).record;
      assert.equal(record.revisionId,value.revisionId);
      assert.equal(record.master.contentHash,value.master.contentHash);
      publicMasters.push({revisionId:value.revisionId,hash:value.master.contentHash,bytes:value.master.bytes});
    },
    onSurfaceReady(value){publicPanels.push(value);},
    ...extra,
  });
  return {run,bytes,publicMasters,publicPanels,masterCalls,finishCalls,
    get inserted(){return inserted;},get fenceCalls(){return fenceCalls;},
    set insertFailure(value){insertFailure=value;},set finishFailure(value){finishFailure=value;},
    set forceCacheOnly(value){forceCacheOnly=value;},set corruptReads(value){corruptReads=value;},
    set whiteFinish(value){whiteFinish=value;},set checkpointRace(value){checkpointRace=value;}};
}

function finishFlag(t,value) {
  const previous = process.env.DESIGNPRO_ATLAS_PANEL_FINISH;
  process.env.DESIGNPRO_ATLAS_PANEL_FINISH=value;
  t.after(()=>previous===undefined?delete process.env.DESIGNPRO_ATLAS_PANEL_FINISH:process.env.DESIGNPRO_ATLAS_PANEL_FINISH=previous);
}

test("Call 1 uses its admission-reserved artwork identity for checkpoints, visible panels, final storage and recovery",async t=>{
  finishFlag(t,"off");
  const {source}=await fixture(),run=harness(source);
  const atlasRevisionId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  run.insertFailure=true;
  await assert.rejects(run.run({atlasRevisionId}),error=>error.code==="flat_atlas_revision_insert_failed");
  assert.equal(run.publicMasters[0].revisionId,atlasRevisionId);
  for(const panel of run.publicPanels)assert.equal(panel.atlas.revisionId,atlasRevisionId);
  for(const [path,bytes] of run.bytes)if(/\/(accepted|authored)\.json$/.test(path))assert.equal(JSON.parse(bytes).record.revisionId,atlasRevisionId);
  await assert.rejects(run.run({atlasRevisionId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}),error=>error.code==="flat_atlas_reserved_revision_conflict"&&!error.retryable);
  assert.equal(run.masterCalls.length,1,"a changed reservation cannot trigger new authoring");
  run.insertFailure=false;
  const result=await run.run({atlasRevisionId,claimToken:"55555555-5555-4555-8555-555555555555"});
  assert.equal(result.revisionId,atlasRevisionId);assert.equal(run.inserted.id,atlasRevisionId);
  assert.equal(run.masterCalls.length,1);assert.equal(result.callOnePanels.length,6);
  assert.equal(Object.keys(result.viewAuthorities).length,7);
  await assert.rejects(run.run({atlasRevisionId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}),error=>error.code==="flat_atlas_reserved_revision_conflict");
  assert.equal(run.masterCalls.length,1,"existing saved artwork cannot be reassigned to a different ID");
});

test("a crash after public panel events resumes the same accepted master and revision without another authoring call",async t=>{
  finishFlag(t,"off");
  const {source,manifest}=await fixture();
  const run=harness(source);run.insertFailure=true;
  await assert.rejects(run.run(),error=>error.code==="flat_atlas_revision_insert_failed");
  assert.equal(run.publicMasters.length,1);
  assert.equal(run.publicPanels.length,6);
  assert.equal(run.masterCalls.length,1);
  const before=run.publicMasters[0];
  run.insertFailure=false;
  const result=await run.run({claimToken:"55555555-5555-4555-8555-555555555555"});
  assert.equal(run.fenceCalls,1,"accepted recovery never reclaims the spent master fence");
  assert.equal(run.masterCalls.length,1,"no second creative request after a database interruption");
  assert.equal(result.revisionId,before.revisionId);
  assert.equal(result.master.contentHash,before.hash);
  assert.equal(result.metadata.recoveredFromAcceptedCheckpoint,true);
  assert.equal(result.metadata.geminiImageRequestCount,1);
  const expected=await atlas.cutCallOnePanels(result.master.bytes,manifest,result.master.contentHash);
  for (const panel of expected) {
    const actual=result.callOnePanels.find(item=>item.surfaceKey===panel.surfaceKey);
    assert.equal(actual.contentHash,panel.contentHash);
    assert.equal(actual.sourceMasterHash,result.master.contentHash);
    assert.equal(actual.surfaceSourceHash,result.master.contentHash);
  }
});

test("changed request geometry or corrupted accepted bytes cannot be mistaken for a cache miss",async t=>{
  finishFlag(t,"off");
  const {source}=await fixture();const run=harness(source);run.insertFailure=true;
  await assert.rejects(run.run(),error=>error.code==="flat_atlas_revision_insert_failed");
  await assert.rejects(run.run({input:{...input,companyName:"Different revision"}}),error=>error.code==="flat_atlas_context_invalid");
  const accepted=JSON.parse(run.bytes.get([...run.bytes.keys()].find(path=>path.endsWith("/accepted.json")))).record;
  run.corruptReads=accepted.master.storagePath;
  await assert.rejects(run.run(),error=>error.code==="flat_atlas_checkpoint_artifact_mismatch");
  run.corruptReads=null;
  const checkpointPath=[...run.bytes.keys()].find(path=>path.endsWith("/accepted.json"));
  const envelope=JSON.parse(run.bytes.get(checkpointPath));
  delete envelope.record.state.masterDeterministic.blockingFailures;
  envelope.recordHash=sha256(atlas._test.canonicalBytes(envelope.record));
  run.bytes.set(checkpointPath,Buffer.from(JSON.stringify(envelope)));
  await assert.rejects(run.run(),error=>error.code==="flat_atlas_checkpoint_acceptance_invalid");
  assert.equal(run.masterCalls.length,1);
  assert.equal(run.publicMasters.length,1,"invalid recovery cannot publish another master");
});

test("a saved-history edit publishes six new panels and seven child authorities, then recovers without overwriting its parent",async t=>{
  finishFlag(t,"off");
  const {source}=await fixture();
  const parentRun=harness(source);
  const parent=await parentRun.run();
  const parentInventory=new Map([...parentRun.bytes].map(([path,bytes])=>[path,sha256(bytes)]));
  const edited=await sharp(source).linear(0.9,12).png().toBuffer();
  const child=harness(edited);
  for(const [path,bytes] of parentRun.bytes)child.bytes.set(path,Buffer.from(bytes));
  const revisionContext={
    contractVersion:"designpro.atlas-revision-intake.v1",
    parentAtlasRevisionId:parent.revisionId,
    parentRequestId:identities.requestId,
    parentRevisionSequence:parent.revisionSequence,
    parentMaster:{storagePath:parent.master.storagePath,contentHash:parent.master.contentHash,byteSize:parent.master.byteSize},
    parentManifest:{...parent.manifestAsset},
    affectedSurfaces:["driver"],
    instruction:"Apply the approved color revision and retain the existing placement.",
    history:{mode:"image-reference"},
  };
  const options={
    requestId:"88888888-8888-4888-8888-888888888888",
    revisionSequence:3, parentAtlasRevisionId:parent.revisionId,
    revisionContext, revisionContextHash:sha256(atlas._test.canonicalBytes(revisionContext)),
    parentManifest:parent.manifest,
  };
  child.insertFailure=true;
  await assert.rejects(child.run(options),error=>error.code==="flat_atlas_revision_insert_failed");
  const firstChildIdentity=child.publicMasters[0];
  assert.equal(child.masterCalls.length,1);
  assert.equal(child.masterCalls[0].revisionContextHash,options.revisionContextHash);
  assert.equal(child.masterCalls[0].fieldContract,undefined);
  assert.equal(child.publicPanels.length,6);
  child.insertFailure=false;
  const result=await child.run({...options,claimToken:"99999999-9999-4999-8999-999999999999"});
  assert.equal(result.revisionId,firstChildIdentity.revisionId);
  assert.notEqual(result.revisionId,parent.revisionId);
  assert.equal(result.revisionSequence,3);
  assert.equal(result.parentRevisionId,parent.revisionId);
  assert.equal(result.metadata.revisionContextHash,options.revisionContextHash);
  assert.equal(result.metadata.revisionHistoryMode,"image-reference");
  assert.equal(child.inserted.generation_id,identities.generationId,"the existing generation and history identity stay in use");
  assert.equal(child.inserted.instruction,revisionContext.instruction);
  assert.deepEqual(child.inserted.affected_surfaces,["driver"]);
  assert.equal(result.manifestAsset.contentHash,parent.manifestAsset.contentHash,"an edit retains its exact GENIE dimensions");
  assert.match(result.master.storagePath,/\/revisions\/3\/master\//);
  assert.equal(child.masterCalls.length,1,"a storage/database recovery cannot regenerate the edited master");
  assert.notEqual(result.master.contentHash,parent.master.contentHash);
  assert.equal(result.callOnePanels.length,6,"even a one-surface edit rebuilds the complete coherent panel set");
  for(const panel of result.callOnePanels){
    assert.match(panel.storagePath,/\/revisions\/3\/panels\//);
    assert.equal(panel.sourceMasterHash,result.master.contentHash);
    assert.equal(panel.surfaceSourceHash,result.master.contentHash);
  }
  assert.equal(Object.keys(result.viewAuthorities).length,7);
  for(const authority of Object.values(result.viewAuthorities))assert.equal(authority.sourceMasterHash,result.master.contentHash);
  for(const [path,digest] of parentInventory)assert.equal(sha256(child.bytes.get(path)),digest,`saved parent artifact ${path} remains immutable`);
  await assert.rejects(child.run({...options,revisionSequence:4}),error=>error.code==="flat_atlas_context_invalid");
  assert.equal(child.masterCalls.length,1);
});

test("a spent master fence is a read-only provider-cache recovery request",async t=>{
  finishFlag(t,"off");const {source}=await fixture();const run=harness(source);run.forceCacheOnly=true;
  const result=await run.run();
  assert.equal(run.masterCalls.length,1);
  assert.equal(run.masterCalls[0].providerRequest.cacheOnly,true);
  assert.equal(run.masterCalls[0].providerRequest.attemptKey,"master:1");
  assert.equal(result.callOnePanels.length,6);
});

test("concurrent acceptance of the same candidate resumes the immutable winner's revision",async t=>{
  finishFlag(t,"off");const {source}=await fixture();const run=harness(source);
  const winnerRevisionId="77777777-7777-4777-8777-777777777777";
  run.checkpointRace={revisionId:winnerRevisionId};
  await assert.rejects(run.run(),error=>error.code==="flat_atlas_checkpoint_publication_race"&&error.retryable===true);
  assert.equal(run.publicMasters.length,0,"the losing writer cannot publish its private revision identity");
  const result=await run.run({claimToken:"55555555-5555-4555-8555-555555555555"});
  assert.equal(result.revisionId,winnerRevisionId);
  assert.equal(result.metadata.recoveredFromAcceptedCheckpoint,true);
  assert.equal(run.masterCalls.length,1,"resolving a publication race never spends another provider call");
  assert.equal(run.publicPanels.length,6);
});

test("checkpoint input conflicts never receive publication-race retry permission",async t=>{
  finishFlag(t,"off");const {source}=await fixture();const run=harness(source);
  run.checkpointRace={revisionId:"77777777-7777-4777-8777-777777777777",inputHash:"b".repeat(64)};
  await assert.rejects(run.run(),error=>error.code==="flat_atlas_checkpoint_identity_mismatch"&&error.retryable===false);
  assert.equal(run.publicMasters.length,0);
  assert.equal(run.masterCalls.length,1);
});

test("optional finishing checkpoints restore exact signed exchanges and publish only the assembled master",async t=>{
  finishFlag(t,"on");const {source,manifest}=await fixture();const run=harness(source);
  run.finishFailure="hood";
  await assert.rejects(run.run(),error=>error.code==="provider_outcome_unknown");
  assert.deepEqual(run.finishCalls.map(body=>body.surfaceKey),["driver","passenger","hood"]);
  assert.equal(run.publicMasters.length,0,"private staged edits cannot publish the old master");
  assert.equal(run.publicPanels.length,0);
  const firstHood=run.finishCalls[2];
  assert.equal(firstHood.priorTurns[1].parts[1].thoughtSignature,"opaque-driver");
  assert.equal(firstHood.priorTurns[3].parts[1].thoughtSignature,"opaque-passenger");
  run.finishFailure=null;
  const result=await run.run({claimToken:"55555555-5555-4555-8555-555555555555"});
  assert.equal(run.masterCalls.length,1,"the original source image is recovered from the authored checkpoint");
  assert.deepEqual(run.finishCalls.map(body=>body.surfaceKey),["driver","passenger","hood","hood","roof","front","rear"]);
  assert.deepEqual(run.finishCalls[3].priorTurns,firstHood.priorTurns,"original text, images and opaque signatures survive restart unchanged");
  assert.equal(run.finishCalls[3].providerRequest.attemptKey,"panel:hood:1");
  assert.equal(run.finishCalls[3].providerRequest.claimToken,"55555555-5555-4555-8555-555555555555");
  assert.equal(run.publicMasters.length,1);
  assert.equal(result.master.contentHash,run.publicMasters[0].hash);
  assert.notEqual(result.master.contentHash,sha256(source));
  assert.equal(result.metadata.masterFinishing.sourceMasterHash,
    JSON.parse(run.bytes.get([...run.bytes.keys()].find(path=>path.endsWith("/authored.json")))).record.master.contentHash);
  assert.equal(result.metadata.masterFinishing.imageRequestCount,6);
  const expected=await atlas.cutCallOnePanels(result.master.bytes,manifest,result.master.contentHash);
  for(const panel of expected){
    const saved=result.callOnePanels.find(item=>item.surfaceKey===panel.surfaceKey);
    assert.equal(saved.contentHash,panel.contentHash,`${panel.surfaceKey} must be an exact crop of the displayed assembled master`);
    assert.equal(saved.deterministic,true);
    assert.equal(saved.sourceMasterHash,result.master.contentHash);
    assert.equal(saved.surfaceSourceHash,result.master.contentHash);
  }
  for(const release of run.publicPanels)assert.equal(release.sourceMasterHash,result.master.contentHash);
  assert.equal(Object.keys(result.viewAuthorities).length,7);
  for(const authority of Object.values(result.viewAuthorities))assert.equal(authority.sourceMasterHash,result.master.contentHash);
  const reused=await run.run({claimToken:"66666666-6666-4666-8666-666666666666"});
  assert.equal(reused.reused,true);
  assert.equal(reused.master.contentHash,result.master.contentHash);
  assert.deepEqual(reused.callOnePanels.map(panel=>panel.contentHash),result.callOnePanels.map(panel=>panel.contentHash));
  assert.equal(run.masterCalls.length,1);
  assert.equal(run.finishCalls.length,7,"a completed revision never reruns its six finishing requests");
});

test("white replacement sheets cannot pass finishing just because their hole ratio improved",async t=>{
  finishFlag(t,"on");const {source}=await fixture();const run=harness(source);run.whiteFinish=true;
  await assert.rejects(run.run(),error=>error.code==="flat_atlas_finished_master_invalid"&&/lumaStddev/.test(error.message));
  assert.equal(run.publicMasters.length,0);
  assert.equal(run.publicPanels.length,0);
  assert.equal(run.inserted,null);
  assert.equal([...run.bytes.keys()].some(path=>path.endsWith("/accepted.json")),false);
});

test("same-zone assembly preserves native orientation and refuses missing or wrong-sized surfaces",async()=>{
  const {source,manifest}=await fixture();
  const panels=await atlas.cutCallOnePanels(source,manifest,sha256(source));
  const records=panels.map(panel=>({...panel,finish:{applied:false}}));
  assert.equal((await assembleFinishedMaster(source,manifest,records)).bytes,source,"no edits means no re-encode");
  await assert.rejects(assembleFinishedMaster(source,manifest,records.slice(1)),error=>error.code==="flat_atlas_finished_surface_set_invalid");
  const driver=panels.find(panel=>panel.surfaceKey==="driver");
  const output=await sharp(driver.bytes).linear(0.8,20).png().toBuffer();
  const edited=records.map(record=>record.surfaceKey==="driver"?{...record,finish:{applied:true,bytes:output,contentHash:sha256(output)}}:record);
  const assembled=await assembleFinishedMaster(source,manifest,edited);
  const cut=await atlas.cutCallOnePanels(assembled.bytes,manifest,assembled.contentHash);
  const driverCut=cut.find(panel=>panel.surfaceKey==="driver");
  assert.deepEqual(await sharp(driverCut.bytes).raw().toBuffer(),await sharp(output).raw().toBuffer());
  for(const untouched of panels.filter(panel=>panel.surfaceKey!=="driver")){
    assert.deepEqual(await sharp(cut.find(panel=>panel.surfaceKey===untouched.surfaceKey).bytes).raw().toBuffer(),
      await sharp(untouched.bytes).raw().toBuffer());
  }
  const small=await sharp(output).resize(10,10).png().toBuffer();
  await assert.rejects(assembleFinishedMaster(source,manifest,edited.map(record=>record.surfaceKey==="driver"
    ?{...record,finish:{applied:true,bytes:small,contentHash:sha256(small)}}:record)),error=>error.code==="flat_atlas_finished_panel_dimensions_mismatch");
  const transparent=await sharp(output).ensureAlpha(0.5).png().toBuffer();
  await assert.rejects(assembleFinishedMaster(source,manifest,edited.map(record=>record.surfaceKey==="driver"
    ?{...record,finish:{applied:true,bytes:transparent,contentHash:sha256(transparent)}}:record)),error=>error.code==="flat_atlas_finished_panel_coverage_invalid");
});

test("cache capability refusal prevents a POST to an older edge that might ignore cacheOnly",async t=>{
  const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL="https://example.invalid";process.env.SUPABASE_SERVICE_ROLE_KEY="fixture-not-secret-".repeat(4);
  t.after(()=>{oldUrl===undefined?delete process.env.SUPABASE_URL:process.env.SUPABASE_URL=oldUrl;
    oldKey===undefined?delete process.env.SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;});
  const methods=[];
  await assert.rejects(atlas._test.callAtlasArtboardEdge({providerRequest:{...identities,attemptKey:"master:1",cacheOnly:true}},
    {supabase:{storage:{from(){return {};}}},fetchImpl:async (_url,options)=>{methods.push(options.method);
      return {ok:false,status:400,json:async()=>({error:"legacy GET parsing refused"})};}}),
    error=>error.code==="flat_atlas_provider_cache_not_deployed");
  assert.deepEqual(methods,["GET"],"a capability miss must never make an image-producing POST");
});

test("an interrupted finishing response never becomes a second image request",async t=>{
  const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL="https://example.invalid";process.env.SUPABASE_SERVICE_ROLE_KEY="fixture-not-secret-".repeat(4);
  t.after(()=>{oldUrl===undefined?delete process.env.SUPABASE_URL:process.env.SUPABASE_URL=oldUrl;
    oldKey===undefined?delete process.env.SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;});
  const {source,manifest}=await fixture();
  const [panel]=await atlas.cutCallOnePanels(source,manifest,sha256(source));
  for(const interrupted of ["request","response"]){
    const methods=[];
    const requests=[];
    await assert.rejects(finishPanel(panel,{
      store:{async putImmutableBytes(){}},
      callEdge:body=>atlas._test.callAtlasPanelEdge({...body,providerRequest:{...identities,attemptKey:"panel:driver:1"}},{
        ownerId:identities.ownerId,wait:async()=>{},fetchImpl:async(_url,options)=>{
          methods.push(options.method);
          if(options.method==="GET")return {ok:true,json:async()=>({providerCacheContract:"designpro.gemini-provider-cache.v1",modes:["atlas-panel"],cacheOnly:true})};
          requests.push(JSON.parse(options.body));
          if(interrupted==="request")throw new TypeError("fetch failed after request transmission");
          return {ok:true,status:200,json:async()=>{throw new SyntaxError("interrupted response JSON");}};
        },
      }),
    }),error=>error.code==="provider_outcome_unknown"&&error.retryable===false);
    assert.deepEqual(methods,["GET","POST","POST","POST","POST"],`${interrupted} interruption must recover the same cached attempt`);
    assert.equal(requests.filter(request=>request.providerRequest.cacheOnly!==true).length,1);
    for(const recovery of requests.slice(1))assert.deepEqual(recovery,{...requests[0],providerRequest:{...requests[0].providerRequest,cacheOnly:true}});
  }
});

test("recoverable artifact reads and explicit provider rejections retain the original finishing attempt",async()=>{
  const {source,manifest}=await fixture();
  const [panel]=await atlas.cutCallOnePanels(source,manifest,sha256(source));
  const failures=[
    Object.assign(new Error("storage read unavailable"),{code:"flat_atlas_artifact_download_failed",retryable:true}),
    Object.assign(new Error("received bytes failed identity"),{code:"flat_atlas_artifact_identity_mismatch",retryable:false}),
    Object.assign(new Error("operator must review provider rejection"),{providerRetryDisposition:"operator_required",retryable:false}),
  ];
  for(const failure of failures){
    let calls=0;
    await assert.rejects(finishPanel(panel,{store:{async putImmutableBytes(){}},callEdge:async()=>{calls++;throw failure;}}),error=>error===failure);
    assert.equal(calls,1,"a typed technical failure cannot authorize the second finishing candidate");
  }
});
