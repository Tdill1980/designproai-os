import { describe, expect, it, vi } from 'vitest';
import { artworkPoint, homography, projectPoint, UNIT_WALL, validWallCorners, validWallSize, wallGenerationBlocker, wallPreviewBlocker, layoutMetrics, insidePolygon, rectangularWallMask, wallPrintPanels } from '../wallpro-geometry';
import sharp from 'sharp';
import { createWallHandler, parseWallInput, nearestAspect, decodeWallImage, finalWallImage, imageDimensions, PRODUCTION_PPI } from '../../../../supabase/functions/generate-wall-design/handler';
import { wallDesignPrompt } from '../../../../supabase/functions/generate-wall-design/prompt';
import { needsWallTranscode } from '../wallpro-render';
const owner = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const input = { requestId, prompt: 'Blue botanicals', width: 120, height: 96, placement: 'cover', wallPath: owner + '/uploads/33333333-3333-4333-8333-333333333333.jpg' };

describe('WallPro physical geometry', () => {
  it('creates a stable window or drape mask from either pair of opposite corners', () => {
    const mask=rectangularWallMask({x:.8,y:.9},{x:.3,y:.2});
    expect(mask).toEqual([{x:.3,y:.2},{x:.8,y:.2},{x:.8,y:.9},{x:.3,y:.9}]);
    expect(insidePolygon({x:.5,y:.5},mask)).toBe(true);
    expect(insidePolygon({x:.2,y:.5},mask)).toBe(false);
    expect(()=>rectangularWallMask({x:.3,y:.2},{x:.3,y:.9})).toThrow();
  });
  it('plans 54-inch print panels with a correctly sized final panel', () => {
    const panels = wallPrintPanels(150,96);
    expect(panels.map(p => p.width)).toEqual([54,54,42]);
    expect(panels.map(p => p.start)).toEqual([0,54,108]);
    expect(panels.reduce((n,p) => n+p.width,0)).toBe(150);
    expect(wallPrintPanels(108,96)).toHaveLength(2);
    expect(wallPrintPanels(54.25,96).map(p => p.width)).toEqual([54,.25]);
  });
  it('keeps pattern registration continuous across a 54-inch print seam', () => {
    const seam = wallPrintPanels(150,96)[1].start;
    const uv = artworkPoint({x:seam/150,y:.5},{width:150,height:96,mode:'repeat',repeatWidth:24},1);
    expect(uv?.x).toBeCloseTo((54/24)%1,10);
    const quad=[{x:.1,y:.1},{x:.9,y:.2},{x:.8,y:.9},{x:.2,y:.8}];
    const seamPoint=projectPoint(homography(UNIT_WALL,quad),{x:seam/150,y:0});
    expect(projectPoint(homography(quad,UNIT_WALL),seamPoint).x).toBeCloseTo(54/150,10);
  });
  it('keeps a 24-inch tile physically constant when the wall doubles', () => {
    const a = layoutMetrics({ width:120,height:96,mode:'repeat',repeatWidth:24 },2);
    const b = layoutMetrics({ width:240,height:96,mode:'repeat',repeatWidth:24 },2);
    expect(a).toMatchObject({ across:5,down:8,artworkWidth:24,artworkHeight:12 });
    expect(b).toMatchObject({ across:10,down:8,artworkWidth:24,artworkHeight:12 });
    expect(artworkPoint({x:12/120,y:6/96},{width:120,height:96,mode:'repeat',repeatWidth:24},2)).toEqual({x:0.5,y:0.5});
    expect(artworkPoint({x:12/240,y:6/96},{width:240,height:96,mode:'repeat',repeatWidth:24},2)).toEqual({x:0.5,y:0.5});
  });
  it('centres a tile larger than the wall, so a mural scaled past 100% shows its middle', () => {
    // A 2:1 master as a 240-inch tile on a 120 x 96 wall: 120 wider than the
    // wall, so tile (0,0) starts 60 inches left of it; 120 tall on a 96 wall,
    // so 12 inches above it. The wall's centre is the tile's centre.
    const layout = { width: 120, height: 96, mode: 'repeat' as const, repeatWidth: 240 };
    expect(layoutMetrics(layout, 2)).toMatchObject({ artworkWidth: 240, artworkHeight: 120, originX: -60, originY: -12 });
    const centre = artworkPoint({ x: 0.5, y: 0.5 }, layout, 2)!;
    expect(centre.x).toBeCloseTo(0.5, 10); expect(centre.y).toBeCloseTo(0.5, 10);
    const left = artworkPoint({ x: 0, y: 0 }, layout, 2)!;
    expect(left.x).toBeCloseTo(0.25, 10); expect(left.y).toBeCloseTo(0.1, 10);
    // A tile smaller than the wall still starts at the wall's corner.
    expect(layoutMetrics({ ...layout, repeatWidth: 24 }, 2)).toMatchObject({ originX: 0, originY: 0 });
  });
  it('maps perspective corners exactly and round-trips interior points', () => {
    const quad = [{x:.1,y:.2},{x:.9,y:.1},{x:.8,y:.9},{x:.2,y:.7}];
    expect(validWallCorners(quad)).toBe(true);
    const forward = homography(UNIT_WALL,quad), inverse = homography(quad,UNIT_WALL);
    for (let i=0;i<4;i++) { const p=projectPoint(forward,UNIT_WALL[i]); expect(p.x).toBeCloseTo(quad[i].x,10); expect(p.y).toBeCloseTo(quad[i].y,10); }
    const p=projectPoint(inverse,projectPoint(forward,{x:.35,y:.8}));
    expect(p.x).toBeCloseTo(.35,10); expect(p.y).toBeCloseTo(.8,10);
  });
  it('rejects crossed, degenerate and unmeasured walls', () => {
    expect(validWallCorners([UNIT_WALL[0],UNIT_WALL[2],UNIT_WALL[1],UNIT_WALL[3]])).toBe(false);
    expect(validWallCorners([{x:0,y:0},{x:.1,y:0},{x:.2,y:0},{x:.3,y:0}])).toBe(false);
    for (const n of [0,-1,NaN,Infinity,2500]) expect(validWallSize(n,96)).toBe(false);
  });
  it('generates the flat rectangle on the wall size alone; corners only gate the on-wall view', () => {
    const quad = [{x:.1,y:.2},{x:.9,y:.1},{x:.8,y:.9},{x:.2,y:.7}];
    // A wall photo with three corners, none, or crossed corners still generates:
    // the flat design is the product and the print file.
    expect(wallGenerationBlocker(true, quad.slice(0,3), 120, 96)).toBeNull();
    expect(wallGenerationBlocker(true, [], 120, 96)).toBeNull();
    expect(wallGenerationBlocker(true, [quad[0],quad[2],quad[1],quad[3]], 120, 96)).toBeNull();
    expect(wallGenerationBlocker(true, quad, 120, 96)).toBeNull();
    expect(wallGenerationBlocker(false, [], 120, 96)).toBeNull();
    // Only the dimensions gate the paid call.
    expect(wallGenerationBlocker(false, [], 0, 96)).toMatch(/1 and 2,400 inches/);
    expect(wallGenerationBlocker(true, quad, 120, NaN)).toMatch(/1 and 2,400 inches/);
    // The on-wall view says what it is waiting for, and never claims to block files.
    expect(wallPreviewBlocker(true, quad.slice(0,3))).toMatch(/four wall corners \(1 remaining\)/);
    expect(wallPreviewBlocker(true, quad.slice(0,3))).toMatch(/print files do not wait/);
    expect(wallPreviewBlocker(true, [])).toMatch(/4 remaining/);
    expect(wallPreviewBlocker(true, [quad[0],quad[2],quad[1],quad[3]])).toMatch(/cross or form a narrow area/);
    expect(wallPreviewBlocker(true, quad)).toBeNull();
    expect(wallPreviewBlocker(false, quad.slice(0,3))).toBeNull();
  });
  it('preserves proportions for cover and contain without stretching', () => {
    expect(layoutMetrics({width:120,height:96,mode:'cover',repeatWidth:24},1)).toMatchObject({artworkWidth:120,artworkHeight:120});
    expect(layoutMetrics({width:120,height:96,mode:'contain',repeatWidth:24},1)).toMatchObject({artworkWidth:96,artworkHeight:96});
    expect(artworkPoint({x:0,y:.5},{width:120,height:96,mode:'contain',repeatWidth:24},1)).toBeNull();
    expect(artworkPoint({x:.5,y:0},{width:120,height:96,mode:'cover',repeatWidth:24},1)?.y).toBeCloseTo(.1);
  });
  it('excludes windows and keeps pixels outside the wall unchanged', () => {
    const window=[{x:.3,y:.3},{x:.6,y:.3},{x:.6,y:.7},{x:.3,y:.7}];
    expect(insidePolygon({x:.4,y:.5},window)).toBe(true);
    expect(insidePolygon({x:.2,y:.5},window)).toBe(false);
    expect(artworkPoint({x:1.1,y:.5},{width:120,height:96,mode:'repeat',repeatWidth:24},1)).toBeNull();
  });
});

function fixture(options: { auth?: boolean; unreadable?: boolean; fresh?: boolean; providerFailure?: boolean; recitationFirst?: boolean; noTokens?: boolean; image?: Uint8Array; download?: Uint8Array } = {}) {
  const finalData = options.image ? Buffer.from(options.image).toString('base64') : btoa('final');
  const calls:any[]=[];
  const stored={state:'completed',artwork_path:owner+'/generated/'+requestId+'.png',design_name:'Blue Botanicals'};
  const storage={
    download:vi.fn(async () => options.unreadable ? {error:{message:'denied'}} : {data:new Blob([options.download ? (options.download as Uint8Array<ArrayBuffer>) : 'image'],{type:options.download ? 'image/png' : 'image/jpeg'})}),
    upload:vi.fn(async (...args:any[]) => { calls.push(['upload',...args]); return {}; }),
    createSignedUrl:vi.fn(async () => ({data:{signedUrl:'https://example.test/signed-result'}})),
  };
  const sb={auth:{getUser:vi.fn(async () => options.auth===false ? {error:true} : {data:{user:{id:owner}}})},storage:{from:vi.fn(() => storage)},rpc:vi.fn(async (name:string,args:any) => {
    calls.push([name,args]);
    if(name==='reserve_wallpro_generation') return options.noTokens ? {error:{message:'no_tokens'}} : {data:{fresh:options.fresh!==false,generation:stored}};
    return {data:stored};
  })};
  const provider=vi.fn(async (url:any,init:any) => {
    // The fast text model, asked to describe the covering before a words-only retry.
    if (String(url).includes('gemini-2.5-flash')) { calls.push(['describe',JSON.parse(init.body)]); return Response.json({candidates:[{content:{parts:[{text:'Vertical white-oak slats about 1.5 inches wide with 0.5 inch dark gaps, matte, fine straight grain.'}]}}]}); }
    calls.push(['provider',JSON.parse(init.body)]); if (options.recitationFirst && calls.filter(c=>c[0]==='provider').length===1) return Response.json({candidates:[{finishReason:'IMAGE_RECITATION',content:{parts:[]}}]}); return options.providerFailure ? new Response('{}',{status:503}) : Response.json({candidates:[{content:{parts:[{thought:true,inlineData:{data:btoa('thought'),mimeType:'image/png'}},{text:'Blue Botanicals'},{inlineData:{data:finalData,mimeType:'image/png'}}]}}]}); });
  const handler=createWallHandler({createClient:()=>sb,supabaseUrl:'https://own.supabase.co',serviceKey:'private-test-key',apiKey:()=> 'provider-test-key',fetch:provider as any});
  const invoke=(body:any=input)=>handler(new Request('https://own.supabase.co/functions/v1/generate-wall-design',{method:'POST',headers:{authorization:'Bearer user-test-token'},body:JSON.stringify(body)}));
  return {handler,invoke,calls,provider,sb,storage};
}

describe('WallPro generation boundary', () => {
  it('generates from a prompt with no wall photo, style reference or corner coordinates', async () => {
    const f=fixture(); const result=await f.invoke({...input,wallPath:null,referencePath:null});
    expect(result.status).toBe(200); expect(f.storage.download).not.toHaveBeenCalled();
    const payload=f.calls.find(c=>c[0]==='provider')[1];
    expect(payload.generationConfig.responseModalities).toEqual(['IMAGE']);
    expect(payload.contents[0].parts).toHaveLength(1);
  });
  it('decodes a large image without the per-character intermediate array', () => {
    const bytes=Buffer.alloc(12*1024*1024); for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
    const actual=decodeWallImage(bytes.toString('base64'));
    expect(Buffer.compare(Buffer.from(actual),bytes)).toBe(0);
    expect(()=>decodeWallImage('AAAA'.repeat(8*1024*1024))).toThrow('supported size');
  });
  it('does not publish thought images or blocked candidates and reports the actual stop reason', () => {
    expect(()=>finalWallImage({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{thought:true,inlineData:{mimeType:'image/png',data:'AAAA'}}]}}]})).toThrow('MAX_TOKENS');
    expect(()=>finalWallImage({candidates:[{finishReason:'IMAGE_SAFETY',content:{parts:[{inlineData:{mimeType:'image/png',data:'AAAA'}}]}}]})).toThrow('IMAGE_SAFETY');
    expect(finalWallImage({candidates:[{content:{parts:[]}},{content:{parts:[{inlineData:{mimeType:'image/png',data:'AAAA'}}]}}]})).toEqual({mimeType:'image/png',data:'AAAA'});
  });
  it('requires real user authentication before reading files or charging',async () => {
    const f=fixture({auth:false}); expect((await f.invoke()).status).toBe(401); expect(f.storage.download).not.toHaveBeenCalled(); expect(f.sb.rpc).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
  });
  it('understands the four entry paths as intents and enforces what each needs', async () => {
    const ref = owner + '/uploads/44444444-4444-4444-8444-444444444444.png';
    expect(parseWallInput({...input, intent:'match', prompt:'', referencePath: ref}, owner)).toMatchObject({ intent:'match', prompt:'', referencePath: ref });
    expect(()=>parseWallInput({...input, intent:'match', referencePath: null}, owner)).toThrow('design to match');
    expect(()=>parseWallInput({...input, intent:'wall', wallPath: null}, owner)).toThrow('wall photo');
    expect(parseWallInput({...input, intent:'wall', prompt:''}, owner).intent).toBe('wall');
    expect(()=>parseWallInput({...input, intent:'prompt', prompt:''}, owner)).toThrow('Describe');
    expect(()=>parseWallInput({...input, intent:'remix'}, owner)).toThrow('Choose how');
    expect(parseWallInput(input, owner).intent).toBe('prompt');
    // The match prompt makes the reference the design; the wall prompt makes the room the client.
    const match = wallDesignPrompt({ prompt:'make the background ivory', width:142, height:95, placement:'cover', intent:'match', referencePath: ref });
    expect(match).toMatch(/IS the design/); expect(match).toMatch(/Apply only these requested changes: make the background ivory/); expect(match).not.toMatch(/Design brief:/);
    expect(wallDesignPrompt({ prompt:'', width:142, height:95, placement:'repeat', intent:'match', referencePath: ref })).toMatch(/true seamless tile/);
    // A photographed wall (a slat wall, an existing wallpaper) means the covering, never the room; panels are the 54-inch roll.
    expect(match).toMatch(/photograph of a room or of an installed wall, the design is the WALL COVERING/); expect(match).toMatch(/leave out the room itself: furniture, window, drapes/);
    expect(match).toMatch(/panels up to 54 inches wide/); expect(match).not.toMatch(/51 inches/);
    // Scale in inches: a tile is told its print width and repeat count; a mural is told its real size.
    const tile = wallDesignPrompt({ prompt:'Blush florals', width:142, height:96, placement:'repeat', repeatWidthIn: 72 });
    expect(tile).toMatch(/prints 72 inches wide on the wall and repeats about 2 times/); expect(tile).toMatch(/do not let one motif fill the whole tile/);
    expect(wallDesignPrompt({ prompt:'A mountain mural', width:142, height:96, placement:'cover' })).toMatch(/prints at 142 by 96 inches: scale every element to that real size/);
    expect(parseWallInput({ ...input, placement:'repeat', repeatWidthIn: 36 }, owner).repeatWidthIn).toBe(36);
    expect(parseWallInput({ ...input, placement:'cover', repeatWidthIn: 36 }, owner).repeatWidthIn).toBeNull();
    expect(wallDesignPrompt({ prompt:'', width:142, height:95, placement:'cover', intent:'wall', wallPath: input.wallPath })).toMatch(/design the wall covering you would specify for this room/);
    expect(wallDesignPrompt({ prompt:'Blue botanicals', width:142, height:95, placement:'cover', referencePath: ref })).toMatch(/style inspiration/);
    // The provider sees the reference labeled as the design to reproduce, and the record gets a name.
    const f=fixture(); const result=await f.invoke({...input, intent:'match', prompt:'', referencePath: ref});
    expect(result.status).toBe(200);
    const parts=f.calls.find(c=>c[0]==='provider')[1].contents[0].parts;
    expect(parts.some((p:any)=>p.text==='Design to reproduce')).toBe(true);
    expect(f.calls.filter(c=>c[0]==='finish_wallpro_generation')[0][1].p_name).toBe('Matched design');
  });
  it('recovers a match refused as IMAGE_RECITATION with one original-covering retry; nothing else retries', async () => {
    const ref = owner + '/uploads/44444444-4444-4444-8444-444444444444.png';
    const f=fixture({recitationFirst:true}); const result=await f.invoke({...input, intent:'match', prompt:'', placement:'repeat', referencePath: ref});
    expect(result.status).toBe(200); expect((await result.json()).recovered_from).toBe('IMAGE_RECITATION');
    const providerCalls=f.calls.filter(c=>c[0]==='provider'); expect(providerCalls).toHaveLength(2);
    expect(providerCalls[0][1].contents[0].parts[0].text).toMatch(/IS the design/);
    const retry=providerCalls[1][1].contents[0].parts;
    // The fast model described the reference, and the retry drew from those words with NO photograph attached.
    const describe=f.calls.filter(c=>c[0]==='describe'); expect(describe).toHaveLength(1);
    expect(describe[0][1].contents[0].parts[0].text).toMatch(/Describe the wall covering/); expect(describe[0][1].contents[0].parts[1].inlineData).toBeTruthy();
    expect(retry[0].text).toMatch(/matching this description of the customer's reference: "Vertical white-oak slats/); expect(retry[0].text).toMatch(/not a copy of any photograph/); expect(retry[0].text).toMatch(/seamless repeating tile/);
    expect(retry[0].text).not.toMatch(/reference image/); expect(retry.filter((p:any)=>p.inlineData)).toHaveLength(0);
    // One reservation, one finish, no refund.
    expect(f.calls.filter(c=>c[0]==='reserve_wallpro_generation')).toHaveLength(1);
    expect(f.calls.filter(c=>c[0]==='finish_wallpro_generation')[0][1].p_error).toBeNull();
    // A prompt-intent recitation is not a match and is not retried: the credit is returned.
    const g=fixture({recitationFirst:true}); const r=await g.invoke({...input, referencePath: ref});
    expect(r.status).toBe(502); expect((await r.json()).error).toMatch(/IMAGE_RECITATION/); expect(g.calls.filter(c=>c[0]==='provider')).toHaveLength(1);
    expect(g.calls.filter(c=>c[0]==='finish_wallpro_generation')[0][1].p_error).toMatch(/IMAGE_RECITATION/);
  });
  it('refines the current version in place: source required, mask optional, framing from the source pixels', async () => {
    const source = owner + '/generated/55555555-5555-4555-8555-555555555555.png', mask = owner + '/uploads/66666666-6666-4666-8666-666666666666.png';
    const parsed = parseWallInput({ ...input, wallPath: null, intent: 'refine', prompt: 'make the flowers smaller', sourcePath: source, maskPath: mask }, owner);
    expect(parsed).toMatchObject({ intent: 'refine', sourcePath: source, maskPath: mask });
    expect(parseWallInput({ ...input, wallPath: null, intent: 'refine', prompt: 'x', sourcePath: 'catalog/55555555-5555-4555-8555-555555555555.png' }, owner).sourcePath).toMatch(/^catalog\//);
    expect(() => parseWallInput({ ...input, wallPath: null, intent: 'refine', prompt: 'x', sourcePath: null }, owner)).toThrow('no current design');
    expect(() => parseWallInput({ ...input, wallPath: null, intent: 'refine', prompt: '', sourcePath: source }, owner)).toThrow('what you want changed');
    expect(() => parseWallInput({ ...input, wallPath: null, intent: 'refine', prompt: 'x', sourcePath: source, maskPath: owner + '/generated/66666666-6666-4666-8666-666666666666.png' }, owner)).toThrow('uploaded files');
    expect(() => parseWallInput({ ...input, wallPath: null, intent: 'refine', prompt: 'x', sourcePath: '99999999-9999-4999-8999-999999999999/generated/55555555-5555-4555-8555-555555555555.png' }, owner)).toThrow('uploaded files');
    const text = wallDesignPrompt({ prompt: 'change the background to charcoal', width: 142, height: 95, placement: 'cover', intent: 'refine', maskPath: mask });
    expect(text).toMatch(/NEXT VERSION/); expect(text).toMatch(/Requested change: change the background to charcoal/); expect(text).toMatch(/only the WHITE region/); expect(text).not.toMatch(/Design brief/);
    // The refinement keeps the source's framing: a 3:2 source on a square wall still asks for 3:2.
    const png = new Uint8Array(await sharp({ create: { width: 600, height: 400, channels: 3, background: '#345678' } }).png().toBuffer());
    const f = fixture({ image: png, download: png });
    const result = await f.invoke({ ...input, wallPath: null, width: 96, height: 96, intent: 'refine', prompt: 'make the flowers smaller', sourcePath: source });
    expect(result.status).toBe(200);
    const request = f.calls.find(c => c[0] === 'provider')[1];
    expect(request.generationConfig.imageConfig).toEqual({ aspectRatio: '3:2', imageSize: '4K' });
    expect(request.contents[0].parts.some((p: any) => p.text === 'Current design (the version being refined)')).toBe(true);
    expect(f.calls.filter(c => c[0] === 'finish_wallpro_generation')[0][1].p_name).toBe('Refined: make the flowers smaller');
  });
  it('reads the returned pixel size from the container and reports the enlargement the wall needs', async () => {
    const png = new Uint8Array(await sharp({ create: { width: 640, height: 400, channels: 3, background: '#123456' } }).png().toBuffer());
    const jpg = new Uint8Array(await sharp({ create: { width: 320, height: 200, channels: 3, background: '#123456' } }).jpeg().toBuffer());
    const webp = new Uint8Array(await sharp({ create: { width: 160, height: 100, channels: 3, background: '#123456' } }).webp().toBuffer());
    expect(imageDimensions(png)).toEqual({ width: 640, height: 400 });
    expect(imageDimensions(jpg)).toEqual({ width: 320, height: 200 });
    expect(imageDimensions(webp)).toEqual({ width: 160, height: 100 });
    expect(imageDimensions(new TextEncoder().encode('final'))).toBeNull();
    expect(PRODUCTION_PPI).toBe(150);
    // A real PNG through the handler: the response carries what came back, not what was asked for.
    const f = fixture({ image: png }); const result = await f.invoke({ ...input, width: 142, height: 95 });
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toMatchObject({ model: 'gemini-3-pro-image', requested_image_size: '4K', aspect_ratio: '3:2', width: 640, height: 400, production_ppi: 150 });
    expect(body.required_enlargement).toBeCloseTo(Math.max(142 * 150 / 640, 95 * 150 / 400), 1);
  });
  it('rejects another owner, arbitrary URLs and invalid dimensions', () => {
    for(const wallPath of ['https://other.test/photo.jpg','../other/photo.png','99999999-9999-4999-8999-999999999999/uploads/33333333-3333-4333-8333-333333333333.jpg']) expect(()=>parseWallInput({...input,wallPath},owner)).toThrow();
    expect(()=>parseWallInput({...input,width:0},owner)).toThrow();
    expect(nearestAspect(96,120)).toBe('4:5'); expect(nearestAspect(240,96)).toBe('21:9');
  });
  it('stops on an unreadable wall photo before spending a credit or dropping the photo',async () => {
    const f=fixture({unreadable:true}); expect((await f.invoke()).status).toBe(400); expect(f.sb.rpc).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
  });
  it('does not call the provider when no credit can be reserved',async () => {
    const f=fixture({noTokens:true}); expect((await f.invoke()).status).toBe(402); expect(f.provider).not.toHaveBeenCalled();
  });
  it('returns an existing request without a second generation or charge',async () => {
    const f=fixture({fresh:false}); const result=await f.invoke(); expect(result.status).toBe(200); expect(f.provider).not.toHaveBeenCalled(); expect(f.storage.upload).not.toHaveBeenCalled();
  });
  it('records and returns only the final artwork through private signed access',async () => {
    const f=fixture(); const result=await f.invoke(); expect(result.status).toBe(200); expect(f.provider).toHaveBeenCalledTimes(1);
    expect(f.sb.storage.from).toHaveBeenCalledWith('wallpro-files');
    expect(new TextDecoder().decode(f.storage.upload.mock.calls[0][1])).toBe('final');
    expect(f.calls.filter(c=>c[0]==='finish_wallpro_generation')[0][1]).toMatchObject({p_owner:owner,p_error:null,p_path:owner+'/generated/'+requestId+'.png'});
    expect(await result.json()).toMatchObject({scene_render:false,image_url:'https://example.test/signed-result'});
  });
  it('settles failure through the atomic refund and never retries the provider',async () => {
    const f=fixture({providerFailure:true}); expect((await f.invoke()).status).toBe(502); expect(f.provider).toHaveBeenCalledTimes(1);
    expect(f.calls.filter(c=>c[0]==='finish_wallpro_generation')[0][1]).toMatchObject({p_owner:owner,p_path:null});
    expect(f.calls.filter(c=>c[0]==='finish_wallpro_generation')[0][1].p_error).toBeTruthy();
  });
});

describe('Taking the photo the phone actually gives us', () => {
  it('passes a print-safe file through untouched and converts everything else', () => {
    // A print-ready upload is never re-compressed.
    expect(needsWallTranscode('image/jpeg', 'wall.jpg')).toBe(false);
    expect(needsWallTranscode('image/png', 'master.png')).toBe(false);
    expect(needsWallTranscode('image/webp', 'tile.webp')).toBe(false);
    // What an iPhone camera actually produces.
    expect(needsWallTranscode('image/heic', 'IMG_4021.HEIC')).toBe(true);
    expect(needsWallTranscode('image/heif', 'IMG_4021.heif')).toBe(true);
    expect(needsWallTranscode('image/avif', 'shot.avif')).toBe(true);
    // Some pickers report no type at all: the extension decides.
    expect(needsWallTranscode('', 'IMG_4021.HEIC')).toBe(true);
    expect(needsWallTranscode('', 'wall.JPG')).toBe(false);
    expect(needsWallTranscode('', 'wall.jpeg')).toBe(false);
    expect(needsWallTranscode('', '')).toBe(true);
  });
});

describe('A match reproduces the reference at its own scale', () => {
  const ref = 'owner/uploads/ref.png';
  it('never tells the model to draw small motifs when the reference sets the scale', () => {
    const cover = wallDesignPrompt({ prompt: '', width: 142, height: 96, placement: 'cover', intent: 'match', referencePath: ref });
    expect(cover).toMatch(/reference is the scale baseline/);
    expect(cover).toMatch(/at the size it appears in the reference/);
    expect(cover).not.toMatch(/architectural scale/);
    // The generic mural sentence, which tells the model to fit "many elements"
    // onto a large wall, is exactly what shrank a matched design.
    expect(cover).not.toMatch(/scale every element to that real size/);
    // The measured baseline: a matched design repeats about twice across.
    const tile = wallDesignPrompt({ prompt: '', width: 142, height: 96, placement: 'repeat', repeatWidthIn: 72, intent: 'match', referencePath: ref });
    expect(tile).toMatch(/prints 72 inches wide on the wall and repeats about 2 times across it/);
    expect(tile).toMatch(/Hold the reference's own motif scale/);
    expect(tile).toMatch(/not with many smaller copies of them/);
    expect(tile).not.toMatch(/architectural scale/);
  });
  it('leaves the prompt and wall intents on the wall-sized scale brain', () => {
    const tile = wallDesignPrompt({ prompt: 'Blush florals', width: 142, height: 96, placement: 'repeat', repeatWidthIn: 72 });
    expect(tile).toMatch(/compose it at architectural scale/);
    expect(tile).toMatch(/a hero bloom or frond 18 to 36 inches across/);
    expect(tile).toMatch(/Do not fill the tile with many small motifs/);
    // The instruction that produced a dense craft print is gone for good.
    expect(tile).not.toMatch(/a bloom or a leaf a few inches across/);
    expect(tile).toMatch(/ARCHITECTURAL GRAPHICS, not fabric or gift wrap/);
    // A match reproduces the reference, so it is never given the persona's
    // composition rules on top of it.
    expect(wallDesignPrompt({ prompt: '', width: 142, height: 96, placement: 'cover', intent: 'match', referencePath: ref })).not.toMatch(/ARCHITECTURAL GRAPHICS/);
    expect(wallDesignPrompt({ prompt: 'A mountain mural', width: 142, height: 96, placement: 'cover' })).toMatch(/scale every element to that real size/);
  });
});
