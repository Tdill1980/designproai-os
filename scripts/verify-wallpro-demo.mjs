import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const app = resolve(root, 'app');
const require = createRequire(resolve(app, 'package.json'));
const puppeteer = require('puppeteer');
const fixture = await mkdtemp(resolve(app, '.wallpro-demo-qa-'));
const output = resolve(process.env.WALLPRO_QA_OUTPUT || '/tmp/wallpro-demo-qa');
await mkdir(output, { recursive: true });
await writeFile(resolve(fixture, 'index.html'), '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
await writeFile(resolve(fixture, 'entry.tsx'), `
import React from 'react'; import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {WallProMagic} from '../src/components/wallpro/WallProMagic';
const light=location.search.includes('light');
document.body.style.cssText='margin:0;background:'+(light?'#f7f8f9':'#101823')+';font-family:Arial,sans-serif';
createRoot(document.getElementById('root')!).render(<div data-wall-theme={light?'light':'dark'} className="wallpro-page" style={{padding:'24px 16px',maxWidth:1180,margin:'auto'}}><WallProMagic/><div id="upload-wall" style={{height:120,paddingTop:25,color:light?'#192333':'white'}}>Start your wall wrap</div></div>);`);
const server = spawn(process.execPath,[resolve(app,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4178','--strictPort'],{cwd:app,stdio:'ignore'});
let browser;
const errors=[];
try {
  const url=`http://127.0.0.1:4178/${basename(fixture)}/`;
  let ready=false;
  for(let attempt=0;attempt<120;attempt++) { try { if((await fetch(url)).ok){ready=true;break;} } catch {} await new Promise(r=>setTimeout(r,250)); }
  assert.ok(ready,'Vite preview must start');
  browser=await puppeteer.launch({headless:true,...(existsSync('/usr/bin/google-chrome')?{executablePath:'/usr/bin/google-chrome'}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
  let cases=0;
  for(const theme of ['dark','light']) for(const width of [1440,1024,768,390,320]) {
    const page=await browser.newPage();await page.setViewport({width,height:1000,deviceScaleFactor:1});
    page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(url+'?'+theme,{waitUntil:'networkidle0'});
    assert.equal(await page.$$eval('.wm-step',n=>n.length),5);
    for(let step=0;step<5;step++) {
      await page.$$eval('.wm-step',(buttons,index)=>buttons[index].click(),step);
      await new Promise(r=>setTimeout(r,60));
      const bounds=await page.evaluate(()=>{
        const stage=document.querySelector('.wm-stage').getBoundingClientRect();
        const content=document.querySelector('.wm-panels, .wm-room').getBoundingClientRect();
        return {doc:document.documentElement.scrollWidth,viewport:innerWidth,stageTop:stage.top,stageBottom:stage.bottom,top:content.top,bottom:content.bottom};
      });
      assert.ok(bounds.doc<=bounds.viewport+1,`${theme}/${width}/${step}: horizontal overflow`);
      assert.ok(bounds.top>=bounds.stageTop-2 && bounds.bottom<=bounds.stageBottom+2,`${theme}/${width}/${step}: stage clipping ${JSON.stringify(bounds)}`);
      if(step===2) {
        assert.equal(await page.$$eval('.wm-mask-controls button[aria-pressed="true"]',n=>n.length),2);
        await page.click('.wm-mask-controls button');
        assert.equal(await page.$$eval('.wm-mask-controls button[aria-pressed="true"]',n=>n.length),1);
      }
      if((width===1440||width===390) && [1,2,3,4].includes(step)) {
        const element=await page.$('.wallpro-magic');await element.screenshot({path:resolve(output,`${theme}-${width}-step-${step+1}.png`)});
      }
      cases++;
    }
    await page.$eval('.wm-step',el=>el.focus());await page.keyboard.press('End');
    assert.equal(await page.$eval('.wm-step.is-active .wm-number',el=>el.textContent),'05');
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
    await new Promise(r=>setTimeout(r,30));
    assert.equal(await page.$eval('.wallpro-magic',el=>el.getAttribute('data-motion')),'reduced');
    await page.close();
  }
  assert.deepEqual(errors,[],'no browser exceptions');
  console.log(`PASS: ${cases} rendered stage/theme/viewport cases; curtain toggles, keyboard, reduced motion, zero overflow and zero stage clipping.`);
} finally {if(browser)await browser.close();server.kill('SIGTERM');await rm(fixture,{recursive:true,force:true});}
