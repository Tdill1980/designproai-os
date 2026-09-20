import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../scripts/vehiclepro-live-prompt-test.mjs',import.meta.url),'utf8')
 .replace(/^#!.*\n/,'').replace(/^import .*;\n/gm,'').replaceAll('import.meta.url','"file:///runner.mjs"');
const sha='a'.repeat(40),brief='  Copper Finch bakery: terracotta botanical linework.  ';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function run({mismatch=false,failed=false,missingView=false}={}){
 const files=new Map(),images=new Map();let creates=0,submissions=0;
 const roles=['driver','passenger','hood','roof','front','rear','closeup'].slice(0,missingView?6:7);
 const image=role=>{const b=Buffer.from(`image-${role}`),h=hash(b),path=`proofs/${h}.png`;images.set(path,b);return {storagePath:path,contentHash:h}};
 const sheet=image('call1');
 const views=roles.map(role=>{const i=image(role);return {consumer_role:role,source_view_type:role,storage_path:i.storagePath,content_hash:i.contentHash,byte_size:images.get(i.storagePath).length,content_type:'image/png'}});
 const client={auth:{admin:{createUser:async()=>{creates++;return {data:{user:{id:'owner'}}}}},signInWithPassword:async()=>({data:{session:{access_token:'fixture-session'}}})},
  storage:{from:()=>({upload:async()=>({error:null}),createSignedUrl:async(path,expires)=>{assert.equal(expires,60);assert.ok(images.has(path));return {data:{signedUrl:`https://signed.fixture/${path}`}}}})},
  from:()=>({select:()=>({eq:()=>({single:async()=>({data:{request_input:{brief},engine_receipt:{atlasRevisionId:'revision'},error:failed?{code:'provider_refused'}:null}}),is:()=>({order:async()=>({data:views})})})})}),
  rpc:async name=>({data:name==='get_designpro_generation_request'?{state:failed?'failed':'outputs_ready',failureCode:failed?'provider_refused':null}
    :name==='designpro_atlas_panel_proof_paths'?{panelProof:true,sheet}: {originalPrompt:brief,versions:[{version:1}]}})};
 const sharp=()=>({png:()=>({toBuffer:async()=>Buffer.from('fixture-logo')})});
 const fetch=async(url,init={})=>{
  if(url.startsWith('https://signed.fixture/'))return new Response(images.get(url.slice('https://signed.fixture/'.length)));
  if(init.method==='OPTIONS')return new Response('',{headers:{'x-designpro-source-sha':sha}});
  if(url.endsWith('/release.json'))return Response.json({sourceSha:mismatch?'b'.repeat(40):sha});
  if(url.endsWith('/gateway-healthz'))return Response.json({sourceSha:sha});
  if(url.endsWith('/health'))return Response.json({commit:sha,ready:true});
  assert.ok(url.endsWith('/api/generation/requests'));
  submissions++;assert.equal(init.headers.Authorization,'Bearer fixture-session');
  const body=JSON.parse(init.body);assert.equal(body.input.brief,brief);assert.equal(body.requiredPipelineMode,'flat-first-atlas-v1');assert.equal(body.input.phone,undefined);assert.equal(body.input.website,undefined);
  return Response.json({requestId:'request'});
 };
 const process={argv:['node','runner','--source-sha',sha,'--company','Copper Finch','--brief',brief,'--out','/evidence'],env:{SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'},stdout:{write:()=>{}}};
 let error;
 try{await runInNewContext(`(async()=>{${source}})()`,{createRequire:()=>name=>name.includes('sharp')?sharp:{createClient:()=>client},createHash,randomBytes,randomUUID,Buffer,URL,AbortSignal,fetch,process,
  existsSync:()=>false,mkdirSync:()=>{},writeFileSync:(path,bytes)=>files.set(path,bytes),setTimeout:()=>{throw new Error('unexpected polling/retry')}})}catch(e){error=e;}
 return {creates,submissions,files,error,evidence:JSON.parse(files.get('/evidence/evidence.json'))};
}
test('mixed source versions stop before creating an account or spending a generation',async()=>{
 const r=await run({mismatch:true});assert.match(r.error.message,/mixed or unready/);assert.equal(r.creates,0);assert.equal(r.submissions,0);
});
test('one authenticated gateway request saves exact prompt, identities and eight hashed images without claiming visual acceptance',async()=>{
 const r=await run();assert.ifError(r.error);assert.equal(r.creates,1);assert.equal(r.submissions,1);assert.equal(r.evidence.artifacts.length,8);
 assert.equal(r.evidence.technicalComplete,true);assert.equal(r.evidence.promptRecord.originalPrompt,brief);assert.equal(r.evidence.sourceSha,sha);
 assert.equal(r.evidence.visualReview.call1,'NOT_REVIEWED');assert.equal(r.evidence.visualReview.call2,'NOT_REVIEWED');assert.equal(r.evidence.auth.browserSession,'UNVERIFIED');
 for(const a of r.evidence.artifacts)assert.equal(hash(r.files.get(`/evidence/${a.file}`)),a.contentHash);
});
test('provider refusal retains partial proof evidence and never submits a replacement generation',async()=>{
 const r=await run({failed:true});assert.match(r.error.message,/provider_refused/);assert.equal(r.submissions,1);assert.equal(r.evidence.refusal.code,'provider_refused');assert.ok(r.evidence.artifacts.length>0);assert.notEqual(r.evidence.technicalComplete,true);
});
test('outputs_ready with only six proofs remains a failed technical test',async()=>{
 const r=await run({missingView:true});assert.match(r.error.message,/complete seven-proof set/);assert.equal(r.submissions,1);assert.notEqual(r.evidence.technicalComplete,true);
});
