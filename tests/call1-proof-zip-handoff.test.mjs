import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {createDeterministicZip64Stream}=require('../runtime/output-qc.cjs');
const {safeStoragePath}=require('../runtime/runtime-contract.cjs');
const worker=require('../runtime/designpro-standalone-claimant.cjs')._test;
const code=readFileSync(new URL('../runtime/designpro-standalone-claimant.cjs',import.meta.url),'utf8');
// Execute the actual ZIP stage with real entry/stream/hash code. The approved
// upstream gates and external resumable upload are supplied as fixture seams.
const start=code.indexOf('  if (stage.stage_key === "zip.build") {');
const branch=code.slice(start,code.indexOf('  if (stage.stage_key === "wrapbox.deliver") {',start));
const helpers=code.slice(code.indexOf('function requiredString('),code.indexOf('function identity('))
  +code.slice(code.indexOf('async function storageStream('),code.indexOf('function panelProfileZipEntries('))
  +code.slice(code.indexOf('function zipArtifactEntries('),code.indexOf('function bufferZipEntry('));
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hashJson=value=>hash(JSON.stringify(canonical(value)));
const OWNER='11111111-1111-4111-8111-111111111111',RUN='22222222-2222-4222-8222-222222222222',REV='33333333-3333-4333-8333-333333333333',GRAPH='44444444-4444-4444-8444-444444444444';
const surfaces=['driver','passenger','hood','roof','front','rear'];
class StageError extends Error{constructor(code,message,retryable=true){super(message);this.code=code;this.retryable=retryable;}}
function fixture({cutGraphics}={}){
  const stored=new Map(),rows=[],downloads=[];
  const put=(path,bytes)=>{stored.set(path,bytes);return{storagePath:path,contentHash:hash(bytes),byteSize:bytes.length};};
  // The complete output set the purchase manifest requires: six surfaces times
  // PNG, TIFF, EPS, PDF and JPG, times the branded and the clean variant (60
  // under contract v4) -- read off the manifest rather than hand-counted.
  const outputCount=worker.authorizedAssetManifest(['print_pack_entitlement']).requiredOutputFiles;
  assert.equal(outputCount,60);
  for(const [kind,count]of [['flat-proof',1],['panel',6],['qc-panel',6],['output',outputCount],['stamp',10]])
    for(let i=0;i<count;i++){
      const ref=put(`designpro/user_${OWNER}/${RUN}/${kind}/file-${i}.png`,Buffer.from(`${kind}:${i}`));
      rows.push({artifact_kind:kind,surface_key:String(i),storage_path:ref.storagePath,content_hash:ref.contentHash,byte_size:ref.byteSize});
    }
  const views=[...surfaces,'closeup'].map(viewKey=>({...put(`designpro/user_${OWNER}/${RUN}/views/${viewKey}.png`,Buffer.from(`exact approved view ${viewKey}`)),viewKey,contentType:'image/png'}));
  const proofBytes=Buffer.from('complete composed three-zone sheet'),masterBytes=Buffer.from('exact frozen Atlas master');
  const proof=put(`atlas-panel-proof/${hash(proofBytes)}.png`,proofBytes);
  const master=put(`atlas-call1-graph/${GRAPH}/panel-proof-master-${hash(masterBytes)}.png`,masterBytes);
  const snapshot={sourceMasterContentHash:master.contentHash,panelProofAuthoring:{contract:'designpro.atlas-panel-proof-topology.v2',composition:{contract:'designpro.production-zone-composite.v1',sourceAssetsPreserved:true},
    quadrants:{branded:surfaces.map(surfaceKey=>({surfaceKey})),clean:surfaces.map(surfaceKey=>({surfaceKey})),cutGraphics:cutGraphics??[{surfaceKey:'logo'}]},graph:{runId:GRAPH},
    proofStoragePath:proof.storagePath,proofSha256:proof.contentHash,proofByteSize:proof.byteSize,masterStoragePath:master.storagePath,masterSha256:master.contentHash}};
  const source={owner_id:OWNER,tenant_key:`user_${OWNER}`,snapshot_hash:'a'.repeat(64),snapshot};
  const run={id:RUN,owner_id:OWNER,tenant_key:source.tenant_key,revision_id:REV,revision_snapshot_hash:source.snapshot_hash,manifest_hash:'c'.repeat(64)};
  const proofJoin={sourceViews:views,sourceViewSetHash:hashJson(views),call8ProofHash:rows[0].content_hash};
  const sb={from(table){assert.equal(table,'designpro_revision_sources');return{select(){return this;},eq(key,value){assert.equal(key,'revision_id');assert.equal(value,REV);return this;},async maybeSingle(){return{data:source};}};},storage:{from(bucket){assert.equal(bucket,'wrap-files');return{async download(path){downloads.push(path);return stored.has(path)?{data:new Blob([stored.get(path)])}:{error:{message:'missing'}};}};}}};
  let zipped,completed;
  const context={Buffer,Uint8Array,createHash,StageError,safeStoragePath,BUCKET:'wrap-files',HASH_RE:/^[a-f0-9]{64}$/,UUID_RE:/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    hashBytes:hash,hashJson,canonical,assertStageLeaseActive(){},SURFACE_KEYS:surfaces,
    async receipt(){return{receipt:{designId:'DID-FIXTURE',orderNumber:'FIXTURE-1',proofJoin,sourceProofHash:proofJoin.call8ProofHash,panelProfileAttachments:[]}};},
    async readAuthorizedAssets(){return worker.authorizedAssetManifest(['print_pack_entitlement']);},async artifacts(){return rows;},
    async approvedProductionProofJoin(){return proofJoin;},async approvedProductionAttachments(){return[];},assertStampedViewSet(){return views;},
    sourceViewZipEntries:worker.sourceViewZipEntries,panelProfileZipEntries:worker.panelProfileZipEntries,attachmentArchiveFiles(){return[];},
    productionDimensionManifest(){return{surfaces};},bufferZipEntry:worker.bufferZipEntry,stageLeaseContext:{getStore(){}},tenantKey:worker.tenantKey,
    createDeterministicZip64Stream,async withHeavyOutputLease(sb,stage,work){return work();},
    async spoolDeterministicZip64({createStream}){const chunks=[];for await(const chunk of createStream())chunks.push(chunk);zipped=Buffer.concat(chunks);return{};},
    async uploadSpoolWithTus({storagePath}){return{storagePath,contentHash:hash(zipped),byteSize:zipped.length};},
    artifact(kind,storagePath,contentHash,byteSize,surfaceKey,metadata){return{kind,storagePath,contentHash,byteSize,surfaceKey,metadata};},
    async complete(sb,stage,run,receipt,hash,artifacts){completed={receipt,hash,artifacts};return completed;},async removeCommittedSpool(){},console};
  const execute=vm.runInNewContext(`${helpers}\n(async function(sb,stage,run,runtimeConfig){ const input={};${branch}})`,context);
  return{source,stored,downloads,proof,master,views,run,put,execute:()=>execute(sb,{stage_key:'zip.build'},run,{}),result:()=>({zipped,completed})};
}
// A persisted Zone 3 asset exactly as the compositor freezes it: the customer's
// uploaded logo under its upload revision, or a content-addressed element.
function cutGraphic(f,{assetRole,bytes,contentType,path}){
  const contentHash=hash(bytes);const ext={'image/png':'png','image/svg+xml':'svg','image/jpeg':'jpg'}[contentType];
  const storagePath=path??(assetRole==='logo'?`users/${OWNER}/revisions/${REV}/inputs/logo/${contentHash}.${ext}`:`atlas-elements/${contentHash}.${ext}`);
  f.put(storagePath,bytes);
  return{role:'cut-graphic',assetRole,surfaceKey:assetRole,persisted:true,vector:contentType==='image/svg+xml',storagePath,contentHash,byteSize:bytes.length,contentType,productionApproved:false};
}
function unzip(bytes){let offset=0;const files=new Map();while(bytes.readUInt32LE(offset)===0x04034b50){const n=bytes.readUInt16LE(offset+26),e=bytes.readUInt16LE(offset+28),name=bytes.toString('utf8',offset+30,offset+30+n),extra=offset+30+n;assert.equal(bytes.readUInt16LE(extra),1);const length=Number(bytes.readBigUInt64LE(extra+4)),start=extra+e;files.set(name,bytes.subarray(start,start+length));offset=start+length+24;}assert.equal(bytes.readUInt32LE(offset),0x02014b50);return files;}

test('paid ZIP archives exact complete Call1 proof and Atlas with all seven unchanged vehicle proofs, and lists every byte hash',async()=>{
  const f=fixture();await f.execute();const{zipped,completed}=f.result(),files=unzip(zipped),receipt=completed.receipt;
  // Customer-readable file names carry the product's own name, never the engine's (owner, 2026-09-22).
  assert.deepEqual(files.get('proofs/trizone-production-panel-proof.png'),f.stored.get(f.proof.storagePath));
  // THE ASSEMBLED SHEET IS NOT IN THE PACK (owner, 2026-09-22: "still generating a now retired atlas design — this needs to go").
  // This lock used to require `proofs/print-master.png`; the TriZone(TM) sheet is the customer's source and the only sheet shipped.
  assert.equal(files.has('proofs/print-master.png'),false,'the retired assembled sheet is never packaged');
  assert.equal([...files.keys()].some(name=>/master/i.test(name)),false,'no master sheet inside the ZIP');
  assert.equal([...files.keys()].some(name=>/atlas/i.test(name)),false,'no file inside the ZIP is named after the engine');
  assert.equal([...files.keys()].filter(name=>name.startsWith('source-views/')).length,7);
  assert.equal(receipt.includedKinds['production-panel-proof'],1);assert.equal(receipt.includedKinds['atlas-master'],undefined);assert.equal(receipt.sourceProofs.length,1);
  assert.equal(receipt.archiveManifest.length,files.size);assert.equal(completed.artifacts[0].metadata.archiveManifest.length,files.size);
  for(const file of receipt.archiveManifest){assert.equal(hash(files.get(file.archivePath)),file.contentHash);assert.equal(files.get(file.archivePath).length,file.byteSize);}
  const again=fixture();await again.execute();assert.deepEqual(again.result().zipped,zipped,'same immutable inputs produce the same ZIP');
});

test('changed proof or master bytes, source binding, missing zones and graph-path drift fail before ZIP publication',async()=>{
  for(const change of [f=>f.stored.set(f.proof.storagePath,Buffer.from('changed sheet')),f=>f.source.snapshot.panelProofAuthoring.masterSha256='c'.repeat(64),f=>f.source.snapshot_hash='b'.repeat(64),f=>f.source.owner_id=RUN,f=>f.source.snapshot.panelProofAuthoring.quadrants.clean.pop(),f=>f.source.snapshot.panelProofAuthoring.masterStoragePath='provider-cache/foreign.png',f=>f.source.snapshot.panelProofAuthoring=null]){
    const f=fixture();change(f);await assert.rejects(f.execute(),error=>/^zip_(call1_proof_(changed|incomplete)|revision_source_changed)$/.test(error.code)&&error.retryable===false);assert.equal(f.result().completed,undefined);
  }
});

test('an honest empty Zone 3 packages the proof and master with no cut graphics and no refusal (#599 degrade)',async()=>{
  const f=fixture({cutGraphics:[]});await f.execute();const{zipped,completed}=f.result(),files=unzip(zipped),receipt=completed.receipt;
  assert.deepEqual(files.get('proofs/trizone-production-panel-proof.png'),f.stored.get(f.proof.storagePath));
  assert.equal([...files.keys()].some(name=>name.startsWith('proofs/cut-graphics/')),false);
  assert.equal(receipt.includedKinds['cut-graphic'],0);assert.equal(receipt.includedKinds['production-panel-proof'],1);
  assert.equal(receipt.archiveManifest.length,files.size);
  // The array must still exist: a proof that cannot say what Zone 3 held is incomplete.
  const g=fixture();delete g.source.snapshot.panelProofAuthoring.quadrants.cutGraphics;
  await assert.rejects(g.execute(),error=>error.code==='zip_call1_proof_incomplete'&&error.retryable===false);
});

test('persisted Zone 3 cut graphics ship in the ZIP as their exact frozen bytes, and a forged identity is refused',async()=>{
  const f=fixture();
  const logo=cutGraphic(f,{assetRole:'logo',bytes:Buffer.from('exact uploaded logo png'),contentType:'image/png'});
  const type=cutGraphic(f,{assetRole:'typography',bytes:Buffer.from('<svg>company name</svg>'),contentType:'image/svg+xml'});
  const unpersisted={role:'cut-graphic',assetRole:'contact',surfaceKey:'contact',persisted:false};
  f.source.snapshot.panelProofAuthoring.quadrants.cutGraphics=[logo,type,unpersisted];
  await f.execute();const{zipped,completed}=f.result(),files=unzip(zipped),receipt=completed.receipt;
  assert.deepEqual(files.get(`proofs/cut-graphics/logo-${logo.contentHash.slice(0,12)}.png`),f.stored.get(logo.storagePath));
  assert.deepEqual(files.get(`proofs/cut-graphics/typography-${type.contentHash.slice(0,12)}.svg`),f.stored.get(type.storagePath));
  assert.equal([...files.keys()].filter(name=>name.startsWith('proofs/cut-graphics/')).length,2,'an unpersisted entry has no bytes to package');
  assert.equal(receipt.includedKinds['cut-graphic'],2);
  // The sheet plus the two persisted cut graphics. This used to be 4: the
  // assembled print master rode along as a fourth source proof until the owner
  // retired it from every human surface (2026-09-22, "Production panel proof is
  // source"); it is internal lineage identity now and ships in no ZIP.
  assert.equal(receipt.sourceProofs.length,3);
  const listed=receipt.archiveManifest.filter(file=>file.kind==='cut-graphic');
  // The receipt is built inside the vm realm, so compare values, not prototypes.
  assert.equal(JSON.stringify(listed.map(file=>[file.surfaceKey,file.contentHash])),JSON.stringify([['logo',logo.contentHash],['typography',type.contentHash]]));
  assert.equal(receipt.archiveManifest.length,files.size);
  for(const change of [
    g=>{g.source.snapshot.panelProofAuthoring.quadrants.cutGraphics=[{...logo,contentHash:'0'.repeat(64)}];},
    g=>{g.source.snapshot.panelProofAuthoring.quadrants.cutGraphics=[{...logo,storagePath:`provider-cache/${logo.contentHash}.png`}];},
    g=>{g.source.snapshot.panelProofAuthoring.quadrants.cutGraphics=[{...logo,contentType:'image/svg+xml'}];},
  ]){const g=fixture();cutGraphic(g,{assetRole:'logo',bytes:Buffer.from('exact uploaded logo png'),contentType:'image/png'});change(g);
    await assert.rejects(g.execute(),error=>error.code==='zip_cut_graphic_identity_invalid'&&error.retryable===false);}
  const changed=fixture();const c=cutGraphic(changed,{assetRole:'logo',bytes:Buffer.from('exact uploaded logo png'),contentType:'image/png'});
  changed.source.snapshot.panelProofAuthoring.quadrants.cutGraphics=[c];changed.stored.set(c.storagePath,Buffer.from('swapped logo bytes'));
  await assert.rejects(changed.execute(),error=>error.code==='zip_call1_proof_changed'&&error.retryable===false);
});

test('legacy source without a three-zone receipt keeps its original archive contract and never invents a proof',async()=>{
  const f=fixture();delete f.source.snapshot.panelProofAuthoring;await f.execute();const{completed,zipped}=f.result();
  assert.equal(completed.receipt.sourceProofs.length,0);assert.equal(completed.receipt.includedKinds['production-panel-proof'],undefined);
  assert.equal(unzip(zipped).has('proofs/trizone-production-panel-proof.png'),false);assert.equal(completed.receipt.sourceViews.length,7);
});
