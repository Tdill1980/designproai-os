/** One real engineering reconstruction through the released app's own API client.
 * Reference is an existing canary's single driver view. No real customer login,
 * billing, subscription, paid entitlement, human approval or app mutation. */
import {createClient} from '@supabase/supabase-js';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {dpApi,buildRecreateRequest,recreationLinks} from './recreatepro-client-bundle.mjs';
const OUT='/evidence';
const SHA='49750ba5dfa11955d73d44b4f43bbefd0b809d6d';
const HOST='https://os.designproai.com';
const sourceRequest='90e5a666-a85e-47a1-a28f-149c55df84d1';
const sourceHash='e3cb6b63fda2a5d7e10fc60385f05784880a16483aaf41f9cb2bc30e1d11eef2';
const sourcePath='designpro/user_b940320d-cb5a-4b60-b280-32d12ef4d6a6/2f2febd3-7744-44c3-81b1-1d69c146a243/calls-1-7/side/'+sourceHash+'.jpg';
const nativeFetch=globalThis.fetch;
globalThis.fetch=(url,init={})=>{
 const href=String(url);const headers=new Headers(init.headers);
 if(href.startsWith(HOST+'/api/'))headers.set('origin',HOST);
 return nativeFetch(url,{...init,headers,signal:init.signal||AbortSignal.timeout(60000)});
};
const evidence={releaseSha:SHA,sourceRequest,sourceHash,sourceSurface:'driver',testAccount:null,generationId:null,requestId:null,input:null,state:null,views:[],revisions:[],proof:null,handoff:null,studioLinks:null,error:null,productionApproval:false,paidEntitlement:false};
await mkdir(OUT,{recursive:true});
const save=()=>writeFile(OUT+'/acceptance.json',JSON.stringify(evidence,null,2));
const service=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
async function asset(url,name,expectedHash){
 const response=await fetch(url);if(!response.ok)throw new Error('artifact_read_'+response.status);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(expectedHash&&createHash('sha256').update(bytes).digest('hex')!==expectedHash)throw new Error('artifact_hash_mismatch');
 await writeFile(OUT+'/'+name,bytes);
}
try {
 const live=await(await fetch(HOST+'/gateway-healthz')).text();if(!live.includes(SHA))throw new Error('server_release_mismatch');
 for(const fn of ['design-panel-ai-generate','production-panel-proof','persona-photographer-render']){
  const response=await fetch(process.env.SUPABASE_URL+'/functions/v1/'+fn,{method:'OPTIONS'});
  if(response.headers.get('x-designpro-source-sha')!==SHA)throw new Error('edge_release_mismatch_'+fn);
 }
 const {data:source,error:sourceError}=await service.from('designpro_generation_views').select('storage_path,content_hash,byte_size,content_type').eq('request_id',sourceRequest).eq('consumer_role','driver').is('superseded_at',null).single();
 if(sourceError||source.storage_path!==sourcePath||source.content_hash!==sourceHash)throw new Error('reference_identity_changed');
 const {data:blob,error:downloadError}=await service.storage.from('wrap-files').download(sourcePath);
 if(downloadError||!blob)throw new Error('canary_reference_unavailable');
 const bytes=Buffer.from(await blob.arrayBuffer());
 if(bytes.length!==source.byte_size||createHash('sha256').update(bytes).digest('hex')!==sourceHash)throw new Error('reference_bytes_changed');
 await writeFile(OUT+'/reference-driver.jpg',bytes);
 const email='recreatepro-acceptance-'+Date.now()+'@designproai.com';const password=randomBytes(32).toString('base64url');
 const {data:created,error:createError}=await service.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{designproCanary:true},user_metadata:{display_name:'RecreatePro engineering acceptance'}});
 if(createError||!created.user)throw new Error('test_account_create_failed');
 evidence.testAccount=created.user.id;
 const login=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authError}=await login.auth.signInWithPassword({email,password});
 if(authError||!auth.session)throw new Error('test_account_login_failed');
 globalThis.__recreateTestSession=auth.session;
 const generationId=randomUUID();evidence.generationId=generationId;
 const file=new File([bytes],'existing-canary-driver-side.jpg',{type:'image/jpeg'});
 const uploaded=await dpApi.uploadRevisionAsset(generationId,'attachment',file);
 const input=buildRecreateRequest({generationId,path:'complete',vehicle:{year:'2021',make:'Ford',model:'Transit 250',type:'van'},notes:'Only the driver side is available. Preserve the uploaded design, colors, lettering and logos. Complete the passenger side, rear, front, hood and roof as one coordinated wrap. Keep the existing words and numbers unchanged.',references:[{asset:uploaded,surface:'driver'}]});
 evidence.input=input;await save();
 // Exactly ONE submission. Unconfirmed outcomes are recorded, never regenerated.
 const accepted=await dpApi.createGenerationRequest(input);evidence.requestId=accepted.requestId;await save();
 if(accepted.generationId!==generationId)throw new Error('request_identity_mismatch');
 const deadline=Date.now()+12*60*1000;
 while(Date.now()<deadline){
  evidence.state=await dpApi.getGenerationRequest(accepted.requestId);await save();
  if(['outputs_ready','failed','cancelled'].includes(evidence.state.state))break;
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 const [views,revisions,proof]=await Promise.all([dpApi.listGenerationViews(accepted.requestId),dpApi.listFlatAtlasRevisions(accepted.requestId),dpApi.getAtlasPanelProof(accepted.requestId)]);
 evidence.views=views;evidence.revisions=revisions;evidence.proof=proof;await save();
 if(proof?.sheet?.signedUrl)await asset(proof.sheet.signedUrl,'production-panel-proof.png',proof.sheet.contentHash);
 for(const view of views)if(view.signedUrl)await asset(view.signedUrl,view.consumerRole+'.'+(view.contentType==='image/jpeg'?'jpg':'png'),view.contentHash);
 const latest=revisions.slice().sort((a,b)=>b.revisionSequence-a.revisionSequence)[0];
 for(const panel of latest?.callOnePanels||[])if(panel.signedUrl)await asset(panel.signedUrl,'panel-'+panel.surfaceKey+'.'+(panel.contentType==='image/jpeg'?'jpg':'png'),panel.contentHash);
 evidence.studioLinks=recreationLinks(generationId,latest?.id||evidence.state.atlasRevisionId);
 if(evidence.state.state!=='outputs_ready')throw new Error('generation_'+evidence.state.state+': '+(evidence.state.failureCode||'not complete within bounded test'));
 if(new Set(views.map(v=>v.consumerRole)).size!==7)throw new Error('incomplete_view_set');
 if(!evidence.state.handoffReady)throw new Error('production_handoff_not_ready');
 evidence.handoff=await dpApi.handoffGeneration(accepted.requestId);
 await save();console.log('RECREATEPRO TECHNICAL ACCEPTANCE',JSON.stringify({generationId,requestId:accepted.requestId,views:views.length,revisionId:latest?.id,sha:SHA,paid:false,qcApproved:false}));
} catch(error){evidence.error=String(error);await save();console.error(evidence.error);process.exitCode=1;}
