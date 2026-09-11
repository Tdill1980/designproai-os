import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import JSZip from 'jszip';
import { DEFAULT_WALL_PRINT, planWallPrint, wallPrintPreflight } from '../wallpro-print-plan';
import { buildWallPrintPack } from '../wallpro-print-export';
import type { SeamlessReceipt } from '../wallpro-seamless';

// A repeat may only print with a verified seam receipt. The seam module has its own tests.
const verifiedSeam: SeamlessReceipt = { contract: 'wallpro.seamless.v1', preference: 'auto', method: 'verified', before: { width: 600, height: 400, edge: 1, interior: 1, ratio: 1, seamless: true }, after: null, verified: true };

describe('WallPro printable panel geometry', () => {
  it('fits the complete printed panel inside 51 inches including overlap and outer bleed', () => {
    const plan = planWallPrint(120, 96, DEFAULT_WALL_PRINT);
    expect(plan.panels.map(p => [p.x, p.width, p.height, p.overlapLeft])).toEqual([[-1, 51, 98, 0], [49.5, 51, 98, .5], [100, 21, 98, .5]]);
    expect(plan.panels.reduce((n,p) => n+p.width-p.overlapLeft,0)).toBe(122);
  });
  it('does not create a duplicate final strip at exact widths', () => {
    expect(planWallPrint(100, 96, { bleed: 1, overlap: 0, minPpi: 150 }).panels.map(p=>p.width)).toEqual([51, 51]);
    expect(planWallPrint(49, 96, DEFAULT_WALL_PRINT).panels.map(p=>p.width)).toEqual([51]);
  });
  it('covers walls without gaps for fractional dimensions and overlaps', () => {
    for (const width of [1, 50, 51, 51.125, 120, 2399.875]) for (const bleed of [0, .125, 1, 5]) for (const overlap of [0, .375, 5]) {
      const {panels}=planWallPrint(width, 83.125, {bleed, overlap, minPpi:150});
      expect(panels[0].x).toBeCloseTo(-bleed,6);
      expect(panels.at(-1)!.x+panels.at(-1)!.width).toBeCloseTo(width+bleed,6);
      panels.forEach((p,i)=>{expect(p.width).toBeLessThanOrEqual(51); if(i)expect(panels[i-1].x+panels[i-1].width-p.x).toBeCloseTo(overlap,6);});
    }
  });
  it('rejects invalid settings and a falsely print-ready low-resolution mural', () => {
    expect(()=>planWallPrint(120,96,{...DEFAULT_WALL_PRINT,overlap:-1})).toThrow();
    expect(()=>planWallPrint(120,96,{...DEFAULT_WALL_PRINT,bleed:NaN})).toThrow();
    const check=wallPrintPreflight({width:120,height:96,mode:'cover',repeatWidth:24},DEFAULT_WALL_PRINT,{width:4096,height:4096});
    expect(check.ppi).toBeCloseTo(34.1333,3); expect(check.ready).toBe(false); expect(check.requiredPixels.width).toBe(18000);
  });
  it('measures the original tile PPI independently of wall width and preserves non-square tile proportions', () => {
    for(const width of [120,240]){
      const c=wallPrintPreflight({width,height:96,mode:'repeat',repeatWidth:24},DEFAULT_WALL_PRINT,{width:3600,height:1800});
      expect(c.ready).toBe(true);expect(c.ppi).toBe(150);expect(c.metrics.artworkHeight).toBe(12);
    }
  });
});

describe('WallPro real PDF package', () => {
  it('writes full-size panel PDFs with intact image pixels, a master, install guide and verified inventory', async () => {
    const bytes=new Uint8Array(await sharp({create:{width:600,height:400,channels:3,background:'#2266aa'}}).png().toBuffer());
    const pack=await buildWallPrintPack({name:'Print test',layout:{width:120,height:75,mode:'repeat',repeatWidth:4},settings:DEFAULT_WALL_PRINT,source:{bytes,width:600,height:400},seamless:verifiedSeam});
    const zip=await JSZip.loadAsync(pack.zip);
    const names=Object.keys(zip.files);
    expect(names).toContain('panels/panel-001-51x77in.pdf');expect(names).toContain('panels/panel-003-21x77in.pdf');
    const pdf=Buffer.from(await zip.file('panels/panel-001-51x77in.pdf')!.async('uint8array')).toString('latin1');
    expect(pdf).toContain('%PDF-1.6');expect(pdf).toMatch(/\/MediaBox \[0 0 3672(?:\.0*)? 5544(?:\.0*)?\]/);
    expect(pdf).toMatch(/\/Width 600\s/);expect(pdf).toMatch(/\/Height 400\s/);
    expect(pdf).toContain('/TrimBox');expect(pdf).toContain('/BleedBox');
    const manifest=JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.source.effectivePpi).toBe(150);expect(manifest.source.pixelResampling).toBe(false);
    for(const f of manifest.files){const actual=await zip.file(f.path)!.async('uint8array');expect(createHash('sha256').update(actual).digest('hex')).toBe(f.sha256);}
    expect(names).toContain('wall-master-full-size.pdf');expect(names).toContain('installation-layout.pdf');expect(names).toContain('PRINT-INSTRUCTIONS.txt');
  });
  it('preserves large physical page dimensions with PDF UserUnit instead of truncating at 200 inches', async () => {
    const bytes=new Uint8Array(await sharp({create:{width:300,height:300,channels:3,background:'#aa5522'}}).png().toBuffer());
    const pack=await buildWallPrintPack({name:'Long wall',layout:{width:51,height:240,mode:'repeat',repeatWidth:4},settings:{bleed:0,overlap:0,minPpi:72},source:{bytes,width:300,height:300},seamless:verifiedSeam});
    const pdf=Buffer.from(pack.files[0].bytes).toString('latin1');
    expect(pdf).toContain('/UserUnit 2');expect(pdf).toMatch(/\/MediaBox \[0 0 1836(?:\.0*)? 8640(?:\.0*)?\]/);
  });
  it('blocks undersized sources and mismatched dimension metadata before returning any package', async () => {
    const bytes=new Uint8Array(await sharp({create:{width:20,height:20,channels:3,background:'#ffffff'}}).png().toBuffer());
    const input={name:'Blocked',layout:{width:120,height:96,mode:'cover' as const,repeatWidth:24},settings:DEFAULT_WALL_PRINT,source:{bytes,width:20,height:20}};
    await expect(buildWallPrintPack(input)).rejects.toThrow('PPI');
    await expect(buildWallPrintPack({...input,source:{bytes,width:2000,height:2000}})).rejects.toThrow('dimensions changed');
  });
});
