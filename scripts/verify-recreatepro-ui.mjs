/** Actual React/RecreatePro page in Chromium with mocked auth/API only.
 * No generation, charge, production approval, or production write is made.
 * Test artifacts are labeled fixtures. The full app build runs separately. */
import { createServer } from '../app/node_modules/vite/dist/node/index.js';
import { chromium } from '../app/node_modules/playwright-core/index.mjs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('app');
const fixture = resolve('app/.recreatepro-browser-review');
const out = resolve('recreatepro-review-evidence');
await mkdir(fixture, { recursive: true }); await mkdir(out, { recursive: true });
const stub = `
export const apiCalls = window.__recreateCalls = { inputs:[], uploads:[], handoffs:[] };
const uid = '44444444-4444-4444-8444-444444444444';
const requestId = '55555555-5555-4555-8555-555555555555';
const revisionId = '66666666-6666-4666-8666-666666666666';
const user = new URLSearchParams(location.search).has('guest') ? null : {id:uid,email:'recreate-ui-fixture@example.invalid'};
const query = new URLSearchParams(location.search);
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const hash = 'a'.repeat(64);
const read = () => ({requestId,generationId:apiCalls.inputs[0]?.generationId || sessionStorage.getItem('fixture-generation') || '77777777-7777-4777-8777-777777777777',pipelineMode:'flat-first-atlas-v1',state:query.has('queued')?'leased':query.has('failed')?'failed':'outputs_ready',phase:query.has('queued')?'designer':'complete',designId:'DID-FIXTURE',atlasRevisionId:revisionId,handoffReady:!query.has('queued')&&!query.has('failed'),shotsComplete:7,shotsTotal:7,inputHash:hash,engineContractHash:hash});
export const supabase = {auth:{getSession:async()=>({data:{session:user?{user}:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};
export function useSubscriptionLimits(){return {subscription:query.has('subscriber')?{id:'fixture-subscription',status:'active',tier:'complete'}:null,loading:false};}
export const dpApi = {
 uploadRevisionAsset:async(generationId,kind,file)=>{apiCalls.uploads.push({generationId,kind,name:file.name});return {storagePath:'users/'+uid+'/revisions/'+generationId+'/inputs/attachment/'+hash+'.png',contentHash:hash,contentType:file.type,byteSize:file.size};},
 createGenerationRequest:async(input)=>{apiCalls.inputs.push(structuredClone(input));if(query.has('retry')&&apiCalls.inputs.length===1)throw new Error('Fixture network interruption');sessionStorage.setItem('fixture-generation',input.generationId);return read();},
 getGenerationRequest:async()=>read(),
 listGenerationViews:async()=>query.has('queued')?[]:['driver','passenger','hood','roof','front','rear','closeup'].map(consumerRole=>({consumerRole,sourceViewType:consumerRole,contentHash:hash,contentType:'image/png',byteSize:70,signedUrl:pixel})),
 listFlatAtlasRevisions:async()=>query.has('queued')?[]:[{id:revisionId,revisionSequence:1,callOnePanels:['driver','passenger','hood','roof','front','rear'].map(surfaceKey=>({surfaceKey,contentHash:hash,contentType:'image/png',byteSize:70,signedUrl:pixel}))}],
 getAtlasPanelProof:async()=>({panelProof:false}),
 handoffGeneration:async(id)=>{apiCalls.handoffs.push(id);if(query.has('handoff-fail'))throw new Error('Fixture handoff unavailable');return{generationId:read().generationId,revisionId,runId:'fixture-run'};},
};
export function ToolAccountMenu(){return null;}
`;
await writeFile(resolve(fixture,'stub.tsx'), stub);
await writeFile(resolve(fixture,'entry.tsx'), `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{HelmetProvider}from'react-helmet-async';import RecreatePro from '../src/pages/RecreatePro';import '../src/index.css';createRoot(document.getElementById('root')!).render(<HelmetProvider><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><BrowserRouter><RecreatePro/></BrowserRouter></QueryClientProvider></HelmetProvider>);`);
await writeFile(resolve(fixture,'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.recreatepro-browser-review/entry.tsx"></script></body></html>');
const mockPath = resolve(fixture,'stub.tsx');
const server = await createServer({configFile:false,root,esbuild:{jsx:'automatic'},plugins:[{name:'recreate-review-page',configureServer(server){server.middlewares.use((req,_res,next)=>{if(req.url?.startsWith('/recreatepro')||req.url?.startsWith('/login'))req.url='/.recreatepro-browser-review/index.html';next();});}}],define:{__BUILD_ID__:JSON.stringify('RECREATEPRO UI TEST FIXTURE')},resolve:{alias:[...['@/integrations/supabase/client','@/lib/designpro-api','@/hooks/useSubscriptionLimits','@/components/layout/ToolAccountMenu'].map(find=>({find,replacement:mockPath})),{find:'@',replacement:resolve(root,'src')}]},server:{port:4187,host:'127.0.0.1',strictPort:true}});
await server.listen();
const browser = await chromium.launch({headless:true});
const errors = []; const cases = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const begin = async (width, query='') => {
 const context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
 await page.goto('http://127.0.0.1:4187/recreatepro'+query);await page.getByRole('heading',{name:/Got the picture/}).waitFor();return{page,context};
};
const fill = async(page,path='Complete My Design')=>{
 await page.getByRole('button',{name:new RegExp('^'+path)}).click();
 await page.getByLabel('Upload design references').setInputFiles({name:'customer-van-side.png',mimeType:'image/png',buffer:png});
 await page.locator('input[placeholder="2024"]').fill('2024');
 await page.locator('input[placeholder="Ford"]').fill('Ford');
 await page.locator('input[placeholder="Transit 250, high roof"]').fill('Transit 250');
 await page.locator('textarea').fill('Keep the exact design. Change ONLY the phone to 623-555-0174.');
 await page.getByRole('checkbox',{name:/own this artwork/}).check();
};
try {
 for(const width of [320,390,768,1440]){
  const{page,context}=await begin(width,'?guest=1');
  assert.equal(await page.getByRole('button',{name:/^Recreate Exactly/}).count(),1);
  assert.equal(await page.getByRole('button',{name:/^Complete My Design/}).count(),1);
  await fill(page);
  await page.screenshot({path:resolve(out,`recreatepro-input-${width}-fixture.png`),fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,`overflow at ${width}`);
  await page.reload();await page.waitForTimeout(700);
  assert.equal(await page.locator('textarea').inputValue(),'Keep the exact design. Change ONLY the phone to 623-555-0174.');
  assert.equal(await page.locator('img[alt="Original uploaded design"]').count(),1);
  await page.getByRole('checkbox',{name:/own this artwork/}).check();
  await page.getByRole('button',{name:'Sign in & keep my design'}).click();await page.waitForURL('**/login');
  assert.equal(await page.evaluate(()=>window.__recreateCalls.inputs.length),0);
  cases.push({width,case:'guest upload, draft reload, safe sign-in, no overflow',passed:true});await context.close();
 }
 for(const [path,label]of[['exact','Recreate Exactly'],['complete','Complete My Design'],['transfer','Transfer to Another Vehicle']]){
  const{page,context}=await begin(1440);await fill(page,label);await page.locator('button[type="submit"]').click();
  await page.getByRole('link',{name:'Review & order print files'}).waitFor();
  const calls=await page.evaluate(()=>window.__recreateCalls);
  assert.equal(calls.inputs.length,1);assert.match(calls.inputs[0].brief.styleDescriptors,new RegExp('RecreatePro / '+path));assert.equal(calls.inputs[0].brief.brief,'Keep the exact design. Change ONLY the phone to 623-555-0174.');assert.equal(calls.uploads[0].generationId,calls.inputs[0].generationId);assert.equal(calls.handoffs.length,1);
  assert.match(await page.getByRole('link',{name:'Open RevisionStudioIQ'}).getAttribute('href'),/sourceRevisionId=66666666/);
  await page.screenshot({path:resolve(out,`recreatepro-${path}-result-fixture.png`),fullPage:true});
  await page.reload();await page.getByRole('link',{name:'Review & order print files'}).waitFor();assert.equal(await page.evaluate(()=>window.__recreateCalls.inputs.length),0);
  cases.push({path,case:'source identity, exact edits, canonical handoff, resume without regeneration',passed:true});await context.close();
 }
 const{page,context}=await begin(390,'?retry=1');await fill(page);await page.locator('button[type="submit"]').click();await page.getByRole('button',{name:'Retry this saved request'}).waitFor();await page.getByRole('button',{name:'Retry this saved request'}).click();await page.getByRole('link',{name:'Review & order print files'}).waitFor();
 const calls=await page.evaluate(()=>window.__recreateCalls);assert.equal(calls.inputs.length,2);assert.deepEqual(calls.inputs[0],calls.inputs[1]);assert.equal(calls.uploads.length,1);cases.push({case:'ambiguous retry reuses exact envelope and does not reupload',passed:true});await context.close();
 for(const subscriber of [false,true]){
  const{page,context}=await begin(390,subscriber?'?subscriber=1':'');await fill(page);await page.getByRole('radio',{name:/My subscription/}).check();await page.locator('button[type="submit"]').click();
  if(subscriber){await page.getByRole('link',{name:'Review & order print files'}).waitFor();}else{await page.getByRole('alert').filter({hasText:'No active subscription'}).waitFor();assert.equal(await page.evaluate(()=>window.__recreateCalls.inputs.length),0);}
  cases.push({case:'existing subscription '+(subscriber?'accepted':'not invented'),passed:true});await context.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:cases.length,cases,browserErrors:errors},null,2));await writeFile(resolve(out,'browser-results.json'),JSON.stringify({passed:cases.length,cases,browserErrors:errors},null,2));
} finally {await browser.close();await server.close();await rm(fixture,{recursive:true,force:true});}
