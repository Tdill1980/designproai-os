import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createGateway } from '../gateway/src/server.mjs';
const require = createRequire(new URL('../runtime/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const { canonicalUuid } = require('./runtime-contract.cjs');
const id = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const OWNER=id(1), GENERATION=id(2), ATLAS=id(3), REVISION=id(4), RUN=id(5), REQUEST=id(6);
const HASH='a'.repeat(64), SECRET='contract-test-webhook-secret';
const file = name => readFileSync(new URL(`../${name}`, import.meta.url),'utf8');
const migration = file('supabase/migrations/20260920042000_designpro_revision_pinned_purchase.sql');
// THE FIXTURE MUST NOT BE LAXER THAN PRODUCTION (CLAUDE.md, recorded five times).
// This file used to hand-write `designpro_workflow_runs` WITH a `generation_id`
// column. Production has never had one -- no migration in the history creates
// it -- so the RPC's first statement raised 42703 on every real purchase while
// this suite stayed green over a table that only existed here. The run table
// is now the REAL one, sliced from the migrations that build it.
const between = (text, from, to) => {
  const start = text.indexOf(from);
  const end = to === null ? text.indexOf('\n);', start) + 3 : text.indexOf(to, start);
  if (start < 0 || end <= start) throw new Error(`fixture could not slice ${from}`);
  return text.slice(start, end);
};
const RUNS_TABLE = between(file('supabase/migrations/20260806180000_designpro_core_schema.sql'),
  'CREATE TABLE IF NOT EXISTS public.designpro_workflow_runs', null);
const RUNS_ALTERS = between(file('supabase/migrations/20260806180400_designpro_progressive_identity.sql'),
  'ALTER TABLE public.designpro_workflow_runs', 'CREATE TABLE IF NOT EXISTS public.designpro_revision_sources');
const PATCH = file('supabase/migrations/20260922160000_designpro_revision_purchase_reads_the_run_it_has.sql');
const pin = {atlasRevisionId:ATLAS,revisionId:REVISION,revisionSnapshotHash:HASH,enticeRunId:RUN,ownerId:OWNER};
const basePayload = {checkoutSessionId:'cs_test_revision',paymentIntentId:'pi_test_revision',productType:'print_pack_entitlement',
  generationId:GENERATION,amountCents:29900,userEmail:'checkout@example.test',promotionCode:null,discountCents:0,revision:pin};
const rpcKeys=['p_checkout_session_id','p_payment_intent_id','p_product_type','p_generation_id','p_amount_cents','p_user_email',
  'p_promotion_code','p_discount_cents','p_atlas_revision_id','p_revision_id','p_revision_snapshot_hash','p_entice_run_id','p_owner_id'];

const seedRun=(id,revision,hash)=>`INSERT INTO public.designpro_workflow_runs
  (id,workflow_type,owner_id,tenant_key,idempotency_key,status,revision_id,revision_snapshot_hash,entice_pack_id)
  VALUES ('${id}','designpro.entice_pack','${OWNER}','user_${OWNER}','idem-${id}','completed','${revision}','${hash}','${ATLAS}');`;

async function database(t,{patch=true}={}) {
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA extensions;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT current_setting('request.jwt.claims',true)::jsonb$$;
    CREATE FUNCTION extensions.gen_random_uuid() RETURNS uuid LANGUAGE sql AS $$SELECT gen_random_uuid()$$;
    INSERT INTO auth.users VALUES ('${OWNER}');`);
  // The run table exactly as production builds it -- no generation_id.
  await db.exec(RUNS_TABLE);
  await db.exec(RUNS_ALTERS);
  await db.exec(`
    CREATE TABLE public.designpro_revision_sources(revision_id uuid PRIMARY KEY,owner_id uuid,generation_id uuid,
      visualization_id uuid,snapshot_hash text);
    CREATE TABLE public.designpro_flat_atlas_revisions(id uuid PRIMARY KEY,owner_id uuid,generation_id uuid,request_id uuid);
    ${seedRun(RUN,REVISION,HASH)}
    INSERT INTO public.designpro_revision_sources VALUES ('${REVISION}','${OWNER}','${GENERATION}','${REQUEST}','${HASH}');
    INSERT INTO public.designpro_flat_atlas_revisions VALUES ('${ATLAS}','${OWNER}','${GENERATION}','${REQUEST}');
    SET request.jwt.claims='{"role":"service_role"}';`);
  // Install the real entitlement table, indexes, monetary constraints and RPCs.
  const original=file('supabase/migrations/20260818210000_designpro_purchase_entitlements.sql');
  await db.exec(original.slice(original.indexOf('CREATE TABLE IF NOT EXISTS public.designpro_purchase_entitlements'),
    original.indexOf('ALTER TABLE public.designpro_purchase_entitlements ENABLE ROW LEVEL SECURITY;')));
  await db.exec(file('supabase/migrations/20260824050000_designpro_promotion_codes.sql'));
  await db.exec(migration);
  if(patch)await db.exec(PATCH);
  return db;
}

function actualRuntimeHandler(db, calls) {
  let handler;
  const source=file('runtime/index.js');
  const start=source.indexOf('app.post("/internal/purchases/confirm",');
  const end=source.indexOf('\n});',start)+4;
  assert.ok(start>=0&&end>start);
  vm.runInNewContext(source.slice(start,end), {
    app:{post:(_path,_auth,fn)=>{handler=fn;}},authMiddleware:()=>{},canonicalUuid,
    supabase:{rpc:async(name,args)=>{
      calls.push({name,args});
      try {
        assert.equal(name,'confirm_designpro_revision_purchase');
        assert.deepEqual(Object.keys(args).sort(),[...rpcKeys].sort());
        const result=await db.query(`SELECT public.confirm_designpro_revision_purchase(${rpcKeys.map((_,i)=>`$${i+1}`).join(',')}) AS result`,rpcKeys.map(key=>args[key]));
        return {data:result.rows[0].result,error:null};
      } catch(error) {return {data:null,error:{message:error.message}};}
    }},
  });
  return async body=>{
    let status=200,result;
    const res={status(value){status=value;return this;},json(value){result=value;return this;}};
    await handler({body},res);
    return Response.json(result,{status});
  };
}

async function gateway(t,{runtime,changeWorkspace,changeSource,changeRun}={}) {
  const calls=[],stripeForms=[];
  const fetchImpl=async(url,init={})=>{
    url=String(url);calls.push(url);
    if(url.endsWith('/auth/v1/user'))return Response.json({id:OWNER,email:'checkout@example.test'});
    if(url.endsWith('/rest/v1/rpc/designpro_atlas_revision_workspace')) {
      assert.deepEqual(JSON.parse(init.body),{p_generation_id:GENERATION,p_atlas_revision_id:ATLAS});
      const pairs=[['side','driver'],['passenger-side','passenger'],['hood_detail','hood'],['roof','roof'],['front','front'],['rear','rear'],['close-up','closeup']];
      const row={generationId:GENERATION,atlasRevisionId:ATLAS,ownerId:OWNER,requestId:REQUEST,state:'outputs_ready',viewsSuperseded:false,masterContentHash:HASH,
        views:pairs.map(([sourceViewType,consumerRole],i)=>({sourceViewType,consumerRole,atlasRevisionId:ATLAS,atlasMasterContentHash:HASH,contentHash:'b'.repeat(64),byteSize:100,storagePath:`designpro/user_${OWNER}/${GENERATION}/calls-1-7/${i}.png`}))};
      return Response.json(changeWorkspace?changeWorkspace(row):row);
    }
    if(url.includes('/rest/v1/designpro_revision_sources?')) {
      assert.ok(url.includes(`visualization_id=eq.${REQUEST}`));
      const row={revision_id:REVISION,snapshot_hash:HASH,generation_id:GENERATION,owner_id:OWNER,visualization_id:REQUEST};
      return Response.json(changeSource?changeSource(row):[row]);
    }
    if(url.includes('/rest/v1/designpro_workflow_runs?')) {
      assert.ok(url.includes(`revision_id=eq.${REVISION}`));
      assert.ok(url.includes(`revision_snapshot_hash=eq.${HASH}`));
      const row={id:RUN,generation_id:GENERATION,owner_id:OWNER,revision_id:REVISION,revision_snapshot_hash:HASH,workflow_type:'designpro.entice_pack',status:'completed'};
      return Response.json(changeRun?changeRun(row):[row]);
    }
    if(url==='https://api.stripe.com/v1/checkout/sessions') {
      stripeForms.push(new URLSearchParams(init.body));
      return Response.json({id:'cs_test_revision',url:'https://checkout.stripe.test/session'});
    }
    if(url==='http://runtime/internal/purchases/confirm' && runtime)return runtime(JSON.parse(init.body));
    throw new Error(`unexpected contract-test fetch ${url}`);
  };
  const server=createGateway({env:{NODE_ENV:'test',SUPABASE_URL:'https://project.supabase.test',SUPABASE_PUBLISHABLE_KEY:'test-key',
    DESIGNPRO_APP_ORIGIN:'https://app.example.test',
    STRIPE_SECRET_KEY:'sk_test_contract_fixture',STRIPE_WEBHOOK_SECRET:SECRET,
    DESIGNPRO_RUNTIME_INTERNAL_URL:'http://runtime',WORKER_SECRET:'contract-test-worker-secret-32-characters'},fetchImpl});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {calls,stripeForms,base:`http://127.0.0.1:${server.address().port}`};
}

async function checkout(base,extra={}) {
  return fetch(`${base}/api/checkout/sessions`,{method:'POST',headers:{cookie:'dp_session=fixture','content-type':'application/json',origin:'https://app.example.test'},
    body:JSON.stringify({generationId:GENERATION,atlasRevisionId:ATLAS,product:'print_pack_entitlement',...extra})});
}
function metadata(form) {return Object.fromEntries([...form].filter(([key])=>key.startsWith('metadata[')).map(([key,value])=>[key.slice(9,-1),value]));}
async function webhook(base,fields,extra={}) {
  const raw=JSON.stringify({id:'evt_test_revision',livemode:false,type:'checkout.session.completed',data:{object:{
    id:'cs_test_revision',payment_intent:'pi_test_revision',payment_status:'paid',amount_total:29900,metadata:fields,...extra}}});
  const time=Math.floor(Date.now()/1000),signature=createHmac('sha256',SECRET).update(`${time}.${raw}`).digest('hex');
  return fetch(`${base}/api/webhooks/stripe`,{method:'POST',headers:{'stripe-signature':`t=${time},v1=${signature}`,'content-type':'application/json'},body:raw});
}

test('checkout pins selected Atlas, source hash, manufacturing revision, owner and completed entice run',async t=>{
  const g=await gateway(t),response=await checkout(g.base,{returnPath:`/revision-studio?id=${GENERATION}&sourceRevisionId=${ATLAS}&purchase=old`});
  assert.equal(response.status,200);assert.equal(g.stripeForms.length,1);
  assert.deepEqual(metadata(g.stripeForms[0]),{product_type:'print_pack_entitlement',generation_id:GENERATION,
    atlas_revision_id:ATLAS,revision_id:REVISION,revision_snapshot_hash:HASH,entice_run_id:RUN,
    user_id:OWNER,user_email:'checkout@example.test',amount_cents:'29900'});
  assert.equal(g.calls.some(url=>url.includes('/internal/purchases/')),false);
  for (const [key,value] of [['success_url','print_pack_entitlement'],['cancel_url','cancelled']]) {
    const target=new URL(g.stripeForms[0].get(key));
    assert.equal(target.origin,'https://app.example.test');
    assert.equal(target.pathname,key==='success_url'?`/designpro/jobs/${GENERATION}/progress`:'/revision-studio');
    assert.equal(target.searchParams.get('id'),key==='success_url'?null:GENERATION);
    assert.equal(target.searchParams.get('sourceRevisionId'),ATLAS);
    if(key==='success_url' && value==='print_pack_entitlement') assert.equal(target.searchParams.get('revisionId'),REVISION);
    assert.deepEqual(target.searchParams.getAll('purchase'),[value]);
  }
});

test('logo checkout retains the selected studio while production success opens GENIE progress',async t=>{
  const g=await gateway(t),response=await checkout(g.base,{product:'logo_pack',returnPath:`/revision-studio?id=${GENERATION}&sourceRevisionId=${ATLAS}`});
  assert.equal(response.status,200);
  for(const [key,value]of [['success_url','logo_pack'],['cancel_url','cancelled']]){
    const target=new URL(g.stripeForms[0].get(key));
    assert.equal(target.pathname,'/revision-studio');
    assert.equal(target.searchParams.get('id'),GENERATION);
    assert.equal(target.searchParams.get('sourceRevisionId'),ATLAS);
    assert.deepEqual(target.searchParams.getAll('purchase'),[value]);
  }
});

for(const [name,options] of [
  ['foreign owner',{changeWorkspace:row=>({...row,ownerId:id(9)})}],
  ['wrong Atlas revision',{changeWorkspace:row=>({...row,atlasRevisionId:id(9)})}],
  ['superseded proof',{changeWorkspace:row=>({...row,viewsSuperseded:true})}],
  ['pending proof',{changeWorkspace:row=>({...row,state:'processing'})}],
  ['source mismatch',{changeSource:row=>[{...row,visualization_id:id(9)}]}],
  ['ambiguous source',{changeSource:row=>[row,row]}],
  ['stale run hash',{changeRun:row=>[{...row,revision_snapshot_hash:'b'.repeat(64)}]}],
  ['wrong run revision',{changeRun:row=>[{...row,revision_id:id(9)}]}],
  ['unfinished pack',{changeRun:row=>[{...row,status:'running'}]}],
])test(`checkout rejects ${name} before contacting Stripe`,async t=>{
  const g=await gateway(t,options),response=await checkout(g.base);
  assert.equal(response.status,409);assert.equal(g.stripeForms.length,0);
});

test('missing revision and unpinned signed webhook cannot fall back to latest',async t=>{
  const g=await gateway(t);
  assert.equal((await checkout(g.base,{atlasRevisionId:undefined})).status,400);
  const response=await webhook(g.base,{generation_id:GENERATION,product_type:'print_pack_entitlement'});
  assert.equal(response.status,400);assert.equal((await response.json()).error,'checkout_revision_metadata_invalid');
});

test('signed webhook executes actual runtime and SQL, stays on purchased revision after a newer run, and replays once',async t=>{
  const db=await database(t),rpcCalls=[];
  const g=await gateway(t,{runtime:actualRuntimeHandler(db,rpcCalls)});
  assert.equal((await checkout(g.base)).status,200);
  // A newer completed run of the same generation appears AFTER checkout.
  await db.exec(seedRun(id(7),id(8),'b'.repeat(64)));
  const fields=metadata(g.stripeForms[0]);
  const first=await webhook(g.base,fields);assert.equal(first.status,200);
  const firstBody=await first.json();assert.equal(firstBody.idempotent,false);assert.equal(firstBody.enticeRunId,RUN);
  const replay=await webhook(g.base,fields);assert.equal(replay.status,200);
  const replayBody=await replay.json();assert.equal(replayBody.idempotent,true);assert.equal(replayBody.entitlementId,firstBody.entitlementId);
  assert.deepEqual((await db.query('SELECT entice_run_id,generation_id,amount_cents FROM public.designpro_purchase_entitlements')).rows,
    [{entice_run_id:RUN,generation_id:GENERATION,amount_cents:29900}]);
  for(const patch of [{revision_id:id(8)},{revision_snapshot_hash:'b'.repeat(64)},{atlas_revision_id:id(9)},{user_id:id(9)}]) {
    const bad=await webhook(g.base,{...fields,...patch});assert.equal(bad.status,400);
    assert.equal((await bad.json()).error,'purchase_revision_mismatch');
  }
  const changedAmount=await webhook(g.base,fields,{amount_total:29899});assert.equal(changedAmount.status,400);
  assert.equal((await changedAmount.json()).error,'purchase_replay_mismatch');
  assert.equal((await db.query('SELECT count(*)::int n FROM public.designpro_purchase_entitlements')).rows[0].n,1);
  assert.ok(rpcCalls.every(call=>call.name==='confirm_designpro_revision_purchase'));
});

test('runtime and SQL refuse absent revision fields, non-service callers and unexplained free purchases',async t=>{
  const db=await database(t),runtime=actualRuntimeHandler(db,[]);
  assert.equal((await runtime({...basePayload,revision:{...pin,revisionSnapshotHash:'invalid'}})).status,400);
  assert.equal((await runtime({...basePayload,amountCents:0})).status,400);
  await db.exec(`SET request.jwt.claims='{"role":"authenticated"}';`);
  const response=await runtime(basePayload);assert.equal(response.status,400);
  assert.equal((await response.json()).error,'service_role_required');
  assert.equal((await db.query('SELECT count(*)::int n FROM public.designpro_purchase_entitlements')).rows[0].n,0);
});

for(const [name,change]of [
  ['missing rear',row=>({...row,views:row.views.filter(view=>view.consumerRole!=='rear')})],
  ['different master',row=>({...row,views:row.views.map(view=>({...view,atlasMasterContentHash:'c'.repeat(64)}))})],
  ['duplicate view',row=>({...row,views:[...row.views.slice(0,6),row.views[0]]})],
])test(`production checkout refuses ${name} before Stripe`,async t=>{
  const g=await gateway(t,{changeWorkspace:change}),response=await checkout(g.base);
  assert.equal(response.status,409);assert.match((await response.json()).error,/checkout_proofs_incomplete/);
  assert.equal(g.stripeForms.length,0);
});

// THE RPC ASKED THE RUN TABLE FOR A COLUMN IT HAS NEVER HAD (found on
// production 2026-09-22). `designpro_workflow_runs` carries no `generation_id`;
// PL/pgSQL compiles a statement on first EVALUATION, so this raised 42703 on
// the first real purchase and on every one after it -- Stripe paid, the runtime
// answered 400, no entitlement was written and production never opened.
// Migration 20260922160000 drops that one predicate; the generation stays bound
// by the EXISTS on designpro_revision_sources, which is asserted here to still
// refuse a foreign generation.
test('the purchase RPC reads the run table production actually has, and stays bound to the generation',async t=>{
  const args=[basePayload.checkoutSessionId,basePayload.paymentIntentId,basePayload.productType,GENERATION,
    basePayload.amountCents,basePayload.userEmail,null,0,ATLAS,REVISION,HASH,RUN,OWNER];
  const call=(db,override=[])=>db.query(
    `SELECT public.confirm_designpro_revision_purchase(${args.map((_,i)=>`$${i+1}`).join(',')}) AS result`,
    args.map((value,i)=>override[i]===undefined?value:override[i]));

  // Pre-fix: the real table makes the defect reproduce, verbatim.
  const unpatched=await database(t,{patch:false});
  await assert.rejects(()=>call(unpatched),error=>{
    assert.match(String(error.message),/generation_id/);
    return true;
  },'the unpatched RPC must fail against the run table production actually has');

  const db=await database(t);
  const first=(await call(db)).rows[0].result;
  assert.equal(first.idempotent,false);
  assert.equal(first.enticeRunId,RUN);
  assert.equal(first.revisionId,REVISION);
  assert.equal((await db.query('SELECT count(*)::int n FROM public.designpro_purchase_entitlements')).rows[0].n,1);

  // The generation binding survives: a foreign generation still cannot buy this
  // revision, and neither can a foreign owner, revision or snapshot hash.
  for(const [index,value] of [[3,id(9)],[8,id(9)],[9,id(9)],[10,'b'.repeat(64)],[12,id(9)]]) {
    const override=[];override[index]=value;
    await assert.rejects(()=>call(db,override),/purchase_revision_mismatch/,
      `argument ${index} must still be refused`);
  }
  assert.equal((await db.query('SELECT count(*)::int n FROM public.designpro_purchase_entitlements')).rows[0].n,1);

  // And the patch is idempotent over its own result.
  await db.exec(PATCH);
  assert.equal((await call(db)).rows[0].result.idempotent,true);
});

// The fixture may never drift back to a table production does not have.
test('the run-table fixture is the migrations, not a hand-written one',async t=>{
  assert.equal(/\bgeneration_id\b/.test(RUNS_TABLE),false,'the real run table has no generation_id');
  assert.equal(/\bgeneration_id\b/.test(RUNS_ALTERS),false,'and no migration adds one');
  assert.match(RUNS_TABLE,/CREATE TABLE IF NOT EXISTS public\.designpro_workflow_runs/);
  assert.match(RUNS_TABLE,/revision_id uuid NOT NULL/);
  assert.match(RUNS_ALTERS,/ADD COLUMN IF NOT EXISTS revision_snapshot_hash text/);
  const db=await database(t);
  const columns=(await db.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='designpro_workflow_runs' ORDER BY column_name`)).rows.map(r=>r.column_name);
  assert.equal(columns.includes('generation_id'),false);
  for(const column of ['id','owner_id','revision_id','revision_snapshot_hash','workflow_type','status'])
    assert.ok(columns.includes(column),`${column} missing from the real run table`);
});
