import { describe, expect, it, vi } from 'vitest';
import { artworkPoint, homography, projectPoint, UNIT_WALL, validWallCorners, validWallSize, layoutMetrics, insidePolygon, wallPrintPanels } from '../wallpro-geometry';
import { createWallHandler, parseWallInput, nearestAspect } from '../../../../supabase/functions/generate-wall-design/handler';
const owner = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const input = { requestId, prompt: 'Blue botanicals', width: 120, height: 96, placement: 'cover', wallPath: owner + '/uploads/33333333-3333-4333-8333-333333333333.jpg' };

describe('WallPro physical geometry', () => {
  it('plans 51-inch print panels with a correctly sized final panel', () => {
    const panels = wallPrintPanels(120,96);
    expect(panels.map(p => p.width)).toEqual([51,51,18]);
    expect(panels.map(p => p.start)).toEqual([0,51,102]);
    expect(panels.reduce((n,p) => n+p.width,0)).toBe(120);
    expect(wallPrintPanels(102,96)).toHaveLength(2);
    expect(wallPrintPanels(51.25,96).map(p => p.width)).toEqual([51,.25]);
  });
  it('keeps pattern registration continuous across a 51-inch print seam', () => {
    const seam = wallPrintPanels(120,96)[1].start;
    const uv = artworkPoint({x:seam/120,y:.5},{width:120,height:96,mode:'repeat',repeatWidth:24},1);
    expect(uv?.x).toBeCloseTo(.125,10);
    const quad=[{x:.1,y:.1},{x:.9,y:.2},{x:.8,y:.9},{x:.2,y:.8}];
    const seamPoint=projectPoint(homography(UNIT_WALL,quad),{x:seam/120,y:0});
    expect(projectPoint(homography(quad,UNIT_WALL),seamPoint).x).toBeCloseTo(51/120,10);
  });
  it('keeps a 24-inch tile physically constant when the wall doubles', () => {
    const a = layoutMetrics({ width:120,height:96,mode:'repeat',repeatWidth:24 },2);
    const b = layoutMetrics({ width:240,height:96,mode:'repeat',repeatWidth:24 },2);
    expect(a).toMatchObject({ across:5,down:8,artworkWidth:24,artworkHeight:12 });
    expect(b).toMatchObject({ across:10,down:8,artworkWidth:24,artworkHeight:12 });
    expect(artworkPoint({x:12/120,y:6/96},{width:120,height:96,mode:'repeat',repeatWidth:24},2)).toEqual({x:0.5,y:0.5});
    expect(artworkPoint({x:12/240,y:6/96},{width:240,height:96,mode:'repeat',repeatWidth:24},2)).toEqual({x:0.5,y:0.5});
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

function fixture(options: { auth?: boolean; unreadable?: boolean; fresh?: boolean; providerFailure?: boolean; noTokens?: boolean } = {}) {
  const calls:any[]=[];
  const stored={state:'completed',artwork_path:owner+'/generated/'+requestId+'.png',design_name:'Blue Botanicals'};
  const storage={
    download:vi.fn(async () => options.unreadable ? {error:{message:'denied'}} : {data:new Blob(['image'],{type:'image/jpeg'})}),
    upload:vi.fn(async (...args:any[]) => { calls.push(['upload',...args]); return {}; }),
    createSignedUrl:vi.fn(async () => ({data:{signedUrl:'https://example.test/signed-result'}})),
  };
  const sb={auth:{getUser:vi.fn(async () => options.auth===false ? {error:true} : {data:{user:{id:owner}}})},storage:{from:vi.fn(() => storage)},rpc:vi.fn(async (name:string,args:any) => {
    calls.push([name,args]);
    if(name==='reserve_wallpro_generation') return options.noTokens ? {error:{message:'no_tokens'}} : {data:{fresh:options.fresh!==false,generation:stored}};
    return {data:stored};
  })};
  const provider=vi.fn(async (_url:any,init:any) => { calls.push(['provider',JSON.parse(init.body)]); return options.providerFailure ? new Response('{}',{status:503}) : Response.json({candidates:[{content:{parts:[{thought:true,inlineData:{data:btoa('thought'),mimeType:'image/png'}},{text:'Blue Botanicals'},{inlineData:{data:btoa('final'),mimeType:'image/png'}}]}}]}); });
  const handler=createWallHandler({createClient:()=>sb,supabaseUrl:'https://own.supabase.co',serviceKey:'private-test-key',apiKey:()=> 'provider-test-key',fetch:provider as any});
  const invoke=(body:any=input)=>handler(new Request('https://own.supabase.co/functions/v1/generate-wall-design',{method:'POST',headers:{authorization:'Bearer user-test-token'},body:JSON.stringify(body)}));
  return {handler,invoke,calls,provider,sb,storage};
}

describe('WallPro generation boundary', () => {
  it('requires real user authentication before reading files or charging',async () => {
    const f=fixture({auth:false}); expect((await f.invoke()).status).toBe(401); expect(f.storage.download).not.toHaveBeenCalled(); expect(f.sb.rpc).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
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
