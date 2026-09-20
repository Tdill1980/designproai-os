import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../runtime/package.json',import.meta.url));
const sharp=require('sharp');
const {keyGeneratedLogo}=require('../runtime/atlas-logo-chroma.cjs');
test('runtime keys generated magenta backdrop and preserves colored logo pixels',async()=>{
 const mark=await sharp({create:{width:20,height:12,channels:3,background:'#12a454'}}).png().toBuffer();
 const raw=await sharp({create:{width:100,height:80,channels:3,background:'#ff00ff'}})
   .composite([{input:mark,left:40,top:34}]).png().toBuffer();
 const result=await keyGeneratedLogo(raw);
 const {data,info}=await sharp(result).raw().toBuffer({resolveWithObject:true});
 assert.equal(info.width,32);assert.equal(info.height,24);assert.equal(info.channels,4);
 assert.equal(data[3],0);
 const i=(6*info.width+6)*4;assert.deepEqual([...data.subarray(i,i+4)],[18,164,84,255]);
 await assert.rejects(keyGeneratedLogo(mark),/alpha_invalid/);
 const blank=await sharp({create:{width:10,height:10,channels:3,background:'#ff00ff'}}).png().toBuffer();
 await assert.rejects(keyGeneratedLogo(blank),/alpha_invalid/);
});

test('actual 4K raster processes in runtime with transparent background and unchanged artwork',async()=>{
 const mark=await sharp({create:{width:1024,height:512,channels:3,background:'#12a454'}}).png().toBuffer();
 const native=await sharp({create:{width:4096,height:4096,channels:3,background:'#ff00ff'}})
   .composite([{input:mark,left:1536,top:1792}]).png().toBuffer();
 const result=await keyGeneratedLogo(native);
 const meta=await sharp(result).metadata();
 assert.equal(meta.width,1036);assert.equal(meta.height,524);assert.equal(meta.hasAlpha,true);
 const artwork=await sharp(result).extract({left:6,top:6,width:1024,height:512}).removeAlpha().raw().toBuffer();
 assert.deepEqual(artwork,await sharp(mark).raw().toBuffer());
});
