import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(new URL('../runtime/package.json',import.meta.url));
const sharp=require('sharp');
const {compositeProductionPanels}=require('./atlas-master-composite.cjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(){
 const backgrounds=await Promise.all(['driver','passenger','hood','roof','front','rear'].map(async surfaceKey=>({surfaceKey,bytes:await sharp({create:{width:600,height:300,channels:4,background:'#142050'}}).png().toBuffer()})));
 const assets=['logo','typography','contact'].map(role=>{const bytes=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><path fill="#111111" d="M10 10h160v35H10z"/></svg>`);return {role,bytes,byteSize:bytes.length,contentHash:hash(bytes)};});
 const placements=backgrounds.filter(b=>b.surfaceKey!=='roof').flatMap(b=>assets.map((a,i)=>({surfaceKey:b.surfaceKey,role:a.role,contentHash:a.contentHash,box:{xPct:.1,yPct:.05+i*.3,wPct:.8,hPct:.25}})));
 return {backgrounds,assets,placements};
}
test('every protected original appears on each branded panel with visible pixels and contrast backing',async()=>{
 const f=await fixture();const before=f.assets.map(a=>hash(a.bytes));const result=await compositeProductionPanels(f);
 for(const panel of result.panels){assert.equal(panel.applied.length,panel.surfaceKey==='roof'?0:3);for(const a of panel.applied){assert.ok(a.visiblePixels>0);if(a.role!=='logo')assert.equal(a.contrastBacking,'#ffffff');}}
 assert.deepEqual(f.assets.map(a=>hash(a.bytes)),before);
 const {data,info}=await sharp(result.panels[0].bytes).raw().toBuffer({resolveWithObject:true});
 const i=(106*info.width+61)*info.channels;assert.ok(data[i]>240,'black lettering has a white backing over the dark panel');
});
test('missing typography or duplicate placements refuse rather than succeed',async()=>{
 const f=await fixture();f.placements=f.placements.filter(p=>!(p.surfaceKey==='driver'&&p.role==='typography'));
 await assert.rejects(compositeProductionPanels(f),{code:'atlas_composite_asset_coverage_invalid'});
 const g=await fixture();g.placements.push(g.placements[0]);await assert.rejects(compositeProductionPanels(g),{code:'atlas_composite_asset_coverage_invalid'});
});
test('off-panel, empty and unreadably small overlays refuse',async()=>{
 const f=await fixture();f.placements[1].box.xPct=.9;await assert.rejects(compositeProductionPanels(f),{code:'atlas_composite_bounds_invalid'});
 const g=await fixture();g.placements[1].box.hPct=.01;await assert.rejects(compositeProductionPanels(g),{code:'atlas_composite_text_unreadable'});
 const h=await fixture();const a=h.assets[1];a.bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"></svg>');a.byteSize=a.bytes.length;a.contentHash=hash(a.bytes);h.placements.filter(p=>p.role===a.role).forEach(p=>p.contentHash=a.contentHash);
 await assert.rejects(compositeProductionPanels(h),{code:'atlas_composite_overlay_empty'});
});
