#!/usr/bin/env node
import { createRequire } from "node:module";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
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
const out=arg("out","/tmp/vehiclepro-live-test");
const SUPABASE_URL=String(process.env.SUPABASE_URL||"");
const SERVICE_KEY=String(process.env.SUPABASE_SERVICE_ROLE_KEY||"");
if(!SUPABASE_URL||!SERVICE_KEY||!brief||!company) throw new Error("live test requires Supabase credentials, brief and company");
const service=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const generationId=randomUUID();
const email=`vehiclepro-${testCase.replace(/[^a-z0-9]/gi,"").toLowerCase()}-${generationId.slice(0,8)}@designproai.com`;
const password=randomBytes(32).toString("base64url");
const evidence={contract:"designpro.vehiclepro-live-prompt-test.v1",testCase,generationId,requestId:null,revisionId:null,createdAt:new Date().toISOString(),vehicle:{year,make,model,type},company,brief,website,phone,industry,state:null,promptVerified:false,panelProof:null,views:[],engineReceipt:null,error:null};
const save=()=>{mkdirSync(out,{recursive:true});writeFileSync(`${out}/evidence.json`,JSON.stringify(evidence,null,2));writeFileSync(`${out}/GENERATION_ID.txt`,generationId+"\n");};
save();
try{
 const {data:created,error:createError}=await service.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{designproLivePromptTest:true},user_metadata:{display_name:`VehiclePro Live Test ${testCase}`}});
 if(createError||!created?.user) throw new Error(`create test operator failed: ${createError?.message||"empty user"}`);
 const operatorId=created.user.id;
 const login=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const {data:signed,error:loginError}=await login.auth.signInWithPassword({email,password});
 if(loginError||!signed?.session?.access_token) throw new Error(`test login failed: ${loginError?.message||"no session"}`);
 const operator=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${signed.session.access_token}`}}});
 const {default:sharp}=await import("sharp");
 const logoSvg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="360"><rect width="900" height="360" rx="48" fill="#ffffff"/><text x="450" y="205" text-anchor="middle" font-family="Arial,sans-serif" font-size="72" font-weight="700" fill="#111111">${company.replace(/[<&]/g,"")}</text></svg>`);
 const logoBytes=await sharp(logoSvg).png().toBuffer();
 const logoHash=createHash("sha256").update(logoBytes).digest("hex");
 const logoPath=`users/${operatorId}/revisions/${generationId}/inputs/logo/${logoHash}.png`;
 const {error:uploadError}=await service.storage.from("wrap-files").upload(logoPath,logoBytes,{contentType:"image/png",upsert:true});
 if(uploadError) throw new Error(`logo upload failed: ${uploadError.message}`);
 const input={contractVersion:"designpro.calls-1-7-input.v3",pipelineMode:"flat-first-atlas-v1",vehicle:{year,make,model,type},brief,designName:company,companyName:company,phone,website,industry,mode:"commercial",finish:"Gloss",logoAsset:{storagePath:logoPath,contentHash:logoHash,byteSize:logoBytes.length,contentType:"image/png"}};
 const {data:req,error:reqError}=await operator.rpc("create_designpro_flat_first_generation_request",{p_generation_id:generationId,p_input:input,p_idempotency_key:null});
 if(reqError) throw new Error(`create generation failed: ${reqError.message}`);
 const requestId=String(req?.requestId||req?.id||""); if(!requestId) throw new Error("generation request returned no requestId");
 evidence.requestId=requestId; save();
 let status=null;
 for(let i=0;i<180;i++){
   const {data,error}=await operator.rpc("get_designpro_generation_request",{p_request_id:requestId});
   if(error) throw new Error(`status read failed: ${error.message}`);
   status=data; evidence.state=String(data?.state||""); save();
   if(evidence.state==="outputs_ready") break;
   if(["failed","retryable","cancelled"].includes(evidence.state)) throw new Error(`generation ended ${evidence.state}: ${String(data?.failureCode||"unknown")}`);
   await new Promise(r=>setTimeout(r,5000));
 }
 if(evidence.state!=="outputs_ready") throw new Error(`generation timed out in ${evidence.state}`);
 const {data:row,error:rowError}=await service.from("designpro_generation_requests").select("request_input,engine_receipt,created_at,completed_at").eq("id",requestId).single();
 if(rowError) throw new Error(`generation row read failed: ${rowError.message}`);
 evidence.promptVerified=String(row.request_input?.brief||"")===brief;
 evidence.engineReceipt=row.engine_receipt||null;
 evidence.revisionId=String(row.engine_receipt?.handoffRevisionId||row.engine_receipt?.atlasRevisionId||"")||null;
 const {data:views,error:viewsError}=await service.from("designpro_generation_views").select("source_view_type,status,storage_path,content_hash,created_at").eq("request_id",requestId).order("created_at");
 if(viewsError) throw new Error(`view read failed: ${viewsError.message}`);
 evidence.views=views||[];
 const {data:proof,error:proofError}=await operator.rpc("designpro_atlas_panel_proof_paths",{p_request_id:requestId});
 if(proofError) throw new Error(`panel proof read failed: ${proofError.message}`);
 evidence.panelProof=proof||null;
 if(!evidence.promptVerified) throw new Error("persisted original prompt differs from submitted prompt");
 if(!evidence.panelProof?.panelProof) throw new Error("completed run has no customer-visible composed Production Panel Proof");
 if(evidence.views.filter(v=>v.status==="accepted"||v.status==="completed").length<5) throw new Error(`only ${evidence.views.length} proof rows persisted`);
 save();
 process.stdout.write(`GENERATION_ID=${generationId}\nREQUEST_ID=${requestId}\nREVISION_ID=${evidence.revisionId||""}\n`);
}catch(error){
 evidence.error=String(error?.stack||error);save();throw error;
}
