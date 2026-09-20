#!/usr/bin/env node
import { createRequire } from "node:module";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
const require=createRequire(import.meta.url);
const { createClient }=(()=>{try{return require("@supabase/supabase-js")}catch{return require("../runtime/node_modules/@supabase/supabase-js")}})();

const arg=(name,fallback="")=>{const i=process.argv.indexOf(`--${name}`);return i>=0?process.argv[i+1]:fallback};
const testCase=arg("case","live");
const brief=arg("brief");
const company=arg("company");
const website=arg("website");
const phone=arg("phone");
const industry=arg("industry","commercial services");
const year=arg("year","2022"), make=arg("make","Ford"), model=arg("model","F250 Crew Cab"), type=arg("type","truck");
const out=arg("out",`/tmp/vehiclepro-live-test-${randomUUID()}`);
if(existsSync(`${out}/evidence.json`)) throw new Error("existing test evidence must not be overwritten; choose a new --out directory");
const sourceSha=arg("source-sha");
const origin=arg("origin","https://os.designproai.com").replace(/\/$/,"");
if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error("an exact --source-sha is required before a paid test");
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const jsonFetch=async (url,init={})=>{
 const response=await fetch(url,{...init,signal:AbortSignal.timeout(30000)});
 if(!response.ok) throw new Error(`HTTP ${response.status} at ${new URL(url).pathname}`);
 return response.json();
};
const SUPABASE_URL=String(process.env.SUPABASE_URL||"");
const SERVICE_KEY=String(process.env.SUPABASE_SERVICE_ROLE_KEY||"");
if(!SUPABASE_URL||!SERVICE_KEY||!brief||!company) throw new Error("live test requires Supabase credentials, brief and company");
const service=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const generationId=randomUUID();
const email=`vehiclepro-${testCase.replace(/[^a-z0-9]/gi,"").toLowerCase()}-${generationId.slice(0,8)}@designproai.com`;
const password=randomBytes(32).toString("base64url");
const evidence={contract:"designpro.vehiclepro-live-prompt-test.v1",testCase,generationId,designId:`DID-${generationId.replaceAll("-","").slice(0,8).toUpperCase()}`,sourceSha,requestId:null,revisionId:null,releaseIdentity:null,auth:null,latency:{generateToCall1Seconds:null,generateToSevenSeconds:null},visualReview:{call1:"NOT_REVIEWED",call2:"NOT_REVIEWED",revisionStudioOriginalPrompt:"NOT_REVIEWED",panelProOriginalPrompt:"NOT_REVIEWED",versionHistory:"NOT_REVIEWED"},artifacts:[],createdAt:new Date().toISOString(),vehicle:{year,make,model,type},company,brief,website,phone,industry,state:null,promptVerified:false,panelProof:null,views:[],engineReceipt:null,error:null};
const save=()=>{mkdirSync(out,{recursive:true});writeFileSync(`${out}/evidence.json`,JSON.stringify(evidence,null,2));writeFileSync(`${out}/GENERATION_ID.txt`,generationId+"\n");};
save();
let operator=null;
const capture=async()=>{
 if(!evidence.requestId||!operator)return;
 const requestId=evidence.requestId;
 const {data:row,error:rowError}=await service.from("designpro_generation_requests").select("request_input,engine_receipt,created_at,completed_at,error").eq("id",requestId).single();
 if(rowError)throw new Error(`request evidence: ${rowError.message}`);
 evidence.promptVerified=row.request_input?.brief===brief;
 evidence.engineReceipt=row.engine_receipt;
 evidence.refusal=row.error;
 evidence.revisionId=row.engine_receipt?.atlasRevisionId||row.engine_receipt?.handoffRevisionId||null;
 const {data:record,error:recordError}=await operator.rpc("designpro_generation_prompt_record",{p_generation_id:generationId});
 if(recordError)throw new Error(`prompt record: ${recordError.message}`);
 evidence.promptRecord=record;
 const {data:proof,error:proofError}=await operator.rpc("designpro_atlas_panel_proof_paths",{p_request_id:requestId});
 if(proofError)throw new Error(`Call 1 evidence: ${proofError.message}`);
 evidence.panelProof=proof;
 const {data:views,error:viewsError}=await service.from("designpro_generation_views").select("source_view_type,consumer_role,storage_path,content_hash,byte_size,content_type,created_at,superseded_at").eq("request_id",requestId).is("superseded_at",null).order("created_at");
 if(viewsError)throw new Error(`Call 2 evidence: ${viewsError.message}`);
 evidence.views=views||[];
 const sources=[...(proof?.panelProof?[{role:"call1",storagePath:proof.sheet.storagePath,contentHash:proof.sheet.contentHash}]:[]),
   ...evidence.views.map(v=>({role:`call2-${v.consumer_role}`,storagePath:v.storage_path,contentHash:v.content_hash}))];
 for(const src of sources){
   if(evidence.artifacts.some(a=>a.contentHash===src.contentHash&&a.role===src.role))continue;
   const {data,error}=await operator.storage.from("wrap-files").download(src.storagePath);
   if(error)throw new Error(`artifact ${src.role}: ${error.message}`);
   const bytes=Buffer.from(await data.arrayBuffer());
   if(hash(bytes)!==src.contentHash)throw new Error(`artifact hash mismatch: ${src.role}`);
   if(!/^(?:call1|call2-[a-z0-9-]+)$/.test(src.role))throw new Error("invalid artifact role");
   const extension=src.storagePath.split('.').pop();
   if(!["png","jpg","jpeg","webp"].includes(extension))throw new Error("unsupported proof image type");
   const file=`${src.role}.${extension}`;
   writeFileSync(`${out}/${file}`,bytes);
   evidence.artifacts.push({...src,file,byteSize:bytes.length});
 }
 save();
};
try{
 // Zero-cost identity checks precede account creation and the single generation request.
 const [app,gateway,...runtimes]=await Promise.all([
   jsonFetch(`${origin}/release.json`),jsonFetch(`${origin}/gateway-healthz`),
   ...arg("runtime-health","http://127.0.0.1:3001/health,http://127.0.0.1:3002/health").split(",").map(url=>jsonFetch(url)),
 ]);
 if(app.sourceSha!==sourceSha||gateway.sourceSha!==sourceSha||runtimes.length!==2
   ||runtimes.some(r=>r.commit!==sourceSha||r.ready!==true))throw new Error("mixed or unready app/gateway/runtime release");
 const edges={};
 for(const name of ["design-panel-ai-generate","production-panel-proof","persona-photographer-render"]){
   const response=await fetch(`${SUPABASE_URL}/functions/v1/${name}`,{method:"OPTIONS",signal:AbortSignal.timeout(30000)});
   edges[name]=response.headers.get("x-designpro-source-sha");
   if(!response.ok||edges[name]!==sourceSha)throw new Error(`edge source SHA mismatch: ${name}`);
 }
 evidence.releaseIdentity={app:app.sourceSha,gateway:gateway.sourceSha,runtimes:runtimes.map(r=>r.commit),edges};save();
 const {data:created,error:createError}=await service.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{designproLivePromptTest:true},user_metadata:{display_name:`VehiclePro Live Test ${testCase}`}});
 if(createError||!created?.user) throw new Error(`create test operator failed: ${createError?.message||"empty user"}`);
 const operatorId=created.user.id;
 const login=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const {data:signed,error:loginError}=await login.auth.signInWithPassword({email,password});
 if(loginError||!signed?.session?.access_token) throw new Error(`test login failed: ${loginError?.message||"no session"}`);
 operator=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${signed.session.access_token}`}}});
 evidence.auth={method:"fresh password authentication",userId:operatorId,verifiedAt:new Date().toISOString(),browserSession:"UNVERIFIED"};save();
 const sharp=(()=>{try{return require("sharp")}catch{return require("../runtime/node_modules/sharp")}})();
 const logoSvg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="360"><rect width="900" height="360" rx="48" fill="#ffffff"/><text x="450" y="205" text-anchor="middle" font-family="Arial,sans-serif" font-size="72" font-weight="700" fill="#111111">${company.replace(/[<&]/g,"")}</text></svg>`);
 const logoBytes=await sharp(logoSvg).png().toBuffer();
 const logoHash=createHash("sha256").update(logoBytes).digest("hex");
 const logoPath=`users/${operatorId}/revisions/${generationId}/inputs/logo/${logoHash}.png`;
 const {error:uploadError}=await service.storage.from("wrap-files").upload(logoPath,logoBytes,{contentType:"image/png",upsert:false});
 if(uploadError) throw new Error(`logo upload failed: ${uploadError.message}`);
 const input={contractVersion:"designpro.calls-1-7-input.v3",pipelineMode:"flat-first-atlas-v1",vehicle:{year,make,model,type},brief,designName:company,companyName:company,phone,website,industry,mode:"commercial",finish:"Gloss",logoAsset:{storagePath:logoPath,contentHash:logoHash,byteSize:logoBytes.length,contentType:"image/png"}};
 evidence.generateClickedAt=new Date().toISOString();save();
 const req=await jsonFetch(`${origin}/api/generation/requests`,{method:"POST",headers:{Authorization:`Bearer ${signed.session.access_token}`,"content-type":"application/json",Origin:origin},body:JSON.stringify({generationId,input,requiredPipelineMode:"flat-first-atlas-v1"})});
 const requestId=String(req?.requestId||req?.id||""); if(!requestId) throw new Error("generation request returned no requestId");
 evidence.requestId=requestId; save();
 let status=null;
 for(let i=0;i<180;i++){
   const {data,error}=await operator.rpc("get_designpro_generation_request",{p_request_id:requestId});
   if(error) throw new Error(`status read failed: ${error.message}`);
   status=data; const observedAt=Date.now(); evidence.state=String(data?.state||""); save();
   const {data:call1,error:call1Error}=await operator.rpc("designpro_atlas_panel_proof_paths",{p_request_id:requestId});
   if(call1Error)throw new Error(`Call 1 status read: ${call1Error.message}`);
   if(call1?.panelProof && evidence.latency.generateToCall1Seconds===null){
     evidence.latency.generateToCall1Seconds=(observedAt-Date.parse(evidence.generateClickedAt))/1000;
     await capture();
   }
   if(evidence.state==="outputs_ready") {
     evidence.latency.generateToSevenSeconds=(observedAt-Date.parse(evidence.generateClickedAt))/1000;
     break;
   }
   if(["failed","retryable","cancelled"].includes(evidence.state)) throw new Error(`generation ended ${evidence.state}: ${String(data?.failureCode||"unknown")}`);
   await new Promise(r=>setTimeout(r,5000));
 }
 if(evidence.state!=="outputs_ready") throw new Error(`generation timed out in ${evidence.state}`);
 await capture();
 if(!evidence.promptVerified||evidence.promptRecord?.originalPrompt!==brief)throw new Error("persisted original prompt differs from submitted prompt");
 if(!evidence.panelProof?.panelProof)throw new Error("completed run has no three-zone proof");
 const roles=new Set(evidence.views.map(v=>v.consumer_role));
 if(evidence.views.length!==7||roles.size!==7||!["driver","passenger","hood","roof","front","rear"].every(r=>roles.has(r))
   ||!(roles.has("closeup")||roles.has("hero3d")))throw new Error("Call 2 is not a complete seven-proof set");
 if(evidence.artifacts.length!==8)throw new Error("expected one Call 1 and seven Call 2 downloaded images");
 evidence.technicalComplete=true;
 evidence.latency.measurement="client observed, 5-second polling resolution; actual image review still required";
 save();
 process.stdout.write(`GENERATION_ID=${generationId}\nREQUEST_ID=${requestId}\nREVISION_ID=${evidence.revisionId||""}\n`);
}catch(error){
 evidence.error=String(error?.message||error);save();
 try{await capture();}catch(captureError){evidence.captureError=String(captureError?.message||captureError);save();}
 throw error;
}
